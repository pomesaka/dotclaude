import { expect, test, type TestBody } from 'claude-code/testing'

import { isStray } from '../hooks/path'

type On = Parameters<TestBody>[1]

const CWD = '/w/repo-ws/emiri-0f3a'
const TEMPS = ['/tmp', '/private/tmp', '/home/u/.claude/tmp']

const STRAYS: { name: string; path: string; hasParent: boolean; is: boolean }[] = [
  { name: '外に新しいフォルダを作った', path: '/w/repo-ws-emiri-0f3a/src/a.ts', hasParent: false, is: true },
  { name: '外でも、親のフォルダがある', path: '/home/u/github.com/pomesaka/dotclaude/docs/a.md', hasParent: true, is: false },
  { name: '中に新しいフォルダを作った', path: `${CWD}/src/new/a.ts`, hasParent: false, is: false },
  { name: '名前の頭だけ同じ隣のフォルダは外', path: `${CWD}x/a.ts`, hasParent: false, is: true },
  { name: '一時の置き場', path: '/private/tmp/claude-1/scratchpad/msg/1.txt', hasParent: false, is: false },
  { name: '~/.claude/tmp', path: '/home/u/.claude/tmp/reviews/a.md', hasParent: false, is: false },
  { name: '相対のパスは見ない', path: 'a/b.ts', hasParent: false, is: false },
]

for (const one of STRAYS) {
  test(`isStray: ${one.name}`, async () => {
    expect(isStray(one.path, one.hasParent, CWD, TEMPS)).toBe(one.is)
  })
}

const world = (on: On, existing: string[]) => {
  on('session.cwd', () => ({ value: CWD }))
  on('env.get', () => ({ value: '/home/u' }))
  on('fs.exists', (_$, e) => ({ value: existing.includes(e.path) }))
  on('tool.call', () => ({ result: 'written' }))
}

const contextOf = (called: unknown): string => {
  const context = typeof called === 'object' && called !== null && 'context' in called ? called.context : undefined
  return Array.isArray(context) ? context.join('\n') : ''
}

const CALLS: { name: string; path: string; existing: string[]; has: string }[] = [
  { name: '外に新しいフォルダを作った Write に、写し間違いかを確かめるよう添える', path: '/w/repo-ws-emiri-0f3a/src/a.ts', existing: [], has: '親のフォルダ /w/repo-ws-emiri-0f3a/src はこの Write で新しくできた' },
  { name: '親のフォルダがあれば、何も添えない', path: '/w/other/a.md', existing: ['/w/other'], has: '' },
]

for (const one of CALLS) {
  test(one.name, async ($, on) => {
    world(on, one.existing)
    const called = await $.tool.call({ tool: 'Write', file_path: one.path, content: 'x' })
    if (one.has === '') expect(contextOf(called)).toBe('')
    else expect(contextOf(called)).toContain(one.has)
  })
}
