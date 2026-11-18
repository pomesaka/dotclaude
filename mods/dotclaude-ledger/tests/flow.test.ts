import { expect, test, type TestBody } from 'claude-code/testing'

import { parseEntries } from '../hooks/ledger'

type On = Parameters<TestBody>[1]

const HOME = '/Users/p'
const ROOT = '/Users/p/dotclaude'
const LEDGER = `${HOME}/.claude/dotclaude-ledger/s1.jsonl`

// ~/.claude/docs はリポジトリへのリンク。実体のパスに読み替える
const realOf = (path: string): string | undefined => {
  if (path === `${HOME}/.claude/CLAUDE.md`) return `${ROOT}/CLAUDE.md`
  if (path.startsWith(`${HOME}/.claude/docs/`)) return `${ROOT}/docs/${path.slice(`${HOME}/.claude/docs/`.length)}`
  if (path.startsWith('/')) return path
  return undefined
}

type Given = { isError?: boolean }

const world = (on: On, given: Given = {}) => {
  const files = new Map<string, string>()
  on('env.get', (_$, e) => ({ value: e.name === 'HOME' ? HOME : undefined }))
  on('session.id', () => ({ value: 's1' }))
  on('session.cwd', () => ({ value: '/Users/p/project' }))
  on('session.messages', () => ({ value: [{ role: 'user' as const, text: '学びを残して', toolUses: [] }] }))
  on('clock.now', () => ({ value: 0 }))
  on('fs.stat', (_$, e) => {
    const real = realOf(e.path)
    return { value: { kind: 'file' as const, size: 0, mtimeMs: 0, isLink: false, ...(real === undefined ? {} : { realPath: real }) } }
  })
  on('fs.exists', (_$, e) => ({ value: files.has(e.path) || e.path === `${HOME}/.claude/dotclaude-ledger` }))
  on('fs.read', (_$, e) => ({ value: files.get(e.path) ?? '' }))
  on('fs.write', (_$, e) => {
    files.set(e.path, e.text)
    return { value: undefined }
  })
  on('fs.list', () => ({ value: [...files.keys()].map(path => ({ name: path.slice(path.lastIndexOf('/') + 1), kind: 'file' as const, size: 0, mtimeMs: 0, isLink: false })) }))
  on('tool.call', () => (given.isError === true ? { isError: true as const, result: 'old_string not found', text: 'old_string not found' } : { result: '' }))
  return files
}

const CASES: { name: string; path: string; isError?: boolean; recorded: string[] }[] = [
  { name: 'リンク経由で書いた dotclaude のファイルを、リポジトリの中のパスで記録する', path: `${HOME}/.claude/docs/a.md`, recorded: ['docs/a.md'] },
  { name: 'dotclaude の外は記録しない', path: '/Users/p/project/a.md', recorded: [] },
  { name: '失敗した書き込みは記録しない', path: `${HOME}/.claude/docs/a.md`, isError: true, recorded: [] },
]

for (const one of CASES) {
  test(`Edit: ${one.name}`, async ($, on) => {
    const files = world(on, { isError: one.isError })
    await $.tool.call({ tool: 'Edit', file_path: one.path, old_string: 'a', new_string: '足した文' })
    const entries = parseEntries(files.get(LEDGER) ?? '')
    expect(entries.map(entry => entry.file)).toEqual(one.recorded)
  })
}

test('Write: 中身の頭と依頼の文と元のプロジェクトを記録する', async ($, on) => {
  const files = world(on)
  await $.tool.call({ tool: 'Write', file_path: `${HOME}/.claude/docs/b.md`, content: '新しい文書' })
  const [entry] = parseEntries(files.get(LEDGER) ?? '')
  expect(entry).toEqual({ at: '1970-01-01T00:00:00.000Z', session: 's1', cwd: '/Users/p/project', tool: 'Write', file: 'docs/b.md', excerpt: '新しい文書', why: '学びを残して' })
})
