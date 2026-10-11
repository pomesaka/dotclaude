import { expect, test, type TestBody } from 'claude-code/testing'

type On = Parameters<TestBody>[1]

type Given = {
  // pgrep や lsof が出すプロセス。PID とコマンドライン
  matched?: { pid: number; commandLine: string }[]
  // PID を出すコマンドの終了コード。既定は、一致があれば 0、無ければ 1
  exitCode?: number
  // true は、外部コマンドの実行そのものが失敗する
  isBroken?: boolean
  // tmux が答える、そのセッションにつないでいるクライアントの数。null は、そのセッションが無い
  attached?: number | null
  // リポジトリの履歴がある道筋（.git か .jj）
  histories?: string[]
}

const world = (on: On, given: Given = {}) => {
  // 実行した外部コマンド
  const ran: string[][] = []
  const matched = given.matched ?? []
  const output = (stdout: string, exitCode: number) => ({ value: { exitCode, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } })
  on('env.get', (_$, e) => ({ value: e.name === 'HOME' ? '/Users/p' : undefined }))
  on('session.cwd', () => ({ value: '/Users/p/github.com/o/app' }))
  on('process.run', (_$, e) => {
    ran.push([...e.argv])
    if (given.isBroken === true) throw new Error('timed out')
    switch (e.argv[0]) {
      case 'pgrep':
      case 'lsof':
        return output(matched.map(one => `${one.pid}\n`).join(''), given.exitCode ?? (matched.length > 0 ? 0 : 1))
      case 'tmux':
        return given.attached === null || given.attached === undefined ? output('', 1) : output(`${given.attached}\n`, 0)
      case 'test':
        return output('', (given.histories ?? []).includes(e.argv[2] ?? '') ? 0 : 1)
      default:
        return output(matched.map(one => `${one.pid} ${one.commandLine}\n`).join(''), 0)
    }
  })
  on('tool.call', () => ({ result: 'ran' }))
  return { ran }
}

const APPS = [
  { pid: 638, commandLine: '/Applications/Slack.app/Contents/MacOS/Slack' },
  { pid: 635, commandLine: '/Applications/Ghostty.app/Contents/MacOS/ghostty' },
  { pid: 900, commandLine: 'cat' },
]

test('利用者のアプリを巻き込む pkill は、実行させない。巻き込まれるアプリを理由に並べる', async ($, on) => {
  const seen = world(on, { matched: APPS })

  const called = await $.tool.call({ tool: 'Bash', command: 'pkill -f "cat" 2>/dev/null; cd /tmp' })
  expect(called.result).toBeUndefined()
  expect(called.deny).toContain('the pattern "cat" also matches 2 process(es)')
  expect(called.deny).toContain('/Applications/Slack.app/Contents/MacOS/Slack')
  expect(called.deny).toContain('(3 matched in all)')
  // 同じ絞り込みで pgrep を呼び、PID からコマンドラインを引く
  expect(seen.ran).toEqual([
    ['pgrep', '-f', '--', 'cat'],
    ['ps', '-o', 'pid=,command=', '-p', '638,635,900'],
  ])
})

// 通す呼び出し。ran は、実行した外部コマンドの数
const ALLOWED: { name: string; command: string; given: Given; ran: number }[] = [
  { name: '自分で立てたプロセスだけに一致する', command: 'pkill -f serve.sh', given: { matched: [{ pid: 10, commandLine: '/bin/bash ./serve.sh' }] }, ran: 2 },
  { name: '一致するプロセスが無い', command: 'pkill -f serve.sh', given: {}, ran: 1 },
  { name: 'pgrep が引数の誤りで失敗した', command: 'pkill -f "("', given: { exitCode: 2 }, ran: 1 },
  { name: '数えられなかった', command: 'pkill -f cat', given: { isBroken: true }, ran: 1 },
  { name: 'ポートを使っているのが、自分で立てたサーバーだけ', command: 'kill $(lsof -ti:3000)', given: { matched: [{ pid: 10, commandLine: 'bun run dev' }] }, ran: 2 },
  { name: 'だれもつないでいない tmux のセッションを閉じる', command: 'tmux kill-session -t probe', given: { attached: 0 }, ran: 1 },
  { name: '無い tmux のセッションを閉じる', command: 'tmux kill-session -t gone', given: { attached: null }, ran: 1 },
  { name: '作業ディレクトリの外の、リポジトリでないディレクトリを消す', command: 'rm -rf ~/.claude/tmp/explain', given: {}, ran: 2 },
  { name: '危険でないコマンドでは、何も実行しない', command: 'rm -rf node_modules', given: { matched: APPS }, ran: 0 },
]

for (const one of ALLOWED) {
  test(`通す: ${one.name}`, async ($, on) => {
    const seen = world(on, one.given)

    const called = await $.tool.call({ tool: 'Bash', command: one.command })
    expect(called.result).toBe('ran')
    expect(seen.ran.length).toBe(one.ran)
  })
}

// 相手を調べた結果で、実行させない呼び出し。why は、理由に入る語
const DENIED: { name: string; command: string; given: Given; why: string }[] = [
  {
    name: '利用者のアプリを含まなくても、一致が多すぎる',
    command: 'pkill node',
    given: { matched: Array.from({ length: 31 }, (_, index) => ({ pid: 100 + index, commandLine: `node worker-${index}.js` })) },
    why: 'the pattern "node" matches 31 processes',
  },
  {
    name: 'Dock を止める killall',
    command: 'killall Dock',
    given: { matched: [{ pid: 660, commandLine: '/System/Library/CoreServices/Dock.app/Contents/MacOS/Dock' }] },
    why: 'the name "Dock" also matches 1 process(es)',
  },
  { name: 'pgrep の結果を kill に渡す形', command: 'pgrep -f cat | xargs kill -9', given: { matched: APPS }, why: 'the pattern "cat" also matches 2 process(es)' },
  { name: '利用者のアプリが使っているポートを空ける', command: 'kill $(lsof -ti:3000)', given: { matched: APPS }, why: 'lsof -ti:3000 also matches 2 process(es)' },
  { name: '利用者の全プロセスを止める pkill', command: 'pkill -u p', given: { matched: APPS }, why: 'pkill -u p also matches 2 process(es)' },
  { name: '利用者がつないでいる tmux のセッションを閉じる', command: 'tmux kill-session -t deck', given: { attached: 1 }, why: 'the tmux session "deck" has a client attached' },
  {
    name: '作業ディレクトリの外の、別のリポジトリを消す',
    command: 'rm -rf ~/github.com/o/other',
    given: { histories: ['/Users/p/github.com/o/other/.jj'] },
    why: '/Users/p/github.com/o/other is another repository',
  },
]

for (const one of DENIED) {
  test(`止める: ${one.name}`, async ($, on) => {
    world(on, one.given)

    const called = await $.tool.call({ tool: 'Bash', command: one.command })
    expect(called.result).toBeUndefined()
    expect(called.deny).toContain(one.why)
  })
}

test('広い場所の再帰的な削除は、何も実行せずに止める', async ($, on) => {
  const seen = world(on)

  const called = await $.tool.call({ tool: 'Bash', command: 'rm -rf ~/' })
  expect(called.result).toBeUndefined()
  expect(called.deny).toContain('recursively delete your home directory')
  expect(seen.ran).toEqual([])
})
