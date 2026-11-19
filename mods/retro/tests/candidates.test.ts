import { expect, test } from 'claude-code/testing'

import { CANDIDATES_MAX, foldEvents, formatEvents, parseEvents, storedCandidatesOf, tally, writtenEvents } from '../hooks/candidates'
import type { Candidate, Finding, RetroEvent } from '../types'

const AT = 100
const finding = (rest: Partial<Finding> = {}): Finding => ({ title: 't', detail: 'd', evidence: 'e', kind: 'doc', isSevere: false, same: null, target: null, ...rest })
const candidate = (rest: Partial<Candidate> = {}): Candidate => ({ id: 'c1', title: 't', detail: 'd', kind: 'doc', count: 1, evidence: ['old'], lastAt: 1, writtenAt: null, target: null, ...rest })
const seen = (id: string, at: number, rest: Partial<Extract<RetroEvent, { type: 'seen' }>> = {}): RetroEvent => ({ type: 'seen', id, title: 't', detail: 'd', kind: 'doc', evidence: `e${at}`, target: null, at, ...rest })
const ids = (prefix: string) => {
  let next = 0
  return () => `${prefix}${++next}`
}

// 出来事を at の順に当てはめる
const FOLDS: { name: string; events: RetroEvent[]; counts: [string, number][] }[] = [
  { name: 'seen が 1 件', events: [seen('c1', 1)], counts: [['c1', 1]] },
  { name: '別のセッションの同じ id の seen は、足して数える', events: [seen('c1', 1), seen('c1', 2)], counts: [['c1', 2]] },
  { name: 'written で 0 に戻し、その後の seen から数え直す', events: [seen('c1', 1), { type: 'written', id: 'c1', at: 2 }, seen('c1', 3)], counts: [['c1', 1]] },
  { name: '並びでなく at の順に当てる', events: [{ type: 'written', id: 'c1', at: 2 }, seen('c1', 1)], counts: [['c1', 0]] },
  { name: '同じ at なら、並びの順に当てる', events: [seen('c1', 1), { type: 'written', id: 'c1', at: 1 }], counts: [['c1', 0]] },
  { name: 'imported の回数に、後の seen を足す', events: [{ type: 'imported', candidate: candidate({ count: 3 }), at: 1 }, seen('c1', 2)], counts: [['c1', 4]] },
  { name: 'dropped で外し、後に同じ id が出たら 1 から作り直す', events: [seen('c1', 1), { type: 'dropped', id: 'c1', at: 2 }, seen('c1', 3)], counts: [['c1', 1]] },
  { name: '控えに無い id の written と dropped は無視する', events: [{ type: 'written', id: 'c9', at: 1 }, { type: 'dropped', id: 'c8', at: 2 }], counts: [] },
]

for (const one of FOLDS) {
  test(`foldEvents: ${one.name}`, async () => {
    expect(foldEvents(one.events).map(c => [c.id, c.count])).toEqual(one.counts)
  })
}

test('foldEvents: 根拠は新しい順に 5 件まで持ち、空の根拠は足さない', async () => {
  const events = [1, 2, 3, 4, 5, 6].map(at => seen('c1', at))
  expect(foldEvents(events)[0]?.evidence).toEqual(['e6', 'e5', 'e4', 'e3', 'e2'])
  expect(foldEvents([seen('c1', 1, { evidence: '' })])[0]?.evidence).toEqual([])
})

test('foldEvents: 上限を超えたら、回数の少なく古いものから落とす', async () => {
  const events = Array.from({ length: CANDIDATES_MAX + 1 }, (_, index) => [seen(`c${index}`, index + 1), ...(index === 0 ? [] : [seen(`c${index}`, index + 1)])]).flat()
  const list = foldEvents(events)
  expect(list.length).toBe(CANDIDATES_MAX)
  expect(list.some(c => c.id === 'c0')).toBe(false)
})

// WHY 乱数: 行をどのファイルに分けても、どの順に読んでも、同じ控えになることを、思いつかない並びでも確かめる
test('foldEvents: 行をファイルに分けて並べ替えても、束ねた控えは変わらない', async () => {
  for (let round = 0; round < 50; round++) {
    const events: RetroEvent[] = Array.from({ length: 20 }, (_, index) => {
      const id = `c${Math.floor(Math.random() * 3)}`
      const roll = Math.random()
      return roll < 0.6 ? seen(id, index + 1) : roll < 0.8 ? { type: 'written', id, at: index + 1 } : { type: 'dropped', id, at: index + 1 }
    })
    const files: RetroEvent[][] = [[], [], []]
    for (const event of events) files[Math.floor(Math.random() * 3)]?.push(event)
    const shuffled = [...files].sort(() => Math.random() - 0.5).flat()
    expect(foldEvents(shuffled)).toEqual(foldEvents(events))
  }
})

// 発見を数え、上げるかを決める
const TALLIES: { name: string; list: Candidate[]; findings: Finding[]; ids: string[]; promoted: string[] }[] = [
  { name: '新しい文書の発見は 1 回で、上げない', list: [], findings: [finding()], ids: ['n1'], promoted: [] },
  { name: '同じ控えが 2 回目なら上げる', list: [candidate()], findings: [finding({ same: 'c1' })], ids: ['c1'], promoted: ['c1'] },
  { name: '害の大きい文書の発見は 1 回目で上げる', list: [], findings: [finding({ isSevere: true })], ids: ['n1'], promoted: ['n1'] },
  { name: '仕組みの発見は何回出ても上げない', list: [candidate({ kind: 'mechanism', count: 5 })], findings: [finding({ kind: 'mechanism', same: 'c1', isSevere: true })], ids: ['c1'], promoted: [] },
  { name: '要望は何回出ても上げない', list: [candidate({ kind: 'request', count: 5, target: 'x' })], findings: [finding({ kind: 'request', same: 'c1', isSevere: true, target: 'x' })], ids: ['c1'], promoted: [] },
  { name: '控えに無い id を指されたら、新しい発見にする', list: [candidate()], findings: [finding({ same: 'c9' })], ids: ['n1'], promoted: [] },
  { name: '文書に上げた後は、0 から数え直す', list: [candidate({ count: 0, writtenAt: 50 })], findings: [finding({ same: 'c1' })], ids: ['c1'], promoted: [] },
  { name: '1 回に新しい発見が 2 件なら、別の id を付ける', list: [], findings: [finding(), finding({ title: 'u' })], ids: ['n1', 'n2'], promoted: [] },
]

for (const one of TALLIES) {
  test(`tally: ${one.name}`, async () => {
    const { events, promoted } = tally(one.list, one.findings, AT, ids('n'))
    expect(events.map(e => (e.type === 'seen' ? e.id : ''))).toEqual(one.ids)
    expect(promoted.map(c => c.id)).toEqual(one.promoted)
  })
}

test('writtenEvents: 上げた控えごとに written の行を作る', async () => {
  expect(writtenEvents(['c1', 'c2'], AT)).toEqual([
    { type: 'written', id: 'c1', at: AT },
    { type: 'written', id: 'c2', at: AT },
  ])
})

// ファイルの中身を読む
const PARSES: { name: string; text: string; count: number }[] = [
  { name: '書いた形を読み戻せる', text: formatEvents([seen('c1', 1), { type: 'written', id: 'c1', at: 2 }]), count: 2 },
  { name: '空行は飛ばす', text: `\n${formatEvents([seen('c1', 1)])}\n`, count: 1 },
  { name: 'JSON でない行と、途中で切れた最後の行は捨てる', text: `not json\n${formatEvents([seen('c1', 1)])}{"type":"seen"`, count: 1 },
  { name: '知らない type、知らない kind、数でない at は捨てる', text: ['{"type":"x","id":"c1","at":1}', '{"type":"seen","id":"c1","title":"t","detail":"d","kind":"z","at":1}', '{"type":"written","id":"c1","at":"1"}'].join('\n'), count: 0 },
  { name: '形の合わない imported は捨てる', text: '{"type":"imported","candidate":{"id":"c1"},"at":1}', count: 0 },
]

for (const one of PARSES) {
  test(`parseEvents: ${one.name}`, async () => {
    expect(parseEvents(one.text).length).toBe(one.count)
  })
}

test('storedCandidatesOf: 前の版の控えから、形の合う項目だけを読む', async () => {
  expect(storedCandidatesOf({ next: 3, list: [candidate(), { id: 'c2', title: 't' }] }).map(c => c.id)).toEqual(['c1'])
  expect(storedCandidatesOf(undefined)).toEqual([])
})
