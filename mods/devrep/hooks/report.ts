import type { ReportBody, Section, SessionRecord } from '../types'

// 1 つの節に並べる項目と、自由な節の数の上限。
// WHY 上限を持つ: 戻ってきた利用者が、pane の 1〜2 画面で読むもの。経過を全部並べると、会話を読み返すのと変わらなくなる
export const ITEMS_MAX = 6
export const SECTIONS_MAX = 6

// 最後に書いたか促してから、このターン数が終わったら、書き直しを促す（2026-10-10 に利用者が決めた）
export const REMIND_AFTER_TURNS = 5

export const EMPTY_RECORD: SessionRecord = { isOn: false, report: null, unchecked: 0 }

const field = (value: unknown, key: string): unknown =>
  typeof value === 'object' && value !== null && key in value ? Reflect.get(value, key) : undefined

const text = (value: unknown): string => (typeof value === 'string' ? value.trim() : '')

// 項目の並びを読む。name は、エラーの文に出す場所の名前。読めなければ、理由の文字列を返す
const items = (value: unknown, name: string): string[] | string => {
  if (!Array.isArray(value) || value.length === 0) return `${name} must be a list of at least one string`
  const list = value.map((one: unknown) => text(one))
  if (list.some(one => one === '')) return `every item of ${name} must be a non-empty string`
  if (list.length > ITEMS_MAX) return `${name} lists at most ${ITEMS_MAX} items; keep the ones the user needs to pick the work back up`
  return list
}

// 自由な節を読む。省かれていれば空。読めなければ、理由の文字列を返す
const sectionsOf = (value: unknown): Section[] | string => {
  if (value === undefined) return []
  if (!Array.isArray(value)) return 'sections must be a list'
  if (value.length > SECTIONS_MAX) return `sections lists at most ${SECTIONS_MAX} sections`
  const parsed: Section[] = []
  for (const [index, one] of value.entries()) {
    const title = text(field(one, 'title'))
    if (title === '') return `sections[${index}] needs a non-empty title`
    const list = items(field(one, 'items'), `sections[${index}].items`)
    if (typeof list === 'string') return list
    parsed.push({ title, items: list })
  }
  if (new Set(parsed.map(one => one.title)).size !== parsed.length) return 'section titles must be distinct'
  return parsed
}

// ツールの入力から、状況の中身を読む。読めなければ、理由の文字列を返す。
// WHY now と next は必須: 戻ってきた利用者が最低限知りたいのは、いま何をしていて、次に何をするか（2026-10-10 に利用者が決めた）
export const parseReport = (input: unknown): ReportBody | string => {
  const now = text(field(input, 'now'))
  if (now === '') return 'now must be a non-empty string'
  const next = items(field(input, 'next'), 'next')
  if (typeof next === 'string') return next
  const sections = sectionsOf(field(input, 'sections'))
  if (typeof sections === 'string') return sections
  return { now, next, sections }
}

// $.store から読んだ値を、セッションの記録として読む。形が合わない部分は、無いものとして扱う
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
