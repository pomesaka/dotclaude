import { expect, test } from 'claude-code/testing'
import { filledCells, isSameStatus, levelOf, shortPath, type Level } from '../hooks/format'
import type { Status } from '../types'

const CELLS: { percent: number; cells: number }[] = [
  { percent: 0, cells: 0 },
  { percent: 1, cells: 1 },
  { percent: 47, cells: 5 },
  { percent: 94, cells: 9 },
  { percent: 100, cells: 10 },
  { percent: 130, cells: 10 },
]

for (const one of CELLS) {
  test(`filledCells(${one.percent}) は ${one.cells} マス`, async () => {
    expect(filledCells(one.percent)).toBe(one.cells)
  })
}

const LEVELS: { percent: number; level: Level }[] = [
  { percent: 0, level: 'calm' },
  { percent: 74, level: 'calm' },
  { percent: 75, level: 'watch' },
  { percent: 89, level: 'watch' },
  { percent: 90, level: 'full' },
]

for (const one of LEVELS) {
  test(`levelOf(${one.percent}) は ${one.level}`, async () => {
    expect(levelOf(one.percent)).toBe(one.level)
  })
}

const PATHS: { name: string; path: string; home: string | undefined; max: number; short: string }[] = [
  { name: 'ホームを ~ にする', path: '/Users/p/work', home: '/Users/p', max: 32, short: '~/work' },
  { name: 'ホームそのもの', path: '/Users/p', home: '/Users/p', max: 32, short: '~' },
  { name: '収まるなら省かない', path: '/Users/p/github.com/pomesaka/dotclaude', home: '/Users/p', max: 40, short: '~/github.com/pomesaka/dotclaude' },
  { name: '長ければ途中を省き、末尾を収まるだけ残す', path: '/Users/p/github.com/pomesaka/dotclaude', home: '/Users/p', max: 24, short: '~/…/pomesaka/dotclaude' },
  { name: '最後の 1 つしか収まらない', path: '/Users/p/github.com/pomesaka/dotclaude', home: '/Users/p', max: 20, short: '~/…/dotclaude' },
  { name: '最後の 1 つも収まらなくても、それは残す', path: '/Users/p/github.com/pomesaka/dotclaude', home: '/Users/p', max: 5, short: '~/…/dotclaude' },
  { name: '名前が似ているだけの別の場所は縮めない', path: '/Users/pp/work', home: '/Users/p', max: 32, short: '/Users/pp/work' },
  { name: 'ホームが分からない', path: '/srv/app', home: undefined, max: 32, short: '/srv/app' },
]

for (const one of PATHS) {
  test(`shortPath: ${one.name}`, async () => {
    expect(shortPath(one.path, one.home, one.max)).toBe(one.short)
  })
}

const BASE: Status = { model: 'opus', contextPercent: 47, directory: '~/work' }

const SAME: { name: string; left: Status | null; right: Status | null; same: boolean }[] = [
  { name: '同じ値', left: BASE, right: { ...BASE }, same: true },
  { name: 'コンテキストが違う', left: BASE, right: { ...BASE, contextPercent: 48 }, same: false },
  { name: 'モデルが違う', left: BASE, right: { ...BASE, model: 'sonnet' }, same: false },
  { name: '場所が違う', left: BASE, right: { ...BASE, directory: '~/other' }, same: false },
  { name: 'どちらも null', left: null, right: null, same: true },
  { name: '片方だけ null', left: null, right: BASE, same: false },
]

for (const one of SAME) {
  test(`isSameStatus: ${one.name}`, async () => {
    expect(isSameStatus(one.left, one.right)).toBe(one.same)
  })
}
