import { expect, test } from 'claude-code/testing'

import { clip, parseEntries, pendingFiles, repoRelative, whyOf } from '../hooks/ledger'

const ROOT = '/home/u/dotclaude'

const PATHS: { name: string; real: string; relative: string | null }[] = [
  { name: 'リポジトリの中', real: `${ROOT}/docs/a.md`, relative: 'docs/a.md' },
  { name: 'リポジトリの外', real: '/home/u/project/a.md', relative: null },
  { name: '名前が同じ頭で始まる別のディレクトリ', real: `${ROOT}-old/docs/a.md`, relative: null },
  { name: 'jj のワークスペース', real: `${ROOT}/workspace/w1/docs/a.md`, relative: null },
  { name: 'jj の管理の中', real: `${ROOT}/.jj/repo/x`, relative: null },
]

for (const one of PATHS) {
  test(`repoRelative: ${one.name}`, async () => {
    expect(repoRelative(one.real, ROOT)).toBe(one.relative)
  })
}

const MESSAGES = [
  { role: 'user', text: '最初の依頼' },
  { role: 'assistant', text: '答え' },
  { role: 'user', text: '' },
  { role: 'user', text: '次の依頼' },
  { role: 'user', text: '<task-notification><task-id>a</task-id>' },
]

const WHYS: { name: string; isAgent: boolean; messages: { role: string; text: string }[]; why: string }[] = [
  { name: 'メインは、利用者の最後の発言', isAgent: false, messages: MESSAGES, why: '次の依頼' },
  { name: 'サブエージェントは、最初の依頼', isAgent: true, messages: MESSAGES, why: '最初の依頼' },
  { name: '依頼が無い', isAgent: false, messages: [{ role: 'assistant', text: '答え' }], why: '' },
]

for (const one of WHYS) {
  test(`whyOf: ${one.name}`, async () => {
    expect(whyOf(one.messages, one.isAgent)).toBe(one.why)
  })
}

const ENTRY = { at: '2026-11-18T00:00:00.000Z', session: 's1', cwd: '/p', tool: 'Edit', file: 'docs/a.md', excerpt: 'x', why: 'y' }

const PARSES: { name: string; text: string; files: string[] }[] = [
  { name: '行ごとに読む', text: `${JSON.stringify(ENTRY)}\n${JSON.stringify({ ...ENTRY, file: 'b.md', agentId: 'a1' })}\n`, files: ['docs/a.md', 'b.md'] },
  { name: '書きかけの行と形の合わない行を読み飛ばす', text: `${JSON.stringify(ENTRY)}\n{"at":\n${JSON.stringify({ at: 1 })}\n`, files: ['docs/a.md'] },
  { name: 'agentId が文字列でない行を読み飛ばす', text: JSON.stringify({ ...ENTRY, agentId: 1 }), files: [] },
  { name: '空', text: '', files: [] },
]

for (const one of PARSES) {
  test(`parseEntries: ${one.name}`, async () => {
    expect(parseEntries(one.text).map(entry => entry.file)).toEqual(one.files)
  })
}

test('pendingFiles: 重複を除いて名前の順に並べる', async () => {
  expect(pendingFiles([{ ...ENTRY, file: 'b' }, { ...ENTRY, file: 'a' }, { ...ENTRY, file: 'b' }])).toEqual(['a', 'b'])
})

const CLIPS: { name: string; text: string; max: number; clipped: string }[] = [
  { name: '短ければそのまま', text: 'abc', max: 3, clipped: 'abc' },
  { name: '長ければ切って印を付ける', text: 'abcd', max: 3, clipped: 'abc…' },
]

for (const one of CLIPS) {
  test(`clip: ${one.name}`, async () => {
    expect(clip(one.text, one.max)).toBe(one.clipped)
  })
}
