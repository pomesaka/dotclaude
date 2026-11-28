import { expect, test } from 'claude-code/testing'
import { type Budget, type Judgement, budgetOf, judge, parseSet, reachedMessage, reachedToast } from '../hooks/budget'
import { NOW, RESETS_AT, type RateLimit, WEEK } from './world'

const WATCHING: Budget = { kind: 'seven_day', percent: 95, sessionId: 's1', resetsAt: RESETS_AT, notice: { state: 'watching' } }

const JUDGES: { name: string; budget: Budget | null; rateLimits: RateLimit[]; now: number; want: Judgement }[] = [
  { name: '予算が無い', budget: null, rateLimits: [WEEK(99)], now: NOW, want: { kind: 'none' } },
  { name: '閾値の下', budget: WATCHING, rateLimits: [WEEK(94.9)], now: NOW, want: { kind: 'below', percentUsed: 94.9 } },
  { name: '閾値ちょうどで達する', budget: WATCHING, rateLimits: [WEEK(95)], now: NOW, want: { kind: 'reached', percentUsed: 95 } },
  { name: '閾値を越える', budget: WATCHING, rateLimits: [WEEK(97.5)], now: NOW, want: { kind: 'reached', percentUsed: 97.5 } },
  {
    name: '知らせた後は、越えていても知らせない',
    budget: { ...WATCHING, notice: { state: 'notified', at: '2026-11-28T11:00:00.000Z', isDelivered: true } },
    rateLimits: [WEEK(99)],
    now: NOW,
    want: { kind: 'notified' },
  },
  { name: '期限ちょうどで外れる', budget: WATCHING, rateLimits: [WEEK(99)], now: Date.parse(RESETS_AT), want: { kind: 'expired' } },
  { name: '期限の後は、知らせた後でも外れる', budget: { ...WATCHING, notice: { state: 'notified', at: 'x', isDelivered: false } }, rateLimits: [], now: Date.parse(RESETS_AT) + 1, want: { kind: 'expired' } },
  { name: '別の枠だけが測れている', budget: WATCHING, rateLimits: [{ kind: 'five_hour', percentUsed: 99 }], now: NOW, want: { kind: 'unmeasured' } },
  { name: '枠の値が無い', budget: WATCHING, rateLimits: [], now: NOW, want: { kind: 'unmeasured' } },
  { name: '5時間の枠の予算は、5時間の枠と比べる', budget: { ...WATCHING, kind: 'five_hour', percent: 80 }, rateLimits: [WEEK(10), { kind: 'five_hour', percentUsed: 80.1 }], now: NOW, want: { kind: 'reached', percentUsed: 80.1 } },
]

for (const one of JUDGES) {
  test(`judge: ${one.name}`, async () => {
    expect(judge(one.budget, one.rateLimits, one.now)).toEqual(one.want)
  })
}

const STORED: { name: string; value: unknown; want: Budget | null }[] = [
  { name: '見張り中の予算', value: WATCHING, want: WATCHING },
  {
    name: '知らせた予算',
    value: { ...WATCHING, notice: { state: 'notified', at: 'a', isDelivered: false } },
    want: { ...WATCHING, notice: { state: 'notified', at: 'a', isDelivered: false } },
  },
  { name: '何も無い', value: undefined, want: null },
  { name: '閾値が文字列', value: { ...WATCHING, percent: '95' }, want: null },
  { name: '期限が日時でない', value: { ...WATCHING, resetsAt: 'soon' }, want: null },
  { name: '知らせの状態が欠けている', value: { ...WATCHING, notice: { state: 'notified' } }, want: null },
]

for (const one of STORED) {
  test(`budgetOf: ${one.name}`, async () => {
    expect(budgetOf(one.value)).toEqual(one.want)
  })
}

const SETS: { name: string; input: unknown; rateLimits: RateLimit[]; want: unknown }[] = [
  { name: 'kind を省くと週の枠', input: { percent: 95 }, rateLimits: [WEEK(40)], want: { kind: 'seven_day', percent: 95, resetsAt: RESETS_AT } },
  { name: '5時間の枠', input: { percent: 80, kind: 'five_hour' }, rateLimits: [WEEK(40), { kind: 'five_hour', percentUsed: 10, resetsAt: RESETS_AT }], want: { kind: 'five_hour', percent: 80, resetsAt: RESETS_AT } },
  { name: '100% は置ける', input: { percent: 100 }, rateLimits: [WEEK(40)], want: { kind: 'seven_day', percent: 100, resetsAt: RESETS_AT } },
  { name: '0% は拒む', input: { percent: 0 }, rateLimits: [WEEK(40)], want: 'percent must be a number above 0 and at most 100' },
  { name: '100% を越えると拒む', input: { percent: 100.1 }, rateLimits: [WEEK(40)], want: 'percent must be a number above 0 and at most 100' },
  { name: '閾値が数でないと拒む', input: { percent: '95' }, rateLimits: [WEEK(40)], want: 'percent must be a number above 0 and at most 100' },
  { name: 'kind が文字列でないと拒む', input: { percent: 95, kind: 7 }, rateLimits: [WEEK(40)], want: 'kind must be a string' },
  {
    name: '枠が測れていないと拒む',
    input: { percent: 95 },
    rateLimits: [],
    want: 'no reading for the seven_day window yet (no rate-limit windows: off a subscription, or before the first response)',
  },
  { name: '別の枠しか無いと拒む', input: { percent: 95 }, rateLimits: [{ kind: 'five_hour', percentUsed: 1, resetsAt: RESETS_AT }], want: 'no reading for the seven_day window yet (measured: five_hour)' },
  { name: '期限の無い枠は拒む', input: { percent: 95 }, rateLimits: [{ kind: 'seven_day', percentUsed: 40 }], want: 'the seven_day window has no reset time, so the budget could not expire' },
  { name: 'すでに閾値ちょうどなら拒む', input: { percent: 95 }, rateLimits: [WEEK(95)], want: 'the seven_day window is already at 95%, at or past 95%' },
]

for (const one of SETS) {
  test(`parseSet: ${one.name}`, async () => {
    expect(parseSet(one.input, one.rateLimits)).toEqual(one.want)
  })
}

const TEXTS: { name: string; text: string; want: string }[] = [
  { name: '届ける文', text: reachedMessage(WATCHING, 95.3), want: '[budget] 予算（週 95%）に達した（いま 95.3%）。今の作業を区切り、したことを報告して止まる。' },
  { name: '届いたときの toast', text: reachedToast(WATCHING, 95.3, true), want: '予算（週 95%）に達した（いま 95.3%）。予算を置いたセッションに、止まるよう伝えた' },
  { name: '届かなかったときの toast は、届け先を書く', text: reachedToast(WATCHING, 95.3, false), want: '予算（週 95%）に達した（いま 95.3%）。予算を置いたセッション（s1）には届かなかった' },
  { name: '知らない枠は kind をそのまま書く', text: reachedMessage({ ...WATCHING, kind: 'spend_limit' }, 50), want: '[budget] 予算（spend_limit 95%）に達した（いま 50%）。今の作業を区切り、したことを報告して止まる。' },
]

for (const one of TEXTS) {
  test(`文: ${one.name}`, async () => {
    expect(one.text).toBe(one.want)
  })
}
