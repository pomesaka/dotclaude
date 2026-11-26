import type { ReportBody, SessionRecord } from '../types'

// 「いま」の文字数と、利用者がすることの件数の上限。
// WHY 上限を持つ: 戻ってきた利用者が、pane を開いてすぐ読み終えるもの。頼みの文で「短く」と書いても、分岐は知っていることを全部書く
export const NOW_MAX = 200
export const TODO_MAX = 3

// 自動更新が ON のとき、最後に書いてからこのターン数が終わったら、書き直す（2026-10-10 に利用者が決めた。2026-10-29 に、分岐で書く形でも同じ頻度にすると決めた）
export const REFRESH_AFTER_TURNS = 5

export const EMPTY_RECORD: SessionRecord = { isOn: false, report: null, unchecked: 0 }

const field = (value: unknown, key: string): unknown =>
  typeof value === 'object' && value !== null && key in value ? Reflect.get(value, key) : undefined

const text = (value: unknown): string => (typeof value === 'string' ? value.trim() : '')

// 利用者がすることを読む。省かれているか空なら、空の並び。読めなければ、理由の文字列を返す
const todoOf = (value: unknown): string[] | string => {
  if (value === undefined) return []
  if (!Array.isArray(value)) return 'todo must be a list of strings'
  const list = value.map((one: unknown) => text(one))
  if (list.some(one => one === '')) return 'every item of todo must be a non-empty string'
  if (list.length > TODO_MAX) return `todo lists at most ${TODO_MAX} items; keep only what blocks the work now`
  return list
}

// 分岐の返事の JSON から、状況の中身を読む。読めなければ、理由の文字列を返す
export const parseReport = (input: unknown): ReportBody | string => {
  const now = text(field(input, 'now'))
  if (now === '') return 'now must be a non-empty string'
  if ([...now].length > NOW_MAX) return `now is at most ${NOW_MAX} characters`
  const todo = todoOf(field(input, 'todo'))
  if (typeof todo === 'string') return todo
  return { now, todo }
}

// $.store から読んだ値を、セッションの記録として読む。形が合わない部分は、無いものとして扱う。
// 前の形の状況（next と sections があった）は、now と todo が上限に収まれば、その 2 つだけを読む
export const recordOf = (stored: unknown): SessionRecord => {
  const saved = field(stored, 'report')
  const body = parseReport(saved)
  const updatedAt = field(saved, 'updatedAt')
  const turns = field(saved, 'turns')
  const unchecked = field(stored, 'unchecked')
  return {
    isOn: field(stored, 'isOn') === true,
    report: typeof body === 'string' || typeof updatedAt !== 'number' || typeof turns !== 'number' ? null : { ...body, updatedAt, turns },
    unchecked: typeof unchecked === 'number' ? unchecked : 0,
  }
}

// 状況がどれだけ前に書かれたかを、利用者が読む言葉にする
export const ageOf = (updatedAt: number, now: number): string => {
  const minutes = Math.floor(Math.max(0, now - updatedAt) / 60_000)
  if (minutes < 1) return 'たったいま更新'
  if (minutes < 60) return `${minutes}分前に更新`
  if (minutes < 60 * 24) return `${Math.floor(minutes / 60)}時間前に更新`
  return `${Math.floor(minutes / (60 * 24))}日前に更新`
}

const two = (value: number): string => String(value).padStart(2, '0')

// 状況を書いた日時を、利用者のマシンの時刻で「2026-10-10 23:05」の形にする
export const stampOf = (date: Date): string =>
  `${date.getFullYear()}-${two(date.getMonth() + 1)}-${two(date.getDate())} ${two(date.getHours())}:${two(date.getMinutes())}`

// /devrep の引数を読む。null は、読めない引数
export const actionOf = (args: string): 'open' | 'on' | 'off' | null => {
  switch (args.trim().toLowerCase()) {
    case '':
      return 'open'
    case 'on':
      return 'on'
    case 'off':
      return 'off'
    default:
      return null
  }
}
