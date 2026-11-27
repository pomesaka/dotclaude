import { expect, test } from 'claude-code/testing'
import type { TestBody } from 'claude-code/testing'
import type { OpenQuestion } from '../types'
import { START, line, questionsPane, world } from './world'

// セッションをまたぐ保留。s1 が束ねる側（PM）、s2 が保留を足した側（担当）。
// 1 つのテストの中で、土台のセッション ID を be で切り替え、同じ $.store を両方から使う

const FOLLOW = 'mcp__questions__follow_session'
const UNFOLLOW = 'mcp__questions__unfollow_session'
const RESOLVE = 'mcp__questions__resolve_question'

const MINE: OpenQuestion = { id: 1, question: '名前をどうするか', detail: '', options: ['pending', 'todo'], assumed: 'pending', answer: null }
const THEIRS: OpenQuestion = { id: 3, question: '上限は何件か', detail: '一覧に覚える数', options: ['50 件', '100 件'], assumed: '100 件', answer: null }
const ANSWER = '【保留への回答】Q3 上限は何件か: 50 件'
const PEER = { origin: { kind: 'peer' as const, plugin: 'questions' }, text: ANSWER }

// 待たずに走らせた処理が済むのを待つ。pane を描く操作は、それまでに始まった処理が済んでから返る
const settle = async ($: Parameters<TestBody>[0]): Promise<void> => {
  const ui = await $.ui.mount(questionsPane)
  await ui.unmount()
}

const FOLLOWED = { 'follow:s1': [{ sessionId: 's2', label: '実装' }] }

test('follow_session で束ねると、相手の保留が名前の見出しと一緒に pane に出る。束ねていないセッションの保留は出ない', async ($, on) => {
  const seen = world(on, { stored: { 'qs:s1': [MINE], 'qs:s2': [THEIRS], 'qs:s9': [{ ...THEIRS, question: '関係の無い問い' }] } })
  await $.session.start(START)

  const called = await $.tool.call({ tool: FOLLOW, session_id: 's2', label: '実装' })
  expect(called.result).toBe('Following 実装 (s2): 1 open there.')
  expect(seen.store.get('follow:s1')).toEqual([{ sessionId: 's2', label: '実装' }])

  const ui = await $.ui.mount(questionsPane)
  expect(await ui.find({ type: 'Text', text: /^名前をどうするか$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^実装 の保留/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^上限は何件か$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^一覧に覚える数$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^関係の無い問い$/ })).toBeUndefined()
  // 相手の保留は、答えるだけ。相談、書く、外すは、持ち主のセッションでする
  expect(await ui.find({ key: 'other-s2-3-0' })).toBeDefined()
  expect(await ui.find({ key: 'explain-3' })).toBeUndefined()
  expect(await ui.find({ key: 'write-3' })).toBeUndefined()
  expect(await ui.find({ key: 'drop-3' })).toBeUndefined()
  await ui.unmount()
})

test('プロンプトの下の pending は、自分と束ねたセッションの保留の合計', async ($, on) => {
  world(on, { stored: { 'qs:s1': [MINE], 'qs:s2': [THEIRS], ...FOLLOWED } })
  await $.session.start(START)
  const ui = await $.ui.mount(line)

  expect(await ui.find({ type: 'Text', text: /^ pending 2 $/ })).toBeDefined()
  await ui.unmount()
})

test('保留の無いセッションは、見出しも出さない', async ($, on) => {
  world(on, { stored: { 'qs:s1': [MINE], 'qs:s2': [], ...FOLLOWED } })
  await $.session.start(START)
  const ui = await $.ui.mount(questionsPane)

  expect(await ui.find({ type: 'Text', text: /^実装 の保留/ })).toBeUndefined()
  await ui.unmount()
})

const DENIED: { name: string; tool: typeof FOLLOW | typeof UNFOLLOW; input: { [key: string]: unknown }; deny: string }[] = [
  { name: '自分を束ねない', tool: FOLLOW, input: { session_id: 's1', label: '自分' }, deny: 'follow_session failed: session_id is this session: its own questions are shown already' },
  { name: '名前の無い束ね', tool: FOLLOW, input: { session_id: 's2' }, deny: 'follow_session failed: label must be a non-empty string (the name the pane shows)' },
  { name: '束ねていないセッションは外せない', tool: UNFOLLOW, input: { session_id: 's9' }, deny: 'unfollow_session failed: s9 is not followed' },
]

for (const one of DENIED) {
  test(`${one.tool}: ${one.name}`, async ($, on) => {
    const seen = world(on, { stored: { ...FOLLOWED } })
    await $.session.start(START)

    const called = await $.tool.call({ tool: one.tool, ...one.input })
    expect(called.deny).toBe(one.deny)
    expect(seen.store.get('follow:s1')).toEqual(FOLLOWED['follow:s1'])
  })
}

test('unfollow_session で外すと、相手の保留は pane から消える。相手の保留そのものは消さない', async ($, on) => {
  const seen = world(on, { stored: { 'qs:s2': [THEIRS], ...FOLLOWED } })
  await $.session.start(START)

  const called = await $.tool.call({ tool: UNFOLLOW, session_id: 's2' })
  expect(called.result).toBe('Stopped following s2.')
  expect(seen.store.get('follow:s1')).toEqual([])
  expect(seen.store.get('qs:s2')).toEqual([THEIRS])
  const ui = await $.ui.mount(questionsPane)
  expect(await ui.find({ type: 'Text', text: /^上限は何件か$/ })).toBeUndefined()
  await ui.unmount()
})

test('束ねた側で押した答えは、保留を足したセッションにだけ届く。届いた側が外すと、束ねた側の pane からも消える', async ($, on) => {
  const seen = world(on, { stored: { 'qs:s1': [MINE], 'qs:s2': [THEIRS], ...FOLLOWED } })
  await $.session.start(START)
  const pm = await $.ui.mount(questionsPane)

  await pm.press({ key: 'other-s2-3-0' })
  expect(seen.sentTo).toHaveLength(1)
  expect(seen.sentTo[0]?.to).toContain('s2')
  expect(seen.sentTo[0]?.text).toBe(ANSWER)
  // 束ねた側の Claude には、何も送らない。自分の保留にも印を付けない
  expect(seen.submitted).toEqual([])
  expect(seen.store.get('qs:s1')).toEqual([MINE])
  expect(seen.toasts.at(-1)).toBe('実装 の Q3 に答えを送りました')
  // 持ち主の一覧は、束ねた側が書かない
  expect(seen.store.get('qs:s2')).toEqual([THEIRS])
  await pm.unmount()

  // ここから担当のセッション。届いた配達は、そのまま Claude に渡し、自分の保留に印を付ける
  seen.be('s2')
  const received = await $.session.receive({ ...PEER, text: seen.sentTo[0]?.text ?? '' })
  expect(received.text).toBe(ANSWER)
  expect(seen.store.get('qs:s2')).toEqual([{ ...THEIRS, answer: '50 件' }])
  await $.tool.call({ tool: RESOLVE, id: 3 })

  // 束ねた側が読み直すと、消えている
  seen.be('s1')
  await $.session.start(START)
  const again = await $.ui.mount(questionsPane)
  expect(await again.find({ type: 'Text', text: /^上限は何件か$/ })).toBeUndefined()
  expect(await again.find({ type: 'Text', text: /^名前をどうするか$/ })).toBeDefined()
  await again.unmount()
})

test('持ち主が答えに印を付けると、束ねた側の pane にも送信済の印が出る', async ($, on) => {
  world(on, { stored: { 'qs:s2': [{ ...THEIRS, answer: '50 件' }], ...FOLLOWED } })
  await $.session.start(START)
  const ui = await $.ui.mount(questionsPane)

  expect(await ui.find({ type: 'Text', text: /^● 50 件$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^送信済$/ })).toBeDefined()
  await ui.unmount()
})

type PeerInput = { agentId?: string; text?: string }

const RECEIVED: { name: string; input: PeerInput; isMarked: boolean }[] = [
  { name: '自分の保留への答えには、印を付ける', input: {}, isMarked: true },
  { name: 'サブエージェントあての配達には、印を付けない', input: { agentId: 'a1' }, isMarked: false },
  { name: '選択肢に無い答えには、印を付けない', input: { text: '【保留への回答】Q3 上限は何件か: 10 件' }, isMarked: false },
  { name: '関係の無いメッセージには、印を付けない', input: { text: 'テストが通りました' }, isMarked: false },
]

for (const one of RECEIVED) {
  test(`届いた配達: ${one.name}。配達はそのまま渡す`, async ($, on) => {
    const seen = world(on, { stored: { 'qs:s2': [THEIRS] } })
    seen.be('s2')
    await $.session.start(START)

    const input = { ...PEER, ...one.input }
    const received = await $.session.receive(input)
    expect(received.text).toBe(input.text)
    expect(seen.store.get('qs:s2')).toEqual([{ ...THEIRS, answer: one.isMarked ? '50 件' : null }])
    expect(seen.submitted).toEqual([])
  })
}

test('相手が止まっていたら、答えを $.store に残し、相手が始まったときに届ける', async ($, on) => {
  const seen = world(on, { stored: { 'qs:s2': [THEIRS], ...FOLLOWED }, stopped: ['s2'] })
  await $.session.start(START)
  const pm = await $.ui.mount(questionsPane)

  await pm.press({ key: 'other-s2-3-0' })
  expect(seen.store.get('ans:s2:3')).toEqual({ option: '50 件' })
  expect(seen.toasts.at(-1)).toBe('実装 は止まっています。Q3 の答えは、そのセッションが再開したときに届きます')
  expect(await pm.find({ type: 'Text', text: /^再開時に届ける$/ })).toBeDefined()
  expect(await pm.find({ type: 'Text', text: /^● 50 件$/ })).toBeDefined()
  await pm.unmount()

  seen.be('s2')
  await $.session.start(START)
  expect(seen.submitted).toEqual([ANSWER])
  expect(seen.store.has('ans:s2:3')).toBe(false)
  expect(seen.store.get('qs:s2')).toEqual([{ ...THEIRS, answer: '50 件' }])
})

test('届け待ちの答えが外した保留あてなら、送らずに消す', async ($, on) => {
  const seen = world(on, { stored: { 'qs:s2': [], 'ans:s2:3': { option: '50 件' } } })
  seen.be('s2')
  await $.session.start(START)

  expect(seen.submitted).toEqual([])
  expect(seen.store.has('ans:s2:3')).toBe(false)
})

test('届け待ちの答えを送れなかったら、$.store に戻して知らせる', async ($, on) => {
  const seen = world(on, { stored: { 'qs:s2': [THEIRS], 'ans:s2:3': { option: '50 件' } }, dropsSubmit: true })
  seen.be('s2')
  await $.session.start(START)
  // 送れなかった後の始末は、送る処理を待たずに走る。pane を描いて、それが済むのを待つ
  await settle($)

  expect(seen.store.get('ans:s2:3')).toEqual({ option: '50 件' })
  expect(seen.store.get('qs:s2')).toEqual([THEIRS])
  expect(seen.toasts.at(-1)).toBe('Q3 の答えを受け取れませんでした。このセッションを開き直すと、もう一度受け取ります')
})

test('ほかのセッションあての届け待ちには触れない', async ($, on) => {
  const seen = world(on, { stored: { 'qs:s1': [{ ...THEIRS }], 'ans:s2:3': { option: '50 件' } } })
  await $.session.start(START)

  expect(seen.submitted).toEqual([])
  expect(seen.store.get('ans:s2:3')).toEqual({ option: '50 件' })
})

test('同じ ID でもう一度束ねると、見出しの名前を置き換える', async ($, on) => {
  const seen = world(on, { stored: { 'qs:s2': [THEIRS], ...FOLLOWED } })
  await $.session.start(START)

  await $.tool.call({ tool: FOLLOW, session_id: 's2', label: '実装の担当' })
  expect(seen.store.get('follow:s1')).toEqual([{ sessionId: 's2', label: '実装の担当' }])
  const ui = await $.ui.mount(questionsPane)
  expect(await ui.find({ type: 'Text', text: /^実装の担当 の保留/ })).toBeDefined()
  await ui.unmount()
})

test('束ねた側は、見回りのたびに $.store を読み直す。持ち主が足した保留は出て、外した保留は消える', async ($, on) => {
  const seen = world(on, { stored: { 'qs:s2': [THEIRS], ...FOLLOWED } })
  await $.session.start(START)

  // 持ち主（s2）が、別のプロセスで一覧を書き換えた
  seen.store.set('qs:s2', [{ ...THEIRS, id: 4, question: '並びをどうするか' }])
  seen.tick()
  const ui = await $.ui.mount(questionsPane)
  expect(await ui.find({ type: 'Text', text: /^並びをどうするか$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^上限は何件か$/ })).toBeUndefined()
  await ui.unmount()
})

test('持ち主は、見回りのたびに自分あての届け待ちを受け取る', async ($, on) => {
  const seen = world(on, { stored: { 'qs:s2': [THEIRS] } })
  seen.be('s2')
  await $.session.start(START)

  // 束ねた側が、届かなかった答えを置いた
  seen.store.set('ans:s2:3', { option: '50 件' })
  seen.tick()
  await settle($)
  expect(seen.submitted).toEqual([ANSWER])
  expect(seen.asUser).toEqual([])
  expect(seen.store.has('ans:s2:3')).toBe(false)
})

test('send が失敗しても、答えを $.store に残す', async ($, on) => {
  const seen = world(on, { stored: { 'qs:s2': [THEIRS], ...FOLLOWED }, failsSend: true })
  await $.session.start(START)
  const pm = await $.ui.mount(questionsPane)

  await pm.press({ key: 'other-s2-3-1' })
  expect(seen.store.get('ans:s2:3')).toEqual({ option: '100 件' })
  expect(await pm.find({ type: 'Text', text: /^再開時に届ける$/ })).toBeDefined()
  await pm.unmount()
})

test('受け取れずに戻した答えは、見回りでは受け取り直さない', async ($, on) => {
  const seen = world(on, { stored: { 'qs:s2': [THEIRS], 'ans:s2:3': { option: '50 件' } }, dropsSubmit: true })
  seen.be('s2')
  await $.session.start(START)
  await settle($)
  seen.tick()
  await settle($)

  expect(seen.toasts.filter(one => one.startsWith('Q3 の答えを受け取れませんでした'))).toHaveLength(1)
  expect(seen.store.get('ans:s2:3')).toEqual({ option: '50 件' })
})

test('届け待ちの後に答え直して届いたら、古い届け待ちは消す', async ($, on) => {
  const seen = world(on, { stored: { 'qs:s2': [THEIRS], 'ans:s2:3': { option: '100 件' }, ...FOLLOWED } })
  await $.session.start(START)
  const pm = await $.ui.mount(questionsPane)

  await pm.press({ key: 'other-s2-3-0' })
  expect(seen.store.has('ans:s2:3')).toBe(false)
  expect(await pm.find({ type: 'Text', text: /^再開時に届ける$/ })).toBeUndefined()
  await pm.unmount()
})

test('ツールの呼び出しの中では、自分あての届け待ちを受け取らない。次の見回りで受け取る', async ($, on) => {
  const seen = world(on, { stored: { 'qs:s1': [{ ...THEIRS }] } })
  await $.session.start(START)
  seen.store.set('ans:s1:3', { option: '50 件' })

  await $.tool.call({ tool: FOLLOW, session_id: 's2', label: '実装' })
  expect(seen.submitted).toEqual([])
  expect(seen.store.get('ans:s1:3')).toEqual({ option: '50 件' })

  seen.tick()
  await settle($)
  expect(seen.submitted).toEqual([ANSWER])
})
