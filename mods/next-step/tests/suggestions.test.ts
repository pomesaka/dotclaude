import { expect, test } from 'claude-code/testing'
import { askPrompt, cardWidth, modelOf, parseReply, parseSuggestions, SYSTEM_PROMPT, tailOf, type Spoken } from '../hooks/suggestions'

const A = { label: 'テストを足す', prompt: '境界のケースをtable drivenで足して' }
const B = { label: 'コミット', prompt: 'ここまでをコミットして' }

const PARSED: { name: string; input: unknown; parsed: ReturnType<typeof parseSuggestions> }[] = [
  { name: '札と文の組', input: { options: [A, B] }, parsed: [A, B] },
  { name: '前後の空白は落とす', input: { options: [{ label: ' テストを足す ', prompt: ' 境界のケースをtable drivenで足して\n' }] }, parsed: [A] },
  { name: '空は、案が無い', input: { options: [] }, parsed: [] },
  { name: 'optionsが無い', input: {}, parsed: 'options must be a list' },
  { name: 'optionsが配列でない', input: { options: 'コミット' }, parsed: 'options must be a list' },
  {
    name: '5つ以上',
    input: { options: ['a', 'b', 'c', 'd', 'e'].map(label => ({ label, prompt: 'x' })) },
    parsed: 'options must list at most 4 suggestions',
  },
  { name: '札が空', input: { options: [A, { label: ' ', prompt: 'x' }] }, parsed: 'every option needs a non-empty label' },
  { name: '文が無い', input: { options: [A, { label: 'コミット' }] }, parsed: 'every option needs a non-empty prompt' },
  { name: '札が重なる', input: { options: [A, { ...B, label: 'テストを足す' }] }, parsed: 'labels must be distinct' },
]

for (const one of PARSED) {
  test(`parseSuggestions: ${one.name}`, async () => {
    expect(parseSuggestions(one.input)).toEqual(one.parsed)
  })
}

const REPLIES: { name: string; reply: string; suggestions: ReturnType<typeof parseReply> }[] = [
  { name: 'JSONだけ', reply: '{"options":[{"label":"コミット","prompt":"ここまでをコミットして"}]}', suggestions: [B] },
  {
    name: 'コードの囲みと前置きが付いている',
    reply: '案です。\n```json\n{"options":[{"label":"コミット","prompt":"ここまでをコミットして"}]}\n```',
    suggestions: [B],
  },
  { name: '案が無い', reply: '{"options":[]}', suggestions: [] },
  { name: 'JSONが無い', reply: '次の一手はありません', suggestions: [] },
  { name: 'JSONが壊れている', reply: '{"options":[{"label":"コミット"', suggestions: [] },
  { name: '形が合わない', reply: '{"options":[{"label":"コミット"}]}', suggestions: [] },
]

for (const one of REPLIES) {
  test(`parseReply: ${one.name}`, async () => {
    expect(parseReply(one.reply)).toEqual(one.suggestions)
  })
}

const MODELS: { name: string; configured: string | undefined; model: string }[] = [
  { name: '設定が無ければ haiku', configured: undefined, model: 'haiku' },
  { name: '空白だけなら haiku', configured: ' ', model: 'haiku' },
  { name: '設定したモデル', configured: ' sonnet ', model: 'sonnet' },
]

for (const one of MODELS) {
  test(`modelOf: ${one.name}`, async () => {
    expect(modelOf(one.configured)).toBe(one.model)
  })
}

const ASKED: Spoken = { role: 'user', text: '番号を直して' }
const DONE: Spoken = { role: 'assistant', text: '直しました。' }
// ツールの結果だけの行。文が無い
const TOOL: Spoken = { role: 'user', text: '' }
const numbered = (count: number): Spoken[] => Array.from({ length: count }, (_, index) => ({ role: 'user', text: `発言${index}` }))

const TAILS: { name: string; messages: Spoken[]; answer: string; texts: string[] }[] = [
  { name: '会話の末尾を、古い順に取る', messages: [ASKED, DONE], answer: '別の答え', texts: ['番号を直して', '直しました。'] },
  { name: '末尾が直前の答えなら、落とす', messages: [ASKED, DONE], answer: ' 直しました。\n', texts: ['番号を直して'] },
  { name: '文の無い発言は飛ばす', messages: [ASKED, TOOL, DONE, TOOL], answer: '直しました。', texts: ['番号を直して'] },
  { name: '6 件より前は落とす', messages: numbered(8), answer: 'x', texts: ['発言2', '発言3', '発言4', '発言5', '発言6', '発言7'] },
  { name: '会話が無い', messages: [], answer: 'x', texts: [] },
]

for (const one of TAILS) {
  test(`tailOf: ${one.name}`, async () => {
    expect(tailOf(one.messages, one.answer).map(spoken => spoken.text)).toEqual(one.texts)
  })
}

test('tailOf は、長い発言の先頭だけを残す', async () => {
  const [clipped] = tailOf([{ role: 'user', text: `先頭${'あ'.repeat(2_000)}` }], 'x')
  expect(clipped?.text.startsWith('先頭')).toBe(true)
  expect(clipped?.text.endsWith('（後略）')).toBe(true)
  expect(clipped?.text.length).toBe(1_504)
})

test('askPrompt は、会話の末尾と直前の答えを、別の枠に入れる', async () => {
  expect(askPrompt([ASKED, DONE], 'コミットしますか。')).toBe(
    '<conversation>\n[利用者]\n番号を直して\n\n[Claude]\n直しました。\n</conversation>\n\nClaude が直前に返した答え:\n<answer>\nコミットしますか。\n</answer>',
  )
})

test('askPrompt は、長い答えの末尾だけを入れる', async () => {
  const prompt = askPrompt([], `${'あ'.repeat(7_000)}最後の文`)
  expect(prompt).toContain('（前略）')
  expect(prompt).toContain('最後の文\n</answer>')
  expect(prompt.length).toBeLessThan(7_000)
})

test('SYSTEM_PROMPT は、返事の形を JSON と決めている', async () => {
  expect(SYSTEM_PROMPT).toContain('{"options":[{"label":"…","prompt":"…"}]}')
})

const WIDTHS: { name: string; columns: number; count: number; width: number }[] = [
  { name: '4枚を、隙間3桁を引いて等分する', columns: 103, count: 4, width: 25 },
  { name: '1枚なら幅いっぱい', columns: 100, count: 1, width: 100 },
  { name: '割り切れない分は切り捨てる', columns: 100, count: 3, width: 32 },
  { name: '狭くても12桁は取る', columns: 30, count: 4, width: 12 },
]

for (const one of WIDTHS) {
  test(`cardWidth: ${one.name}`, async () => {
    expect(cardWidth(one.columns, one.count)).toBe(one.width)
  })
}
