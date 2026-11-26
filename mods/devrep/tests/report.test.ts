import { expect, test } from 'claude-code/testing'

import { actionOf, ageOf, parseReport, recordOf, stampOf } from '../hooks/report'

const PARSED: { name: string; input: unknown; parsed: unknown }[] = [
  { name: 'オブジェクトでない', input: 'report', parsed: 'now must be a non-empty string' },
  { name: 'now が空白だけ', input: { now: '  ' }, parsed: 'now must be a non-empty string' },
  // 全角で数える。UTF-16 の length で数える実装を落とす
  { name: 'now が全角 200 字', input: { now: 'あ'.repeat(200) }, parsed: { now: 'あ'.repeat(200), todo: [] } },
  { name: 'now が全角 201 字', input: { now: 'あ'.repeat(201) }, parsed: 'now is at most 200 characters' },
  { name: 'todo を省くと空', input: { now: ' 帯の幅を直している ' }, parsed: { now: '帯の幅を直している', todo: [] } },
  { name: 'todo が配列でない', input: { now: 'a', todo: 'c' }, parsed: 'todo must be a list of strings' },
  { name: 'todo に空の項目', input: { now: 'a', todo: ['c', ''] }, parsed: 'every item of todo must be a non-empty string' },
  { name: 'todo が 3 個', input: { now: 'a', todo: [' 1 ', '2', '3'] }, parsed: { now: 'a', todo: ['1', '2', '3'] } },
  { name: 'todo が 4 個', input: { now: 'a', todo: ['1', '2', '3', '4'] }, parsed: 'todo lists at most 3 items; keep only what blocks the work now' },
  // 前の形の欄は読まずに捨てる
  { name: 'next と sections は捨てる', input: { now: 'a', next: ['b'], sections: [{ title: 't', items: ['x'] }] }, parsed: { now: 'a', todo: [] } },
]

for (const one of PARSED) {
  test(`parseReport: ${one.name}`, async () => {
    expect(parseReport(one.input)).toEqual(one.parsed)
  })
}

const REPORT = { now: 'a', todo: ['c'], updatedAt: 5, turns: 2 }

const STORED: { name: string; stored: unknown; record: unknown }[] = [
  { name: '何も無い', stored: undefined, record: { isOn: false, report: null, unchecked: 0 } },
  { name: 'ON で、まだ書かれていない', stored: { isOn: true, report: null, unchecked: 3 }, record: { isOn: true, report: null, unchecked: 3 } },
  { name: '書かれた状況がある', stored: { isOn: true, report: REPORT, unchecked: 1 }, record: { isOn: true, report: REPORT, unchecked: 1 } },
  { name: 'OFF にした後も、状況は残る', stored: { isOn: false, report: REPORT, unchecked: 0 }, record: { isOn: false, report: REPORT, unchecked: 0 } },
  {
    name: '前の形の状況は、now と todo だけを読む',
    stored: { isOn: true, report: { now: 'a', next: ['b'], todo: ['c'], sections: [], updatedAt: 5, turns: 2 }, unchecked: 1 },
    record: { isOn: true, report: REPORT, unchecked: 1 },
  },
  {
    name: '前の形で todo が上限を超えた状況は、無いものとして読む',
    stored: { isOn: true, report: { now: 'a', todo: ['1', '2', '3', '4'], updatedAt: 5, turns: 2 }, unchecked: 1 },
    record: { isOn: true, report: null, unchecked: 1 },
  },
  {
    name: '状況に時刻が無い',
    stored: { isOn: true, report: { now: 'a', todo: [], turns: 0 }, unchecked: 0 },
    record: { isOn: true, report: null, unchecked: 0 },
  },
  {
    name: '状況の中身が読めない',
    stored: { isOn: true, report: { now: '', updatedAt: 1, turns: 0 }, unchecked: 0 },
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
