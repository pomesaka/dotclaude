// 続けて落ちたら知らせる回数。
// WHY 3: 3 回直して通らないなら、見立てそのものが外れていることが多い。続けるほど、検査を緩めるか関係ない所を変える直し方に流れる
//   （https://claude.dev/blog/how-the-claude-code-team-thinks-about-verification/ の「Failing tests require human attention」、2026-11-17 に読んだ）
export const STREAK_AT = 3

// 検査の道具。名前の部分を、同じ検査かどうかの鍵にする。
// WHY コマンドの全文でなく道具で見る: 直しながら走らせ直すときは、対象のファイルやフラグを変えることが多い。全文で比べると、同じ検査の失敗が数えられない
// WHY mutate.ts を外す: 生き残りがあると 1 で終わるが、それは直す対象を見つけた結果で、検査の失敗ではない。引数の --test に検査のコマンドを含むので、先に外す
const CHECKERS: readonly RegExp[] = [
  /\bbun (?:run )?test\b/,
  /\b(?:npm|pnpm|yarn|bun) (?:run )?(?:test|lint|check|typecheck|type-check)\b/,
  /\b(?:vitest|jest|pytest|ruff|eslint|shellcheck|markdownlint(?:-cli2)?)\b/,
  /\btsc\b/,
  /\bbiome (?:check|lint|ci|format)\b/,
  /\bgo (?:test|vet)\b/,
  /\bcargo (?:test|check|clippy)\b/,
  /\bclaude plugin (?:test|validate)\b/,
  /\bscripts\/check(?:-public)?\.sh\b/,
  /\bsync\.ts check\b/,
]

// コマンドが検査なら、その道具の名前。検査でなければ null
export const checkOf = (command: string): string | null => {
  if (/\bmutate\.ts\b/.test(command)) return null
  for (const checker of CHECKERS) {
    const found = checker.exec(command)
    if (found !== null) return found[0]
  }
  return null
}

// 1 回の結果を数えに足す。落ちたら 1 増やし、通ったら消す。返すのは、その検査が続けて落ちた回数
export const counted = (counts: ReadonlyMap<string, number>, key: string, isFailed: boolean): { counts: Map<string, number>; streak: number } => {
  const next = new Map(counts)
  if (!isFailed) {
    next.delete(key)
    return { counts: next, streak: 0 }
  }
  const streak = (counts.get(key) ?? 0) + 1
  next.set(key, streak)
  return { counts: next, streak }
}

// Claude に添える文
export const noticeOf = (check: string, streak: number): string =>
  [
    `check-streak: 同じ検査（${check}）が、通らないまま ${streak} 回続けて落ちた。`,
    'これ以上は直さずに止まり、利用者を呼ぶ。原因の見立てと、ここまでに試した直し方を添えて報告する。',
    '3 回直して通らないなら、見立てそのものが外れていることが多い。続けると、検査を緩めるか関係ない所を変える直し方に流れる。',
  ].join('\n')
