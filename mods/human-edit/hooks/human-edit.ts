import type { HumanEditBackend } from './backend'
import { isInside, resolveLexical, splitAtExisting } from './paths'

export type HumanEditInput = { path: string; instructions?: string; line?: number }

export type HumanEditResult =
  | { status: 'completed'; path: string; changed: boolean }
  | { status: 'cancelled'; path: string }

export type HumanEditOutcome =
  | { ok: true; result: HumanEditResult }
  | { ok: false; error: string }

export type FileSnapshot =
  | { exists: false }
  | { exists: true; kind: 'file' | 'dir' | 'other'; size: number; mtimeMs: number; hash?: string }

export type HumanEditDeps = {
  root: string
  isInsideTmux: boolean
  editor: string
  backend: HumanEditBackend
  exists: (path: string) => Promise<boolean>
  /** symlinkと`..`を解いた実体パス。解けなければundefined */
  realPath: (path: string) => Promise<string | undefined>
  snapshot: (path: string) => Promise<FileSnapshot>
}

/**
 * WHY hashがあればhashだけで比べる: `:wq`は内容が同じでもmtimeを更新するので、
 * mtimeを見ると「保存しただけ」をchanged=trueと誤報する。hashが取れない（4 MiB超）ときだけsize + mtime。
 */
export const hasChanged = (before: FileSnapshot, after: FileSnapshot): boolean => {
  if (!before.exists || !after.exists) return before.exists !== after.exists
  if (before.hash !== undefined && after.hash !== undefined) return before.hash !== after.hash
  return before.size !== after.size || before.mtimeMs !== after.mtimeMs
}

export const parseInput = (raw: unknown): HumanEditInput | string => {
  if (typeof raw !== 'object' || raw === null) return 'input must be an object'
  const path: unknown = Reflect.get(raw, 'path')
  const instructions: unknown = Reflect.get(raw, 'instructions')
  if (typeof path !== 'string') return 'path must be a string'
  if (instructions !== undefined && typeof instructions !== 'string') return 'instructions must be a string'
  const line: unknown = Reflect.get(raw, 'line')
  // WHY 整数だけ: editorの引数（+N）として渡す。数字以外を通すと、editorのコマンド（+/pattern、+cmd）として解釈される
  if (line !== undefined && (typeof line !== 'number' || !Number.isInteger(line) || line < 1)) return 'line must be a positive integer'
  return {
    path,
    ...(instructions === undefined ? {} : { instructions }),
    ...(line === undefined ? {} : { line }),
  }
}

const fail = (error: string): HumanEditOutcome => ({ ok: false, error: `human_edit failed: ${error}` })

/** 同時に1件だけ。WHY: 複数paneと複数の待機中tool callの対応付けをMVPでは持たない */
export const createGate = () => {
  let active: string | undefined
  return {
    tryEnter: (path: string): boolean => {
      if (active !== undefined) return false
      active = path
      return true
    },
    leave: (): void => {
      active = undefined
    },
  }
}

export type Gate = ReturnType<typeof createGate>

export const runHumanEdit = async (
  deps: HumanEditDeps,
  gate: Gate,
  input: HumanEditInput,
  signal: AbortSignal,
): Promise<HumanEditOutcome> => {
  if (!deps.isInsideTmux) return fail('human_edit requires Claude Code to run inside tmux')

  const lexical = resolveLexical(deps.root, input.path)
  if (!lexical.ok) return fail(lexical.reason)

  const realRoot = await deps.realPath(deps.root)
  if (realRoot === undefined) return fail('could not resolve the project root')
  const { existing, rest } = await splitAtExisting(lexical.absolute, deps.exists)
  const realExisting = await deps.realPath(existing)
  if (realExisting === undefined) return fail(`could not resolve ${input.path}`)
  const landing = [realExisting, ...rest].join('/')
  if (!isInside(realRoot, landing)) return fail(`${input.path} resolves outside the project root`)
  // WHY editorを開く前に失敗させる: 親ディレクトリが無いと、editorは開くが保存できない（vimのE212）。
  // 利用者が、書いた内容を持ったまま行き場を失う（2026-10-09に実機で起きた）。
  // WHY NOT ディレクトリを作る: pathの打ち間違いにもディレクトリができる。作るか、pathを直すかは、エラーを読んだ呼び出し側が決める。
  // restは「まだ無い部分」。ファイル名だけなら1つ。2つ以上なら、無いディレクトリを含む
  if (rest.length > 1) {
    const missing = lexical.relative.split('/').slice(0, 1 - rest.length).join('/')
    return fail(`${input.path} cannot be created: the directory ${missing}/ does not exist`)
  }

  if (!gate.tryEnter(lexical.relative)) return fail('human_edit already in progress')
  try {
    const before = await deps.snapshot(lexical.absolute)
    if (before.exists && before.kind !== 'file') return fail(`${input.path} is not a regular file`)
    const outcome = await deps.backend.edit(
      { absolutePath: lexical.absolute, cwd: deps.root, editor: deps.editor, instructions: input.instructions, line: input.line },
      signal,
    )
    if (outcome.kind === 'cancelled') {
      return { ok: true, result: { status: 'cancelled', path: lexical.relative } }
    }
    if (outcome.exitCode !== 0) return fail(`editor exited with code ${outcome.exitCode}`)
    const after = await deps.snapshot(lexical.absolute)
    return { ok: true, result: { status: 'completed', path: lexical.relative, changed: hasChanged(before, after) } }
  } finally {
    gate.leave()
  }
}
