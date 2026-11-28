import type { EngineInterface, Register, SessionRateLimit } from 'claude-code'

import { type Budget, budgetOf, isSameNotice, judge, parseSet, reachedMessage, reachedToast } from './budget'

// $.store のキー。予算は 1 つだけなので、セッションで分けない。
// WHY $.store: 予算を置くセッションと、使用率を測って越えたと気づくセッションが別になりうる
const KEY = 'budget'

const SET_TOOL_NAME = 'set_budget'
const SET_TOOL = 'mcp__budget__set_budget'
const SET_TOOL_DESCRIPTION = `Set the one usage budget: a threshold on a subscription rate-limit window (default seven_day). When any session sees the window reach the threshold, this session is sent a message to wrap up the current work, report and stop, once.
Call it at the start of a self-paced improvement session. It replaces an earlier budget, and is dropped when the window resets.`
const SET_TOOL_SCHEMA = {
  type: 'object',
  properties: {
    percent: { type: 'number', description: 'The threshold, as the window percentUsed (above 0, at most 100). 95 means stop at 95% of the window.' },
    kind: { type: 'string', description: 'The window: seven_day (default) or five_hour.' },
  },
  required: ['percent'],
}
const CLEAR_TOOL_NAME = 'clear_budget'
const CLEAR_TOOL = 'mcp__budget__clear_budget'
const CLEAR_TOOL_DESCRIPTION = 'Remove the usage budget, when the person asks or the work it paced is over.'
const READ_TOOL_NAME = 'read_budget'
const READ_TOOL = 'mcp__budget__read_budget'
const READ_TOOL_DESCRIPTION = 'Read the usage budget (or null) and the rate-limit windows as now measured (kind, percentUsed, resetsAt), as JSON.'
const EMPTY_SCHEMA = { type: 'object', properties: {} }

const load = async ($: EngineInterface): Promise<Budget | null> => budgetOf(await $.store.get(KEY))

// 期限を過ぎた予算は外してから返す
const loadLive = async ($: EngineInterface): Promise<Budget | null> => {
  const budget = await load($)
  if (budget !== null && judge(budget, [], await $.clock.now()).kind === 'expired') {
    await $.store.delete(KEY)
    return null
  }
  return budget
}

// 届いたかを印に残し、toast で知らせる
// WHY 届かなくても印は残す: 届かないのは、置いたセッションが閉じているときか、hook が文を止めたとき。
// 印を戻すと、測るたびに送り直して toast を重ねる
// WHY 読み直してから書く: 自分の会話への submit はターンが終わるまで返らない。その間に set_budget か clear_budget が
// 予算を変えていたら、手元の古い予算で書き戻すと、外した予算が戻るか、置き直した予算が消える
const finish = async ($: EngineInterface, budget: Budget, percentUsed: number, at: string, isDelivered: boolean): Promise<void> => {
  const current = await load($)
  if (current !== null && isSameNotice(current, budget, at)) await $.store.set(KEY, { ...budget, notice: { state: 'notified', at, isDelivered } })
  $.ui.toast(reachedToast(budget, percentUsed, isDelivered), { timeoutMs: 10_000 })
}

// 予算を置いたセッションに、達したことを届ける。
// WHY 自分なら submit: $.session.send は別のエージェントかセッションへ送るもの。自分の会話には submit で文を足す。
// WHY submit を待たない: 送信はいまのターンが終わるまで返らない。使用率はターンの途中でも測られ、待つと次の測りが詰まる
const deliver = async ($: EngineInterface, budget: Budget, percentUsed: number, at: string): Promise<void> => {
  const text = reachedMessage(budget, percentUsed)
  if (budget.sessionId === (await $.session.id())) {
    void $.prompt
      .submit({ text })
      .then(
        submitted => finish($, budget, percentUsed, at, submitted.drop === undefined),
        () => finish($, budget, percentUsed, at, false),
      )
      .catch(() => undefined)
    return
  }
  const sent = await $.session.send({ to: { sessionId: budget.sessionId }, text }).catch(() => null)
  await finish($, budget, percentUsed, at, sent !== null && sent.isDelivered)
}

const onMeasured = async ($: EngineInterface, rateLimits: SessionRateLimit[]): Promise<void> => {
  const budget = await load($)
  const now = await $.clock.now()
  const judged = judge(budget, rateLimits, now)
  if (judged.kind === 'expired') {
    await $.store.delete(KEY)
    return
  }
  if (budget === null || judged.kind !== 'reached') return
  // WHY 届ける前に印を置く: 使用率は全部のセッションに同じ値で届く。先に印を置き、ほかのセッションが続けて知らせるのを減らす
  const at = new Date(now).toISOString()
  await $.store.set(KEY, { ...budget, notice: { state: 'notified', at, isDelivered: false } })
  await deliver($, budget, judged.percentUsed, at)
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.tool.register({ name: SET_TOOL_NAME, description: SET_TOOL_DESCRIPTION, inputSchema: SET_TOOL_SCHEMA, isDeferred: false })
    await $.tool.register({ name: CLEAR_TOOL_NAME, description: CLEAR_TOOL_DESCRIPTION, inputSchema: EMPTY_SCHEMA, isDeferred: false })
    await $.tool.register({ name: READ_TOOL_NAME, description: READ_TOOL_DESCRIPTION, inputSchema: EMPTY_SCHEMA, isDeferred: false })
    return next(e)
  })

  on('tool.call', { tool: SET_TOOL }, async ($, e) => {
    const parsed = parseSet(e, (await $.session.usage()).rateLimits)
    if (typeof parsed === 'string') return { deny: `set_budget failed: ${parsed}` }
    const budget: Budget = { ...parsed, sessionId: await $.session.id(), notice: { state: 'watching' } }
    await $.store.set(KEY, budget)
    return { result: `Budget set: ${budget.kind} at ${budget.percent}%, until ${budget.resetsAt}. This session is told once when it is reached.` }
  }).catch(($, e, next) => (next.called ? next(e) : { deny: `set_budget failed: ${next.error.message}` }))

  on('tool.call', { tool: CLEAR_TOOL }, async $ => {
    const budget = await loadLive($)
    if (budget === null) return { result: 'No budget was set.' }
    await $.store.delete(KEY)
    return { result: `Removed the budget: ${budget.kind} at ${budget.percent}%.` }
  }).catch(($, e, next) => (next.called ? next(e) : { deny: `clear_budget failed: ${next.error.message}` }))

  on('tool.call', { tool: READ_TOOL }, async $ => {
    const budget = await loadLive($)
    const { rateLimits } = await $.session.usage()
    return { result: JSON.stringify({ budget, rateLimits }) }
  }).catch(($, e, next) => (next.called ? next(e) : { deny: `read_budget failed: ${next.error.message}` }))

  // どのセッションでも、使用率の枠が動いたら予算と比べる
  on('session.measure', async ($, e, next) => {
    if (e.changed.includes('rateLimits')) await onMeasured($, e.rateLimits)
    return next(e)
  }).catch(($, e, next) => {
    // WHY toast で出す: 判定が落ちると、予算が効かないまま誰も気づかない。測りのたびに出るが、落ちること自体が直すべき不具合なので抑えない
    $.ui.toast(`budget: 使用率と予算を比べられなかった: ${next.error.message}`, { timeoutMs: 10_000 })
    return next.called ? { changed: e.changed } : next(e)
  })
}
