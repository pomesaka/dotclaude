import { expect, test, type TestBody } from 'claude-code/testing'

type On = Parameters<TestBody>[1]
type Engine = Parameters<TestBody>[0]

const END = { turnId: 't1', answer: '直しました。', durationMs: 0, isAborted: false, reason: 'answer' } as const
const USAGE = { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }
const REPLY = '{"options":["テストを足して","READMEにも反映して"]}'
// Claude Code 自身の案（入力欄に薄く出るもの）
const GUESS = { text: 'コミットして', origin: { kind: 'suggestion' as const } }

// プロンプトの上の帯
const band = (given: { isWorking?: boolean; hasSurvey?: boolean } = {}) => ({
  plugin: 'next-step',
  surface: 'terminal' as const,
  component: 'AbovePrompt' as const,
  props: {
    hasSurvey: given.hasSurvey ?? false,
    isWorking: given.isWorking ?? false,
    maxRows: 10,
    bodyColumns: 100,
    scroll: { offset: 0, bodyRows: 10 },
    view: {},
  },
  viewport: { columns: 105, rows: 40 },
})

type Given = {
  // 分岐して聞いたモデルの返事。null は、モデルが文を返さなかった
  reply?: string | null
  // true は、テストが answer() を呼ぶまで、モデルが答えない
  isSlow?: boolean
  // false は、送信が拒まれる
  isSent?: boolean
}

const world = (on: On, given: Given = {}) => {
  // 分岐して聞いたときの、依頼の文
  const asked: string[] = []
  // Claude へ送った文
  const submitted: string[] = []
  const toasts: string[] = []
  // 入力欄の薄い表示へ渡った案
  const shown: string[] = []
  // 待たせている返事を返す関数。null は、待たせている返事が無い
  let release: (() => void) | null = null
  const reply = given.reply === undefined ? REPLY : given.reply
  const answered =
    reply === null
      ? { isAnswered: false as const, reason: 'empty-reply' as const, usage: USAGE }
      : { isAnswered: true as const, text: reply, usage: USAGE }

  on('turn.start', (_$, e) => ({ turnId: e.turnId }))
  on('turn.complete', () => ({ text: '' }))
  on('prompt.suggest', (_$, e) => {
    shown.push(e.text)
    return { isShown: true }
  })
  on('model.fork', (_$, e) => {
    asked.push(e.prompt)
    if (given.isSlow !== true) return { value: answered }
    return new Promise<{ value: typeof answered }>(resolve => {
      release = () => resolve({ value: answered })
    })
  })
  on('prompt.submit', (_$, e) => {
    submitted.push(e.text)
    return given.isSent === false ? { drop: 'refused' } : { text: e.text }
  })
  on('ui.toast', (_$, e) => {
    toasts.push(e.text)
    return { value: undefined }
  })
  // テストの土台にはエンジンの描画が無い。帯に元から出るものの代わりに、目印を返す
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>ENGINE</Text>
  })
  return {
    asked,
    submitted,
    toasts,
    shown,
    answer: () => {
      const go = release
      release = null
      go?.()
    },
  }
}

// ターンが答えて終わり、エンジンの案が来る
const finish = async ($: Engine): Promise<void> => {
  await $.turn.complete(END)
  await $.prompt.suggest(GUESS)
}

// 分岐の返事が札に反映されるまで待つ。
// WHY 待つ: hook は返事を待たずに戻るので、帯を描いた時点では、まだ考えている最中のことがある
const settled = async (ui: { find: (query: { type: 'Text'; text: RegExp }) => Promise<unknown> }): Promise<void> => {
  for (let tries = 0; tries < 50; tries++) {
    if ((await ui.find({ type: 'Text', text: /考えています/ })) === undefined) return
  }
}

test('エンジンの案が来ると、それを先頭の札にし、残りを分岐して聞く。入力欄の薄い表示は残す', async ($, on) => {
  const seen = world(on)

  await finish($)
  const ui = await $.ui.mount(band())

  expect(seen.shown).toEqual(['コミットして'])
  expect(seen.asked.length).toBe(1)
  // 直前の答えと、エンジンの案を、依頼の文に入れる
  expect(seen.asked[0]?.includes('<answer>\n直しました。\n</answer>')).toBe(true)
  expect(seen.asked[0]?.includes('<first>\nコミットして\n</first>')).toBe(true)
  expect(await ui.find({ type: 'Text', text: /^コミットして$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^テストを足して$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^READMEにも反映して$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^ENGINE$/ })).toBeUndefined()
  await ui.unmount()
})

test('エンジンが案を出さなければ、札も出さず、モデルにも聞かない', async ($, on) => {
  const seen = world(on)

  await $.turn.complete(END)
  const ui = await $.ui.mount(band())

  expect(seen.asked).toEqual([])
  expect(await ui.find({ type: 'Text', text: /^ENGINE$/ })).toBeDefined()
  await ui.unmount()
})

// 案が来ても、札を出さない場合
const SKIPPED: { name: string; end: Parameters<Engine['turn']['complete']>[0] | null; guess: Parameters<Engine['prompt']['suggest']>[0] }[] = [
  { name: '中断で終わったターン', end: { ...END, isAborted: true, reason: 'aborted' }, guess: GUESS },
  { name: 'エラーで終わったターン', end: { ...END, reason: 'error' }, guess: GUESS },
  { name: '答えて終わったターンがまだ無い', end: null, guess: GUESS },
  { name: '空白だけの案', end: END, guess: { ...GUESS, text: '  ' } },
  { name: 'ほかの Mod が出した案', end: END, guess: { text: 'コミットして', origin: { kind: 'plugin', name: 'other' } } },
]

for (const one of SKIPPED) {
  test(`札を出さない: ${one.name}`, async ($, on) => {
    const seen = world(on)

    if (one.end !== null) await $.turn.complete(one.end)
    await $.prompt.suggest(one.guess)
    const ui = await $.ui.mount(band())

    expect(seen.asked).toEqual([])
    expect(await ui.find({ type: 'Text', text: /^ENGINE$/ })).toBeDefined()
    await ui.unmount()
  })
}

test('サブエージェントのターンが終わっても、メインの答えを忘れない', async ($, on) => {
  const seen = world(on)

  await $.turn.complete(END)
  await $.turn.complete({ ...END, turnId: 'sub', answer: '調べました。', agentId: 'a1' })
  await $.prompt.suggest(GUESS)
  const ui = await $.ui.mount(band())
  await settled(ui)

  expect(seen.asked[0]?.includes('<answer>\n直しました。\n</answer>')).toBe(true)
  await ui.unmount()
})

// 分岐して聞いても、札が先頭の 1 枚だけになる返事
const ALONE: { name: string; reply: string | null }[] = [
  { name: '案が無い', reply: '{"options":[]}' },
  { name: '読めない返事', reply: 'ほかの案はありません' },
  { name: 'モデルが答えなかった', reply: null },
  { name: '先頭と同じ案だけ', reply: '{"options":["コミットして"]}' },
]

for (const one of ALONE) {
  test(`先頭の札だけを出す: ${one.name}`, async ($, on) => {
    world(on, { reply: one.reply })

    await finish($)
    const ui = await $.ui.mount(band())
    await settled(ui)

    expect(await ui.find({ key: 'send-0' })).toBeDefined()
    expect(await ui.find({ key: 'send-1' })).toBeUndefined()
    expect(await ui.find({ type: 'Text', text: /考えています/ })).toBeUndefined()
    await ui.unmount()
  })
}

test('返事を待つあいだは、先頭の札だけを出して、考えていると添える。返事が来たら札が増える', async ($, on) => {
  const seen = world(on, { isSlow: true })

  await finish($)
  const ui = await $.ui.mount(band())
  expect(await ui.find({ type: 'Text', text: /^コミットして$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^ほかの案を考えています…$/ })).toBeDefined()
  expect(await ui.find({ key: 'send-1' })).toBeUndefined()

  seen.answer()
  expect(await ui.find({ type: 'Text', text: /^テストを足して$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /考えています/ })).toBeUndefined()
  await ui.unmount()
})

test('返事を待つあいだに次のターンが始まったら、遅れて来た案は出さない', async ($, on) => {
  const seen = world(on, { isSlow: true })

  await finish($)
  await $.turn.start({ text: '別のことを頼む', turnId: 't2' })
  seen.answer()

  const ui = await $.ui.mount(band())
  expect(await ui.find({ type: 'Text', text: /^ENGINE$/ })).toBeDefined()
  expect(await ui.find({ key: 'send-0' })).toBeUndefined()
  await ui.unmount()
})

test('返事を待つあいだに × を押したら、遅れて来た案は出さない', async ($, on) => {
  const seen = world(on, { isSlow: true })

  await finish($)
  const ui = await $.ui.mount(band())
  await ui.press({ key: 'dismiss' })
  seen.answer()

  expect(await ui.find({ type: 'Text', text: /^ENGINE$/ })).toBeDefined()
  expect(await ui.find({ key: 'send-0' })).toBeUndefined()
  await ui.unmount()
})

test('札を押すと、その文を Claude に送り、札を消す', async ($, on) => {
  const seen = world(on)
  await finish($)
  const ui = await $.ui.mount(band())

  await ui.press({ key: 'send-1' })
  expect(seen.submitted).toEqual(['テストを足して'])
  expect(await ui.find({ type: 'Text', text: /^ENGINE$/ })).toBeDefined()
  expect(await ui.find({ key: 'send-0' })).toBeUndefined()
  await ui.unmount()
})

test('送れなかったら、札を戻して知らせる', async ($, on) => {
  const seen = world(on, { isSent: false })
  await finish($)
  const ui = await $.ui.mount(band())

  await ui.press({ key: 'send-0' })
  expect(seen.toasts).toEqual(['「コミットして」を送れませんでした。もう一度押してください'])
  expect(await ui.find({ key: 'send-0' })).toBeDefined()
  await ui.unmount()
})

test('× を押すと、送らずに札を消す', async ($, on) => {
  const seen = world(on)
  await finish($)
  const ui = await $.ui.mount(band())

  await ui.press({ key: 'dismiss' })
  expect(seen.submitted).toEqual([])
  expect(await ui.find({ type: 'Text', text: /^ENGINE$/ })).toBeDefined()
  await ui.unmount()
})

test('次のターンが始まると、札が消える', async ($, on) => {
  world(on)
  await finish($)

  await $.turn.start({ text: '別のことを頼む', turnId: 't2' })
  const ui = await $.ui.mount(band())
  expect(await ui.find({ type: 'Text', text: /^ENGINE$/ })).toBeDefined()
  expect(await ui.find({ key: 'send-0' })).toBeUndefined()
  await ui.unmount()
})

// 札があっても描かずに、元の表示へ渡す場合
const PASSES: { name: string; given: { isWorking?: boolean; hasSurvey?: boolean } }[] = [
  { name: 'ターンの途中', given: { isWorking: true } },
  { name: '調査が帯を使っている', given: { hasSurvey: true } },
]

for (const one of PASSES) {
  test(`札を描かない: ${one.name}`, async ($, on) => {
    world(on)
    await finish($)
    const ui = await $.ui.mount(band(one.given))

    expect(await ui.find({ type: 'Text', text: /^ENGINE$/ })).toBeDefined()
    expect(await ui.find({ key: 'send-0' })).toBeUndefined()
    await ui.unmount()
  })
}
