// WHY 0x2E80: これ以上の文字（かな、漢字、全角記号）はターミナルで幅 2 を取る
const cells = (glyph: string): number => ((glyph.codePointAt(0) ?? 0) >= 0x2e80 ? 2 : 1)

export const cellWidth = (text: string): number => Array.from(text).reduce((sum, glyph) => sum + cells(glyph), 0)

// 文が、幅 width の中で何行になるかの見積もり。全角の文字が行の端で 1 桁余ることがあるので、幅を 1 桁狭く見る
export const wrappedLines = (text: string, width: number): number => Math.max(1, Math.ceil(cellWidth(text) / Math.max(1, width - 1)))

// pane の高さから、一覧に使える行数を出す。overhead は、一覧の外に描くもの（ヒントの行、あいだの空き）の行数。
// WHY +3: 上と下の「あと N 件」の 2 行と、折り返しの見積もりが 1 行ずれたときの余り
export const listRoom = (bodyRows: number, overhead: number): number => Math.max(1, bodyRows - overhead - 3)
