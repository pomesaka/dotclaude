import { expect, test } from 'claude-code/testing'
import { START, line, referencesPane, shortReferencesPane, world } from './world'

const TOOL = 'mcp__status-band__add_reference'
const DOCS = 'https://example.com/docs'
const FILE = '/Users/p/notes/design.md'

test('add_reference で、Claude が参照を一覧に残す。pane に題名と一言と url が出る', async ($, on) => {
  const seen = world(on)

  const called = await $.tool.call({ tool: TOOL, url: DOCS, title: 'Mods reference', note: 'ui.render の戻り値の形' })
  expect(called.result).toBe('Recorded. The references pane now lists 1.')
  expect(seen.store.get('refs:s1')).toEqual([{ url: DOCS, title: 'Mods reference', note: 'ui.render の戻り値の形' }])

  const ui = await $.ui.mount(referencesPane)
  expect(await ui.find({ type: 'Text', text: /^Mods reference$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^ui\.render の戻り値の形$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^https:\/\/example\.com\/docs$/ })).toBeDefined()

  // 題名を押すと、ブラウザで開く
  await ui.press({ key: `open-${DOCS}` })
  expect(seen.ran).toEqual([['open', DOCS]])
  await ui.unmount()
})

test('add_reference は、url の無い入力を拒む', async ($, on) => {
  const seen = world(on)

  const called = await $.tool.call({ tool: TOOL, title: 'x' })
  expect(called.deny).toBe('add_reference failed: url must be a non-empty string (a URL or a file path)')
  expect(seen.store.get('refs:s1')).toBeUndefined()
})

test('WebFetch で読んだ url は、題名も一言も無いまま一覧に入る', async ($, on) => {
  const seen = world(on)

  await $.tool.call({ tool: 'WebFetch', url: DOCS, prompt: 'x' })
  expect(seen.store.get('refs:s1')).toEqual([{ url: DOCS, title: '', note: '' }])

  // 題名が無いので、見出しが url になる。url の行は重ねて出さない
  const ui = await $.ui.mount(referencesPane)
  expect(await ui.find({ type: 'Text', text: /^https:\/\/example\.com\/docs$/ })).toBeDefined()
  await ui.unmount()
})

test('WebFetch で入った url に、あとから add_reference で一言を足せる。もう一度読んでも消えない', async ($, on) => {
  const seen = world(on)

  await $.tool.call({ tool: 'WebFetch', url: DOCS, prompt: 'x' })
  await $.tool.call({ tool: TOOL, url: DOCS, title: 'Mods reference', note: 'ui.render の戻り値の形' })
  await $.tool.call({ tool: 'WebFetch', url: DOCS, prompt: 'y' })
  expect(seen.store.get('refs:s1')).toEqual([{ url: DOCS, title: 'Mods reference', note: 'ui.render の戻り値の形' }])
})

test('remove_reference で、Claude が開けなくなった参照を外す。一覧に無い url は拒む', async ($, on) => {
  const seen = world(on)
  const REMOVE = 'mcp__status-band__remove_reference'

  await $.tool.call({ tool: TOOL, url: DOCS, title: 'Mods reference' })
  await $.tool.call({ tool: TOOL, url: FILE, title: '設計メモ' })

  const removed = await $.tool.call({ tool: REMOVE, url: DOCS })
  expect(removed.result).toBe('Removed. The references pane now lists 1.')
  expect(seen.store.get('refs:s1')).toEqual([{ url: FILE, title: '設計メモ', note: '' }])

  const missing = await $.tool.call({ tool: REMOVE, url: DOCS })
  expect(missing.deny).toBe(`remove_reference failed: ${DOCS} is not on the list`)
  expect(seen.store.get('refs:s1')).toEqual([{ url: FILE, title: '設計メモ', note: '' }])
})

test('clear_references で、Claude が一覧を空にする。空の一覧でも失敗しない', async ($, on) => {
  const seen = world(on)
  const CLEAR = 'mcp__status-band__clear_references'

  await $.tool.call({ tool: TOOL, url: DOCS, title: 'Mods reference' })
  await $.tool.call({ tool: TOOL, url: FILE, title: '設計メモ' })

  const cleared = await $.tool.call({ tool: CLEAR })
  expect(cleared.result).toBe('Cleared 2. The references pane is empty.')
  expect(seen.store.get('refs:s1')).toEqual([])

  const again = await $.tool.call({ tool: CLEAR })
  expect(again.result).toBe('Cleared 0. The references pane is empty.')
})

test('「全部外す」を押すと、一覧からも保存からも全部を外す', async ($, on) => {
  const seen = world(on, {
    stored: {
      'refs:s1': [
        { url: DOCS, title: 'Mods reference', note: '' },
        { url: FILE, title: '設計メモ', note: '' },
      ],
    },
  })
  await $.session.start(START)

  const ui = await $.ui.mount(referencesPane)
  await ui.press({ key: 'clear' })
  expect(seen.store.get('refs:s1')).toEqual([])
  expect(await ui.find({ type: 'Text', text: /^Mods reference$/ })).toBeUndefined()
  expect(await ui.find({ key: 'clear' })).toBeUndefined()
  await ui.unmount()
})

test('portless で起動した画面は、コマンドから url を作って一覧に入れる', async ($, on) => {
  const seen = world(on)

  await $.tool.call({ tool: 'Bash', command: `jj diffu | mise exec -- portless difit-app sh -c 'npx difit - --port "$PORT"'` })
  expect(seen.store.get('refs:s1')).toEqual([{ url: 'https://difit-app.localhost', title: 'difit-app', note: 'difit で開いた差分' }])
})

test('一時ディレクトリに Write した HTML は一覧に入り、pane から開ける', async ($, on) => {
  const seen = world(on)
  const page = '/Users/p/.claude/tmp/explain/band-layout.html'

  await $.tool.call({ tool: 'Write', file_path: page, content: '<p>x</p>' })
  expect(seen.store.get('refs:s1')).toEqual([{ url: page, title: 'band-layout', note: '生成した HTML' }])

  const ui = await $.ui.mount(referencesPane)
  await ui.press({ key: `open-${page}` })
  expect(seen.ran).toEqual([['open', page]])
  await ui.unmount()
})

test('ファイルのパスは、押せない文字で出す', async ($, on) => {
  world(on, { stored: { 'refs:s1': [{ url: FILE, title: '設計メモ', note: '' }] } })
  await $.session.start(START)

  const ui = await $.ui.mount(referencesPane)
  expect(await ui.find({ type: 'Text', text: /^設計メモ$/ })).toBeDefined()
  expect(await ui.find({ key: `open-${FILE}` })).toBeUndefined()
  await ui.unmount()
})

test('開き直したセッションでは、覚えている参照を戻す。別のセッションの参照は出さない', async ($, on) => {
  world(on, {
    stored: {
      'refs:s1': [{ url: DOCS, title: 'Mods reference', note: '' }],
      'refs:other': [{ url: 'https://example.com/elsewhere', title: 'Elsewhere', note: '' }],
    },
  })
  await $.session.start(START)

  const ui = await $.ui.mount(referencesPane)
  expect(await ui.find({ type: 'Text', text: /^Mods reference$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^Elsewhere$/ })).toBeUndefined()
  await ui.unmount()
})

test('× を押すと、その参照を一覧からも保存からも外す', async ($, on) => {
  const seen = world(on, {
    stored: {
      'refs:s1': [
        { url: DOCS, title: 'Mods reference', note: '' },
        { url: FILE, title: '設計メモ', note: '' },
      ],
    },
  })
  await $.session.start(START)

  const ui = await $.ui.mount(referencesPane)
  await ui.press({ key: `drop-${DOCS}` })
  expect(seen.store.get('refs:s1')).toEqual([{ url: FILE, title: '設計メモ', note: '' }])
  await ui.unmount()
})

test('a を押すと、一覧の全部を Markdown でコピーする', async ($, on) => {
  const seen = world(on, {
    stored: {
      'refs:s1': [
        { url: DOCS, title: 'Mods reference', note: 'ui.render の戻り値の形' },
        { url: FILE, title: '設計メモ', note: '' },
      ],
    },
  })
  await $.session.start(START)

  const ui = await $.ui.mount(referencesPane)
  await ui.press({ key: 'copy-all' })
  expect(seen.copied).toEqual(['- [Mods reference](https://example.com/docs): ui.render の戻り値の形\n- 設計メモ（`/Users/p/notes/design.md`）'])
  expect(seen.toasts.length).toBe(1)
  await ui.unmount()
})

test('j と k で参照を選び、y で 1 件だけコピーし、o で開き、x で外す', async ($, on) => {
  const seen = world(on, {
    stored: {
      'refs:s1': [
        { url: DOCS, title: 'Mods reference', note: 'ui.render の戻り値の形' },
        { url: 'https://example.com/other', title: 'Other', note: '' },
        { url: FILE, title: '設計メモ', note: '' },
      ],
    },
  })
  await $.session.start(START)
  const ui = await $.ui.mount(referencesPane)

  // 最初は先頭を選んでいる
  await ui.press({ key: 'copy' })
  expect(seen.copied).toEqual(['- [Mods reference](https://example.com/docs): ui.render の戻り値の形'])

  // j で 1 つ下へ
  await ui.press({ key: 'down' })
  await ui.press({ key: 'open' })
  expect(seen.ran).toEqual([['open', 'https://example.com/other']])

  // もう 1 つ下は、ファイルのパス。開くボタンは出ない
  await ui.press({ key: 'down' })
  expect(await ui.find({ key: 'open' })).toBeUndefined()

  // 末尾では、j を押しても動かない
  await ui.press({ key: 'down' })
  await ui.press({ key: 'copy' })
  expect(seen.copied.at(-1)).toBe('- 設計メモ（`/Users/p/notes/design.md`）')

  // k で 1 つ戻って、x で外す。選んでいた行が消える
  await ui.press({ key: 'up' })
  await ui.press({ key: 'drop' })
  expect(seen.store.get('refs:s1')).toEqual([
    { url: DOCS, title: 'Mods reference', note: 'ui.render の戻り値の形' },
    { url: FILE, title: '設計メモ', note: '' },
  ])
  await ui.unmount()
})

test('一覧が pane より長くても、キーのヒントは流れずに残る。はみ出した分は件数で出す', async ($, on) => {
  // 題名と url で 2 行ずつ、あいだに空きが 1 行。10 件
  const numbers = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]
  world(on, { stored: { 'refs:s1': numbers.map(number => ({ url: `https://example.com/${number}`, title: `Doc ${number}`, note: '' })) } })
  await $.session.start(START)
  // 見えている行は 14。一覧の外（ヒント、空き、あと N 件）を引いた 8 行に、参照を並べる
  const ui = await $.ui.mount(shortReferencesPane)

  expect(await ui.find({ type: 'Text', text: /^Doc 1$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^Doc 3$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^Doc 4$/ })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: /^  ↓ あと 7 件$/ })).toBeDefined()
  expect(await ui.find({ key: 'down' })).toBeDefined()
  expect(await ui.find({ key: 'copy-all' })).toBeDefined()

  for (const _ of [1, 2, 3, 4, 5]) await ui.press({ key: 'down' })
  expect(await ui.find({ type: 'Text', text: /^Doc 6$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^Doc 1$/ })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: /↑ あと/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /↓ あと/ })).toBeDefined()
  expect(await ui.find({ key: 'down' })).toBeDefined()
  await ui.unmount()
})

test('一言は、選んでいる行だけ全文を出す。ほかの行は 1 行に切る', async ($, on) => {
  const long = 'あ'.repeat(60)
  world(on, {
    stored: {
      'refs:s1': [
        { url: 'https://example.com/1', title: 'Doc 1', note: long },
        { url: 'https://example.com/2', title: 'Doc 2', note: long },
      ],
    },
  })
  await $.session.start(START)
  const ui = await $.ui.mount(referencesPane)

  const notes = await ui.findAll({ type: 'Text', text: new RegExp(`^${long}$`) })
  expect(notes.map(note => note.props.wrap)).toEqual(['wrap', 'truncate-end'])
  await ui.unmount()
})

test('最後の行を外すと、選択は 1 つ上の行に収まる', async ($, on) => {
  const seen = world(on, {
    stored: {
      'refs:s1': [
        { url: DOCS, title: 'Mods reference', note: '' },
        { url: 'https://example.com/other', title: 'Other', note: '' },
      ],
    },
  })
  await $.session.start(START)
  const ui = await $.ui.mount(referencesPane)

  await ui.press({ key: 'down' })
  await ui.press({ key: 'drop' })
  // 一覧が 1 行になった。選択は範囲の外を指さず、残った行を選ぶ
  await ui.press({ key: 'copy' })
  expect(seen.copied).toEqual(['- [Mods reference](https://example.com/docs)'])
  await ui.unmount()
})

test('参照が無ければ、その旨を出す。選ぶ操作とコピーのボタンは出さない', async ($, on) => {
  world(on)

  const ui = await $.ui.mount(referencesPane)
  expect(await ui.find({ type: 'Text', text: /まだありません/ })).toBeDefined()
  expect(await ui.find({ key: 'copy' })).toBeUndefined()
  expect(await ui.find({ key: 'copy-all' })).toBeUndefined()
  expect(await ui.find({ key: 'down' })).toBeUndefined()
  await ui.unmount()
})

// 帯の refs ボタンは、参照が 1 件以上あるときだけ出る
const BUTTONS: { name: string; stored: { [key: string]: unknown }; shows: boolean }[] = [
  { name: '参照があれば、帯に refs が出る', stored: { 'refs:s1': [{ url: DOCS, title: 'Mods reference', note: '' }] }, shows: true },
  { name: '参照が無ければ、帯に refs は出ない', stored: {}, shows: false },
]

for (const one of BUTTONS) {
  test(one.name, async ($, on) => {
    world(on, { stored: one.stored })
    await $.session.start(START)
    const ui = await $.ui.mount(line(140))

    expect((await ui.find({ key: 'refs' })) !== undefined).toBe(one.shows)
    await ui.unmount()
  })
}

test('refs を押すと、コマンドを通さずに pane を開く', async ($, on) => {
  const seen = world(on, { stored: { 'refs:s1': [{ url: DOCS, title: 'Mods reference', note: '' }] } })
  await $.session.start(START)
  const ui = await $.ui.mount(line(140))

  await ui.press({ key: 'refs' })
  expect(seen.opened).toEqual(['references'])
  expect(seen.commands).toEqual([])
  await ui.unmount()
})
