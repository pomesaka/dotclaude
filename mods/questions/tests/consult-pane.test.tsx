import { expect, test } from 'claude-code/testing'
import type { TestBody } from 'claude-code/testing'
import type { OpenQuestion } from '../types'
import { SUMMARY_PROMPT, consultPrompt } from '../hooks/consult'
import { AGENT, END, START, consultPane, consultPaneViewing, questionsPane, world } from './world'
import type { Given } from './world'

const Q1: OpenQuestion = { id: 1, question: '上限は何件か', detail: '一覧に覚える数', options: ['50 件', '100 件'], assumed: '100 件', answer: null }
const Q2: OpenQuestion = { id: 2, question: '名前をどうするか', detail: '', options: ['pending', 'todo'], assumed: 'pending', answer: null }
const STORED = { 'qs:s1': [Q1, Q2] }
// 利用者が、相談の中で 1 度聞いた会話
const TALKED: Given['talk'] = [
  { role: 'user', text: '依頼' },
  { role: 'assistant', text: '説明' },
  { role: 'user', text: '見出しも変わる？' },
  { role: 'assistant', text: '変わりません。' },
]

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

// 待たずに始めた処理が終わるまで、描き直しを待つ
const until = async (ui: { find: (query: { key: string }) => Promise<unknown> }, isDone: () => boolean): Promise<void> => {
  for (let tries = 0; tries < 50 && !isDone(); tries++) await ui.find({ key: 'close' })
}
const submittedBy = async (seen: Seen, ui: { find: (query: { key: string }) => Promise<unknown> }): Promise<string[]> => {
  await until(ui, () => seen.submitted.length > 0)
  return seen.submitted
}

test('「詳しく聞く」を押すと、会話を引き継いだエージェントを立てて、相談の pane を開く。メインには何も送らない', async ($, on) => {
  const seen = world(on, { stored: STORED })
  await begin($)

  expect(seen.spawned).toEqual([consultPrompt(Q2, undefined)])
  expect(seen.opened).toEqual(['consult'])
  expect(seen.submitted).toEqual([])
  // 開いている相談を、セッションごとに覚える
  expect(seen.store.get('consult:s1')).toEqual({ question: Q2, agentId: AGENT })

  const ui = await $.ui.mount(consultPane)
  expect(await ui.find({ type: 'Text', text: /^Q2$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^名前をどうするか$/ })).toBeDefined()
  // 会話は pane に描かず、エージェントの会話の画面への行き方を出す
  expect(await ui.find({ type: 'Text', text: /会話は「Q2 の相談」の画面でします/ })).toBeDefined()
  expect(await ui.find({ key: 'decide-0' })).toBeDefined()
  expect(await ui.find({ key: 'conclude' })).toBeDefined()
  await ui.unmount()
})

test('最初の説明の頼み方は、環境変数で差し替えられる', async ($, on) => {
  const seen = world(on, { stored: STORED, env: { QLIST_EXPLAIN_PROMPT: '/explain-inline で説明して' } })
  await begin($)

  expect(seen.spawned).toEqual([consultPrompt(Q2, '/explain-inline で説明して')])
})

test('相談の会話を開いているあいだは、行き方の代わりに、戻り方を出す', async ($, on) => {
  world(on, { stored: STORED })
  await begin($)

  const ui = await $.ui.mount(consultPaneViewing)
  expect(await ui.find({ type: 'Text', text: /いま、この相談の会話を開いています/ })).toBeDefined()
  expect(await ui.find({ key: 'tasks' })).toBeUndefined()
  await ui.unmount()
})

test('「一覧を開く」を押すと、/tasks を実行する', async ($, on) => {
  const seen = world(on, { stored: STORED })
  await begin($)
  const ui = await $.ui.mount(consultPane)

  await ui.press({ key: 'tasks' })
  expect(seen.commands).toEqual(['tasks'])
  await ui.unmount()
})

test('問いを送っていない相談で選択肢を押すと、保留の pane で選んだときと同じ文をメインへ送って、相談を閉じる', async ($, on) => {
  const seen = world(on, { stored: STORED })
  await begin($)
  const ui = await $.ui.mount(consultPane)

  await ui.press({ key: 'decide-1' })
  expect(await submittedBy(seen, ui)).toEqual(['【保留への回答】Q2 名前をどうするか: todo'])
  // 要約は頼まない
  expect(seen.sent).toEqual([])
  expect(seen.store.get('qs:s1')).toEqual([Q1, { ...Q2, answer: 'todo' }])
  await until(ui, () => seen.closed.length > 0)
  expect(seen.closed).toEqual(['consult'])
  expect(seen.store.get('consult:s1')).toBeUndefined()
  await ui.unmount()
})

test('問いを送った相談で選択肢を押すと、エージェントに要約を頼み、選んだ答えに要約を付けてメインへ送る', async ($, on) => {
  const seen = world(on, { stored: STORED, talk: TALKED })
  await begin($)
  const ui = await $.ui.mount(consultPane)

  await ui.press({ key: 'decide-1' })
  await until(ui, () => seen.sent.length > 0)
  expect(seen.sent).toEqual([SUMMARY_PROMPT])
  expect(seen.submitted).toEqual([])
  expect(await ui.find({ type: 'Text', text: /^相談の要約を作って、メインへ送ります…$/ })).toBeDefined()

  await reply($, 'todo にする。見出しは英語のまま変えない。')
  expect(await submittedBy(seen, ui)).toEqual(['【保留への回答】Q2 名前をどうするか: todo\n相談で決まったこと: todo にする。見出しは英語のまま変えない。'])
  expect(seen.store.get('qs:s1')).toEqual([Q1, { ...Q2, answer: 'todo' }])
  await until(ui, () => seen.closed.length > 0)
  expect(seen.closed).toEqual(['consult'])
  await ui.unmount()
})

test('「選択肢に無い結論を送る」を押すと、要約だけをメインへ送る。保留に答えの印は付けない', async ($, on) => {
  const seen = world(on, { stored: STORED, talk: TALKED })
  await begin($)
  const ui = await $.ui.mount(consultPane)

  await ui.press({ key: 'conclude' })
  await until(ui, () => seen.sent.length > 0)
  await reply($, 'backlog にする。')
  expect(await submittedBy(seen, ui)).toEqual(['Q2（名前をどうするか）について相談した結論: backlog にする。'])
  expect(seen.store.get('qs:s1')).toEqual([Q1, Q2])
  await until(ui, () => seen.closed.length > 0)
  expect(seen.closed).toEqual(['consult'])
  await ui.unmount()
})

const NO_CONCLUSION: { name: string; talk: Given['talk']; summary: string | null }[] = [
  { name: '要約に決まったことが無い', talk: TALKED, summary: 'なし' },
  { name: '問いを送っていない', talk: undefined, summary: null },
]

for (const one of NO_CONCLUSION) {
  test(`選択肢に無い結論は、${one.name}ときは送らずに知らせる`, async ($, on) => {
    const seen = world(on, { stored: STORED, talk: one.talk })
    await begin($)
    const ui = await $.ui.mount(consultPane)

    await ui.press({ key: 'conclude' })
    if (one.summary !== null) {
      await until(ui, () => seen.sent.length > 0)
      await reply($, one.summary)
    }
    await until(ui, () => seen.toasts.length > 0)
    expect(seen.toasts).toEqual(['相談から結論を読み取れませんでした。選択肢を押すか、保留の一覧の「ほかの答えを書く」で書いてください'])
    expect(seen.submitted).toEqual([])
    expect(seen.closed).toEqual([])
    await ui.unmount()
  })
}

test('エージェントが答えている最中は、結論を送らずに知らせる', async ($, on) => {
  const seen = world(on, { stored: STORED, agentStatus: 'running' })
  await begin($)
  const ui = await $.ui.mount(consultPane)

  await ui.press({ key: 'decide-1' })
  await until(ui, () => seen.toasts.length > 0)
  expect(seen.toasts).toEqual(['相談用のエージェントが答えている最中です。答えが出てから押してください'])
  expect(seen.submitted).toEqual([])
  expect(seen.sent).toEqual([])
  await ui.unmount()
})

test('同じ保留の「詳しく聞く」をもう一度押しても、エージェントを立て直さずに pane を開き直す', async ($, on) => {
  const seen = world(on, { stored: STORED })
  await begin($)

  const list = await $.ui.mount(questionsPane)
  await list.press({ key: 'explain-2' })
  expect(seen.spawned.length).toBe(1)
  expect(seen.opened).toEqual(['consult', 'consult'])

  // 別の保留なら、新しく立てる
  await list.press({ key: 'explain-1' })
  expect(seen.spawned).toEqual([consultPrompt(Q2, undefined), consultPrompt(Q1, undefined)])
  await list.unmount()
})

test('相談用のエージェントが一覧から外されていたら、「詳しく聞く」で立て直す', async ($, on) => {
  const seen = world(on, { stored: STORED })
  await begin($)
  expect(seen.spawned.length).toBe(1)

  // エンジンは、答え終わったエージェントを、会話を開いていないと 30 秒で外す
  seen.evict()
  const list = await $.ui.mount(questionsPane)
  await list.press({ key: 'explain-2' })
  expect(seen.spawned).toEqual([consultPrompt(Q2, undefined), consultPrompt(Q2, undefined)])
  await list.unmount()
})

test('Mod の記憶が消えても、覚えている相談を pane に戻す', async ($, on) => {
  // 相談を始めた後に、セッションを裏に回して戻した状態。$.store にだけ残っている
  world(on, { stored: { ...STORED, 'consult:s1': { question: Q2, agentId: AGENT } } })

  const ui = await $.ui.mount(consultPane)
  expect(await ui.find({ type: 'Text', text: /^名前をどうするか$/ })).toBeDefined()
  expect(await ui.find({ key: 'decide-1' })).toBeDefined()
  await ui.unmount()
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
  world(on, { stored: STORED })
  await begin($)

  const called = await $.tool.call({ tool: 'Write', file_path: '/repo/a.txt', content: 'x' })
  expect(called.deny).toBeUndefined()
})
