---
name: verify-noah
description: noah apps を実機検証し、証跡つきで PR を更新する（起動 → 画面駆動 → 後始末 → PR 更新 → スクショ投稿）。
argument-hint: "[PR番号] [app名]"
disable-model-invocation: true
allowed-tools: Skill, Read, Bash(jj *), Bash(gh *), Bash(rg *), Bash(mv *), Bash(rm *), Bash(ls *)
---

# verify-noah: 実機検証から PR 更新まで

`/verify`（実機検証レシピ）と `/update-pr`（PR 更新）を 1 本に繋ぐオーケストレーター。
検証と PR 更新を別々に呼ぶと **証跡の後始末が抜けたまま push される**（snapshot / screenshot が CWD =
リポジトリ内に落ちるため）。このスキルは後始末を両者の間に必ず挟むことでその事故を構造的に防ぐ。

各ステップの中身は既存スキルが正。ここは順番と接続点だけを持つ。

## Step 0: 対象を確定する

- **PR 番号**: 引数にあればそれ。無ければ `jj bookmark list` → `gh pr list --head <bookmark名> --json number,title`
- **app 名**: 引数にあればそれ。無ければ `jj diffu -r 'main..@' --stat` の変更パス（`apps/<app>/...`）から判断する
- **何を確認すれば検証したことになるか**: PR の「動作確認手順」（無ければ issue の受け入れ基準）を読んで
  観測ポイントを先に列挙する。ここを決めずに画面を開くと「動いてはいるが受け入れ基準を見ていない」証跡になる

PR が見つからなければ中断してユーザーに確認する（`/create-pr` の領分であり、このスキルは既存 PR の更新のみ扱う）。

## Step 1: 起動

`Skill("portless-noah")` を app 名つきで呼ぶ。`.env.local` 欠落・`BETTER_AUTH_URL` 不一致・DB 未起動・
migration 未適用の罠は全部そちらが持っている。

URL は `https://<app>-<workspace>.localhost`（workspace 名 = CWD の末尾ディレクトリ）。

## Step 2: 画面駆動と証跡取得

`Skill("verify")` のレシピに従う。要点だけ再掲する（詳細は verify 側が正）:

- ログインは **`admin@example.com` / `password`**（seed の `test@example.com` は feature gate 403 +
  password-setup リダイレクトの二重罠）
- client fetch のページは curl では中身が出ない → `Skill("playwright-cli")` で駆動する
- **証跡は最初からリポジトリ外に書く**: `playwright-cli screenshot --filename=~/.claude/tmp/<name>.png`
  のように絶対パスを渡す。`--filename` を省くと CWD（= リポジトリ）に落ちる

Step 0 で挙げた観測ポイントごとに 1 枚ずつ撮る。「画面が出た」だけのスクショは PR に貼っても
レビュアーの確認コストを下げないので、**何が起きたかが分かる瞬間**（遷移後・エラー表示・数値が変わった直後）を撮る。

## Step 3: 後始末（PR 更新の前に必ず）

push される中身を汚さないための工程。**Step 4 の前に済ませる**。

1. dev server の background task を停止・`playwright-cli close`
2. `rm -rf .playwright-cli` （`--filename` を外に出してもセッション記録はここに残る）
3. CWD に落ちた証跡があれば `~/.claude/tmp/` へ `mv`
4. `jj diff --from <bookmark>@origin --to @ --stat` で **push される差分を目視する**。
   `.env.local` / `compose.override.yaml` など検証で書き換わったワークスペース固有ファイルが
   混ざっていたら `jj restore --from <bookmark>@origin -- <path>` で戻す

`jj st` は「変更あり」としか言わないので、4 の `--stat` を省くと混入に気づけない。

## Step 4: PR を更新する

`Skill("update-pr")` を PR 番号つきで呼ぶ。動作検証セクションには Step 2 で実際に観測した結果を書く
（手順の再掲でなく「何を確認したか」）。

## Step 5: スクショを投稿する

`Skill("upload-screenshots")` を PR 番号 + Step 2 の証跡ファイルで呼ぶ。
各画像の下に「何を確認した画像か」を 1 行添える — 画像だけでは観測ポイントが伝わらない。

## Gotchas

- **証跡の後始末は PR 更新より前**: `/verify` → `/update-pr` を素で繋ぐと、`.playwright-cli/` と
  CWD 直下の snapshot/screenshot が working copy に入ったまま push される。jj は `@` を bookmark コミットへ
  無音で amend するため、PR に検証ゴミが混ざったことに push 後まで気づけない。Step 3 を飛ばさない
- **スクショは PR ボディでなくコメントに載る**: `upload-screenshots` は `gh pr comment` で投稿する。
  ボディ内に `![](URL)` で埋め込みたい場合は Step 5 を先に実行して URL を得てから Step 4 に渡す
  （このスキルの既定順ではボディに URL は入らない）
- **`upload-screenshots` は `${CLAUDE_SKILL_DIR}/upload.sh` を使う**: `Skill()` 経由で呼べばそのスキル自身の
  ディレクトリに解決される。手で `upload.sh` のパスを組み立てて Bash から叩くと解決先がずれる
- **`disable-model-invocation: true` は他スキルからの `Skill("verify-noah")` も封じる**: 副作用
  （dev server 起動・PR 更新・GitHub へのアセット投稿）があるため自動発火は塞いでいる。
  チェーンの起点は常にユーザーの `/verify-noah`
- **同一アプリの別 workspace と DB を共有していると migration が無音スキップされる**: drizzle は
  「適用済み最後の `created_at` より journal の `when` が新しいエントリのみ適用」するため、別ブランチの
  migration が先に入っていると自ブランチ分が `migrations applied successfully!` のままスキップされる。
  検証中に `relation "..." does not exist` が出たら DB 共有を疑う（詳細は portless-noah の Gotchas）。
  **PR の migration が既存テーブルを drop / rename する破壊的なものなら、共有 postgres に当てず本 workspace 専用の
  postgres を別ポート（`compose.override.yaml`）で立てる** — 共有すると無音スキップと他ブランチのデータ破壊が
  同時に起きる。検証後に `compose.override.yaml` / `.env.local` を Step 3-4 で `jj restore` するのを忘れない
- **「操作が出ないこと」を確認する PR では、残っている操作を必ず全部触る**: 凍結・権限ガードの検証は
  「ボタンが消えた」スクショで満足しがちだが、それはガードが効いた経路の証跡にしかならない。**画面に残っている
  入力欄・保存ボタンを実際に押して弾かれるかまで見る**と、ガードを通していない write 経路（＝実装漏れ）が出る。
  ガード関数名で `rg` して呼び出し箇所を列挙し、列挙に載っていない同種の操作を優先的に触ると効率がよい。
  実例: issue 1011 で回付済み（凍結中）の月の「対応済みメモ」だけ保存が通り、`isMonthEditable` 未適用が判明
- **ロール差を見る検証は同時に複数セッションを開く**: 担当者 / 経理 / 部長のように段ごとに操作者が変わるフローは、
  1 セッションでログインし直しながら進めると「誰の画面か」が証跡から読めなくなる。`playwright-cli -s=<role>` で
  ロールごとに名前付きセッションを開き、同じ月を並べて撮ると「同一状態でロールにより操作が違う」が 1 枚で示せる
- **ロール別ユーザーは admin のパスワード hash を複製して SQL で作る**: better-auth の
  ユーザー発行 UI（/admin/users）を playwright で回すより、`adachi.users` に INSERT +
  `adachi.accounts` に admin の credential 行から `password` を SELECT で複製する方が速く冪等にできる
  （seed ユーザーは全員 "password" なので hash 複製 = 同じパスワードでログイン可能）。
  `must_change_password = false` を明示しないと全ページが /password-setup に飛ぶ点に注意。
  レシピ: `~/.claude/tmp/seed-1011r.sql` のロールユーザー節（issue 1011 検証・2026-07-29）
- **fixture の `ledger_line_items` は `content_hash` NOT NULL（0041 以降）**: 旧 seed SQL
  （seed-992 等）を流用すると NOT NULL 違反で落ちる。行ごとに一意なダミー文字列で埋めれば十分
  （TS/SQL の md5 契約は照合 rewire 用で、fixture 表示・承認検証には効かない）
