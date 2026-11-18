import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import { SESSION_CONTEXT } from './context'
import { clip, EXCERPT_MAX, formatEntry, LEDGER_DIR, parseEntries, pendingFiles, repoRelative, whyOf } from './ledger'

const pending = atom({ plugin: 'dotclaude-ledger', key: 'pending' } as const, 0)

// プロンプトの下の行に足す札の色。refs の札と同じ、目立たせない色
const SURFACE = '#30363d'
const SOFT = '#c9d1d9'

const ledgerDir = async ($: EngineInterface): Promise<string | null> => {
  const home = await $.env.get('HOME')
  return home === undefined ? null : `${home}/${LEDGER_DIR}`
}

// dotclaude のリポジトリの直下（実体のパス）。~/.claude/CLAUDE.md のリンク先から読む。
// WHY リンクから読む: リポジトリの場所をマシンごとに書かずに済む。リンクが無いマシンでは null になり、何も記録しない
const repoRoot = async ($: EngineInterface): Promise<string | null> => {
  const home = await $.env.get('HOME')
  if (home === undefined) return null
  const stat = await $.fs.stat(`${home}/.claude/CLAUDE.md`, { resolve: true }).catch(() => undefined)
  const real = stat?.realPath
  if (real === undefined) return null
  return real.slice(0, real.lastIndexOf('/'))
}

// 全セッションの記録を読み、未コミットのファイルの数を札に出す
const refresh = async ($: EngineInterface): Promise<void> => {
  const dir = await ledgerDir($)
  if (dir === null || !(await $.fs.exists(dir))) {
    await update($, pending, () => 0)
    return
  }
  const files = (await $.fs.list(dir)).filter(entry => entry.kind === 'file' && entry.name.endsWith('.jsonl'))
  const texts = await Promise.all(files.map(file => $.fs.read(`${dir}/${file.name}`).catch(() => '')))
  const count = pendingFiles(texts.flatMap(parseEntries)).length
  await update($, pending, current => (current === count ? current : count))
}

// 同じセッションの書き込みを 1 つずつ順に足す。
// WHY 順にする: ファイル全体を読んで書き直すので、並んだ呼び出しが重なると片方の行が消える
let queue: Promise<void> = Promise.resolve()

const append = ($: EngineInterface, path: string, line: string): Promise<void> => {
  queue = queue
    .then(async () => {
      const before = (await $.fs.exists(path)) ? await $.fs.read(path) : ''
      await $.fs.write(path, `${before}${line}`)
    })
    .catch(() => undefined)
  return queue
}

type Written = { tool: string; filePath: string; text: string; agentId: string | undefined }

// 書き込みが dotclaude の作業コピーに入ったなら、記録に 1 行足す
const record = async ($: EngineInterface, written: Written): Promise<void> => {
  const root = await repoRoot($)
  const dir = await ledgerDir($)
  if (root === null || dir === null) return
  const stat = await $.fs.stat(written.filePath, { resolve: true }).catch(() => undefined)
  const real = stat?.realPath
  if (real === undefined) return
  const file = repoRelative(real, root)
  if (file === null) return
  const session = await $.session.id()
  const found = written.agentId === undefined ? await $.session.messages() : await $.session.messages({ agentId: written.agentId })
  const why = 'deny' in found ? '' : whyOf(found, written.agentId !== undefined)
  await append(
    $,
    `${dir}/${session}.jsonl`,
    formatEntry({
      at: new Date(await $.clock.now()).toISOString(),
      session,
      ...(written.agentId === undefined ? {} : { agentId: written.agentId }),
      cwd: await $.session.cwd(),
      tool: written.tool,
      file,
      excerpt: clip(written.text, EXCERPT_MAX),
      why,
    }),
  )
  await refresh($)
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    // WHY catch: 記録を読めなくても、セッションは始める
    await refresh($).catch(() => undefined)
    return next(e)
  })

  on('classic.SessionStart', async (_$, e, next) => {
    const result = await next(e)
    if (e.agent_id !== undefined) return result
    return { ...result, additionalContext: [...(result.additionalContext ?? []), SESSION_CONTEXT] }
  }).catch((_$, e, next) => next(e))

  // WHY ツールの後に記録する: 失敗した書き込み（old_string が見つからない、など）は記録しない
  on('tool.call', { tool: 'Edit' }, async ($, e, next) => {
    const ran = await next(e)
    if (e.tool !== 'Edit' || ran.deny !== undefined || ran.isError === true) return ran
    await record($, { tool: e.tool, filePath: e.file_path, text: e.new_string, agentId: e.agentId })
    return ran
    // WHY catch: 記録できなくても、ツールの結果はそのまま返す
  }).catch(($, e, next) => next(e))

  on('tool.call', { tool: 'Write' }, async ($, e, next) => {
    const ran = await next(e)
    if (e.tool !== 'Write' || ran.deny !== undefined || ran.isError === true) return ran
    await record($, { tool: e.tool, filePath: e.file_path, text: e.content, agentId: e.agentId })
    return ran
  }).catch(($, e, next) => next(e))

  // ほかのセッションの書き込みと、dotclaude-sync がコミットして消した記録を、ターンの終わりに読み直す
  on('turn.complete', async ($, e, next) => {
    if (e.agentId === undefined) await refresh($).catch(() => undefined)
    return next(e)
  })

  // プロンプトの下の行に、未コミットのファイルの数の札を足す。下の層の右に並べる（refs と同じ作り）
  on('ui.render', { component: 'PromptHint' }, async ($, e, next) => {
    const inner = await next(e)
    if (e.surface !== 'terminal') return inner
    const count = await read($, pending)
    if (count === 0) return inner
    const { Box, Text } = $.ui.resolve(e)
    return (
      <Box flexDirection="row" columnGap={1}>
        {inner}
        <Box flexShrink={0}>
          <Text backgroundColor={SURFACE} color={SOFT}>{` dotclaude ${count} `}</Text>
        </Box>
      </Box>
    )
  }).catch((_$, e, next) => next(e))
}
