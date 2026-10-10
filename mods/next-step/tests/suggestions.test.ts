import { expect, test } from 'claude-code/testing'

import { cardWidth, forkPrompt, parseReply } from '../hooks/suggestions'

const REPLIES: { name: string; reply: string; taken: string[]; room: number; parsed: string[] }[] = [
  { name: 'JSON だけ', reply: '{"options":["テストを足して","コミットして"]}', taken: [], room: 3, parsed: ['テストを足して', 'コミットして'] },
  { name: '前後に文が付く', reply: 'はい。\n{"options":["コミットして"]}\n以上です。', taken: [], room: 3, parsed: ['コミットして'] },
  { name: 'コードの囲みの中', reply: '```json\n{"options":["コミットして"]}\n```', taken: [], room: 3, parsed: ['コミットして'] },
  { name: '前後の空白を落とす', reply: '{"options":["  コミットして  "]}', taken: [], room: 3, parsed: ['コミットして'] },
  { name: '先頭の札と同じ案は落とす', reply: '{"options":["コミットして","pushして"]}', taken: ['コミットして'], room: 3, parsed: ['pushして'] },
  { name: '重なった案は 1 つにする', reply: '{"options":["pushして","pushして"]}', taken: [], room: 3, parsed: ['pushして'] },
  { name: '空の案と文字列でない案は落とす', reply: '{"options":["", 3, "pushして"]}', taken: [], room: 3, parsed: ['pushして'] },
  { name: '多すぎる案は、先頭から残す', reply: '{"options":["a","b","c","d"]}', taken: [], room: 3, parsed: ['a', 'b', 'c'] },
  { name: '案が無い', reply: '{"options":[]}', taken: [], room: 3, parsed: [] },
  { name: 'options が配列でない', reply: '{"options":"コミットして"}', taken: [], room: 3, parsed: [] },
  { name: 'JSON でない', reply: '次の一手はありません', taken: [], room: 3, parsed: [] },
  { name: '壊れた JSON', reply: '{"options":["a",}', taken: [], room: 3, parsed: [] },
]

for (const one of REPLIES) {
  test(`parseReply: ${one.name}`, async () => {
    expect(parseReply(one.reply, one.taken, one.room)).toEqual(one.parsed)
  })
}

test('forkPrompt は、直前の答えと、すでに出ている案を入れる', async () => {
  const prompt = forkPrompt('コミットして', '直しました。')
  expect(prompt.includes('<answer>\n直しました。\n</answer>')).toBe(true)
  expect(prompt.includes('<first>\nコミットして\n</first>')).toBe(true)
  expect(prompt.includes('ありそうな順に 3 つまで')).toBe(true)
})

test('forkPrompt は、長い答えの末尾を残す', async () => {
  const prompt = forkPrompt('続けて', `${'あ'.repeat(7_000)}最後の一文。`)
  expect(prompt.includes('（前略）')).toBe(true)
  expect(prompt.includes('最後の一文。\n</answer>')).toBe(true)
  expect(prompt.includes('あ'.repeat(6_001))).toBe(false)
})

const WIDTHS: { columns: number; count: number; width: number }[] = [
  { columns: 100, count: 4, width: 24 },
  { columns: 100, count: 1, width: 100 },
  { columns: 100, count: 3, width: 32 },
  { columns: 30, count: 4, width: 12 },
]

for (const one of WIDTHS) {
  test(`cardWidth(${one.columns}, ${one.count}) は ${one.width}`, async () => {
    expect(cardWidth(one.columns, one.count)).toBe(one.width)
  })
}
