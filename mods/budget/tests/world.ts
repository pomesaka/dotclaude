import type { TestBody } from 'claude-code/testing'

// テストが共有する土台。セッション、時刻、$.store、使用率、届け先を、決めた値で答える。
// テストの本体ではないので、ファイル名に .test を付けていない

export type On = Parameters<TestBody>[1]

export type RateLimit = { kind: string; percentUsed: number; resetsAt?: string }

export const ME = 's-me'
export const OTHER = 's-other'
export const NOW = Date.parse('2026-11-28T12:00:00.000Z')
export const RESETS_AT = '2026-11-30T00:00:00.000Z'

export const WEEK = (percentUsed: number): RateLimit => ({ kind: 'seven_day', percentUsed, resetsAt: RESETS_AT })

export type Given = {
  stored?: { [key: string]: unknown }
  // $.session.usage() が答える枠
  rateLimits?: RateLimit[]
  now?: number
  // 別のセッションへの送信が届くか
  isDelivered?: boolean
  // 自分の会話への submit が通るか
  isSubmitted?: boolean
  // 自分の会話への submit を、テストが release() を呼ぶまで返さない
  isHeld?: boolean
}

export const world = (on: On, given: Given = {}) => {
  const store = new Map(Object.entries(given.stored ?? {}))
  const toasts: string[] = []
  // 最初の toast で解ける。待たずに投げた送信の後始末が済んだのを、テストが待つために使う
  let onToast = (): void => undefined
  const toasted = new Promise<void>(resolve => {
    onToast = resolve
  })
  const submitted: string[] = []
  const sent: { to: string; text: string }[] = []

  on('session.id', () => ({ value: ME }))
  on('clock.now', () => ({ value: given.now ?? NOW }))
  on('tool.register', (_$, e) => ({ value: { tool: e.name } }))
  on('session.usage', () => ({ value: { startedAt: 0, context: { window: 200_000 }, rateLimits: given.rateLimits ?? [] } }))
  on('session.measure', (_$, e) => ({ changed: e.changed }))
  on('store.get', (_$, e) => ({ value: store.get(e.key) }))
  on('store.set', (_$, e) => {
    store.set(e.key, e.value)
    return { value: undefined }
  })
  on('store.delete', (_$, e) => {
    store.delete(e.key)
    return { value: undefined }
  })
  on('store.keys', () => ({ value: [...store.keys()] }))
  on('ui.toast', (_$, e) => {
    toasts.push(e.text)
    onToast()
    return { value: undefined }
  })
  // isHeld なら、submit は release() を呼ぶまで返らない。ターンの途中で送ったときと同じ
  let release = (): void => undefined
  const held = new Promise<void>(resolve => {
    release = resolve
  })
  on('prompt.submit', async (_$, e) => {
    submitted.push(e.text)
    if (given.isHeld === true) await held
    return given.isSubmitted === false ? { drop: 'refused' } : { text: e.text }
  })
  on('session.send', (_$, e) => {
    sent.push({ to: e.to, text: e.text })
    return given.isDelivered === false ? { isDelivered: false, reason: 'gone' } : { isDelivered: true }
  })
  return { store, toasts, toasted, submitted, sent, release }
}

export const budget = (over: { [key: string]: unknown } = {}) => ({
  kind: 'seven_day',
  percent: 95,
  sessionId: ME,
  resetsAt: RESETS_AT,
  notice: { state: 'watching' },
  ...over,
})
