import { expect, test } from 'claude-code/testing'
import { ME, NOW, OTHER, RESETS_AT, type RateLimit, WEEK, budget, world } from './world'

const MESSAGE = '[budget] 予算（週 95%）に達した（いま 96%）。今の作業を区切り、したことを報告して止まる。'
const NOTIFIED = { state: 'notified', at: new Date(NOW).toISOString(), isDelivered: true }

type Unit = 'context' | 'rateLimits' | 'cost'

const CASES: {
  name: string
  stored?: unknown
  rateLimits: RateLimit[]
  changed?: Unit[]
  now?: number
  isDelivered?: boolean
  isSubmitted?: boolean
  // 測った後の $.store の予算。undefined は外れている
  after: unknown
  submitted: string[]
  sent: { to: string; text: string }[]
  toasts: number
}[] = [
  { name: '予算が無ければ何もしない', rateLimits: [WEEK(99)], after: undefined, submitted: [], sent: [], toasts: 0 },
  {
    name: '越えたら、自分のセッションに文を足し、印を置き、toast を出す',
    stored: budget(),
    rateLimits: [WEEK(96)],
    after: budget({ notice: NOTIFIED }),
    submitted: [MESSAGE],
    sent: [],
    toasts: 1,
  },
  {
    name: '別のセッションが置いた予算なら、そのセッションへ送る',
    stored: budget({ sessionId: OTHER }),
    rateLimits: [WEEK(96)],
    after: budget({ sessionId: OTHER, notice: NOTIFIED }),
    submitted: [],
    sent: [{ to: OTHER, text: MESSAGE }],
    toasts: 1,
  },
  {
    name: '別のセッションに届かなくても、印を置き、届かなかったと残す',
    stored: budget({ sessionId: OTHER }),
    rateLimits: [WEEK(96)],
    isDelivered: false,
    after: budget({ sessionId: OTHER, notice: { ...NOTIFIED, isDelivered: false } }),
    submitted: [],
    sent: [{ to: OTHER, text: MESSAGE }],
    toasts: 1,
  },
  {
    name: '自分の会話へ送れなかったら、届かなかったと残す',
    stored: budget(),
    rateLimits: [WEEK(96)],
    isSubmitted: false,
    after: budget({ notice: { ...NOTIFIED, isDelivered: false } }),
    submitted: [MESSAGE],
    sent: [],
    toasts: 1,
  },
  {
    name: '知らせた後は、もう知らせない',
    stored: budget({ notice: NOTIFIED }),
    rateLimits: [WEEK(99)],
    after: budget({ notice: NOTIFIED }),
    submitted: [],
    sent: [],
    toasts: 0,
  },
  { name: '期限を過ぎたら、知らせずに外す', stored: budget(), rateLimits: [WEEK(99)], now: Date.parse(RESETS_AT), after: undefined, submitted: [], sent: [], toasts: 0 },
  { name: '使用率の枠が動いていなければ判定しない', stored: budget(), rateLimits: [WEEK(99)], changed: ['context'], after: budget(), submitted: [], sent: [], toasts: 0 },
]

for (const one of CASES) {
  test(`session.measure: ${one.name}`, async ($, on) => {
    const seen = world(on, { stored: one.stored === undefined ? {} : { budget: one.stored }, now: one.now, isDelivered: one.isDelivered, isSubmitted: one.isSubmitted })
    await $.session.measure({ context: { window: 200_000 }, rateLimits: one.rateLimits, changed: one.changed ?? ['rateLimits'] })
    // 自分の会話への submit は待たずに投げるので、その後始末（印を書いてから toast）が済むまで待つ。
    // toast の出ない行は、待つ後始末が無い
    if (one.toasts > 0) await seen.toasted
    expect(seen.store.get('budget')).toEqual(one.after)
    expect(seen.submitted).toEqual(one.submitted)
    expect(seen.sent).toEqual(one.sent)
    expect(seen.toasts.length).toBe(one.toasts)
  })
}

test('session.measure: 越えた後にもう一度測っても、知らせは 1 回', async ($, on) => {
  const seen = world(on, { stored: { budget: budget() } })
  await $.session.measure({ context: { window: 200_000 }, rateLimits: [WEEK(96)], changed: ['rateLimits'] })
  await $.session.measure({ context: { window: 200_000 }, rateLimits: [WEEK(97)], changed: ['rateLimits'] })
  expect(seen.submitted).toEqual([MESSAGE])
  expect(seen.toasts.length).toBe(1)
})

const SET = 'mcp__budget__set_budget'
const CLEAR = 'mcp__budget__clear_budget'
const READ = 'mcp__budget__read_budget'

test('set_budget: いまの枠の期限を写し、呼んだセッションを届け先にして置く。前の予算は置き換える', async ($, on) => {
  const seen = world(on, { stored: { budget: budget({ percent: 50, sessionId: OTHER }) }, rateLimits: [WEEK(40)] })
  const called = await $.tool.call({ tool: SET, percent: 95 })
  expect(called).not.toHaveProperty('deny')
  expect(seen.store.get('budget')).toEqual({ kind: 'seven_day', percent: 95, sessionId: ME, resetsAt: RESETS_AT, notice: { state: 'watching' } })
})

test('set_budget: すでに越えていれば拒み、前の予算を残す', async ($, on) => {
  const seen = world(on, { stored: { budget: budget({ percent: 50 }) }, rateLimits: [WEEK(96)] })
  const called = await $.tool.call({ tool: SET, percent: 95 })
  expect(called).toHaveProperty('deny')
  expect(seen.store.get('budget')).toEqual(budget({ percent: 50 }))
})

const CLEARS: { name: string; stored?: unknown; result: string }[] = [
  { name: '予算を外す', stored: budget(), result: 'Removed the budget: seven_day at 95%.' },
  { name: '予算が無くても拒まない', result: 'No budget was set.' },
]

for (const one of CLEARS) {
  test(`clear_budget: ${one.name}`, async ($, on) => {
    const seen = world(on, { stored: one.stored === undefined ? {} : { budget: one.stored } })
    expect(await $.tool.call({ tool: CLEAR })).toEqual({ result: one.result })
    expect(seen.store.has('budget')).toBe(false)
  })
}

const READS: { name: string; stored?: unknown; now?: number; budget: unknown; kept: boolean }[] = [
  { name: '予算と使用率を返す', stored: budget(), budget: budget(), kept: true },
  { name: '予算が無ければ null', budget: null, kept: false },
  { name: '期限を過ぎた予算は外して null', stored: budget(), now: Date.parse(RESETS_AT) + 1, budget: null, kept: false },
]

for (const one of READS) {
  test(`read_budget: ${one.name}`, async ($, on) => {
    const seen = world(on, { stored: one.stored === undefined ? {} : { budget: one.stored }, rateLimits: [WEEK(40)], now: one.now })
    expect(await $.tool.call({ tool: READ })).toEqual({ result: JSON.stringify({ budget: one.budget, rateLimits: [WEEK(40)] }) })
    expect(seen.store.has('budget')).toBe(one.kept)
  })
}

// 自分の会話への submit はターンが終わるまで返らない。その間に予算が変わったら、知らせた印で書き戻さない
const HELD: { name: string; during: { [key: string]: unknown }; after: unknown }[] = [
  { name: '外した予算は戻さない', during: { tool: CLEAR }, after: undefined },
  { name: '置き直した予算は消さない', during: { tool: SET, percent: 99 }, after: budget({ percent: 99 }) },
]

for (const one of HELD) {
  test(`session.measure: submit を待つ間に、${one.name}`, async ($, on) => {
    const seen = world(on, { stored: { budget: budget() }, rateLimits: [WEEK(96)], isHeld: true })
    await $.session.measure({ context: { window: 200_000 }, rateLimits: [WEEK(96)], changed: ['rateLimits'] })
    await $.tool.call({ ...one.during, tool: String(one.during.tool) })
    seen.release()
    await seen.toasted
    expect(seen.store.get('budget')).toEqual(one.after)
  })
}
