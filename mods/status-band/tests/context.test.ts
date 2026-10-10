import { expect, test } from 'claude-code/testing'
import { SESSION_CONTEXT } from '../hooks/context'
import { world } from './world'

const STARTED = { hook_event_name: 'SessionStart', session_id: 's1', transcript_path: '/t.jsonl', cwd: '/repo' } as const

const SOURCES = ['startup', 'resume', 'fork', 'clear', 'compact'] as const

// /clear と compact は前の文脈を落とす。どの始まり方でも渡す
for (const source of SOURCES) {
  test(`セッションの始め（${source}）に、Mod の説明を Claude へ渡す`, async ($, on) => {
    world(on)

    const started = await $.classic.SessionStart({ ...STARTED, source })
    expect(started.additionalContext).toEqual([SESSION_CONTEXT])
  })
}

test('ほかの hook が足した文脈は消さずに、後ろへ足す', async ($, on) => {
  world(on, { otherContext: ['claude-deck の説明'] })

  const started = await $.classic.SessionStart({ ...STARTED, source: 'startup' })
  expect(started.additionalContext).toEqual(['claude-deck の説明', SESSION_CONTEXT])
})

test('サブエージェントには渡さない', async ($, on) => {
  world(on)

  const started = await $.classic.SessionStart({ ...STARTED, source: 'startup', agent_id: 'a1' })
  expect(started.additionalContext).toBeUndefined()
})

// 説明に出てくる名前が、実際の名前とずれていないことを固定する
const NAMES = ['mcp__status-band__add_question', 'mcp__status-band__resolve_question', 'mcp__status-band__list_questions', 'mcp__status-band__add_reference', 'mcp__status-band__remove_reference', 'mcp__status-band__clear_references', 'mcp__status-band__track_pr', '/jjcommit', '/difit', 'pushしといて', '【保留への回答】', 'がマージされました', 'の CI が失敗しました']

for (const name of NAMES) {
  test(`説明は「${name}」に触れている`, async () => {
    expect(SESSION_CONTEXT.includes(name)).toBe(true)
  })
}
