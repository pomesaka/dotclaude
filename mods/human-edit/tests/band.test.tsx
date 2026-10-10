import { expect, test, type TestBody } from 'claude-code/testing'

// プロンプトの上の帯
const band = (hasSurvey: boolean) => ({
  plugin: 'human-edit',
  surface: 'terminal' as const,
  component: 'AbovePrompt' as const,
  props: { hasSurvey, isWorking: true, maxRows: 10, bodyColumns: 100, scroll: { offset: 0, bodyRows: 10 }, view: {} },
  viewport: { columns: 105, rows: 40 },
})

type On = Parameters<TestBody>[1]

// editing は、Mod が持っている「編集してもらっているファイル」。null は、編集中のファイルが無い
const world = (on: On, editing: { path: string; instructions: string | null } | null) => {
  on('state.get', { plugin: 'human-edit' }, () => ({ value: { value: editing, version: 1 } }))
  // テストの土台にはエンジンの描画が無い。帯に元から出るものの代わりに、目印を返す
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>ENGINE</Text>
  })
}

test('編集してもらっているあいだ、帯にファイルと指示を出す', async ($, on) => {
  world(on, { path: '.env', instructions: 'OPENAI_API_KEYを設定してください' })
  const ui = await $.ui.mount(band(false))

  expect(await ui.find({ type: 'Text', text: /^human_edit$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^\.env$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^OPENAI_API_KEYを設定してください$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^ENGINE$/ })).toBeUndefined()
  await ui.unmount()
})

test('指示が無くても、ファイルは出す', async ($, on) => {
  world(on, { path: '.env', instructions: null })
  const ui = await $.ui.mount(band(false))

  expect(await ui.find({ type: 'Text', text: /^\.env$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /editorを閉じると戻ります/ })).toBeDefined()
  await ui.unmount()
})

// 帯を描かずに、元の表示へ渡す場合
const PASSES: { name: string; editing: { path: string; instructions: string | null } | null; hasSurvey: boolean }[] = [
  { name: '編集中のファイルが無い', editing: null, hasSurvey: false },
  { name: '調査が帯を使っている', editing: { path: '.env', instructions: 'x' }, hasSurvey: true },
]

for (const one of PASSES) {
  test(`帯を描かない: ${one.name}`, async ($, on) => {
    world(on, one.editing)
    const ui = await $.ui.mount(band(one.hasSurvey))

    expect(await ui.find({ type: 'Text', text: /^ENGINE$/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /^human_edit$/ })).toBeUndefined()
    await ui.unmount()
  })
}
