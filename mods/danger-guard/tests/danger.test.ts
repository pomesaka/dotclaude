import { expect, test } from 'claude-code/testing'
import { commandLinesOf, dangersOf, isProtected } from '../hooks/danger'
import { segmentsOf } from '../hooks/shell'

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

// 実行させないコマンド。why は、理由に入る語
const DENIED: { name: string; command: string; why: string }[] = [
  { name: 'ディスクの根を消す', command: 'rm -rf /', why: 'recursively delete the root of the disk' },
  { name: '根の中身を全部消す', command: 'rm -rf /*', why: 'everything matching "*" in the root of the disk' },
  { name: 'ホームを消す', command: 'rm -rf ~', why: 'recursively delete your home directory' },
  { name: '$HOME で書いたホーム', command: 'rm -rf "$HOME"', why: 'recursively delete your home directory' },
  { name: 'ホームの中身を全部消す', command: 'rm -rf ~/*', why: 'everything matching "*" in your home directory' },
  { name: 'ホームの直下を glob で消す', command: 'rm -rf ~/D*', why: 'everything matching "D*" in your home directory' },
  { name: 'ホームの直下のディレクトリ', command: 'rm -rf ~/Documents', why: 'a top-level entry of your home (/Users/p/Documents)' },
  { name: 'ホームを含むディレクトリ', command: 'rm -rf /Users', why: 'a top-level directory (/Users)' },
  { name: '指定を分けて書いても同じ', command: 'rm -r -f /usr/local', why: 'a system directory (/usr/local)' },
  { name: '長い指定', command: 'rm --recursive --force /Applications', why: 'a top-level directory (/Applications)' },
  { name: '作業ディレクトリそのもの', command: 'rm -rf .', why: 'the working directory of this session' },
  { name: '作業ディレクトリの中身の全部', command: 'rm -rf ./*', why: 'everything matching "*" in the working directory of this session' },
  { name: '作業ディレクトリの親', command: 'rm -rf ..', why: 'a directory that contains the working directory (/Users/p/github.com/o)' },
  { name: 'リポジトリの履歴', command: 'rm -rf .git', why: "the repository's history (/Users/p/github.com/o/app/.git)" },
  { name: 'cd の後は、移った先から読む', command: 'cd ~ && rm -rf Documents', why: 'a top-level entry of your home (/Users/p/Documents)' },
  { name: 'sudo の後ろも読む', command: 'sudo rm -rf /', why: 'recursively delete the root of the disk' },
  { name: 'sh -c の中も読む', command: 'sh -c "rm -rf ~"', why: 'recursively delete your home directory' },
  { name: '後ろに続くコマンドの中にあっても読む', command: 'ls; rm -rf / 2>/dev/null', why: 'recursively delete the root of the disk' },
  { name: 'find でホームの下を消す', command: 'find ~ -name "*.log" -delete', why: 'find would delete files under your home directory' },
  { name: 'find から rm を呼ぶ', command: 'find / -type f -exec rm {} +', why: 'find would delete files under the root of the disk' },
  { name: 'ホームの権限を再帰的に変える', command: 'chmod -R 777 ~', why: 'change permissions or ownership recursively on your home directory' },
  { name: '根の所有者を再帰的に変える', command: 'sudo chown -R p /', why: 'change permissions or ownership recursively on the root of the disk' },
  { name: 'dd でディスクに書く', command: 'dd if=/dev/zero of=/dev/disk2 bs=1m', why: 'dd would overwrite a device (/dev/disk2)' },
  { name: 'リダイレクトでディスクに書く', command: 'cat image.iso > /dev/rdisk3', why: 'writes straight to a device (/dev/rdisk3)' },
  { name: 'ディスクを消す', command: 'diskutil eraseDisk APFS X disk2', why: 'diskutil eraseDisk APFS erases a disk or a volume' },
  { name: 'APFS のボリュームを消す', command: 'diskutil apfs deleteVolume disk3s5', why: 'diskutil apfs deleteVolume erases a disk or a volume' },
  { name: 'ファイルシステムを作り直す', command: 'newfs_apfs /dev/disk2s1', why: 'newfs_apfs formats a filesystem' },
  { name: '電源を切る', command: 'sudo shutdown -h now', why: 'shutdown stops the machine' },
  { name: '再起動する', command: 'reboot', why: 'reboot stops the machine' },
  { name: 'ログインのセッションを終わらせる', command: 'launchctl bootout gui/502', why: 'launchctl bootout gui/502 ends the whole login session' },
  { name: 'スクリプトでログアウトする', command: 'osascript -e \'tell application "System Events" to log out\'', why: 'shuts down, restarts or logs out' },
  { name: '予定した仕事を全部消す', command: 'crontab -r', why: 'crontab -r removes every scheduled job' },
  { name: 'tmux のサーバーを止める', command: 'tmux kill-server', why: 'ends tmux sessions other than the one you started' },
  { name: 'tmux のほかのセッションを全部止める', command: 'tmux kill-session -a', why: 'ends tmux sessions other than the one you started' },
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

// 通すコマンド
const ALLOWED: { name: string; command: string }[] = [
  { name: '作業ディレクトリの中のディレクトリ', command: 'rm -rf node_modules dist' },
  { name: '作業ディレクトリの中の、一部の glob', command: 'rm -rf *.log build/*' },
  { name: '一時ディレクトリの中', command: 'rm -rf /private/tmp/claude-502/x/scratchpad/probe' },
  { name: 'ホームの 2 段下', command: 'rm -rf ~/.claude/tmp/explain' },
  { name: '再帰でない削除', command: 'rm ~/notes.txt' },
  { name: '変数が入っていて読めない道筋', command: 'rm -rf "$S/parts"' },
  { name: '読めない cd の後の相対の道筋', command: 'cd "$S" && rm -rf .' },
  { name: '一時ディレクトリへ移ってから、その中身を消す', command: 'cd /private/tmp/x/work && rm -rf ./*' },
  { name: '作業ディレクトリの中を find で消す', command: 'find . -name "*.tmp" -delete' },
  { name: '消さない find', command: 'find ~ -name "*.log"' },
  { name: '作業ディレクトリの中の権限', command: 'chmod -R u+w dist' },
  { name: '再帰でない権限の変更', command: 'chmod +x ~/bin' },
  { name: 'ファイルへ書く dd', command: 'dd if=/dev/zero of=./blank.img bs=1m count=10' },
  { name: '捨てる先へのリダイレクト', command: 'ls > /dev/null 2>&1' },
  { name: '調べるだけの diskutil', command: 'diskutil list' },
  { name: '名前を指定して tmux のセッションを止める', command: 'tmux kill-session -t bandcheck' },
  { name: 'PID を指定した kill', command: 'kill -9 1234' },
  { name: 'kill -1 <PID> は、その PID への SIGHUP', command: 'kill -1 1234' },
  { name: '調べるだけの pgrep', command: 'pgrep -fl cat' },
  { name: '変数が入った語の pkill は、確かめられないので数えない', command: 'pkill -f "$NAME"' },
  { name: '文字列の中に書いただけ', command: 'echo "rm -rf /" | rg rm' },
  { name: 'プロセスを止めないコマンド', command: 'cat a.txt | rg kill' },
]

for (const one of ALLOWED) {
  test(`通す: ${one.name}`, async () => {
    expect(dangersOf(one.command, PLACE)).toEqual([])
  })
}

// 何が止まるかを数えてから決める呼び出し。pgrep は、数えるための引数
const MATCHES: { name: string; command: string; pgrep: string[][] }[] = [
  { name: 'pkill -f', command: 'pkill -f "cat"', pgrep: [['-f', '--', 'cat']] },
  { name: '名前で止める pkill', command: 'pkill node', pgrep: [['--', 'node']] },
  { name: 'シグナルの指定は落とす', command: 'pkill -INT -f "vite dev"', pgrep: [['-f', '--', 'vite dev']] },
  { name: '数字のシグナルも落とす', command: 'pkill -9 -f server.ts', pgrep: [['-f', '--', 'server.ts']] },
  { name: '値を取る指定は、値と一緒に残す', command: 'pkill -u pomesaka -f x.sh', pgrep: [['-u', 'pomesaka', '-f', '--', 'x.sh']] },
  { name: 'まとめて書いた指定から、一覧の指定だけを落とす', command: 'pkill -fl x.sh', pgrep: [['-f', '--', 'x.sh']] },
  { name: '後ろに続くコマンドは読まない', command: 'pkill -f "cat" 2>/dev/null; cd /tmp', pgrep: [['-f', '--', 'cat']] },
  { name: 'pgrep の結果を kill に渡す', command: 'pgrep -f cat | xargs kill -9', pgrep: [['-f', '--', 'cat']] },
  { name: 'kill に pgrep の結果を埋める', command: 'kill $(pgrep -f cat)', pgrep: [['-f', '--', 'cat']] },
  { name: 'killall は、名前ごとに、ちょうど一致するものを数える', command: 'killall -9 Dock Finder', pgrep: [['-x', '--', 'Dock'], ['-x', '--', 'Finder']] },
]

for (const one of MATCHES) {
  test(`数える: ${one.name}`, async () => {
    expect(dangersOf(one.command, PLACE)).toEqual(one.pgrep.map(pgrep => ({ kind: 'match', pgrep })))
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
