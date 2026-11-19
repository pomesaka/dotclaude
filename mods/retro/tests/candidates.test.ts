import { expect, test } from 'claude-code/testing'

import { CANDIDATES_MAX, candidatesOf, markWritten, tally } from '../hooks/candidates'
import type { Candidate, Candidates, Finding } from '../types'

const AT = 100
const finding = (rest: Partial<Finding> = {}): Finding => ({ title: 't', detail: 'd', evidence: 'e', kind: 'doc', isSevere: false, same: null, ...rest })
const candidate = (rest: Partial<Candidate> = {}): Candidate => ({ id: 'c1', title: 't', detail: 'd', kind: 'doc', count: 1, evidence: ['old'], lastAt: 1, writtenAt: null, ...rest })

const TALLIES: { name: string; current: Candidates; findings: Finding[]; ids: string[]; counts: number[]; promoted: string[] }[] = [
  { name: '新しい文書の発見は 1 回で、上げない', current: { next: 1, list: [] }, findings: [finding()], ids: ['c1'], counts: [1], promoted: [] },
  { name: '同じ控えが 2 回目なら上げる', current: { next: 2, list: [candidate()] }, findings: [finding({ same: 'c1' })], ids: ['c1'], counts: [2], promoted: ['c1'] },
  { name: '害の大きい文書の発見は 1 回目で上げる', current: { next: 1, list: [] }, findings: [finding({ isSevere: true })], ids: ['c1'], counts: [1], promoted: ['c1'] },
  { name: '仕組みの発見は何回出ても上げない', current: { next: 2, list: [candidate({ kind: 'mechanism', count: 5 })] }, findings: [finding({ kind: 'mechanism', same: 'c1', isSevere: true })], ids: ['c1'], counts: [6], promoted: [] },
  { name: '控えに無い id を指されたら、新しい発見にする', current: { next: 2, list: [candidate()] }, findings: [finding({ same: 'c9' })], ids: ['c2', 'c1'], counts: [1, 1], promoted: [] },
  { name: '文書に上げた後は、0 から数え直す', current: { next: 2, list: [candidate({ count: 0, writtenAt: 50 })] }, findings: [finding({ same: 'c1' })], ids: ['c1'], counts: [1], promoted: [] },
]

for (const one of TALLIES) {
  test(`tally: ${one.name}`, async () => {
    const { candidates, promoted } = tally(one.current, one.findings, AT)
    expect(candidates.list.map(c => c.id)).toEqual(one.ids)
    expect(candidates.list.map(c => c.count)).toEqual(one.counts)
    expect(promoted.map(c => c.id)).toEqual(one.promoted)
  })
}

test('tally: 根拠は新しい順に 5 件まで持ち、空の根拠は足さない', async () => {
  const before = candidate({ evidence: ['1', '2', '3', '4', '5'] })
  expect(tally({ next: 2, list: [before] }, [finding({ same: 'c1', evidence: 'new' })], AT).candidates.list[0]?.evidence).toEqual(['new', '1', '2', '3', '4'])
  expect(tally({ next: 2, list: [before] }, [finding({ same: 'c1', evidence: '' })], AT).candidates.list[0]?.evidence).toEqual(['1', '2', '3', '4', '5'])
})

test('tally: 上限を超えたら、回数の少なく古いものから落とす', async () => {
  const list = Array.from({ length: CANDIDATES_MAX }, (_, index) => candidate({ id: `c${index + 1}`, count: index === 0 ? 1 : 2, lastAt: index }))
  const { candidates } = tally({ next: CANDIDATES_MAX + 1, list }, [finding()], AT)
  expect(candidates.list.length).toBe(CANDIDATES_MAX)
  expect(candidates.list.some(c => c.id === 'c1')).toBe(false)
  expect(candidates.list.some(c => c.id === `c${CANDIDATES_MAX + 1}`)).toBe(true)
})

test('markWritten: 上げた控えだけ回数を 0 に戻し、時刻を付ける', async () => {
  const written = markWritten({ next: 3, list: [candidate(), candidate({ id: 'c2', count: 2 })] }, ['c2'], AT)
  expect(written.list.map(c => [c.id, c.count, c.writtenAt])).toEqual([
    ['c1', 1, null],
    ['c2', 0, AT],
  ])
})

const STORED: { name: string; stored: unknown; next: number; ids: string[] }[] = [
  { name: '何も無い', stored: undefined, next: 1, ids: [] },
  { name: '形の合わない項目は捨てる', stored: { next: 3, list: [candidate(), { id: 'c2', title: 't' }] }, next: 3, ids: ['c1'] },
  { name: 'next が使った番号より小さければ、続きから付ける', stored: { next: 1, list: [candidate({ id: 'c7' })] }, next: 8, ids: ['c7'] },
]

for (const one of STORED) {
  test(`candidatesOf: ${one.name}`, async () => {
    const read = candidatesOf(one.stored)
    expect([read.next, read.list.map(c => c.id)]).toEqual([one.next, one.ids])
  })
}
