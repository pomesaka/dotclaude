# Bash / CLI Tips

> **TL;DR**: Bash ツールでコマンドを組むときに踏んだ罠。`bunx` / `npx` は版を固定する。`cd dir && cmd` は `-C` / `--cwd` / `-R` のような作業ディレクトリの指定か、2 回の呼び出しに分ける。破壊的な操作は絶対パスで書く。

整理する前の版は `archive/2026-11-16/docs/bash-tips.md` にある。

## `bunx <tool>`（npx 系）はバージョンを固定しないとリポと食い違う

`bunx @biomejs/biome check` のようにバージョン無指定で実行すると、リポが依存している版とは別の版（古いキャッシュや latest）を引いてしまい、設定ファイルのスキーマ不一致で落ちることがある（例: biome 2.x の `includes` / `css.parser.tailwindDirectives` を 1.x が "unknown key" で拒否）。lint/format/codegen 系の CLI は、リポの `package.json` の版に合わせて `bunx @biomejs/biome@2.4.15 ...` のようにピン留めするか、リポに install 済みのバイナリを使う。

## macOS のコマンドの違い

- macOS の `sed` は BSD sed。`\b` は効かず、`-i` は拡張子の引数が要る（`sed -i.bak` なら GNU sed でも動く）。一括の sed より、`rg` で候補を確かめてから Edit で直すほうが確実
- macOS には `timeout` が無い（`zsh: command not found: timeout`）。ログの tail や監視のコマンドを短い時間だけ流したいときは、`Bash` の `run_in_background: true` で起動し、必要な出力が出たら `TaskStop` で止める

## マークダウン本文を heredoc で書き出すときは、終端を引用符で囲む

`<<EOF`（引用符なし）の heredoc は、中身のバックティックと `$(` をシェルが展開する。PR 本文や Python スクリプトの中にインラインコード（`` `functionName` ``）を書くと、それがコマンドとして実行され、`command not found` が出て本文が欠ける。中身に `` ` ``・`$(`・`$VAR` が入るなら `<<'EOF'` にする。マークダウンのインラインコードは、ほぼこれに当たる。

## Docker entrypoint で env を unset するときは、目的ごとに行を分ける

`unset VAR_A VAR_B ...` の 1 行に目的の違う変数を混ぜると、後から変数を足すときに意図しない unset を巻き込む（clone を無効にするための行に、diff の計算に使う SHA の変数まで入っていた）。目的が変わるところで行を分けるか、コメントを入れる。

## 複合コマンドを避ける — `cd /path && cmd` の代替

`&&`/`||`/`;` を含む複合コマンドはパーミッションプロンプトを誘発するので避ける（ポリシーは CLAUDE.md）。`cd /path && cmd` を使いたくなったときの代替は次のとおり。

- `cmd -C /path` / `cmd --cwd /path` など、作業ディレクトリを指定するフラグ（ツールが対応していれば）
- `jj diff -R /path` のようにリポジトリ/対象を指定するフラグを使う
- どうしても順次実行が必要なら、2回に分けて別々の Bash 呼び出しにする

## auto-mode classifier に拒否されたコマンドは、ユーザーに `! <コマンド>` で実行してもらう

「permission rule を足して再試行」を選択肢に出さない。拒否を解くために自分で `settings.local.json` に allow を書く操作は、それ自体が「[Auto-Mode Bypass]」として拒否される（classifier は自分の判定を迂回する設定変更をさせない）。選択肢に出すとユーザーが選んだ後で詰まり、確認が 1 往復無駄になる。拒否されたら、そのままコピペできる完全なコマンド（`EDITOR=true` 等の前置も込み）を提示して `!` での実行を頼み、実行後の検証から引き継ぐ。

## 破壊的操作（`rm -rf` 等）は絶対パスで書く

`rm -rf "apps/acme/app/(app)/dispatch"` のような相対パスは、Bash ツールの作業ディレクトリが想定と違うと、対象が見つからないままエラーも出ずに終わり、ディレクトリが残る。破壊的なファイル操作は `rm -rf "<絶対パス>/apps/acme/app/(app)/dispatch"` のように絶対パスで書く。

## 自分で名前を決めていないパスは、`-` で始まると考えて `--` か `./` を付ける

`ls`、`rm`、`cp`、`jq` は、`-` で始まる引数をオプションとして読む。Claude Code の会話の記録のフォルダ（`-Users-...`）のように、パスの `/` を `-` に替えた名前は `-` で始まる。glob で展開した名前を渡した `ls -d *x*` は `unrecognized option` で止まり（macOS の `ls`）、`jq -r '.type' "$f"` は使い方の表示を出した（jq 1.7、2026-11に確認）。glob や変数で渡すパスには、`ls -d -- *x*` のように `--` を置くか、`./"$f"` と `./` を付ける。`--` を受け付けないコマンドもあるので、迷ったら `./` を付ける。

## 日本語の文書を Edit するとき

Edit の `old_string` はバイト列の完全一致で照合される。全角の括弧・全角の空白・ダッシュ類・引用符は、見た目が同じでも別の文字なので、これらを含まない範囲を `old_string` に選ぶと一致の失敗が減る。

## シェルスクリプトで、変数のすぐ後ろにASCIIでない文字を置くときは`${var}`で囲む

`"$modeを止める"`や`"$name（…）"`と書くと、全角の文字のバイトが変数名の一部として読まれ、`set -u`では`unbound variable`で止まる（macOSの`/bin/sh`と`/bin/bash`、bash 3.2.57、2026-11に確認）。かなや漢字だけでなく、全角の括弧や記号でも起きる。`"${mode}を止める"`のように、書く時点で囲む。判断基準は「変数の直後の文字がASCIIか」で、ASCIIでなければ囲む。

## Bash ツールで並びをループに回すときは、配列で書く

Bash ツールのコマンドは利用者のシェル（zsh）で動く。zsh は引用していない変数を単語に分けないので、`S="a b c"; for s in $S` は `"a b c"` の 1 語で 1 回だけ回る（zsh 5.9、2026-11に確認）。並びは `S=(a b c)` と `"${S[@]}"` で書く。sh や bash の書き方を写すなら、スクリプトのファイルに書いて `sh <ファイル>` で走らせる。判断基準は「このコマンドを読むシェルは、引用していない変数を単語に分けるか」。

## 一時スクリプトは、ワークスペースのルートで走らせない

Playwrightなどの一時スクリプトをワークスペースのルートで`bun run`すると、スクリプトの`import`が解決できず、`bun add playwright`が要ることになり、`package.json`が書き換わる。一時スクリプトはscratchpadに置いて`bun /path/to/script.mjs`か`node /path/to/script.mjs`で走らせる。bunで依存が要るなら、scratchpadに`package.json`（`{"name":"tmp","type":"module"}`）を作り、そこで`bun add`する。
