import type { Consult, OpenQuestion } from '../types'
import { answerMessage, explainInstruction, labelOf, questionsOf } from './questions'

const field = (value: unknown, key: string): unknown =>
  typeof value === 'object' && value !== null && key in value ? Reflect.get(value, key) : undefined

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

// 相談用のエージェントのツールの呼び出しを通すか。通すのは、Read、読むだけの Bash、MCP のツール、スキルとツールの読み込み。
// command は Bash のコマンドで、ほかのツールでは空文字。
// WHY MCP のツールを通す: 説明に rich の show などを使えるようにする（2026-10-11 に利用者が決めた）。
// MCP のツールには書き込むものもあるが、ここでは見分けない。通すかどうかは、エンジンのふだんの権限の判定に任せる。
// WHY Skill と ToolSearch: 利用者の頼み方（「/rich で説明して」）に従うにはスキルを読み込む。後から読み込む MCP のツールは ToolSearch で取る。
// WHY NOT Write、Edit、書く Bash: 相談の相手が、メインの作業と同じファイルを書き換えないようにする
const LOADERS: ReadonlySet<string> = new Set(['Read', 'Skill', 'ToolSearch'])
export const isAllowedInConsult = (tool: string, command: string): boolean =>
  LOADERS.has(tool) || tool.startsWith('mcp__') || (tool === 'Bash' && isReadOnlyCommand(command))

// tool.check の入力から、Bash のコマンドを読む。無ければ空文字
export const commandOf = (input: unknown): string => {
  const command = typeof input === 'object' && input !== null && 'command' in input ? Reflect.get(input, 'command') : undefined
  return typeof command === 'string' ? command : ''
}

// 相談用のエージェントに付ける説明。エージェントの一覧に、この文で出る。
// WHY 説明で見分ける: Mod が覚えている ID は、セッションを裏に回して戻すと消える（v2.1.296 で確認）。
// 消えた後も、読むだけの絞り込みと、終了の知らせの遮断を続けるために、一覧の説明から相談用かどうかを判定する
export const consultDescription = (question: OpenQuestion): string => `${labelOf(question)} の相談`

export const isConsultDescription = (description: string | undefined): boolean => description !== undefined && /^Q\d+ の相談$/.test(description)

// $.store から読んだ値を、開いている相談に戻す。形が合わなければ null
export const consultOf = (stored: unknown): Consult | null => {
  const question = questionsOf([field(stored, 'question')])[0]
  const agentId = field(stored, 'agentId')
  return question === undefined || typeof agentId !== 'string' || agentId === '' ? null : { question, agentId, isHandingOff: false }
}

// 相談用のエージェントに渡す、最初の依頼。instruction は、最初の説明の頼み方（環境変数の値）で、空なら既定の頼み方。
// WHY 決まりを文でも伝える: 止めるのは hook だが、理由を先に知らせておくと、拒まれたツールを別の手段で試さない。
// WHY 前置きを禁じる: 分岐したエージェントは、依頼を「タスク: …」と言い直してから答えることがある（2026-10-11 に試作で見た）
export const consultPrompt = (question: OpenQuestion, instruction: string | undefined): string =>
  [
    '[questions: ここからは、利用者との相談用に分岐した会話です。メインの作業は、この会話とは別に進んでいます。]',
    '',
    `利用者は、保留 ${labelOf(question)}「${question.question}」について、決める前に詳しく聞きたいと思っています。この会話を開いて、直接やりとりします。`,
    ...(question.detail === '' ? [] : [`保留の説明: ${question.detail}`]),
    `選択肢: ${question.options.join(' / ')}`,
    `いまの仮置き: ${question.assumed}`,
    '',
    `まず、この保留について、${explainInstruction(instruction)}。何を決めるものか、それぞれの選択肢を選ぶと何が変わるか、仮置きをそれにした理由が分かるようにしてください。その後は、利用者の問いに答えてください。`,
    '',
    '決まり:',
    '- 読むだけにする。ファイルの編集、コミット、push、外部への送信はしない。Read と、rg、fd、ls、cat、jj log、jj diff、jj show のような読むコマンドだけが通る。Write、Edit、ほかのコマンドは仕組みで止められている',
    '- MCP のツールとスキルは使える。図や比較で見せたほうが早い説明には、rich の show のような道具を使ってよい。描く先は、必ずこの会話の中にする（show なら where は "inline"）。pane に出すと、結論のボタンがある相談の pane が隠れる',
    '- 選択肢をクリックで選べるようにするなら、問いは 1 つだけにして、答えとして送られる値を、この保留の選択肢と同じ綴りにする（rich の show なら、選択肢を比べる cards に key と question を付け、各カードの value に保留の選択肢をそのまま書く。同じ選択肢を question で並べ直さない）。利用者が押すと、その答えが結論としてメインへ送られ、相談が閉じる。ほかの問いは、クリックの質問にせず文で聞く',
    '- 依頼の言い直しや前置きを書かず、答えから始める',
    '- 保留を外す、答えを決める、といった操作はしない。決めるのは利用者で、結論は利用者が横の pane のボタンでメインへ送る',
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

// ほかの Mod が送ろうとした答えの文から、選ばれた保留の選択肢を読む。読めなければ null。
// 「問い: 選択肢」の形の行を探す（rich の show の答えは「【題名 への回答】」の後に、この形の行が並ぶ）。
// WHY 行の末尾で見る: 問いの文は、質問を描いたエージェントが決める。選択肢だけが、保留と同じ綴りだと分かっている。
// WHY 長い選択肢から見る: 「案 A」と「別の案 A」のように、片方がもう片方の末尾になっていても取り違えない
export const pickedOption = (text: string, options: readonly string[]): string | null => {
  const lines = text.split('\n').map(line => line.trim())
  const longestFirst = [...options].sort((left, right) => right.length - left.length)
  return longestFirst.find(option => lines.some(line => line.endsWith(`: ${option}`))) ?? null
}

// 終了の知らせ（task-notification）の文から、終わったエージェントの ID を読む。読めなければ null
export const notifiedAgentOf = (text: string): string | null => /<task-id>([^<]+)<\/task-id>/.exec(text)?.[1] ?? null

// 相談用のエージェントの会話のうち、利用者の側の発言の数。ツールの結果だけの発言は数えない。
// 1 は最初の依頼だけで、利用者はまだ何も聞いていない。2 以上なら、要約することがある
export const askedCount = (messages: readonly { role: string; text: string }[]): number =>
  messages.filter(message => message.role === 'user' && message.text.trim() !== '').length

// その会話に、その ID のツールの呼び出しがあるか
export const hasToolUse = (messages: readonly { toolUses: readonly { tool_use_id: string }[] }[], id: string): boolean =>
  messages.some(message => message.toolUses.some(use => use.tool_use_id === id))

// エージェントが、いま答えている最中か。最中に要約を頼むと、その答えに要約が混ざる
export const isAnswering = (status: string | undefined): boolean => status === 'pending' || status === 'running' || status === 'waiting'

// 相談の会話の中の質問への答えを、メインへ直接は送らずに受け取ったときの理由。会話の行に「Prompt dropped by a hook: …」として出る。
// WHY 「受け取りました」を含める: 答えを送った Mod（rich）は、止められると答えの文を toast で残す。
// rich は、理由にこの語があれば「引き取られた」と見て、toast を出さない（mods/rich の isTakenOver）。語を変えるなら、両方を直す
export const CONSULT_ANSWER_TAKEN = '相談の結論として受け取りました（要約を付けてメインへ送ります）'
