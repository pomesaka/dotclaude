import { expect, test, type TestBody } from 'claude-code/testing'

type On = Parameters<TestBody>[1]
type Engine = Parameters<TestBody>[0]

const START = { cwd: '/repo', surface: 'terminal', isInteractive: true } as const
const STARTED = { hook_event_name: 'SessionStart', session_id: 's1', transcript_path: '/t.jsonl', cwd: '/repo' } as const
const END = { turnId: 't1', answer: '直しました。', durationMs: 0, isAborted: false, reason: 'answer' } as const
const TOOL = 'mcp__devrep__update_devrep'
const REPORT = {
  now: '帯の幅の計算を直している',
  next: ['テストを足す', 'READMEに反映する'],
  sections: [
    { title: '待っていること', items: ['幅のしきい値を決める'] },
    { title: '決まったこと', items: ['表は使わない'] },
  ],
}
const REMINDER =
  'devrep: 最後に作業の状況を書いてから5ターンたちました。古くなっていたら mcp__devrep__update_devrep で書き直してください。変わっていなければ、何もせず「変更なし」とだけ答えてください。'

const pane = {
  plugin: 'devrep',
  surface: 'terminal' as const,
  component: 'Pane' as const,
  requestId: 'devrep',
  props: { title: 'devrep', isFocused: true, bodyColumns: 60, placement: 'dock' as const, scroll: { offset: 0, bodyRows: 40 }, view: {} },
  viewport: { columns: 177, rows: 60 },
}

const command = (args: string) => ({ command: 'devrep', args, origin: { kind: 'composer' as const }, presentation: { isFullscreen: false, columns: 177 } })

type Given = {
  // セッションの開始時に $.store に残っている値
  stored?: { [key: string]: unknown }
  // false は、pane が置かれない（ターミナルが狭い）
  isPlaced?: boolean
  // false は、送信が拒まれる
  isSent?: boolean
}

const world = (on: On, given: Given = {}) => {
  // 開いた pane。focus は、フォーカスを移したか
  const opened: { id: string; focus: boolean }[] = []
  const closed: string[] = []
  // Claude へ送った文。asUser は、利用者が打った文として送ったか
  const submitted: { text: string; asUser: boolean }[] = []
  const toasts: string[] = []
  // いま待っている周期を終わらせる関数。null は、待っている周期が無い
  let release: (() => void) | null = null
  const seen = {
    store: new Map(Object.entries(given.stored ?? {})),
    opened,
    closed,
    submitted,
    toasts,
    // いまの時刻（エポックからのミリ秒）。テストが書き換えて、時間を進める
    time: 1_000_000_000,
    // 時間を 1 周期ぶん進める。タイマーの関数が 1 回走る
    tick: () => {
      const go = release
      release = null
      go?.()
    },
  }

  on('session.id', () => ({ value: 's1' }))
  on('session.start', () => ({ cwd: '/repo' }))
  on('tool.register', (_$, e) => ({ value: { tool: e.name } }))
  on('command.register', (_$, e) => ({ value: { command: e.name } }))
  on('classic.SessionStart', () => ({ additionalContext: ['OTHER'] }))
  on('turn.complete', () => ({ text: '' }))
  on('clock.now', () => ({ value: seen.time }))
  on(
    'clock.every',
    () =>
      new Promise<{ value: undefined }>(resolve => {
        release = () => resolve({ value: undefined })
      }),
  )
  on('store.get', (_$, e) => ({ value: seen.store.get(e.key) }))
  on('store.set', (_$, e) => {
    seen.store.set(e.key, e.value)
    return { value: undefined }
  })
  on('store.delete', (_$, e) => {
    seen.store.delete(e.key)
    return { value: undefined }
  })
  on('store.keys', () => ({ value: [...seen.store.keys()] }))
  on('ui.open', (_$, e) => {
    opened.push({ id: e.id, focus: e.focus === true })
    return { value: given.isPlaced === false ? { isPlaced: false as const, reason: 'too-narrow' as const } : { isPlaced: true as const } }
  })
  on('ui.close', (_$, e) => {
    closed.push(e.id)
    return { value: undefined }
  })
  on('ui.toast', (_$, e) => {
    toasts.push(e.text)
    return { value: undefined }
  })
  on('prompt.submit', (_$, e) => {
    submitted.push({ text: e.text, asUser: e.origin.kind === 'plugin' && e.origin.asUser === true })
    return given.isSent === false ? { drop: 'refused' } : { text: e.text }
  })
  return seen
}

// メインのターンを count 回終わらせる
const turns = async ($: Engine, count: number, from = 0): Promise<void> => {
  for (let index = 0; index < count; index++) await $.turn.complete({ ...END, turnId: `t${from + index}` })
}

test('OFF で始まり、まだ書かれていないと出す。pane は自動では開かない', async ($, on) => {
  const seen = world(on)
  await $.session.start(START)

  const ui = await $.ui.mount(pane)
  expect(await ui.find({ type: 'Text', text: /^まだ書かれていません。ONにすると、Claudeが作業の状況を書きます$/ })).toBeDefined()
  // 書かれていないあいだは、いつ書いたかの行を出さない
  expect(await ui.find({ type: 'Text', text: /更新$/ })).toBeUndefined()
  expect(await ui.find({ key: 'refresh' })).toBeUndefined()
  expect(seen.opened).toEqual([])
  await ui.unmount()
})

test('update_devrep を呼ぶと ON になり、状況が pane に出て、$.store に残る', async ($, on) => {
  const seen = world(on)
  await $.session.start(START)

  const called = await $.tool.call({ tool: TOOL, ...REPORT })
  expect(called).toEqual({
    result:
      'Noted. devrep is now on for this session: rewrite the report at milestones (the task changes, a piece of work lands, something you need from the user appears or is settled), not after every step. After 5 turns without a rewrite, the plugin sends a reminder.',
  })
  // フォーカスは移さない
  expect(seen.opened).toEqual([{ id: 'devrep', focus: false }])
  expect(seen.store.get('session:s1')).toEqual({ isOn: true, report: { ...REPORT, updatedAt: 1_000_000_000, turns: 0 }, unchecked: 0 })

  const ui = await $.ui.mount(pane)
  expect(await ui.find({ type: 'Text', text: /^帯の幅の計算を直している$/ })).toBeDefined()
  // 日時はマシンのタイムゾーンで変わるので、形だけを見る。値は stampOf のテストで固定している
  expect(await ui.find({ type: 'Text', text: /^いま（\d{4}-\d{2}-\d{2} \d{2}:\d{2}）$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^次にすること$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^READMEに反映する$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^待っていること$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^幅のしきい値を決める$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^決まったこと$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^たったいま更新$/ })).toBeDefined()
  await ui.unmount()

  // 2 回目からは、ON になったことを繰り返さない
  expect(await $.tool.call({ tool: TOOL, ...REPORT })).toEqual({ result: 'Noted.' })
})

test('読めない入力は拒み、前の状況を残す', async ($, on) => {
  const seen = world(on)
  await $.session.start(START)
  await $.tool.call({ tool: TOOL, ...REPORT })

  const called = await $.tool.call({ tool: TOOL, now: 'a' })
  expect(called).toEqual({ deny: 'update_devrep failed: next must be a list of at least one string' })
  expect(seen.store.get('session:s1')).toEqual({ isOn: true, report: { ...REPORT, updatedAt: 1_000_000_000, turns: 0 }, unchecked: 0 })
})

test('pane が置かれなければ、開き方を結果で伝える', async ($, on) => {
  world(on, { isPlaced: false, stored: { 'session:s1': { isOn: true, report: null, unchecked: 0 } } })
  await $.session.start(START)

  const called = await $.tool.call({ tool: TOOL, ...REPORT })
  expect(called).toEqual({ result: 'Noted. The pane is not drawn yet (too-narrow); the user opens it with /devrep.' })
})

test('書いたターンは数えず、その後に終わったターンを数える。サブエージェントのターンは数えない', async ($, on) => {
  const seen = world(on)
  await $.session.start(START)
  await $.tool.call({ tool: TOOL, ...REPORT })

  await $.turn.complete(END)
  const ui = await $.ui.mount(pane)
  expect(await ui.find({ type: 'Text', text: /^たったいま更新$/ })).toBeDefined()

  await $.turn.complete({ ...END, turnId: 't2' })
  await $.turn.complete({ ...END, turnId: 't3', agentId: 'a1' })
  await $.turn.complete({ ...END, turnId: 't4' })
  expect(await ui.find({ type: 'Text', text: /^たったいま更新 \+2$/ })).toBeDefined()
  expect(seen.submitted).toEqual([])
  await ui.unmount()
})

test('書いてから 5 ターンたつと、書き直しを促す。促したターンは数えず、次は 5 ターン後', async ($, on) => {
  const seen = world(on)
  await $.session.start(START)
  await $.tool.call({ tool: TOOL, ...REPORT })
  await $.turn.complete(END)

  await turns($, 4)
  expect(seen.submitted).toEqual([])
  await turns($, 1, 4)
  // 利用者が打った文としては送らない
  expect(seen.submitted).toEqual([{ text: REMINDER, asUser: false }])
  expect(seen.store.get('session:s1')).toEqual({ isOn: true, report: { ...REPORT, updatedAt: 1_000_000_000, turns: 5 }, unchecked: 0 })

  // 促したターンが、書き直さずに終わった
  await $.turn.complete({ ...END, turnId: 'reminded' })
  expect(seen.store.get('session:s1')).toEqual({ isOn: true, report: { ...REPORT, updatedAt: 1_000_000_000, turns: 5 }, unchecked: 0 })

  await turns($, 4, 10)
  expect(seen.submitted.length).toBe(1)
  await turns($, 1, 14)
  expect(seen.submitted.length).toBe(2)
})

test('書き直すと、催促までのターンを数え直す', async ($, on) => {
  const seen = world(on)
  await $.session.start(START)
  await $.tool.call({ tool: TOOL, ...REPORT })
  await $.turn.complete(END)
  await turns($, 4)

  await $.tool.call({ tool: TOOL, ...REPORT })
  await $.turn.complete({ ...END, turnId: 'rewritten' })
  await turns($, 4, 10)
  expect(seen.submitted).toEqual([])
})

// 5 ターンたっても促さない場合
const SILENT: { name: string; stored: unknown; last: Parameters<Engine['turn']['complete']>[0] }[] = [
  {
    name: 'OFF にしてある',
    stored: { isOn: false, report: { ...REPORT, updatedAt: 1, turns: 0 }, unchecked: 4 },
    last: END,
  },
  {
    name: '5 ターンめが中断で終わった',
    stored: { isOn: true, report: { ...REPORT, updatedAt: 1, turns: 0 }, unchecked: 4 },
    last: { ...END, isAborted: true, reason: 'aborted' },
  },
]

for (const one of SILENT) {
  test(`促さない: ${one.name}`, async ($, on) => {
    const seen = world(on, { stored: { 'session:s1': one.stored } })
    await $.session.start(START)

    await $.turn.complete(one.last)
    expect(seen.submitted).toEqual([])
  })
}

test('中断で促せなかったら、次に答えて終わったターンで促す', async ($, on) => {
  const seen = world(on, { stored: { 'session:s1': { isOn: true, report: { ...REPORT, updatedAt: 1, turns: 0 }, unchecked: 4 } } })
  await $.session.start(START)

  await $.turn.complete({ ...END, isAborted: true, reason: 'aborted' })
  await $.turn.complete({ ...END, turnId: 't2' })
  expect(seen.submitted).toEqual([{ text: REMINDER, asUser: false }])
})

test('時間が進むと、書いてからの時間を出し直す', async ($, on) => {
  const seen = world(on)
  await $.session.start(START)
  await $.tool.call({ tool: TOOL, ...REPORT })
  const ui = await $.ui.mount(pane)

  seen.time = 1_000_000_000 + 3 * 3_600_000
  seen.tick()
  expect(await ui.find({ type: 'Text', text: /^3時間前に更新$/ })).toBeDefined()
  await ui.unmount()
})

test('開き直した ON のセッションでは、残っていた状況を戻して pane に出す', async ($, on) => {
  const seen = world(on, {
    stored: {
      'session:s1': { isOn: true, report: { ...REPORT, updatedAt: 1_000_000_000 - 2 * 86_400_000, turns: 4 }, unchecked: 4 },
      'session:other': { isOn: true, report: { ...REPORT, now: '別のセッション', updatedAt: 1, turns: 0 }, unchecked: 0 },
    },
  })
  await $.session.start(START)

  expect(seen.opened).toEqual([{ id: 'devrep', focus: false }])
  const ui = await $.ui.mount(pane)
  expect(await ui.find({ type: 'Text', text: /^帯の幅の計算を直している$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^2日前に更新 \+4$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^別のセッション$/ })).toBeUndefined()
  await ui.unmount()
})

test('開き直した OFF のセッションでは、pane を自動では開かない。状況は残っている', async ($, on) => {
  const seen = world(on, { stored: { 'session:s1': { isOn: false, report: { ...REPORT, updatedAt: 1_000_000_000, turns: 0 }, unchecked: 0 } } })
  await $.session.start(START)

  expect(seen.opened).toEqual([])
  const ui = await $.ui.mount(pane)
  expect(await ui.find({ type: 'Text', text: /^帯の幅の計算を直している$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^たったいま更新$/ })).toBeDefined()
  await ui.unmount()
})

test('覚えておくセッションは 30 個まで。超えたら、古いものから消える', async ($, on) => {
  const stored = Object.fromEntries(Array.from({ length: 30 }, (_, index) => [`session:old${index}`, { isOn: false, report: null, unchecked: 0 }]))
  const seen = world(on, { stored })
  await $.session.start(START)
  await $.tool.call({ tool: TOOL, ...REPORT })

  expect(seen.store.size).toBe(30)
  expect(seen.store.has('session:old0')).toBe(false)
  expect(seen.store.has('session:old1')).toBe(true)
  expect(seen.store.has('session:s1')).toBe(true)
})

test('/devrep は、フォーカスを移して pane を開く。ON にはしない', async ($, on) => {
  const seen = world(on)
  await $.session.start(START)

  expect(await $.command.run(command(''))).toEqual({ text: 'devrep pane opened.' })
  expect(seen.opened).toEqual([{ id: 'devrep', focus: true }])
  expect(seen.submitted).toEqual([])
  expect(seen.store.has('session:s1')).toBe(false)
})

// 説明の全文は長いので、頭と結びだけを見る
const isStartPrompt = (text: string | undefined): boolean =>
  text !== undefined &&
  text.startsWith('このセッションでは devrep') &&
  text.endsWith('利用者が devrep を ON にしました。いまの作業の状況を、mcp__devrep__update_devrep で書いてください。')

test('/devrep on は、ON にして pane を開き、最初の状況を書くよう Claude だけが読む文で伝える', async ($, on) => {
  const seen = world(on)
  await $.session.start(START)

  const ran = await $.command.run(command('on'))
  expect(ran.text).toBe('devrep is on for this session. devrep pane opened.')
  expect((ran.context ?? []).map(isStartPrompt)).toEqual([true])
  expect(seen.store.get('session:s1')).toEqual({ isOn: true, report: null, unchecked: 0 })
  expect(seen.opened).toEqual([{ id: 'devrep', focus: true }])
  // command.run の hook の中からは送れないので、ターンは始めない
  expect(seen.submitted).toEqual([])

  // すでに ON なら、もう一度は伝えない
  expect(await $.command.run(command('on'))).toEqual({ text: 'devrep is on for this session. devrep pane opened.' })
})

test('/devrep off は、OFF にする。状況は残す', async ($, on) => {
  const seen = world(on)
  await $.session.start(START)
  await $.tool.call({ tool: TOOL, ...REPORT })

  expect(await $.command.run(command('off'))).toEqual({ text: 'devrep is off for this session. The report stays in the pane.' })
  expect(seen.store.get('session:s1')).toEqual({ isOn: false, report: { ...REPORT, updatedAt: 1_000_000_000, turns: 0 }, unchecked: 0 })
})

test('/devrep に読めない引数を渡すと、使い方を返す', async ($, on) => {
  const seen = world(on)
  await $.session.start(START)

  expect(await $.command.run(command('toggle'))).toEqual({ text: 'Usage: /devrep [on|off]' })
  expect(seen.opened).toEqual([])
})

test('pane のボタンで、ON と OFF を切り替える', async ($, on) => {
  const seen = world(on)
  await $.session.start(START)
  const ui = await $.ui.mount(pane)

  await ui.press({ key: 'toggle' })
  expect(await ui.find({ type: 'Text', text: /^まだ書かれていません。Claudeが書くのを待っています$/ })).toBeDefined()
  // 最初の状況を、Mod の文として、その場で書かせる
  expect(seen.submitted.map(one => ({ isStart: isStartPrompt(one.text), asUser: one.asUser }))).toEqual([{ isStart: true, asUser: false }])

  await ui.press({ key: 'toggle' })
  expect(await ui.find({ type: 'Text', text: /^まだ書かれていません。ONにすると、Claudeが作業の状況を書きます$/ })).toBeDefined()
  expect(seen.store.get('session:s1')).toEqual({ isOn: false, report: null, unchecked: 0 })
  await ui.unmount()
})

test('「更新を頼む」を押すと、利用者の文として、書き直しを Claude に頼む', async ($, on) => {
  const seen = world(on, { stored: { 'session:s1': { isOn: true, report: null, unchecked: 0 } } })
  await $.session.start(START)
  const ui = await $.ui.mount(pane)

  await ui.press({ key: 'refresh' })
  expect(seen.submitted).toEqual([{ text: '作業の状況を、いまの内容に書き直して', asUser: true }])
  expect(seen.toasts).toEqual([])
  await ui.unmount()
})

test('頼めなかったら、知らせる', async ($, on) => {
  const seen = world(on, { isSent: false, stored: { 'session:s1': { isOn: true, report: null, unchecked: 0 } } })
  await $.session.start(START)
  const ui = await $.ui.mount(pane)

  await ui.press({ key: 'refresh' })
  expect(seen.toasts).toEqual(['更新を頼めませんでした。もう一度押してください'])
  await ui.unmount()
})

test('「閉じる」を押すと、pane を閉じる', async ($, on) => {
  const seen = world(on)
  await $.session.start(START)
  const ui = await $.ui.mount(pane)

  await ui.press({ key: 'close' })
  expect(seen.closed).toEqual(['devrep'])
  await ui.unmount()
})

const STARTS: { name: string; isOn: boolean; agentId: string | undefined; context: string[] }[] = [
  { name: 'ON のメインのセッションには、ほかの説明の後ろに足す', isOn: true, agentId: undefined, context: ['OTHER', 'DEVREP'] },
  { name: 'OFF のセッションには渡さない', isOn: false, agentId: undefined, context: ['OTHER'] },
  { name: 'サブエージェントには渡さない', isOn: true, agentId: 'a1', context: ['OTHER'] },
]

for (const one of STARTS) {
  test(`セッションの始めの説明: ${one.name}`, async ($, on) => {
    world(on, { stored: { 'session:s1': { isOn: one.isOn, report: null, unchecked: 0 } } })
    const result = await $.classic.SessionStart({ ...STARTED, source: 'startup', ...(one.agentId === undefined ? {} : { agent_id: one.agentId }) })
    // 説明の全文は長いので、この Mod の説明かどうかだけを見る
    expect((result.additionalContext ?? []).map(text => (text.includes('mcp__devrep__update_devrep') ? 'DEVREP' : text))).toEqual(one.context)
  })
}
