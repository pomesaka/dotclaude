import { expect, test } from 'claude-code/testing'

import { actionOf, ageOf, parseReport, recordOf, stampOf } from '../hooks/report'

const REJECTED: { name: string; input: unknown; error: string }[] = [
  { name: 'オブジェクトでない', input: 'report', error: 'now must be a non-empty string' },
  { name: 'now が空白だけ', input: { now: '  ', next: ['a'] }, error: 'now must be a non-empty string' },
  { name: 'next が無い', input: { now: 'a' }, error: 'next must be a list of at least one string' },
  { name: 'next が空', input: { now: 'a', next: [] }, error: 'next must be a list of at least one string' },
  { name: 'next に空の項目', input: { now: 'a', next: ['b', ' '] }, error: 'every item of next must be a non-empty string' },
  {
    name: 'next が 7 個',
    input: { now: 'a', next: ['1', '2', '3', '4', '5', '6', '7'] },
    error: 'next lists at most 6 items; keep the ones the user needs to pick the work back up',
  },
  { name: 'sections が配列でない', input: { now: 'a', next: ['b'], sections: 'c' }, error: 'sections must be a list' },
  {
    name: 'sections が 7 つ',
    input: { now: 'a', next: ['b'], sections: ['1', '2', '3', '4', '5', '6', '7'].map(title => ({ title, items: ['x'] })) },
    error: 'sections lists at most 6 sections',
  },
  { name: '節に見出しが無い', input: { now: 'a', next: ['b'], sections: [{ items: ['x'] }] }, error: 'sections[0] needs a non-empty title' },
  {
    name: '節の項目が空',
    input: { now: 'a', next: ['b'], sections: [{ title: 't', items: ['x'] }, { title: 'u', items: [] }] },
    error: 'sections[1].items must be a list of at least one string',
  },
  {
    name: '節の項目が文字列でない',
    input: { now: 'a', next: ['b'], sections: [{ title: 't', items: [1] }] },
    error: 'every item of sections[0].items must be a non-empty string',
  },
  {
    name: '見出しが重複',
    input: { now: 'a', next: ['b'], sections: [{ title: 't', items: ['x'] }, { title: 't', items: ['y'] }] },
    error: 'section titles must be distinct',
  },
]

for (const one of REJECTED) {
  test(`parseReport は拒む: ${one.name}`, async () => {
    expect(parseReport(one.input)).toBe(one.error)
  })
}

test('parseReport は、省かれた sections を空にし、前後の空白を落とす', async () => {
  expect(parseReport({ now: ' 帯の幅を直している ', next: [' テストを足す '] })).toEqual({
    now: '帯の幅を直している',
    next: ['テストを足す'],
    sections: [],
  })
})

test('parseReport は、自由な節を並びのまま読む', async () => {
  expect(parseReport({ now: 'a', next: ['b'], sections: [{ title: ' 決まったこと ', items: ['c'] }, { title: '待っていること', items: ['d', 'e'] }] })).toEqual({
    now: 'a',
    next: ['b'],
    sections: [
      { title: '決まったこと', items: ['c'] },
      { title: '待っていること', items: ['d', 'e'] },
    ],
  })
})

const REPORT = { now: 'a', next: ['b'], sections: [], updatedAt: 5, turns: 2 }

const STORED: { name: string; stored: unknown; record: unknown }[] = [
  { name: '何も無い', stored: undefined, record: { isOn: false, report: null, unchecked: 0 } },
  { name: 'ON で、まだ書かれていない', stored: { isOn: true, report: null, unchecked: 3 }, record: { isOn: true, report: null, unchecked: 3 } },
  { name: '書かれた状況がある', stored: { isOn: true, report: REPORT, unchecked: 1 }, record: { isOn: true, report: REPORT, unchecked: 1 } },
  { name: 'OFF にした後も、状況は残る', stored: { isOn: false, report: REPORT, unchecked: 0 }, record: { isOn: false, report: REPORT, unchecked: 0 } },
  {
    name: '状況に時刻が無い',
    stored: { isOn: true, report: { now: 'a', next: ['b'], sections: [], turns: 0 }, unchecked: 0 },
    record: { isOn: true, report: null, unchecked: 0 },
  },
  {
    name: '状況の中身が読めない',
    stored: { isOn: true, report: { now: 'a', next: [], updatedAt: 1, turns: 0 }, unchecked: 0 },
    record: { isOn: true, report: null, unchecked: 0 },
  },
  { name: 'isOn が真偽値でない', stored: { isOn: 'yes', report: null, unchecked: 'x' }, record: { isOn: false, report: null, unchecked: 0 } },
]

for (const one of STORED) {
  test(`recordOf: ${one.name}`, async () => {
    expect(recordOf(one.stored)).toEqual(one.record)
  })
}

const AGES: { name: string; elapsedMs: number; text: string }[] = [
  { name: '59 秒', elapsedMs: 59_000, text: 'たったいま更新' },
  { name: '1 分', elapsedMs: 60_000, text: '1分前に更新' },
  { name: '59 分', elapsedMs: 3_540_000, text: '59分前に更新' },
  { name: '1 時間', elapsedMs: 3_600_000, text: '1時間前に更新' },
  { name: '23 時間 59 分', elapsedMs: 86_340_000, text: '23時間前に更新' },
  { name: '3 日', elapsedMs: 259_200_000, text: '3日前に更新' },
  { name: '時計が戻った', elapsedMs: -5_000, text: 'たったいま更新' },
]

for (const one of AGES) {
  test(`ageOf: ${one.name}`, async () => {
    expect(ageOf(1_000_000_000, 1_000_000_000 + one.elapsedMs)).toBe(one.text)
  })
}

// 月は 0 始まり。マシンの時刻で作って、マシンの時刻で読むので、タイムゾーンに依らない
const STAMPS: { name: string; date: Date; text: string }[] = [
  { name: '2 桁にそろえる', date: new Date(2026, 0, 5, 9, 3), text: '2026-01-05 09:03' },
  { name: '年の終わりの深夜', date: new Date(2026, 11, 31, 23, 59), text: '2026-12-31 23:59' },
]

for (const one of STAMPS) {
  test(`stampOf: ${one.name}`, async () => {
    expect(stampOf(one.date)).toBe(one.text)
  })
}

const ACTIONS:{ args: string; action: string | null }[] = [
  { args: '', action: 'open' },
  { args: '  ', action: 'open' },
  { args: 'on', action: 'on' },
  { args: ' OFF ', action: 'off' },
  { args: 'toggle', action: null },
]

for (const one of ACTIONS) {
  test(`actionOf("${one.args}")`, async () => {
    expect(actionOf(one.args)).toBe(one.action)
  })
}
