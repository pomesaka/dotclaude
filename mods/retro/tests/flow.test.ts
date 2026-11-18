import { expect, test, type TestBody } from 'claude-code/testing'

type On = Parameters<TestBody>[1]
type Engine = Parameters<TestBody>[0]

const START = { cwd: '/repo', surface: 'terminal', isInteractive: true } as const
const END = { turnId: 't1', answer: '直しました。', durationMs: 0, isAborted: false, reason: 'answer' } as const
const USAGE = { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }
const FINDING = { title: '公開の前に名前を確かめる', detail: '公開リポジトリに案件名を書かない', evidence: '2026-11-13 に指摘された' }
const REPLY = JSON.stringify({ findings: [FINDING] })
const WRITER = 'w1'
// compact する会話。エンジンは空の会話の compact を拒む
const MESSAGES = [{ role: 'user' as const, text: '直して', toolUses: [] }]

const command = (args: string) => ({ command: 'retro', args, origin: { kind: 'composer' as const }, presentation: { isFullscreen: false, columns: 177 } })

type Given = {
  stored?: { [key: string]: unknown }
  // 分岐して聞いたモデルの返事。null は、モデルが文を返さなかった
  reply?: string | null
}

const world = (on: On, given: Given = {}) => {
  // 分岐して聞いたときの、依頼の文
  const asked: string[] = []
  // 立てたエージェントの依頼
  const spawned: { prompt: string; subagentType: string | undefined; model: string | undefined }[] = []
  const toasts: string[] = []
  const submitted: string[] = []
  const seen = {
    store: new Map(Object.entries(given.stored ?? {})),
    asked,
    spawned,
    toasts,
    submitted,
    reply: given.reply === undefined ? REPLY : given.reply,
  }
  const agents: { id: string; description: string; type: string; status: 'running' | 'completed' }[] = []

  on('session.id', () => ({ value: 's1' }))
  on('session.cwd', () => ({ value: '/repo' }))
  on('session.start', () => ({ cwd: '/repo' }))
  on('command.register', (_$, e) => ({ value: { command: e.name } }))
  on('turn.start', (_$, e) => ({ turnId: e.turnId }))
  on('turn.complete', () => ({ text: '' }))
  on('clock.now', () => ({ value: 1_000_000_000 }))
  on('store.get', (_$, e) => ({ value: seen.store.get(e.key) }))
  on('store.set', (_$, e) => {
    seen.store.set(e.key, e.value)
    return { value: undefined }
  })
  on('store.delete', (_$, e) => {
    seen.store.delete(e.key)
    return { value: undefined }
  })
  on('store.keys', () => ({ value: [...seen.store.keys()] }))
  on('model.fork', (_$, e) => {
    seen.asked.push(e.prompt)
    return {
      value: seen.reply === null ? { isAnswered: false as const, reason: 'empty-reply' as const, usage: USAGE } : { isAnswered: true as const, text: seen.reply, usage: USAGE },
    }
  })
  // WHY ID を一覧で答える: 土台は、spawn の答えの agentId を捨てる（docs/claude-code-mods.md）
  on('agent.spawn', (_$, e) => {
    // WHY subagent_type を読む: 土台は、エンジンの Agent ツールへ渡す形（subagent_type）で届ける（v2.1.323 の claude plugin test で確認）
    const subagentType = Reflect.get(e, 'subagent_type')
    seen.spawned.push({ prompt: e.prompt, subagentType: typeof subagentType === 'string' ? subagentType : undefined, model: e.model })
    agents.push({ id: WRITER, description: e.description, type: 'general-purpose', status: 'running' })
    return { model: 'sonnet' }
  })
  on('agent.list', () => ({ value: [...agents] }))
  on('ui.toast', (_$, e) => {
    seen.toasts.push(e.text)
    return { value: undefined }
  })
  on('prompt.submit', (_$, e) => {
    seen.submitted.push(e.text)
    return { text: e.text }
  })
  on('tool.call', () => ({ result: '' }))
  on('session.compact', (_$, e) => ({ messages: e.messages }))
  return seen
}

const settled = () => new Promise(resolve => setTimeout(resolve, 0))

const turns = async ($: Engine, count: number): Promise<void> => {
  for (let index = 0; index < count; index++) await $.turn.complete({ ...END, turnId: `t${index}` })
  await settled()
}

const stored = (turns: number, corrections: number, stops: number, rest: { [key: string]: unknown } = {}) => ({
  'session:s1': { isOn: true, turns, corrections, stops, found: [], log: [], ...rest },
})

test('20 ターンたち、そのあいだに直されていたら、分岐に聞いて、会話を持たない書き手をメインと同じモデルで立てる', async ($, on) => {
  const seen = world(on, { stored: stored(19, 1, 0) })
  await $.session.start(START)

  await turns($, 1)
  expect(seen.asked.length).toBe(1)
  expect(seen.spawned.map(one => ({ subagentType: one.subagentType, model: one.model }))).toEqual([{ subagentType: 'general-purpose', model: undefined }])
  expect(seen.spawned[0]?.prompt.includes('公開の前に名前を確かめる')).toBe(true)
  expect(seen.store.get('session:s1')).toEqual({ isOn: true, turns: 0, corrections: 0, stops: 0, found: ['公開の前に名前を確かめる'], log: [] })
  expect(seen.toasts).toEqual(['retro: 1 件の発見を文書に書いています'])
  // メインには何も送らない
  expect(seen.submitted).toEqual([])
})

test('発見が無ければ、書き手を立てず、数だけ戻す', async ($, on) => {
  const seen = world(on, { stored: stored(19, 1, 0), reply: '{"findings":[]}' })
  await $.session.start(START)

  await turns($, 1)
  expect(seen.asked.length).toBe(1)
  expect(seen.spawned).toEqual([])
  expect(seen.store.get('session:s1')).toEqual({ isOn: true, turns: 0, corrections: 0, stops: 0, found: [], log: [] })
  expect(seen.toasts).toEqual([])
})

test('聞けなかったら、数を戻さず、知らせない', async ($, on) => {
  const seen = world(on, { stored: stored(19, 1, 0), reply: null })
  await $.session.start(START)

  await turns($, 1)
  expect(seen.asked.length).toBe(1)
  expect(seen.store.get('session:s1')).toEqual({ isOn: true, turns: 20, corrections: 1, stops: 0, found: [], log: [] })
  expect(seen.toasts).toEqual([])
})

// 終わったターンで聞かない場合
const SILENT: { name: string; stored: { [key: string]: unknown }; last: Parameters<Engine['turn']['complete']>[0] }[] = [
  { name: '20 ターンでも、直されも止まりもしていない', stored: stored(19, 0, 0), last: END },
  { name: '自動が OFF', stored: stored(19, 1, 0, { isOn: false }), last: END },
  { name: '中断で終わったターン', stored: stored(19, 1, 0), last: { ...END, isAborted: true, reason: 'aborted' } },
  { name: 'サブエージェントのターン', stored: stored(19, 1, 0), last: { ...END, agentId: 'a1' } },
]

for (const one of SILENT) {
  test(`聞かない: ${one.name}`, async ($, on) => {
    const seen = world(on, { stored: one.stored })
    await $.session.start(START)

    await $.turn.complete(one.last)
    await settled()
    expect(seen.asked).toEqual([])
  })
}

test('中断で終わったターンを、止まった出来事として数える', async ($, on) => {
  const seen = world(on, { stored: stored(0, 0, 0) })
  await $.session.start(START)

  await $.turn.complete({ ...END, isAborted: true, reason: 'aborted' })
  expect(seen.store.get('session:s1')).toEqual({ isOn: true, turns: 1, corrections: 0, stops: 1, found: [], log: [] })
})

test('利用者が直した発言を数える', async ($, on) => {
  const seen = world(on, { stored: stored(0, 0, 0) })
  await $.session.start(START)

  await $.prompt.submit({ text: '違う、そっちじゃない', origin: { kind: 'composer' } })
  await $.prompt.submit({ text: 'いいね、進めて', origin: { kind: 'composer' } })
  expect(seen.store.get('session:s1')).toEqual({ isOn: true, turns: 0, corrections: 1, stops: 0, found: [], log: [] })
})

test('コミットしたターンは、10 ターンたっていれば、直されていなくても聞く', async ($, on) => {
  const seen = world(on, { stored: stored(9, 0, 0) })
  await $.session.start(START)

  await $.turn.start({ turnId: 't1', prompt: 'commit して' })
  await $.tool.call({ tool: 'Bash', command: 'jj commit -m "fix"' })
  await turns($, 1)
  expect(seen.asked.length).toBe(1)
})

test('compact の直前に、3 ターンたっていれば聞いてから compact に進む', async ($, on) => {
  const seen = world(on, { stored: stored(3, 0, 0) })
  await $.session.start(START)

  await $.session.compact({ trigger: 'manual', messages: MESSAGES })
  expect(seen.asked.length).toBe(1)
  expect(seen.spawned.length).toBe(1)
})

test('書き手が終わったら、報告を残して知らせる。終わった知らせはメインに届けない', async ($, on) => {
  const seen = world(on, { stored: stored(19, 1, 0) })
  await $.session.start(START)
  await turns($, 1)

  await $.turn.complete({ ...END, turnId: 'w', agentId: WRITER, answer: '- docs/a.md: 公開の前に名前を確かめる（新規）' })
  expect(seen.store.get('session:s1')).toEqual({
    isOn: true,
    turns: 0,
    corrections: 0,
    stops: 0,
    found: ['公開の前に名前を確かめる'],
    log: [{ at: 1_000_000_000, agentId: WRITER, text: '- docs/a.md: 公開の前に名前を確かめる（新規）' }],
  })
  expect(seen.toasts.at(-1)).toBe('retro: 振り返りを書きました。/retro log で読めます')

  const dropped = await $.prompt.submit({ text: `<task-notification><task-id>${WRITER}</task-id>`, origin: { kind: 'task-notification' } })
  expect(dropped).toEqual({ drop: 'retro の書き手の報告（/retro log で読める）' })
  const passed = await $.prompt.submit({ text: '<task-notification><task-id>other</task-id>', origin: { kind: 'task-notification' } })
  expect(passed).toEqual({ text: '<task-notification><task-id>other</task-id>' })
})

// 報告用のツールで送られた報告の形（v2.1.323 で実機に届いたものを縮めた）
const handBack = (from: string) =>
  `<agent-message from="${from}">\n[Subagent hand-back] The text below is the final report. The report follows:\n  - docs/b.md: 出典を分けて書く（新規）\n  既にあった原則は無かった。\n</agent-message>`

test('書き手が報告用のツールで送った報告はメインに届けず、本文を記録に残す。最後の答えが短くても本文を残す', async ($, on) => {
  const seen = world(on, { stored: stored(19, 1, 0) })
  await $.session.start(START)
  await turns($, 1)

  const dropped = await $.prompt.submit({ text: handBack(WRITER), origin: { kind: 'peer' } })
  expect(dropped).toEqual({ drop: 'retro の書き手の報告（/retro log で読める）' })
  await $.turn.complete({ ...END, turnId: 'w', agentId: WRITER, answer: '送りました。' })
  expect(seen.store.get('session:s1')).toEqual({
    isOn: true,
    turns: 0,
    corrections: 0,
    stops: 0,
    found: ['公開の前に名前を確かめる'],
    log: [{ at: 1_000_000_000, agentId: WRITER, text: '- docs/b.md: 出典を分けて書く（新規）\n既にあった原則は無かった。' }],
  })

  // ほかのエージェントの報告と、利用者が打った文は通す
  expect(await $.prompt.submit({ text: handBack('other'), origin: { kind: 'peer' } })).toEqual({ text: handBack('other') })
  expect(await $.prompt.submit({ text: handBack(WRITER), origin: { kind: 'composer' } })).toEqual({ text: handBack(WRITER) })
})

test('/retro は、自動が OFF でも、その場で聞く。発見が無ければそう知らせる', async ($, on) => {
  const seen = world(on, { stored: stored(0, 0, 0, { isOn: false }), reply: '{"findings":[]}' })
  await $.session.start(START)

  expect(await $.command.run(command(''))).toEqual({ text: 'retro: looking back on this session.' })
  await settled()
  expect(seen.asked.length).toBe(1)
  expect(seen.toasts).toEqual(['retro: 残す発見はありませんでした'])
})

const SWITCHES: { args: string; text: string; isOn: boolean }[] = [
  { args: 'off', text: 'retro: automatic look-backs are off. /retro still looks back now.', isOn: false },
  { args: 'on', text: 'retro: automatic look-backs are on.', isOn: true },
]

for (const one of SWITCHES) {
  test(`/retro ${one.args} は、自動の振り返りを切り替える`, async ($, on) => {
    const seen = world(on, { stored: stored(5, 0, 0, { isOn: !one.isOn }) })
    await $.session.start(START)

    expect(await $.command.run(command(one.args))).toEqual({ text: one.text })
    expect(seen.store.get('session:s1')).toEqual({ isOn: one.isOn, turns: 5, corrections: 0, stops: 0, found: [], log: [] })
  })
}

test('/retro log は、書き手の報告を新しい順に返す', async ($, on) => {
  world(on, { stored: stored(0, 0, 0, { log: [{ at: 1_000_000_000, agentId: WRITER, text: '- b' }] }) })
  await $.session.start(START)

  const shown = await $.command.run(command('log'))
  // 日時はマシンのタイムゾーンで変わるので、形だけを見る
  expect(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}\n- b$/.test(shown.text ?? '')).toBe(true)
})

test('/retro に読めない引数を渡すと、使い方を返す', async ($, on) => {
  world(on)
  await $.session.start(START)

  expect(await $.command.run(command('now'))).toEqual({ text: 'Usage: /retro [on|off|log]' })
})
