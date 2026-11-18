import type { Finding } from '../types'

// 依頼の文に入れる、直前の答えの長さの上限（文字数）。長い答えは末尾を残す
const ANSWER_MAX = 6_000
// 1 回の振り返りで書き手に渡す発見の上限。WHY: re のスキルの「量より質」。薄い発見を並べさせない
export const FINDINGS_MAX = 3

// 会話を分岐させて、次に活かせる発見を聞くときに、会話の後ろへ足す文。
// found は、このセッションでこれまでに見つけた発見の見出し。answer は、Claude が直前に返した答え。null は、渡せる答えが無い。
// WHY 答えを入れる: 分岐が使うのは「メインが最後に送った要求」で、直前の答えはまだ会話に入っていない（型定義の fork の説明）。
// WHY 前の見出しを入れる: 同じ区間を読み直して、同じ発見を書き手に渡さない
// toolCalls は、直前のターンでメインが道具を呼んだ回数。多かったときだけ渡し、その中の決まった手を探させる
export const judgePrompt = (found: readonly string[], answer: string | null, toolCalls: number | null = null): string => `[retro: この会話を振り返り、次の作業に活かせる発見だけを挙げる。Claude として作業を続けるのではない。]
${
  toolCalls === null
    ? ''
    : `
直前のターンで、Claude は道具を ${toolCalls} 回呼んだ。その中に、毎回同じで判断の要らない手（状態を調べる、指す先を確かめる、決まった順でコマンドを打つ）があれば、スクリプト、検査、Mod、hook のどれにするかを添えて発見に挙げる。置き場は ~/.claude/docs/agent-environment.md の順番で選ぶ。どの手も、その場で考えて打った手なら挙げない。
`
}${
  answer === null
    ? ''
    : `
Claude が直前に返した答え（上の会話にはまだ入っていない）:
<answer>
${answer.length > ANSWER_MAX ? `（前略）${answer.slice(-ANSWER_MAX)}` : answer}
</answer>
`
}
このセッションで、すでに挙げた発見（同じものは挙げない）:
<found>
${found.length === 0 ? 'まだ無い' : found.map(one => `- ${one}`).join('\n')}
</found>

挙げるのは、次のどれかに当たるものだけ。
- 詰まった点、見落としやすい点、利用者に直された点で、次に同じことを繰り返さないための注意
- 却下した案のある設計の判断
- スキルや作業の進め方で、次は変えたいと分かったこと
- このプロジェクトだけの決まり
- 毎回手で打っている、判断の要らない手順や検査（スクリプト、lint、hook にできるもの）

会話の要約、このセッションだけで終わる情報、すでに文書に書いてあることは挙げない。迷ったら挙げない。
多くても ${FINDINGS_MAX} 個。無ければ空の並びを返す。空でよい。

- title: 1 行の見出し。具体的な API 名でなく、次のプロジェクトでも使える原則の形で書く
- detail: 何が起き、次はどう動くべきか。判断の基準を 1 文で添える
- evidence: 根拠にした会話の発言や出来事を短く。道具やライブラリの挙動なら、名前と版を添える
- 利用者に答えるときの言語で書く

JSON だけを返す。前置きも説明も付けない。
{"findings":[{"title":"…","detail":"…","evidence":"…"}]}`

const field = (value: unknown, key: string): unknown =>
  typeof value === 'object' && value !== null && key in value ? Reflect.get(value, key) : undefined

const text = (value: unknown): string => (typeof value === 'string' ? value.trim() : '')

// 分岐の返事から、発見を読む。JSON の前後に文やコードの囲みが付いていても読む。読めなければ、理由の文字列を返す
export const parseJudgeReply = (reply: string): Finding[] | string => {
  const start = reply.indexOf('{')
  const end = reply.lastIndexOf('}')
  if (start === -1 || end <= start) return 'the reply has no JSON object'
  let parsed: unknown
  try {
    parsed = JSON.parse(reply.slice(start, end + 1))
  } catch {
    return 'the reply is not valid JSON'
  }
  const list = field(parsed, 'findings')
  if (!Array.isArray(list)) return 'findings must be a list'
  const findings: Finding[] = []
  for (const [index, one] of list.entries()) {
    const finding = { title: text(field(one, 'title')), detail: text(field(one, 'detail')), evidence: text(field(one, 'evidence')) }
    if (finding.title === '' || finding.detail === '') return `findings[${index}] needs a non-empty title and detail`
    findings.push(finding)
  }
  return findings.slice(0, FINDINGS_MAX)
}

// 発見を文書に書くエージェントへの依頼。cwd は、メインのセッションの作業ディレクトリ。
// WHY 書き先と重複の確かめ方を re のスキルに任せる: 書き先の表と書き方の決まりは、スキルの 1 か所にだけ置く
export const writerPrompt = (findings: readonly Finding[], cwd: string): string => `作業セッションの振り返りで見つかった発見を、文書に書く。
発見は、作業していたセッション（作業ディレクトリ ${cwd}）の会話から別のモデルが挙げたもので、あなたはその会話を読めない。

<findings>
${JSON.stringify(findings, null, 2)}
</findings>

~/.claude/skills/re/SKILL.md を読み、Step 2 から Step 4 に従って書く。Step 1 は済んでいるので、上の発見だけを扱う。
- 書く前に、同じ話題の項目が既にあるかを、書き先のファイルだけでなく ~/.claude/CLAUDE.md、~/.claude/docs/、~/.claude/skills/、${cwd} の CLAUDE.md と docs/ から rg で探す。あれば新しく足さず、その項目の mentions を 1 増やす。今回の発見で、その項目の書き方が伝わっていなかったと分かるなら、項目の文を直す
- 既に書いてある内容と同じで、足すことが無い発見は書かない
- ~/.claude の下のファイルは、実体のパス ~/github.com/pomesaka/dotclaude/ の下を編集する
- 文は ~/.claude/docs/japanese-writing.md の規則で書く
- コミットはしない。ファイルの編集だけをする

最後に、何をどこに書いたかを 1 行ずつ返す。「- <ファイル>: <見出し>（新規）」か「- <ファイル>: <見出し>（mentions N→N+1）」の形にする。書かなかった発見は「- 書かなかった: <見出し>（理由）」とする。`
