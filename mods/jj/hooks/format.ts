// WHY 0x2E80: これ以上の文字（かな、漢字、全角記号）はターミナルで幅 2 を取る
const cells = (glyph: string): number => ((glyph.codePointAt(0) ?? 0) >= 0x2e80 ? 2 : 1)

export const cellWidth = (text: string): number => Array.from(text).reduce((sum, glyph) => sum + cells(glyph), 0)

// 桁数に収まるように末尾を切り、切ったら … を付ける
export const clip = (text: string, max: number): string => {
  if (cellWidth(text) <= max) return text
  let out = ''
  let used = 0
  for (const glyph of Array.from(text)) {
    if (used + cells(glyph) > max - 1) break
    out += glyph
    used += cells(glyph)
  }
  return `${out}…`
}
