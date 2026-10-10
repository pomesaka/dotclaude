// 札の数の上限。先頭の 1 枚はエンジンの案、残りは会話を分岐させて聞いた案
export const SUGGESTIONS_MAX = 4

// 依頼の文に入れる、直前の答えの長さの上限（文字数）。長い答えは末尾を残す。次の一手は、答えの結びから決まることが多い
const ANSWER_MAX = 6_000

const field = (value: unknown, key: string): unknown =>
  typeof value === 'object' && value !== null && key in value ? Reflect.get(value, key) : undefined

const text = (value: unknown): string => (typeof value === 'string' ? value.trim() : '')

// モデルの返事から、案の並びを取り出す。JSON の前後に文やコードの囲みが付いていても読む。
// 空の案、taken にある案、重なった案は落とし、room 個までに切る。
// 読めない返事は、案が無いものとして扱う。札は補助なので、読めなかったことを利用者に知らせない。
// WHY 重なりを落とす: 同じ札が 2 枚並ぶと、利用者はどちらを押せばよいか選べない
export const parseReply = (reply: string, taken: readonly string[], room: number): string[] => {
  const start = reply.indexOf('{')
  const end = reply.lastIndexOf('}')
  if (start === -1 || end <= start) return []
  try {
    const parsed: unknown = JSON.parse(reply.slice(start, end + 1))
    const options = field(parsed, 'options')
    if (!Array.isArray(options)) return []
    const seen = new Set(taken)
    const picked: string[] = []
    for (const option of options) {
      const one = text(option)
      if (one === '' || seen.has(one)) continue
      seen.add(one)
      picked.push(one)
    }
    return picked.slice(0, Math.max(0, room))
  } catch {
    return []
  }
}

// 会話を分岐させて聞くときに、会話の後ろへ足す文。
// first は、エンジンがすでに出した案（入力欄に薄く出ているもの）。answer は、Claude が直前に返した答え。
// WHY 答えを入れる: 分岐が使うのは「メインが最後に送った要求」で、その返事である直前の答えは、まだ会話に入っていない（型定義の fork の説明）。
// WHY 「当てる」と頼む: 「次に送るとよい指示を提案して」と頼むと、それらしいが的を外した案が並ぶ。
//   Claude Code 自身の案（prompt suggestion）は「利用者が打とうとしている文を当てる」と頼んでいて、そのほうが当たる
//   （2026-10-10 に利用者が比べて決めた。指示文は実行ファイルから読んだ）
export const forkPrompt = (first: string, answer: string): string => `[next-step: この会話の利用者が、次に入力欄へ打ちそうな文を当てる。Claude として答えるのではない。]

Claude が直前に返した答え（上の会話にはまだ入っていない）:
<answer>
${answer.length > ANSWER_MAX ? `（前略）${answer.slice(-ANSWER_MAX)}` : answer}
</answer>

次の文が、すでに 1 つめの案として出ている:
<first>
${first}
</first>

これとは別に、利用者が次に打ちそうな文を、ありそうな順に ${SUGGESTIONS_MAX - 1} つまで挙げる。

- 利用者の最近の発言と、もともとの依頼を見る。利用者が「いま打とうとしていた」と思う文を書く。自分がよいと思う進め方を勧めるのではない
- この会話で利用者が気にしていたこと、後回しにしたこと、まだ返事をしていない問いを優先する
- 利用者の言葉づかいと長さに合わせる。1 文で、30 文字くらいまで
- Claude の答えが選択肢や問いで終わっているなら、利用者が選びそうな答えを書く
- 評価だけの文（「いいね」「ありがとう」）、問いかけ、Claude の口調の文（「〜します」）は書かない
- first と同じ意味の文は書かない。ありそうな文が思い当たらなければ、少なく返す。空でもよい

JSON だけを返す。前置きも説明も付けない。
{"options":["…","…"]}`

// 札 1 枚の幅。枠も含む。横に並べた札と、そのあいだの 1 桁の隙間が、幅に収まるように割る
export const cardWidth = (columns: number, count: number): number => Math.max(12, Math.floor((columns - (count - 1)) / count))
