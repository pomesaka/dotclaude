import { expect, test } from 'claude-code/testing'
import { isInside, resolveLexical, splitAtExisting } from '../hooks/paths'

const ROOT = '/project'

const ALLOW_CASES = [
  { name: 'relative file', input: 'file', absolute: '/project/file', relative: 'file' },
  { name: 'dotfile', input: '.env', absolute: '/project/.env', relative: '.env' },
  { name: 'nested', input: 'config/x', absolute: '/project/config/x', relative: 'config/x' },
  { name: 'absolute under root', input: '/project/config/x', absolute: '/project/config/x', relative: 'config/x' },
  { name: '.. that stays inside', input: 'a/../b', absolute: '/project/b', relative: 'b' },
]

for (const c of ALLOW_CASES) {
  test(`resolveLexical allows: ${c.name}`, () => {
    expect(resolveLexical(ROOT, c.input)).toEqual({ ok: true, absolute: c.absolute, relative: c.relative })
  })
}

const DENY_CASES = [
  { name: 'parent escape', input: '../file' },
  { name: 'deep escape', input: '../../../etc/passwd' },
  { name: 'absolute outside', input: '/etc/passwd' },
  { name: 'sibling with shared prefix', input: '/project-other/x' },
  { name: 'root itself', input: '.' },
  { name: 'empty', input: '' },
  { name: 'NUL byte', input: 'a\0b' },
]

for (const c of DENY_CASES) {
  test(`resolveLexical denies: ${c.name}`, () => {
    expect(resolveLexical(ROOT, c.input).ok).toBe(false)
  })
}

const INSIDE_CASES = [
  { name: 'child', root: '/project', candidate: '/project/a', want: true },
  { name: 'root itself', root: '/project', candidate: '/project', want: false },
  { name: 'prefix sibling', root: '/project', candidate: '/projectx/a', want: false },
  { name: 'trailing slash root', root: '/project/', candidate: '/project/a', want: true },
]

for (const c of INSIDE_CASES) {
  test(`isInside: ${c.name}`, () => {
    expect(isInside(c.root, c.candidate)).toBe(c.want)
  })
}

test('splitAtExisting: splits a new file under an existing directory', async () => {
  const existing = new Set(['/project', '/project/config'])
  const got = await splitAtExisting('/project/config/new/.env', async p => existing.has(p))
  expect(got).toEqual({ existing: '/project/config', rest: ['new', '.env'] })
})
