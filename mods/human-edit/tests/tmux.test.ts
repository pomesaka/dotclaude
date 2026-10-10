import { expect, test } from 'claude-code/testing'
import { WRAPPER_SCRIPT, createTmuxBackend, splitWindowArgv, type RunResult, type TmuxDeps } from '../hooks/tmux'

const ok = (stdout = ''): RunResult => ({ exitCode: 0, stdout, stderr: '' })

test('splitWindowArgv: a hostile path stays one argv element (no shell)', () => {
  const file = '/project/foo"; rm -rf ~; "'
  const argv = splitWindowArgv({
    targetPane: '%1', cwd: '/project', wrapperPath: '/tmp/w.sh', editor: 'nvim',
    file, doneFile: '/tmp/done', channel: 'c', instructions: '$(touch /tmp/pwned)', line: '12',
  })
  expect(argv.slice(0, 13)).toEqual([
    'tmux', 'split-window', '-v', '-l', '40%', '-t', '%1', '-c', '/project', '-P', '-F', '#{pane_id}', 'sh',
  ])
  expect(argv.slice(13)).toEqual(['/tmp/w.sh', 'nvim', file, '/tmp/done', 'c', '$(touch /tmp/pwned)', '12'])
})

const LINE_CASES: { name: string; line: number | undefined; arg: string }[] = [
  { name: 'a line is passed as the last wrapper argument', line: 12, arg: '12' },
  { name: 'no line is passed as an empty argument', line: undefined, arg: '' },
]

for (const c of LINE_CASES) {
  test(`tmux backend: ${c.name}`, async () => {
    const { deps, calls } = fakeTmux(['done:0'])
    await createTmuxBackend(deps).edit({ ...REQUEST, line: c.line }, new AbortController().signal)
    const split = calls.find(argv => argv[1] === 'split-window') ?? []
    expect(split.at(-1)).toBe(c.arg)
    // doneFileの位置は変えない（wrapperが$3で読む）
    expect(split[16]).toBe('/tmp/claude-human-edit/id1/exit-code')
  })
}

test('wrapper: the editor gets +N only when a line is given', () => {
  expect(WRAPPER_SCRIPT.includes('$editor ${line:+"+$line"} "$file"')).toBe(true)
})

/**
 * tmuxを模したrun。`script`はwait-forが呼ばれるたびに1つ進む筋書き:
 * 'done:<code>'はwrapperがexit codeを書いた状態、'closed'はユーザーがpaneを閉じた状態、'idle'は編集中。
 */
const fakeTmux = (script: string[], options: { splitFails?: boolean } = {}) => {
  const files = new Map<string, string>()
  const calls: string[][] = []
  let paneAlive = true
  let step = 0
  let doneFile = ''
  const deps: TmuxDeps = {
    run: async argv => {
      calls.push([...argv])
      const [, sub] = argv
      if (sub === 'split-window') {
        if (options.splitFails === true) return { exitCode: 1, stdout: '', stderr: 'no space for new pane' }
        doneFile = argv[16] ?? ''
        return ok('%7\n')
      }
      if (sub === 'wait-for') {
        const next = script[step++] ?? 'idle'
        if (next.startsWith('done:')) {
          files.set(doneFile, next.slice('done:'.length))
          paneAlive = false
          return ok()
        }
        if (next === 'closed') paneAlive = false
        throw new Error('timed out')
      }
      if (sub === 'list-panes') return ok(paneAlive ? '%1\n%7\n' : '%1\n')
      return ok()
    },
    write: async (path, text) => {
      files.set(path, text)
    },
    read: async path => files.get(path) ?? '',
    exists: async path => files.has(path),
    targetPane: '%1',
    tmpRoot: '/tmp',
    newId: () => 'id1',
  }
  return { deps, calls }
}

const REQUEST = { absolutePath: '/project/.env', cwd: '/project', editor: 'nvim' }

const OUTCOME_CASES = [
  { name: 'editor exits 0 on the first wait', script: ['done:0'], want: { kind: 'exited', exitCode: 0 } },
  { name: 'editor exits non-zero after a few slices', script: ['idle', 'idle', 'done:1'], want: { kind: 'exited', exitCode: 1 } },
  { name: 'pane closed by the user', script: ['idle', 'closed'], want: { kind: 'cancelled' } },
]

for (const c of OUTCOME_CASES) {
  test(`tmux backend: ${c.name}`, async () => {
    const { deps, calls } = fakeTmux(c.script)
    const got = await createTmuxBackend(deps).edit(REQUEST, new AbortController().signal)
    expect(got).toEqual(c.want)
    expect(calls.at(-1)).toEqual(['rm', '-rf', '/tmp/claude-human-edit/id1'])
  })
}

test('tmux backend: an interrupted call kills the pane', async () => {
  const { deps, calls } = fakeTmux([])
  const aborted = new AbortController()
  aborted.abort()
  const got = await createTmuxBackend(deps).edit(REQUEST, aborted.signal)
  expect(got).toEqual({ kind: 'cancelled' })
  expect(calls).toContainEqual(['tmux', 'kill-pane', '-t', '%7'])
})

test('tmux backend: split-window failure rejects and still cleans up', async () => {
  const { deps, calls } = fakeTmux([], { splitFails: true })
  await expect(createTmuxBackend(deps).edit(REQUEST, new AbortController().signal)).rejects.toThrow('no space for new pane')
  expect(calls.at(-1)).toEqual(['rm', '-rf', '/tmp/claude-human-edit/id1'])
})
