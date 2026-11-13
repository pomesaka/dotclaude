import type { LogEntry, SessionRecord, Trigger } from '../types'

// 一定のターン数で振り返るときの、最後に振り返ってからのターン数と、そのあいだの出来事（直された、止まった）の数の下限。
// WHY 出来事を要る: 何も起きていない区間は、次に活かせる発見が出にくい。分岐に聞く 1 回分を省く（2026-11-13 に利用者と決めた）
export const TURNS_FOR_TURN = 20
export const EVENTS_FOR_TURN = 1
// コミットや PR の作成で振り返るときの、最後に振り返ってからのターン数の下限。
// WHY 下限を持つ: コミットを続けて刻む作業で、そのたびに聞かない
export const TURNS_FOR_COMPLETION = 10
// compact の直前に振り返るときの下限。compact の後は会話が要約に置き換わるので、ここでは出来事を問わずに聞く
export const TURNS_FOR_COMPACT = 3

// 覚えておく発見の見出しと、報告の数
export const FOUND_MAX = 40
export const LOG_MAX = 10

export const EMPTY_RECORD: SessionRecord = { isOn: true, turns: 0, corrections: 0, stops: 0, found: [], log: [] }

const field = (value: unknown, key: string): unknown =>
  typeof value === 'object' && value !== null && key in value ? Reflect.get(value, key) : undefined

const count = (value: unknown): number => (typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : 0)

const strings = (value: unknown): string[] => (Array.isArray(value) ? value.filter((one): one is string => typeof one === 'string') : [])

const entries = (value: unknown): LogEntry[] =>
  Array.isArray(value)
    ? value.flatMap((one: unknown) => {
        const at = field(one, 'at')
        const text = field(one, 'text')
        return typeof at === 'number' && typeof text === 'string' ? [{ at, text }] : []
      })
    : []

// $.store から読んだ値を、セッションの記録として読む。形が合わない部分は、無いものとして扱う。
// WHY 既定で ON: 利用者は、頼まなくても振り返ってほしい（2026-11-13）。無駄打ちは、きっかけの下限で抑える
export const recordOf = (stored: unknown): SessionRecord => ({
  isOn: field(stored, 'isOn') !== false,
  turns: count(field(stored, 'turns')),
  corrections: count(field(stored, 'corrections')),
  stops: count(field(stored, 'stops')),
  found: strings(field(stored, 'found')).slice(0, FOUND_MAX),
  log: entries(field(stored, 'log')).slice(0, LOG_MAX),
})

// 利用者が打った文が、Claude を直す発言か。文の頭と、直すときによく使う言い回しで見る。
// WHY 粗くてよい: 拾いすぎても、分岐に 1 回聞くだけで済む。穏やかな言い方で直されたときは拾えないが、ターン数のきっかけで拾う
const CORRECTION_HEAD = /^(違う|ちがう|そうじゃな|そうではな|いや[、。,\s]|いやいや|なんで|なぜ|だめ|ダメ|やめて|戻して|さっき|前にも|また[、同]|待って)/
const CORRECTION_PHRASE = /(じゃなくて|ではなくて|って言った|と言った|と言ったよね|言ったじゃん|になってない|してないよね|できてない|間違って|違うよ)/

export const isCorrection = (text: string): boolean => {
  const trimmed = text.trim()
  return CORRECTION_HEAD.test(trimmed) || CORRECTION_PHRASE.test(trimmed)
}

// ターンの終わり方が、作業が止まったことを表すか。answer（答えて終わった）と max_turns 以外
export const isStop = (reason: string): boolean => reason !== 'answer' && reason !== 'max_turns'

// Bash のコマンドが、作業の区切り（コミット、push、PR の作成やマージ）か
const COMPLETION = /\b(jj (commit|git push)|git (commit|push)|gh pr (create|merge))\b/

export const isCompletion = (command: string): boolean => COMPLETION.test(command)

// いまのきっかけで、分岐に発見を聞くか。手で頼まれたら、必ず聞く
export const shouldJudge = (record: SessionRecord, trigger: Trigger): boolean => {
  switch (trigger) {
    case 'manual':
      return true
    case 'compact':
      return record.isOn && record.turns >= TURNS_FOR_COMPACT
    case 'completion':
      return record.isOn && record.turns >= TURNS_FOR_COMPLETION
    case 'turn':
      return record.isOn && record.turns >= TURNS_FOR_TURN && record.corrections + record.stops >= EVENTS_FOR_TURN
  }
}

const two = (value: number): string => String(value).padStart(2, '0')

// 書いた日時を、利用者のマシンの時刻で「2026-11-13 16:05」の形にする
export const stampOf = (date: Date): string =>
  `${date.getFullYear()}-${two(date.getMonth() + 1)}-${two(date.getDate())} ${two(date.getHours())}:${two(date.getMinutes())}`

// /retro の引数を読む。null は、読めない引数
export const actionOf = (args: string): 'run' | 'on' | 'off' | 'log' | null => {
  switch (args.trim().toLowerCase()) {
    case '':
      return 'run'
    case 'on':
      return 'on'
    case 'off':
      return 'off'
    case 'log':
      return 'log'
    default:
      return null
  }
}
