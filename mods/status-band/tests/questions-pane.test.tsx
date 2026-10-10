import { expect, test } from 'claude-code/testing'
import type { OpenQuestion } from '../types'
import { START, line, questionsPane, world } from './world'

const ADD = 'mcp__status-band__add_question'
const LIST = 'mcp__status-band__list_questions'
const RESOLVE = 'mcp__status-band__resolve_question'
const ASKED = { question: '上限は何件か', detail: '一覧に覚える数', options: ['50 件', '100 件'], assumed: '100 件' }
const Q1: OpenQuestion = { id: 1, ...ASKED, answer: null }
const Q2: OpenQuestion = { id: 2, question: '名前をどうするか', detail: '', options: ['pending', 'todo'], assumed: 'pending', answer: null }

test('add_question で、Claude が保留を一覧に残す。pane に番号、問い、説明、選択肢が出る', async ($, on) => {
  const seen = world(on)

  const called = await $.tool.call({ tool: ADD, ...ASKED })
  expect(called.result).toBe('Recorded as Q1. 1 open.')
  expect(seen.store.get('qs:s1')).toEqual([Q1])
  // 足したら、利用者の操作を待たずに pane を開く
  expect(seen.opened).toEqual(['questions'])

  const ui = await $.ui.mount(questionsPane)
  expect(await ui.find({ type: 'Text', text: /^Q1$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^上限は何件か$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^一覧に覚える数$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^○ 50 件$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^○ 100 件$/ })).toBeDefined()
  // 仮に置いた選択肢には、印が付く
  expect((await ui.findAll({ type: 'Text', text: /^いまの仮置き$/ })).length).toBe(1)
  await ui.unmount()
})

test('同じ問いでもう一度呼ぶと、番号はそのままで中身が置き換わる', async ($, on) => {
  const seen = world(on, { stored: { 'qs:s1': [Q1, Q2] } })
  await $.session.start(START)

  const called = await $.tool.call({ tool: ADD, ...ASKED, options: ['10 件', '100 件'] })
  expect(called.result).toBe('Recorded as Q1. 2 open.')
  expect(seen.store.get('qs:s1')).toEqual([{ ...Q1, options: ['10 件', '100 件'] }, Q2])
})

const DENIED: { name: string; tool: typeof ADD | typeof RESOLVE; input: { [key: string]: unknown }; deny: string }[] = [
  {
    name: 'add_question は、仮置きが選択肢に無い入力を拒む',
    tool: ADD,
    input: { ...ASKED, assumed: '100' },
    deny: 'add_question failed: assumed must be one of options, spelled the same (the choice you went with for now)',
  },
  { name: 'resolve_question は、一覧に無い番号を拒む', tool: RESOLVE, input: { id: 9 }, deny: 'resolve_question failed: there is no Q9 on the list' },
  {
    name: 'resolve_question は、番号でない入力を拒む',
    tool: RESOLVE,
    input: { id: 'Q1' },
    deny: 'resolve_question failed: id must be a positive integer (the number after Q)',
  },
]

for (const one of DENIED) {
  test(one.name, async ($, on) => {
    const seen = world(on, { stored: { 'qs:s1': [Q1] } })
    await $.session.start(START)

    const called = await $.tool.call({ tool: one.tool, ...one.input })
    expect(called.deny).toBe(one.deny)
    expect(seen.store.get('qs:s1')).toEqual([Q1])
  })
}

test('resolve_question で、Claude が決まった保留を外す', async ($, on) => {
  const seen = world(on, { stored: { 'qs:s1': [Q1, Q2] } })
  await $.session.start(START)

  const called = await $.tool.call({ tool: RESOLVE, id: 1 })
  expect(called.result).toBe('Q1 removed. 1 open.')
  expect(seen.store.get('qs:s1')).toEqual([Q2])
})

test('いちばん大きい番号を外した後に足しても、その番号は付け直さない', async ($, on) => {
  const seen = world(on)
  await $.session.start(START)

  await $.tool.call({ tool: ADD, ...ASKED })
  await $.tool.call({ tool: ADD, question: Q2.question, detail: Q2.detail, options: Q2.options, assumed: Q2.assumed })
  await $.tool.call({ tool: RESOLVE, id: 2 })
  const called = await $.tool.call({ tool: ADD, question: '並びをどうするか', options: ['古い順', '新しい順'], assumed: '古い順' })

  expect(called.result).toBe('Recorded as Q3. 2 open.')
  expect(seen.store.get('qlast:s1')).toBe(3)
})

test('list_questions で、Claude が保留の中身を読み直す', async ($, on) => {
  world(on, { stored: { 'qs:s1': [Q1, Q2] } })
  await $.session.start(START)

  const called = await $.tool.call({ tool: LIST })
  expect(called.result).toBe(JSON.stringify([Q1, Q2]))
})

test('開き直したセッションでは、覚えている保留を戻す。別のセッションの保留は出さない', async ($, on) => {
  world(on, { stored: { 'qs:s1': [Q1], 'qs:other': [Q2] } })
  await $.session.start(START)

  const ui = await $.ui.mount(questionsPane)
  expect(await ui.find({ type: 'Text', text: /^上限は何件か$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^名前をどうするか$/ })).toBeUndefined()
  await ui.unmount()
})

test('選択肢を押すと、その 1 件の答えを Claude に送り、選んだ印を残す', async ($, on) => {
  const seen = world(on, { stored: { 'qs:s1': [Q1, Q2] } })
  await $.session.start(START)
  const ui = await $.ui.mount(questionsPane)

  // Q1 の 1 つ目（50 件）
  await ui.press({ key: 'option-1-0' })
  expect(seen.submitted).toEqual(['【保留への回答】Q1 上限は何件か: 50 件'])
  expect(seen.store.get('qs:s1')).toEqual([{ ...Q1, answer: '50 件' }, Q2])
  expect(await ui.find({ type: 'Text', text: /^● 50 件$/ })).toBeDefined()
  expect((await ui.findAll({ type: 'Text', text: /^送信済$/ })).length).toBe(1)

  // Q2 は、仮置きのまま（pending）を選ぶ
  await ui.press({ key: 'option-2-0' })
  expect(seen.submitted.at(-1)).toBe('【保留への回答】Q2 名前をどうするか: pending（仮置きのまま）')

  // 選び直すと、新しい答えをもう一度送る
  await ui.press({ key: 'option-1-1' })
  expect(seen.submitted.at(-1)).toBe('【保留への回答】Q1 上限は何件か: 100 件（仮置きのまま）')
  expect(seen.store.get('qs:s1')).toEqual([
    { ...Q1, answer: '100 件' },
    { ...Q2, answer: 'pending' },
  ])
  await ui.unmount()
})

const EXPLAINED: { name: string; env: { [name: string]: string }; message: string }[] = [
  { name: '設定が無ければ、既定の頼み方で送る', env: {}, message: 'Q2（名前をどうするか）について、詳しく説明して' },
  {
    name: '環境変数があれば、その頼み方で送る',
    env: { QLIST_EXPLAIN_PROMPT: '/rich で説明しろ' },
    message: 'Q2（名前をどうするか）について、/rich で説明しろ',
  },
]

for (const one of EXPLAINED) {
  test(`「詳しく聞く」: ${one.name}。答えの印は付けない`, async ($, on) => {
    const seen = world(on, { stored: { 'qs:s1': [Q1, Q2] }, env: one.env })
    await $.session.start(START)
    const ui = await $.ui.mount(questionsPane)

    await ui.press({ key: 'explain-2' })
    expect(seen.submitted).toEqual([one.message])
    expect(seen.store.get('qs:s1')).toEqual([Q1, Q2])
    await ui.unmount()
  })
}

test('「ほかの答えを書く」を押すと、答えの書き出しを入力欄に入れる', async ($, on) => {
  const seen = world(on, { stored: { 'qs:s1': [Q1, Q2] } })
  await $.session.start(START)
  const ui = await $.ui.mount(questionsPane)

  await ui.press({ key: 'write-2' })
  expect(seen.filled).toEqual(['Q2（名前をどうするか）は、'])
  expect(seen.submitted).toEqual([])
  await ui.unmount()
})

test('× を押すと、その保留を一覧からも保存からも外す', async ($, on) => {
  const seen = world(on, { stored: { 'qs:s1': [Q1, Q2] } })
  await $.session.start(START)
  const ui = await $.ui.mount(questionsPane)

  await ui.press({ key: 'drop-1' })
  expect(seen.store.get('qs:s1')).toEqual([Q2])
  expect(seen.submitted).toEqual([])
  await ui.unmount()
})

test('保留が無ければ、その旨を出す', async ($, on) => {
  world(on)

  const ui = await $.ui.mount(questionsPane)
  expect(await ui.find({ type: 'Text', text: /いまありません/ })).toBeDefined()
  expect(await ui.find({ key: 'close' })).toBeDefined()
  await ui.unmount()
})

test('保留があれば、帯に件数つきの pending が出る。押すと、コマンドを通さずに pane を開く', async ($, on) => {
  const seen = world(on, { stored: { 'qs:s1': [Q1, Q2] } })
  await $.session.start(START)
  const ui = await $.ui.mount(line(140))

  expect(await ui.find({ type: 'Text', text: /^ pending 2 $/ })).toBeDefined()
  await ui.press({ key: 'pending' })
  expect(seen.opened).toEqual(['questions'])
  expect(seen.commands).toEqual([])
  await ui.unmount()
})

test('保留が無ければ、帯に pending は出ない', async ($, on) => {
  world(on)
  await $.session.start(START)
  const ui = await $.ui.mount(line(140))

  expect(await ui.find({ key: 'pending' })).toBeUndefined()
  await ui.unmount()
})
