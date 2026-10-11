// プラグインが送った文の行を、1 行に畳む。

// エンジンが、プラグインの文の前後に足す枠（v2.1.296 の実機で確認）。
// 前は「The <名前> plugin sent a message:」の 1 行、後ろは「This is how Claude Code surfaces a prompt a plugin submits …」の段落
const FRAME_HEAD = /^The .+ plugin sent a message:\s*\n/
const FRAME_TAIL = /\n\s*This is how Claude Code surfaces a prompt a plugin submits[\s\S]*$/

// エンジンの枠を除いた、プラグインが送った文そのもの。枠が無ければ、そのまま
export const bodyOf = (text: string): string => text.replace(FRAME_HEAD, '').replace(FRAME_TAIL, '').trim()

// WHY 0x2E80: これ以上の文字（かな、漢字、全角記号）はターミナルで幅 2 を取る
const cells = (glyph: string): number => ((glyph.codePointAt(0) ?? 0) >= 0x2e80 ? 2 : 1)

// 文の最初の行を、max 桁に収まるように切る。切ったか、続きの行があれば、末尾に … を付ける
export const foldedOf = (text: string, max: number): string => {
  const lines = bodyOf(text)
    .split('\n')
    .map(line => line.trim())
    .filter(line => line !== '')
  const first = lines[0] ?? ''
  let out = ''
  let used = 0
  for (const glyph of Array.from(first)) {
    if (used + cells(glyph) > max - 1) return `${out}…`
    out += glyph
    used += cells(glyph)
  }
  return lines.length > 1 ? `${out} …` : out
}

// Mod が、エージェントに宛てて書いた依頼文か。[<Mod の名前>: …] で始める決まりにしている
// （questions の相談の依頼、next-step の問い合わせ）。利用者が打つ文は、この形で始まらない
export const isModRequest = (text: string): boolean => /^\[[a-z][a-z0-9-]*: /.test(text.trimStart())
