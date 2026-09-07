# Bash / CLI Tips

> **TL;DR**: `bunx` / `npx` はバージョン固定（`bunx tool@1.2.3`）。`cd dir && cmd` は `mise exec --cd dir -- cmd` で代替（パーミッション回避）。`&&` / `||` 等の shell operator はプロンプトを誘発するため read-only パイプ（`rg | jq`）以外は避ける。

## `bunx <tool>`（npx 系）はバージョンを固定しないとリポと食い違う
<!-- importance: high | mentions: 1 | first-seen: 2026-06 -->

`bunx @biomejs/biome check` のようにバージョン無指定で実行すると、リポが依存している版とは別の版（古いキャッシュや latest）を引いてしまい、**設定ファイルのスキーマ不一致で落ちる**ことがある（例: biome 2.x の `includes` / `css.parser.tailwindDirectives` を 1.x が "unknown key" で拒否）。lint/format/codegen 系の CLI は、リポの `package.json` の版に合わせて `bunx @biomejs/biome@2.4.15 ...` のようにピン留めするか、リポに install 済みのバイナリを使う。

## macOS sed の落とし穴

macOS の標準 `sed` は GNU sed ではなく **BSD sed**（POSIX 準拠のみ）。

### `\b` word boundary は機能しない

**NG（macOS で動かない）**:
```bash
sed -i '' 's/FooSession\b/FooJob/g' file.ts
# → \b が文字通り解釈され、置換されないか誤置換する
```

**OK（2段階に分ける）**:
```bash
# 長いほうを先に置換し、短いほうを後から
sed -i.bak 's/FooSessionStore/FooJobStore/g; s/fooSessionStore/fooJobStore/g' file.ts
# 残った短いものを単純置換
sed -i.bak 's/FooSession/FooJob/g' file.ts
```

**OK（GNU sed を使う）**:
```bash
# Homebrew で入れた gsed なら \b が使える
gsed -i 's/FooSession\b/FooJob/g' file.ts
```

**OK（rg + edit で確認してから修正）**:
一括 sed より `rg` で置換候補を確認してから個別 Edit する方が安全。

### `-i` の挙動の違い

| | macOS BSD sed | GNU sed |
|---|---|---|
| in-place | `-i ''`（空文字必須） | `-i`（引数なし） |
| バックアップ | `-i.bak`（拡張子指定） | `-i.bak` or `-i.bak`（同じ） |

`sed -i.bak 's/.../.../' file` の形式は両方で動く（バックアップが `.bak` で残るので `rm *.bak` を忘れずに）。

## macOS には GNU `timeout` が標準で無い
<!-- importance: low | mentions: 1 | first-seen: 2026-09 -->

`timeout 15 <command>` は Linux では動くが、macOS では `zsh: command not found: timeout` で即座に失敗する（coreutils 由来のコマンドで、macOS の BSD ベースには含まれない）。ログの tail や監視用コマンドを短時間だけ流したいときは、`Bash` の `run_in_background: true` で起動し、必要な出力が出たら `TaskStop` で止める形にする。`brew install coreutils` を入れれば `gtimeout` として使えるが、環境に依存させない方が確実。

## Docker entrypoint で env を unset するときの罠

`RUN printf '#!/bin/sh\nunset VAR_A VAR_B ...\nexec "$@"\n'` のような entrypoint は、「何を無効化したいか」の目的が異なる変数を一行に混ぜると、後から変数を追加するときに意図しない unset を巻き込む。

**NG（目的が混在）**:
```sh
unset GIT_REPO_URL GIT_BRANCH GITHUB_APP_ID GIT_DIFF_BASE GIT_DIFF_HEAD
# → clone 無効化のために書いたのに、diff 計算用の SHA まで消えた
```

**OK（目的別にコメントで区別）**:
```sh
# disable git clone: use embedded repo instead
unset GIT_REPO_URL GIT_BRANCH GIT_CLONE_DIR GITHUB_APP_ID GITHUB_APP_PRIVATE_KEY GITHUB_APP_INSTALLATION_ID
# NOTE: GIT_DIFF_BASE / GIT_DIFF_HEAD はここに書かない — diff 計算用 SHA でクローン動作とは無関係
```

判断基準: *この変数を unset する目的は何か？* が変わるタイミングで行を分けるかコメントを入れる。
<!-- importance: medium | mentions: 1 | first-seen: 2026-05 -->

## ripgrep (rg) の使い方

`grep` の代わりに `rg` を使う。デフォルトで `.gitignore` を尊重し、バイナリを除外する。

```bash
# ファイルを横断して検索
rg 'FooSession' src/

# 行番号付き
rg -n 'FooSession' src/

# ファイル名のみ
rg -l 'FooSession' src/

# 大文字小文字無視
rg -i 'fooSession' src/
```

## 複合コマンドを避ける — `cd /path && cmd` の代替
<!-- importance: high | mentions: 1 | first-seen: 2026-06 -->

`&&`/`||`/`;` を含む複合コマンドはパーミッションプロンプトを誘発するので避ける（ポリシーは CLAUDE.md）。`cd /path && cmd` を使いたくなったときの代替:

- `cmd -C /path` / `cmd --cwd /path` など、作業ディレクトリを指定するフラグ（ツールが対応していれば）
- `jj diff -R /path` のようにリポジトリ/対象を指定するフラグを使う
- どうしても順次実行が必要なら、2回に分けて別々の Bash 呼び出しにする

## 破壊的操作（`rm -rf` 等）は絶対パスで書く
<!-- importance: high | mentions: 1 | first-seen: 2026-06 -->

`rm -rf "apps/adachi/app/(app)/dispatch"` のような相対パスは、Bash ツールの暗黙の作業ディレクトリが想定と異なるとサイレントに失敗し（no such file → エラーなし）ディレクトリが残る。破壊的なファイル操作は必ず絶対パスで書く。

**NG（相対パスは作業ディレクトリ依存で誤作動しやすい）**:
```bash
rm -rf "apps/adachi/app/(app)/dispatch"
# → Bash ツールの cwd がルートでなければ見つからずサイレント失敗
```

**OK（絶対パスで確実に指定）**:
```bash
rm -rf "/Users/pomesaka/.local/share/claude-deck/workspace/-Users.../apps/adachi/app/(app)/dispatch"
```

削除後は `ls <パス> 2>/dev/null && echo EXISTS || echo DELETED` で確認する。
