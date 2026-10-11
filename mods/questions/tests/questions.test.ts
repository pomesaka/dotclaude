import { expect, test } from 'claude-code/testing'
import type { OpenQuestion } from '../types'
import { addQuestion, answerMessage, answerOpening, explainMessage, lastIdOf, parseQuestion, parseQuestionId, questionsOf, withAnswer } from '../hooks/questions'

const ASKED = { question: '上限は何件か', detail: '一覧に覚える数', options: ['50 件', '100 件'], assumed: '100 件' }

const PARSED: { name: string; input: unknown; parsed: ReturnType<typeof parseQuestion> }[] = [
  { name: '問い、説明、選択肢、仮置き', input: { ...ASKED, question: ' 上限は何件か ' }, parsed: ASKED },
  { name: '説明は無くてもよい', input: { ...ASKED, detail: undefined }, parsed: { ...ASKED, detail: '' } },
  { name: '選択肢の空と重複は落とす', input: { ...ASKED, options: ['50 件', ' 100 件 ', '', '50 件'] }, parsed: ASKED },
  { name: '問いが無い', input: { ...ASKED, question: ' ' }, parsed: 'question must be a non-empty string' },
  { name: '選択肢が配列でない', input: { ...ASKED, options: '50 件' }, parsed: 'options must list 2 or more distinct choices' },
  { name: '選択肢が 1 つ', input: { ...ASKED, options: ['100 件'] }, parsed: 'options must list 2 or more distinct choices' },
  { name: '選択肢が 7 つ', input: { ...ASKED, options: ['a', 'b', 'c', 'd', 'e', 'f', '100 件'] }, parsed: 'options must list at most 6 choices' },
  {
    name: '仮置きが選択肢に無い',
    input: { ...ASKED, assumed: '100' },
    parsed: 'assumed must be one of options, spelled the same (the choice you went with for now)',
  },
]

for (const one of PARSED) {
  test(`parseQuestion: ${one.name}`, async () => {
    expect(parseQuestion(one.input)).toEqual(one.parsed)
  })
}

const IDS: { name: string; input: unknown; id: number | string }[] = [
  { name: '正の整数', input: { id: 3 }, id: 3 },
  { name: '0', input: { id: 0 }, id: 'id must be a positive integer (the number after Q)' },
  { name: '小数', input: { id: 1.5 }, id: 'id must be a positive integer (the number after Q)' },
  { name: '文字列', input: { id: 'Q3' }, id: 'id must be a positive integer (the number after Q)' },
  { name: '無い', input: {}, id: 'id must be a positive integer (the number after Q)' },
]

for (const one of IDS) {
  test(`parseQuestionId: ${one.name}`, async () => {
    expect(parseQuestionId(one.input)).toEqual(one.id)
  })
}

const Q1: OpenQuestion = { id: 1, ...ASKED, answer: '50 件' }
const Q3: OpenQuestion = { id: 3, question: '名前をどうするか', detail: '', options: ['pending', 'todo'], assumed: 'pending', answer: null }
const NEW = { question: 'a', detail: '', options: ['x', 'y'], assumed: 'x' }

const ADDED: {
  name: string
  list: OpenQuestion[]
  added: typeof NEW
  max: number
  // これまでに付けたいちばん大きい番号
  last: number
  id: number
  ids: number[]
  answers: (string | null)[]
}[] = [
  { name: '空の一覧には、Q1 として入る', list: [], added: NEW, max: 10, last: 0, id: 1, ids: [1], answers: [null] },
  { name: '番号は、付けたいちばん大きい番号の次', list: [Q1, Q3], added: NEW, max: 10, last: 3, id: 4, ids: [1, 3, 4], answers: ['50 件', null, null] },
  { name: '外した番号は、いちばん大きい番号でも付け直さない', list: [Q1, Q3], added: NEW, max: 10, last: 5, id: 6, ids: [1, 3, 6], answers: ['50 件', null, null] },
  { name: '全部外した後も、続きの番号になる', list: [], added: NEW, max: 10, last: 5, id: 6, ids: [6], answers: [null] },
  { name: '覚えている番号が無くても、一覧にある番号とは重ねない', list: [Q1, Q3], added: NEW, max: 10, last: 0, id: 4, ids: [1, 3, 4], answers: ['50 件', null, null] },
  {
    name: '同じ問いは、番号と位置をそのままに中身を置き換え、選んであった答えを消す',
    list: [Q1, Q3],
    added: { ...ASKED, options: ['10 件', '100 件'] },
    max: 10,
    last: 5,
    id: 1,
    ids: [1, 3],
    answers: [null, null],
  },
  { name: '上限を超えたら、古いものから落とす', list: [Q1, Q3], added: NEW, max: 2, last: 3, id: 4, ids: [3, 4], answers: [null, null] },
]

for (const one of ADDED) {
  test(`addQuestion: ${one.name}`, async () => {
    const added = addQuestion(one.list, one.added, one.max, one.last)
    expect(added.id).toBe(one.id)
    expect(added.list.map(question => question.id)).toEqual(one.ids)
    expect(added.list.map(question => question.answer)).toEqual(one.answers)
  })
}

const LASTS: { name: string; stored: unknown; last: number }[] = [
  { name: '保存した番号', stored: 4, last: 4 },
  { name: 'まだ無い', stored: undefined, last: 0 },
  { name: '数でない', stored: '4', last: 0 },
  { name: '小数', stored: 1.5, last: 0 },
]

for (const one of LASTS) {
  test(`lastIdOf: ${one.name}`, async () => {
    expect(lastIdOf(one.stored)).toBe(one.last)
  })
}

const STORED: { name: string; stored: unknown; questions: OpenQuestion[] }[] = [
  { name: '保存した形', stored: [Q1, Q3], questions: [Q1, Q3] },
  { name: '配列でない', stored: 'x', questions: [] },
  { name: '選択肢に無い答えは、選んでいない扱いにする', stored: [{ ...Q3, answer: 'later' }], questions: [Q3] },
  { name: '形の合わない項目は飛ばす', stored: [Q1, { ...Q3, id: 'three' }, { id: 5, question: 'a', assumed: 'x' }, null], questions: [Q1] },
]

for (const one of STORED) {
  test(`questionsOf: ${one.name}`, async () => {
    expect(questionsOf(one.stored)).toEqual(one.questions)
  })
}

const ANSWERED: { name: string; id: number; option: string | null; answers: (string | null)[] }[] = [
  { name: '選んだ選択肢を書く', id: 3, option: 'todo', answers: ['50 件', 'todo'] },
  { name: '選び直せる', id: 1, option: '100 件', answers: ['100 件', null] },
  { name: 'null で、選んでいない状態に戻す', id: 1, option: null, answers: [null, null] },
  { name: 'その問いの選択肢でなければ、何も変えない', id: 3, option: '100 件', answers: ['50 件', null] },
  { name: '一覧に無い番号では、何も変えない', id: 9, option: 'todo', answers: ['50 件', null] },
]

for (const one of ANSWERED) {
  test(`withAnswer: ${one.name}`, async () => {
    expect(withAnswer([Q1, Q3], one.id, one.option).map(question => question.answer)).toEqual(one.answers)
  })
}

const MESSAGES: { name: string; option: string; message: string }[] = [
  { name: '仮置きと違う答え', option: 'todo', message: '【保留への回答】Q3 名前をどうするか: todo' },
  { name: '仮置きのままの答えには、その旨を付ける', option: 'pending', message: '【保留への回答】Q3 名前をどうするか: pending（仮置きのまま）' },
]

for (const one of MESSAGES) {
  test(`answerMessage: ${one.name}`, async () => {
    expect(answerMessage(Q3, one.option)).toBe(one.message)
  })
}

const EXPLAINS: { name: string; instruction: string | undefined; message: string }[] = [
  { name: '頼み方が無い', instruction: undefined, message: 'Q3（名前をどうするか）について、詳しく説明して' },
  { name: '頼み方が空白だけ', instruction: '  ', message: 'Q3（名前をどうするか）について、詳しく説明して' },
  { name: '頼み方がある', instruction: ' /rich で説明しろ ', message: 'Q3（名前をどうするか）について、/rich で説明しろ' },
]

for (const one of EXPLAINS) {
  test(`explainMessage: ${one.name}`, async () => {
    expect(explainMessage(Q3, one.instruction)).toBe(one.message)
  })
}

test('answerOpening は、番号と問いを書き出しにする', async () => {
  expect(answerOpening(Q3)).toBe('Q3（名前をどうするか）は、')
})
