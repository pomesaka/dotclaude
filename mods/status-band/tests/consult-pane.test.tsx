import { expect, test } from 'claude-code/testing'
import type { TestBody } from 'claude-code/testing'
import type { OpenQuestion } from '../types'
import { SUMMARY_PROMPT, consultPrompt } from '../hooks/consult'
import { AGENT, END, START, consultPane, questionsPane, world } from './world'

const Q1: OpenQuestion = { id: 1, question: '上限は何件か', detail: '一覧に覚える数', options: ['50 件', '100 件'], assumed: '100 件', answer: null }
const Q2: OpenQuestion = { id: 2, question: '名前をどうするか', detail: '', options: ['pending', 'todo'], assumed: 'pending', answer: null }

type Kit = Parameters<TestBody>[0]
type Seen = ReturnType<typeof world>

// 保留の pane で Q2 の「詳しく聞く」を押して、相談を始める
const begin = async ($: Kit): Promise<void> => {
  await $.session.start(START)
  const list = await $.ui.mount(questionsPane)
  await list.press({ key: 'explain-2' })
  await list.unmount()
}

// 相談用のエージェントが、答えて 1 ターンを終える
const reply = ($: Kit, answer: string) => $.turn.complete({ ...END, turnId: 'sub', agentId: AGENT, answer })

// 待たずに始めた送信が終わるまで、描き直しを待つ
const submittedBy = async (seen: Seen, ui: { find: (query: { key: string }) => Promise<unknown> }): Promise<string[]> => {
  for (let tries = 0; tries < 50 && seen.submitted.length === 0; tries++) await ui.find({ key: 'close' })
  return seen.submitted
}

test('「詳しく聞く」を押すと、会話を引き継いだエージェントを立てて、相談の pane を開く。メインには何も送らない', async ($, on) => {
  const seen = world(on, { stored: { 'qs:s1': [Q1, Q2] } })
  await begin($)

  expect(seen.spawned).toEqual([consultPrompt(Q2)])
  expect(seen.opened).toEqual(['consult'])
  expect(seen.submitted).toEqual([])

  const ui = await $.ui.mount(consultPane)
  expect(await ui.find({ type: 'Text', text: /^Q2$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^名前をどうするか$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^考えています…$/ })).toBeDefined()
  // 問いを送るまでは、選択肢に無い結論を送るボタンを出さない
  expect(await ui.find({ key: 'conclude' })).toBeUndefined()

  await reply($, 'pending は GitHub の用語に合わせた名前です。')
  expect(await ui.find({ type: 'Markdown' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^考えています…$/ })).toBeUndefined()
  await ui.unmount()
})

test('相談の pane で打った問いは、エージェントへ送る。メインには送らない', async ($, on) => {
  const seen = world(on, { stored: { 'qs:s1': [Q1, Q2] } })
  await begin($)
  await reply($, '説明です。')
  const ui = await $.ui.mount(consultPane)

  await ui.input({ key: 'ask-0', text: 'todo だと何が困る？' })
  expect(seen.sent).toEqual(['todo だと何が困る？'])
  expect(seen.submitted).toEqual([])
  expect(await ui.find({ type: 'Text', text: /^todo だと何が困る？$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^考えています…$/ })).toBeDefined()
  // 送った後の入力欄は、空の新しい部品になる
  expect(await ui.find({ key: 'ask-1' })).toBeDefined()

  await reply($, 'ほかの一覧と名前が重なります。')
  expect((await ui.findAll({ type: 'Markdown' })).length).toBe(2)
  expect(await ui.find({ key: 'conclude' })).toBeDefined()
  await ui.unmount()
})

test('答えを待っているあいだに打った問いも、エージェントへ送る', async ($, on) => {
  const seen = world(on, { stored: { 'qs:s1': [Q1, Q2] } })
  await begin($)
  const ui = await $.ui.mount(consultPane)

  await ui.input({ key: 'ask-0', text: '先に聞くけど、todo は？' })
  expect(seen.sent).toEqual(['先に聞くけど、todo は？'])
  expect(seen.toasts).toEqual([])
  await ui.unmount()
})

test('結論を送っている最中に打った問いは、送らずに知らせる', async ($, on) => {
  const seen = world(on, { stored: { 'qs:s1': [Q1, Q2] } })
  await begin($)
  await reply($, '説明です。')
  const ui = await $.ui.mount(consultPane)
  await ui.input({ key: 'ask-0', text: '見出しも変わる？' })
  await reply($, '変わりません。')
  await ui.press({ key: 'decide-1' })
  expect(await ui.find({ type: 'Text', text: /^相談の要約を作って、メインへ送ります…$/ })).toBeDefined()

  await ui.input({ key: 'ask-1', text: 'やっぱり待って' })
  expect(seen.sent).toEqual(['見出しも変わる？', SUMMARY_PROMPT])
  expect(seen.toasts).toEqual(['結論をメインへ送っているところです'])
  await ui.unmount()
})

test('問いを送らずに選択肢を押すと、保留の pane で選んだときと同じ文をメインへ送って、相談を閉じる', async ($, on) => {
  const seen = world(on, { stored: { 'qs:s1': [Q1, Q2] } })
  await begin($)
  await reply($, '説明です。')
  const ui = await $.ui.mount(consultPane)

  await ui.press({ key: 'decide-1' })
  expect(await submittedBy(seen, ui)).toEqual(['【保留への回答】Q2 名前をどうするか: todo'])
  // 要約は頼まない
  expect(seen.sent).toEqual([])
  expect(seen.store.get('qs:s1')).toEqual([Q1, { ...Q2, answer: 'todo' }])
  expect(seen.closed).toEqual(['consult'])
  await ui.unmount()
})

test('問いを送った後に選択肢を押すと、エージェントに要約を頼み、選んだ答えに要約を付けてメインへ送る', async ($, on) => {
  const seen = world(on, { stored: { 'qs:s1': [Q1, Q2] } })
  await begin($)
  await reply($, '説明です。')
  const ui = await $.ui.mount(consultPane)
  await ui.input({ key: 'ask-0', text: '見出しも変わる？' })
  await reply($, '見出しは変えずに済みます。')

  await ui.press({ key: 'decide-1' })
  expect(seen.sent).toEqual(['見出しも変わる？', SUMMARY_PROMPT])
  expect(seen.submitted).toEqual([])
  expect(await ui.find({ type: 'Text', text: /^相談の要約を作って、メインへ送ります…$/ })).toBeDefined()

  await reply($, 'todo にする。見出しは英語のまま変えない。')
  expect(await submittedBy(seen, ui)).toEqual(['【保留への回答】Q2 名前をどうするか: todo\n相談で決まったこと: todo にする。見出しは英語のまま変えない。'])
  expect(seen.store.get('qs:s1')).toEqual([Q1, { ...Q2, answer: 'todo' }])
  expect(seen.closed).toEqual(['consult'])
  await ui.unmount()
})

test('「選択肢に無い結論を送る」を押すと、要約だけをメインへ送る。保留に答えの印は付けない', async ($, on) => {
  const seen = world(on, { stored: { 'qs:s1': [Q1, Q2] } })
  await begin($)
  await reply($, '説明です。')
  const ui = await $.ui.mount(consultPane)
  await ui.input({ key: 'ask-0', text: 'backlog はどう？' })
  await reply($, 'それも合います。')

  await ui.press({ key: 'conclude' })
  await reply($, 'backlog にする。')
  expect(await submittedBy(seen, ui)).toEqual(['Q2（名前をどうするか）について相談した結論: backlog にする。'])
  expect(seen.store.get('qs:s1')).toEqual([Q1, Q2])
  expect(seen.closed).toEqual(['consult'])
  await ui.unmount()
})

test('要約に決まったことが無ければ、選択肢に無い結論は送らずに知らせる', async ($, on) => {
  const seen = world(on, { stored: { 'qs:s1': [Q1, Q2] } })
  await begin($)
  await reply($, '説明です。')
  const ui = await $.ui.mount(consultPane)
  await ui.input({ key: 'ask-0', text: 'ほかに案は？' })
  await reply($, 'ありません。')

  await ui.press({ key: 'conclude' })
  await reply($, 'なし')
  for (let tries = 0; tries < 50 && seen.toasts.length === 0; tries++) await ui.find({ key: 'close' })
  expect(seen.toasts).toEqual(['相談から結論を読み取れませんでした。選択肢を押すか、入力欄で答えを書いてください'])
  expect(seen.submitted).toEqual([])
  expect(seen.closed).toEqual([])
  await ui.unmount()
})

test('同じ保留の「詳しく聞く」をもう一度押しても、エージェントを立て直さずに pane を開き直す', async ($, on) => {
  const seen = world(on, { stored: { 'qs:s1': [Q1, Q2] } })
  await begin($)
  await reply($, '説明です。')

  const list = await $.ui.mount(questionsPane)
  await list.press({ key: 'explain-2' })
  expect(seen.spawned.length).toBe(1)
  expect(seen.opened).toEqual(['consult', 'consult'])

  // 別の保留なら、新しく立てる
  await list.press({ key: 'explain-1' })
  expect(seen.spawned).toEqual([consultPrompt(Q2), consultPrompt(Q1)])
  await list.unmount()
})

test('相談を始めていなければ、pane にその旨を出す', async ($, on) => {
  world(on)

  const ui = await $.ui.mount(consultPane)
  expect(await ui.find({ type: 'Text', text: /相談は開いていません/ })).toBeDefined()
  expect(await ui.find({ key: 'close' })).toBeDefined()
  await ui.unmount()
})

// WHY 相談用のエージェントの側を試さない: テストの $.tool.call には agentId を渡せない。通すかどうかの判定は consult.test.ts で試している
test('メインのツールの呼び出しは、相談を開いていても拒まない', async ($, on) => {
  world(on, { stored: { 'qs:s1': [Q1, Q2] } })
  await begin($)

  const called = await $.tool.call({ tool: 'Write', file_path: '/repo/a.txt', content: 'x' })
  expect(called.deny).toBeUndefined()
})
