# publish-guard

Claudeが公開のリポジトリへpushする前に、そのリポジトリのチェックを走らせて、出してはいけない文字列があればpushを実行させないMod。

## 仕組み

BashのコマンドをModが読み、`jj git push`か`git push`が入っていれば、実行の前に次の順で調べる。

1. 作業ディレクトリが入っているリポジトリの直下を、`jj root`（だめなら`git rev-parse --show-toplevel`）で探す
2. そこに`scripts/check-public.sh`があれば、行き先のリモートの名前を渡して実行する
3. 終了コードが0でなければ、pushを拒む。スクリプトの出力は、拒んだ理由としてClaudeに渡る

| 場合 | 動き |
|---|---|
| pushでないコマンド | 何もしない |
| リポジトリに`scripts/check-public.sh`が無い | 何もしない。守るのは、このスクリプトを置いたリポジトリだけ |
| 行き先のリモートの名前が`private`で始まる | 調べずに通す。バックアップ用の非公開のリポジトリを想定している |
| スクリプトを実行できない（時間切れなど） | pushを拒む。調べられなかったことを「問題なし」と読まない |

何を調べるかは、リポジトリの側の`scripts/check-public.sh`が決める。Modの中に規則を持たないのは、手でpushする前にも同じスクリプトを走らせるからだ。dotclaudeのスクリプトは、リモートにまだ無いコミットの差分、メッセージ、作者のメールアドレスから、`.private-names`に書いた名前と、鍵やトークンの形の文字列を探す。

## 守れないもの

- **ターミナルから手で打つpush。** jjはgitのpre-push hookを実行しないので、手で打つ前に`scripts/check-public.sh`を自分で走らせる
- **素の形でないpush。** コマンドは`&&`や`;`で分けて先頭の語を見るだけで、引用符や`$()`の中までは追わない

## 開発

```bash
claude plugin validate mods/publish-guard
claude plugin test mods/publish-guard
```
