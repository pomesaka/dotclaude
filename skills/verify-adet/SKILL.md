---
name: verify-adet
description: ADeT の PR 変更を portless + playwright-cli で実機検証し、スクショと結果を PR コメントとして投稿する。ユーザー明示呼び出し専用。
argument-hint: "[pr-number]"
disable-model-invocation: true
allowed-tools:
  - Bash(mise exec *)
  - Bash(playwright-cli *)
  - Bash(gh pr *)
  - Bash(gh repo *)
  - Bash(gh api *)
  - Bash(jj bookmark *)
  - Bash(jj diff *)
  - Bash(jj diffu *)
  - Bash(jj log *)
  - Bash(lsof *)
  - Bash(fd *)
  - Bash(rg *)
  - Bash(ls *)
  - Bash(cat *)
  - Bash(mkdir *)
  - Bash(bash *)
  - Read
  - Write
model: sonnet
---

# verify-adet: ADeT PR の実機検証 → スクショ付き PR コメント投稿

`bundled/verify` スキルの「Runtime observation」思想を ADeT 向けに具体化したもの。
テスト再実行や typecheck は **しない**（それは CI の仕事）。実際にアプリを起動して変更が届く surface を触り、
観察した内容を PR コメントとして残す。

## いつ使うか

- PR が実装完了して手動確認したい
- レビュー前に自分で証跡を残しておきたい
- 他レビュアーに「ここまで動く」を伝えたい

デモ動画を作りたいだけなら `demo-record-adet` を使う（あちらは「綺麗な動画作成」目的、こちらは「検証証跡」目的）。

## 前提（ADeT ローカル環境）

| リソース | デフォルト | 備考 |
|---------|-----------|------|
| Frontend | `http://localhost:3000` | jj ワークスペース並列時は `PORT=3001` 等で回避 |
| Backend | `http://localhost:8080` | jj ワークスペース並列時は `SERVER_PORT=8090` |
| DB (MySQL) | `13306` | docker compose 共有 |
| MinIO | `9000` | docker compose 共有 |
| テストユーザー | `user006@example.com` / `password006` | |
| テストプロジェクト | `00000000-0000-0000-0000-000000000000` | |

`docker compose up -d` はインフラのみ（DB + MinIO）。backend / frontend は `task be:up` / `task fe:up`（詳細は `compose.yaml` 冒頭コメント）。

## フロー

### Step 1: PR とスコープの特定

引数指定時:
```bash
gh pr view <PR番号> --json number,title,headRefName,baseRefName,mergeable
```

未指定時: 現在のブックマークから探す。
```bash
jj bookmark list
gh pr list --head <bookmark名> --json number,title
```

### Step 2: 変更が届く surface を特定

diff を読んで「どのユーザー操作でこの変更が実行されるか」を書き出す。ここが verify 全体の設計。

```bash
jj diffu --from main --to @ --stat        # ファイル一覧
jj diffu --from main --to @ <path>        # 個別ファイル詳細
```

**判断基準:**

| 変更層 | Surface | 駆動方法 |
|--------|---------|---------|
| Frontend (`frontend/src/`) | 該当画面 | playwright-cli で操作 |
| Backend handler (`backend/server/api/`) | 該当エンドポイント | UI 経由 or `curl` で叩く |
| Domain / usecase | UI 経由の副作用 | UI 経由で結果を観測 |
| DB migration | schema state | `task db:attach` で確認 |
| OpenAPI 定義変更 | 生成型 + UI | UI で「型が変わったことで動くようになった / 落ちるようになった」動作を確認 |
| Docs / 型定義のみ | なし | **SKIP**（コメントに「no runtime surface」と明記して終了） |

「変更が届く画面が分からない」= 検証観点が定まっていない状態。設計段階の理解不足なので、diff を読み直すか設計 docs を確認する。

### Step 3: dev サーバー起動（`/portless` 委譲）

frontend の場合は portless で起動する。バックグラウンド起動 + ログを `~/.claude/tmp/` に流し、コンテキストを守る。

```bash
mise exec --cd /path/to/frontend -- portless <name> bun run dev >> ~/.claude/tmp/<name>-dev.log 2>&1
```

- `<name>` は jj ワークスペース名やブックマーク名を含めて一意にする（例: `frontend-shoko-ea9d`）。他ワークスペースが同名で起動していると衝突する
- URL は `https://<name>.localhost` になる
- portless proxy が起動していない場合はユーザーに `sudo portless proxy start --https` を案内する
- 起動失敗（即完了通知）はログを Read で確認

**backend 起動が必要なら別途 `task be:up`**（portless では包まない — kong のポート env は `SERVER_PORT`）。

**ポート・ホストの衝突チェック（jj ワークスペース並列時）:**

```bash
lsof -nP -iTCP:3000 -sTCP:LISTEN   # frontend
lsof -nP -iTCP:8080 -sTCP:LISTEN   # backend
```

既に埋まっていたら**別ポートで自分のワークスペースを立てる**。他ワークスペースの dev server に繋いだまま検証すると「別のコードを見て OK と言う」誤検証になる。

### Step 4: playwright-cli で駆動 → スクショ撮影

まず探索（インタラクティブ操作で目的画面と操作手順を確定）:

```bash
playwright-cli open "https://<name>.localhost/auth/signin"
playwright-cli snapshot
# refs で操作しながら画面遷移を確認
```

確定したらスクリプト化して一気に実行する。**ref は動的に変わるため、スクリプトでは `run-code` + `getByRole` / `getByPlaceholder` / `getByText` を使う**（ref 直打ちは再実行で壊れる）。

スクリプトテンプレート（`~/.claude/tmp/verify-<feature>.sh` に置く。**リポジトリ内には置かない**）:

```bash
#!/usr/bin/env bash
set -e

BASE="https://<name>.localhost"

# ログイン
playwright-cli open "${BASE}/auth/signin"
playwright-cli resize 1440 900
playwright-cli run-code "async page => {
  await page.getByPlaceholder('メールアドレス').fill('user006@example.com');
  await page.getByRole('button', { name: '次へ' }).click();
  await page.waitForTimeout(400);
  await page.getByPlaceholder('パスワード').fill('password006');
  await page.getByRole('button', { name: 'ログイン' }).click();
  await page.waitForURL('**/organizations**');
}"

# 検証対象の画面へ
playwright-cli goto "${BASE}/projects/00000000-0000-0000-0000-000000000000/spec"
sleep 1.5

# --- ここが「変更を通した検証」 ---
# 1. 変更が届く操作を行う
playwright-cli run-code "async page => await page.getByRole('button', { name: '<変更対象>' }).click()"
sleep 0.5

# 2. スクショで結果を捕捉（`~/.claude/tmp/` に絶対パスで保存 — CWD 保存はリポジトリを汚す）
playwright-cli screenshot --filename=/Users/pomesaka/.claude/tmp/verify-<feature>-01.png

# 3. push-on-it（変更の周辺を触ってみる: 空入力 / 不正入力 / キャンセル 等）
playwright-cli run-code "async page => await page.getByPlaceholder('...').fill('')"
playwright-cli run-code "async page => await page.getByRole('button', { name: '保存' }).click()"
sleep 0.5
playwright-cli screenshot --filename=/Users/pomesaka/.claude/tmp/verify-<feature>-02-empty.png

playwright-cli close
```

**押さえるべき原則**（bundled/verify 由来 — 詳細は`bundled:verify`のスキル本文）:
- **claim を確認するだけで終わらせない** — 「happy path が動く」は前半戦。周辺（空値、不正、キャンセル、二重送信、リロード）を必ず触る
- 撮ったスクショは **CWD ではなく `~/.claude/tmp/` に絶対パスで**保存（CWD 保存は `.gitignore` されていないと PR に混入する。詳細は playwright-cli スキルの Gotcha 参照）
- 副作用のあるリソース（ブランチ作成・ファイルアップロード等）を作ったら **検証後に API で削除**（testdata を汚さない）

### Step 5: スクショを GitHub にアップロード

`upload-screenshots` スキルの `upload.sh` を直接呼ぶ（Skill ツールでチェーンしない — `disable-model-invocation: true` 同士の相互呼び出しはブロックされる）。

```bash
REPO=$(gh repo view --json nameWithOwner --jq '.nameWithOwner')
NUMBER=<PR番号>

~/.claude/skills/upload-screenshots/upload.sh "$REPO" "$NUMBER" \
  ~/.claude/tmp/verify-<feature>-01.png \
  ~/.claude/tmp/verify-<feature>-02-empty.png
# 出力は "ファイル名\tURL" の TSV
```

### Step 6: PR コメントを投稿

**PR body は書き換えない**。同じ PR で複数回検証するとき body 更新方式だと前回の証跡が消える。コメント方式なら時系列で残る。

コメント本文は下記フォーマットで `~/.claude/tmp/verify-<feature>-comment.md` に書き出してから `gh pr comment --body-file` で投稿する（`--body "$(cat ...)"` は Gotcha にある通り事故が起きるので避ける）。

```markdown
## 動作検証 (verify-adet)

**Verdict:** PASS | FAIL | BLOCKED | SKIP

**Claim:** <PR が実現するべき挙動を一行で>

**Method:** portless + playwright-cli で `<画面パス>` を駆動

### Steps

1. ✅/❌/⚠️/🔍 <実際にやった操作> → <観察した結果>
   ![step1](<upload URL>)
2. 🔍 <push-on-it: 周辺操作> → <観察した結果>
   ![step2](<upload URL>)

### Findings

- ⚠️ <レビュアーに interrupt してでも伝えるべき違和感>
- <気になった点・環境依存の注意点など>

<!-- verify-adet by Claude Code -->
```

投稿:

```bash
gh pr comment <PR番号> --body-file ~/.claude/tmp/verify-<feature>-comment.md
```

### Step 7: 完了報告

- PR コメント URL（`gh pr view <番号> --comments` で確認）
- Verdict
- 気になった点があれば口頭でも改めて伝える

## 出力フォーマットの解釈

- **PASS**: 変更が意図通り surface に届いた
- **FAIL**: 届いたが期待と違う挙動 or 別のものが壊れた
- **BLOCKED**: 起動できない / 該当画面に到達できない（変更の当否ではない）
- **SKIP**: 実行できる surface がない（docs/types 変更のみ）

happy path だけの ✅ 連打（🔍 なし）は PASS だが「前半戦のみ」。周辺を触った 🔍 を必ず 1 つは入れる。

## Gotchas

- **ADeT の spec フォームのタブは `<button>` で `role="tab"` を持たない**: `getByRole('tab', ...)` が動かない。対処: `getByRole('button', { name: '...', exact: true }).first()` を使う（demo-record-adet Gotcha より）。
  <!-- importance: high | mentions: 1 | first-seen: 2026-07 -->
- **backend のポート env は `SERVER_PORT`（`PORT` ではない）**: kong はネストした option 構造体のフィールド名をプレフィックスにするため、`PORT=8090 task be:up` は**エラーにならず黙って 8080 で起動する**。起動ログの `Listen server port=` を必ず確認する。同様に他ポートも `MYSQL_HOST` / `LLM_BASE_URL` のようにグループ名プレフィックスが付く。
  <!-- importance: high | mentions: 1 | first-seen: 2026-07 -->
- **並列 jj ワークスペースの dev server とポート衝突する**: 別ワークスペースが 3000/8080 を握っていると「別コードを検証」してしまう。`lsof -nP -iTCP:3000 -sTCP:LISTEN` で PID → `ps` の cwd 確認 → 自分のワークスペースは別ポートで起動する。frontend: `PORT=3001 AUTH_URL=http://localhost:3001 BACKEND_URL=http://localhost:8090 task fe:up`（`AUTH_URL` は NextAuth コールバック、`BACKEND_URL` は server-side からの backend 呼び出し先）。MySQL/MinIO の compose は共有。
  <!-- importance: high | mentions: 1 | first-seen: 2026-07 -->
- **画面ルートを勝手に推測しない**: 存在しないパスに `goto` しても 404 が返るだけでエラーにならず、snapshot を読むまで気づけない。`fd -t f page.tsx frontend/src/app` で実ルートを確認してから goto する（バージョン管理画面は `/projects/{id}/versions` であり `/spec/version-management` ではない、等）。
  <!-- importance: medium | mentions: 1 | first-seen: 2026-07 -->
- **副作用ありリソースは検証後に消す**: ブランチ作成・spec 生成のように一意制約や testdata 汚染が起きる操作は、検証後に `/api/v1/credentials_auth/users/login` でトークンを取り DELETE エンドポイントで cleanup する。消し忘れると次回 verify で 409 になったり、無関係なデータが画面に映り込む。
  <!-- importance: medium | mentions: 1 | first-seen: 2026-07 -->
- **`playwright-cli screenshot --filename=` は CWD に保存される**: リポジトリで走らせると jj/git に追跡される。必ず `~/.claude/tmp/` などの**絶対パス**を指定する。`.playwright-cli/` セッションディレクトリも同様なので `.gitignore` に追加しておく。
  <!-- importance: high | mentions: 1 | first-seen: 2026-07 -->
- **`gh pr comment --body "$(cat ...)"` は cat 失敗時に空 body で成功する**: 事故防止のため必ず `--body-file` を使う（update-pr / create-pr の Gotcha と同じ）。
  <!-- importance: high | mentions: 1 | first-seen: 2026-07 -->
- **upload-screenshots の `upload.sh` は同名アセット既存時に `null` を返す**: 同じ PR に対して同名ファイルを 2 回上げると 422 で無音失敗する。ファイル名にタイムスタンプ等を含めるか、先に既存アセットを削除する（demo-record-adet Gotcha 参照）。
  <!-- importance: medium | mentions: 1 | first-seen: 2026-07 -->
- **PR body は書き換えず「コメント」で残す**: 同 PR で複数回検証したとき body 更新方式だと前回の証跡が消える。verdict とスクショはコメント（`gh pr comment`）に投稿し、body 側の「動作検証」節はレビュアー再現手順の記述に留める。
  <!-- importance: high | mentions: 1 | first-seen: 2026-07 -->
- **claim だけ確認して終わる happy-path 検証は「PASS だが前半戦」**: bundled/verify の思想では「変更の周辺を触って壊れないこと」まで込みで verify。空入力・不正入力・キャンセル・リロード・二重送信のうち変更に関連するものを最低 1 つ触り、🔍 マークで Steps に残す。
  <!-- importance: high | mentions: 1 | first-seen: 2026-07 -->
