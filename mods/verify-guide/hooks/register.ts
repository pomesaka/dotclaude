import type { EngineInterface, Register } from 'claude-code'

import { isGuide, isLaunch, noticeOf } from './launch'

// 伝え終えたリポジトリ。1 つのセッションで、リポジトリごとに 1 回だけ伝える。
// WHY モジュール変数でよい: 読み込み直しで消えても、もう 1 回伝えるだけで済む
const told = new Set<string>()

const rootOf = async ($: EngineInterface): Promise<string | null> => {
  const cwd = await $.session.cwd()
  for (const argv of [
    ['jj', 'root'],
    ['git', 'rev-parse', '--show-toplevel'],
  ]) {
    const ran = await $.process.run(argv, { cwd, timeoutMs: 5_000 }).catch(() => null)
    if (ran !== null && ran.exitCode === 0 && ran.stdout.trim() !== '') return ran.stdout.trim()
  }
  return null
}

// リポジトリの直下の .claude/skills/ にある手順書の候補
const guidesIn = async ($: EngineInterface, root: string): Promise<string[]> => {
  const dir = `${root}/.claude/skills`
  if (!(await $.fs.exists(dir))) return []
  const entries = await $.fs.list(dir)
  return entries.filter(entry => isGuide(entry.name)).map(entry => `.claude/skills/${entry.name}/SKILL.md`)
}

export const register: Register = on => {
  // アプリを起動した Bash の結果に、手順書の有無を添えて Claude に渡す。
  // WHY ツールの結果に添える: その場で読まれ、ターンを始めない。会話の行にも出ない
  on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
    const ran = await next(e)
    if (e.tool !== 'Bash' || !isLaunch(e.command)) return ran
    if (ran.deny !== undefined || ran.isError === true) return ran
    const root = await rootOf($)
    if (root === null || told.has(root)) return ran
    told.add(root)
    const notice = noticeOf(await guidesIn($, root))
    return { ...ran, context: [...(ran.context ?? []), notice] }
    // WHY catch: 手順書を探せなくても、コマンドの結果はそのまま返す
  }).catch(($, e, next) => next(e))
}
