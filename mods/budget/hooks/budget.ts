import type { SessionRateLimit } from 'claude-code'

// 予算: Claude Code が測った使用率の枠（週、5時間）に置く閾値。$.store に 1 つだけ持つ。
// 守る決まり: 使用率が閾値に達したら、予算を置いたセッションに 1 回だけ知らせる。
// 期限（置いたときの枠の resetsAt）を過ぎたら外す。枠が戻れば、閾値の意味が無くなるため
export type Budget = {
  // 枠の種類。SessionRateLimit の kind（seven_day、five_hour）
  kind: string
  // 閾値。0 より大きく 100 以下
  percent: number
  // 知らせを受けるセッション。予算を置いたセッション
  sessionId: string
  // 期限。置いたときの枠の resetsAt（ISO 8601）
  resetsAt: string
  notice: Notice
}

// WHY 状態で持つ: 「知らせたか」を真偽値で持つと、いつ知らせたかが残らず、read_budget で答えられない
export type Notice = { state: 'watching' } | { state: 'notified'; at: string; isDelivered: boolean }

export type Judgement =
  | { kind: 'none' }
  | { kind: 'expired' }
  | { kind: 'unmeasured' }
  | { kind: 'below'; percentUsed: number }
  | { kind: 'reached'; percentUsed: number }
  | { kind: 'notified' }

export const DEFAULT_KIND = 'seven_day'

// 使用率の測り値と時刻から、予算をどうするかを決める
export const judge = (budget: Budget | null, rateLimits: SessionRateLimit[], now: number): Judgement => {
  if (budget === null) return { kind: 'none' }
  if (now >= Date.parse(budget.resetsAt)) return { kind: 'expired' }
  if (budget.notice.state === 'notified') return { kind: 'notified' }
  const window = rateLimits.find(one => one.kind === budget.kind)
  if (window === undefined) return { kind: 'unmeasured' }
  return window.percentUsed >= budget.percent
    ? { kind: 'reached', percentUsed: window.percentUsed }
    : { kind: 'below', percentUsed: window.percentUsed }
}

const KIND_LABELS: { [kind: string]: string } = { seven_day: '週', five_hour: '5時間' }

export const kindLabel = (kind: string): string => KIND_LABELS[kind] ?? kind

// $.store の予算が、知らせ始めたときの予算のままか。途中で置き直されたか外されていれば偽
export const isSameNotice = (current: Budget, budget: Budget, at: string): boolean =>
  current.kind === budget.kind &&
  current.percent === budget.percent &&
  current.sessionId === budget.sessionId &&
  current.resetsAt === budget.resetsAt &&
  current.notice.state === 'notified' &&
  current.notice.at === at

const reachedHead = (budget: Budget, percentUsed: number): string =>
  `予算（${kindLabel(budget.kind)} ${budget.percent}%）に達した（いま ${percentUsed}%）`

// 予算を置いたセッションに届ける文
export const reachedMessage = (budget: Budget, percentUsed: number): string =>
  `[budget] ${reachedHead(budget, percentUsed)}。今の作業を区切り、したことを報告して止まる。`

// 越えたと気づいたセッションの利用者に出す toast
export const reachedToast = (budget: Budget, percentUsed: number, isDelivered: boolean): string =>
  isDelivered
    ? `${reachedHead(budget, percentUsed)}。予算を置いたセッションに、止まるよう伝えた`
    : `${reachedHead(budget, percentUsed)}。予算を置いたセッション（${budget.sessionId}）には届かなかった`

const field = (value: unknown, key: string): unknown =>
  typeof value === 'object' && value !== null && key in value ? Object.getOwnPropertyDescriptor(value, key)?.value : undefined

const noticeOf = (value: unknown): Notice | null => {
  const state = field(value, 'state')
  if (state === 'watching') return { state }
  const at = field(value, 'at')
  const isDelivered = field(value, 'isDelivered')
  if (state === 'notified' && typeof at === 'string' && typeof isDelivered === 'boolean') return { state, at, isDelivered }
  return null
}

// $.store の値を予算に戻す。形が合わなければ null（予算が無いのと同じに扱う）
export const budgetOf = (value: unknown): Budget | null => {
  const kind = field(value, 'kind')
  const percent = field(value, 'percent')
  const sessionId = field(value, 'sessionId')
  const resetsAt = field(value, 'resetsAt')
  const notice = noticeOf(field(value, 'notice'))
  if (typeof kind !== 'string' || typeof percent !== 'number' || typeof sessionId !== 'string' || typeof resetsAt !== 'string' || notice === null) return null
  if (Number.isNaN(Date.parse(resetsAt))) return null
  return { kind, percent, sessionId, resetsAt, notice }
}

// set_budget の入力を読む。拒むときは理由の文を返す
export const parseSet = (input: unknown, rateLimits: SessionRateLimit[]): Pick<Budget, 'kind' | 'percent' | 'resetsAt'> | string => {
  const rawKind = field(input, 'kind')
  const kind = rawKind === undefined || rawKind === '' ? DEFAULT_KIND : rawKind
  if (typeof kind !== 'string') return 'kind must be a string'
  const percent = field(input, 'percent')
  if (typeof percent !== 'number' || !Number.isFinite(percent) || percent <= 0 || percent > 100) return 'percent must be a number above 0 and at most 100'
  const window = rateLimits.find(one => one.kind === kind)
  if (window === undefined) {
    const known = rateLimits.map(one => one.kind).join(', ')
    return `no reading for the ${kind} window yet${known === '' ? ' (no rate-limit windows: off a subscription, or before the first response)' : ` (measured: ${known})`}`
  }
  if (window.resetsAt === undefined || Number.isNaN(Date.parse(window.resetsAt))) return `the ${kind} window has no reset time, so the budget could not expire`
  if (window.percentUsed >= percent) return `the ${kind} window is already at ${window.percentUsed}%, at or past ${percent}%`
  return { kind, percent, resetsAt: window.resetsAt }
}
