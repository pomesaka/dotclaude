import { expect, test, type TestBody } from 'claude-code/testing'

const TOOL = 'mcp__rich__show'

type On = Parameters<TestBody>[1]

// $.store に答える。中身をテストから読めるよう、入れ物の Map を返す
const memoryStore = (on: On, entries: { [key: string]: unknown } = {}): Map<string, unknown> => {
  const data = new Map(Object.entries(entries))
  on('store.get', (_$, e) => ({ value: data.get(e.key) }))
  on('store.set', (_$, e) => {
    data.set(e.key, e.value)
    return { value: undefined }
  })
  on('store.delete', (_$, e) => {
    data.delete(e.key)
    return { value: undefined }
  })
  on('store.keys', () => ({ value: [...data.keys()] }))
  return data
}

const INPUT = {
  title: '出し方の比較',
  blocks: [
    { type: 'text', text: '| 出し方 | 残る |\n|---|---|\n| inline | 流れる |' },
    {
      type: 'cards',
      cards: [
        { title: '案A', lines: ['会話の中に描く', { text: '分割しない', tone: 'good' }] },
        { title: '案B', lines: ['paneに描く', { text: '幅を取る', tone: 'warn' }] },
      ],
    },
    {
      type: 'diagram',
      nodes: [
        { id: 'c', title: 'Claude', note: '中身を決める' },
        { id: 'm', title: 'Mod', note: '部品を組み立てる' },
      ],
      edges: [{ from: 'c', to: 'm', label: 'データ' }],
    },
    { type: 'question', key: 'where', question: 'どちらに出すか', options: ['会話の中', 'pane'] },
    { type: 'question', key: 'when', question: 'いつから', options: ['いま', 'あとで'] },
  ],
}

const row = (input: unknown, id: string) => ({
  plugin: 'rich',
  surface: 'terminal' as const,
  component: 'ToolUse' as const,
  requestId: id,
  props: { tool_use_id: id, tool: TOOL, input, isRunning: false, isErrored: false, isInterrupted: false, output: 'Shown inline in the transcript.' },
  viewport: { columns: 120, rows: 60 },
})

test('show の行は、入力から説明の全体を描く', async ($, on) => {
  memoryStore(on, { 'open:toolu_1': true })
  const ui = await $.ui.mount(row(INPUT, 'toolu_1'))

  expect(await ui.find({ type: 'Text', text: /出し方の比較/ })).toBeDefined()
  expect(await ui.find({ type: 'Markdown' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /案B/ })).toBeDefined()
  expect(await ui.find({ type: 'Raster' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /部品を組み立てる/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /すべて選ぶと送れます/ })).toBeDefined()
  expect(await ui.find({ key: 'send' })).toBeUndefined()

  await ui.unmount()
})

test('質問が複数なら、すべて選んでから送る。送ると質問が閉じて、印が消える', async ($, on) => {
  const store = memoryStore(on, { 'open:toolu_2': true, 'open:other': true })
  const sent: string[] = []
  on('prompt.submit', (_$, e) => {
    sent.push(e.text)
    return { text: e.text }
  })
  const ui = await $.ui.mount(row(INPUT, 'toolu_2'))

  await ui.press({ key: 'pick-where-1' })
  expect(await ui.find({ key: 'send' })).toBeUndefined()
  await ui.press({ key: 'pick-when-0' })
  await ui.press({ key: 'send' })
  expect(sent).toEqual(['【出し方の比較 への回答】\n1. どちらに出すか: pane\n2. いつから: いま'])

  // 閉じた後は、選ぶボタンも送るボタンも無い。ほかの説明の印は残る
  expect(await ui.find({ key: 'send' })).toBeUndefined()
  expect(await ui.find({ key: 'pick-when-1' })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: /^送信済み$/ })).toBeDefined()
  expect([...store.entries()]).toEqual([['open:other', true], ['answer:toolu_2', { where: 'pane', when: 'いま' }]])

  await ui.unmount()
})

test('未回答の印も答えの記録も無い質問（古くて消えた行）は、ボタンを出さない', async ($, on) => {
  memoryStore(on)
  const ui = await $.ui.mount(row(INPUT, 'toolu_old'))

  expect(await ui.find({ type: 'Text', text: /どちらに出すか/ })).toBeDefined()
  expect(await ui.find({ key: 'pick-where-0' })).toBeUndefined()
  expect(await ui.find({ key: 'send' })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: /この質問は閉じています/ })).toBeDefined()

  await ui.unmount()
})

test('答えの記録がある質問（開き直した後の、答え済みの行）は、選んだ答えを見せる。ボタンは出さない', async ($, on) => {
  memoryStore(on, { 'answer:toolu_done': { where: 'pane', when: 'あとで' } })
  const ui = await $.ui.mount(row(INPUT, 'toolu_done'))

  expect(await ui.find({ type: 'Text', text: /^\(x\) pane$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^\( \) 会話の中$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^\(x\) あとで$/ })).toBeDefined()
  expect(await ui.find({ key: 'pick-where-0' })).toBeUndefined()
  expect(await ui.find({ key: 'send' })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: /^送信済み$/ })).toBeDefined()

  await ui.unmount()
})

test('タブは、見出しを押すと下の中身が入れ替わる', async $ => {
  const tabbed = {
    title: '保存の方式',
    blocks: [
      {
        type: 'tabs',
        tabs: [
          { label: '案A', blocks: [{ type: 'text', text: '同期で保存する' }] },
          {
            label: '案B',
            blocks: [
              { type: 'diagram', nodes: [{ id: 'q', title: 'Queue' }, { id: 'db', title: 'DB', note: '保存する' }], edges: [{ from: 'q', to: 'db' }] },
            ],
          },
        ],
      },
    ],
  }
  const ui = await $.ui.mount(row(tabbed, 'toolu_tabs'))

  // 最初は 1 つ目のタブ。2 つ目の中身（図）はまだ描かれていない
  expect(await ui.find({ type: 'Markdown' })).toBeDefined()
  expect(await ui.find({ type: 'Raster' })).toBeUndefined()

  await ui.press({ key: 'tab-0-1' })
  expect(await ui.find({ type: 'Raster' })).toBeDefined()
  expect(await ui.find({ type: 'Markdown' })).toBeUndefined()

  await ui.press({ key: 'tab-0-0' })
  expect(await ui.find({ type: 'Markdown' })).toBeDefined()

  await ui.unmount()
})

test('質問が 1 つなら、選んだ時点で送る', async ($, on) => {
  memoryStore(on, { 'open:toolu_3': true })
  const sent: string[] = []
  on('prompt.submit', (_$, e) => {
    sent.push(e.text)
    return { text: e.text }
  })
  const single = { title: '次の一手', blocks: [{ type: 'question', key: 'next', question: '次にやること', options: ['push', '待つ'] }] }
  const ui = await $.ui.mount(row(single, 'toolu_3'))

  await ui.press({ key: 'pick-next-1' })
  expect(sent).toEqual(['【次の一手 への回答】\n1. 次にやること: 待つ'])

  await ui.unmount()
})

test('選択肢になっているカードは、題名を押すと、そのカードの値を答えとして送る。質問の枠は別に描かない', async ($, on) => {
  memoryStore(on, { 'open:toolu_4': true })
  const sent: string[] = []
  on('prompt.submit', (_$, e) => {
    sent.push(e.text)
    return { text: e.text }
  })
  const choices = {
    title: '保存の方式',
    blocks: [
      {
        type: 'cards',
        key: 'plan',
        question: 'どの案',
        cards: [
          { title: '案A（仮置き）', lines: ['保存が終わるまで待つ'], value: '案A' },
          { title: '案B', lines: ['キューに積んで返す'] },
        ],
      },
    ],
  }
  const ui = await $.ui.mount(row(choices, 'toolu_4'))
  expect(await ui.find({ type: 'Text', text: /^\( \) 案A（仮置き）$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^選ぶと、そのまま送ります$/ })).toBeDefined()

  await ui.press({ key: 'pick-plan-0' })
  expect(sent).toEqual(['【保存の方式 への回答】\n1. どの案: 案A'])

  await ui.unmount()
})

test('選択肢でないカードには、押せる題名を出さない', async ($, on) => {
  memoryStore(on, {})
  const plain = { title: '比較', blocks: [{ type: 'cards', cards: [{ title: '案A', lines: ['x'] }, { title: '案B', lines: ['y'] }] }] }
  const ui = await $.ui.mount(row(plain, 'toolu_5'))

  expect(await ui.find({ type: 'Text', text: /^案A$/ })).toBeDefined()
  expect(await ui.find({ type: 'Button' })).toBeUndefined()

  await ui.unmount()
})

test('実行中の行と、読めない入力の行は、エンジンの描画に任せる', async ($, on) => {
  // テストの土台にはエンジンの描画が無い。next(e) が届いたことを、この目印で確かめる
  on('ui.render', ($$, e) => {
    const { Text } = $$.ui.resolve(e)
    return <Text>ENGINE</Text>
  })

  const running = await $.ui.mount({ ...row(INPUT, 'toolu_4'), props: { ...row(INPUT, 'toolu_4').props, isRunning: true } })
  expect(await running.find({ type: 'Text', text: /ENGINE/ })).toBeDefined()
  expect(await running.find({ type: 'Raster' })).toBeUndefined()
  await running.unmount()

  const broken = await $.ui.mount(row({ title: 'x' }, 'toolu_5'))
  expect(await broken.find({ type: 'Text', text: /ENGINE/ })).toBeDefined()
  await broken.unmount()
})

test('pane 行きの show は、ツールを呼ぶと pane に同じ説明が出る', async ($, on) => {
  // pane は同じ id を使い回す。前の説明への答えが残っている状態から始める
  const store = memoryStore(on, { 'answer:rich': { where: '会話の中', when: 'いま' } })
  on('ui.open', () => ({ value: { isPlaced: true } }))
  const closed: string[] = []
  on('ui.close', (_$, e) => {
    closed.push(e.id)
    return { value: undefined }
  })
  const called = await $.tool.call({ tool: TOOL, ...INPUT, where: 'pane' })
  expect(String(called.result)).toMatch(/^Shown in a pane\./)

  const pane = await $.ui.mount({
    plugin: 'rich',
    surface: 'terminal',
    component: 'Pane',
    requestId: 'rich',
    props: { title: 'rich', isFocused: true, bodyColumns: 90, placement: 'dock', scroll: { offset: 0, bodyRows: 50 }, view: {} },
    viewport: { columns: 177, rows: 60 },
  })
  expect(await pane.find({ type: 'Text', text: /出し方の比較/ })).toBeDefined()
  expect(await pane.find({ type: 'Raster' })).toBeDefined()
  // ツールを呼んだ時点で未回答の印が付き、前の説明への答えは消える。pane の質問は押せる
  expect([...store.keys()]).toEqual(['open:rich'])
  expect(await pane.find({ key: 'pick-where-0' })).toBeDefined()

  await pane.press({ key: 'close' })
  expect(closed).toEqual(['rich'])
  await pane.unmount()

  const line = await $.ui.mount(row({ ...INPUT, where: 'pane' }, 'toolu_6'))
  expect(await line.find({ type: 'Text', text: /paneに出しました/ })).toBeDefined()
  expect(await line.find({ type: 'Raster' })).toBeUndefined()
  await line.unmount()
})

test('未回答の印は 30 件まで。超えたら古いものから消える', async ($, on) => {
  const marks = Object.fromEntries(Array.from({ length: 30 }, (_, at) => [`open:old-${at}`, true]))
  const store = memoryStore(on, { ...marks, 'answer:kept': { q: 'a' }, unrelated: 1 })
  on('ui.open', () => ({ value: { isPlaced: true } }))
  await $.tool.call({ tool: TOOL, ...INPUT, where: 'pane' })

  const keys = [...store.keys()]
  expect(keys.filter(key => key.startsWith('open:')).length).toBe(30)
  expect(keys.includes('open:old-0')).toBe(false)
  expect(keys.includes('open:old-1')).toBe(true)
  expect(keys.includes('open:rich')).toBe(true)
  // 印でないもの、別の種類の記録には触らない
  expect(keys.includes('answer:kept')).toBe(true)
  expect(keys.includes('unrelated')).toBe(true)
})

test('答えの記録は 50 件まで。超えたら古いものから消える', async ($, on) => {
  const answers = Object.fromEntries(Array.from({ length: 50 }, (_, at) => [`answer:old-${at}`, { q: 'a' }]))
  const store = memoryStore(on, { ...answers, 'open:toolu_new': true })
  on('prompt.submit', (_$, e) => ({ text: e.text }))
  const single = { title: '次の一手', blocks: [{ type: 'question', key: 'next', question: '次にやること', options: ['push', '待つ'] }] }
  const ui = await $.ui.mount(row(single, 'toolu_new'))
  await ui.press({ key: 'pick-next-0' })

  const keys = [...store.keys()]
  expect(keys.filter(key => key.startsWith('answer:')).length).toBe(50)
  expect(keys.includes('answer:old-0')).toBe(false)
  expect(keys.includes('answer:old-1')).toBe(true)
  expect(store.get('answer:toolu_new')).toEqual({ next: 'push' })
  expect(keys.includes('open:toolu_new')).toBe(false)

  await ui.unmount()
})
