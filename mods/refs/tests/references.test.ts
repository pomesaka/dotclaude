import { expect, test } from 'claude-code/testing'
import { addReference, canOpen, headingOf, isWebUrl, pageOf, parseReference, referencesOf, servedOf, toMarkdown } from '../hooks/references'
import type { Reference } from '../types'

const DOCS: Reference = { url: 'https://example.com/docs', title: 'Mods reference', note: 'ui.render の戻り値の形' }
const BARE: Reference = { url: 'https://example.com/docs', title: '', note: '' }
const FILE: Reference = { url: '/Users/p/notes/design.md', title: '設計メモ', note: '' }
const OTHER: Reference = { url: 'https://example.com/other', title: 'Other', note: '' }

const INPUTS: { name: string; input: unknown; parsed: Reference | string }[] = [
  { name: '題名と一言つき', input: { url: 'https://example.com/docs', title: 'Mods reference', note: 'ui.render の戻り値の形' }, parsed: DOCS },
  { name: '前後の空白は落とす', input: { url: ' https://example.com/docs ', title: ' Mods reference ', note: ' ui.render の戻り値の形 ' }, parsed: DOCS },
  { name: 'url だけ', input: { url: 'https://example.com/docs' }, parsed: BARE },
  { name: 'ファイルのパス', input: { url: '/Users/p/notes/design.md', title: '設計メモ' }, parsed: FILE },
  { name: 'url が無い', input: { title: 'x' }, parsed: 'url must be a non-empty string (a URL or a file path)' },
  { name: 'url が空白だけ', input: { url: '  ' }, parsed: 'url must be a non-empty string (a URL or a file path)' },
  { name: 'url が文字列でない', input: { url: 3 }, parsed: 'url must be a non-empty string (a URL or a file path)' },
  { name: '題名が文字列でない', input: { url: 'https://example.com', title: 3 }, parsed: 'title must be a string' },
  { name: '一言が文字列でない', input: { url: 'https://example.com', note: ['x'] }, parsed: 'note must be a string' },
]

for (const one of INPUTS) {
  test(`parseReference: ${one.name}`, async () => {
    expect(parseReference(one.input)).toEqual(one.parsed)
  })
}

const STORED: { name: string; stored: unknown; list: Reference[] }[] = [
  { name: '保存した形', stored: [DOCS, FILE], list: [DOCS, FILE] },
  { name: '題名と一言が欠けていれば、空文字で補う', stored: [{ url: 'https://example.com/docs' }], list: [BARE] },
  { name: 'url の無い項目は飛ばす', stored: [DOCS, { title: 'x' }, 'x', null], list: [DOCS] },
  { name: 'まだ無い', stored: undefined, list: [] },
  { name: '配列でない', stored: DOCS, list: [] },
]

for (const one of STORED) {
  test(`referencesOf: ${one.name}`, async () => {
    expect(referencesOf(one.stored)).toEqual(one.list)
  })
}

// 並びは、最後に足したものが先頭
const ADDS: { name: string; list: Reference[]; added: Reference; max: number; result: Reference[] }[] = [
  { name: '新しい url は先頭に足す', list: [OTHER], added: DOCS, max: 5, result: [DOCS, OTHER] },
  { name: '同じ url は 1 つにまとめて、先頭に上げる', list: [OTHER, BARE], added: DOCS, max: 5, result: [DOCS, OTHER] },
  // WebFetch で同じ url をもう一度読んでも、Claude が足した題名と一言は消さない
  { name: '新しい側が空なら、前の題名と一言を残す', list: [OTHER, DOCS], added: BARE, max: 5, result: [DOCS, OTHER] },
  {
    name: '一言だけ足す',
    list: [{ url: DOCS.url, title: 'Mods reference', note: '' }],
    added: { url: DOCS.url, title: '', note: 'ui.render の戻り値の形' },
    max: 5,
    result: [DOCS],
  },
  { name: '上限を超えたら、古いものから落とす', list: [OTHER, FILE], added: DOCS, max: 2, result: [DOCS, OTHER] },
]

for (const one of ADDS) {
  test(`addReference: ${one.name}`, async () => {
    expect(addReference(one.list, one.added, one.max)).toEqual(one.result)
  })
}

const URLS: { url: string; isWeb: boolean }[] = [
  { url: 'https://example.com/docs', isWeb: true },
  { url: 'http://localhost:3000/', isWeb: true },
  { url: '/Users/p/notes/design.md', isWeb: false },
  { url: '~/notes/design.md', isWeb: false },
  { url: 'file:///etc/passwd', isWeb: false },
  { url: 'x-apple.systempreferences:', isWeb: false },
  { url: ' https://example.com', isWeb: false },
]

for (const one of URLS) {
  test(`isWebUrl("${one.url}")`, async () => {
    expect(isWebUrl(one.url)).toBe(one.isWeb)
  })
}

const DIFIT = `jj diffu -r '@' | mise exec -- portless difit-dotclaude sh -c 'npx difit - --clean --port "$PORT" --host 127.0.0.1 --no-open'`

const SERVED: { name: string; command: string; served: Reference | null }[] = [
  { name: 'difit を portless で開く', command: DIFIT, served: { url: 'https://difit-dotclaude.localhost', title: 'difit-dotclaude', note: 'difit で開いた差分' } },
  { name: '名前を付けて起動する', command: 'portless myapp next dev', served: { url: 'https://myapp.localhost', title: 'myapp', note: 'portless で起動したサーバー' } },
  { name: '名前の大文字は url で小文字にする', command: 'npx portless MyApp bun dev', served: { url: 'https://myapp.localhost', title: 'MyApp', note: 'portless で起動したサーバー' } },
  { name: '--name なら予約語も名前になる', command: 'portless --name list bun dev', served: { url: 'https://list.localhost', title: 'list', note: 'portless で起動したサーバー' } },
  { name: 'run --name', command: 'portless run --name api bun dev', served: { url: 'https://api.localhost', title: 'api', note: 'portless で起動したサーバー' } },
  { name: '名前を書かない起動は拾わない', command: 'mise exec -- portless', served: null },
  { name: 'run は名前を推測するので拾わない', command: 'portless run next dev', served: null },
  { name: 'サブコマンドは拾わない', command: 'sudo portless proxy start --https', served: null },
  { name: 'alias は拾わない', command: 'portless alias db 5432', served: null },
  { name: '検索の語としての portless は拾わない', command: 'rg portless docs skills', served: null },
  { name: 'portless を使わないコマンド', command: 'jj status', served: null },
]

for (const one of SERVED) {
  test(`servedOf: ${one.name}`, async () => {
    expect(servedOf(one.command)).toEqual(one.served)
  })
}

const PAGES: { name: string; path: string; page: Reference | null }[] = [
  { name: 'explain のページ', path: '/Users/p/.claude/tmp/explain/band-layout.html', page: { url: '/Users/p/.claude/tmp/explain/band-layout.html', title: 'band-layout', note: '生成した HTML' } },
  { name: 'tmp の直下', path: '/private/tmp/report.html', page: { url: '/private/tmp/report.html', title: 'report', note: '生成した HTML' } },
  { name: 'リポジトリの中の HTML は拾わない', path: '/Users/p/app/public/index.html', page: null },
  { name: 'HTML でないファイルは拾わない', path: '/Users/p/.claude/tmp/notes.md', page: null },
]

for (const one of PAGES) {
  test(`pageOf: ${one.name}`, async () => {
    expect(pageOf(one.path)).toEqual(one.page)
  })
}

const OPENABLE: { url: string; isOpenable: boolean }[] = [
  { url: 'https://example.com/docs', isOpenable: true },
  { url: '/Users/p/.claude/tmp/explain/band-layout.html', isOpenable: true },
  { url: '/Users/p/notes/design.md', isOpenable: false },
  { url: '/Applications/Calculator.app', isOpenable: false },
  { url: 'file:///tmp/x.html', isOpenable: false },
  { url: '-a Calculator.html', isOpenable: false },
  { url: 'notes/x.html', isOpenable: false },
]

for (const one of OPENABLE) {
  test(`canOpen("${one.url}")`, async () => {
    expect(canOpen(one.url)).toBe(one.isOpenable)
  })
}

const HEADINGS: { name: string; reference: Reference; heading: string }[] = [
  { name: '題名がある', reference: DOCS, heading: 'Mods reference' },
  { name: '題名が無ければ url', reference: BARE, heading: 'https://example.com/docs' },
]

for (const one of HEADINGS) {
  test(`headingOf: ${one.name}`, async () => {
    expect(headingOf(one.reference)).toBe(one.heading)
  })
}

const MARKDOWN: { name: string; list: Reference[]; text: string }[] = [
  { name: 'URL、題名、一言', list: [DOCS], text: '- [Mods reference](https://example.com/docs): ui.render の戻り値の形' },
  { name: '題名も一言も無い URL', list: [BARE], text: '- [https://example.com/docs](https://example.com/docs)' },
  { name: 'ファイルのパスは、リンクにしない', list: [FILE], text: '- 設計メモ（`/Users/p/notes/design.md`）' },
  { name: '題名の無いファイルのパス', list: [{ url: '/tmp/a.md', title: '', note: 'x' }], text: '- `/tmp/a.md`: x' },
  { name: '複数は 1 行ずつ', list: [OTHER, FILE], text: '- [Other](https://example.com/other)\n- 設計メモ（`/Users/p/notes/design.md`）' },
  { name: '空', list: [], text: '' },
]

for (const one of MARKDOWN) {
  test(`toMarkdown: ${one.name}`, async () => {
    expect(toMarkdown(one.list)).toBe(one.text)
  })
}
