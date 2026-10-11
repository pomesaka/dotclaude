import { expect, test } from 'claude-code/testing'
import { commandLinesOf, dangersOf, isProtected, type Danger } from '../hooks/danger'
import { segmentsOf, withoutHeredocs } from '../hooks/shell'

// セッションの作業ディレクトリと、利用者のホーム
const PLACE = { cwd: '/Users/p/github.com/o/app', home: '/Users/p' }

const SEGMENTS: { name: string; command: string; segments: string[][] }[] = [
  { name: '空白で語に分ける', command: 'pkill -f cat', segments: [['pkill', '-f', 'cat']] },
  { name: '引用符の中の空白は、語を分けない', command: 'pkill -f "bun test"', segments: [['pkill', '-f', 'bun test']] },
  { name: '; と && で分ける', command: 'pkill -f "cat" 2>/dev/null; cd /tmp && ls', segments: [['pkill', '-f', 'cat', '2>/dev/null'], ['cd', '/tmp'], ['ls']] },
  { name: 'パイプで分ける', command: 'pgrep -f cat | xargs kill', segments: [['pgrep', '-f', 'cat'], ['xargs', 'kill']] },
  { name: '$( ) の中も分ける', command: 'kill $(pgrep -f cat)', segments: [['kill'], ['pgrep', '-f', 'cat']] },
  { name: '引用符の中の区切りは、分けない', command: "pkill -f 'a;b|c'", segments: [['pkill', '-f', 'a;b|c']] },
  { name: '空の引用符も 1 語', command: 'pkill -f ""', segments: [['pkill', '-f', '']] },
]

for (const one of SEGMENTS) {
  test(`segmentsOf: ${one.name}`, async () => {
    expect(segmentsOf(one.command)).toEqual(one.segments)
  })
}

const HEREDOCS: { name: string; command: string; kept: string }[] = [
  { name: 'ファイルに書く中身は除く', command: "cat > a.md <<'EOF'\nrm -rf /\nEOF\nls", kept: "cat > a.md <<'EOF'\nls" },
  { name: 'ほかの言語のスクリプトも除く', command: 'python3 - <<PY\nimport os\nPY', kept: 'python3 - <<PY' },
  { name: '字下げを許す形（<<-）', command: 'cat <<-EOF\n\ttext\n\tEOF\nls', kept: 'cat <<-EOF\nls' },
  { name: 'シェルに渡す中身は残す', command: 'bash <<EOF\nrm -rf /\nEOF', kept: 'bash <<EOF\nrm -rf /\nEOF' },
  { name: 'ヒアドキュメントが無ければ、そのまま', command: 'ls\npwd', kept: 'ls\npwd' },
]

for (const one of HEREDOCS) {
  test(`withoutHeredocs: ${one.name}`, async () => {
    expect(withoutHeredocs(one.command)).toBe(one.kept)
  })
}

// 実行させないコマンド。why は、理由に入る語
const DENIED: { name: string; command: string; why: string }[] = [
  { name: 'ディスクの根を消す', command: 'rm -rf /', why: 'recursively delete the root of the disk' },
  { name: '根の中身を全部消す', command: 'rm -rf /*', why: 'everything matching "*" in the root of the disk' },
  { name: 'ホームを消す', command: 'rm -rf ~', why: 'recursively delete your home directory' },
  { name: '$HOME で書いたホーム', command: 'rm -rf "$HOME"', why: 'recursively delete your home directory' },
  { name: 'ホームの中身を全部消す', command: 'rm -rf ~/*', why: 'everything matching "*" in your home directory' },
  { name: 'ホームの直下を glob で消す', command: 'rm -rf ~/D*', why: 'everything matching "D*" in your home directory' },
  { name: 'ホームの直下のディレクトリ', command: 'rm -rf ~/Documents', why: 'a top-level entry of your home (/Users/p/Documents)' },
  { name: 'ホームの 2 段めのディレクトリ', command: 'rm -rf ~/.claude/projects', why: 'a second-level directory of your home (/Users/p/.claude/projects)' },
  { name: 'アプリがデータを置くディレクトリ', command: 'rm -rf "$HOME/Library/Application Support/Slack"', why: 'a directory where applications keep their data (/Users/p/Library/Application Support/Slack)' },
  { name: 'ホームを含むディレクトリ', command: 'rm -rf /Users', why: 'a top-level directory (/Users)' },
  { name: '指定を分けて書いても同じ', command: 'rm -r -f /usr/local', why: 'a system directory (/usr/local)' },
  { name: '長い指定', command: 'rm --recursive --force /Applications', why: 'a top-level directory (/Applications)' },
  { name: '作業ディレクトリそのもの', command: 'rm -rf .', why: 'the working directory of this session' },
  { name: '作業ディレクトリの中身の全部', command: 'rm -rf ./*', why: 'everything matching "*" in the working directory of this session' },
  { name: '作業ディレクトリの親', command: 'rm -rf ..', why: 'a second-level directory of your home (/Users/p/github.com/o)' },
  { name: 'リポジトリの履歴', command: 'rm -rf .git', why: "the repository's history (/Users/p/github.com/o/app/.git)" },
  { name: 'cd の後は、移った先から読む', command: 'cd ~ && rm -rf Documents', why: 'a top-level entry of your home (/Users/p/Documents)' },
  { name: 'timeout を挟んでも読む', command: 'timeout 5 rm -rf ~', why: 'recursively delete your home directory' },
  { name: 'env と指定を挟んでも読む', command: 'env -i A=1 rm -rf ~', why: 'recursively delete your home directory' },
  { name: 'nice と値を挟んでも読む', command: 'nice -n 10 rm -rf ~', why: 'recursively delete your home directory' },
  { name: 'sh -c の中も読む', command: 'sh -c "rm -rf ~"', why: 'recursively delete your home directory' },
  { name: '後ろに続くコマンドの中にあっても読む', command: 'ls; rm -rf / 2>/dev/null', why: 'recursively delete the root of the disk' },
  { name: 'ホームの直下のファイルを消す', command: 'rm ~/.zshrc', why: 'delete a file at the top of your home (/Users/p/.zshrc)' },
  { name: 'ホームの直下のファイルを glob で消す', command: 'rm -f ~/*', why: 'delete a file at the top of your home' },
  { name: '鍵を消す', command: 'rm ~/.ssh/id_ed25519', why: 'delete credentials (/Users/p/.ssh/id_ed25519)' },
  { name: 'ホームの直下のファイルを上書きする', command: 'echo "x" > ~/.zshrc', why: 'the redirect would overwrite a file at the top of your home (/Users/p/.zshrc)' },
  { name: '広い場所を移す', command: 'mv ~/Documents /tmp/x', why: 'move a top-level entry of your home (/Users/p/Documents) away' },
  { name: 'rsync で、広い場所から余分を消す', command: 'rsync -a --delete empty/ ~/', why: 'rsync --delete would remove whatever the source lacks from your home directory' },
  { name: 'find でホームの下を消す', command: 'find ~ -name "*.log" -delete', why: 'find would delete files under your home directory' },
  { name: 'find から rm を呼ぶ', command: 'find / -type f -exec rm {} +', why: 'find would delete files under the root of the disk' },
  { name: 'ホームの権限を再帰的に変える', command: 'chmod -R 777 ~', why: 'change permissions or ownership recursively on your home directory' },
  { name: '管理者として実行する', command: 'sudo ls /var/root', why: 'running as root or as another user' },
  { name: '指定の付いた sudo', command: 'sudo -u nobody rm -rf /tmp/x', why: 'running as root or as another user' },
  { name: '別の利用者になる', command: 'su - admin', why: 'running as root or as another user' },
  { name: 'dd でディスクに書く', command: 'dd if=/dev/zero of=/dev/disk2 bs=1m', why: 'dd would overwrite a device (/dev/disk2)' },
  { name: 'リダイレクトでディスクに書く', command: 'cat image.iso > /dev/rdisk3', why: 'writes straight to a device (/dev/rdisk3)' },
  { name: 'ディスクを消す', command: 'diskutil eraseDisk APFS X disk2', why: 'diskutil eraseDisk APFS erases a disk or a volume' },
  { name: 'APFS のボリュームを消す', command: 'diskutil apfs deleteVolume disk3s5', why: 'diskutil apfs deleteVolume erases a disk or a volume' },
  { name: 'ファイルシステムを作り直す', command: 'newfs_apfs /dev/disk2s1', why: 'newfs_apfs formats a filesystem' },
  { name: '電源を切る', command: 'shutdown -h now', why: 'shutdown stops the machine' },
  { name: '再起動する', command: 'reboot', why: 'reboot stops the machine' },
  { name: 'ログインのセッションを終わらせる', command: 'launchctl bootout gui/502', why: 'launchctl bootout gui/502 ends the whole login session' },
  { name: 'スクリプトでログアウトする', command: 'osascript -e \'tell application "System Events" to log out\'', why: 'shuts down, restarts or logs out' },
  { name: 'スクリプトでアプリを終了させる', command: 'osascript -e \'quit app "Slack"\'', why: "the script quits the user's applications" },
  { name: '予定した仕事を全部消す', command: 'crontab -r', why: 'crontab -r removes every scheduled job' },
  { name: 'GitHub のリポジトリを消す', command: 'gh repo delete o/app --yes', why: 'gh repo delete removes the repository from GitHub' },
  { name: 'tmux のサーバーを止める', command: 'tmux kill-server', why: 'ends tmux sessions other than the one you started' },
  { name: 'tmux のほかのセッションを全部止める', command: 'tmux kill-session -a', why: 'ends tmux sessions other than the one you started' },
  { name: '相手を指定せずに tmux のセッションを止める', command: 'tmux kill-session', why: 'ends tmux sessions other than the one you started' },
  { name: '自分の全プロセスを止める', command: 'kill -9 -1', why: 'signals every process the user owns' },
  { name: '-- の後ろの -1 も同じ', command: 'kill -- -1', why: 'signals every process the user owns' },
  { name: 'プロセスを増やし続ける', command: ':(){ :|:& };:', why: 'it is a fork bomb' },
]

for (const one of DENIED) {
  test(`止める: ${one.name}`, async () => {
    const dangers = dangersOf(one.command, PLACE)
    expect(dangers.length).toBe(1)
    const danger = dangers[0]
    expect(danger?.kind).toBe('deny')
    expect(danger?.kind === 'deny' ? danger.why : '').toContain(one.why)
  })
}

test('作業ディレクトリが深い場所でも、それを含むディレクトリと、上にある履歴を守る', async () => {
  const deep = { cwd: '/Users/p/github.com/o/app/packages/web', home: '/Users/p' }
  const parent = dangersOf('rm -rf ..', deep)[0]
  expect(parent?.kind === 'deny' ? parent.why : '').toContain('a directory that contains the working directory (/Users/p/github.com/o/app/packages)')
  const history = dangersOf('rm -rf ../../.jj', deep)[0]
  expect(history?.kind === 'deny' ? history.why : '').toContain("the repository's history (/Users/p/github.com/o/app/.jj)")
})

// 通すコマンド
const ALLOWED: { name: string; command: string }[] = [
  { name: '作業ディレクトリの中のディレクトリ', command: 'rm -rf node_modules dist' },
  { name: '作業ディレクトリの中の、一部の glob', command: 'rm -rf *.log build/*' },
  { name: '作業ディレクトリの中のファイル', command: 'rm notes.txt src/old.ts' },
  { name: '一時ディレクトリの中', command: 'rm -rf /private/tmp/claude-502/x/scratchpad/probe' },
  { name: '変数が入っていて読めない道筋', command: 'rm -rf "$S/parts"' },
  { name: '読めない cd の後の相対の道筋', command: 'cd "$S" && rm -rf .' },
  { name: '一時ディレクトリへ移ってから、その中身を消す', command: 'cd /private/tmp/x/work && rm -rf ./*' },
  { name: '作業ディレクトリの中を find で消す', command: 'find . -name "*.tmp" -delete' },
  { name: '消さない find', command: 'find ~ -name "*.log"' },
  { name: '作業ディレクトリの中の権限', command: 'chmod -R u+w dist' },
  { name: '再帰でない権限の変更', command: 'chmod +x ~/bin' },
  { name: '作業ディレクトリの中の移動', command: 'mv a.txt src/b.txt' },
  { name: '広い場所へ移すだけ', command: 'mv report.pdf ~/Desktop' },
  { name: '作業ディレクトリの中の rsync', command: 'rsync -a --delete src/ dist/' },
  { name: 'ほかのマシンへの rsync', command: 'rsync -a --delete dist/ host:/srv/app/' },
  { name: 'ホームの直下のファイルへの追記', command: 'echo "x" >> ~/.zshrc' },
  { name: '作業ディレクトリの中への上書き', command: 'echo "x" > out.txt 2>&1' },
  { name: 'ファイルへ書く dd', command: 'dd if=/dev/zero of=./blank.img bs=1m count=10' },
  { name: '捨てる先へのリダイレクト', command: 'ls > /dev/null 2>&1' },
  { name: '調べるだけの diskutil', command: 'diskutil list' },
  { name: '消さない gh', command: 'gh repo view o/app' },
  { name: '閉じない tmux', command: 'tmux new-session -d -s probe' },
  { name: 'timeout を挟んだ、危険でないコマンド', command: 'timeout 60 bun test' },
  { name: 'PID を指定した kill', command: 'kill -9 1234' },
  { name: 'kill -1 <PID> は、その PID への SIGHUP', command: 'kill -1 1234' },
  { name: '調べるだけの pgrep', command: 'pgrep -fl cat' },
  { name: '調べるだけの lsof', command: 'lsof -ti:3000' },
  { name: '変数が入った語の pkill は、確かめられないので数えない', command: 'pkill -f "$NAME"' },
  { name: '文字列の中に書いただけ', command: 'echo "rm -rf /" | rg rm' },
  { name: 'ヒアドキュメントに書いただけ', command: "cat > notes.md <<'EOF'\nrm -rf /\nsudo reboot\nEOF" },
  { name: 'プロセスを止めないコマンド', command: 'cat a.txt | rg kill' },
]

for (const one of ALLOWED) {
  test(`通す: ${one.name}`, async () => {
    expect(dangersOf(one.command, PLACE)).toEqual([])
  })
}

// 何が止まるかを数えてから決める呼び出し。argv は、止まるプロセスの PID を出すコマンド
const MATCHES: { name: string; command: string; argv: string[][] }[] = [
  { name: 'pkill -f', command: 'pkill -f "cat"', argv: [['pgrep', '-f', '--', 'cat']] },
  { name: '名前で止める pkill', command: 'pkill node', argv: [['pgrep', '--', 'node']] },
  { name: 'シグナルの指定は落とす', command: 'pkill -INT -f "vite dev"', argv: [['pgrep', '-f', '--', 'vite dev']] },
  { name: '数字のシグナルも落とす', command: 'pkill -9 -f server.ts', argv: [['pgrep', '-f', '--', 'server.ts']] },
  { name: '値を取る指定は、値と一緒に残す', command: 'pkill -u pomesaka -f x.sh', argv: [['pgrep', '-u', 'pomesaka', '-f', '--', 'x.sh']] },
  { name: '語が無くても、利用者で絞っていれば数える', command: 'pkill -u pomesaka', argv: [['pgrep', '-u', 'pomesaka']] },
  { name: 'まとめて書いた指定から、一覧の指定だけを落とす', command: 'pkill -fl x.sh', argv: [['pgrep', '-f', '--', 'x.sh']] },
  { name: '後ろに続くコマンドは読まない', command: 'pkill -f "cat" 2>/dev/null; cd /tmp', argv: [['pgrep', '-f', '--', 'cat']] },
  { name: 'timeout を挟んだ pkill', command: 'timeout 5 pkill -f cat', argv: [['pgrep', '-f', '--', 'cat']] },
  { name: 'pgrep の結果を kill に渡す', command: 'pgrep -f cat | xargs kill -9', argv: [['pgrep', '-f', '--', 'cat']] },
  { name: 'kill に pgrep の結果を埋める', command: 'kill $(pgrep -f cat)', argv: [['pgrep', '-f', '--', 'cat']] },
  { name: 'ポートを使っているものを止める', command: 'kill $(lsof -ti:3000)', argv: [['lsof', '-ti:3000']] },
  { name: 'lsof の結果を kill に渡す', command: 'lsof -t -i :3000 | xargs kill -9', argv: [['lsof', '-t', '-i', ':3000']] },
  { name: 'killall は、名前ごとに、ちょうど一致するものを数える', command: 'killall -9 Dock Finder', argv: [['pgrep', '-x', '--', 'Dock'], ['pgrep', '-x', '--', 'Finder']] },
  { name: '名前の無い killall -u は、その利用者の全部', command: 'killall -u pomesaka', argv: [['pgrep', '-u', 'pomesaka']] },
]

for (const one of MATCHES) {
  test(`数える: ${one.name}`, async () => {
    const dangers = dangersOf(one.command, PLACE)
    expect(dangers.map(danger => danger.kind)).toEqual(one.argv.map(() => 'match'))
    expect(dangers.map(danger => (danger.kind === 'match' ? danger.argv : []))).toEqual(one.argv)
  })
}

// 実行する前に、相手を調べてから決める呼び出し
const CHECKED: { name: string; command: string; dangers: Danger[] }[] = [
  { name: '名前を指定して tmux のセッションを閉じる', command: 'tmux kill-session -t bandcheck', dangers: [{ kind: 'tmux', target: 'bandcheck' }] },
  { name: 'tmux の pane を閉じる', command: 'tmux kill-pane -t probe:0.1', dangers: [{ kind: 'tmux', target: 'probe:0.1' }] },
  { name: '作業ディレクトリの外のディレクトリを消す', command: 'rm -rf ~/github.com/o/other', dangers: [{ kind: 'repos', paths: ['/Users/p/github.com/o/other'] }] },
  { name: 'ホームの 3 段めを消す', command: 'rm -rf ~/.claude/tmp/explain', dangers: [{ kind: 'repos', paths: ['/Users/p/.claude/tmp/explain'] }] },
]

for (const one of CHECKED) {
  test(`調べる: ${one.name}`, async () => {
    expect(dangersOf(one.command, PLACE)).toEqual(one.dangers)
  })
}

const PROTECTED: { name: string; commandLine: string; isProtected: boolean }[] = [
  { name: '/Applications のアプリ', commandLine: '/Applications/Slack.app/Contents/MacOS/Slack', isProtected: true },
  { name: 'OS のアプリ', commandLine: '/System/Applications/Mail.app/Contents/MacOS/Mail', isProtected: true },
  { name: 'ホームの下のアプリ', commandLine: '/Users/p/Applications/X.app/Contents/MacOS/X', isProtected: true },
  { name: 'OS の常駐プログラム', commandLine: '/usr/libexec/secinitd', isProtected: true },
  { name: 'tmux', commandLine: 'tmux new-session -d -s awake', isProtected: true },
  { name: 'ほかの Claude のセッション', commandLine: '/Users/p/.local/bin/claude --model opus', isProtected: true },
  { name: '自分で立てたスクリプト', commandLine: '/bin/bash ./serve.sh', isProtected: false },
  { name: 'bun で立てたサーバー', commandLine: 'bun run dev', isProtected: false },
  { name: 'テスト用のブラウザ', commandLine: '/Users/p/Library/Caches/ms-playwright/chromium-1/chrome-mac/Chromium.app/Contents/MacOS/Chromium', isProtected: false },
]

for (const one of PROTECTED) {
  test(`isProtected: ${one.name}`, async () => {
    expect(isProtected(one.commandLine, '/Users/p')).toBe(one.isProtected)
  })
}

test('commandLinesOf は、PID を落としてコマンドラインだけを返す', async () => {
  expect(commandLinesOf('  638 /Applications/Slack.app/Contents/MacOS/Slack\n61037 caffeinate -i -t 300\n')).toEqual([
    '/Applications/Slack.app/Contents/MacOS/Slack',
    'caffeinate -i -t 300',
  ])
})
