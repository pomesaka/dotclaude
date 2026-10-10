import type { Consult, ConsultTurn, OpenQuestion } from '../types'
import { answerMessage, labelOf } from './questions'

// 相談用のエージェントに通す Bash のコマンド。先頭の語（jj は 2 語め、3 語めまで）で見る。
// WHY 自分で一覧を持つ: エンジンの権限の判定（tool.check）の allow は「利用者が確認なしで通すと決めた」という意味で、
// 設定の許可ルールに sed や gh pr edit があれば、書き換えるコマンドも allow になる（v2.1.296、2026-10-11 に確認）
const READ_COMMANDS: ReadonlySet<string> = new Set(['rg', 'fd', 'ls', 'cat', 'head', 'tail', 'wc', 'jq'])
const READ_JJ: ReadonlySet<string> = new Set(['log', 'diff', 'diffu', 'show', 'status', 'file show', 'file list'])
// 読むコマンドでも、別のコマンドを実行させるフラグ（fd の -x、rg の --pre）
const RUNS_ANOTHER = /(^|\s)(-x|-X|--exec|--exec-batch|--pre)(=|\s|$)/

// コマンドの文を、引用符の外にある ; | & と改行で分ける。
// 引用符の外に、リダイレクト（> <）やコマンドの展開（$( と `）があれば null。
// WHY 引用符を見る: rg 'a|b' の | で分けると、読むだけのコマンドを拒むことになる。
// WHY 二重引用符の中の展開も拒む: "$(touch x)" は、引用符の中でも実行される
const segmentsOf = (command: string): string[] | null => {
  const segments: string[] = []
  let current = ''
  let quote: '"' | "'" | null = null
  for (let at = 0; at < command.length; at++) {
    const char = command.charAt(at)
    if (quote === "'") {
      if (char === "'") quote = null
    } else if (char === '`' || (char === '$' && command.charAt(at + 1) === '(')) {
      return null
    } else if (quote === '"') {
      if (char === '\\') {
        current += char + command.charAt(at + 1)
        at++
        continue
      }
      if (char === '"') quote = null
    } else if (char === '\\') {
      current += char + command.charAt(at + 1)
      at++
      continue
    } else if (char === '"' || char === "'") {
      quote = char
    } else if (char === '>' || char === '<') {
      return null
    } else if (char === ';' || char === '|' || char === '&' || char === '\n') {
      segments.push(current)
      current = ''
      continue
    }
    current += char
  }
  // 閉じていない引用符は、どこまでが 1 つのコマンドかを決められない
  if (quote !== null) return null
  return [...segments, current].map(one => one.trim()).filter(one => one !== '')
}

const isReadSegment = (segment: string): boolean => {
  if (RUNS_ANOTHER.test(segment)) return false
  const [first = '', second = '', third = ''] = segment.split(/\s+/)
  if (first !== 'jj') return READ_COMMANDS.has(first)
  return READ_JJ.has(second) || READ_JJ.has(`${second} ${third}`)
}

// Bash のコマンドが、読むだけのコマンドだけでできているか。分けた全部が一覧に入っているときだけ true
export const isReadOnlyCommand = (command: string): boolean => {
  const segments = segmentsOf(command)
  return segments !== null && segments.length > 0 && segments.every(isReadSegment)
}

// 相談用のエージェントのツールの呼び出しを通すか。通すのは、Read と、読むだけの Bash。command は Bash のコマンドで、ほかのツールでは空文字
export const isReadOnlyCall = (tool: string, command: string): boolean => tool === 'Read' || (tool === 'Bash' && isReadOnlyCommand(command))

// tool.check の入力から、Bash のコマンドを読む。無ければ空文字
export const commandOf = (input: unknown): string => {
  const command = typeof input === 'object' && input !== null && 'command' in input ? Reflect.get(input, 'command') : undefined
  return typeof command === 'string' ? command : ''
}

// 相談用のエージェントに渡す、最初の依頼。
// WHY 決まりを文でも伝える: 止めるのは hook だが、理由を先に知らせておくと、拒まれたツールを別の手段で試さない。
// WHY 前置きを禁じる: 分岐したエージェントは、依頼を「タスク: …」と言い直してから答えることがある（2026-10-11 に試作で見た）
export const consultPrompt = (question: OpenQuestion): string =>
  [
    '[status-band: ここからは、利用者との相談用に分岐した会話です。メインの作業は、この会話とは別に進んでいます。]',
    '',
    `利用者は、保留 ${labelOf(question)}「${question.question}」について、決める前に詳しく聞きたいと思っています。`,
    ...(question.detail === '' ? [] : [`保留の説明: ${question.detail}`]),
    `選択肢: ${question.options.join(' / ')}`,
    `いまの仮置き: ${question.assumed}`,
    '',
    'まず、この保留が何を決めるものか、それぞれの選択肢を選ぶと何が変わるか、仮置きをそれにした理由を、短く説明してください。その後は、利用者の問いに答えてください。',
    '',
    '決まり:',
    '- 読むだけにする。ファイルの編集、コミット、push、外部への送信はしない。Read と、rg、fd、ls、cat、jj log、jj diff、jj show のような読むコマンドだけが通る。ほかのツールは仕組みで止められている',
    '- 答えは幅の狭い pane に出る。表を使わず、短い段落と箇条書きで書く',
    '- 依頼の言い直しや前置きを書かず、答えから始める',
    '- 保留を外す、答えを決める、といった操作はしない。決めるのは利用者で、結論は利用者がボタンでメインへ送る',
  ].join('\n')

// 結論をメインへ送る前に、相談用のエージェントへ頼む要約
export const SUMMARY_PROMPT =
  'この相談で利用者が決めたことと、付いた条件を、メインの Claude への申し送りとして 2〜3 文で書いてください。前置き、見出し、箇条書きは使わず、文だけを返してください。決まったことが無ければ「なし」とだけ返してください。'

// 要約の返事を、申し送りの文にする。「なし」は空文字
export const summaryOf = (reply: string): string => {
  const text = reply.trim()
  return text === 'なし' || text === 'なし。' ? '' : text
}

// 相談の結論を、メインの Claude へ送る文にする。
// option は選んだ選択肢で、null は選択肢に無い結論。summary は相談の要約で、空文字は付けない。
// 選択肢があって要約が無いときは、保留の pane で選んだときと同じ文になる
export const handoffMessage = (question: OpenQuestion, option: string | null, summary: string): string => {
  if (option === null) return `${labelOf(question)}（${question.question}）について相談した結論: ${summary}`
  return summary === '' ? answerMessage(question, option) : `${answerMessage(question, option)}\n相談で決まったこと: ${summary}`
}

// 終了の知らせ（task-notification）の文から、終わったエージェントの ID を読む。読めなければ null
export const notifiedAgentOf = (text: string): string | null => /<task-id>([^<]+)<\/task-id>/.exec(text)?.[1] ?? null

export const withTurn = (consult: Consult, turn: ConsultTurn, isWaiting: boolean): Consult => ({ ...consult, turns: [...consult.turns, turn], isWaiting })

// 利用者が、相談の中で 1 度でも問いを送ったか。送っていなければ、要約することが無い
export const hasTalked = (consult: Consult): boolean => consult.turns.some(turn => turn.speaker === 'user')
