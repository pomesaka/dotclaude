import { expect, test } from 'claude-code/testing'
import { clip } from '../hooks/format'

const CLIPS: { name: string; text: string; max: number; clipped: string }[] = [
  { name: '収まるならそのまま', text: 'fix: typo', max: 20, clipped: 'fix: typo' },
  { name: 'ちょうど収まる', text: 'abcde', max: 5, clipped: 'abcde' },
  { name: '半角を切る', text: 'abcdefgh', max: 5, clipped: 'abcd…' },
  { name: '全角は 2 桁として切る', text: '説明をターミナルに描く', max: 9, clipped: '説明をタ…' },
  { name: '全角の途中では切らない', text: '説明をターミナルに描く', max: 8, clipped: '説明を…' },
]

for (const one of CLIPS) {
  test(`clip: ${one.name}`, async () => {
    expect(clip(one.text, one.max)).toBe(one.clipped)
  })
}
