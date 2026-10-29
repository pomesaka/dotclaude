import { expect, test, type TestBody } from 'claude-code/testing'

type On = Parameters<TestBody>[1]
type Engine = Parameters<TestBody>[0]

const START = { cwd: '/repo', surface: 'terminal', isInteractive: true } as const
const END = { turnId: 't1', answer: '直しました。', durationMs: 0, isAborted: false, reason: 'answer' } as const
const USAGE = { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }
const REPORT = {
  now: '帯の幅の計算を直している',
  next: ['テストを足す', 'READMEに反映する'],
  todo: ['/reload-plugins を打つ', 'Q3 に答える'],
  sections: [
    { title: '知っておいてほしいこと', items: ['幅のしきい値は仮に決めた'] },
    { title: '決まったこと', items: ['表は使わない'] },
  ],
}
const REPLY = `\`\`\`json\n${JSON.stringify(REPORT)}\n\`\`\``

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
  // 分岐して聞いたモデルの返事。null は、モデルが文を返さなかった
  reply?: string | null
  // true は、テストが answer() を呼ぶまで、モデルが答えない
  isSlow?: boolean
}

const world = (on: On, given: Given = {}) => {
  // 開いた pane。focus は、フォーカスを移したか
  const opened: { id: string; focus: boolean }[] = []
  const closed: string[] = []
  // 分岐して聞いたときの、依頼の文
  const asked: string[] = []
  // Claude へ送った文
  const submitted: string[] = []
  const toasts: string[] = []
  // いま待っている周期を終わらせる関数。null は、待っている周期が無い
  let release: (() => void) | null = null
  // 待たせている返事を返す関数。null は、待たせている返事が無い
  let pending: (() => void) | null = null
  const seen = {
    store: new Map(Object.entries(given.stored ?? {})),
    opened,
    closed,
    asked,
    submitted,
    toasts,
    // 分岐の返事。テストが書き換えて、次の返事を変える
    reply: given.reply === undefined ? REPLY : given.reply,
    // いまの時刻（エポックからのミリ秒）。テストが書き換えて、時間を進める
    time: 1_000_000_000,
    // 時間を 1 周期ぶん進める。タイマーの関数が 1 回走る
    tick: () => {
      const go = release
      release = null
      go?.()
    },
    // 待たせている返事を返す
    answer: () => {
      const go = pending
      pending = null
      go?.()
    },
  }
  const answered = () =>
    seen.reply === null
      ? { isAnswered: false as const, reason: 'empty-reply' as const, usage: USAGE }
      : { isAnswered: true as const, text: seen.reply, usage: USAGE }

  on('session.id', () => ({ value: 's1' }))
  on('session.start', () => ({ cwd: '/repo' }))
  on('command.register', (_$, e) => ({ value: { command: e.name } }))
  on('turn.start', (_$, e) => ({ turnId: e.turnId }))
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
  on('model.fork', (_$, e) => {
    asked.push(e.prompt)
    const value = answered()
    if (given.isSlow !== true) return { value }
    return new Promise<{ value: typeof value }>(resolve => {
      pending = () => resolve({ value })
    })
  })
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
    submitted.push(e.text)
    return { text: e.text }
  })
  return seen
}

// 分岐の返事を待って書かれるまで、イベントの処理を進める
const settled = () => new Promise(resolve => setTimeout(resolve, 0))

// メインのターンを count 回終わらせる
const turns = async ($: Engine, count: number, from = 0): Promise<void> => {
  for (let index = 0; index < count; index++) await $.turn.complete({ ...END, turnId: `t${from + index}` })
  await settled()
}

const ON_EMPTY = { 'session:s1': { isOn: true, report: null, unchecked: 0 } }
const written = (turns: number, unchecked: number, isOn = true) => ({ isOn, report: { ...REPORT, updatedAt: 1_000_000_000, turns }, unchecked })

test('自動更新が OFF で始まり、まだ書かれていないと出す。pane は自動では開かず、Claude には何も送らない', async ($, on) => {
  const seen = world(on)
  await $.session.start(START)

  const ui = await $.ui.mount(pane)
  expect(await ui.find({ type: 'Text', text: /^まだ書かれていません$/ })).toBeDefined()
  // 書かれていないあいだは、いつ書いたかの行を出さない
  expect(await ui.find({ type: 'Text', text: /更新$/ })).toBeUndefined()
  expect(await ui.find({ key: 'refresh' })).toBeDefined()
  expect(seen.opened).toEqual([])
  expect(seen.asked).toEqual([])
  await ui.unmount()
})

test('「更新する」を押すと、会話を分岐させて書かせ、pane に出して $.store に残す。自動更新は OFF のまま', async ($, on) => {
  const seen = world(on)
  await $.session.start(START)
  const ui = await $.ui.mount(pane)

  await ui.press({ key: 'refresh' })
  await settled()
  expect(seen.asked.length).toBe(1)
  expect(seen.store.get('session:s1')).toEqual(written(0, 0, false))
  // メインには何も送らない
  expect(seen.submitted).toEqual([])
  expect(await ui.find({ type: 'Text', text: /^帯の幅の計算を直している$/ })).toBeDefined()
  // 日時はマシンのタイムゾーンで変わるので、形だけを見る。値は stampOf のテストで固定している
  expect(await ui.find({ type: 'Text', text: /^いま（\d{4}-\d{2}-\d{2} \d{2}:\d{2}）$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^次にすること$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^READMEに反映する$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^あなたがすること$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^\/reload-plugins を打つ$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^知っておいてほしいこと$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^幅のしきい値は仮に決めた$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^たったいま更新$/ })).toBeDefined()
  await ui.unmount()
})

test('書いているあいだは「書いています…」と出し、もう一度押しても重ねて聞かない', async ($, on) => {
  const seen = world(on, { isSlow: true })
  await $.session.start(START)
  const ui = await $.ui.mount(pane)

  await ui.press({ key: 'refresh' })
  await ui.press({ key: 'refresh' })
  expect(await ui.find({ type: 'Text', text: /^書いています…$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^まだ書かれていません$/ })).toBeUndefined()
  expect(seen.asked.length).toBe(1)

  seen.answer()
  await settled()
  expect(await ui.find({ type: 'Text', text: /^書いています…$/ })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: /^たったいま更新$/ })).toBeDefined()
  await ui.unmount()
})

// 頼んで書けなかったとき
const FAILED: { name: string; reply: string | null; toast: string }[] = [
  { name: 'モデルが答えなかった', reply: null, toast: '作業の状況を書けませんでした（empty-reply）。もう一度押してください' },
  { name: '返事に JSON が無い', reply: '書けません', toast: '作業の状況を書けませんでした（the reply has no JSON object）。もう一度押してください' },
  { name: '中身が足りない', reply: '{"now":"a"}', toast: '作業の状況を書けませんでした（next must be a list of at least one string）。もう一度押してください' },
]

for (const one of FAILED) {
  test(`頼んで書けなかったら知らせ、前の状況を残す: ${one.name}`, async ($, on) => {
    const seen = world(on, { reply: one.reply, stored: { 'session:s1': written(2, 2, false) } })
    await $.session.start(START)
    const ui = await $.ui.mount(pane)

    await ui.press({ key: 'refresh' })
    await settled()
    expect(seen.toasts).toEqual([one.toast])
    expect(seen.store.get('session:s1')).toEqual(written(2, 2, false))
    await ui.unmount()
  })
}

test('直前の答えを依頼の文に入れる。次のターンが始まったら入れない', async ($, on) => {
  const seen = world(on)
  await $.session.start(START)
  const ui = await $.ui.mount(pane)

  await $.turn.complete({ ...END, answer: '幅を 2 桁ぶん詰めました。' })
  await ui.press({ key: 'refresh' })
  await settled()
  expect(seen.asked[0]?.includes('<answer>\n幅を 2 桁ぶん詰めました。\n</answer>')).toBe(true)

  await $.turn.start({ turnId: 't2', prompt: '次は？' })
  await ui.press({ key: 'refresh' })
  await settled()
  expect(seen.asked[1]?.includes('<answer>')).toBe(false)
  // 前に書いた状況は渡す
  expect(seen.asked[1]?.includes(JSON.stringify(REPORT))).toBe(true)
  await ui.unmount()
})

test('自動更新が ON なら、書いてから 5 ターンで書き直す。次は、その 5 ターン後', async ($, on) => {
  const seen = world(on, { stored: { 'session:s1': written(0, 0) } })
  await $.session.start(START)

  await turns($, 4)
  expect(seen.asked.length).toBe(0)
  expect(seen.store.get('session:s1')).toEqual(written(4, 4))
  await turns($, 1, 4)
  expect(seen.asked.length).toBe(1)
  expect(seen.store.get('session:s1')).toEqual(written(0, 0))
  // メインには何も送らない
  expect(seen.submitted).toEqual([])

  await turns($, 4, 10)
  expect(seen.asked.length).toBe(1)
  await turns($, 1, 14)
  expect(seen.asked.length).toBe(2)
})

test('自動で書けなかったら知らせず、次に答えて終わったターンで書き直す', async ($, on) => {
  const seen = world(on, { reply: null, stored: { 'session:s1': written(0, 4) } })
  await $.session.start(START)

  await turns($, 1)
  expect(seen.asked.length).toBe(1)
  expect(seen.toasts).toEqual([])
  expect(seen.store.get('session:s1')).toEqual(written(1, 5))

  seen.reply = REPLY
  await turns($, 1, 1)
  expect(seen.asked.length).toBe(2)
  expect(seen.store.get('session:s1')).toEqual(written(0, 0))
})

// 5 ターンたっても書き直さない場合
const SILENT: { name: string; stored: unknown; last: Parameters<Engine['turn']['complete']>[0] }[] = [
  { name: '自動更新が OFF', stored: written(0, 4, false), last: END },
  { name: '5 ターンめが中断で終わった', stored: written(0, 4), last: { ...END, isAborted: true, reason: 'aborted' } },
  { name: '5 ターンめがサブエージェントのターン', stored: written(0, 4), last: { ...END, agentId: 'a1' } },
]

for (const one of SILENT) {
  test(`書き直さない: ${one.name}`, async ($, on) => {
    const seen = world(on, { stored: { 'session:s1': one.stored } })
    await $.session.start(START)

    await $.turn.complete(one.last)
    await settled()
    expect(seen.asked).toEqual([])
  })
}

test('書いた後のターンを数える。サブエージェントのターンは数えない', async ($, on) => {
  world(on, { stored: { 'session:s1': written(0, 0, false) } })
  await $.session.start(START)
  const ui = await $.ui.mount(pane)

  await $.turn.complete(END)
  await $.turn.complete({ ...END, turnId: 't2', agentId: 'a1' })
  await $.turn.complete({ ...END, turnId: 't3' })
  expect(await ui.find({ type: 'Text', text: /^たったいま更新 \+2$/ })).toBeDefined()
  await ui.unmount()
})

test('時間が進むと、書いてからの時間を出し直す', async ($, on) => {
  const seen = world(on, { stored: { 'session:s1': written(0, 0, false) } })
  await $.session.start(START)
  const ui = await $.ui.mount(pane)

  seen.time = 1_000_000_000 + 3 * 3_600_000
  seen.tick()
  expect(await ui.find({ type: 'Text', text: /^3時間前に更新$/ })).toBeDefined()
  await ui.unmount()
})

test('開き直した自動更新 ON のセッションでは、残っていた状況を戻して pane に出す', async ($, on) => {
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

test('開き直した自動更新 OFF のセッションでは、pane を自動では開かない。状況は残っている', async ($, on) => {
  const seen = world(on, { stored: { 'session:s1': written(0, 0, false) } })
  await $.session.start(START)

  expect(seen.opened).toEqual([])
  const ui = await $.ui.mount(pane)
  expect(await ui.find({ type: 'Text', text: /^帯の幅の計算を直している$/ })).toBeDefined()
  await ui.unmount()
})

test('覚えておくセッションは 30 個まで。超えたら、古いものから消える', async ($, on) => {
  const stored = Object.fromEntries(Array.from({ length: 30 }, (_, index) => [`session:old${index}`, { isOn: false, report: null, unchecked: 0 }]))
  const seen = world(on, { stored })
  await $.session.start(START)
  const ui = await $.ui.mount(pane)
  await ui.press({ key: 'refresh' })
  await settled()

  expect(seen.store.size).toBe(30)
  expect(seen.store.has('session:old0')).toBe(false)
  expect(seen.store.has('session:old1')).toBe(true)
  expect(seen.store.has('session:s1')).toBe(true)
  await ui.unmount()
})

test('/devrep は、フォーカスを移して pane を開く。自動更新は ON にしない', async ($, on) => {
  const seen = world(on)
  await $.session.start(START)

  expect(await $.command.run(command(''))).toEqual({ text: 'devrep pane opened.' })
  expect(seen.opened).toEqual([{ id: 'devrep', focus: true }])
  expect(seen.asked).toEqual([])
  expect(seen.store.has('session:s1')).toBe(false)
})

test('/devrep on は、自動更新を ON にし、その場で書かせて pane を開く', async ($, on) => {
  const seen = world(on)
  await $.session.start(START)

  expect(await $.command.run(command('on'))).toEqual({ text: 'devrep: automatic updates are on. devrep pane opened.' })
  await settled()
  expect(seen.asked.length).toBe(1)
  expect(seen.store.get('session:s1')).toEqual(written(0, 0))
  expect(seen.opened).toEqual([{ id: 'devrep', focus: true }])
  expect(seen.submitted).toEqual([])

  // すでに ON なら、もう一度は書かせない
  await $.command.run(command('on'))
  await settled()
  expect(seen.asked.length).toBe(1)
})

test('/devrep off は、自動更新を OFF にする。状況は残す', async ($, on) => {
  const seen = world(on, { stored: { 'session:s1': written(0, 3) } })
  await $.session.start(START)

  expect(await $.command.run(command('off'))).toEqual({ text: 'devrep: automatic updates are off. Update the report from the pane.' })
  expect(seen.store.get('session:s1')).toEqual(written(0, 0, false))
})

test('/devrep に読めない引数を渡すと、使い方を返す', async ($, on) => {
  const seen = world(on)
  await $.session.start(START)

  expect(await $.command.run(command('toggle'))).toEqual({ text: 'Usage: /devrep [on|off]' })
  expect(seen.opened).toEqual([])
})

test('pane のボタンで、自動更新を切り替える。ON にしたら、その場で書かせる', async ($, on) => {
  const seen = world(on)
  await $.session.start(START)
  const ui = await $.ui.mount(pane)

  await ui.press({ key: 'toggle' })
  await settled()
  expect(seen.asked.length).toBe(1)
  expect(seen.store.get('session:s1')).toEqual(written(0, 0))
  expect(await ui.find({ text: /^自動更新をOFFにする$/ })).toBeDefined()

  await ui.press({ key: 'toggle' })
  expect(seen.store.get('session:s1')).toEqual(written(0, 0, false))
  expect(await ui.find({ text: /^自動更新をONにする$/ })).toBeDefined()
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

// プロンプトの下の行
const line = {
  plugin: 'devrep',
  surface: 'terminal' as const,
  component: 'PromptHint' as const,
  props: { isDraft: false, isWorking: false, hint: '? for shortcuts' },
  viewport: { columns: 142, rows: 40 },
}

// テストの土台にはエンジンの描画が無い。下の層の表示の代わりに、目印を返す
const engineLine = (on: On) =>
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>ENGINE</Text>
  })

// 札を出すかどうか
const HINTS: { name: string; stored: { [key: string]: unknown }; isShown: boolean }[] = [
  { name: '自動更新が ON なら出す', stored: ON_EMPTY, isShown: true },
  { name: '自動更新が OFF でも、状況があれば出す', stored: { 'session:s1': written(0, 0, false) }, isShown: true },
  { name: '自動更新が OFF で状況も無ければ出さない', stored: {}, isShown: false },
]

for (const one of HINTS) {
  test(`プロンプトの下の行の札: ${one.name}。下の層の表示は残す`, async ($, on) => {
    world(on, { stored: one.stored })
    engineLine(on)
    await $.session.start(START)

    const ui = await $.ui.mount(line)
    expect((await ui.find({ key: 'devrep' })) !== undefined).toBe(one.isShown)
    expect(await ui.find({ type: 'Text', text: /^ENGINE$/ })).toBeDefined()
    await ui.unmount()
  })
}

test('札を押すと、フォーカスを移して pane を開く。札には利用者がすることの件数が出る', async ($, on) => {
  const seen = world(on, { stored: { 'session:s1': written(0, 0) } })
  engineLine(on)
  await $.session.start(START)
  seen.opened.length = 0

  const ui = await $.ui.mount(line)
  expect(await ui.find({ type: 'Text', text: /^ devrep $/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^2 $/ })).toBeDefined()
  await ui.press({ key: 'devrep' })
  expect(seen.opened).toEqual([{ id: 'devrep', focus: true }])
  await ui.unmount()
})

test('利用者がすることが無ければ、札に件数を出さず、pane にその節を出さない', async ($, on) => {
  world(on, { stored: { 'session:s1': { isOn: true, report: { ...REPORT, todo: [], updatedAt: 1_000_000_000, turns: 0 }, unchecked: 0 } } })
  engineLine(on)
  await $.session.start(START)

  const hint = await $.ui.mount(line)
  expect(await hint.find({ type: 'Text', text: /^\d+ $/ })).toBeUndefined()
  await hint.unmount()
  const ui = await $.ui.mount(pane)
  expect(await ui.find({ type: 'Text', text: /^あなたがすること$/ })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: /^帯の幅の計算を直している$/ })).toBeDefined()
  await ui.unmount()
})
