import type { Register } from 'claude-code'

import { STREAK_AT, checkOf, counted, noticeOf } from './streak'

// 検査ごとの、続けて落ちた回数。鍵は「エージェント（メインは空）と道具の名前」。
// WHY モジュール変数でよい: 読み込み直しで消えても、数え直すだけで済む
// WHY エージェントごとに分ける: サブエージェントの検査の失敗を、メインの作業の失敗に数えない
let counts = new Map<string, number>()

export const register: Register = on => {
  // Claude が同じ検査を、通らないまま 3 回続けて落としたら、それ以上直さずに利用者を呼ぶよう、結果に添えて伝える。
  // WHY 文書でなく Mod: 「3 回で止まる」は文書に書いても、直している最中のモデルは自分の回数を数えない
  on('tool.call', { tool: 'Bash' }, async (_$, e, next) => {
    const ran = await next(e)
    if (e.tool !== 'Bash' || e.run_in_background === true || ran.deny !== undefined) return ran
    const check = checkOf(e.command)
    if (check === null) return ran
    const result = counted(counts, `${e.agentId ?? ''}\n${check}`, ran.isError === true)
    counts = result.counts
    if (result.streak < STREAK_AT) return ran
    return { ...ran, context: [...(ran.context ?? []), noticeOf(check, result.streak)] }
    // WHY catch: 数えられなくても、コマンドの結果はそのまま返す
  }).catch((_$, e, next) => next(e))
}
