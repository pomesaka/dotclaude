import { expect, test } from 'claude-code/testing'
import { clampCursor, moveCursor, windowOf } from '../hooks/cursor'

const CLAMPS: { name: string; index: number; length: number; cursor: number }[] = [
  { name: '範囲の中', index: 1, length: 3, cursor: 1 },
  { name: '一覧が縮んで、範囲の外を指していた', index: 5, length: 3, cursor: 2 },
  { name: '負の数', index: -1, length: 3, cursor: 0 },
  { name: '空の一覧', index: 2, length: 0, cursor: 0 },
]

for (const one of CLAMPS) {
  test(`clampCursor: ${one.name}`, async () => {
    expect(clampCursor(one.index, one.length)).toBe(one.cursor)
  })
}

const MOVES: { name: string; index: number; delta: number; length: number; cursor: number }[] = [
  { name: '下へ', index: 0, delta: 1, length: 3, cursor: 1 },
  { name: '上へ', index: 2, delta: -1, length: 3, cursor: 1 },
  { name: '末尾では下へ動かない', index: 2, delta: 1, length: 3, cursor: 2 },
  { name: '先頭では上へ動かない', index: 0, delta: -1, length: 3, cursor: 0 },
  { name: '範囲の外を指していたら、収めてから動かす', index: 9, delta: -1, length: 3, cursor: 1 },
  { name: '空の一覧', index: 0, delta: 1, length: 0, cursor: 0 },
]

for (const one of MOVES) {
  test(`moveCursor: ${one.name}`, async () => {
    expect(moveCursor(one.index, one.delta, one.length)).toBe(one.cursor)
  })
}

// heights は各行の高さ。range は、描く行の範囲（start 以上、end 未満）
const WINDOWS: { name: string; heights: number[]; cursor: number; room: number; gap: number; range: { start: number; end: number } }[] = [
  { name: '全部収まる', heights: [1, 1, 1], cursor: 0, room: 10, gap: 0, range: { start: 0, end: 3 } },
  { name: '先頭を選んでいれば、先頭から収まる分', heights: [1, 1, 1, 1, 1], cursor: 0, room: 3, gap: 0, range: { start: 0, end: 3 } },
  { name: '末尾を選んでいれば、末尾までの収まる分', heights: [1, 1, 1, 1, 1], cursor: 4, room: 3, gap: 0, range: { start: 2, end: 5 } },
  { name: '途中を選んでいれば、その前後', heights: [1, 1, 1, 1, 1, 1, 1], cursor: 3, room: 3, gap: 0, range: { start: 2, end: 5 } },
  { name: '行のあいだの空きも数える', heights: [3, 3, 3, 3], cursor: 0, room: 7, gap: 1, range: { start: 0, end: 2 } },
  // 選んでいる行（高さ 1）の下（高さ 3）が先に入り、余地を使い切る。上（高さ 2）は入らない
  { name: '高さの違う行。下を先に入れ、入らなくなったら止める', heights: [2, 1, 3, 1], cursor: 1, room: 4, gap: 0, range: { start: 1, end: 3 } },
  // 下（高さ 3）が入らないときは、上（高さ 2）を入れる。入らない行を飛ばして、その先の行を出すことはしない
  { name: '下が入らなければ、上を入れる', heights: [2, 1, 3, 1], cursor: 1, room: 3, gap: 0, range: { start: 0, end: 2 } },
  { name: '選んでいる行だけで収まらなくても、その行は描く', heights: [1, 9, 1], cursor: 1, room: 3, gap: 0, range: { start: 1, end: 2 } },
  { name: '範囲の外を指していたら、収めてから決める', heights: [1, 1, 1], cursor: 9, room: 2, gap: 0, range: { start: 1, end: 3 } },
  { name: '空の一覧', heights: [], cursor: 0, room: 5, gap: 0, range: { start: 0, end: 0 } },
]

for (const one of WINDOWS) {
  test(`windowOf: ${one.name}`, async () => {
    expect(windowOf(one.heights, one.cursor, one.room, one.gap)).toEqual(one.range)
  })
}
