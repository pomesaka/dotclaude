import type { Register } from 'claude-code'

import { isStray, noticeOf, parentOf } from './path'

export const register: Register = on => {
  // Claude が Write で、作業ディレクトリの外に新しいフォルダを作って書いたら、パスの写し間違いでないかを結果に添えて伝える。
  // WHY 止めずに知らせる: 作業ディレクトリの外に書くのは、ほかのリポジトリの文書（dotclaude など）でもふつうにある。
  //   止めると正しい書き込みまで往復が増える。写し間違いかは、パスを見た Claude が決める
  // WHY: claude-deck のワークスペースのパスは - と / が並び、1 文字違えた Write がワークスペースの外にフォルダを作って成功した（2026-11）
  on('tool.call', { tool: 'Write' }, async ($, e, next) => {
    if (e.tool !== 'Write') return next(e)
    const hasParent = await $.fs.exists(parentOf(e.file_path))
    const ran = await next(e)
    if (ran.deny !== undefined || ran.isError === true) return ran
    const cwd = await $.session.cwd()
    const home = await $.env.get('HOME')
    const temps = ['/tmp', '/private/tmp', ...(home === null ? [] : [`${home}/.claude/tmp`])]
    if (!isStray(e.file_path, hasParent, cwd, temps)) return ran
    return { ...ran, context: [...(ran.context ?? []), noticeOf(e.file_path, cwd)] }
    // WHY catch: 調べられなくても、書いた結果はそのまま返す
  }).catch((_$, e, next) => next(e))
}
