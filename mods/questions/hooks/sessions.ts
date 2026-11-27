import type { FollowedSession, OpenQuestion } from '../types'
import { answerMessage } from './questions'

// セッションをまたぐ保留の受け渡し。
// 決まり: 保留は、それを足したセッション（持ち主）のもの。持ち主だけが、自分の一覧（qs:<ID>）を書く。
// 答えは、持ち主のセッションにだけ届く。束ねる側は、持ち主の一覧を読んで pane に出し、押された答えを持ち主へ送る。
// WHY 束ねる側が持ち主の一覧を書かない: 2 つのプロセスが同じキーを読んで書き戻すと、片方の足した保留が消える

const field = (value: unknown, key: string): unknown =>
  typeof value === 'object' && value !== null && key in value ? Reflect.get(value, key) : undefined

const text = (value: unknown): string => (typeof value === 'string' ? value.trim() : '')

const SESSION_ID_REQUIRED = 'session_id must be a non-empty string (the Claude session id)'

// follow_session ツールの入力を読む。me は、このセッションの ID。読めなければ、理由の文字列を返す
export const parseFollow = (input: unknown, me: string): FollowedSession | string => {
  const sessionId = text(field(input, 'session_id'))
  if (sessionId === '') return SESSION_ID_REQUIRED
  if (sessionId === me) return 'session_id is this session: its own questions are shown already'
  const label = text(field(input, 'label'))
  if (label === '') return 'label must be a non-empty string (the name the pane shows)'
  return { sessionId, label }
}

// unfollow_session ツールの入力を読む。読めなければ、理由の文字列を返す
export const parseUnfollow = (input: unknown): Pick<FollowedSession, 'sessionId'> | string => {
  const sessionId = text(field(input, 'session_id'))
  return sessionId === '' ? SESSION_ID_REQUIRED : { sessionId }
}

// $.store から読んだ値を、束ねたセッションの並びに戻す。形の合わない項目は飛ばす
export const followedOf = (stored: unknown): FollowedSession[] =>
  Array.isArray(stored)
    ? stored.flatMap((item: unknown) => {
        const sessionId = text(field(item, 'sessionId'))
        const label = text(field(item, 'label'))
        return sessionId === '' || label === '' ? [] : [{ sessionId, label }]
      })
    : []

// 束ねるセッションを足す。同じ ID があれば、並びはそのままで名前を置き換える。max を超えたら古いものから落とす
export const withFollowed = (list: FollowedSession[], one: FollowedSession, max: number): FollowedSession[] =>
  list.some(known => known.sessionId === one.sessionId)
    ? list.map(known => (known.sessionId === one.sessionId ? one : known))
    : [...list, one].slice(-max)

export const withoutFollowed = (list: FollowedSession[], sessionId: string): FollowedSession[] => list.filter(one => one.sessionId !== sessionId)

// 届いた本文から、自分の保留への答えを読む。どれかの行が、答えの文（answerMessage）で終わっていれば、その保留と選択肢。
// WHY 行の終わりで見る: 配達の本文には、エンジンが送り手の枠を付けることがある。枠の形は型に書かれていない。
// 答えの文の書き出し（【保留への回答】Q3）から終わりまでが一致するので、Q3 と Q13、選択肢の A と AB を取り違えない。
// 読み取れなければ null
export const receivedAnswerOf = (body: string, list: OpenQuestion[]): { question: OpenQuestion; option: string } | null => {
  const lines = body.split('\n').map(line => line.trim())
  for (const question of list) {
    const option = question.options.find(one => lines.some(line => line.endsWith(answerMessage(question, one))))
    if (option !== undefined) return { question, option }
  }
  return null
}

// 届けられなかった答えは、$.store の ans:<持ち主の ID>:<番号> に { option } で置く。
// WHY 1 問 1 キー: 束ねる側と持ち主の両方が書くので、一覧を読んで書き戻す形にすると、片方の書き込みが消える。
// 同じ問いに答え直すと、新しい答えで置き換わる
export const QUEUED_PREFIX = 'ans:'
export const queuedKey = (owner: string, id: number): string => `${QUEUED_PREFIX}${owner}:${id}`

// キーが owner あての届け待ちなら、その番号。違えば null
export const queuedIdOf = (key: string, owner: string): number | null => {
  const prefix = `${QUEUED_PREFIX}${owner}:`
  if (!key.startsWith(prefix)) return null
  const id = key.slice(prefix.length)
  return /^[1-9]\d*$/.test(id) ? Number(id) : null
}

// 届け待ちの値から、選んだ選択肢を読む。読めなければ null
export const queuedAnswerOf = (stored: unknown): string | null => {
  const option = text(field(stored, 'option'))
  return option === '' ? null : option
}

// 自分あての届け待ち 1 件をどうするか。deliver は、その保留に印を付けて Claude へ送る。discard は、送らずにキーを消す。
// 外した保留あてと、選択肢に無い答えは捨てる。WHY 捨てる: 持ち主が受け取れる問いが、もう無い。
// 同じ答えの印がもう付いていれば捨てる。WHY: 配達が届いたのに失敗と返り、届け待ちにも置かれたとき、同じ答えを 2 度送らない
export const queuedAction = (id: number, option: string | null, list: OpenQuestion[]): { deliver: OpenQuestion; option: string } | 'discard' => {
  const question = list.find(known => known.id === id)
  if (option === null || question === undefined || !question.options.includes(option) || question.answer === option) return 'discard'
  return { deliver: question, option }
}
