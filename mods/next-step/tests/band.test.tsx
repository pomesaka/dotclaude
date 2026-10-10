import { expect, test, type TestBody } from 'claude-code/testing'

type On = Parameters<TestBody>[1]

const END = { turnId: 't1', answer: '直しました。', durationMs: 0, isAborted: false, reason: 'answer' } as const
const USAGE = { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }
const REPLY = '{"options":[{"label":"テストを足す","prompt":"境界のケースをtable drivenで足して"},{"label":"コミット","prompt":"ここまでをコミットして"}]}'

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
  // モデルの返事。null は、モデルが文を返さなかった
  reply?: string | null
  // true は、テストが answer() を呼ぶまで、モデルが答えない
  isSlow?: boolean
  // false は、送信が拒まれる
  isSent?: boolean
  // 環境変数 NEXT_STEP_MODEL の値
  model?: string
}

const world = (on: On, given: Given = {}) => {
  // モデルへ送った依頼の文と、聞いたモデル
  const asked: string[] = []
  const models: string[] = []
  // Claude へ送った文
  const submitted: string[] = []
  const toasts: string[] = []
  // 待たせている返事を返す関数。null は、待たせている返事が無い
  let release: (() => void) | null = null
  const reply = given.reply === undefined ? REPLY : given.reply
  const answered =
    reply === null
      ? { isAnswered: false as const, reason: 'empty-reply' as const, usage: USAGE }
      : { isAnswered: true as const, text: reply, usage: USAGE }

  on('turn.start', (_$, e) => ({ turnId: e.turnId }))
  on('turn.complete', () => ({ text: '' }))
  on('env.get', () => ({ value: given.model }))
  on('session.messages', () => ({
    value: [
      { role: 'user' as const, text: '番号を直して', toolUses: [] },
      { role: 'assistant' as const, text: '直しました。', toolUses: [] },
    ],
  }))
  on('model.complete', (_$, e) => {
    asked.push(e.prompt)
    models.push(e.model)
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
    models,
    submitted,
    toasts,
    answer: () => {
      const go = release
      release = null
      go?.()
    },
  }
}

test('ターンが終わると、モデルに聞いた案が札として並ぶ', async ($, on) => {
  const seen = world(on)

  await $.turn.complete(END)
  const ui = await $.ui.mount(band())

  expect(seen.models).toEqual(['haiku'])
  // 会話の末尾にある直前の答えは、<answer> の枠にだけ入る
  expect(seen.asked).toEqual([
    '<conversation>\n[利用者]\n番号を直して\n</conversation>\n\nClaude が直前に返した答え:\n<answer>\n直しました。\n</answer>',
  ])
  expect(await ui.find({ type: 'Text', text: /^テストを足す$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^コミット$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^ここまでをコミットして$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^ENGINE$/ })).toBeUndefined()
  await ui.unmount()
})

test('環境変数 NEXT_STEP_MODEL で、聞くモデルを変えられる', async ($, on) => {
  const seen = world(on, { model: 'sonnet' })

  await $.turn.complete(END)
  const ui = await $.ui.mount(band())

  expect(seen.models).toEqual(['sonnet'])
  expect(await ui.find({ type: 'Text', text: /^テストを足す$/ })).toBeDefined()
  await ui.unmount()
})

// モデルに聞かないターン
const SKIPPED: { name: string; end: Parameters<Parameters<TestBody>[0]['turn']['complete']>[0] }[] = [
  { name: '中断された', end: { ...END, isAborted: true, reason: 'aborted' } },
  { name: 'エラーで終わった', end: { ...END, reason: 'error' } },
  { name: '答えの文が無い', end: { ...END, answer: ' ' } },
  { name: 'サブエージェントのターン', end: { ...END, agentId: 'a1' } },
]

for (const one of SKIPPED) {
  test(`モデルに聞かない: ${one.name}`, async ($, on) => {
    const seen = world(on)

    await $.turn.complete(one.end)
    const ui = await $.ui.mount(band())

    expect(seen.asked).toEqual([])
    expect(await ui.find({ type: 'Text', text: /^ENGINE$/ })).toBeDefined()
    await ui.unmount()
  })
}

// モデルに聞いても、札が出ない返事
const EMPTY: { name: string; reply: string | null }[] = [
  { name: '案が無い', reply: '{"options":[]}' },
  { name: '読めない返事', reply: '次の一手はありません' },
  { name: 'モデルが答えなかった', reply: null },
]

for (const one of EMPTY) {
  test(`札を出さない: ${one.name}`, async ($, on) => {
    world(on, { reply: one.reply })

    await $.turn.complete(END)
    const ui = await $.ui.mount(band())

    expect(await ui.find({ type: 'Text', text: /^ENGINE$/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /考えています/ })).toBeUndefined()
    await ui.unmount()
  })
}

test('モデルの返事を待つあいだは、考えていると出す。返事が来たら札に替わる', async ($, on) => {
  const seen = world(on, { isSlow: true })

  await $.turn.complete(END)
  const ui = await $.ui.mount(band())
  expect(await ui.find({ type: 'Text', text: /^次の一手を考えています…$/ })).toBeDefined()

  seen.answer()
  expect(await ui.find({ type: 'Text', text: /^テストを足す$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /考えています/ })).toBeUndefined()
  await ui.unmount()
})

test('返事を待つあいだに次のターンが始まったら、遅れて来た案は出さない', async ($, on) => {
  const seen = world(on, { isSlow: true })

  await $.turn.complete(END)
  await $.turn.start({ text: '別のことを頼む', turnId: 't2' })
  seen.answer()

  const ui = await $.ui.mount(band())
  expect(await ui.find({ type: 'Text', text: /^ENGINE$/ })).toBeDefined()
  expect(await ui.find({ key: 'send-0' })).toBeUndefined()
  await ui.unmount()
})

test('札を押すと、その文を Claude に送り、札を消す', async ($, on) => {
  const seen = world(on)
  await $.turn.complete(END)
  const ui = await $.ui.mount(band())

  await ui.press({ key: 'send-1' })
  expect(seen.submitted).toEqual(['ここまでをコミットして'])
  expect(await ui.find({ type: 'Text', text: /^ENGINE$/ })).toBeDefined()
  expect(await ui.find({ key: 'send-0' })).toBeUndefined()
  await ui.unmount()
})

test('送れなかったら、札を戻して知らせる', async ($, on) => {
  const seen = world(on, { isSent: false })
  await $.turn.complete(END)
  const ui = await $.ui.mount(band())

  await ui.press({ key: 'send-0' })
  expect(seen.toasts).toEqual(['「テストを足す」を送れませんでした。もう一度押してください'])
  expect(await ui.find({ key: 'send-0' })).toBeDefined()
  await ui.unmount()
})

test('× を押すと、送らずに札を消す', async ($, on) => {
  const seen = world(on)
  await $.turn.complete(END)
  const ui = await $.ui.mount(band())

  await ui.press({ key: 'dismiss' })
  expect(seen.submitted).toEqual([])
  expect(await ui.find({ type: 'Text', text: /^ENGINE$/ })).toBeDefined()
  await ui.unmount()
})

test('次のターンが始まると、札が消える', async ($, on) => {
  world(on)
  await $.turn.complete(END)

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
    await $.turn.complete(END)
    const ui = await $.ui.mount(band(one.given))

    expect(await ui.find({ type: 'Text', text: /^ENGINE$/ })).toBeDefined()
    expect(await ui.find({ key: 'send-0' })).toBeUndefined()
    await ui.unmount()
  })
}
