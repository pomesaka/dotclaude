import { expect, test, type TestBody } from 'claude-code/testing'

import { isGuide, isLaunch } from '../hooks/launch'

type On = Parameters<TestBody>[1]

const LAUNCHES: { name: string; command: string; is: boolean }[] = [
  { name: 'portless で開発サーバー', command: 'portless myapp bun run dev', is: true },
  { name: 'playwright-cli で画面を開く', command: 'playwright-cli -s=v open "$URL"', is: true },
  { name: 'npm run dev', command: 'cd web && npm run dev', is: true },
  { name: 'bun start', command: 'bun start', is: true },
  { name: 'wrangler dev', command: 'wrangler dev --port 8788', is: true },
  { name: 'テストは起動でない', command: 'bun test src', is: false },
  { name: 'playwright-cli の画面の操作は起動でない', command: 'playwright-cli -s=v click "#ok"', is: false },
  { name: 'portless の一覧', command: 'portless list', is: false },
]

for (const one of LAUNCHES) {
  test(`isLaunch: ${one.name}`, async () => {
    expect(isLaunch(one.command)).toBe(one.is)
  })
}

const GUIDES: { name: string; is: boolean }[] = [
  { name: 'verify', is: true },
  { name: 'verifier-cli', is: true },
  { name: 'run-desktop', is: true },
  { name: 'verifying', is: false },
  { name: 'deploy', is: false },
]

for (const one of GUIDES) {
  test(`isGuide: ${one.name}`, async () => {
    expect(isGuide(one.name)).toBe(one.is)
  })
}

const world = (on: On, skills: string[] | null) => {
  on('session.cwd', () => ({ value: '/repo' }))
  on('process.run', (_$, e) => ({
    value: { exitCode: e.argv[0] === 'jj' ? 0 : 1, stdout: e.argv[0] === 'jj' ? '/repo\n' : '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false },
  }))
  on('fs.exists', () => ({ value: skills !== null }))
  on('fs.list', () => ({ value: (skills ?? []).map(name => ({ name, kind: 'dir' as const, size: 0, mtimeMs: 0, isLink: false })) }))
  on('tool.call', () => ({ result: 'started' }))
}

const contextOf = (called: unknown): string => {
  const context = typeof called === 'object' && called !== null && 'context' in called ? called.context : undefined
  return Array.isArray(context) ? context.join('\n') : ''
}

test('手順書が無いリポジトリで起動したら、書くよう伝える。2 回めは伝えない', async ($, on) => {
  world(on, null)
  const first = await $.tool.call({ tool: 'Bash', command: 'portless myapp bun run dev' })
  expect(contextOf(first)).toContain('まだ無い')
  const second = await $.tool.call({ tool: 'Bash', command: 'portless myapp bun run dev' })
  expect(contextOf(second)).toBe('')
})

test('手順書があるリポジトリで起動したら、その手順書を指す', async ($, on) => {
  world(on, ['verify', 'deploy'])
  const called = await $.tool.call({ tool: 'Bash', command: 'npm run dev' })
  expect(contextOf(called)).toContain('.claude/skills/verify/SKILL.md')
  expect(contextOf(called)).not.toContain('deploy')
})

test('起動でないコマンドには何も添えない', async ($, on) => {
  world(on, null)
  const called = await $.tool.call({ tool: 'Bash', command: 'bun test' })
  expect(contextOf(called)).toBe('')
})
