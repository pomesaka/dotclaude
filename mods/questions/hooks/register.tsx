import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Consult, OpenQuestion } from '../types'
import {
  CONSULT_ANSWER_TAKEN,
  askedCount,
  commandOf,
  consultDescription,
  consultOf,
  consultPrompt,
  handoffMessage,
  isAllowedInConsult,
  isAnswering,
  isConsultDescription,
  hasToolUse,
  notifiedAgentOf,
  pickedOption,
  summaryOf,
  summaryPrompt,
} from './consult'
import { SESSION_CONTEXT } from './context'
import {
  addQuestion,
  answerOpening,
  explainMessage,
  labelOf,
  lastIdOf,
  parseQuestion,
  parseQuestionId,
  questionsOf,
  withAnswer,
} from './questions'

const questions = atom({ plugin: 'questions', key: 'questions' } as const, [])
// $.store に覚えておくセッションの数。古いセッションから落とす
const SESSIONS_MAX = 30

// pane と、プロンプトの下の行に足す札の色。status-band の帯と同じ
const ACCENT = '#6cb6ff'
const GREEN = '#7ee0a1'
const SURFACE = '#30363d'
const SOFT = '#c9d1d9'
const consult = atom({ plugin: 'questions', key: 'consult' } as const, null)
const CONSULT_PANE = 'consult'
const CONSULT_PANE_TITLE = 'consult'
// $.store には、セッションごとに開いている相談（保留とエージェントの ID）を持つ。キーは consult:<セッションID>。
// WHY 持つ: Mod の記憶は、セッションを裏に回して戻すと消える（v2.1.296 で確認）。消えても、結論を送るボタンを使えるようにする
const CONSULT_PREFIX = 'consult:'
// 相談の要約を待っている受け取り口。null は、待っていない
let summaryWaiter: { agentId: string; resolve: (reply: string) => void } | null = null
// 要約を待つ上限（ミリ秒）。過ぎたら、要約を付けずに結論を送る
const SUMMARY_TIMEOUT_MS = 30_000
// 相談用のエージェントに、読む以外のツールを拒むときの理由。エージェントが読む
const CONSULT_READ_ONLY = 'This side conversation does not change files: only Read, MCP tools and read-only shell commands (rg, fd, ls, cat, head, tail, wc, jq, jj log/diff/show/status) without redirection run here. Answer from what you can read.'
// 相談用のエージェントの終了の知らせを捨てるときの理由。会話の行に「Prompt dropped by a hook: …」として出る
const CONSULT_NOTICE_DROPPED = '相談用のエージェントの終了の知らせ（メインには渡さない）'
// 相談の会話の中のボタンが押された時刻（ミリ秒）。直後に Mod が送る文を、相談の結論として受け取る。null は、押されていない。
// WHY モジュール変数でよい: 消えると、ボタンの答えがメインへ直接届く前の動きに戻るだけで、壊れない
let consultPressedAt: number | null = null
// ボタンが押されてから、送られる文を待つ時間（ミリ秒）。過ぎた後の文は、関係の無い文として通す
const CONSULT_PRESS_WINDOW_MS = 5_000
// 会話の中のボタンで答えたときに、エージェントが答え終わるのを待つ上限と、確かめる間隔（ミリ秒）
const IDLE_WAIT_MS = 20_000
const IDLE_POLL_MS = 500
const QUESTIONS_PANE = 'questions'
const QUESTIONS_PANE_TITLE = 'open questions'

// $.store には、セッションごとに保留の配列を持つ。キーは qs:<セッションID>
const QUESTIONS_PREFIX = 'qs:'
// このセッションで保留に付けた、いちばん大きい番号。保留を外しても減らさない
const QUESTION_LAST_PREFIX = 'qlast:'
// 1 つのセッションで覚える保留の数。古いものから落とす
const QUESTIONS_MAX = 100

// Claude が、仮に決めて先へ進んだことを一覧に残すためのツールと、決まった保留を外すためのツール
const QUESTION_TOOL_NAME = 'add_question'
const QUESTION_TOOL = 'mcp__questions__add_question'
const QUESTION_TOOL_DESCRIPTION = `Record a decision you made provisionally so work could continue, in the user's open questions pane, for the user to settle later by clicking one of the choices.
Call it when you go ahead on an assumption the user has not confirmed: a name, a default, a threshold, a behaviour you picked between options. Not for things you can verify yourself, and not when you need the answer before continuing (ask instead).
Calling it again with the same question replaces it. The result gives the number (Q3) the user will refer to it by.`
const QUESTION_TOOL_SCHEMA = {
  type: 'object',
  properties: {
    question: { type: 'string', description: 'A short heading, in the language you answer the user in: what is left to decide.' },
    detail: {
      type: 'string',
      description: 'One to three sentences the user can decide from without rereading the conversation: what this is about, and what changes with each choice.',
    },
    options: { type: 'array', items: { type: 'string' }, minItems: 2, maxItems: 6, description: 'The choices, each a short label. The user clicks one.' },
    assumed: { type: 'string', description: 'The choice you went with for now. Must be one of options, spelled the same.' },
  },
  required: ['question', 'detail', 'options', 'assumed'],
}
// Claude が、保留の中身を読み直すためのツール。
// WHY 読むツールを持つ: 保留は、残してから時間がたって答えが届く。会話が圧縮された後でも、問いと選択肢を取り戻せるようにする。
// 利用者が「この問いを rich で説明して」と頼んだときにも、ここから中身を取る
const LIST_TOOL_NAME = 'list_questions'
const LIST_TOOL = 'mcp__questions__list_questions'
const LIST_TOOL_DESCRIPTION = `Read the open questions on the user's open questions pane as JSON: id, question, detail, options, assumed, and answer (the choice the user clicked, or null).
Use it when you need a question's wording or choices again, for example to explain one in more depth before the user decides.`
const LIST_TOOL_SCHEMA = { type: 'object', properties: {} }
const RESOLVE_TOOL_NAME = 'resolve_question'
const RESOLVE_TOOL = 'mcp__questions__resolve_question'
const RESOLVE_TOOL_DESCRIPTION = `Remove an open question from the user's open questions pane, once the user has settled it and you have applied the decision.`
const RESOLVE_TOOL_SCHEMA = {
  type: 'object',
  properties: {
    id: { type: 'integer', minimum: 1, description: 'The number of the question: 3 for Q3.' },
  },
  required: ['id'],
}

// このセッションの値を $.store に書く。キーは <prefix><セッションID>。覚えておくセッションの数を超えたら、古いものから消す。
// WHY 消してから書く: $.store.keys() の並びを「最後に書いた順」に保ち、古いセッションから落とせるようにする
const saveForSession = async ($: EngineInterface, prefix: string, value: OpenQuestion[] | number): Promise<void> => {
  const key = `${prefix}${await $.session.id()}`
  await $.store.delete(key)
  await $.store.set(key, value)
  const keys = (await $.store.keys()).filter(stored => stored.startsWith(prefix))
  for (const stale of keys.slice(0, Math.max(0, keys.length - SESSIONS_MAX))) await $.store.delete(stale)
}

const loadQuestions = async ($: EngineInterface): Promise<OpenQuestion[]> =>
  questionsOf(await $.store.get(`${QUESTIONS_PREFIX}${await $.session.id()}`))

// 保留の一覧を、$.store と画面の両方に書く
const saveQuestions = async ($: EngineInterface, list: OpenQuestion[]): Promise<void> => {
  await saveForSession($, QUESTIONS_PREFIX, list)
  await update($, questions, current => (JSON.stringify(current) === JSON.stringify(list) ? current : list))
}

// 保留を一覧から外す。返すのは、外した後の一覧。その番号が無ければ null
const dropQuestion = async ($: EngineInterface, id: number): Promise<OpenQuestion[] | null> => {
  const list = await loadQuestions($)
  if (!list.some(one => one.id === id)) return null
  const rest = list.filter(one => one.id !== id)
  await saveQuestions($, rest)
  return rest
}

// 利用者が pane のボタンで選んだ答えを、その場で Claude に送る。選んだ選択肢は、一覧に印で残す。
// WHY 1 つずつ送る: 選んだらすぐ届く。まとめて送る操作を別に持たない（2026-10-10 に利用者が決めた）。
// WHY asUser: 答えは利用者が選んだもの。利用者が打って送った文と同じ扱いで届ける。
// WHY 待たない: 送信は、いまのターンが終わるまで返らない（submitNotice と同じ）。
// 先に印を付けておき、送れなかったときに戻す。
// summary は、相談の pane から送るときに付ける要約。保留の pane から送るときは空文字
const answerQuestion = async ($: EngineInterface, question: OpenQuestion, option: string, summary = ''): Promise<void> => {
  await saveQuestions($, withAnswer(await loadQuestions($), question.id, option))
  const undo = async (): Promise<void> => {
    await saveQuestions($, withAnswer(await loadQuestions($), question.id, question.answer))
    $.ui.toast(`${labelOf(question)} の答えを送れませんでした。もう一度、選択肢を押してください`, { timeoutMs: 8_000 })
  }
  void $.prompt.submit({ text: handoffMessage(question, option, summary), asUser: true }).then(
    result => (result.drop === undefined ? undefined : undo()),
    () => undo(),
  )
}

// 相談用のエージェントを立てられなかったときに、保留の説明をメインの Claude に頼む。答えは付けない。
// 頼み方は、環境変数 QLIST_EXPLAIN_PROMPT で差し替えられる。
// WHY 環境変数: 説明の出し方（文章、rich の図）は利用者の好みで、Mod は rich に依存しない。
// 「/explain-inline で説明しろ」のように書けば、Claude がそのスキルで描く。
// WHY 待たない: answerQuestion と同じ
const explainInMain = async ($: EngineInterface, question: OpenQuestion): Promise<void> => {
  const failed = (): void => $.ui.toast(`${labelOf(question)} の説明を頼めませんでした。もう一度押してください`, { timeoutMs: 8_000 })
  // $.env.get の名前は、文字列をその場に書く。定数で渡すと読み込みで弾かれる（v2.1.295）
  const instruction = await $.env.get('QLIST_EXPLAIN_PROMPT')
  void $.prompt.submit({ text: explainMessage(question, instruction), asUser: true }).then(
    result => (result.drop === undefined ? undefined : failed()),
    () => failed(),
  )
}

// エージェントが相談用かどうかを、ID ごとに覚える。
// WHY 覚える: 絞り込みの hook は、どのエージェントのどのツールの呼び出しでも通る。そのたびに一覧を読まない。
// WHY モジュール変数でよい: 消えても、エージェントの一覧の説明から判定し直せる
const consultKinds = new Map<string, boolean>()

// そのエージェントが、この Mod の立てた相談用のエージェントか。
// WHY 一覧の説明で判定する: Mod が覚えている ID は、セッションを裏に回して戻すと消える（v2.1.296 で確認）。
// 消えた後に、絞り込みが外れたり、終了の知らせがメインに届いたりしないようにする。
// 一覧にまだ出ていないエージェントは、覚えずに、次の呼び出しで調べ直す
const isConsultAgent = async ($: EngineInterface, agentId: string | undefined): Promise<boolean> => {
  if (agentId === undefined) return false
  const known = consultKinds.get(agentId)
  if (known !== undefined) return known
  const found = (await $.agent.list().catch(() => [])).find(agent => agent.id === agentId)
  if (found === undefined) return false
  const isConsult = isConsultDescription(found.description)
  consultKinds.set(agentId, isConsult)
  return isConsult
}

// 開いている相談を読む。Mod の記憶が消えていたら、$.store に残っているものを返す。
// WHY 読んだものを記憶に書き戻さない: pane を描く hook からも呼ぶ。描く hook の中では、状態を書けない
// （state.set: denied: it was made while ui.render is being dispatched。claude plugin test で確認、v2.1.296）
const currentConsult = async ($: EngineInterface): Promise<Consult | null> =>
  (await read($, consult)) ?? consultOf(await $.store.get(`${CONSULT_PREFIX}${await $.session.id()}`))

// 開いている相談を、画面と $.store の両方に書く。null は、相談を閉じる。
// WHY エージェントが決まった相談だけを $.store に書く: 立てている最中の相談は、戻しても続けられない
const saveConsult = async ($: EngineInterface, next: Consult | null): Promise<void> => {
  await update($, consult, () => next)
  const key = `${CONSULT_PREFIX}${await $.session.id()}`
  if (next === null || next.agentId === null) await $.store.delete(key)
  else await $.store.set(key, { question: next.question, agentId: next.agentId })
}

// 立てたエージェントの ID を、エージェントの一覧から探す。まだ相談に使っていない、その説明のいちばん新しいもの。無ければ undefined。
// WHY 一覧から探す道を持つ: spawn の答えの agentId は、型では無いことがある。
// claude plugin test の土台は ID を返さないので、この道が無いと、立てた後の動きを試せない（v2.1.296）。
// 実機の spawn は ID を返すことを確認している
const spawnedAgentOf = async ($: EngineInterface, description: string, used: string | null): Promise<string | undefined> =>
  (await $.agent.list().catch(() => [])).filter(agent => agent.description === description && agent.id !== used).at(-1)?.id

// 相談用のエージェントが、エンジンの一覧からもう外されているか。一覧を読めなければ、残っているものとして扱う。
// WHY 調べる: エンジンは、答え終わったエージェントを、その会話を開いていないと 30 秒で一覧から外す
// （v2.1.296 の実行ファイルで確認）。外れた後は、利用者がその会話を開けない
const isAgentGone = async ($: EngineInterface, agentId: string): Promise<boolean> => {
  const listed = await $.agent.list().catch(() => null)
  return listed !== null && !listed.some(agent => agent.id === agentId)
}

// 利用者が pane の「詳しく聞く」を押した保留について、相談を始める。
// メインの会話を引き継いだエージェント（フォーク）を立て、最初の説明を頼んで、相談の pane を開く。
// 利用者は、エンジンのエージェントの会話の画面を開いて、そこで直接やりとりする。
// WHY メインに頼まない: メインが動いている最中は、頼んだ文がターンの終わりまで待たされる。説明と相談のやりとりで、メインの文脈も増える
// （2026-10-11 に利用者が決めた）。
// WHY フォーク: 保留を置いた経緯を知っているのは、会話を引き継いだエージェントだけ。
// メインのターンの最中でも立てられ、進行中のターンのそこまでを見ている（v2.1.296 で確認）。
// WHY 会話を pane に描かない: エンジンのエージェントの画面は、通常のセッションと同じ表示で、入力欄からそのエージェントへ直接送れる。
// rich の show も会話の行に描かれる。pane に作り直すと、その全部を自分で描くことになる（2026-10-11 に実機で確認して決めた）。
// 同じ保留の相談が開いていて、そのエージェントがまだ一覧にあれば、立て直さずに pane を開き直す。
// 一覧から外されていたら、立て直す。前のやりとりは引き継げない
const startConsult = async ($: EngineInterface, question: OpenQuestion): Promise<void> => {
  const open = await currentConsult($)
  // WHY フォーカスを移さない: 利用者はこの後、キーボードでエージェントの会話を開く
  await $.ui.open({ id: CONSULT_PANE, title: CONSULT_PANE_TITLE })
  if (open !== null && open.question.id === question.id && open.agentId !== null && !(await isAgentGone($, open.agentId))) return
  await saveConsult($, { question, agentId: null, isHandingOff: false })
  const description = consultDescription(question)
  // $.env.get の名前は、文字列をその場に書く。定数で渡すと読み込みで弾かれる（v2.1.295）
  const instruction = await $.env.get('QLIST_EXPLAIN_PROMPT')
  const started = await $.agent.spawn({ prompt: consultPrompt(question, instruction), description, subagentType: 'fork' }).catch(() => null)
  const agentId =
    started === null || started.deny !== undefined ? undefined : (started.agentId ?? (await spawnedAgentOf($, description, open?.agentId ?? null)))
  if (agentId === undefined) {
    // 立てられなかった（最初の応答の前、エージェントを使えない設定など）。メインに頼む形に切り替える
    await saveConsult($, null)
    await $.ui.close({ id: CONSULT_PANE })
    await explainInMain($, question)
    return
  }
  consultKinds.set(agentId, true)
  await saveConsult($, { question, agentId, isHandingOff: false })
}

// 相談用のエージェントに、メインへの申し送りを頼んで待つ。option は選んだ選択肢。答えが来なければ空文字
const summarize = ($: EngineInterface, agentId: string, option: string | null): Promise<string> =>
  new Promise(resolve => {
    const giveUp = (): void => {
      if (summaryWaiter === null || summaryWaiter.agentId !== agentId) return
      summaryWaiter = null
      resolve('')
    }
    const timer = $.clock.after(SUMMARY_TIMEOUT_MS, giveUp)
    summaryWaiter = {
      agentId,
      resolve: reply => {
        timer.cancel()
        resolve(summaryOf(reply))
      },
    }
    void $.session.send({ to: { agentId }, text: summaryPrompt(option) }).then(
      sent => (sent.isDelivered ? undefined : giveUp()),
      () => giveUp(),
    )
  })

// 利用者が、相談の中で 1 度でも問いを送ったか。会話を読めなければ、送ったものとして扱う。
// WHY 送っていなければ要約しない: 最初の説明を読んで選んだだけなら、保留の pane で選ぶのと同じ。
// 数え方は目安で、スキルの読み込みも利用者の側の発言に数えられる（v2.1.296 の実機で、何も聞いていない相談でも要約を頼んだ）。
// そのときは要約が「なし」で返り、何も付かないので、害は無い
const hasTalked = async ($: EngineInterface, agentId: string): Promise<boolean> => {
  const messages = await $.session.messages({ agentId }).catch(() => null)
  return messages === null || 'deny' in messages || askedCount(messages) > 1
}

const isAgentAnswering = async ($: EngineInterface, agentId: string): Promise<boolean> =>
  isAnswering((await $.agent.list().catch(() => [])).find(one => one.id === agentId)?.status)

// エージェントが答え終わるまで待つ。IDLE_WAIT_MS たっても終わらなければ false
const untilIdle = async ($: EngineInterface, agentId: string): Promise<boolean> => {
  for (let waited = 0; waited < IDLE_WAIT_MS; waited += IDLE_POLL_MS) {
    if (!(await isAgentAnswering($, agentId))) return true
    await $.clock.sleep(IDLE_POLL_MS)
  }
  return !(await isAgentAnswering($, agentId))
}

// 相談の結論を、メインの Claude へ送る。option は選んだ選択肢で、null は選択肢に無い結論。
// WHY 要約を付ける: 選んだ選択肢だけでは、相談の中で付いた条件（「案 A で、ただし上限は 10 件」）がメインに届かない。
// WHY 問答をそのまま付けない: 長い相談を全部渡すと、メインの文脈を増やさないという目的と逆になる
// isCommitted は、答えをもうメインから取り上げてある（会話の中のボタンで答えた）。断らずに、最後まで送る。
// WHY 答えている最中は要約を頼まない: 頼んだ文が、いまの答えの中で読まれて、要約がその答えに混ざる
const handOffConsult = async ($: EngineInterface, option: string | null, isCommitted = false): Promise<void> => {
  const current = await currentConsult($)
  if (current === null || current.agentId === null || current.isHandingOff) return
  const agentId = current.agentId
  // WHY 取り上げた答えは待つ: 会話の中のボタンは、エージェントが続きの文を書いている最中にも押せる
  const isIdle = isCommitted ? await untilIdle($, agentId) : !(await isAgentAnswering($, agentId))
  if (!isIdle && !isCommitted) {
    $.ui.toast('相談用のエージェントが答えている最中です。答えが出てから押してください')
    return
  }
  await update($, consult, () => ({ ...current, isHandingOff: true }))
  const summary = isIdle && (await hasTalked($, agentId)) ? await summarize($, agentId, option) : ''
  if (option === null && summary === '') {
    await update($, consult, latest => (latest === null ? latest : { ...latest, isHandingOff: false }))
    $.ui.toast('相談から結論を読み取れませんでした。選択肢を押すか、保留の一覧の「ほかの答えを書く」で書いてください', { timeoutMs: 8_000 })
    return
  }
  if (option === null) {
    void $.prompt.submit({ text: handoffMessage(current.question, null, summary), asUser: true }).then(
      result => (result.drop === undefined ? undefined : $.ui.toast('相談の結論を送れませんでした', { timeoutMs: 8_000 })),
      () => $.ui.toast('相談の結論を送れませんでした', { timeoutMs: 8_000 }),
    )
  } else {
    await answerQuestion($, current.question, option, summary)
  }
  await saveConsult($, null)
  await $.ui.close({ id: CONSULT_PANE })
  $.ui.toast('結論をメインへ送りました。相談の会話を開いていたら、画面の下の並びで main に戻れます', { timeoutMs: 8_000 })
}

// セッションの開始時。開き直したセッションでは、$.store に残っている保留の一覧を戻す
const restoreQuestions =async ($: EngineInterface): Promise<void> => {
  const list = await loadQuestions($)
  await update($, questions, () => list)
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.tool.register({ name: QUESTION_TOOL_NAME, description: QUESTION_TOOL_DESCRIPTION, inputSchema: QUESTION_TOOL_SCHEMA, isDeferred: false })
    await $.tool.register({ name: LIST_TOOL_NAME, description: LIST_TOOL_DESCRIPTION, inputSchema: LIST_TOOL_SCHEMA, isDeferred: false })
    await $.tool.register({ name: RESOLVE_TOOL_NAME, description: RESOLVE_TOOL_DESCRIPTION, inputSchema: RESOLVE_TOOL_SCHEMA, isDeferred: false })
    // WHY catch: 一覧を戻せなくても、セッションは始める
    await restoreQuestions($).catch(() => undefined)
    return next(e)
  })

  // Claude が、仮に決めて先へ進んだことを一覧に残す
  on('tool.call', { tool: QUESTION_TOOL }, async ($, e) => {
    const parsed = parseQuestion(e)
    if (typeof parsed === 'string') return { deny: `add_question failed: ${parsed}` }
    const last = lastIdOf(await $.store.get(`${QUESTION_LAST_PREFIX}${await $.session.id()}`))
    const added = addQuestion(await loadQuestions($), parsed, QUESTIONS_MAX, last)
    await saveQuestions($, added.list)
    if (added.id > last) await saveForSession($, QUESTION_LAST_PREFIX, added.id)
    // 足した保留を、利用者の操作を待たずに pane に出す（2026-10-10 に利用者が決めた）。フォーカスは移さない。
    // 幅が足りないと置かれない。帯の pending の件数は増えるので、toast は出さない
    await $.ui.open({ id: QUESTIONS_PANE, title: QUESTIONS_PANE_TITLE, closeOnEscape: true })
    return { result: `Recorded as Q${added.id}. ${added.list.length} open.` }
  }).catch(($, e, next) => (next.called ? next(e) : { deny: `add_question failed: ${next.error.message}` }))

  // Claude が、保留の中身を読み直す
  on('tool.call', { tool: LIST_TOOL }, async $ => ({ result: JSON.stringify(await loadQuestions($)) })).catch(($, e, next) =>
    next.called ? next(e) : { deny: `list_questions failed: ${next.error.message}` },
  )

  // Claude が、決まった保留を一覧から外す
  on('tool.call', { tool: RESOLVE_TOOL }, async ($, e) => {
    const id = parseQuestionId(e)
    if (typeof id === 'string') return { deny: `resolve_question failed: ${id}` }
    const rest = await dropQuestion($, id)
    if (rest === null) return { deny: `resolve_question failed: there is no Q${id} on the list` }
    return { result: `Q${id} removed. ${rest.length} open.` }
  }).catch(($, e, next) => (next.called ? next(e) : { deny: `resolve_question failed: ${next.error.message}` }))

  // セッションの始め（開き直し、/clear、compact の後も含む）に、一覧とツールの使い方、答えの届き方を Claude に伝える。
  // WHY サブエージェントには渡さない: 保留を残して答えを受け取るのは、利用者と話しているメインのセッション
  on('classic.SessionStart', async (_$, e, next) => {
    const result = await next(e)
    if (e.agent_id !== undefined) return result
    return { ...result, additionalContext: [...(result.additionalContext ?? []), SESSION_CONTEXT] }
  }).catch((_$, e, next) => next(e))

  // 相談用のエージェントには、読むツールと MCP のツールだけを通す。
  // WHY tool.check と両方で止める: tool.check が、どの権限モードでも通るかを確かめていない。Write や Edit は、ここだけで止まる
  on('tool.call', async ($, e, next) => {
    if (!(await isConsultAgent($, e.agentId))) return next(e)
    if (!isAllowedInConsult(e.tool, e.tool === 'Bash' ? e.command : '')) return { deny: CONSULT_READ_ONLY }
    return next(e)
  }).catch((_$, e, next) => next(e))

  // 相談用のエージェントの Bash は、読むコマンドの一覧に入っていて、エンジンも確認なしで通すものだけを通す。
  // WHY エンジンの判定も見る: 設定の許可ルールに無いコマンドは、利用者が確認なしで通すと決めていない。
  // MCP のツールとスキルは、エンジンのふだんの判定のまま通す
  on('tool.check', async ($, e, next) => {
    if (!(await isConsultAgent($, e.agentId))) return next(e)
    if (!isAllowedInConsult(e.tool, commandOf(e.input))) return { decision: 'deny', reason: CONSULT_READ_ONLY }
    if (e.tool !== 'Bash') return next(e)
    const core = await next(e)
    return core.decision === 'allow' ? core : { decision: 'deny', reason: CONSULT_READ_ONLY }
  }).catch((_$, e, next) => next(e))

  // 相談を始めるボタンと、結論を送るボタンは、部品の onPress でなく、ここの hook で受ける。
  // WHY hook で受ける: onPress の中から立てたエージェントのツールの呼び出しには、この Mod の tool.call と tool.check の hook が呼ばれず、
  // 読むだけの絞り込みが効かなかった（touch が通った）。hook の中から立てると呼ばれる（v2.1.296、2026-10-11 に実機で確認）。
  // WHY 結論を送る処理は待たない: 要約を 30 秒まで待つ。hook は 10 秒で打ち切られる
  on('ui.press', { plugin: 'questions', component: 'Pane' }, async ($, e, next) => {
    if (e.requestId === QUESTIONS_PANE) {
      const id = /^explain-(\d+)$/.exec(e.element)?.[1]
      const question = id === undefined ? undefined : (await loadQuestions($)).find(one => one.id === Number(id))
      if (question !== undefined) await startConsult($, question)
    }
    if (e.requestId === CONSULT_PANE) {
      const at = /^decide-(\d+)$/.exec(e.element)?.[1]
      const option = at === undefined ? undefined : (await currentConsult($))?.question.options[Number(at)]
      if (option !== undefined) void handOffConsult($, option).catch(() => undefined)
      if (e.element === 'conclude') void handOffConsult($, null).catch(() => undefined)
    }
    return next(e)
  }).catch((_$, e, next) => next(e))

  // 相談の会話の中に、ほかの Mod（rich の show など）が描いたボタンが押された。押された時刻を覚える。
  // そのボタンの動きは止めない。直後にその Mod がメインへ送る文を、下の prompt.submit の hook で受け取る。
  // WHY ほかの Mod の中身を見ない: ボタンの key の付け方は、その Mod の内側の事情。送られる文だけを読む
  // WHY 会話の記録から見分ける: ボタンは、ツールの呼び出しの行に描かれ、その行の ID（requestId）が呼び出しの ID になる。
  // 相談用のエージェントの会話に、その ID の呼び出しがあれば、相談の中のボタンだ。
  // WHY NOT tool.call で ID を覚える: rich は設定でこの Mod より前（外側）にあり、show の呼び出しに自分で答える。
  // この Mod の tool.call の hook には、その呼び出しが届かなかった（v2.1.296、2026-10-11 に実機で確認）
  on('ui.press', async ($, e, next) => {
    if (e.plugin === 'questions') return next(e)
    const current = await currentConsult($)
    if (current === null || current.agentId === null) return next(e)
    const messages = await $.session.messages({ agentId: current.agentId }).catch(() => null)
    if (messages !== null && !('deny' in messages) && hasToolUse(messages, e.requestId)) consultPressedAt = await $.clock.now()
    return next(e)
  }).catch((_$, e, next) => next(e))

  // メインへ届く文のうち、相談に関わる 2 種類を、メインには渡さずに受け取る。
  // 1. 相談用のエージェントが終わった知らせ。渡すと、メインが 1 ターン動く。
  //    WHY task-id を見る: バックグラウンドのシェルや、Claude が立てたエージェントの知らせも、同じ出どころで届く。
  // 2. 相談の会話の中の質問に、利用者がボタンで答えた文。保留の選択肢を選んでいれば、相談の pane で選んだのと同じに扱う。
  //    WHY 受け取る: そのまま渡すと、相談の要約が付かず、相談も閉じない。
  //    WHY 選択肢を読み取れなければ渡す: 保留と関係の無い質問への答えかもしれない。止めると、答えが消える。
  // 捨てると、会話の行に「Prompt dropped by a hook: 理由」が 1 行出る（v2.1.296 で確認）
  on('prompt.submit', async ($, e, next) => {
    if (e.origin.kind === 'task-notification') {
      return (await isConsultAgent($, notifiedAgentOf(e.text) ?? undefined)) ? { drop: CONSULT_NOTICE_DROPPED } : next(e)
    }
    if (e.origin.kind !== 'plugin' || consultPressedAt === null) return next(e)
    const isFresh = (await $.clock.now()) - consultPressedAt <= CONSULT_PRESS_WINDOW_MS
    consultPressedAt = null
    const current = isFresh ? await currentConsult($) : null
    const option = current === null || current.isHandingOff ? null : pickedOption(e.text, current.question.options)
    if (option === null) return next(e)
    void handOffConsult($, option, true).catch(() => undefined)
    return { drop: CONSULT_ANSWER_TAKEN }
  }).catch((_$, e, next) => next(e))

  // 相談用のエージェントに頼んだ要約が返ってきたら、待っている側へ渡す
  on('turn.complete', async (_$, e, next) => {
    if (summaryWaiter !== null && summaryWaiter.agentId === e.agentId) {
      const waiter = summaryWaiter
      summaryWaiter = null
      waiter.resolve(e.answer)
    }
    return next(e)
  }).catch((_$, e, next) => next(e))

  // プロンプトの下の行に、pending の札を足す。下の層（エンジンの元の表示、status-band の帯、ほかの Mod の札）の右に並べる。
  // 保留は、件数も出す。決めることが残っていると、この行だけで分かるようにする。
  // WHY 下の層を包むだけにする: この行は、複数の Mod が重ねて描く。ほかの Mod の中身を知らずに、自分の札を足せる。
  // WHY Box に width を付けない: 下の層の木を width の付いた Box に入れると、エンジンが重ねた hook の全部を捨てて、
  // 元の表示だけを描く（v2.1.296 で確認）。下へ渡す幅（viewport）も書き換えられない。
  // 幅を指定しなくても、下の層の箱は、足した札の分だけ縮む
  on('ui.render', { component: 'PromptHint' }, async ($, e, next) => {
    const inner = await next(e)
    if (e.surface !== 'terminal') return inner
    const waiting = await read($, questions)
    if (waiting.length === 0) return inner
    const { Box, Button, Text } = $.ui.resolve(e)
    // WHY 直接開く: スラッシュコマンドを経由すると、ターンの途中に押したときに、ターンが終わるまで開かない
    const open = () => {
      void $.ui.open({ id: QUESTIONS_PANE, title: QUESTIONS_PANE_TITLE, focus: true, closeOnEscape: true })
    }
    return (
      <Box flexDirection="row" columnGap={1}>
        {inner}
        {/* WHY hotkey を付けない: plain の Button は hotkey があると「p: pending」と描かれ、札の見た目が崩れる */}
        <Button key="pending" plain onPress={open}>
          <Text backgroundColor={SURFACE} color={SOFT}>{` pending ${waiting.length} `}</Text>
        </Button>
      </Box>
    )
  }).catch((_$, e, next) => next(e))

  // 保留の一覧。どの問いも、説明と選択肢を開いたまま並べる。答えは、選択肢のボタンを押して選ぶ。
  // WHY キーで選ぶ行を持たない: 答える操作は、問いごとの選択肢を押すこと。行を選んでから押す 2 段にしない
  // （2026-10-10 に利用者が決めた。「ボタンぽちぽちで答えていく」「畳まないで全部ひらきっぱなし」）。
  // WHY 閉じるを上に置く: 一覧が pane より長いと、下に置いたボタンは流れて見えなくなる
  on('ui.render', { component: 'Pane', requestId: QUESTIONS_PANE }, async ($, e, next) => {
    if (e.surface !== 'terminal') return next(e)
    const { Box, Button, Text } = $.ui.resolve(e)
    const list = await read($, questions)
    const width = e.props.bodyColumns
    // 選択肢に無い答えを書く。書き出しを入力欄に入れて、pane を閉じる。
    // WHY 閉じる: pane がキーボードを持ったままだと、打った字が pane のキー（q で閉じる）として働く
    const write = async (one: OpenQuestion): Promise<void> => {
      await $.prompt.fill({ text: answerOpening(one) })
      await $.ui.close({ id: QUESTIONS_PANE })
    }

    return (
      <Box flexDirection="column" gap={1} width={width}>
        <Box flexDirection="row" columnGap={2}>
          <Button
            key="close"
            role="dismiss"
            hotkey="q"
            onPress={() => {
              void $.ui.close({ id: QUESTIONS_PANE })
            }}
          >
            閉じる
          </Button>
          {list.length > 0 && <Text dimColor>選択肢を押すと、その答えがClaudeに届く</Text>}
        </Box>
        {list.length === 0 ? (
          <Text dimColor>仮に決めて先へ進んだことは、いまありません</Text>
        ) : (
          list.map(one => (
            <Box key={`row-${one.id}`} flexDirection="column" width={width}>
              <Box flexDirection="row" justifyContent="space-between" width={width}>
                <Box flexDirection="row" columnGap={1}>
                  <Text bold color={ACCENT}>
                    {labelOf(one)}
                  </Text>
                  <Box width={Math.max(1, width - labelOf(one).length - 1 - 8)}>
                    <Text bold>{one.question}</Text>
                  </Box>
                </Box>
                <Box flexDirection="row" columnGap={1}>
                  {one.answer !== null && <Text dimColor>送信済</Text>}
                  <Button key={`drop-${one.id}`} plain onPress={() => void dropQuestion($, one.id).catch(() => undefined)}>
                    <Text dimColor>×</Text>
                  </Button>
                </Box>
              </Box>
              {one.detail !== '' && <Text dimColor>{one.detail}</Text>}
              {one.options.map((option, index) => (
                <Box flexDirection="row" columnGap={1}>
                  <Button key={`option-${one.id}-${index}`} plain onPress={() => void answerQuestion($, one, option).catch(() => undefined)}>
                    <Text color={option === one.answer ? GREEN : undefined} bold={option === one.answer}>
                      {`${option === one.answer ? '●' : '○'} ${option}`}
                    </Text>
                  </Button>
                  {option === one.assumed && <Text dimColor>いまの仮置き</Text>}
                </Box>
              ))}
              {/* 押したときの動きは、ui.press の hook にある */}
              <Button key={`explain-${one.id}`} plain onPress={() => undefined}>
                <Text dimColor>？ 詳しく聞く</Text>
              </Button>
              <Button key={`write-${one.id}`} plain onPress={() => void write(one).catch(() => undefined)}>
                <Text dimColor>✎ ほかの答えを書く</Text>
              </Button>
            </Box>
          ))
        )}
      </Box>
    )
  })

  // 保留 1 件についての相談。会話そのものは、エンジンのエージェントの会話の画面でする。
  // この pane には、会話の横に出しておく背景（保留の問いと説明）、会話の開き方、結論を送るボタンを置く。
  // 結論を送るボタンの動きは、上の ui.press の hook にある
  on('ui.render', { component: 'Pane', requestId: CONSULT_PANE }, async ($, e, next) => {
    if (e.surface !== 'terminal') return next(e)
    const { Box, Button, Text } = $.ui.resolve(e)
    const current = await currentConsult($)
    const width = e.props.bodyColumns
    const close = (
      <Button
        key="close"
        role="dismiss"
        hotkey="q"
        onPress={() => {
          void $.ui.close({ id: CONSULT_PANE })
        }}
      >
        閉じる
      </Button>
    )
    if (current === null) {
      return (
        <Box flexDirection="column" gap={1} width={width}>
          {close}
          <Text dimColor>相談は開いていません。保留の一覧で「詳しく聞く」を押すと始まります</Text>
        </Box>
      )
    }
    const question = current.question
    // 利用者がいま開いている会話が、この相談のものか
    const isViewing = current.agentId !== null && e.props.view.agentId === current.agentId
    // 終わったエージェントは画面の下の並びから消えるので、一覧を開くコマンドを実行する。
    // WHY 自動で実行しない: スラッシュコマンドは、メインの会話に 1 行残る。押したときだけにする
    const openTasks = () => {
      $.command.run({ command: 'tasks' }).catch(() => {
        void $.prompt.fill({ text: '/tasks' })
        $.ui.toast('/tasks をすぐには実行できませんでした。入力欄に入れたので、Enterで送ってください', { timeoutMs: 8_000 })
      })
    }

    return (
      <Box flexDirection="column" gap={1} width={width}>
        <Box flexDirection="column" width={width}>
          <Box flexDirection="row" columnGap={2}>
            {close}
            <Text dimColor>読むだけの相談。メインの会話には残らない</Text>
          </Box>
          <Box flexDirection="row" columnGap={1} width={width}>
            <Text bold color={ACCENT}>
              {labelOf(question)}
            </Text>
            <Box width={Math.max(1, width - labelOf(question).length - 1)}>
              <Text bold wrap="wrap">
                {question.question}
              </Text>
            </Box>
          </Box>
          {question.detail !== '' && (
            <Text dimColor wrap="wrap">
              {question.detail}
            </Text>
          )}
        </Box>
        {current.agentId === null ? (
          <Text dimColor>相談を始めています…</Text>
        ) : isViewing ? (
          <Text dimColor wrap="wrap">
            いま、この相談の会話を開いています。入力欄に書くと、相談用のエージェントに届きます。メインへは、画面の下の並びで main を選ぶと戻れます
          </Text>
        ) : (
          <Box flexDirection="column" width={width}>
            <Text wrap="wrap">{`会話は「${consultDescription(question)}」の画面でします。画面の下の並びで、下矢印で選んでEnterを押すと開きます`}</Text>
            <Button key="tasks" plain onPress={openTasks}>
              <Text dimColor>▸ 並びに出ていなければ、一覧を開く（/tasks）</Text>
            </Button>
          </Box>
        )}
        {current.isHandingOff && <Text dimColor>相談の要約を作って、メインへ送ります…</Text>}
        <Box flexDirection="column" width={width}>
          <Text dimColor>決めたら、押してメインへ送る</Text>
          {question.options.map((option, index) => (
            <Box key={`decide-row-${index}`} flexDirection="row" columnGap={1}>
              <Button key={`decide-${index}`} plain onPress={() => undefined}>
                <Text>{`○ ${option}`}</Text>
              </Button>
              {option === question.assumed && <Text dimColor>いまの仮置き</Text>}
            </Box>
          ))}
          {/* 選択肢に無い結論。相談の要約だけを送る */}
          <Button key="conclude" plain onPress={() => undefined}>
            <Text dimColor>✎ 選択肢に無い結論を送る</Text>
          </Button>
        </Box>
      </Box>
    )
  })
}
