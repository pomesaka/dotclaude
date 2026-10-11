import { expect, test } from 'claude-code/testing'
import type { OpenQuestion } from '../types'
import {
  CONSULT_ANSWER_TAKEN,
  askedCount,
  commandOf,
  consultDescription,
  consultOf,
  consultPrompt,
  handoffMessage,
  isAllowedInConsult,
  isAnswering,
  isConsultDescription,
  isReadOnlyCommand,
  hasToolUse,
  notifiedAgentOf,
  pickedOption,
  summaryOf,
  summaryPrompt,
} from '../hooks/consult'

const Q3: OpenQuestion = { id: 3, question: '名前をどうするか', detail: '一覧の見出しに出る', options: ['pending', 'todo'], assumed: 'pending', answer: null }

const COMMANDS: { name: string; command: string; isReadOnly: boolean }[] = [
  { name: '検索', command: 'rg -n "foo" src', isReadOnly: true },
  { name: '引用符の中の | は区切りにしない', command: "rg 'a|b' src", isReadOnly: true },
  { name: '引用符の中の > はリダイレクトにしない', command: 'rg "a > b" src', isReadOnly: true },
  { name: '読むコマンドどうしのパイプ', command: 'jj log -r @ | head -5', isReadOnly: true },
  { name: '読むコマンドを && でつなぐ', command: 'ls && cat note.txt', isReadOnly: true },
  { name: 'jj の 2 語のコマンド', command: 'jj file show -r @ a.ts', isReadOnly: true },
  { name: 'jj diff', command: 'jj diff --stat', isReadOnly: true },
  { name: '一覧に無いコマンド', command: 'touch out.txt', isReadOnly: false },
  { name: 'つないだ先が書くコマンド', command: 'ls && touch out.txt', isReadOnly: false },
  { name: 'パイプの先が一覧に無い', command: 'cat a.txt | sh', isReadOnly: false },
  { name: 'リダイレクト', command: 'rg foo > out.txt', isReadOnly: false },
  { name: '追記のリダイレクト', command: 'cat a.txt >> b.txt', isReadOnly: false },
  { name: 'コマンドの展開', command: 'rg $(touch x) src', isReadOnly: false },
  { name: '二重引用符の中のコマンドの展開', command: 'rg "$(touch x)" src', isReadOnly: false },
  { name: 'バッククォート', command: 'ls `touch x`', isReadOnly: false },
  { name: 'fd で別のコマンドを実行する', command: 'fd -e ts -x rm', isReadOnly: false },
  { name: 'rg で前処理のコマンドを実行する', command: 'rg --pre ./run.sh foo', isReadOnly: false },
  { name: '書き換える sed', command: 'sed -i.bak s/a/b/ note.txt', isReadOnly: false },
  { name: 'jj の書くコマンド', command: 'jj commit -m x', isReadOnly: false },
  { name: 'jj file の書くコマンド', command: 'jj file untrack a.ts', isReadOnly: false },
  { name: '環境変数を前に置く', command: 'FOO=1 rg foo', isReadOnly: false },
  { name: '閉じていない引用符', command: "rg 'foo", isReadOnly: false },
  { name: '空', command: '  ', isReadOnly: false },
]

for (const one of COMMANDS) {
  test(`isReadOnlyCommand: ${one.name}`, async () => {
    expect(isReadOnlyCommand(one.command)).toBe(one.isReadOnly)
  })
}

const CALLS: { name: string; tool: string; command: string; isReadOnly: boolean }[] = [
  { name: 'Read は通す', tool: 'Read', command: '', isReadOnly: true },
  { name: '読む Bash は通す', tool: 'Bash', command: 'rg foo src', isReadOnly: true },
  { name: '書く Bash は拒む', tool: 'Bash', command: 'touch a.txt', isReadOnly: false },
  { name: 'Write は拒む', tool: 'Write', command: '', isReadOnly: false },
  { name: 'Edit は拒む', tool: 'Edit', command: '', isReadOnly: false },
  { name: 'エージェントを立てるツールは拒む', tool: 'Agent', command: '', isReadOnly: false },
  { name: 'MCP のツールは通す', tool: 'mcp__rich__show', command: '', isReadOnly: true },
  { name: 'スキルの読み込みは通す', tool: 'Skill', command: '', isReadOnly: true },
  { name: 'ツールの読み込みは通す', tool: 'ToolSearch', command: '', isReadOnly: true },
]

for (const one of CALLS) {
  test(`isAllowedInConsult: ${one.name}`, async () => {
    expect(isAllowedInConsult(one.tool, one.command)).toBe(one.isReadOnly)
  })
}

const INPUTS:{ name: string; input: unknown; command: string }[] = [
  { name: 'Bash の入力', input: { command: 'ls', description: 'list' }, command: 'ls' },
  { name: 'コマンドが無い入力', input: { file_path: '/a' }, command: '' },
  { name: 'オブジェクトでない入力', input: null, command: '' },
]

for (const one of INPUTS) {
  test(`commandOf: ${one.name}`, async () => {
    expect(commandOf(one.input)).toBe(one.command)
  })
}

test('consultPrompt は、保留の中身と、読むだけの決まりを渡す', async () => {
  const prompt = consultPrompt(Q3, undefined)
  expect(prompt).toContain('保留 Q3「名前をどうするか」')
  expect(prompt).toContain('保留の説明: 一覧の見出しに出る')
  expect(prompt).toContain('選択肢: pending / todo')
  expect(prompt).toContain('いまの仮置き: pending')
  expect(prompt).toContain('読むだけにする')
})

test('consultPrompt は、説明の無い保留では説明の行を書かない', async () => {
  expect(consultPrompt({ ...Q3, detail: '' }, undefined)).not.toContain('保留の説明')
})

const INSTRUCTED: { name: string; instruction: string | undefined; opening: string }[] = [
  { name: '頼み方が無ければ、既定の頼み方', instruction: undefined, opening: 'まず、この保留について、詳しく説明して。' },
  { name: '頼み方があれば、その頼み方', instruction: ' /explain-inline で説明して ', opening: 'まず、この保留について、/explain-inline で説明して。' },
]

for (const one of INSTRUCTED) {
  test(`consultPrompt の最初の説明: ${one.name}`, async () => {
    expect(consultPrompt(Q3, one.instruction)).toContain(one.opening)
  })
}

const DESCRIBED: { name: string; description: string | undefined; isConsult: boolean }[] = [
  { name: '相談用のエージェントの説明', description: 'Q3 の相談', isConsult: true },
  { name: '2 桁の番号', description: 'Q12 の相談', isConsult: true },
  { name: 'ほかのエージェントの説明', description: 'Q3 の相談を調べる', isConsult: false },
  { name: '説明が無い', description: undefined, isConsult: false },
]

for (const one of DESCRIBED) {
  test(`isConsultDescription: ${one.name}`, async () => {
    expect(isConsultDescription(one.description)).toBe(one.isConsult)
  })
}

test('consultDescription は、isConsultDescription が相談用と判定する形になる', async () => {
  expect(consultDescription(Q3)).toBe('Q3 の相談')
  expect(isConsultDescription(consultDescription(Q3))).toBe(true)
})

const STORED: { name: string; stored: unknown; consult: { question: OpenQuestion; agentId: string; isHandingOff: boolean } | null }[] = [
  { name: '保存した形', stored: { question: Q3, agentId: 'a1' }, consult: { question: Q3, agentId: 'a1', isHandingOff: false } },
  { name: 'エージェントの ID が無い', stored: { question: Q3 }, consult: null },
  { name: '保留の形が合わない', stored: { question: { id: 3 }, agentId: 'a1' }, consult: null },
  { name: 'まだ無い', stored: undefined, consult: null },
]

for (const one of STORED) {
  test(`consultOf: ${one.name}`, async () => {
    expect(consultOf(one.stored)).toEqual(one.consult)
  })
}

const ASKED: { name: string; messages: { role: string; text: string }[]; count: number }[] = [
  { name: '最初の依頼だけ', messages: [{ role: 'user', text: '依頼' }, { role: 'assistant', text: '説明' }], count: 1 },
  {
    name: '利用者が 1 度聞いた',
    messages: [{ role: 'user', text: '依頼' }, { role: 'assistant', text: '説明' }, { role: 'user', text: 'todo だと？' }, { role: 'assistant', text: '答え' }],
    count: 2,
  },
  { name: 'ツールの結果だけの発言は数えない', messages: [{ role: 'user', text: '依頼' }, { role: 'user', text: ' ' }], count: 1 },
  { name: '空', messages: [], count: 0 },
]

for (const one of ASKED) {
  test(`askedCount: ${one.name}`, async () => {
    expect(askedCount(one.messages)).toBe(one.count)
  })
}

const STATUSES: { status: string | undefined; isAnswering: boolean }[] = [
  { status: 'running', isAnswering: true },
  { status: 'pending', isAnswering: true },
  { status: 'waiting', isAnswering: true },
  { status: 'idle', isAnswering: false },
  { status: 'completed', isAnswering: false },
  { status: undefined, isAnswering: false },
]

for (const one of STATUSES) {
  test(`isAnswering: ${one.status ?? '一覧に無い'}`, async () => {
    expect(isAnswering(one.status)).toBe(one.isAnswering)
  })
}

const SUMMARIES: { name: string; reply: string; summary: string }[] = [
  { name: '文', reply: ' todo にする。見出しは英語のまま。\n', summary: 'todo にする。見出しは英語のまま。' },
  { name: '決まったことが無い', reply: 'なし', summary: '' },
  { name: '決まったことが無い（句点つき）', reply: 'なし。', summary: '' },
  { name: '空', reply: '', summary: '' },
]

for (const one of SUMMARIES) {
  test(`summaryOf: ${one.name}`, async () => {
    expect(summaryOf(one.reply)).toBe(one.summary)
  })
}

const HANDOFFS: { name: string; option: string | null; summary: string; message: string }[] = [
  { name: '選択肢だけ', option: 'todo', summary: '', message: '【保留への回答】Q3 名前をどうするか: todo' },
  { name: '仮置きのまま', option: 'pending', summary: '', message: '【保留への回答】Q3 名前をどうするか: pending（仮置きのまま）' },
  {
    name: '選択肢と要約',
    option: 'todo',
    summary: '見出しは英語のまま。',
    message: '【保留への回答】Q3 名前をどうするか: todo\n相談で決まったこと: 見出しは英語のまま。',
  },
  { name: '選択肢に無い結論', option: null, summary: 'backlog にする。', message: 'Q3（名前をどうするか）について相談した結論: backlog にする。' },
]

for (const one of HANDOFFS) {
  test(`handoffMessage: ${one.name}`, async () => {
    expect(handoffMessage(Q3, one.option, one.summary)).toBe(one.message)
  })
}

const NOTICES: { name: string; text: string; agentId: string | null }[] = [
  {
    name: 'エージェントの終了の知らせ',
    text: '<task-notification>\n<task-id>a12b4c8a93d5befaf</task-id>\n<tool-use-id>toolu_plugin_be88</tool-use-id>',
    agentId: 'a12b4c8a93d5befaf',
  },
  { name: 'ID の無い文', text: '<task-notification>done</task-notification>', agentId: null },
]

for (const one of NOTICES) {
  test(`notifiedAgentOf: ${one.name}`, async () => {
    expect(notifiedAgentOf(one.text)).toBe(one.agentId)
  })
}

const OPTIONS = ['押したときだけ開く', 'いつも自動で開く', '開く']
const PICKED: { name: string; text: string; option: string | null }[] = [
  { name: 'rich の答えの形', text: '【Q1 の選択肢 への回答】\n1. どれにしますか: いつも自動で開く', option: 'いつも自動で開く' },
  { name: '末尾が同じ選択肢は、長いほうを取る', text: '【Q1 への回答】\n1. どれ: 押したときだけ開く', option: '押したときだけ開く' },
  { name: '短い選択肢だけが合う', text: '【Q1 への回答】\n1. どれ: 開く', option: '開く' },
  { name: '保留の選択肢に無い答え', text: '【別の質問 への回答】\n1. 色: 青', option: null },
  { name: '選択肢が文の途中にあるだけ', text: 'いつも自動で開く、でお願い', option: null },
  { name: '空', text: '', option: null },
]

for (const one of PICKED) {
  test(`pickedOption: ${one.name}`, async () => {
    expect(pickedOption(one.text, OPTIONS)).toBe(one.option)
  })
}

const USED = [
  { toolUses: [] },
  { toolUses: [{ tool_use_id: 'toolu_1' }, { tool_use_id: 'toolu_2' }] },
]
const TOOL_USES: { name: string; id: string; has: boolean }[] = [
  { name: 'その会話の呼び出し', id: 'toolu_2', has: true },
  { name: 'ほかの会話の呼び出し', id: 'toolu_9', has: false },
  { name: 'pane の ID', id: 'questions', has: false },
]

for (const one of TOOL_USES) {
  test(`hasToolUse: ${one.name}`, async () => {
    expect(hasToolUse(USED, one.id)).toBe(one.has)
  })
}

// rich の isTakenOver が見る語。変えるなら、mods/rich の側も直す
test('答えを受け取った理由は、rich が引き取りと見分ける語を含む', async () => {
  expect(CONSULT_ANSWER_TAKEN).toContain('受け取りました')
})

test('申し送りの頼み方は、選んだ選択肢を伝えて、選択のほかに要ることだけを頼む', async () => {
  const prompt = summaryPrompt('todo')
  expect(prompt).toContain('利用者は「todo」を選びました')
  expect(prompt).toContain('選択のほかに、メインが作業を変えるために知る必要があることだけ')
  expect(prompt).toContain('無ければ「なし」とだけ返してください')
})

test('選択肢に無い結論の申し送りは、最初の 1 文に結論を書かせる', async () => {
  const prompt = summaryPrompt(null)
  expect(prompt).toContain('最初の 1 文に結論を書き')
  expect(prompt).toContain('結論が決まっていなければ「なし」とだけ返してください')
})
