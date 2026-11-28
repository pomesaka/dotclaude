import { describe, expect, test } from 'bun:test'
import { type AgentCall, callsOf, countByType, isGeneral, isSince } from './agents'

const agentLine = (input: object, timestamp = '2026-11-28T01:02:03Z') =>
  JSON.stringify({ timestamp, message: { content: [{ type: 'text', text: 'x' }, { type: 'tool_use', name: 'Agent', input }] } })

const call = (type: string | undefined, date = ''): AgentCall => ({ date, type, description: '', prompt: '' })

describe('callsOf', () => {
  test.each<{ name: string; line: string; want: AgentCall[] }>([
    {
      name: '型の付いた呼び出し',
      line: agentLine({ subagent_type: 'research', description: '調べる', prompt: 'a\n  b' }),
      want: [{ date: '2026-11-28', type: 'research', description: '調べる', prompt: 'a b' }],
    },
    { name: '型の無い呼び出し', line: agentLine({ description: 'd', prompt: 'p' }), want: [{ date: '2026-11-28', type: undefined, description: 'd', prompt: 'p' }] },
    { name: 'prompt は頭の 160 文字', line: agentLine({ subagent_type: 'general-purpose', prompt: 'あ'.repeat(200) }), want: [{ date: '2026-11-28', type: 'general-purpose', description: '', prompt: 'あ'.repeat(160) }] },
    { name: 'Agent の無い行', line: JSON.stringify({ message: { content: [{ type: 'tool_use', name: 'Bash', input: {} }] } }), want: [] },
    { name: '本文に "Agent" とあるだけの行', line: JSON.stringify({ message: { content: [{ type: 'text', text: '"Agent"' }] } }), want: [] },
    { name: 'JSON でない行', line: '{"Agent"', want: [] },
  ])('$name', ({ line, want }) => {
    expect(callsOf(line)).toEqual(want)
  })
})

test('countByType は多い順、同数なら名前の順。型の無い呼び出しは (なし)', () => {
  expect(countByType([call('b'), call(undefined), call('c'), call('c')])).toEqual([
    ['c', 2],
    ['(なし)', 1],
    ['b', 1],
  ])
})

test.each([
  { type: 'general-purpose', want: true },
  { type: undefined, want: true },
  { type: 'research', want: false },
])('isGeneral: $type', ({ type, want }) => {
  expect(isGeneral(call(type))).toBe(want)
})

test.each([
  { name: '期間の初日は入る', date: '2026-11-14', want: true },
  { name: '期間より前は外す', date: '2026-11-13', want: false },
  { name: '日付の無い呼び出しは外す', date: '', want: false },
])('isSince: $name', ({ date, want }) => {
  expect(isSince(call('research', date), '2026-11-14')).toBe(want)
})
