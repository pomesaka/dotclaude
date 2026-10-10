import { expect, test } from 'claude-code/testing'
import type { OpenQuestion } from '../types'
import { commandOf, consultPrompt, handoffMessage, isReadOnlyCall, isReadOnlyCommand, notifiedAgentOf, summaryOf } from '../hooks/consult'

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
  { name: 'MCP のツールは拒む', tool: 'mcp__status-band__resolve_question', command: '', isReadOnly: false },
]

for (const one of CALLS) {
  test(`isReadOnlyCall: ${one.name}`, async () => {
    expect(isReadOnlyCall(one.tool, one.command)).toBe(one.isReadOnly)
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
  const prompt = consultPrompt(Q3)
  expect(prompt).toContain('保留 Q3「名前をどうするか」')
  expect(prompt).toContain('保留の説明: 一覧の見出しに出る')
  expect(prompt).toContain('選択肢: pending / todo')
  expect(prompt).toContain('いまの仮置き: pending')
  expect(prompt).toContain('読むだけにする')
})

test('consultPrompt は、説明の無い保留では説明の行を書かない', async () => {
  expect(consultPrompt({ ...Q3, detail: '' })).not.toContain('保留の説明')
})

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
