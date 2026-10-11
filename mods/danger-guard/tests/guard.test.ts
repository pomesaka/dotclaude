import { expect, test, type TestBody } from 'claude-code/testing'

type On = Parameters<TestBody>[1]

type Given = {
  // pgrep が一致させるプロセス。PID とコマンドライン
  matched?: { pid: number; commandLine: string }[]
  // pgrep の終了コード。既定は、一致があれば 0、無ければ 1
  pgrepExitCode?: number
  // true は、pgrep の実行そのものが失敗する
  isBroken?: boolean
}

const world = (on: On, given: Given = {}) => {
  // 実行した外部コマンド
  const ran: string[][] = []
  const matched = given.matched ?? []
  const output = (stdout: string, exitCode: number) => ({ value: { exitCode, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } })
  on('env.get', (_$, e) => ({ value: e.name === 'HOME' ? '/Users/p' : undefined }))
  on('session.cwd', () => ({ value: '/Users/p/work/app' }))
  on('process.run', (_$, e) => {
    ran.push([...e.argv])
    if (given.isBroken === true) throw new Error('timed out')
    if (e.argv[0] === 'pgrep') return output(matched.map(one => `${one.pid}\n`).join(''), given.pgrepExitCode ?? (matched.length > 0 ? 0 : 1))
    return output(matched.map(one => `${one.pid} ${one.commandLine}\n`).join(''), 0)
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
  { name: 'pgrep が引数の誤りで失敗した', command: 'pkill -f "("', given: { pgrepExitCode: 2 }, ran: 1 },
  { name: '数えられなかった', command: 'pkill -f cat', given: { isBroken: true }, ran: 1 },
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

test('利用者のアプリを含まなくても、一致が多すぎれば実行させない', async ($, on) => {
  const many = Array.from({ length: 31 }, (_, index) => ({ pid: 100 + index, commandLine: `node worker-${index}.js` }))
  world(on, { matched: many })

  const called = await $.tool.call({ tool: 'Bash', command: 'pkill node' })
  expect(called.deny).toContain('the pattern "node" matches 31 processes')
})

test('Dock を止める killall は、実行させない', async ($, on) => {
  world(on, { matched: [{ pid: 660, commandLine: '/System/Library/CoreServices/Dock.app/Contents/MacOS/Dock' }] })

  const called = await $.tool.call({ tool: 'Bash', command: 'killall Dock' })
  expect(called.deny).toContain('the pattern "Dock" also matches 1 process(es)')
})

test('広い場所の再帰的な削除は、何も実行せずに止める', async ($, on) => {
  const seen = world(on)

  const called = await $.tool.call({ tool: 'Bash', command: 'rm -rf ~/' })
  expect(called.result).toBeUndefined()
  expect(called.deny).toContain('recursively delete your home directory')
  expect(seen.ran).toEqual([])
})
