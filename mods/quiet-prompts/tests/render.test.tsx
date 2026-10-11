import { expect, test, type TestBody } from 'claude-code/testing'

type On = Parameters<TestBody>[1]

const FRAMED =
  "The devrep plugin sent a message:\ndevrep: 状況を書き直してください。\n変わっていなければ何もしないでください。\n\nThis is how Claude Code surfaces a prompt a plugin submits between turns — it starts this turn in the user's place. Address the message above."

// エンジンの描画の代わりに、受け取った文を覚える
const world = (on: On) => {
  const drawn: string[] = []
  on('ui.render', ($, e) => {
    if (e.component === 'UserMessage') drawn.push(e.props.text)
    const { Text } = $.ui.resolve(e)
    return <Text>ROW</Text>
  })
  return { drawn }
}

const REQUEST = '[questions: ここからは、利用者との相談用に分岐した会話です。]\n\n決まり:\n- 読むだけにする'

const row = (origin: { kind: 'plugin'; name: string; asUser?: true } | { kind: 'composer' } | { kind: 'unclassified' }, isExpanded = false, text = FRAMED) => ({
  plugin: 'quiet-prompts',
  surface: 'terminal' as const,
  component: 'UserMessage' as const,
  props: { text, origin, isExpanded },
  viewport: { columns: 100, rows: 40 },
})

const ROWS: { name: string; origin: Parameters<typeof row>[0]; isExpanded: boolean; drawn: string }[] = [
  { name: 'ほかの Mod が自分から送った文は、1 行に畳む', origin: { kind: 'plugin', name: 'devrep' }, isExpanded: false, drawn: 'devrep: 状況を書き直してください。 …' },
  { name: '開いた表示では、畳まない', origin: { kind: 'plugin', name: 'devrep' }, isExpanded: true, drawn: FRAMED },
  { name: '利用者の操作で送った文は、畳まない', origin: { kind: 'plugin', name: 'next-step', asUser: true }, isExpanded: false, drawn: FRAMED },
  { name: '利用者が打った文は、畳まない', origin: { kind: 'composer' }, isExpanded: false, drawn: FRAMED },
]

test('Mod がエージェントに宛てた依頼文は、出どころに関係なく 1 行に畳む', async ($, on) => {
  const seen = world(on)
  const ui = await $.ui.mount(row({ kind: 'unclassified' }, false, REQUEST))
  expect(seen.drawn.at(-1)).toBe('[questions: ここからは、利用者との相談用に分岐した会話です。] …')
  await ui.unmount()
})

for (const one of ROWS) {
  test(one.name, async ($, on) => {
    const seen = world(on)
    const ui = await $.ui.mount(row(one.origin, one.isExpanded))
    expect(seen.drawn.at(-1)).toBe(one.drawn)
    await ui.unmount()
  })
}
