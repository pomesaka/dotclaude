import { expect, test, type TestBody } from 'claude-code/testing'

import { checkOf, counted } from '../hooks/streak'

type On = Parameters<TestBody>[1]

const CHECKS: { command: string; check: string | null }[] = [
  { command: 'bun test src/a.test.ts', check: 'bun test' },
  { command: 'bun run typecheck', check: 'bun run typecheck' },
  { command: 'npx tsc --noEmit -p .', check: 'tsc' },
  { command: 'go test ./...', check: 'go test' },
  { command: 'claude plugin test mods/retro', check: 'claude plugin test' },
  { command: 'bun ~/.claude/skills/dotclaude-sync/sync.ts check', check: 'sync.ts check' },
  { command: 'bun ~/.claude/skills/mutation-test/mutate.ts --test "bun test src/a.test.ts"', check: null },
  { command: 'jj status', check: null },
  { command: 'rg -n test src', check: null },
]

for (const one of CHECKS) {
  test(`checkOf: ${one.command}`, async () => {
    expect(checkOf(one.command)).toBe(one.check)
  })
}

const COUNTS: { name: string; before: [string, number][]; isFailed: boolean; streak: number; after: [string, number][] }[] = [
  { name: '初めて落ちた', before: [], isFailed: true, streak: 1, after: [['k', 1]] },
  { name: '続けて落ちた', before: [['k', 2]], isFailed: true, streak: 3, after: [['k', 3]] },
  { name: '通ったら消す', before: [['k', 2], ['o', 1]], isFailed: false, streak: 0, after: [['o', 1]] },
]

for (const one of COUNTS) {
  test(`counted: ${one.name}`, async () => {
    const result = counted(new Map(one.before), 'k', one.isFailed)
    expect([result.streak, [...result.counts]]).toEqual([one.streak, one.after])
  })
}

const world = (on: On, results: boolean[]) => {
  let index = 0
  on('tool.call', () => ((results[index++] ?? false) ? { result: 'failed', isError: true } : { result: 'ok' }))
}

const contextOf = (called: unknown): string => {
  const context = typeof called === 'object' && called !== null && 'context' in called ? called.context : undefined
  return Array.isArray(context) ? context.join('\n') : ''
}

test('同じ検査が 3 回続けて落ちたら、3 回目の結果に利用者を呼ぶよう添える', async ($, on) => {
  world(on, [true, true, true])
  const first = await $.tool.call({ tool: 'Bash', command: 'bun test a.test.ts' })
  const second = await $.tool.call({ tool: 'Bash', command: 'bun test b.test.ts' })
  const third = await $.tool.call({ tool: 'Bash', command: 'bun test' })
  expect([contextOf(first), contextOf(second)]).toEqual(['', ''])
  expect(contextOf(third)).toContain('3 回続けて落ちた')
})

test('間に 1 回通れば、数え直す', async ($, on) => {
  world(on, [true, true, false, true, true])
  const contexts: string[] = []
  for (let index = 0; index < 5; index++) contexts.push(contextOf(await $.tool.call({ tool: 'Bash', command: 'go test ./...' })))
  expect(contexts).toEqual(['', '', '', '', ''])
})

test('検査でないコマンドは数えない', async ($, on) => {
  world(on, [true, true, true])
  const contexts: string[] = []
  for (let index = 0; index < 3; index++) contexts.push(contextOf(await $.tool.call({ tool: 'Bash', command: 'jj git push' })))
  expect(contexts).toEqual(['', '', ''])
})
