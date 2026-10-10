import type { DiagramEdge, DiagramNode } from './doc'

// 箱と矢印の図を、文字のマス目に配置する。
// 線と枠は Raster に描く glyph として返し、日本語を含むラベルは位置だけを返す。
// WHY 分ける: Raster には幅 1 の文字しか置けない（RasterProps）。ラベルは呼び出し側が Text を重ねて描く

export type Label = { x: number; y: number; text: string; kind: 'title' | 'note' | 'edge'; color: number }
export type Layout = { columns: number; rows: number; words: Uint32Array; labels: Label[] }

export const DEFAULT_COLOR = 0x01000000
const LINE_COLOR = 0x9aa4b2
const PALETTE = [0x6cb6ff, 0x7ee0a1, 0xe8a35c, 0xc9a0ff, 0xff9bb3, 0x5fd4d0]

const UP = 1
const DOWN = 2
const LEFT = 4
const RIGHT = 8
const LINE_GLYPHS: { [bits: number]: string } = {
  [UP]: '│',
  [DOWN]: '│',
  [UP | DOWN]: '│',
  [LEFT]: '─',
  [RIGHT]: '─',
  [LEFT | RIGHT]: '─',
  [DOWN | RIGHT]: '╭',
  [DOWN | LEFT]: '╮',
  [UP | RIGHT]: '╰',
  [UP | LEFT]: '╯',
  [UP | DOWN | RIGHT]: '├',
  [UP | DOWN | LEFT]: '┤',
  [LEFT | RIGHT | DOWN]: '┬',
  [LEFT | RIGHT | UP]: '┴',
  [UP | DOWN | LEFT | RIGHT]: '┼',
}

// WHY 0x2E80: これ以上の文字（かな、漢字、全角記号）はターミナルで幅 2 を取る。
// 図のラベルに使う範囲ではこの境界で足りる（結合文字や絵文字は扱わない）
export const cellWidth = (text: string): number =>
  Array.from(text).reduce((sum, glyph) => sum + ((glyph.codePointAt(0) ?? 0) >= 0x2e80 ? 2 : 1), 0)

// 層の中の 1 マス。node は箱、pass は層をまたぐ矢印が通り抜けるだけの場所
type Slot = { node: number | undefined; order: number; y: number; port: number }
// 矢印を層の向きにそろえたもの。循環する矢印は向きを逆にして置き、矢じりだけ元の向きに描く
type Link = { a: number; b: number; label: string; isReversed: boolean }
type Segment = { layer: number; from: Slot; to: Slot; link: Link; isFirst: boolean; isLast: boolean }

const orient = (count: number, edges: readonly { from: number; to: number; label: string }[]): Link[] => {
  const out = new Map<number, number[]>()
  for (const [index, edge] of edges.entries()) out.set(edge.from, [...(out.get(edge.from) ?? []), index])
  const state = new Array<number>(count).fill(0)
  const isBack = new Array<boolean>(edges.length).fill(false)
  const visit = (at: number) => {
    state[at] = 1
    for (const index of out.get(at) ?? []) {
      const edge = edges[index]
      if (edge === undefined) continue
      if (state[edge.to] === 1) isBack[index] = true
      else if (state[edge.to] === 0) visit(edge.to)
    }
    state[at] = 2
  }
  for (let at = 0; at < count; at++) if (state[at] === 0) visit(at)

  return edges.map((edge, index) =>
    isBack[index]
      ? { a: edge.to, b: edge.from, label: edge.label, isReversed: true }
      : { a: edge.from, b: edge.to, label: edge.label, isReversed: false },
  )
}

const layersOf = (count: number, links: readonly Link[]): number[] => {
  const layer = new Array<number | undefined>(count).fill(undefined)
  const depth = (at: number): number => {
    const known = layer[at]
    if (known !== undefined) return known
    // WHY 先に 0 を入れる: orient が循環を外しているので再入しないが、万一のとき無限再帰にしない
    layer[at] = 0
    const value = links.filter(link => link.b === at).reduce((max, link) => Math.max(max, depth(link.a) + 1), 0)
    layer[at] = value
    return value
  }
  return Array.from({ length: count }, (_, at) => depth(at))
}

export const layout = (nodes: readonly DiagramNode[], edges: readonly DiagramEdge[]): Layout => {
  const indexOf = new Map(nodes.map((node, index) => [node.id, index]))
  const links = orient(
    nodes.length,
    edges.flatMap(edge => {
      const from = indexOf.get(edge.from)
      const to = indexOf.get(edge.to)
      return from === undefined || to === undefined || from === to ? [] : [{ from, to, label: edge.label }]
    }),
  )
  const layerOf = layersOf(nodes.length, links)
  const layerCount = Math.max(0, ...layerOf) + 1

  const layers: Slot[][] = Array.from({ length: layerCount }, () => [])
  const slotOf = nodes.map((_, index) => {
    const slot: Slot = { node: index, order: 0, y: 0, port: 0 }
    layers[layerOf[index] ?? 0]?.push(slot)
    return slot
  })

  const segments: Segment[] = []
  for (const link of links) {
    const start = layerOf[link.a] ?? 0
    const end = layerOf[link.b] ?? 0
    let from = slotOf[link.a]
    const last = slotOf[link.b]
    if (from === undefined || last === undefined) continue
    for (let layer = start; layer < end; layer++) {
      const isLast = layer === end - 1
      const to: Slot = isLast ? last : { node: undefined, order: 0, y: 0, port: 0 }
      if (!isLast) layers[layer + 1]?.push(to)
      segments.push({ layer, from, to, link, isFirst: layer === start, isLast })
      from = to
    }
  }

  // 並び順: 前の層でつながっている相手の位置の平均で並べる（線の交差を減らす）
  for (const [index, slots] of layers.entries()) {
    if (index > 0) {
      const weight = new Map<Slot, number>()
      for (const [position, slot] of slots.entries()) {
        const before = segments.filter(segment => segment.to === slot).map(segment => segment.from.order)
        weight.set(slot, before.length === 0 ? position : before.reduce((sum, order) => sum + order, 0) / before.length)
      }
      slots.sort((left, right) => (weight.get(left) ?? 0) - (weight.get(right) ?? 0))
    }
    for (const [order, slot] of slots.entries()) slot.order = order
  }

  const boxHeight = nodes.some(node => node.note !== '') ? 4 : 3
  const pitch = boxHeight + 1
  const heightOf = (slots: readonly Slot[]) => slots.length * boxHeight + Math.max(0, slots.length - 1)
  const rows = Math.max(boxHeight, ...layers.map(heightOf))
  for (const slots of layers) {
    const offset = Math.floor((rows - heightOf(slots)) / 2)
    for (const slot of slots) {
      slot.y = offset + slot.order * pitch
      slot.port = slot.y + 1
    }
  }

  const widths = layers.map(slots =>
    Math.max(
      6,
      ...slots.flatMap(slot => {
        const node = slot.node === undefined ? undefined : nodes[slot.node]
        return node === undefined ? [] : [Math.max(cellWidth(node.title), cellWidth(node.note)) + 4]
      }),
    ),
  )

  // 層と層のあいだ。左から「始点側のラベル」「曲がる線が通る縦の列」「終点側のラベル」の順に取る
  type Gap = { start: number; end: number; channel: Map<Segment, number>; side: Map<Segment, 'left' | 'right'> }
  const gaps: Gap[] = []
  const xs: number[] = []
  let x = 0
  for (let layer = 0; layer < layerCount; layer++) {
    xs.push(x)
    x += widths[layer] ?? 0
    if (layer === layerCount - 1) break
    const here = segments.filter(segment => segment.layer === layer)
    const labeled = here.filter(segment => segment.isFirst && segment.link.label !== '')
    const side = new Map<Segment, 'left' | 'right'>()
    for (const segment of labeled) {
      // 同じ箱から出るラベル付きの矢印が複数あると、始点側では重なる。終点側に置く。
      // 行きと帰りのように両端が同じ矢印は終点側でも重なるので、2 本目を始点側に戻す
      const isShared = labeled.filter(other => other.from === segment.from).length > 1
      const isTaken = labeled.some(
        other => other.from === segment.from && other.to === segment.to && side.get(other) === 'right',
      )
      side.set(segment, isShared && !isTaken ? 'right' : 'left')
    }
    const widest = (which: 'left' | 'right') =>
      Math.max(0, ...labeled.filter(segment => side.get(segment) === which).map(segment => cellWidth(segment.link.label)))
    const left = widest('left')
    const right = widest('right')
    const bends = here.filter(segment => segment.from.port !== segment.to.port)
    const firstChannel = x + 1 + (left > 0 ? left + 1 : 1)
    const channel = new Map(bends.map((segment, index) => [segment, firstChannel + index]))
    const width = Math.max(5, 1 + (left > 0 ? left + 1 : 1) + bends.length + (right > 0 ? right + 1 : 1) + 1)
    gaps.push({ start: x, end: x + width - 1, channel, side })
    x += width
  }
  const columns = x

  const bits = new Uint8Array(columns * rows)
  const mark = (column: number, row: number, value: number) => {
    if (column < 0 || column >= columns || row < 0 || row >= rows) return
    const at = row * columns + column
    bits[at] = (bits[at] ?? 0) | value
  }
  const hline = (from: number, to: number, row: number) => {
    for (let column = from; column <= to; column++) {
      mark(column, row, (column > from ? LEFT : 0) | (column < to ? RIGHT : 0))
    }
  }
  const vline = (column: number, from: number, to: number) => {
    const top = Math.min(from, to)
    const bottom = Math.max(from, to)
    for (let row = top; row <= bottom; row++) mark(column, row, (row > top ? UP : 0) | (row < bottom ? DOWN : 0))
  }

  const words = new Uint32Array(columns * rows * 3)
  for (let at = 0; at < columns * rows; at++) words.set([0x20, DEFAULT_COLOR, DEFAULT_COLOR], at * 3)
  const put = (column: number, row: number, text: string, color: number) => {
    for (const [offset, glyph] of Array.from(text).entries()) {
      const target = column + offset
      if (target < 0 || target >= columns || row < 0 || row >= rows) continue
      words.set([glyph.codePointAt(0) ?? 0x20, color, DEFAULT_COLOR], (row * columns + target) * 3)
    }
  }

  const labels: Label[] = []
  const heads: { x: number; y: number; glyph: string }[] = []
  for (const segment of segments) {
    const gap = gaps[segment.layer]
    if (gap === undefined) continue
    const { from, to, link } = segment
    if (from.node === undefined) {
      const start = xs[segment.layer] ?? 0
      hline(start, start + (widths[segment.layer] ?? 0) - 1, from.port)
    }
    const column = gap.channel.get(segment)
    if (column === undefined) {
      hline(gap.start, gap.end, from.port)
    } else {
      hline(gap.start, column, from.port)
      vline(column, from.port, to.port)
      hline(column, gap.end, to.port)
    }
    if (segment.isLast && !link.isReversed) heads.push({ x: gap.end, y: to.port, glyph: '>' })
    if (segment.isFirst && link.isReversed) heads.push({ x: gap.start, y: from.port, glyph: '<' })
    const side = gap.side.get(segment)
    if (side === 'left') labels.push({ x: gap.start + 1, y: from.port - 1, text: link.label, kind: 'edge', color: LINE_COLOR })
    if (side === 'right') {
      labels.push({ x: gap.end - cellWidth(link.label), y: to.port - 1, text: link.label, kind: 'edge', color: LINE_COLOR })
    }
  }

  for (let row = 0; row < rows; row++) {
    for (let column = 0; column < columns; column++) {
      const glyph = LINE_GLYPHS[bits[row * columns + column] ?? 0]
      if (glyph !== undefined) put(column, row, glyph, LINE_COLOR)
    }
  }
  for (const head of heads) put(head.x, head.y, head.glyph, LINE_COLOR)

  for (const [layer, slots] of layers.entries()) {
    const left = xs[layer] ?? 0
    const inner = (widths[layer] ?? 6) - 2
    for (const slot of slots) {
      const node = slot.node === undefined ? undefined : nodes[slot.node]
      if (node === undefined || slot.node === undefined) continue
      const color = PALETTE[slot.node % PALETTE.length] ?? LINE_COLOR
      put(left, slot.y, `╭${'─'.repeat(inner)}╮`, color)
      for (let row = slot.y + 1; row < slot.y + boxHeight - 1; row++) put(left, row, `│${' '.repeat(inner)}│`, color)
      put(left, slot.y + boxHeight - 1, `╰${'─'.repeat(inner)}╯`, color)
      const centered = (text: string) => left + 1 + Math.max(0, Math.floor((inner - cellWidth(text)) / 2))
      labels.push({ x: centered(node.title), y: slot.y + 1, text: node.title, kind: 'title', color })
      if (node.note !== '') labels.push({ x: centered(node.note), y: slot.y + 2, text: node.note, kind: 'note', color })
    }
  }

  return { columns, rows, words, labels }
}

// テストと目視の確認用。Raster に描く glyph を行ごとの文字列に戻す
export const toLines = (result: Layout): string[] =>
  Array.from({ length: result.rows }, (_, row) =>
    Array.from({ length: result.columns }, (_, column) =>
      String.fromCodePoint(result.words[(row * result.columns + column) * 3] ?? 0x20),
    )
      .join('')
      .trimEnd(),
  )

const BASE64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'

// WHY 自前: 型定義の例は Uint8Array.prototype.toBase64 を使うが、
// 同じ型定義が指定する lib (es2023) には宣言が無く、型検査を通らない（v2.1.295 で確認）
const toBase64 = (bytes: Uint8Array): string => {
  let out = ''
  for (let at = 0; at < bytes.length; at += 3) {
    const a = bytes[at] ?? 0
    const b = bytes[at + 1] ?? 0
    const c = bytes[at + 2] ?? 0
    const triple = (a << 16) | (b << 8) | c
    out += BASE64.charAt((triple >> 18) & 63)
    out += BASE64.charAt((triple >> 12) & 63)
    out += at + 1 < bytes.length ? BASE64.charAt((triple >> 6) & 63) : '='
    out += at + 2 < bytes.length ? BASE64.charAt(triple & 63) : '='
  }
  return out
}

// RasterProps の cells: little-endian の u32 を 3 つずつ（文字、前景色、背景色）並べた base64
export const cellsOf = (result: Layout): string =>
  toBase64(new Uint8Array(result.words.buffer, result.words.byteOffset, result.words.byteLength))
