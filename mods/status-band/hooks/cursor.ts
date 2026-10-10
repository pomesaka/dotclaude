// pane の一覧で、キーで選んでいる行の位置。一覧が縮んでも、範囲の外を指さないようにする

// 覚えている位置を、いまの一覧の長さに収める。空の一覧では 0
export const clampCursor = (index: number, length: number): number => Math.max(0, Math.min(index, length - 1))

// 一覧のうち、pane に収まる範囲を決める。選んでいる行は必ず入れ、その下、上の順に 1 行ずつ広げる。
// heights は各行の高さ、gap は行のあいだの空き、room は一覧に使える高さ（どれも画面の行数）。
// 返すのは、描く行の範囲（start 以上、end 未満）。
// WHY 収まる分だけ描く: 一覧の下に、キーのヒントを並べている。一覧が pane より長いと、ヒントが下へ流れて見えなくなる
// （2026-10-10 に利用者から依頼）。選んでいる行だけで room を超えるときも、その行は描く
export const windowOf = (heights: number[], cursor: number, room: number, gap: number): { start: number; end: number } => {
  if (heights.length === 0) return { start: 0, end: 0 }
  const selected = clampCursor(cursor, heights.length)
  let start = selected
  let end = selected + 1
  let used = heights[selected] ?? 0
  while (true) {
    const below = heights[end]
    const fitsBelow = below !== undefined && used + gap + below <= room
    if (below !== undefined && fitsBelow) {
      used += gap + below
      end += 1
    }
    const above = start > 0 ? heights[start - 1] : undefined
    const fitsAbove = above !== undefined && used + gap + above <= room
    if (above !== undefined && fitsAbove) {
      used += gap + above
      start -= 1
    }
    if (!fitsBelow && !fitsAbove) return { start, end }
  }
}

// 位置を delta だけ動かす。端では止まる（先頭から上へ、末尾から下へは回り込まない）
export const moveCursor = (index: number, delta: number, length: number): number => clampCursor(clampCursor(index, length) + delta, length)
