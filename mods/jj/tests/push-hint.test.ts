import { expect, test } from 'claude-code/testing'
import { pushHintOf } from '../hooks/push-hint'
import { world } from './world'

// isHinted は、知らせを渡すか
const COMMANDS: { command: string; isHinted: boolean }[] = [
  { command: 'jj bookmark create feat/x -r @', isHinted: true },
  { command: 'jj b c feat/x', isHinted: true },
  { command: 'jj --no-pager bookmark create feat/x', isHinted: true },
  { command: 'jj desc -m "feat: x" && jj bookmark create feat/x -r @ && jj git push -b feat/x', isHinted: true },
  // 既存のブックマークを動かす使い方は多いので、対象にしない
  { command: 'jj bookmark set feat/x -r @', isHinted: false },
  { command: 'jj git push --named feat/x=@', isHinted: false },
  { command: 'jj bookmark list', isHinted: false },
  { command: 'rg "jj bookmark" docs', isHinted: false },
]

for (const one of COMMANDS) {
  test(`pushHintOf: ${one.command}`, async () => {
    expect(pushHintOf(one.command) !== null).toBe(one.isHinted)
  })
}

test('jj bookmark create を実行した後に、push の 1 手の形を知らせる。実行は止めない', async ($, on) => {
  world(on)

  const called = await $.tool.call({ tool: 'Bash', command: 'jj bookmark create feat/x -r @' })
  expect(called.deny).toBeUndefined()
  expect(called.result).toBe('')
  expect(called.context?.length).toBe(1)
  expect(called.context?.[0]).toContain('jj git push --named <名前>=@')
  expect(called.context?.[0]).toContain('~/.claude/skills/create-pr/pr-push.sh')
})

test('jj bookmark create でない Bash には、何も足さない', async ($, on) => {
  world(on)

  const called = await $.tool.call({ tool: 'Bash', command: 'jj bookmark set feat/x -r @' })
  expect(called.context).toBeUndefined()
})
