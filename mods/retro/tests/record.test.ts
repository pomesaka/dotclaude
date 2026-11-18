import { expect, test } from 'claude-code/testing'

import { actionOf, isCompletion, isCorrection, isStop, recordOf, reportBodyOf, reporterOf, shouldJudge, withReport } from '../hooks/record'

const REPORTERS: { name: string; text: string; reporter: string | null }[] = [
  { name: '終わった知らせ', text: '<task-notification><task-id>a1</task-id><tool-use-id>t</tool-use-id>', reporter: 'a1' },
  { name: '報告用のツールで送った報告', text: '<agent-message from="a2">\n[Subagent hand-back] …', reporter: 'a2' },
  { name: 'どちらでもない', text: '違う、そっちじゃない', reporter: null },
]

for (const one of REPORTERS) {
  test(`reporterOf: ${one.name}`, async () => {
    expect(reporterOf(one.text)).toBe(one.reporter)
  })
}

const BODIES: { name: string; text: string; body: string | null }[] = [
  { name: '各行を 2 桁戻し、枠を外す', text: '<agent-message from="a">\nThe report follows:\n  - a\n    - b\n</agent-message>', body: '- a\n  - b' },
  { name: '枠が無い', text: '<task-notification><task-id>a</task-id>', body: null },
  { name: '本文が空', text: 'The report follows:\n  \n</agent-message>', body: null },
]

for (const one of BODIES) {
  test(`reportBodyOf: ${one.name}`, async () => {
    expect(reportBodyOf(one.text)).toBe(one.body)
  })
}

const REPORTS: { name: string; log: { at: number; agentId: string; text: string }[]; entry: { at: number; agentId: string; text: string }; after: unknown }[] = [
  { name: '新しい書き手の報告は先頭に足す', log: [{ at: 1, agentId: 'a', text: 'x' }], entry: { at: 2, agentId: 'b', text: 'y' }, after: [{ at: 2, agentId: 'b', text: 'y' }, { at: 1, agentId: 'a', text: 'x' }] },
  { name: '同じ書き手の短い報告は捨てる', log: [{ at: 1, agentId: 'a', text: '長い本文' }], entry: { at: 2, agentId: 'a', text: '済' }, after: [{ at: 1, agentId: 'a', text: '長い本文' }] },
  { name: '同じ書き手の長い報告で置き換える', log: [{ at: 1, agentId: 'a', text: '済' }], entry: { at: 2, agentId: 'a', text: '長い本文' }, after: [{ at: 2, agentId: 'a', text: '長い本文' }] },
]

for (const one of REPORTS) {
  test(`withReport: ${one.name}`, async () => {
    expect(withReport(one.log, one.entry)).toEqual(one.after)
  })
}

const CORRECTIONS: { text: string; is: boolean }[] = [
  { text: '違う、そっちのファイルじゃない', is: true },
  { text: 'なんでコミットしたの？', is: true },
  { text: 'いや、それは要らない', is: true },
  { text: 'jj を使ってって言ったよね', is: true },
  { text: 'テストになってない', is: true },
  { text: 'commitしてpushしといて！', is: false },
  { text: 'いいね、それで進めて', is: false },
  { text: '違和感のある画面を直して', is: false },
]

for (const one of CORRECTIONS) {
  test(`isCorrection: ${one.text}`, async () => {
    expect(isCorrection(one.text)).toBe(one.is)
  })
}

const STOPS: { reason: string; is: boolean }[] = [
  { reason: 'answer', is: false },
  { reason: 'max_turns', is: false },
  { reason: 'aborted', is: true },
  { reason: 'interrupted', is: true },
  { reason: 'error', is: true },
  { reason: 'blocked', is: true },
]

for (const one of STOPS) {
  test(`isStop: ${one.reason}`, async () => {
    expect(isStop(one.reason)).toBe(one.is)
  })
}

const COMMANDS: { command: string; is: boolean }[] = [
  { command: 'jj commit -m "fix"', is: true },
  { command: 'jj git push -b main', is: true },
  { command: 'gh pr create --title x', is: true },
  { command: 'gh pr merge 12', is: true },
  { command: 'git push origin main', is: true },
  { command: 'jj log --limit 5', is: false },
  { command: 'gh pr view 12', is: false },
]

for (const one of COMMANDS) {
  test(`isCompletion: ${one.command}`, async () => {
    expect(isCompletion(one.command)).toBe(one.is)
  })
}

const record = (turns: number, corrections: number, stops: number, isOn = true) => ({ isOn, turns, corrections, stops, found: [], log: [] })

const JUDGES: { name: string; record: ReturnType<typeof record>; trigger: 'turn' | 'completion' | 'busy' | 'compact' | 'manual'; is: boolean }[] = [
  { name: '道具を多く呼んだターンで、3 ターン', record: record(3, 0, 0), trigger: 'busy', is: true },
  { name: '道具を多く呼んだターンでも、2 ターン', record: record(2, 0, 0), trigger: 'busy', is: false },
  { name: '自動が OFF なら、道具を多く呼んでも聞かない', record: record(30, 0, 0, false), trigger: 'busy', is: false },
  { name: '20 ターンで、直された発言が 1 つ', record: record(20, 1, 0), trigger: 'turn', is: true },
  { name: '20 ターンで、止まったターンが 1 つ', record: record(20, 0, 1), trigger: 'turn', is: true },
  { name: '20 ターンでも、出来事が無い', record: record(20, 0, 0), trigger: 'turn', is: false },
  { name: '出来事があっても、19 ターン', record: record(19, 3, 0), trigger: 'turn', is: false },
  { name: 'コミットで、10 ターン', record: record(10, 0, 0), trigger: 'completion', is: true },
  { name: 'コミットでも、9 ターン', record: record(9, 0, 0), trigger: 'completion', is: false },
  { name: 'compact の直前で、3 ターン', record: record(3, 0, 0), trigger: 'compact', is: true },
  { name: 'compact の直前でも、2 ターン', record: record(2, 0, 0), trigger: 'compact', is: false },
  { name: '自動が OFF なら、compact でも聞かない', record: record(30, 5, 5, false), trigger: 'compact', is: false },
  { name: '自動が OFF でも、手で頼まれたら聞く', record: record(0, 0, 0, false), trigger: 'manual', is: true },
]

for (const one of JUDGES) {
  test(`shouldJudge: ${one.name}`, async () => {
    expect(shouldJudge(one.record, one.trigger)).toBe(one.is)
  })
}

const STORED: { name: string; stored: unknown; record: unknown }[] = [
  { name: '何も無ければ、自動は ON', stored: undefined, record: { isOn: true, turns: 0, corrections: 0, stops: 0, found: [], log: [] } },
  {
    name: '形が合わない部分は捨てる',
    stored: { isOn: false, turns: -1, corrections: 2, stops: 'x', found: ['a', 1], log: [{ at: 1, text: 'b' }, { at: 'x' }] },
    record: { isOn: false, turns: 0, corrections: 2, stops: 0, found: ['a'], log: [{ at: 1, agentId: '', text: 'b' }] },
  },
]

for (const one of STORED) {
  test(`recordOf: ${one.name}`, async () => {
    expect(recordOf(one.stored)).toEqual(one.record)
  })
}

const ACTIONS: { args: string; action: string | null }[] = [
  { args: '', action: 'run' },
  { args: ' ON ', action: 'on' },
  { args: 'off', action: 'off' },
  { args: 'log', action: 'log' },
  { args: 'now', action: null },
]

for (const one of ACTIONS) {
  test(`actionOf: "${one.args}"`, async () => {
    expect(actionOf(one.args)).toBe(one.action)
  })
}
