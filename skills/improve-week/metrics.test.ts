import { describe, expect, test } from 'bun:test'
import { type Row, formatRows, rowsOf } from './metrics'

describe('rowsOf', () => {
  test.each<{ name: string; body: unknown; want: Row[] }>([
    {
      name: '値の大きい順に並べる',
      body: { data: { result: [{ metric: { tool_name: 'Read' }, value: [1, '10'] }, { metric: { tool_name: 'Bash' }, value: [1, '99.5'] }] } },
      want: [
        { labels: { tool_name: 'Bash' }, value: 99.5 },
        { labels: { tool_name: 'Read' }, value: 10 },
      ],
    },
    { name: 'ラベルの無い行は空のラベル', body: { data: { result: [{ metric: {}, value: [1, '3'] }] } }, want: [{ labels: {}, value: 3 }] },
    { name: '数でない値は落とす', body: { data: { result: [{ metric: {}, value: [1, 'NaN'] }] } }, want: [] },
    { name: '形の違う答え', body: { status: 'error' }, want: [] },
  ])('$name', ({ body, want }) => {
    expect(rowsOf(body)).toEqual(want)
  })
})

test('formatRows はラベルが無ければ - を出し、上位だけを出す', () => {
  const rows: Row[] = [
    { labels: { skill_name: 'review-code' }, value: 1234.4 },
    { labels: {}, value: 10 },
    { labels: { skill_name: 'x' }, value: 1 },
  ]
  expect(formatRows(rows, ['skill_name'], 2)).toBe(`${'1,234'.padStart(14)}  review-code\n${'10'.padStart(14)}  -`)
})
