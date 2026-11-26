import type { ReportBody } from '../types'
import { NOW_MAX, parseReport, TODO_MAX } from './report'

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

読むのは、しばらく離れていて会話を忘れた利用者だ。開いてすぐ読み終え、自分の番かどうかが分かれば足りる。

- now: いまどうなっているか。${NOW_MAX} 字まで、1〜2 文。前の状況から変わったこと（終わった、決まった）があれば先に書き、何を待っているかで結ぶ
- todo: 利用者がいま動かないと作業が止まっていることだけ。実行してほしいコマンド（そのまま貼れる全文で）、確かめてほしい画面、決めてほしいこと。${TODO_MAX} 個まで、急ぐ順。無ければ空。questions の保留は「Q3 に答える」と番号で書く
- todo に書かないもの: 条件が来てからすること（「〜が終わったら」「マージの前に」）。それは条件が来た時の会話で頼むか、PR の本文に置く。Claude 自身の次の手、決まったことの要約も書かない
- 別のセッションは、名前（shoko-d385 など）でなく担当で書く（「#270 の担当」）
- 前の状況のうち、利用者が済ませたもの、古くなったものは消す
- 利用者に答えるときの言語で書く

JSON だけを返す。前置きも説明も付けない。
{"now":"…","todo":[]}`

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
