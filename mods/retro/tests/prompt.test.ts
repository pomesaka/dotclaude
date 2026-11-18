import { expect, test } from 'claude-code/testing'

import { judgePrompt, parseJudgeReply, writerPrompt } from '../hooks/prompt'

const ONE = { title: '公開の前に名前を確かめる', detail: '公開リポジトリに案件名を書かない', evidence: '2026-11-13 に指摘された' }

const REPLIES: { name: string; reply: string; parsed: unknown }[] = [
  { name: '発見が 1 つ', reply: JSON.stringify({ findings: [ONE] }), parsed: [ONE] },
  { name: '発見が無い', reply: '{"findings":[]}', parsed: [] },
  { name: 'コードの囲みと前置きが付いている', reply: `振り返りました。\n\`\`\`json\n${JSON.stringify({ findings: [ONE] })}\n\`\`\``, parsed: [ONE] },
  { name: '根拠が無くても読む', reply: '{"findings":[{"title":"a","detail":"b"}]}', parsed: [{ title: 'a', detail: 'b', evidence: '' }] },
  { name: '4 つ目からは捨てる', reply: JSON.stringify({ findings: [ONE, ONE, ONE, ONE] }), parsed: [ONE, ONE, ONE] },
  { name: 'JSON が無い', reply: '特にありません', parsed: 'the reply has no JSON object' },
  { name: 'JSON が壊れている', reply: '{"findings":[}', parsed: 'the reply is not valid JSON' },
  { name: 'findings が並びでない', reply: '{"findings":"none"}', parsed: 'findings must be a list' },
  { name: '見出しが空', reply: '{"findings":[{"title":"","detail":"b"}]}', parsed: 'findings[0] needs a non-empty title and detail' },
]

for (const one of REPLIES) {
  test(`parseJudgeReply: ${one.name}`, async () => {
    expect(parseJudgeReply(one.reply)).toEqual(one.parsed)
  })
}

const JUDGES: { name: string; found: string[]; answer: string | null; toolCalls?: number; has: string[]; lacks: string[] }[] = [
  { name: '答えと前の発見がある', found: ['a', 'b'], answer: '直しました。', has: ['<answer>\n直しました。\n</answer>', '<found>\n- a\n- b\n</found>'], lacks: ['道具を'] },
  { name: '答えも前の発見も無い', found: [], answer: null, has: ['<found>\nまだ無い\n</found>'], lacks: ['<answer>'] },
  { name: '長い答えは末尾を残す', found: [], answer: `${'x'.repeat(6_000)}結び`, has: ['（前略）', '結び\n</answer>'], lacks: [] },
  { name: '手数が多かったら、決まった手を探させる', found: [], answer: null, toolCalls: 11, has: ['道具を 11 回呼んだ', 'agent-environment.md'], lacks: [] },
]

for (const one of JUDGES) {
  test(`judgePrompt: ${one.name}`, async () => {
    const prompt = judgePrompt(one.found, one.answer, one.toolCalls ?? null)
    expect(one.has.map(part => prompt.includes(part))).toEqual(one.has.map(() => true))
    expect(one.lacks.map(part => prompt.includes(part))).toEqual(one.lacks.map(() => false))
  })
}

test('writerPrompt: 発見と作業ディレクトリを渡し、re のスキルに従わせる', async () => {
  const prompt = writerPrompt([ONE], '/repo')
  expect(prompt.includes('"title": "公開の前に名前を確かめる"')).toBe(true)
  expect(prompt.includes('作業ディレクトリ /repo')).toBe(true)
  expect(prompt.includes('~/.claude/skills/re/SKILL.md')).toBe(true)
})
