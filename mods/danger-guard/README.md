# danger-guard

ClaudeがBashでコマンドを実行する前に、マシンや利用者のデータを広く壊しうる呼び出しを見つけて、実行させないMod。

きっかけは、別のセッションが`pkill -f "cat"`を実行して、`/Applications`の下のアプリを全部止めたこと（2026-10-11）。`-f`はコマンドラインのどこかに語を含むプロセスを止める。`/Applications/`は「Appli**cat**ions」の形で`cat`を含む。ターミナルも止まり、その中の`caffeinate`も終わって、Macがスリープした。

見るのは、作業中のリポジトリの外まで壊すものだけ。リポジトリの中の操作（`git reset --hard`、`jj abandon`、ファイルの削除）は見ない。

## 読み込み

マーケットプレイス`dotclaude`から入れる。手順は`mods/README.md`にある。

## 止めるもの

| 種類 | 例 |
|---|---|
| 広い場所の再帰的な削除 | `rm -rf /`、`rm -rf ~`、`rm -rf ~/Documents`、`rm -rf ./*`、`rm -rf .git` |
| 広い場所を起点にした`find`の削除 | `find ~ -name "*.log" -delete`、`find / -exec rm {} +` |
| 広い場所の権限や所有者の再帰的な変更 | `chmod -R 777 ~`、`chown -R me /` |
| ディスクやデバイスへの書き込み | `dd of=/dev/disk2`、`> /dev/rdisk3`、`diskutil eraseDisk`、`newfs_apfs` |
| 電源とログインのセッション | `shutdown`、`reboot`、`launchctl bootout gui/502`、ログアウトする`osascript` |
| 全プロセスの停止 | `kill -9 -1`、`:(){ :\|:& };:` |
| ほかのセッションを載せているtmux | `tmux kill-server`、`tmux kill-session -a` |
| 予定した仕事の全消去 | `crontab -r` |
| 利用者のアプリを巻き込むプロセスの停止 | `pkill -f "cat"`、`pkill -f "Google Chrome"`、`killall Dock`（下の節） |

### 広い場所

再帰的な削除と権限の変更は、対象が次のどれかなら止める。

- ディスクの根（`/`）と、その直下（`/Users`、`/Applications`、`/tmp`など）
- OSのディレクトリ（`/usr/local`、`/opt/homebrew`、`/private/tmp`など）
- ホーム、ホームを含むディレクトリ、ホームの直下（`~/Documents`、`~/.ssh`、`~/github.com`など）
- セッションの作業ディレクトリと、それを含むディレクトリ
- 作業ディレクトリのリポジトリの`.git`と`.jj`

道筋は、`~`と`$HOME`をホームに読み替え、相対の道筋は作業ディレクトリから読む。コマンドの中の`cd`を追うので、`cd ~ && rm -rf Documents`も止まる。末尾が`*`なら、その親の中身の全部として読む。`*.log`のような一部のglobは、作業ディレクトリの中では止めない。

### プロセスの停止は、数えてから決める

`pkill`、`killall`、`pgrep`の結果を`kill`に渡す形（`pgrep -f x | xargs kill`、`kill $(pgrep -f x)`）は、実行する前に、同じ条件で`pgrep`を呼んで、止まるプロセスを数える。次のどちらかなら止め、巻き込まれるプロセスを理由に並べる。

- 利用者のアプリ（`/Applications`、`/System`、`~/Applications`の下）、OSの常駐プログラム、`tmux`、ほかの`claude`が含まれる
- 31個以上に一致する

語の長さでは決めない。短くても安全な語（自分で立てたスクリプトの名前）があり、長くても危ない語があるからだ。

## 止めないもの

- 変数が入っていて、実行する前に読めない道筋や語（`rm -rf "$DIR"`、`pkill -f "$NAME"`）。**`$DIR`が空なら`rm -rf "$DIR/"`は根を消すが、これは止められない**
- 読めない行き先への`cd`の後の、相対の道筋
- シェルのスクリプトのファイルの中身（`bash cleanup.sh`）。`sh -c "…"`と`eval "…"`に直接書いた文字列は読む
- 調べ損ねたとき（`pgrep`の時間切れなど）。このhookはすべてのBashを通るので、読み損ねただけでコマンドを止めない

止められたコマンドを利用者が本当に実行したいときは、`! <コマンド>`で自分で実行する。Modは、Claudeに、迂回せずそう頼むよう伝える。

## 開発

```bash
claude plugin validate mods/danger-guard
claude plugin test mods/danger-guard
```
