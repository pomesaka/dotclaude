import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'
import type { ReportBody, SessionRecord } from '../types'
import { SESSION_CONTEXT } from './context'
import { actionOf, ageOf, EMPTY_RECORD, ITEMS_MAX, parseReport, recordOf, REMIND_AFTER_TURNS, SECTIONS_MAX, stampOf } from './report'

const TOOL_NAME = 'update_devrep'
const TOOL = 'mcp__devrep__update_devrep'
const PANE = 'devrep'
// WHY /devrep: スキルと同じ名前のコマンドは呼べない（/rich で起きた）。devrep という名前のスキルは無い（2026-10-10 に確認）
const COMMAND = 'devrep'

const ACCENT = '#6cb6ff'
// プロンプトの下の行に足す札の色。status-band の帯の、目立たせない札と同じ
const SURFACE = '#30363d'
const SOFT = '#c9d1d9'

const DESCRIPTION = `Rewrite the report of where the work stands, shown in the user's devrep pane: what this session is doing now, what comes next, and any other sections the user needs.
The user reads it when they come back to a session they left alone, instead of scrolling the transcript.
Call it when the user asks you to keep such a report (that turns devrep on for the session), and while devrep is on, at milestones only: when the task you are working on changes, when a piece of work lands (a commit the user asked for, a merged PR, a finished review round), and when something you need from the user appears or is settled. Not after every tool call or small step.
Each call replaces the whole report. Write for someone who has forgotten the conversation: one short sentence per item, naming things in full, in the language you answer the user in. No tables.`

const ITEMS_SCHEMA = { type: 'array', items: { type: 'string' }, minItems: 1, maxItems: ITEMS_MAX }

const INPUT_SCHEMA = {
  type: 'object',
  properties: {
    now: { type: 'string', description: 'What this session is doing right now, in one or two sentences. When nothing is in progress, say so and why.' },
    next: {
      ...ITEMS_SCHEMA,
      description: `What comes next, in the order you will take it. 1 to ${ITEMS_MAX} items. When nothing is planned, say what you are waiting for.`,
    },
    sections: {
      type: 'array',
      maxItems: SECTIONS_MAX,
      description: `Other sections, drawn in this order under a title you choose: what you are waiting on the user for, what was decided, what the user should know, what landed recently. Only the ones this session needs; at most ${SECTIONS_MAX}.`,
      items: {
        type: 'object',
        properties: {
          title: { type: 'string', description: 'A short heading.' },
          items: { ...ITEMS_SCHEMA, description: `1 to ${ITEMS_MAX} items, one short sentence each.` },
        },
        required: ['title', 'items'],
      },
    },
  },
  required: ['now', 'next'],
}

// ON にした時点で Claude へ送る文。説明も一緒に渡す。
// WHY 説明を付ける: OFF で始まったセッションには、セッションの始めの説明を渡していない
const START_PROMPT = `${SESSION_CONTEXT}\n\n利用者が devrep を ON にしました。いまの作業の状況を、mcp__devrep__update_devrep で書いてください。`
// ツールが最初に呼ばれて ON になったときに、結果へ足す文
const TURNED_ON = ` devrep is now on for this session: rewrite the report at milestones (the task changes, a piece of work lands, something you need from the user appears or is settled), not after every step. After ${REMIND_AFTER_TURNS} turns without a rewrite, the plugin sends a reminder.`
// 書いてから REMIND_AFTER_TURNS ターンたったときに、Claude へ送る文
const REMIND_PROMPT = `devrep: 最後に作業の状況を書いてから${REMIND_AFTER_TURNS}ターンたちました。古くなっていたら mcp__devrep__update_devrep で書き直してください。変わっていなければ、何もせず「変更なし」とだけ答えてください。`
// 利用者が pane の「更新を頼む」を押したときに、Claude へ送る文
const REFRESH_PROMPT = '作業の状況を、いまの内容に書き直して'

// $.store には、セッションごとに記録を持つ。キーは session:<セッションID>。
// WHY セッションごと: $.store は Mod ごとに 1 つで、どのセッションからも同じものが見える。分けないと、別のセッションの状況が出る
const SESSION_PREFIX = 'session:'
// $.store に覚えておくセッションの数。最後に書いた順で、古いセッションから落とす
const SESSIONS_MAX = 30
// 「3時間前に更新」を書き直す間隔（ミリ秒）。分の単位で出すので、1 分
const CLOCK_INTERVAL_MS = 60_000

const record = atom({ plugin: 'devrep', key: 'record' } as const, EMPTY_RECORD)
const clock = atom({ plugin: 'devrep', key: 'clock' } as const, 0)

// このターンのうちに、状況が書き直された。
// WHY モジュール変数: ターンの終わりまでの一時状態。書いたターンを「書いた後に終わったターン」に数えないために持つ
let isWrittenThisTurn = false
// 次に終わるターンは、Mod が書き直しを促して始めたもの。
// WHY 持つ: 促したターンを数えると、促すたびに次の催促が 1 ターン早まり、利用者が何もしていないのに数が増える
let isRemindedTurn = false
// 時刻を進めているタイマー。null は、まだ始めていない
let ticker: ReturnType<EngineInterface['clock']['every']> | null = null

const load = async ($: EngineInterface): Promise<SessionRecord> => recordOf(await $.store.get(`${SESSION_PREFIX}${await $.session.id()}`))

// セッションの記録を、$.store と画面の両方に書く。
// WHY 消してから書く: $.store.keys() の並びを「最後に書いた順」に保ち、古いセッションから落とせるようにする
const save = async ($: EngineInterface, written: SessionRecord): Promise<void> => {
  const key = `${SESSION_PREFIX}${await $.session.id()}`
  await $.store.delete(key)
  await $.store.set(key, written)
  const keys = (await $.store.keys()).filter(stored => stored.startsWith(SESSION_PREFIX))
  for (const stale of keys.slice(0, Math.max(0, keys.length - SESSIONS_MAX))) await $.store.delete(stale)
  await update($, record, () => written)
}

// Claude が書いた中身を、いまの時刻で記録する。書けば ON になる。戻り値は、この呼び出しで ON になったか。
// WHY 書けば ON: 「状況をノートにしておいて」と頼まれた Claude がツールを呼ぶのが、いちばん自然な始め方
const write = async ($: EngineInterface, body: ReportBody): Promise<boolean> => {
  const now = await $.clock.now()
  const current = await read($, record)
  isWrittenThisTurn = true
  await save($, { isOn: true, report: { ...body, updatedAt: now, turns: 0 }, unchecked: 0 })
  await update($, clock, () => now)
  return !current.isOn
}

// セッションの開始時。開き直したセッションでは、$.store に残っている記録を戻す。ON で状況が残っていれば pane に出す。
// WHY 開始時に出す: 利用者が状況を読みたいのは、離れていたセッションに戻ったとき。
// WHY 待たない: モデルが開く pane は、幅が足りないと置かれるまで待たされる。セッションの開始を止めない
const restore = async ($: EngineInterface): Promise<void> => {
  const stored = await load($)
  const now = await $.clock.now()
  await update($, record, () => stored)
  await update($, clock, () => now)
  if (stored.isOn && stored.report !== null) void $.ui.open({ id: PANE, title: PANE }).catch(() => undefined)
}

// Mod から Claude へ文を送る。送れなかったら failed を呼ぶ。
// WHY 待たない: 送信は、始まったターンが終わるまで返らない
const submit = ($: EngineInterface, text: string, asUser: boolean, failed: (reason: string) => void): void => {
  void $.prompt.submit(asUser ? { text, asUser: true } : { text }).then(
    result => (result.drop === undefined ? undefined : failed(result.drop)),
    (error: unknown) => failed(error instanceof Error ? error.message : String(error)),
  )
}

// メインのターンが終わるたびに、書いた後のターンを数える。ON で、REMIND_AFTER_TURNS ターンたっていたら、書き直しを促す。
// WHY 数える: 時刻だけでは、状況が作業より遅れているかが分からない。書いた直後に離れたセッションは、何日たっても新しい。
// WHY prompt.submit で促す: 利用者が離れているあいだに書き直させたい。次のプロンプトに文を足す形だと、利用者が戻って打つまで直らない
// （2026-10-10 に利用者と決めた）。
// WHY 答えて終わったターンだけ促す: 中断やエラーの直後に Mod がターンを始めると、利用者が止めた作業の上に割り込む
const settle = async ($: EngineInterface, isAnswered: boolean): Promise<void> => {
  const isSkipped = isWrittenThisTurn || isRemindedTurn
  isWrittenThisTurn = false
  isRemindedTurn = false
  const current = await read($, record)
  if (isSkipped || (current.report === null && !current.isOn)) return
  const unchecked = current.unchecked + 1
  const isDue = current.isOn && isAnswered && unchecked >= REMIND_AFTER_TURNS
  await save($, {
    ...current,
    report: current.report === null ? null : { ...current.report, turns: current.report.turns + 1 },
    unchecked: isDue ? 0 : unchecked,
  })
  if (!isDue) return
  isRemindedTurn = true
  submit($, REMIND_PROMPT, false, () => {
    isRemindedTurn = false
  })
}

// ON にする。戻り値は、この呼び出しで ON になったか。最初の状況を Claude に書かせるのは、呼んだ側がする
const turnOn = async ($: EngineInterface): Promise<boolean> => {
  const current = await read($, record)
  if (current.isOn) return false
  await save($, { ...current, isOn: true, unchecked: 0 })
  return true
}

// pane のボタンで ON にしたとき。最初の状況を、その場で Claude に書かせる
const startFromPane = async ($: EngineInterface): Promise<void> => {
  if (!(await turnOn($))) return
  submit($, START_PROMPT, false, reason =>
    $.ui.toast(`devrepを始められませんでした（${reason}）。「作業の状況を書いて」と頼んでください`, { timeoutMs: 8_000 }),
  )
}

// OFF にする。書いてある状況は残す。催促は止まる
const turnOff = async ($: EngineInterface): Promise<void> => {
  const current = await read($, record)
  if (current.isOn) await save($, { ...current, isOn: false, unchecked: 0 })
}

export const register: Register = on => {
  // WHY next(e) より先に登録する: 先に登録すれば、最初のターンからツールが見える。
  // WHY OFF でもツールを登録する: 「状況を書いておいて」と頼まれた Claude が、その場で呼べるようにする
  on('session.start', async ($, e, next) => {
    await $.tool.register({ name: TOOL_NAME, description: DESCRIPTION, inputSchema: INPUT_SCHEMA, isDeferred: false })
    await $.command.register({ name: COMMAND, description: 'Open the devrep pane. "/devrep on" starts keeping the report of where the work stands, "/devrep off" stops' })
    // WHY catch: 記録を戻せなくても、セッションは始める
    await restore($).catch(() => undefined)
    ticker?.cancel()
    ticker = $.clock.every(CLOCK_INTERVAL_MS, () => {
      void $.clock
        .now()
        .then(now => update($, clock, () => now))
        .catch(() => undefined)
    })
    return next(e)
  })

  // ON のセッションの始め（開き直し、compact の後も含む）に、書き方と書き直す時点を Claude に伝える。
  // WHY OFF のセッションには渡さない: 質問に 1 回答えて終わるようなセッションで、状況を書かせない。
  // WHY $.store から読む: この hook が session.start より先に来ても、ON かどうかが分かるようにする。
  // WHY サブエージェントには渡さない: 状況を書くのは、利用者と話しているメインのセッションだけ
  on('classic.SessionStart', async ($, e, next) => {
    const result = await next(e)
    if (e.agent_id !== undefined || !(await load($)).isOn) return result
    return { ...result, additionalContext: [...(result.additionalContext ?? []), SESSION_CONTEXT] }
  }).catch((_$, e, next) => next(e))

  on('tool.call', { tool: TOOL }, async ($, e) => {
    const parsed = parseReport(e)
    if (typeof parsed === 'string') return { deny: `update_devrep failed: ${parsed}` }
    const isTurnedOn = await write($, parsed)
    // 書き直した状況を、利用者の操作を待たずに pane に出す。フォーカスは移さない（入力欄で打ち続けられるように）
    const opened = await $.ui.open({ id: PANE, title: PANE })
    // WHY 置けないことがある: モデルが開く pane は、ターミナルが 144 桁（一度開いた後は 110 桁）より狭いと待たされる
    const placed = opened.isPlaced ? 'Noted.' : `Noted. The pane is not drawn yet (${opened.reason}); the user opens it with /${COMMAND}.`
    return { result: `${placed}${isTurnedOn ? TURNED_ON : ''}` }
  }).catch(($, e, next) => (next.called ? next(e) : { deny: `update_devrep failed: ${next.error.message}` }))

  // WHY サブエージェントのターンは数えない: 利用者から見た作業の進みは、メインのターンで決まる
  on('turn.complete', async ($, e, next) => {
    const result = await next(e)
    if (e.agentId === undefined) await settle($, e.reason === 'answer').catch(() => undefined)
    return result
  }).catch((_$, e, next) => next(e))

  on('command.run', { command: COMMAND }, async ($, e) => {
    const action = actionOf(e.args)
    if (action === null) return { text: `Usage: /${COMMAND} [on|off]` }
    if (action === 'off') {
      await turnOff($)
      return { text: 'devrep is off for this session. The report stays in the pane.' }
    }
    const isTurnedOn = action === 'on' && (await turnOn($))
    // 開いた時点の時刻で「何分前に更新」を出す
    const now = await $.clock.now()
    await update($, clock, () => now)
    const opened = await $.ui.open({ id: PANE, title: PANE, focus: true })
    const state = action === 'on' ? 'devrep is on for this session. ' : ''
    const text = `${state}${opened.isPlaced ? 'devrep pane opened.' : `devrep pane is waiting: ${opened.reason}`}`
    // WHY context で渡す: command.run の hook の中から prompt.submit は呼べない
    // （called from a command.run hook, it would wait on the turn this hook is holding。claude plugin test で確認、v2.1.295）。
    // context は Claude だけが読む文で、ターンは始めない。最初の状況は、利用者の次のプロンプトのターンで書かれる
    return isTurnedOn ? { text, context: [START_PROMPT] } : { text }
  })

  // ON のあいだ、プロンプトの下の行に devrep の札を足す。下の層（エンジンの元の表示、status-band の帯、ほかの Mod の札）の右に並べる。
  // WHY 札を持つ: pane を開く道が /devrep だけだと、ターンの途中に打ったときに、ターンが終わるまで開かない。
  // 札から直接開けば、Claude が作業している最中でもすぐ出る。
  // WHY ON のときだけ: devrep を使わないセッションで、札を増やさない。
  // WHY Box に width を付けない: 下の層の木を width の付いた Box に入れると、エンジンが重ねた hook の全部を捨てる（v2.1.296 で確認）
  on('ui.render', { component: 'PromptHint' }, async ($, e, next) => {
    const inner = await next(e)
    if (e.surface !== 'terminal' || !(await read($, record)).isOn) return inner
    const { Box, Button, Text } = $.ui.resolve(e)
    // 開いた時点の時刻で「何分前に更新」を出す
    const open = () => {
      void $.clock
        .now()
        .then(now => update($, clock, () => now))
        .then(() => $.ui.open({ id: PANE, title: PANE, focus: true }))
        .catch(() => undefined)
    }
    return (
      <Box flexDirection="row" columnGap={1}>
        {inner}
        {/* WHY hotkey を付けない: plain の Button は hotkey があると「d: devrep」と描かれ、札の見た目が崩れる */}
        <Button key="devrep" plain onPress={open}>
          <Text backgroundColor={SURFACE} color={SOFT}>
            {' devrep '}
          </Text>
        </Button>
      </Box>
    )
  }).catch((_$, e, next) => next(e))

  // 結果の文（"Noted."）はモデル向け。利用者には pane が見えているので、会話の行には書き直したことを 1 行だけ出す
  on('ui.render', { component: 'ToolUse', props: { tool: TOOL } }, async ($, e, next) => {
    if (e.surface !== 'terminal' || e.props.isRunning || e.props.isErrored || e.props.isInterrupted) return next(e)
    const { Text } = $.ui.resolve(e)
    return <Text dimColor>devrep: 作業の状況を書き直しました（/{COMMAND} で開けます）</Text>
  })

  on('ui.render', { component: 'ToolResult', props: { tool: TOOL } }, async ($, e, next) => {
    if (e.surface !== 'terminal' || e.props.isErrored) return next(e)
    const { Box } = $.ui.resolve(e)
    return <Box />
  })

  // WHY 表を使わない: pane の幅はターミナルの半分ほどで、Markdown の表は pane の幅に合わせて描かれない。
  // 節ごとに項目を縦に並べ、自分で幅を渡して折り返す
  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e, next) => {
    if (e.surface !== 'terminal') return next(e)
    const { Box, Button, Text } = $.ui.resolve(e)
    const current = await read($, record)
    const now = await read($, clock)
    const width = e.props.bodyColumns
    const report = current.report

    // 印の後ろに、折り返す文を置く。2 行目からも、文の頭をそろえる
    const row = (key: string, mark: string, body: string) => (
      <Box key={key} flexDirection="row" width={width}>
        <Box width={3} flexShrink={0}>
          <Text dimColor>{mark}</Text>
        </Box>
        <Box width={Math.max(10, width - 3)}>
          <Text wrap="wrap">{body}</Text>
        </Box>
      </Box>
    )
    // at は、節の位置。見出しが同じ節が無いことは入力で確かめているが、key は位置で付ける
    const section = (at: string, title: string, list: string[], markOf: (index: number) => string) => (
      <Box key={`section-${at}`} flexDirection="column" width={width}>
        <Text bold color={ACCENT}>
          {title}
        </Text>
        {list.map((one, index) => row(`item-${at}-${index}`, markOf(index), one))}
      </Box>
    )

    return (
      <Box flexDirection="column" gap={1} width={width}>
        {/* WHY ボタンを上に置く: 状況が pane より長いと、下に置いたボタンは流れて見えなくなる */}
        <Box flexDirection="column" width={width}>
          <Box flexDirection="row" columnGap={2}>
            <Button
              key="close"
              role="dismiss"
              hotkey="q"
              onPress={() => {
                void $.ui.close({ id: PANE })
              }}
            >
              閉じる
            </Button>
            {current.isOn && (
              <Button
                key="refresh"
                hotkey="u"
                onPress={() => submit($, REFRESH_PROMPT, true, () => $.ui.toast('更新を頼めませんでした。もう一度押してください', { timeoutMs: 8_000 }))}
              >
                更新を頼む
              </Button>
            )}
            <Button
              key="toggle"
              hotkey="o"
              onPress={() => {
                void (current.isOn ? turnOff($) : startFromPane($)).catch(() => undefined)
              }}
            >
              {current.isOn ? 'OFFにする' : 'ONにする'}
            </Button>
          </Box>
          {/* +N は、書いた後に終わったターンの数。ON か OFF かは、上のボタンの文で分かるので書かない（2026-10-10 に利用者が決めた） */}
          {report !== null && (
            <Text dimColor>
              {ageOf(report.updatedAt, now)}
              {report.turns > 0 ? ` +${report.turns}` : ''}
            </Text>
          )}
        </Box>
        {report === null ? (
          <Text dimColor>{current.isOn ? 'まだ書かれていません。Claudeが書くのを待っています' : 'まだ書かれていません。ONにすると、Claudeが作業の状況を書きます'}</Text>
        ) : (
          <Box flexDirection="column" gap={1} width={width}>
            <Box flexDirection="column" width={width}>
              {/* WHY 日時も出す: 「3時間前」だけでは、いつの時点の状況かを、ほかの記録（コミット、PR）と突き合わせられない
                  （2026-10-10 に利用者が決めた） */}
              <Text bold color={ACCENT}>
                いま（{stampOf(new Date(report.updatedAt))}）
              </Text>
              <Text wrap="wrap">{report.now}</Text>
            </Box>
            {section('next', '次にすること', report.next, index => `${index + 1}.`)}
            {report.sections.map((one, at) => section(String(at), one.title, one.items, () => '-'))}
          </Box>
        )}
      </Box>
    )
  })
}
