import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'
import type { Candidate, RetroEvent, SessionRecord, Trigger } from '../types'
import { candidatesForJudge, candidatesText, foldEvents, formatEvents, parseEvents, RETRO_DIR, storedCandidatesOf, tally, writtenEvents } from './candidates'
import { judgePrompt, parseJudgeReply, writerPrompt } from './prompt'
import { actionOf, FOUND_MAX, TOOL_CALLS_FOR_BUSY, isCompletion, isCorrection, isStop, recordOf, reportBodyOf, reporterOf, shouldJudge, stampOf, withReport } from './record'

// WHY /retro: スキルと同じ名前のコマンドは呼べない（/rich で起きた）。re という名前のスキルがある
const COMMAND = 'retro'
// 書き手のエージェントの説明。エージェントの一覧から、この Mod が立てたものを見分けるのにも使う
const WRITER_DESCRIPTION = 'retro: 振り返りの発見を文書に書く'
// 書き手の報告や終わった知らせを止めたときの理由。会話の行に「Prompt dropped by a hook: …」として出る
const WRITER_NOTICE_DROPPED = 'retro の書き手の報告（/retro log で読める）'

// $.store には、セッションごとに記録を持つ。キーは session:<セッションID>
const SESSION_PREFIX = 'session:'
const SESSIONS_MAX = 30
// 前の版が控えを持っていたキー。初回に ~/.claude/retro/ へ移して消す
const LEGACY_CANDIDATES_KEY = 'candidates'

const isJudging = atom({ plugin: 'retro', key: 'isJudging' } as const, false)

// 直前に答えて終わったメインのターンの答え。null は、渡せる答えが無い。
// WHY モジュール変数: 分岐が読む会話には、最後の答えが入っていない。次のターンが始まるまで持つだけの一時状態
let lastAnswer: string | null = null
// このターンの中で、コミットや PR の作成が走ったか。ターンの終わりに読んで戻す
let isCompletedInTurn = false
// このターンでメインが道具を呼んだ回数。ターンの終わりに読んで戻す
let toolCallsInTurn = 0
// この Mod が立てた書き手のエージェントの ID。
// WHY モジュール変数でよい: 消えても、エージェントの一覧の説明から判定し直せる
const writers = new Set<string>()

const load = async ($: EngineInterface): Promise<SessionRecord> => recordOf(await $.store.get(`${SESSION_PREFIX}${await $.session.id()}`))

// WHY 消してから書く: $.store.keys() の並びを「最後に書いた順」に保ち、古いセッションから落とせるようにする
const save = async ($: EngineInterface, written: SessionRecord): Promise<void> => {
  const key = `${SESSION_PREFIX}${await $.session.id()}`
  await $.store.delete(key)
  await $.store.set(key, written)
  const keys = (await $.store.keys()).filter(stored => stored.startsWith(SESSION_PREFIX))
  for (const stale of keys.slice(0, Math.max(0, keys.length - SESSIONS_MAX))) await $.store.delete(stale)
}

const change = async ($: EngineInterface, fn: (current: SessionRecord) => SessionRecord): Promise<SessionRecord> => {
  const written = fn(await load($))
  await save($, written)
  return written
}

// 控えの出来事を書くディレクトリ。HOME が取れなければ null で、控えを使わない
const retroDir = async ($: EngineInterface): Promise<string | null> => {
  const home = await $.env.get('HOME')
  return home === undefined ? null : `${home}/${RETRO_DIR}`
}

const jsonlFiles = async ($: EngineInterface, dir: string): Promise<string[]> =>
  (await $.fs.exists(dir)) ? (await $.fs.list(dir)).filter(entry => entry.kind === 'file' && entry.name.endsWith('.jsonl')).map(entry => `${dir}/${entry.name}`) : []

// このセッションのファイルに出来事を足す。
// WHY セッションごとのファイル: $.fs に追記が無く、読んで書き直すしかない。1 つのファイルを書くのを 1 つのセッションに限れば、
//   ほかのセッションの行を上書きで消さない。同じセッションの中は、順に並べて重ならないようにする
let queue: Promise<void> = Promise.resolve()
const appendEvents = ($: EngineInterface, events: readonly RetroEvent[]): Promise<void> => {
  queue = queue
    .then(async () => {
      const dir = await retroDir($)
      if (dir === null || events.length === 0) return
      const path = `${dir}/${await $.session.id()}.jsonl`
      const before = (await $.fs.exists(path)) ? await $.fs.read(path) : ''
      await $.fs.write(path, `${before}${formatEvents(events)}`)
    })
    .catch(() => undefined)
  return queue
}

// 前の版の $.store の控えを、ファイルがまだ1つも無いときに1度だけ移す
const importLegacy = async ($: EngineInterface, dir: string): Promise<void> => {
  const stored = await $.store.get(LEGACY_CANDIDATES_KEY)
  if (stored === undefined) return
  if ((await jsonlFiles($, dir)).length === 0) {
    const at = await $.clock.now()
    const moved = storedCandidatesOf(stored)
    await appendEvents(
      $,
      moved.map(candidate => ({ type: 'imported', candidate, at })),
    )
    // WHY 書けたのを見てから消す: appendEvents は書けなくても黙るので、先に消すと回数を失う
    if (moved.length > 0 && (await jsonlFiles($, dir)).length === 0) return
  }
  await $.store.delete(LEGACY_CANDIDATES_KEY)
}

// 全セッションのファイルを束ねて、控えの一覧を作る。null は、HOME が取れず控えを使えない
const loadCandidates = async ($: EngineInterface): Promise<Candidate[] | null> => {
  const dir = await retroDir($)
  if (dir === null) return null
  await importLegacy($, dir)
  await queue
  const texts = await Promise.all((await jsonlFiles($, dir)).map(path => $.fs.read(path).catch(() => '')))
  return foldEvents(texts.flatMap(parseEvents))
}

// ほかのセッションの控えと重ならない id。WHY 連番をやめる: 番号を数えるには全体を読んで書き戻すことになる
const newIdFor = (list: readonly Candidate[]) => (): string => {
  for (;;) {
    const id = `c${Math.random().toString(36).slice(2, 7)}`
    if (!list.some(one => one.id === id)) return id
  }
}

// そのエージェントが、この Mod の立てた書き手か
const isWriter = async ($: EngineInterface, agentId: string | undefined): Promise<boolean> => {
  if (agentId === undefined) return false
  if (writers.has(agentId)) return true
  const found = (await $.agent.list().catch(() => [])).find(agent => agent.id === agentId)
  if (found?.description !== WRITER_DESCRIPTION) return false
  writers.add(agentId)
  return true
}

// 振り返る。会話を分岐させて発見を聞き、控えに数える。文書に上げる発見があれば、書き手のエージェントを立てて文書に書かせる。
// WHY 控えを挟む: 1 回きりの発見をそのまま文書に書くと、文書が速く増えて大事な文が埋もれる。仕組みで防げる発見は、文書に書かずに作る候補として残す（2026-11-19 に pomesaka と決めた）
// WHY 2 段に分ける: 文書を書くには、ファイルを読んで探すツールの往復が要る。会話を引き継いだエージェントだと、
//   往復のたびに会話の全部を送り直す。発見を聞くのは分岐の 1 回で済ませ、書き手には発見だけを渡して会話を持たせない（2026-11-13 に利用者と決めた）。
// WHY 発見が無ければ立てない: 何も書かないエージェントに、文書を読む分を使わせない。
// WHY 聞けたら数を戻す: 発見が無かった区間を、次のきっかけで読み直さない。聞けなかったときは戻さず、次のきっかけで聞き直す
const judge = async ($: EngineInterface, trigger: Trigger, toolCalls: number | null = null): Promise<void> => {
  const isAsked = trigger === 'manual'
  if (await read($, isJudging)) {
    if (isAsked) $.ui.toast('retro: いま振り返っています')
    return
  }
  await update($, isJudging, () => true)
  try {
    const before = await load($)
    const list = (await loadCandidates($)) ?? []
    const reply = await $.model.fork({ prompt: judgePrompt(before.found, candidatesForJudge(list), lastAnswer, toolCalls) })
    const findings = reply.isAnswered ? parseJudgeReply(reply.text) : reply.reason
    if (typeof findings === 'string') {
      if (isAsked) $.ui.toast(`retro: 振り返れませんでした（${findings}）`, { timeoutMs: 8_000 })
      return
    }
    await change($, current => ({ ...current, turns: 0, corrections: 0, stops: 0 }))
    if (findings.length === 0) {
      if (isAsked) $.ui.toast('retro: 残す発見はありませんでした')
      return
    }
    await change($, current => ({ ...current, found: [...findings.map(one => one.title), ...current.found].slice(0, FOUND_MAX) }))
    // WHY 数え直す: 分岐に聞いている間に、ほかのセッションが同じ控えを数えていることがある
    const current = await loadCandidates($)
    if (current === null) {
      if (isAsked) $.ui.toast('retro: HOME が取れないので、控えに数えられませんでした', { timeoutMs: 8_000 })
      return
    }
    const at = await $.clock.now()
    const { events, promoted } = tally(current, findings, at, newIdFor(current))
    await appendEvents($, events)
    const mechanisms = findings.filter(one => one.kind === 'mechanism').length
    const requests = findings.filter(one => one.kind === 'request').length
    const notes = [mechanisms === 0 ? '' : `仕組みの候補 ${mechanisms} 件`, requests === 0 ? '' : `スキルやエージェントへの要望 ${requests} 件`].filter(one => one !== '')
    const kept = `retro: ${findings.length} 件を控えに数えました${notes.length === 0 ? '' : `（${notes.join('、')}。/retro candidates で読めます）`}`
    if (promoted.length === 0) {
      $.ui.toast(kept)
      return
    }
    // WHY model を渡さない: メインと同じモデルで書かせる。書き先の選び方と文の規則の守り方を、メインより粗くしない（2026-11-13 に利用者が決めた）
    const started = await $.agent
      .spawn({ prompt: writerPrompt(promoted, await $.session.cwd()), description: WRITER_DESCRIPTION, subagentType: 'general-purpose' })
      .catch(() => null)
    if (started === null || started.deny !== undefined) {
      $.ui.toast('retro: 書き手のエージェントを立てられませんでした', { timeoutMs: 8_000 })
      return
    }
    if (started.agentId !== undefined) writers.add(started.agentId)
    await appendEvents($, writtenEvents(promoted.map(one => one.id), await $.clock.now()))
    $.ui.toast(`${kept}。くり返し出た ${promoted.length} 件を文書に書いています`)
  } finally {
    await update($, isJudging, () => false)
  }
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: COMMAND,
      description: 'Look back on this session now and count what is worth keeping; findings seen twice go into the docs. "/retro on|off" switch the automatic look-backs, "/retro log" shows what was written, "/retro candidates" lists the counted findings, "/retro drop <id>" removes one',
    })
    return next(e)
  })

  // WHY 次のターンで答えを捨てる: 答えた後に話が進むと、その答えは分岐が読む会話の末尾と食い違う
  on('turn.start', async (_$, e, next) => {
    lastAnswer = null
    isCompletedInTurn = false
    toolCallsInTurn = 0
    return next(e)
  }).catch((_$, e, next) => next(e))

  // 利用者が直した発言を数える。書き手の報告と終わった知らせは、メインに届けず、報告の本文を記録に残す。
  // WHY 止める: 届くとメインが 1 ターン動き、書いた内容を読み直して報告する。結果は /retro log で読める。
  // WHY 出どころの種類で絞らない: 報告は、終わった知らせ（task-notification）とは別の形で届いた（2026-11-17 に実機で確認）。
  //   その出どころの種類は確かめていないので、書き手の ID が付いているかだけで見る
  on('prompt.submit', async ($, e, next) => {
    const reporter = e.origin.kind === 'composer' ? null : reporterOf(e.text)
    if (reporter !== null && (await isWriter($, reporter))) {
      const body = reportBodyOf(e.text)
      if (body !== null) {
        const at = await $.clock.now()
        await change($, current => ({ ...current, log: withReport(current.log, { at, agentId: reporter, text: body }) }))
      }
      return { drop: WRITER_NOTICE_DROPPED }
    }
    // WHY composer だけ: 入力欄から送った文。next-step の札（plugin の asUser）は、モデルが書いた文なので数えない
    if (e.origin.kind === 'composer' && isCorrection(e.text)) await change($, current => ({ ...current, corrections: current.corrections + 1 }))
    return next(e)
  }).catch((_$, e, next) => next(e))

  // WHY メインの Bash だけ見る: サブエージェントのコミットは、メインの作業の区切りとは限らない
  // WHY メインだけ数える: サブエージェントの手数は、そのエージェントの任された作業の量で、メインの手順の癖ではない
  on('tool.call', async (_$, e, next) => {
    if (e.agentId === undefined) {
      toolCallsInTurn += 1
      if (e.tool === 'Bash' && isCompletion(e.command)) isCompletedInTurn = true
    }
    return next(e)
  }).catch((_$, e, next) => next(e))

  on('turn.complete', async ($, e, next) => {
    const result = await next(e)
    if (e.agentId !== undefined) {
      if (await isWriter($, e.agentId)) {
        const at = await $.clock.now()
        const writerId = e.agentId
        await change($, current => ({ ...current, log: withReport(current.log, { at, agentId: writerId, text: e.answer.trim() }) }))
        $.ui.toast('retro: 振り返りを書きました。/retro log で読めます', { timeoutMs: 8_000 })
      }
      return result
    }
    const isAnswered = e.reason === 'answer' && e.answer.trim() !== ''
    lastAnswer = isAnswered ? e.answer : null
    const isCompleted = isCompletedInTurn
    const toolCalls = toolCallsInTurn
    isCompletedInTurn = false
    toolCallsInTurn = 0
    const current = await change($, now => ({ ...now, turns: now.turns + 1, stops: now.stops + (isStop(e.reason) ? 1 : 0) }))
    // WHY 答えて終わったターンだけ: 中断やエラーの直後は、利用者が止めた作業の途中にいる
    if (!isAnswered) return result
    const isBusy = toolCalls >= TOOL_CALLS_FOR_BUSY
    const trigger: Trigger | null =
      isCompleted && shouldJudge(current, 'completion')
        ? 'completion'
        : isBusy && shouldJudge(current, 'busy')
          ? 'busy'
          : shouldJudge(current, 'turn')
            ? 'turn'
            : null
    // WHY 手数はどのきっかけでも渡す: コミットで振り返るターンも、手数が多ければ決まった手を探させる
    if (trigger !== null) void judge($, trigger, isBusy ? toolCalls : null).catch(() => undefined)
    return result
  }).catch((_$, e, next) => next(e))

  // compact の直前に振り返る。WHY 待ってから compact に進む: compact の後は、会話が要約に置き換わって細部を読めない。
  // 書き手には発見だけを渡すので、書くのは compact の後でよい
  on('session.compact', async ($, e, next) => {
    if (e.agentId === undefined && shouldJudge(await load($), 'compact')) await judge($, 'compact').catch(() => undefined)
    return next(e)
  }).catch((_$, e, next) => next(e))

  on('command.run', { command: COMMAND }, async ($, e) => {
    const action = actionOf(e.args)
    if (action === null) return { text: `Usage: /${COMMAND} [on|off|log|candidates|drop <id>]` }
    switch (action.name) {
      case 'on':
        await change($, current => ({ ...current, isOn: true }))
        return { text: 'retro: automatic look-backs are on.' }
      case 'off':
        await change($, current => ({ ...current, isOn: false }))
        return { text: 'retro: automatic look-backs are off. /retro still looks back now.' }
      case 'log': {
        const { log } = await load($)
        if (log.length === 0) return { text: 'retro: nothing has been written in this session yet.' }
        return { text: log.map(one => `${stampOf(new Date(one.at))}\n${one.text}`).join('\n\n') }
      }
      case 'candidates': {
        const list = await loadCandidates($)
        if (list === null) return { text: 'retro: HOME is not set, so there are no counted findings.' }
        if (list.length === 0) return { text: 'retro: no findings have been counted yet.' }
        return { text: candidatesText(list) }
      }
      case 'drop': {
        const { id } = action
        const list = await loadCandidates($)
        if (list === null || !list.some(one => one.id === id)) return { text: `retro: no counted finding has the id ${id}. /retro candidates lists them.` }
        await appendEvents($, [{ type: 'dropped', id, at: await $.clock.now() }])
        return { text: `retro: dropped ${id}.` }
      }
      case 'run':
        void judge($, 'manual').catch(() => undefined)
        return { text: 'retro: looking back on this session.' }
    }
  })
}
