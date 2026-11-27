// 文書の整理の前と後で、同じ場面にどう答えるかを比べる。
// 使い方: bun ~/.claude/skills/curate-docs/evals.ts <scenarios.json> <out.md>
//
// scenarios.json の形:
// { "name": "working-rules",
//   "old": ["<整理の前の文書のパス>", ...], "new": ["<整理の後の文書のパス>", ...],
//   "scenarios": [{ "id": "s1", "situation": "<場面>", "expected": ["<期待する判断>", ...] }] }
//
// 答える側も採点する側も、CLAUDE.md、スキル、Mod、道具を切った claude -p（--safe-mode --tools ""）。
// 答える側には文書と場面だけを渡す。採点する側には、どちらの版の答えかを伏せ、A と B の順を場面ごとに入れ替えて渡す。
import { readFileSync, writeFileSync } from 'node:fs'

type Scenario = { id: string; situation: string; expected: string[] }
type Suite = { name: string; old: string[]; new: string[]; scenarios: Scenario[] }
type Grade = { a: number[]; b: number[]; note: string }

const isStringArray = (v: unknown): v is string[] => Array.isArray(v) && v.every(x => typeof x === 'string')
const isScenario = (v: unknown): v is Scenario =>
  typeof v === 'object' && v !== null && 'id' in v && typeof v.id === 'string' && 'situation' in v &&
  typeof v.situation === 'string' && 'expected' in v && isStringArray(v.expected)
const isSuite = (v: unknown): v is Suite =>
  typeof v === 'object' && v !== null && 'name' in v && typeof v.name === 'string' && 'old' in v && isStringArray(v.old) &&
  'new' in v && isStringArray(v.new) && 'scenarios' in v && Array.isArray(v.scenarios) && v.scenarios.every(isScenario)

const [suitePath, outPath] = process.argv.slice(2)
if (!suitePath || !outPath) {
  console.error('使い方: bun ~/.claude/skills/curate-docs/evals.ts <scenarios.json> <out.md>')
  process.exit(2)
}
const raw: unknown = JSON.parse(readFileSync(suitePath, 'utf8'))
if (!isSuite(raw)) {
  console.error(`${suitePath}: 形が違う（name、old、new、scenarios[].id/situation/expected）`)
  process.exit(2)
}
const suite = raw

const docsOf = (paths: string[]) =>
  paths.map(p => `<document path="${p.split('/').slice(-1)[0]}">\n${readFileSync(p, 'utf8')}\n</document>`).join('\n\n')

async function claude(prompt: string, schema?: string): Promise<string> {
  const args = ['claude', '-p', '--safe-mode', '--tools', '', '--no-session-persistence', '--model', 'claude-opus-5-5', '--output-format', 'json']
  if (schema) args.push('--json-schema', schema)
  const proc = Bun.spawn([...args, prompt], { stdout: 'pipe', stderr: 'pipe' })
  const [out, err, code] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited])
  if (code !== 0) throw new Error(`claude -p が ${code} で終わった: ${err.slice(0, 500)}`)
  const parsed: unknown = JSON.parse(out)
  if (typeof parsed !== 'object' || parsed === null) throw new Error(`claude -p の出力が JSON でない: ${out.slice(0, 200)}`)
  if (schema && 'structured_output' in parsed) return JSON.stringify(parsed.structured_output)
  if ('result' in parsed && typeof parsed.result === 'string') return parsed.result
  throw new Error(`claude -p の出力に result が無い: ${out.slice(0, 200)}`)
}

const answerPrompt = (docs: string, s: Scenario) =>
  `${docs}\n\nあなたは、上の文書を作業の決まりとして読んだエージェントだ。次の場面で何をするか（何をしないか）を、理由と一緒に3〜8行で答える。文書に書かれていないことは、ふつうの判断で答えてよい。\n\n<situation>\n${s.situation}\n</situation>`

const GRADE_SCHEMA = JSON.stringify({
  type: 'object',
  properties: {
    a: { type: 'array', items: { type: 'integer', minimum: 0, maximum: 2 } },
    b: { type: 'array', items: { type: 'integer', minimum: 0, maximum: 2 } },
    note: { type: 'string' },
  },
  required: ['a', 'b', 'note'],
})

const gradePrompt = (s: Scenario, a: string, b: string) =>
  `次の場面に対する2つの答え（A と B）を、期待する判断の各項目について採点する。2 は判断がはっきり含まれる、1 は部分的か曖昧、0 は含まれないか反する。a と b はそれぞれ、期待する判断の数と同じ長さの配列にする。note には、2つの答えの違いのうち、採点に効いたものを1〜2文で書く。\n\n<situation>\n${s.situation}\n</situation>\n\n<expected>\n${s.expected.map((e, i) => `${i + 1}. ${e}`).join('\n')}\n</expected>\n\n<answer_a>\n${a}\n</answer_a>\n\n<answer_b>\n${b}\n</answer_b>`

const isGrade = (v: unknown, n: number): v is Grade =>
  typeof v === 'object' && v !== null && 'a' in v && 'b' in v && 'note' in v && Array.isArray(v.a) && Array.isArray(v.b) &&
  v.a.length === n && v.b.length === n && typeof v.note === 'string'

const oldDocs = docsOf(suite.old)
const newDocs = docsOf(suite.new)

type Row = { id: string; old: number; new: number; max: number; note: string; oldAnswer: string; newAnswer: string }
const rows: Row[] = []
for (const [i, s] of suite.scenarios.entries()) {
  console.error(`[${i + 1}/${suite.scenarios.length}] ${s.id}`)
  const [oldAnswer, newAnswer] = await Promise.all([claude(answerPrompt(oldDocs, s)), claude(answerPrompt(newDocs, s))])
  // WHY 順を入れ替える: 採点する側が先の答えを高く付ける癖を、版の差と取り違えないため
  const swap = i % 2 === 1
  const graded: unknown = JSON.parse(await claude(gradePrompt(s, swap ? newAnswer : oldAnswer, swap ? oldAnswer : newAnswer), GRADE_SCHEMA))
  if (!isGrade(graded, s.expected.length)) throw new Error(`${s.id}: 採点の形が違う: ${JSON.stringify(graded)}`)
  const sum = (xs: number[]) => xs.reduce((t, x) => t + x, 0)
  rows.push({
    id: s.id,
    old: sum(swap ? graded.b : graded.a),
    new: sum(swap ? graded.a : graded.b),
    max: s.expected.length * 2,
    note: graded.note,
    oldAnswer,
    newAnswer,
  })
}

const total = (k: 'old' | 'new') => rows.reduce((t, r) => t + r[k], 0)
const max = rows.reduce((t, r) => t + r.max, 0)
const lines = [
  `# ${suite.name} の評価`,
  '',
  `整理の前 ${total('old')}/${max}、整理の後 ${total('new')}/${max}`,
  '',
  '| 場面 | 前 | 後 | 差 | 採点の注記 |',
  '|---|---|---|---|---|',
  ...rows.map(r => `| ${r.id} | ${r.old}/${r.max} | ${r.new}/${r.max} | ${r.new - r.old} | ${r.note.replace(/\|/g, '／').replace(/\n/g, ' ')} |`),
  '',
  '## 答えの全文',
  ...rows.flatMap(r => {
    const s = suite.scenarios.find(x => x.id === r.id)
    return ['', `### ${r.id}`, '', s?.situation ?? '', '', '**前:**', '', r.oldAnswer, '', '**後:**', '', r.newAnswer]
  }),
]
writeFileSync(outPath, `${lines.join('\n')}\n`)
console.log(`${outPath}: 前 ${total('old')}/${max}、後 ${total('new')}/${max}`)
