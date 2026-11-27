import { expect, test, type TestBody } from 'claude-code/testing'

type On = Parameters<TestBody>[1]
type Engine = Parameters<TestBody>[0]

const START = { cwd: '/repo', surface: 'terminal', isInteractive: true } as const
const END = { turnId: 't1', answer: '直しました。', durationMs: 0, isAborted: false, reason: 'answer' } as const
const USAGE = { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }
const FINDING = { title: '公開の前に名前を確かめる', detail: '公開リポジトリに案件名を書かない', evidence: '2026-11-13 に指摘された', kind: 'doc', isSevere: false, same: null }
const REPLY = JSON.stringify({ findings: [FINDING] })
// 控えに 1 回ある発見と、それと同じだと答える返事。2 回目なので文書に上げる
const COUNTED = { id: 'c1', title: FINDING.title, detail: FINDING.detail, kind: 'doc', count: 1, evidence: ['前の回'], lastAt: 1, writtenAt: null }
const AGAIN = JSON.stringify({ findings: [{ ...FINDING, same: 'c1' }] })
// 控えの出来事のファイル。s0 はほかのセッション、s1 はこのセッション
const HOME = '/Users/p'
const DIR = `${HOME}/.claude/retro`
const OWN = `${DIR}/s1.jsonl`
const OTHER = `${DIR}/s0.jsonl`
const NOW = 1_000_000_000
const line = (event: object): string => `${JSON.stringify(event)}\n`
// ほかのセッションで c1 が 1 回出ている
const COUNTED_FILES = { [OTHER]: line({ type: 'seen', id: 'c1', title: FINDING.title, detail: FINDING.detail, kind: 'doc', evidence: '前の回', target: null, at: 1 }) }
// ファイルの行を出来事として読む
const eventsIn = (text: string | undefined): { [key: string]: unknown }[] =>
  (text ?? '')
    .split('\n')
    .filter(one => one !== '')
    .map(one => JSON.parse(one))
const WRITER = 'w1'
// compact する会話。エンジンは空の会話の compact を拒む
const MESSAGES = [{ role: 'user' as const, text: '直して', toolUses: [] }]

const command = (args: string) => ({ command: 'retro', args, origin: { kind: 'composer' as const }, presentation: { isFullscreen: false, columns: 177 } })

type Given = {
  stored?: { [key: string]: unknown }
  // 分岐して聞いたモデルの返事。null は、モデルが文を返さなかった
  reply?: string | null
  // エージェントを立てるのを断る
  isSpawnDenied?: boolean
  // ~/.claude/retro/ の下のファイル
  files?: { [path: string]: string }
  // HOME が取れない
  isHomeless?: boolean
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
    files: new Map(Object.entries(given.files ?? {})),
    // fs.write で書いた先のパス
    written: [] as string[],
  }
  on('env.get', (_$, e) => ({ value: e.name === 'HOME' && given.isHomeless !== true ? HOME : undefined }))
  on('fs.exists', (_$, e) => ({ value: seen.files.has(e.path) || (e.path === DIR && seen.files.size > 0) }))
  on('fs.read', (_$, e) => ({ value: seen.files.get(e.path) ?? '' }))
  on('fs.write', (_$, e) => {
    seen.files.set(e.path, e.text)
    seen.written.push(e.path)
    return { value: undefined }
  })
  on('fs.list', () => ({ value: [...seen.files.keys()].map(path => ({ name: path.slice(path.lastIndexOf('/') + 1), kind: 'file' as const, size: 0, mtimeMs: 0, isLink: false })) }))
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
    if (given.isSpawnDenied === true) return { deny: 'denied' }
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

test('20 ターンたち、そのあいだに直されていたら、分岐に聞いて控えに数える。1 回目は文書に書かない', async ($, on) => {
  const seen = world(on, { stored: stored(19, 1, 0) })
  await $.session.start(START)

  await turns($, 1)
  expect(seen.asked.length).toBe(1)
  expect(seen.spawned).toEqual([])
  expect(seen.store.get('session:s1')).toEqual({ isOn: true, turns: 0, corrections: 0, stops: 0, found: ['公開の前に名前を確かめる'], log: [] })
  // 控えは $.store でなく、このセッションのファイルに 1 行足す
  expect(seen.store.has('candidates')).toBe(false)
  expect(seen.written.every(path => path === OWN)).toBe(true)
  const [event] = eventsIn(seen.files.get(OWN))
  expect({ ...event, id: undefined }).toEqual({ type: 'seen', id: undefined, title: FINDING.title, detail: FINDING.detail, kind: 'doc', evidence: FINDING.evidence, target: null, at: NOW })
  expect(seen.toasts).toEqual(['retro: 1 件を控えに数えました'])
  // メインには何も送らない
  expect(seen.submitted).toEqual([])
})

test('分岐には、ほかのセッションも含めた控えの見出しを渡す', async ($, on) => {
  const seen = world(on, { stored: stored(19, 1, 0), files: COUNTED_FILES })
  await $.session.start(START)

  await turns($, 1)
  expect(seen.asked[0]?.includes('<candidates>\n- c1（文書）公開の前に名前を確かめる\n</candidates>')).toBe(true)
})

test('控えと同じ発見が 2 回目に出たら、会話を持たない書き手をメインと同じモデルで立て、回数を 0 に戻す', async ($, on) => {
  const seen = world(on, { stored: stored(19, 1, 0), files: COUNTED_FILES, reply: AGAIN })
  await $.session.start(START)

  await turns($, 1)
  expect(seen.spawned.map(one => ({ subagentType: one.subagentType, model: one.model }))).toEqual([{ subagentType: 'general-purpose', model: undefined }])
  expect(seen.spawned[0]?.prompt.includes('"count": 2')).toBe(true)
  // ほかのセッションのファイルは書き換えず、自分のファイルに seen と written を足す
  expect(seen.files.get(OTHER)).toBe(COUNTED_FILES[OTHER])
  expect(eventsIn(seen.files.get(OWN)).map(one => [one.type, one.id])).toEqual([
    ['seen', 'c1'],
    ['written', 'c1'],
  ])
  expect(seen.toasts).toEqual(['retro: 1 件を控えに数えました。くり返し出た 1 件を文書に書いています'])
})

// 1 回目でも、どう扱うかが決まる発見
const FIRSTS: { name: string; finding: object; spawned: number; toast: string }[] = [
  { name: '害の大きい発見は、1 回目でも文書に書く', finding: { ...FINDING, isSevere: true }, spawned: 1, toast: 'retro: 1 件を控えに数えました。くり返し出た 1 件を文書に書いています' },
  {
    name: '仕組みで防げる発見は、害が大きくても文書に書かず、候補として知らせる',
    finding: { ...FINDING, kind: 'mechanism', isSevere: true },
    spawned: 0,
    toast: 'retro: 1 件を控えに数えました（仕組みの候補 1 件。/retro candidates で読めます）',
  },
]

for (const one of FIRSTS) {
  test(one.name, async ($, on) => {
    const seen = world(on, { stored: stored(19, 1, 0), reply: JSON.stringify({ findings: [one.finding] }) })
    await $.session.start(START)

    await turns($, 1)
    expect(seen.spawned.length).toBe(one.spawned)
    expect(seen.toasts).toEqual([one.toast])
  })
}

test('書き手を立てられなかったら、回数を残して次に上げ直す', async ($, on) => {
  const seen = world(on, { stored: stored(19, 1, 0), files: COUNTED_FILES, reply: AGAIN, isSpawnDenied: true })
  await $.session.start(START)

  await turns($, 1)
  expect(eventsIn(seen.files.get(OWN)).map(one => [one.type, one.id])).toEqual([['seen', 'c1']])
  expect(((await $.command.run(command('candidates')))?.text ?? '').startsWith('c1  2 回  文書')).toBe(true)
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
  const seen = world(on, { stored: stored(3, 0, 0), files: COUNTED_FILES, reply: AGAIN })
  await $.session.start(START)

  await $.session.compact({ trigger: 'manual', messages: MESSAGES })
  expect(seen.asked.length).toBe(1)
  expect(seen.spawned.length).toBe(1)
})

test('書き手が終わったら、報告を残して知らせる。終わった知らせはメインに届けない', async ($, on) => {
  const seen = world(on, { stored: stored(19, 1, 0), files: COUNTED_FILES, reply: AGAIN })
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
  const seen = world(on, { stored: stored(19, 1, 0), files: COUNTED_FILES, reply: AGAIN })
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

  expect(await $.command.run(command('now'))).toEqual({ text: 'Usage: /retro [on|off|log|candidates|drop <id>]' })
})

test('/retro candidates は控えを回数の多い順に返し、/retro drop で 1 件を外す', async ($, on) => {
  const other = { ...COUNTED, id: 'c2', title: '書いたファイルが差分に出るかを見る', detail: 'Write の後に hook で知らせる', kind: 'mechanism', count: 3, target: null }
  const seen = world(on, { files: { [OTHER]: `${COUNTED_FILES[OTHER]}${line({ type: 'imported', candidate: other, at: 2 })}` } })
  await $.session.start(START)

  expect(await $.command.run(command('candidates'))).toEqual({
    text: 'c2  3 回  仕組み  書いたファイルが差分に出るかを見る\n    Write の後に hook で知らせる\nc1  1 回  文書  公開の前に名前を確かめる\n    公開リポジトリに案件名を書かない',
  })
  expect(await $.command.run(command('drop c2'))).toEqual({ text: 'retro: dropped c2.' })
  // 外した出来事は自分のファイルに足し、ほかのセッションのファイルは書き換えない
  expect(eventsIn(seen.files.get(OWN)).map(one => [one.type, one.id])).toEqual([['dropped', 'c2']])
  expect(((await $.command.run(command('candidates')))?.text ?? '').includes('c2')).toBe(false)
  expect(await $.command.run(command('drop c9'))).toEqual({ text: 'retro: no counted finding has the id c9. /retro candidates lists them.' })
})

// Claude が直した後に、利用者に /retro drop を頼まずに外す
const DROP_CALLS: { name: string; input: { [key: string]: unknown }; outcome: { result: string } | { deny: string }; dropped: string[] }[] = [
  { name: '控えにある id', input: { id: 'c1' }, outcome: { result: 'retro: dropped c1.' }, dropped: ['c1'] },
  { name: '大文字と前後の空白は落とす', input: { id: ' C1 ' }, outcome: { result: 'retro: dropped c1.' }, dropped: ['c1'] },
  { name: '控えに無い id', input: { id: 'c9' }, outcome: { deny: 'retro: no counted finding has the id c9. /retro candidates lists them.' }, dropped: [] },
  { name: 'id が無い', input: {}, outcome: { deny: 'drop_finding failed: pass the id of a counted finding' }, dropped: [] },
]

for (const { name, input, outcome, dropped } of DROP_CALLS) {
  test(`drop_finding: ${name}`, async ($, on) => {
    const seen = world(on, { files: COUNTED_FILES })
    await $.session.start(START)

    expect(await $.tool.call({ tool: 'mcp__retro__drop_finding', ...input })).toEqual(outcome)
    expect(eventsIn(seen.files.get(OWN)).filter(one => one.type === 'dropped').map(one => one.id)).toEqual(dropped)
  })
}

// 前の版が $.store に持っていた控えを、ファイルへ移す
const LEGACY = { candidates: { next: 2, list: [COUNTED, { id: 'c2', title: '形が合わない' }] } }
const MIGRATIONS: { name: string; stored: { [key: string]: unknown }; files: { [path: string]: string }; imported: string[]; isKeyKept: boolean }[] = [
  { name: 'ファイルが無く古い控えがあれば、形の合う控えを imported にして、キーを消す', stored: LEGACY, files: {}, imported: ['c1'], isKeyKept: false },
  { name: 'ファイルがもうあれば、移さずにキーだけ消す', stored: LEGACY, files: COUNTED_FILES, imported: [], isKeyKept: false },
  { name: '古い控えが無ければ、何も書かない', stored: {}, files: {}, imported: [], isKeyKept: false },
]

for (const one of MIGRATIONS) {
  test(`移し替え: ${one.name}`, async ($, on) => {
    const seen = world(on, { stored: one.stored, files: one.files })
    await $.session.start(START)

    await $.command.run(command('candidates'))
    await $.command.run(command('candidates'))
    const imported = eventsIn(seen.files.get(OWN)).filter(event => event.type === 'imported')
    expect(imported.map(event => Reflect.get(Object(event.candidate), 'id'))).toEqual(one.imported)
    expect(seen.store.has('candidates')).toBe(one.isKeyKept)
  })
}

test('移した控えと同じ発見が出たら、2 回目として文書に上げる', async ($, on) => {
  const seen = world(on, { stored: { ...stored(19, 1, 0), ...LEGACY }, reply: AGAIN })
  await $.session.start(START)

  await turns($, 1)
  expect(seen.spawned.length).toBe(1)
})

test('HOME が取れなければ、控えに数えず、文書にも上げない', async ($, on) => {
  const seen = world(on, { stored: stored(19, 1, 0), reply: AGAIN, isHomeless: true })
  await $.session.start(START)

  await turns($, 1)
  expect(seen.written).toEqual([])
  expect(seen.spawned).toEqual([])
  expect(await $.command.run(command('candidates'))).toEqual({ text: 'retro: HOME is not set, so there are no counted findings.' })
})

test('スキルやエージェントの使いにくさは、要望として対象の名前と数え、文書に書かない', async ($, on) => {
  const request = { ...FINDING, title: '設計表が長すぎる', kind: 'request', isSevere: true, target: 'test-designer' }
  const seen = world(on, { stored: stored(19, 1, 0), reply: JSON.stringify({ findings: [request] }) })
  await $.session.start(START)

  await turns($, 1)
  expect(seen.spawned).toEqual([])
  expect(seen.toasts).toEqual(['retro: 1 件を控えに数えました（スキルやエージェントへの要望 1 件。/retro candidates で読めます）'])
  expect(((await $.command.run(command('candidates')))?.text ?? '').includes('1 回  要望: test-designer  設計表が長すぎる')).toBe(true)
})
