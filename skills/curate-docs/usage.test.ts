import { expect, test } from 'bun:test'

import { type Signal, signalsOf } from './usage'

const use = (name: string, input: unknown): string => JSON.stringify({ message: { content: [{ type: 'tool_use', name, input }] } })

test.each<{ name: string; line: string; signals: Signal[] }>([
  { name: 'Skill の道具', line: use('Skill', { skill: 're' }), signals: [{ kind: 'skill', name: 're' }] },
  { name: '利用者が打った /<名前>', line: '{"content":"<command-name>/jjcommit</command-name>"}', signals: [{ kind: 'command', name: 'jjcommit' }] },
  { name: 'Agent の subagent_type', line: use('Agent', { subagent_type: 'test-reviewer', prompt: 'x' }), signals: [{ kind: 'agent', name: 'test-reviewer' }] },
  { name: 'ルールが読み込まれた跡', line: '{"content":"Contents of /Users/p/dotclaude/rules/typescript.md:"}', signals: [{ kind: 'rule', name: 'typescript' }] },
  { name: 'docs の文書を Read で読んだ', line: use('Read', { file_path: '/Users/p/.claude/docs/jj.md' }), signals: [{ kind: 'doc', name: 'jj' }] },
  { name: 'スキルの SKILL.md を Read で読んだ', line: use('Read', { file_path: '/Users/p/.claude/skills/xwb/SKILL.md' }), signals: [{ kind: 'skill', name: 'xwb' }] },
  { name: 'docs の外の Read は数えない', line: use('Read', { file_path: '/Users/p/repo/README.md' }), signals: [] },
  { name: '壊れた行', line: '{"tool_use"', signals: [] },
])('signalsOf: $name', ({ line, signals }) => {
  expect(signalsOf(line)).toEqual(signals)
})
