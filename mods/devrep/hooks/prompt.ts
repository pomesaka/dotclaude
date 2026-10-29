import type { ReportBody } from '../types'
import { ITEMS_MAX, parseReport, SECTIONS_MAX } from './report'

// 依頼の文に入れる、直前の答えの長さの上限（文字数）。長い答えは末尾を残す。状況は、答えの結びに出ることが多い
const ANSWER_MAX = 6_000

// 会話を分岐させて状況を書かせるときに、会話の後ろへ足す文。
// previous は、前に書いた状況。answer は、Claude が直前に返した答え。null は、渡せる答えが無い
// （中断やエラーで終わった、答えた後に次のターンが始まった）。
// WHY 答えを入れる: 分岐が使うのは「メインが最後に送った要求」で、その返事である直前の答えは、まだ会話に入っていない（型定義の fork の説明）。
// WHY 前の状況を入れる: 片付いたものや、利用者が済ませた todo を、前の状況と比べて直させる
export const forkPrompt = (previous: ReportBody | null, answer: string | null): string => `[devrep: この会話の作業の状況を、利用者が読む報告として書く。Claude として作業を続けるのではない。]
${
  answer === null
    ? ''
    : `
Claude が直前に返した答え（上の会話にはまだ入っていない）:
<answer>
${answer.length > ANSWER_MAX ? `（前略）${answer.slice(-ANSWER_MAX)}` : answer}
</answer>
`
}
前に書いた状況:
<previous>
${previous === null ? 'まだ無い' : JSON.stringify(previous)}
</previous>

読むのは、しばらく離れていて会話を忘れた利用者だ。会話を読み返す代わりに、これを読んで作業に戻る。

- now: いましていること。1〜2 文。何もしていなければ、そう書き、何を待っているかを書く
- next: 次にすること。取りかかる順に 1〜${ITEMS_MAX} 個。予定が無ければ、何を待っているかを書く
- todo: 利用者が自分でしないと作業が進まないこと。実行してほしいコマンド（そのまま貼れる全文で）、画面やブラウザで確かめてほしいこと、決めてほしいこと。急ぐ順に ${ITEMS_MAX} 個まで。無ければ空。questions の保留は「Q3 に答える」と番号で書き、中身を繰り返さない。利用者が済ませたものは消す
- sections: そのほかの節。見出しを決め、項目を 1〜${ITEMS_MAX} 個。${SECTIONS_MAX} つまで。決まったこと、知っておいてほしい前提、最近片付いたものなど、このセッションで要るものだけ。todo に書いたものは書かない
- 各項目は 1 文で、何のことかを名前で書く（「それを直す」でなく「帯の幅の計算を直す」）。表は書かない
- 前の状況のうち、今も正しいものは残し、古くなったものは直すか消す
- 利用者に答えるときの言語で書く

JSON だけを返す。前置きも説明も付けない。
{"now":"…","next":["…"],"todo":[],"sections":[{"title":"…","items":["…"]}]}`

// 分岐の返事から、状況を読む。JSON の前後に文やコードの囲みが付いていても読む。読めなければ、理由の文字列を返す
export const parseForkReply = (reply: string): ReportBody | string => {
  const start = reply.indexOf('{')
  const end = reply.lastIndexOf('}')
  if (start === -1 || end <= start) return 'the reply has no JSON object'
  try {
    return parseReport(JSON.parse(reply.slice(start, end + 1)))
  } catch {
    return 'the reply is not valid JSON'
  }
}
