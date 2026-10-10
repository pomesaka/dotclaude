import { expect, test } from 'claude-code/testing'
import type { EditOutcome, HumanEditBackend } from '../hooks/backend'
import { pickEditor } from '../hooks/editor'
import { createGate, hasChanged, parseInput, runHumanEdit, type FileSnapshot, type HumanEditDeps, type HumanEditResult } from '../hooks/human-edit'

const ROOT = '/project'

type FakeFile = { content: string; mtimeMs: number }

/** 実FSの代わり。`links`はsymlinkの実体パス（祖先ディレクトリ単位） */
const fakeDeps = (options: {
  files?: Record<string, FakeFile>
  links?: Record<string, string>
  edit?: (files: Map<string, FakeFile>) => EditOutcome | Promise<EditOutcome>
  isInsideTmux?: boolean
}): HumanEditDeps & { files: Map<string, FakeFile>; editCalls: number } => {
  const files = new Map(Object.entries(options.files ?? {}))
  const dirs = new Set(['/', ROOT])
  const links = options.links ?? {}
  const state = { editCalls: 0 }
  const backend: HumanEditBackend = {
    name: 'fake',
    edit: async () => {
      state.editCalls++
      return (options.edit ?? (() => ({ kind: 'exited', exitCode: 0 })))(files)
    },
  }
  return {
    root: ROOT,
    isInsideTmux: options.isInsideTmux ?? true,
    editor: 'nvim',
    backend,
    files,
    get editCalls() {
      return state.editCalls
    },
    exists: async p => files.has(p) || dirs.has(p) || p in links,
    realPath: async p => links[p] ?? p,
    snapshot: async (p): Promise<FileSnapshot> => {
      const f = files.get(p)
      return f === undefined
        ? { exists: false }
        : { exists: true, kind: 'file', size: f.content.length, mtimeMs: f.mtimeMs, hash: f.content }
    },
  }
}

const signal = () => new AbortController().signal

const RESULT_CASES: {
  name: string
  files: Record<string, FakeFile>
  edit: (fs: Map<string, FakeFile>) => EditOutcome
  want: HumanEditResult
}[] = [
  {
    name: 'file changed',
    files: { '/project/.env': { content: 'A=', mtimeMs: 1 } },
    edit: (fs: Map<string, FakeFile>): EditOutcome => {
      fs.set('/project/.env', { content: 'A=1', mtimeMs: 2 })
      return { kind: 'exited', exitCode: 0 }
    },
    want: { status: 'completed', path: '.env', changed: true },
  },
  {
    name: 'saved without changes (mtime moved, content same)',
    files: { '/project/.env': { content: 'A=', mtimeMs: 1 } },
    edit: (fs: Map<string, FakeFile>): EditOutcome => {
      fs.set('/project/.env', { content: 'A=', mtimeMs: 2 })
      return { kind: 'exited', exitCode: 0 }
    },
    want: { status: 'completed', path: '.env', changed: false },
  },
  {
    name: 'new file created',
    files: {},
    edit: (fs: Map<string, FakeFile>): EditOutcome => {
      fs.set('/project/.env', { content: 'A=1', mtimeMs: 2 })
      return { kind: 'exited', exitCode: 0 }
    },
    want: { status: 'completed', path: '.env', changed: true },
  },
  {
    name: 'pane closed without exit code',
    files: { '/project/.env': { content: 'A=', mtimeMs: 1 } },
    edit: (): EditOutcome => ({ kind: 'cancelled' }),
    want: { status: 'cancelled', path: '.env' },
  },
]

for (const c of RESULT_CASES) {
  test(`runHumanEdit: ${c.name}`, async () => {
    const deps = fakeDeps({ files: c.files, edit: c.edit })
    const got = await runHumanEdit(deps, createGate(), { path: '.env' }, signal())
    expect(got).toEqual({ ok: true, result: c.want })
  })
}

const ERROR_CASES: {
  name: string
  input: string
  links: Record<string, string>
  isInsideTmux: boolean
  error: string
  exitCode: number
}[] = [
  { name: 'editor failure', input: '.env', links: {}, isInsideTmux: true, error: 'human_edit failed: editor exited with code 1', exitCode: 1 },
  { name: 'outside tmux', input: '.env', links: {}, isInsideTmux: false, error: 'human_edit failed: human_edit requires Claude Code to run inside tmux', exitCode: 0 },
  { name: 'parent escape', input: '../x', links: {}, isInsideTmux: true, error: 'human_edit failed: ../x is outside the project root', exitCode: 0 },
  { name: 'symlink outside', input: 'link/secret', links: { '/project/link': '/etc' }, isInsideTmux: true, error: 'human_edit failed: link/secret resolves outside the project root', exitCode: 0 },
]

for (const c of ERROR_CASES) {
  test(`runHumanEdit errors: ${c.name}`, async () => {
    const deps = fakeDeps({ links: c.links, isInsideTmux: c.isInsideTmux, edit: () => ({ kind: 'exited', exitCode: c.exitCode }) })
    const got = await runHumanEdit(deps, createGate(), { path: c.input }, signal())
    expect(got).toEqual({ ok: false, error: c.error })
  })
}

// 親ディレクトリが無いと、editorは開けても保存できない。開く前に失敗させる。
// dirs は、実在するディレクトリ（プロジェクトのルートのほかに足すもの）
const MISSING_PARENT_CASES: { name: string; input: string; dirs: string[]; error: string }[] = [
  {
    name: 'the parent directory is missing',
    input: 'tmp/x.txt',
    dirs: [],
    error: 'human_edit failed: tmp/x.txt cannot be created: the directory tmp/ does not exist',
  },
  {
    name: 'several levels are missing: the first missing one is named',
    input: 'tmp/new/x.txt',
    dirs: [],
    error: 'human_edit failed: tmp/new/x.txt cannot be created: the directory tmp/ does not exist',
  },
  {
    name: 'only the deepest directory is missing',
    input: 'tmp/new/x.txt',
    dirs: ['/project/tmp'],
    error: 'human_edit failed: tmp/new/x.txt cannot be created: the directory tmp/new/ does not exist',
  },
]

for (const c of MISSING_PARENT_CASES) {
  test(`runHumanEdit: ${c.name}, so no editor opens`, async () => {
    // WHY links: fakeDepsは、linksにあるパスを「実在する」と答える。自分自身を指させて、実在するディレクトリにする
    const deps = fakeDeps({ links: Object.fromEntries(c.dirs.map(dir => [dir, dir])) })
    const got = await runHumanEdit(deps, createGate(), { path: c.input }, signal())
    expect(got).toEqual({ ok: false, error: c.error })
    expect(deps.editCalls).toBe(0)
  })
}

test('runHumanEdit: a new file in an existing directory is allowed', async () => {
  const deps = fakeDeps({ links: { '/project/tmp': '/project/tmp' } })
  const got = await runHumanEdit(deps, createGate(), { path: 'tmp/x.txt' }, signal())
  expect(got).toEqual({ ok: true, result: { status: 'completed', path: 'tmp/x.txt', changed: false } })
  expect(deps.editCalls).toBe(1)
})

test('runHumanEdit: a symlink that stays inside the root is allowed', async () => {
  const deps = fakeDeps({ links: { '/project/link': '/project/real' } })
  const got = await runHumanEdit(deps, createGate(), { path: 'link/.env' }, signal())
  expect(got).toEqual({ ok: true, result: { status: 'completed', path: 'link/.env', changed: false } })
})

test('runHumanEdit: a second request while one runs is rejected without opening an editor', async () => {
  let release: (outcome: EditOutcome) => void = () => undefined
  const first = fakeDeps({ edit: () => new Promise<EditOutcome>(resolve => { release = resolve }) })
  const second = fakeDeps({})
  const gate = createGate()

  const running = runHumanEdit(first, gate, { path: 'a' }, signal())
  const rejected = await runHumanEdit(second, gate, { path: 'b' }, signal())
  expect(rejected).toEqual({ ok: false, error: 'human_edit failed: human_edit already in progress' })
  expect(second.editCalls).toBe(0)

  release({ kind: 'exited', exitCode: 0 })
  expect((await running).ok).toBe(true)
  // 終わった後は次を受け付ける
  expect((await runHumanEdit(second, gate, { path: 'b' }, signal())).ok).toBe(true)
})

const CHANGED_CASES: { name: string; before: FileSnapshot; after: FileSnapshot; want: boolean }[] = [
  { name: 'both missing', before: { exists: false }, after: { exists: false }, want: false },
  { name: 'created', before: { exists: false }, after: { exists: true, kind: 'file', size: 0, mtimeMs: 1, hash: 'x' }, want: true },
  { name: 'deleted', before: { exists: true, kind: 'file', size: 0, mtimeMs: 1, hash: 'x' }, after: { exists: false }, want: true },
  { name: 'hash equal, mtime moved', before: { exists: true, kind: 'file', size: 1, mtimeMs: 1, hash: 'x' }, after: { exists: true, kind: 'file', size: 1, mtimeMs: 2, hash: 'x' }, want: false },
  { name: 'hash differs', before: { exists: true, kind: 'file', size: 1, mtimeMs: 1, hash: 'x' }, after: { exists: true, kind: 'file', size: 1, mtimeMs: 1, hash: 'y' }, want: true },
  { name: 'no hash, mtime moved', before: { exists: true, kind: 'file', size: 1, mtimeMs: 1 }, after: { exists: true, kind: 'file', size: 1, mtimeMs: 2 }, want: true },
  { name: 'no hash, same stat', before: { exists: true, kind: 'file', size: 1, mtimeMs: 1 }, after: { exists: true, kind: 'file', size: 1, mtimeMs: 1 }, want: false },
]

for (const c of CHANGED_CASES) {
  test(`hasChanged: ${c.name}`, () => {
    expect(hasChanged(c.before, c.after)).toBe(c.want)
  })
}

const PARSE_CASES: { name: string; raw: unknown; want: unknown }[] = [
  { name: 'path only', raw: { tool: 'x', path: '.env' }, want: { path: '.env' } },
  { name: 'with instructions', raw: { path: '.env', instructions: 'set A' }, want: { path: '.env', instructions: 'set A' } },
  { name: 'missing path', raw: {}, want: 'path must be a string' },
  { name: 'bad instructions', raw: { path: '.env', instructions: 1 }, want: 'instructions must be a string' },
  { name: 'with line', raw: { path: '.env', line: 12 }, want: { path: '.env', line: 12 } },
  { name: 'with instructions and line', raw: { path: '.env', instructions: 'set A', line: 1 }, want: { path: '.env', instructions: 'set A', line: 1 } },
  { name: 'line zero', raw: { path: '.env', line: 0 }, want: 'line must be a positive integer' },
  { name: 'negative line', raw: { path: '.env', line: -3 }, want: 'line must be a positive integer' },
  { name: 'fractional line', raw: { path: '.env', line: 1.5 }, want: 'line must be a positive integer' },
  { name: 'line as an editor command', raw: { path: '.env', line: '/pattern' }, want: 'line must be a positive integer' },
  { name: 'line as a numeric string', raw: { path: '.env', line: '12' }, want: 'line must be a positive integer' },
]

for (const c of PARSE_CASES) {
  test(`parseInput: ${c.name}`, () => {
    expect(parseInput(c.raw)).toEqual(c.want)
  })
}

const EDITOR_CASES = [
  { name: 'HUMAN_EDIT_EDITOR wins', env: { HUMAN_EDIT_EDITOR: 'hx', VISUAL: 'code --wait', EDITOR: 'vim' }, want: 'hx' },
  { name: 'VISUAL over EDITOR', env: { VISUAL: 'code --wait', EDITOR: 'vim' }, want: 'code --wait' },
  { name: 'EDITOR alone', env: { EDITOR: 'vim' }, want: 'vim' },
  { name: 'blank values skipped', env: { HUMAN_EDIT_EDITOR: '  ', EDITOR: 'nano' }, want: 'nano' },
  { name: 'none: wrapper falls back', env: {}, want: '' },
]

for (const c of EDITOR_CASES) {
  test(`pickEditor: ${c.name}`, () => {
    expect(pickEditor(c.env)).toBe(c.want)
  })
}
