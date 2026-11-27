import { expect, test } from 'claude-code/testing'
import type { FollowedSession, OpenQuestion } from '../types'
import {
  followedOf,
  parseFollow,
  parseUnfollow,
  queuedAction,
  queuedAnswerOf,
  queuedIdOf,
  queuedKey,
  receivedAnswerOf,
  withFollowed,
  withoutFollowed,
} from '../hooks/sessions'

const ME = 's1'

const FOLLOWS: { name: string; input: unknown; parsed: ReturnType<typeof parseFollow> }[] = [
  { name: 'ID と名前', input: { session_id: ' s2 ', label: ' 実装 ' }, parsed: { sessionId: 's2', label: '実装' } },
  { name: 'ID が空', input: { session_id: ' ', label: '実装' }, parsed: 'session_id must be a non-empty string (the Claude session id)' },
  { name: 'ID が文字列でない', input: { session_id: 2, label: '実装' }, parsed: 'session_id must be a non-empty string (the Claude session id)' },
  { name: '名前が無い', input: { session_id: 's2' }, parsed: 'label must be a non-empty string (the name the pane shows)' },
  { name: '自分の ID', input: { session_id: ME, label: '自分' }, parsed: 'session_id is this session: its own questions are shown already' },
]

for (const one of FOLLOWS) {
  test(`parseFollow: ${one.name}`, async () => {
    expect(parseFollow(one.input, ME)).toEqual(one.parsed)
  })
}

const UNFOLLOWS: { name: string; input: unknown; parsed: ReturnType<typeof parseUnfollow> }[] = [
  { name: 'ID', input: { session_id: 's2' }, parsed: { sessionId: 's2' } },
  { name: 'ID が文字列でない', input: { session_id: 2 }, parsed: 'session_id must be a non-empty string (the Claude session id)' },
]

for (const one of UNFOLLOWS) {
  test(`parseUnfollow: ${one.name}`, async () => {
    expect(parseUnfollow(one.input)).toEqual(one.parsed)
  })
}

const S2: FollowedSession = { sessionId: 's2', label: '実装' }
const S3: FollowedSession = { sessionId: 's3', label: '文書' }

const STORED: { name: string; stored: unknown; list: FollowedSession[] }[] = [
  { name: '束ねた一覧', stored: [S2, S3], list: [S2, S3] },
  { name: '形の合わない項目は飛ばす', stored: [S2, { sessionId: '', label: 'x' }, { label: 'y' }, 3], list: [S2] },
  { name: '配列でなければ空', stored: undefined, list: [] },
]

for (const one of STORED) {
  test(`followedOf: ${one.name}`, async () => {
    expect(followedOf(one.stored)).toEqual(one.list)
  })
}

const ADDED: { name: string; list: FollowedSession[]; one: FollowedSession; max: number; after: FollowedSession[] }[] = [
  { name: '末尾に足す', list: [S2], one: S3, max: 10, after: [S2, S3] },
  { name: '同じ ID は、並びをそのままに名前を置き換える', list: [S2, S3], one: { sessionId: 's2', label: '実装2' }, max: 10, after: [{ sessionId: 's2', label: '実装2' }, S3] },
  { name: '上限を超えたら古いものから落とす', list: [S2, S3], one: { sessionId: 's4', label: 'x' }, max: 2, after: [S3, { sessionId: 's4', label: 'x' }] },
]

for (const one of ADDED) {
  test(`withFollowed: ${one.name}`, async () => {
    expect(withFollowed(one.list, one.one, one.max)).toEqual(one.after)
  })
}

test('withoutFollowed: その ID だけを外す', async () => {
  expect(withoutFollowed([S2, S3], 's2')).toEqual([S3])
})

const Q3: OpenQuestion = { id: 3, question: '上限は何件か', detail: '', options: ['50 件', '100 件'], assumed: '100 件', answer: null }
const Q13: OpenQuestion = { id: 13, question: '上限は何件か', detail: '', options: ['5 件', '50 件'], assumed: '5 件', answer: null }

const RECEIVED: { name: string; text: string; list: OpenQuestion[]; found: { id: number; option: string } | null }[] = [
  { name: '答えの文だけ', text: '【保留への回答】Q3 上限は何件か: 50 件', list: [Q3], found: { id: 3, option: '50 件' } },
  { name: '仮置きのまま', text: '【保留への回答】Q3 上限は何件か: 100 件（仮置きのまま）', list: [Q3], found: { id: 3, option: '100 件' } },
  { name: '枠の行の後ろの行', text: 'Another session sent a message:\n  【保留への回答】Q3 上限は何件か: 50 件  ', list: [Q3], found: { id: 3, option: '50 件' } },
  { name: '同じ行の枠の後ろ', text: '[from s1] 【保留への回答】Q3 上限は何件か: 50 件', list: [Q3], found: { id: 3, option: '50 件' } },
  { name: 'Q13 の答えを Q3 と取り違えない', text: '【保留への回答】Q13 上限は何件か: 50 件', list: [Q3, Q13], found: { id: 13, option: '50 件' } },
  { name: '選択肢に無い答え', text: '【保留への回答】Q3 上限は何件か: 10 件', list: [Q3], found: null },
  { name: '一覧に無い番号', text: '【保留への回答】Q4 上限は何件か: 50 件', list: [Q3], found: null },
  { name: '問いの文が違う', text: '【保留への回答】Q3 名前をどうするか: 50 件', list: [Q3], found: null },
  { name: '答えの後ろに文が続く', text: '【保留への回答】Q3 上限は何件か: 50 件 にして、あと…', list: [Q3], found: null },
  { name: '関係の無い文', text: 'テストが通りました', list: [Q3], found: null },
  {
    name: '問いと選択肢に「: 」がある',
    text: '【保留への回答】Q5 a: b: c: d',
    list: [{ ...Q3, id: 5, question: 'a: b', options: ['c: d', 'd'], assumed: 'd' }],
    found: { id: 5, option: 'c: d' },
  },
]

for (const one of RECEIVED) {
  test(`receivedAnswerOf: ${one.name}`, async () => {
    const found = receivedAnswerOf(one.text, one.list)
    expect(found === null ? null : { id: found.question.id, option: found.option }).toEqual(one.found)
  })
}

const QUEUED: { name: string; stored: unknown; option: string | null }[] = [
  { name: '選択肢', stored: { option: '50 件' }, option: '50 件' },
  { name: '空の選択肢', stored: { option: '' }, option: null },
  { name: '形が違う', stored: '50 件', option: null },
]

for (const one of QUEUED) {
  test(`queuedAnswerOf: ${one.name}`, async () => {
    expect(queuedAnswerOf(one.stored)).toEqual(one.option)
  })
}

const KEYS: { name: string; key: string; id: number | null }[] = [
  { name: '自分あて', key: queuedKey('s2', 3), id: 3 },
  { name: 'ほかのセッションあて', key: queuedKey('s22', 3), id: null },
  { name: '番号でない', key: 'ans:s2:x', id: null },
  { name: 'ほかのキー', key: 'qs:s2', id: null },
]

for (const one of KEYS) {
  test(`queuedIdOf: ${one.name}`, async () => {
    expect(queuedIdOf(one.key, 's2')).toEqual(one.id)
  })
}

const ACTIONS: { name: string; id: number; option: string | null; list: OpenQuestion[]; action: 'deliver' | 'discard' }[] = [
  { name: '開いている保留の選択肢は届ける', id: 3, option: '50 件', list: [Q3], action: 'deliver' },
  { name: '別の答えの印が付いていても、新しい答えは届ける', id: 3, option: '50 件', list: [{ ...Q3, answer: '100 件' }], action: 'deliver' },
  { name: '同じ答えの印がもう付いていれば捨てる', id: 3, option: '50 件', list: [{ ...Q3, answer: '50 件' }], action: 'discard' },
  { name: '外した保留あては捨てる', id: 3, option: '50 件', list: [Q13], action: 'discard' },
  { name: '選択肢に無い答えは捨てる', id: 3, option: '10 件', list: [Q3], action: 'discard' },
  { name: '値の読めない答えは捨てる', id: 3, option: null, list: [Q3], action: 'discard' },
]

for (const one of ACTIONS) {
  test(`queuedAction: ${one.name}`, async () => {
    const action = queuedAction(one.id, one.option, one.list)
    expect(action === 'discard' ? 'discard' : 'deliver').toBe(one.action)
  })
}
