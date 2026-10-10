import { expect, test, type TestBody } from 'claude-code/testing'

type On = Parameters<TestBody>[1]

type Given = {
  // jj root の答え。null は、jj のリポジトリの外
  jjRoot?: string | null
  // git rev-parse --show-toplevel の答え。null は、git のリポジトリの外
  gitRoot?: string | null
  // false は、リポジトリにチェックのスクリプトが無い
  hasCheck?: boolean
  // チェックの終了コードと出力
  check?: { exitCode: number; stdout: string; stderr: string }
  // true は、チェックの実行そのものが失敗する（時間切れなど）
  isCheckBroken?: boolean
}

const world = (on: On, given: Given = {}) => {
  // 実行した外部コマンド
  const ran: string[][] = []
  // 実際に走った Bash のコマンド
  const executed: string[] = []
  const output = (exitCode: number, stdout = '', stderr = '') => ({
    value: { exitCode, stdout, stderr, isStdoutTruncated: false, isStderrTruncated: false },
  })
  const jjRoot = given.jjRoot === undefined ? '/repo' : given.jjRoot
  const gitRoot = given.gitRoot === undefined ? null : given.gitRoot

  on('session.cwd', () => ({ value: '/repo/mods' }))
  on('tool.call', (_$, e) => {
    if (e.tool === 'Bash') executed.push(e.command)
    return { result: 'ran' }
  })
  on('process.run', (_$, e) => {
    ran.push([...e.argv])
    if (e.argv[0] === 'jj') return jjRoot === null ? output(1) : output(0, `${jjRoot}\n`)
    if (e.argv[0] === 'git') return gitRoot === null ? output(128) : output(0, `${gitRoot}\n`)
    if (e.argv[0] === 'test') return output(given.hasCheck === false ? 1 : 0)
    if (given.isCheckBroken === true) throw new Error('timed out')
    const check = given.check ?? { exitCode: 0, stdout: 'ok', stderr: '' }
    return output(check.exitCode, check.stdout, check.stderr)
  })
  return { ran, executed }
}

test('公開のリモートへの push は、チェックを通ってから実行する', async ($, on) => {
  const seen = world(on)

  const called = await $.tool.call({ tool: 'Bash', command: 'jj git push --bookmark main' })
  expect(called).toEqual({ result: 'ran' })
  expect(seen.ran).toEqual([
    ['jj', 'root'],
    ['test', '-x', '/repo/scripts/check-public.sh'],
    ['/repo/scripts/check-public.sh', 'origin'],
  ])
  expect(seen.executed).toEqual(['jj git push --bookmark main'])
})

test('チェックが何かを見つけたら、push を実行させず、出力を理由に入れる', async ($, on) => {
  const seen = world(on, { check: { exitCode: 1, stdout: '12:+実例: SECRET の PR', stderr: 'check-public: 公開しない名前が 1 行で見つかりました' } })

  const called = await $.tool.call({ tool: 'Bash', command: 'jj git push' })
  expect(called).toEqual({
    deny: [
      'publish-guard blocked the push to "origin": scripts/check-public.sh found something that must not be published.',
      '12:+実例: SECRET の PR\ncheck-public: 公開しない名前が 1 行で見つかりました',
      'Fix the lines it lists, then push again. Do not work around the check; if a hit is a false positive, tell the user.',
    ].join('\n'),
  })
  expect(seen.executed).toEqual([])
})

test('チェックを実行できなければ、push を止める', async ($, on) => {
  const seen = world(on, { isCheckBroken: true })

  const called = await $.tool.call({ tool: 'Bash', command: 'jj git push' })
  // 失敗の中身は土台が言い換えるので、止めたことと、理由の書き出しだけを見る
  expect(called.deny?.startsWith('publish-guard could not run scripts/check-public.sh, so the push is blocked: ')).toBe(true)
  expect(seen.executed).toEqual([])
})

test('git のリポジトリでは、git で直下を探す', async ($, on) => {
  const seen = world(on, { jjRoot: null, gitRoot: '/work' })

  await $.tool.call({ tool: 'Bash', command: 'git push upstream main' })
  expect(seen.ran).toEqual([
    ['jj', 'root'],
    ['git', 'rev-parse', '--show-toplevel'],
    ['test', '-x', '/work/scripts/check-public.sh'],
    ['/work/scripts/check-public.sh', 'upstream'],
  ])
  expect(seen.executed).toEqual(['git push upstream main'])
})

// チェックを走らせずに、そのまま実行する場合
const PASSES: { name: string; command: string; given: Given; ran: string[][] }[] = [
  { name: 'push でないコマンド', command: 'jj st', given: {}, ran: [] },
  { name: 'バックアップ用のリモートへの push', command: 'jj git push --remote private --bookmark main', given: {}, ran: [] },
  {
    name: 'リポジトリの外',
    command: 'git push',
    given: { jjRoot: null, gitRoot: null },
    ran: [
      ['jj', 'root'],
      ['git', 'rev-parse', '--show-toplevel'],
    ],
  },
  {
    name: 'チェックのスクリプトが無いリポジトリ',
    command: 'jj git push',
    given: { hasCheck: false },
    ran: [
      ['jj', 'root'],
      ['test', '-x', '/repo/scripts/check-public.sh'],
    ],
  },
]

for (const one of PASSES) {
  test(`そのまま実行する: ${one.name}`, async ($, on) => {
    const seen = world(on, one.given)

    const called = await $.tool.call({ tool: 'Bash', command: one.command })
    expect(called).toEqual({ result: 'ran' })
    expect(seen.ran).toEqual(one.ran)
    expect(seen.executed).toEqual([one.command])
  })
}

test('バックアップと公開の両方へ push するコマンドは、公開の側だけを調べる', async ($, on) => {
  const seen = world(on)

  await $.tool.call({ tool: 'Bash', command: 'jj git push --remote private; jj git push' })
  expect(seen.ran.at(-1)).toEqual(['/repo/scripts/check-public.sh', 'origin'])
})
