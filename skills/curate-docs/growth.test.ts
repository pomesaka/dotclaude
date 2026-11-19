import { describe, expect, test } from 'bun:test'

import { charsOf, noticeOf, parseBaseline } from './growth'

describe('noticeOf', () => {
  const baseline = { chars: 1000, at: '2026-11-19' }
  test.each([
    ['増えていない', 1000, false],
    ['減った', 800, false],
    ['2割ちょうど', 1200, false],
    ['2割を超えた', 1201, true],
    ['倍になった', 2000, true],
  ])('%s', (_, now, isNoticed) => {
    expect(noticeOf(baseline, now) !== null).toBe(isNoticed)
  })

  test('文に増えた割合、前後の文字数、前回の日付を入れる', () => {
    const notice = noticeOf(baseline, 1500) ?? ''
    for (const part of ['50%', '1000 → 1500', '2026-11-19', '/curate-docs']) expect(notice.includes(part)).toBe(true)
  })
})

describe('parseBaseline', () => {
  test.each([
    ['正しい形', { chars: 10, at: '2026-11-19' }, { chars: 10, at: '2026-11-19' }],
    ['null', null, null],
    ['文字数が無い', { at: '2026-11-19' }, null],
    ['文字数が 0', { chars: 0, at: '2026-11-19' }, null],
    ['文字数が小数', { chars: 1.5, at: '2026-11-19' }, null],
    ['日付が無い', { chars: 10 }, null],
  ])('%s', (_, input, expected) => {
    expect(parseBaseline(input)).toEqual(expected)
  })
})

describe('charsOf', () => {
  test.each([
    ['空', [], 0],
    ['日本語は1文字を1と数える', ['日本語'], 3],
    ['ファイルをまたいで足す', ['ab', 'cde'], 5],
  ])('%s', (_, texts, expected) => {
    expect(charsOf(texts)).toBe(expected)
  })
})
