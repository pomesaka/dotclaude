import type { Register } from 'claude-code'
import { foldedOf, isModRequest } from './rows'

// 行の左に付く印と字下げ、右の余白のぶん（桁）。目測で、測って決めた値ではない
const MARGIN = 6

export const register: Register = on => {
  // ほかの Mod が自分から送った文（devrep の催促、pr の知らせ）の行を、1 行に畳む。
  // そのままだと、エンジンの英語の枠が付いた数行が、Mod が文を送るたびに会話に出る。利用者が読む必要があるのは、何が送られたかだけ。
  // WHY 別の Mod に置く: Mod は、自分が送った文の行を描き直せない。自分の hook は呼ばれず、ほかの Mod の hook なら効く
  // （v2.1.296 の実機で、送る Mod と描き直す Mod を分けて確認）。
  // WHY asUser の文は畳まない: 利用者の操作で送った文（next-step の札、questions の回答）で、何を送ったかの記録になる。
  // Mod がエージェントに宛てた依頼文（[名前: …] で始まる。相談用に分岐した会話の最初の行など）も、同じに畳む。
  // 決まりの並んだ 20 行ほどの文で、利用者が読むものではない（2026-10-11 に利用者が指摘）。
  // WHY 開いた表示では畳まない: ctrl+o は、全文を見るための表示。
  // 描き直すのは画面の行だけで、保存される文と、モデルが読む文は変わらない。
  // 行の上の「Prompt from the <名前> plugin」の見出しは、エンジンが部品の外で描くので、消せない
  on('ui.render', { component: 'UserMessage' }, async (_$, e, next) => {
    if (e.surface !== 'terminal' || e.props.isExpanded) return next(e)
    const origin = e.props.origin
    const isUnprompted = origin.kind === 'plugin' && origin.asUser !== true
    if (!isUnprompted && !isModRequest(e.props.text)) return next(e)
    const columns = Math.max(20, (e.viewport?.columns ?? 100) - MARGIN)
    return next({ ...e, props: { ...e.props, text: foldedOf(e.props.text, columns) } })
  }).catch((_$, e, next) => next(e))
}
