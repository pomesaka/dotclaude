import type { OpenQuestion } from '../types'

// add_question が受け取る中身。番号と答えは、一覧に入れるときに付く
export type AskedQuestion = Pick<OpenQuestion, 'question' | 'detail' | 'options' | 'assumed'>

// 選択肢の数の上限。1 問の高さを、pane で読める範囲に収める
const OPTIONS_MAX = 6

const field = (value: unknown, key: string): unknown =>
  typeof value === 'object' && value !== null && key in value ? Reflect.get(value, key) : undefined

const text = (value: unknown): string => (typeof value === 'string' ? value.trim() : '')

// 文字列の配列として読む。空の項目と重複は落とす。配列でなければ null
const texts = (value: unknown): string[] | null =>
  Array.isArray(value) ? [...new Set(value.map((item: unknown) => text(item)).filter(item => item !== ''))] : null

// add_question ツールの入力を読む。読めなければ、理由の文字列を返す。
// WHY assumed は選択肢の 1 つ: この一覧に残すのは「仮に決めて先へ進んだこと」。どの選択肢がいまの実装かを、pane に印で出す
export const parseQuestion = (input: unknown): AskedQuestion | string => {
  const question = text(field(input, 'question'))
  if (question === '') return 'question must be a non-empty string'
  const options = texts(field(input, 'options'))
  if (options === null || options.length < 2) return 'options must list 2 or more distinct choices'
  if (options.length > OPTIONS_MAX) return `options must list at most ${OPTIONS_MAX} choices`
  const assumed = text(field(input, 'assumed'))
  if (!options.includes(assumed)) return 'assumed must be one of options, spelled the same (the choice you went with for now)'
  return { question, detail: text(field(input, 'detail')), options, assumed }
}

// resolve_question ツールの入力から、番号を読む。読めなければ、理由の文字列を返す
export const parseQuestionId = (input: unknown): number | string => {
  const id = field(input, 'id')
  return typeof id === 'number' && Number.isInteger(id) && id > 0 ? id : 'id must be a positive integer (the number after Q)'
}

// $.store から読んだ値を、保留の並びに戻す。形の合わない項目は飛ばす
export const questionsOf = (stored: unknown): OpenQuestion[] =>
  Array.isArray(stored)
    ? stored.flatMap((item: unknown) => {
        const id = field(item, 'id')
        const asked = parseQuestion(item)
        if (typeof id !== 'number' || !Number.isInteger(id) || typeof asked === 'string') return []
        const answer = text(field(item, 'answer'))
        return [{ id, ...asked, answer: asked.options.includes(answer) ? answer : null }]
      })
    : []

// $.store から読んだ値を、これまでに付けたいちばん大きい番号に戻す。まだ無ければ 0
export const lastIdOf = (stored: unknown): number => (typeof stored === 'number' && Number.isInteger(stored) && stored > 0 ? stored : 0)

// 保留を末尾に足す。並びは、古いものが先頭（番号の順）。
// 同じ問いがすでにあれば、番号はそのままで中身を置き換える。選択肢が変わるので、選んであった答えは消す。
// 番号は、このセッションでこれまでに付けたいちばん大きい番号（last）の次。
// WHY 番号を付ける: 利用者が「Q3 は A で」と会話で指せる。Claude も、決まった保留を番号で外せる。
// WHY 一覧の最大でなく last から数える: 外した番号を、次の保留に付け直さない。
// 過去の発言や、送られる途中の答えにある「Q3」が、別の問いを指さないようにする
export const addQuestion = (list: OpenQuestion[], added: AskedQuestion, max: number, last: number): { list: OpenQuestion[]; id: number } => {
  const known = list.find(one => one.question === added.question)
  if (known !== undefined) {
    return { list: list.map(one => (one.id === known.id ? { id: one.id, ...added, answer: null } : one)), id: known.id }
  }
  const id = list.reduce((largest, one) => Math.max(largest, one.id), last) + 1
  return { list: [...list, { id, ...added, answer: null }].slice(-max), id }
}

// 一覧と会話で使う呼び名
export const labelOf = (question: OpenQuestion): string => `Q${question.id}`

// 利用者が選んだ答えを書く。null は、選んでいない状態に戻す。その問いの選択肢でなければ、何も変えない
export const withAnswer = (list: OpenQuestion[], id: number, option: string | null): OpenQuestion[] =>
  list.map(one => (one.id === id && (option === null || one.options.includes(option)) ? { ...one, answer: option } : one))

// Claude へ送る答えの文の書き出し。SESSION_CONTEXT が、この書き出しで届くと説明している
export const ANSWER_HEADING = '【保留への回答】'

// 選んだ答えを、Claude へ送る文にする。仮置きのままでよい答えには、その旨を付ける
export const answerMessage = (question: OpenQuestion, option: string): string =>
  `${ANSWER_HEADING}${labelOf(question)} ${question.question}: ${option}${option === question.assumed ? '（仮置きのまま）' : ''}`

const EXPLAIN_DEFAULT = '詳しく説明して'

// 保留の説明の頼み方。instruction は環境変数の値で、空なら既定の頼み方にする
export const explainInstruction = (instruction: string | undefined): string => (text(instruction) === '' ? EXPLAIN_DEFAULT : text(instruction))

// 保留の説明を、メインの Claude に頼む文
export const explainMessage = (question: OpenQuestion, instruction: string | undefined): string =>
  `${labelOf(question)}（${question.question}）について、${explainInstruction(instruction)}`

// 選択肢に無い答えを利用者が書くときに、入力欄に入れておく書き出し
export const answerOpening = (question: OpenQuestion): string => `${labelOf(question)}（${question.question}）は、`
