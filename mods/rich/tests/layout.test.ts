import { expect, test } from 'claude-code/testing'
import type { DiagramEdge, DiagramNode } from '../hooks/doc'
import { cellWidth, layout, toLines } from '../hooks/layout'

const node = (id: string, title = id, note = ''): DiagramNode => ({ id, title, note })
const edge = (from: string, to: string, label = ''): DiagramEdge => ({ from, to, label })

type Case = { name: string; nodes: DiagramNode[]; edges: DiagramEdge[]; lines: string[]; labels: string[] }

// lines は Raster に描く枠と線だけ。日本語を含むラベルは labels に「x,y 文字」で別に出る
const CASES: Case[] = [
  {
    name: '一列につながる箱は左から右へ並び、ラベルは矢印の上に出る',
    nodes: [node('a', 'Claude', '中身を決める'), node('b', 'Mod'), node('c', 'Pane')],
    edges: [edge('a', 'b', 'データ'), edge('b', 'c')],
    lines: [
      '╭──────────────╮          ╭─────╮     ╭──────╮',
      '│              │─────────>│     │────>│      │',
      '│              │          │     │     │      │',
      '╰──────────────╯          ╰─────╯     ╰──────╯',
    ],
    labels: ['17,0 データ', '5,1 Claude', '2,2 中身を決める', '28,1 Mod', '40,1 Pane'],
  },
  {
    name: '1 つの箱から 2 本出ると線が分かれ、ラベルは終点側に出る',
    nodes: [node('a'), node('b'), node('c'), node('d')],
    edges: [edge('a', 'b', 'x'), edge('a', 'c', 'y'), edge('b', 'd'), edge('c', 'd')],
    lines: [
      '             ╭────╮',
      '        ╭───>│    │──╮',
      '╭────╮  │    ╰────╯  │   ╭────╮',
      '│    │──┴╮           ╰┬─>│    │',
      '╰────╯   │   ╭────╮   │  ╰────╯',
      '         ╰──>│    │───╯',
      '             ╰────╯',
    ],
    labels: ['11,0 x', '11,4 y', '2,3 a', '15,1 b', '15,5 c', '27,3 d'],
  },
  {
    name: '層を飛び越える矢印は、あいだの層を通り抜ける',
    nodes: [node('a'), node('b'), node('c')],
    edges: [edge('a', 'b'), edge('b', 'c'), edge('a', 'c', 'skip')],
    lines: [
      '                ╭────╮',
      '            ╭──>│    │──╮',
      '╭────╮      │   ╰────╯  │   ╭────╮',
      '│    │──────┴╮          ╰┬─>│    │',
      '╰────╯       │           │  ╰────╯',
      '             ╰───────────╯',
      '',
    ],
    labels: ['7,2 skip', '2,3 a', '18,1 b', '30,3 c'],
  },
  {
    name: '行きと帰りの矢印は両端に矢じりが付き、ラベルは重ならない',
    nodes: [node('a'), node('b')],
    edges: [edge('a', 'b', 'go'), edge('b', 'a', 'back')],
    lines: ['╭────╮          ╭────╮', '│    │<────────>│    │', '╰────╯          ╰────╯'],
    labels: ['13,0 go', '7,0 back', '2,1 a', '18,1 b'],
  },
  {
    name: '矢印の無い箱は縦に並ぶ',
    nodes: [node('a'), node('b')],
    edges: [],
    lines: ['╭────╮', '│    │', '╰────╯', '', '╭────╮', '│    │', '╰────╯'],
    labels: ['2,1 a', '2,5 b'],
  },
]

for (const one of CASES) {
  test(one.name, async () => {
    const result = layout(one.nodes, one.edges)
    expect(toLines(result)).toEqual(one.lines)
    expect(result.labels.map(label => `${label.x},${label.y} ${label.text}`)).toEqual(one.labels)
  })
}

const WIDTHS: { text: string; width: number }[] = [
  { text: 'Mod', width: 3 },
  { text: '部品', width: 4 },
  { text: 'SVGをPNGに', width: 10 },
  { text: '', width: 0 },
]

for (const one of WIDTHS) {
  test(`cellWidth("${one.text}") は全角を 2 桁に数える`, async () => {
    expect(cellWidth(one.text)).toBe(one.width)
  })
}
