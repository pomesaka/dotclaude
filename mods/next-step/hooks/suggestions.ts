import type { Suggestion } from '../types'

// 案の数の上限。横に並べて、1 枚の札が読める幅に収める
export const SUGGESTIONS_MAX = 4

// 環境変数 NEXT_STEP_MODEL が無いときに聞くモデル。
// WHY haiku: 札は、答えが出てから数秒のうちに並ばないと使われない。会話の全文を読むメインのモデルでは遅かった
// （2026-10-10 に利用者が実機で確認して、$.model.fork から切り替えた）
export const DEFAULT_MODEL = 'haiku'

// 依頼の文に入れる、直前の答えの長さの上限（文字数）。長い答えは末尾を残す。次の一手は、答えの結びから決まることが多い
const ANSWER_MAX = 6_000
// 依頼の文に入れる、答えより前の発言の数と、1 件あたりの長さの上限（文字数）。
// WHY 全文を渡さない: 読ませる量が、そのまま待ち時間になる。直前のやり取りが分かれば、次の一手は決まる
const TAIL_MESSAGES = 6
const MESSAGE_MAX = 1_500

const field = (value: unknown, key: string): unknown =>
  typeof value === 'object' && value !== null && key in value ? Reflect.get(value, key) : undefined

const text = (value: unknown): string => (typeof value === 'string' ? value.trim() : '')

// 案の並びを読む。読めなければ、理由の文字列を返す。
// WHY 札の重複を拒む: 同じ札が 2 枚並ぶと、利用者はどちらを押せばよいか選べない
export const parseSuggestions = (input: unknown): Suggestion[] | string => {
  const options = field(input, 'options')
  if (!Array.isArray(options)) return 'options must be a list'
  if (options.length > SUGGESTIONS_MAX) return `options must list at most ${SUGGESTIONS_MAX} suggestions`
  const parsed = options.map((option: unknown) => ({ label: text(field(option, 'label')), prompt: text(field(option, 'prompt')) }))
  if (parsed.some(one => one.label === '')) return 'every option needs a non-empty label'
  if (parsed.some(one => one.prompt === '')) return 'every option needs a non-empty prompt'
  if (new Set(parsed.map(one => one.label)).size !== parsed.length) return 'labels must be distinct'
  return parsed
}

// モデルの返事から、案の並びを取り出す。JSON の前後に文やコードの囲みが付いていても読む。
// 読めない返事は、案が無いものとして扱う。札は補助なので、読めなかったことを利用者に知らせない
export const parseReply = (reply: string): Suggestion[] => {
  const start = reply.indexOf('{')
  const end = reply.lastIndexOf('}')
  if (start === -1 || end <= start) return []
  try {
    const parsed: unknown = JSON.parse(reply.slice(start, end + 1))
    const suggestions = parseSuggestions(parsed)
    return typeof suggestions === 'string' ? [] : suggestions
  } catch {
    return []
  }
}

// 環境変数の値から、聞くモデルを決める。無いか空なら既定のモデル
export const modelOf = (configured: string | undefined): string => (text(configured) === '' ? DEFAULT_MODEL : text(configured))

// 会話の 1 件。$.session.messages() が返す行のうち、依頼の文に使う項目
export type Spoken = { role: 'user' | 'assistant'; text: string }

// 会話から、直前の答えより前の末尾を取り出す。文の無い発言（ツールの結果だけの行）は飛ばす。
// WHY 末尾の答えを落とす: 直前の答えは、依頼の文に別の枠で入れる。会話の記録にもう入っていれば、二重になる
export const tailOf = (messages: readonly Spoken[], answer: string): Spoken[] => {
  const spoken = messages.map(one => ({ role: one.role, text: one.text.trim() })).filter(one => one.text !== '')
  const last = spoken.at(-1)
  const before = last !== undefined && last.role === 'assistant' && last.text === answer.trim() ? spoken.slice(0, -1) : spoken
  return before.slice(-TAIL_MESSAGES).map(one => ({ role: one.role, text: one.text.length > MESSAGE_MAX ? `${one.text.slice(0, MESSAGE_MAX)}（後略）` : one.text }))
}

const SPEAKERS = { user: '利用者', assistant: 'Claude' } as const

// モデルに渡す、役割と返事の形の説明。毎回同じ文
export const SYSTEM_PROMPT = `あなたは、利用者と Claude（コーディングを手伝う AI）の会話を読んで、利用者が次に Claude へ送るとよい指示を提案する。利用者は、プロンプトを打つ代わりに、札を押してその指示を送る。

指示を 0〜${SUGGESTIONS_MAX} 個挙げる。

- label は札に出す短い言葉（10 文字くらいまで）。会話と同じ言語で書く
- prompt は、押したときにそのまま Claude へ送られる文。利用者が Claude に向けて打つ一言として書く。1 文で、30 文字くらいまで（「テストを足して」「README にも反映して」「未検証の点を実機で確かめて」）。Claude は会話をすべて覚えているので、経緯や対象の説明、確認してほしい項目の列挙は書かない。何を指すかが紛れるときだけ、対象の名前を 1 つ入れる
- 先頭の 1 個は、直前の答えの素直な続きにする（頼まれた作業の次の段、コミット、動作の確認など）
- 残りは、先頭と向きの違う案にする。同じ意味の案や、言い方だけを変えた案を並べない。向きの例:
  - やり残しの確認: 答えの中で「未検証」「確かめていない」「まだ」と書かれた点を確かめさせる。触れられていない境界のケースやテストを足させる
  - 別の進め方: いまの作りの弱いところを挙げさせる。もっと単純な形や、ほかの案と比べさせる
  - 一歩先: この作業が片付いた後に取りかかりそうな、関連する次の作業
  - 見直し: 差分のレビュー、文書への反映、振り返り
- Claude の答えが利用者への問いで終わっているなら、先頭からその問いへの答えを並べる（「直して」「そのままで」など）。枠が余れば、向きの違う案を足す
- 会話に出ていないことを頼む案でよい。利用者がまだ思いついていない一手を出すのが役目だ。ただし、存在を確かめていないファイルのパスやコマンドは具体的に書かず、何をしたいかを言葉で書く
- できるだけ ${SUGGESTIONS_MAX} 個出す。options を空にするのは、会話が挨拶や雑談だけで、頼むことが本当に無いときに限る

JSON だけを返す。前置きも説明も付けない。
{"options":[{"label":"…","prompt":"…"}]}`

// モデルに渡す、会話の末尾と直前の答え。
// WHY 答えを別の枠にする: 次の一手を決めるのは、ほとんどが直前の答え。前のやり取りは、何の話かを知るための補足
export const askPrompt = (tail: readonly Spoken[], answer: string): string => `<conversation>
${tail.map(one => `[${SPEAKERS[one.role]}]\n${one.text}`).join('\n\n')}
</conversation>

Claude が直前に返した答え:
<answer>
${answer.length > ANSWER_MAX ? `（前略）${answer.slice(-ANSWER_MAX)}` : answer}
</answer>`

// 札 1 枚の幅。枠も含む。横に並べた札と、そのあいだの 1 桁の隙間が、幅に収まるように割る
export const cardWidth = (columns: number, count: number): number => Math.max(12, Math.floor((columns - (count - 1)) / count))
