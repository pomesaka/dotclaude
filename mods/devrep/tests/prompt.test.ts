import { expect, test } from 'claude-code/testing'

import { forkPrompt, parseForkReply } from '../hooks/prompt'

const BODY = { now: 'a', next: ['b'], todo: [], sections: [] }

const REPLIES: { name: string; reply: string; parsed: unknown }[] = [
  { name: 'JSON だけ', reply: '{"now":"a","next":["b"]}', parsed: BODY },
  { name: 'コードの囲みと前置きが付いている', reply: '書きました。\n```json\n{"now":"a","next":["b"]}\n```', parsed: BODY },
  { name: 'JSON が無い', reply: '書けません', parsed: 'the reply has no JSON object' },
  { name: 'JSON が壊れている', reply: '{"now":"a",}', parsed: 'the reply is not valid JSON' },
  { name: '中身が足りない', reply: '{"now":"a"}', parsed: 'next must be a list of at least one string' },
]

for (const one of REPLIES) {
  test(`parseForkReply: ${one.name}`, async () => {
    expect(parseForkReply(one.reply)).toEqual(one.parsed)
  })
}

const PROMPTS: { name: string; answer: string | null; previous: typeof BODY | null; has: string[]; lacks: string[] }[] = [
  { name: '答えと前の状況がある', answer: '直しました。', previous: BODY, has: ['<answer>\n直しました。\n</answer>', `<previous>\n${JSON.stringify(BODY)}\n</previous>`], lacks: [] },
  { name: '答えも前の状況も無い', answer: null, previous: null, has: ['<previous>\nまだ無い\n</previous>'], lacks: ['<answer>'] },
  { name: '長い答えは末尾を残す', answer: `${'x'.repeat(6_000)}結び`, previous: null, has: ['（前略）', '結び\n</answer>'], lacks: [] },
]

for (const one of PROMPTS) {
  test(`forkPrompt: ${one.name}`, async () => {
    const prompt = forkPrompt(one.previous, one.answer)
    expect(one.has.map(part => prompt.includes(part))).toEqual(one.has.map(() => true))
    expect(one.lacks.map(part => prompt.includes(part))).toEqual(one.lacks.map(() => false))
  })
}
