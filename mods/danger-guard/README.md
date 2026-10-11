# danger-guard

ClaudeがBashでコマンドを実行する前に、マシンや利用者のデータを広く壊しうる呼び出しを見つけて、実行させないMod。

きっかけは、別のセッションが`pkill -f "cat"`を実行して、`/Applications`の下のアプリを全部止めたこと（2026-10-11）。`-f`はコマンドラインのどこかに語を含むプロセスを止める。`/Applications/`は「Appli**cat**ions」の形で`cat`を含む。ターミナルも止まり、その中の`caffeinate`も終わって、Macがスリープした。

見るのは、作業中のリポジトリの外まで壊すものだけ。リポジトリの中の操作（`git reset --hard`、`jj abandon`、ファイルの削除）は見ない。

**禁止する形を並べる方式なので、全部は防げない。** よくある事故の形を止めるもので、下の「止められないもの」が残る。バックアップと、Claude Codeの権限の設定の代わりにはならない。

## 読み込み

マーケットプレイス`dotclaude`から入れる。手順は`mods/README.md`にある。

## 止めるもの

| 種類 | 例 |
|---|---|
| 管理者や別の利用者としての実行 | `sudo …`、`doas …`、`su -`。中身に関係なく止める |
| 広い場所の再帰的な削除 | `rm -rf /`、`rm -rf ~`、`rm -rf ~/Documents`、`rm -rf ~/.claude/projects`、`rm -rf ./*`、`rm -rf .git` |
| 大事なファイルの削除と上書き | `rm ~/.zshrc`、`rm ~/.ssh/id_ed25519`、`rm ~/*`、`echo x > ~/.zshrc` |
| 広い場所を移す、同期で消す | `mv ~/Documents /tmp/x`、`rsync -a --delete empty/ ~/` |
| 広い場所を起点にした`find`の削除 | `find ~ -name "*.log" -delete`、`find / -exec rm {} +` |
| 広い場所の権限や所有者の再帰的な変更 | `chmod -R 777 ~` |
| 別のリポジトリの削除 | `rm -rf ~/github.com/owner/other`（調べてから決める。下の節） |
| ディスクやデバイスへの書き込み | `dd of=/dev/disk2`、`> /dev/rdisk3`、`diskutil eraseDisk`、`newfs_apfs` |
| 電源とログインのセッション | `shutdown`、`reboot`、`launchctl bootout gui/502`、ログアウトする`osascript` |
| 利用者のアプリの終了 | `osascript -e 'quit app "Slack"'` |
| 全プロセスの停止 | `kill -9 -1`、フォーク爆弾 |
| 利用者のアプリを巻き込むプロセスの停止 | `pkill -f "cat"`、`pkill -u me`、`killall Dock`、`kill $(lsof -ti:3000)`（数えてから決める。下の節） |
| ほかのセッションを載せているtmux | `tmux kill-server`、`tmux kill-session -a`、利用者がつないでいるセッションの`kill-session -t` |
| 予定した仕事の全消去 | `crontab -r` |
| GitHubのリポジトリの削除 | `gh repo delete` |

`timeout 5 rm -rf ~`や`env -i rm -rf ~`のように、別のコマンドで包んでも読む。`sh -c "…"`と`eval "…"`に直接書いた文字列も読む。

### 広い場所

再帰的な削除、移動、権限の変更は、対象が次のどれかなら止める。

- ディスクの根（`/`）と、その直下（`/Users`、`/Applications`、`/tmp`など）
- OSのディレクトリ（`/usr/local`、`/opt/homebrew`、`/private/tmp`など）
- ホーム、ホームを含むディレクトリ、ホームの2段めまで（`~/Documents`、`~/.ssh`、`~/github.com/owner`、`~/.claude/projects`など）
- `~/Library`、`~/.local`、`~/.config`の下は3段めまで（アプリや道具がデータを置く）
- セッションの作業ディレクトリと、それを含むディレクトリ
- 作業ディレクトリか、それを含むディレクトリにある`.git`と`.jj`

作業ディレクトリの中は、自分の作業の場所として止めない（履歴を除く）。

道筋は、`~`と`$HOME`をホームに読み替え、相対の道筋は作業ディレクトリから読む。コマンドの中の`cd`を追うので、`cd ~ && rm -rf Documents`も止まる。末尾が`*`なら、その親の中身の全部として読む。`*.log`のような一部のglobは、作業ディレクトリの中では止めない。

### 大事なファイル

再帰でない`rm`と、上書きのリダイレクト（`>`）は、対象が次のどちらかなら止める。追記（`>>`）は止めない。

- ホームの直下のファイル（`~/.zshrc`、`~/.gitconfig`など）
- 鍵や認証の情報を置くディレクトリの中（`~/.ssh`、`~/.gnupg`、`~/.aws`、`~/.kube`、`~/.docker`、`~/.config/gh`、`~/Library/Keychains`）

### 調べてから決めるもの

次の3つは、コマンドの文字だけでは決められないので、実行する前に相手を調べる。

| 呼び出し | 調べること | 止める条件 |
|---|---|---|
| `pkill`、`killall`、`pgrep`や`lsof -t`の結果を`kill`に渡す形 | 同じ条件で`pgrep`か`lsof`を呼び、止まるプロセスを数える | 利用者のアプリ（`/Applications`、`/System`、`~/Applications`の下）、OSの常駐プログラム、`tmux`、ほかの`claude`が含まれる。または31個以上に一致する |
| `tmux kill-session -t`、`kill-window -t`、`kill-pane -t` | そのセッションにクライアントがつないでいるか | つないでいる（利用者が使っている） |
| 作業ディレクトリの外で、一時的な場所でもないディレクトリの`rm -r` | そこに`.git`か`.jj`があるか | ある（別のリポジトリ） |

`pkill`を語の長さで決めないのは、短くても安全な語（自分で立てたスクリプトの名前）があり、長くても危ない語があるからだ。

調べ損ねたとき（時間切れなど）は通す。このhookはすべてのBashを通るので、読み損ねただけでコマンドを止めない。

## 止められないもの

実行する前に読めないもの。

- **変数が入った道筋や語。** `rm -rf "$DIR/"`は、`$DIR`が空だと根を消すが、止められない。読めない行き先への`cd`の後の、相対の道筋も同じ
- スクリプトのファイルの中身（`bash cleanup.sh`）
- ほかの言語の1行（`python -c "shutil.rmtree(…)"`、`node -e`）
- パイプで渡される対象（`fd . ~ | xargs rm -rf`）
- ヒアドキュメントの中身。ファイルに書く文章として読み飛ばす（シェルに渡すものは読む）
- Bash以外の道具。WriteやEditで`~/.zshrc`を上書きするのは、このModを通らない

対象にしていないもの。

- リモートやクラウドの削除（`git push --force`、`aws s3 rm --recursive`、`terraform destroy`、`kubectl delete`）。`gh repo delete`だけは止める
- データベース（`dropdb`、`DROP DATABASE`、`redis-cli FLUSHALL`）
- コンテナと仮想マシン（`docker system prune -a --volumes`、`podman machine rm`）
- 入れてある道具の削除（`brew uninstall --force`、`mise uninstall`）
- OSの設定と鍵（`defaults delete`、`tccutil reset All`、`security delete-keychain`）
- ディスクを埋める、暴走させる（`yes > big.txt`、終わらないループ）

外への操作は、壊れる範囲でなく、取り消せるかで決まる。Claude Codeの確認の仕組みと役割が重なるので、ここでは扱っていない。

## 止められたとき

止めたコマンドを利用者が本当に実行したいときは、`! <コマンド>`で自分で実行する。Modは、Claudeに、迂回せずそう頼むよう伝える。

## 開発

```bash
claude plugin validate mods/danger-guard
claude plugin test mods/danger-guard
```
