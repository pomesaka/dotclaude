import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'
import type { SessionRecord } from '../types'
import { forkPrompt, parseForkReply } from './prompt'
import { actionOf, ageOf, EMPTY_RECORD, recordOf, REFRESH_AFTER_TURNS, stampOf } from './report'

const PANE = 'devrep'
// WHY /devrep: スキルと同じ名前のコマンドは呼べない（/rich で起きた）。devrep という名前のスキルは無い（2026-10-10 に確認）
const COMMAND = 'devrep'

const ACCENT = '#6cb6ff'
// プロンプトの下の行に足す札の色。status-band の帯の、目立たせない札と同じ
const SURFACE = '#30363d'
const SOFT = '#c9d1d9'
// 利用者がすることの色。札の件数と、pane の見出しに使う
const TODO = '#e3b341'

// $.store には、セッションごとに記録を持つ。キーは session:<セッションID>。
// WHY セッションごと: $.store は Mod ごとに 1 つで、どのセッションからも同じものが見える。分けないと、別のセッションの状況が出る
const SESSION_PREFIX = 'session:'
// $.store に覚えておくセッションの数。最後に書いた順で、古いセッションから落とす
const SESSIONS_MAX = 30
// 「3時間前に更新」を書き直す間隔（ミリ秒）。分の単位で出すので、1 分
const CLOCK_INTERVAL_MS = 60_000

const record = atom({ plugin: 'devrep', key: 'record' } as const, EMPTY_RECORD)
const clock = atom({ plugin: 'devrep', key: 'clock' } as const, 0)
const isWriting = atom({ plugin: 'devrep', key: 'isWriting' } as const, false)

// 直前に答えて終わったメインのターンの答え。null は、渡せる答えが無い（次のターンが始まった、中断やエラーで終わった）。
// WHY モジュール変数: 分岐が読む会話には、最後の答えが入っていない。turn.complete で受けて、次のターンが始まるまで持つだけの一時状態
let lastAnswer: string | null = null
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

// 会話を分岐させて、作業の状況を書かせる。isAsked は、利用者が頼んだか（書けなかったことを知らせる）。
// WHY $.model.fork: 会話の全部を、メインの要求のキャッシュから読める。返事は会話に残らず、メインのターンも使わない。
//   状況は会話から書けるので、ツールは要らない。
// WHY NOT メインに書かせる: 書き直しの催促が 1 ターンを使い、変わっていなくても「変更なし」と答えさせることになる。
//   書き方の説明もメインの文脈に積まれる（2026-10-29 に利用者と決めた）。
// WHY NOT $.agent.spawn でサブエージェント: ツールを使わない仕事に、タスクの一覧に出るエージェントを立てない
const refresh = async ($: EngineInterface, isAsked: boolean): Promise<void> => {
  if (await read($, isWriting)) return
  await update($, isWriting, () => true)
  try {
    const before = (await read($, record)).report
    // WHY 時刻とターンの数を渡さない: 書く中身ではない
    const previous = before === null ? null : { now: before.now, next: before.next, todo: before.todo, sections: before.sections }
    const reply = await $.model.fork({ prompt: forkPrompt(previous, lastAnswer) })
    const body = reply.isAnswered ? parseForkReply(reply.text) : reply.reason
    if (typeof body === 'string') {
      if (isAsked) $.ui.toast(`作業の状況を書けませんでした（${body}）。もう一度押してください`, { timeoutMs: 8_000 })
      return
    }
    const now = await $.clock.now()
    // 待っているあいだに自動更新が切り替えられていたら、そちらを残す
    const current = await read($, record)
    await save($, { ...current, report: { ...body, updatedAt: now, turns: 0 }, unchecked: 0 })
    await update($, clock, () => now)
  } finally {
    await update($, isWriting, () => false)
  }
}

// セッションの開始時。開き直したセッションでは、$.store に残っている記録を戻す。自動更新が ON で状況が残っていれば pane に出す。
// WHY 開始時に出す: 利用者が状況を読みたいのは、離れていたセッションに戻ったとき。
// WHY 待たない: モデルが開く pane は、幅が足りないと置かれるまで待たされる。セッションの開始を止めない
const restore = async ($: EngineInterface): Promise<void> => {
  const stored = await load($)
  const now = await $.clock.now()
  await update($, record, () => stored)
  await update($, clock, () => now)
  if (stored.isOn && stored.report !== null) void $.ui.open({ id: PANE, title: PANE }).catch(() => undefined)
}

// メインのターンが終わるたびに、書いた後のターンを数える。自動更新が ON で、REFRESH_AFTER_TURNS ターンたっていたら書き直す。
// WHY 数える: 時刻だけでは、状況が作業より遅れているかが分からない。書いた直後に離れたセッションは、何日たっても新しい。
// WHY 答えて終わったターンだけ書き直す: 中断やエラーの直後は、利用者が止めた作業の途中の状況になる。
// WHY 書けなかったら数を戻さない: 次に答えて終わったターンで、もう一度書く
const settle = async ($: EngineInterface, isAnswered: boolean): Promise<void> => {
  const current = await read($, record)
  if (current.report === null && !current.isOn) return
  const unchecked = current.unchecked + 1
  await save($, {
    ...current,
    report: current.report === null ? null : { ...current.report, turns: current.report.turns + 1 },
    unchecked,
  })
  if (current.isOn && isAnswered && unchecked >= REFRESH_AFTER_TURNS) void refresh($, false).catch(() => undefined)
}

// 自動更新を ON にして、その場で書かせる。WHY 書かせる: ON にした利用者は、いまの状況を見たい
const turnOn = async ($: EngineInterface): Promise<void> => {
  const current = await read($, record)
  if (current.isOn) return
  await save($, { ...current, isOn: true, unchecked: 0 })
  void refresh($, true).catch(() => undefined)
}

// 自動更新を OFF にする。書いてある状況は残し、「更新する」でも書ける
const turnOff = async ($: EngineInterface): Promise<void> => {
  const current = await read($, record)
  if (current.isOn) await save($, { ...current, isOn: false, unchecked: 0 })
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({ name: COMMAND, description: 'Open the devrep pane. "/devrep on" turns on automatic updates of the report of where the work stands, "/devrep off" turns them off' })
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

  // WHY 次のターンで答えを捨てる: 答えた後に話が進むと、その答えは分岐が読む会話の末尾と食い違う
  on('turn.start', async (_$, e, next) => {
    lastAnswer = null
    return next(e)
  }).catch((_$, e, next) => next(e))

  // WHY サブエージェントのターンは数えない: 利用者から見た作業の進みは、メインのターンで決まる
  on('turn.complete', async ($, e, next) => {
    const result = await next(e)
    if (e.agentId !== undefined) return result
    const isAnswered = e.reason === 'answer' && e.answer.trim() !== ''
    lastAnswer = isAnswered ? e.answer : null
    await settle($, isAnswered).catch(() => undefined)
    return result
  }).catch((_$, e, next) => next(e))

  on('command.run', { command: COMMAND }, async ($, e) => {
    const action = actionOf(e.args)
    if (action === null) return { text: `Usage: /${COMMAND} [on|off]` }
    if (action === 'off') {
      await turnOff($)
      return { text: 'devrep: automatic updates are off. Update the report from the pane.' }
    }
    if (action === 'on') await turnOn($)
    // 開いた時点の時刻で「何分前に更新」を出す
    const now = await $.clock.now()
    await update($, clock, () => now)
    const opened = await $.ui.open({ id: PANE, title: PANE, focus: true })
    const state = action === 'on' ? 'devrep: automatic updates are on. ' : ''
    return { text: `${state}${opened.isPlaced ? 'devrep pane opened.' : `devrep pane is waiting: ${opened.reason}`}` }
  })

  // 状況があるか自動更新が ON のあいだ、プロンプトの下の行に devrep の札を足す。下の層（エンジンの元の表示、status-band の帯、ほかの Mod の札）の右に並べる。
  // WHY 札を持つ: pane を開く道が /devrep だけだと、ターンの途中に打ったときに、ターンが終わるまで開かない。
  // 札から直接開けば、Claude が作業している最中でもすぐ出る。
  // WHY 使っていないセッションには出さない: devrep を使わないセッションで、札を増やさない。
  // WHY Box に width を付けない: 下の層の木を width の付いた Box に入れると、エンジンが重ねた hook の全部を捨てる（v2.1.296 で確認）
  // WHY 利用者がすることの件数を札に出す: pane を閉じていても、自分の番が来ていると気づけるようにする
  on('ui.render', { component: 'PromptHint' }, async ($, e, next) => {
    const inner = await next(e)
    const current = await read($, record)
    if (e.surface !== 'terminal' || (!current.isOn && current.report === null)) return inner
    const todos = current.report?.todo.length ?? 0
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
          {todos > 0 && (
            <Text backgroundColor={SURFACE} color={TODO} bold>
              {`${todos} `}
            </Text>
          )}
        </Button>
      </Box>
    )
  }).catch((_$, e, next) => next(e))

  // WHY 表を使わない: pane の幅はターミナルの半分ほどで、Markdown の表は pane の幅に合わせて描かれない。
  // 節ごとに項目を縦に並べ、自分で幅を渡して折り返す
  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e, next) => {
    if (e.surface !== 'terminal') return next(e)
    const { Box, Button, Text } = $.ui.resolve(e)
    const current = await read($, record)
    const now = await read($, clock)
    const writing = await read($, isWriting)
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
    const section = (at: string, title: string, list: string[], markOf: (index: number) => string, color = ACCENT) => (
      <Box key={`section-${at}`} flexDirection="column" width={width}>
        <Text bold color={color}>
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
            <Button
              key="refresh"
              hotkey="u"
              onPress={() => {
                void refresh($, true).catch(() => undefined)
              }}
            >
              更新する
            </Button>
            <Button
              key="toggle"
              hotkey="o"
              onPress={() => {
                void (current.isOn ? turnOff($) : turnOn($)).catch(() => undefined)
              }}
            >
              {current.isOn ? '自動更新をOFFにする' : '自動更新をONにする'}
            </Button>
          </Box>
          {/* +N は、書いた後に終わったターンの数。自動更新が ON か OFF かは、上のボタンの文で分かるので書かない（2026-10-10 に利用者が決めた） */}
          {writing ? (
            <Text dimColor>書いています…</Text>
          ) : (
            report !== null && (
              <Text dimColor>
                {ageOf(report.updatedAt, now)}
                {report.turns > 0 ? ` +${report.turns}` : ''}
              </Text>
            )
          )}
        </Box>
        {report === null ? (
          !writing && <Text dimColor>まだ書かれていません</Text>
        ) : (
          <Box flexDirection="column" gap={1} width={width}>
            {/* WHY いちばん上に置く: 戻ってきた利用者が最初に知りたいのは、自分が何をすれば作業が進むか */}
            {report.todo.length > 0 && section('todo', 'あなたがすること', report.todo, () => '□', TODO)}
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
