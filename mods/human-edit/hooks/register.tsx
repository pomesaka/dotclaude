import { atom, read, update } from 'claude-code'
import type { Register } from 'claude-code'
import { pickEditor } from './editor'
import { createGate, parseInput, runHumanEdit, type FileSnapshot } from './human-edit'
import { createTmuxBackend } from './tmux'

const TOOL_NAME = 'human_edit'

const DESCRIPTION = `Ask the user to edit a local file manually.
Use this tool when:
- the file contains secrets or credentials
- the user should make the change themselves
- explicit human intervention is required
The call blocks until the user closes the editor. The result reports whether the file changed, never its contents; Read the file afterwards if you need them.
Do not use this tool for ordinary code edits that Claude can safely perform itself.`

const INPUT_SCHEMA = {
  type: 'object',
  properties: {
    path: { type: 'string', description: 'File to edit, relative to the project root or absolute under it. The file may not exist yet, but its parent directory must.' },
    instructions: { type: 'string', description: 'Shown to the user before the editor opens. Never include secret values.' },
    line: { type: 'integer', minimum: 1, description: 'Line to put the cursor on when the editor opens (1-based). Omit to open where the editor would by default.' },
  },
  required: ['path'],
  additionalProperties: false,
}

// WHY モジュール変数: 進行中の1件はこのプロセスのtool callに紐づく一時状態で、reloadを跨いで残す意味がない
const gate = createGate()

// 編集してもらっているあいだ、プロンプトの上の帯に出す中身
const editing = atom({ plugin: 'human-edit', key: 'editing' } as const, null)

const ACCENT = '#6cb6ff'

const sha256 = async (text: string): Promise<string> => {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('')
}

export const register: Register = on => {
  // WHY next(e)より先に登録する: Claude Codeは最初のプロンプトの前にsession.startのhookを待つので、
  // 先に登録すれば最初のターンからツールが見える（Mods「Use the mods API」の例と同じ順番）
  on('session.start', async ($, e, next) => {
    await $.tool.register({ name: TOOL_NAME, description: DESCRIPTION, inputSchema: INPUT_SCHEMA, isDeferred: false })
    return next(e)
  })

  on('tool.call', { tool: 'mcp__human-edit__human_edit' }, async ($, e, next) => {
    const input = parseInput(e)
    if (typeof input === 'string') return { deny: `human_edit failed: ${input}` }

    const [tmux, tmuxPane, tmpDir, humanEditEditor, visual, editorEnv] = await Promise.all([
      $.env.get('TMUX'),
      $.env.get('TMUX_PANE'),
      $.env.get('TMPDIR'),
      $.env.get('HUMAN_EDIT_EDITOR'),
      $.env.get('VISUAL'),
      $.env.get('EDITOR'),
    ])
    // WHY root(): /cdやworktreeの移動を反映したプロジェクトルートを返す。
    // WHY NOT cwd(): セッションが動いているディレクトリで、ルートの外への編集を拒む基準としては意味がずれる
    const root = await $.session.root()

    const snapshot = async (path: string): Promise<FileSnapshot> => {
      const stat = await $.fs.stat(path).catch(() => undefined)
      if (stat === undefined) return { exists: false }
      // WHY hashを諦めても失敗にしない: fs.readは4 MiB超でrejectする。その場合はsize + mtimeで判定する
      const bytes = stat.kind === 'file' ? await $.fs.read(path, { as: 'bytes' }).catch(() => undefined) : undefined
      const hash = bytes === undefined ? undefined : await sha256(bytes.base64)
      return { exists: true, kind: stat.kind, size: stat.size, mtimeMs: stat.mtimeMs, hash }
    }

    const backend = createTmuxBackend({
      run: (argv, init) => $.process.run(argv, init),
      write: (path, text) => $.fs.write(path, text),
      read: path => $.fs.read(path),
      exists: path => $.fs.exists(path),
      targetPane: tmuxPane ?? '',
      tmpRoot: (tmpDir ?? '/tmp').replace(/\/+$/, ''),
      newId: () => crypto.randomUUID(),
    })

    // UIは補助。描画に失敗してもhuman_edit自体は失敗させない
    const show = (fn: () => void) => {
      try {
        fn()
      } catch {
        // noop
      }
    }
    show(() => $.ui.status(`human_edit: waiting for you to edit ${input.path}`))
    // WHY instructionsをtoastに載せない: toastは4秒で消えて読み切れない。全文はpane内と、プロンプトの上の帯に表示している
    show(() => $.ui.toast(`Human edit requested: ${input.path}`))
    // WHY 帯にも出す: pane内の指示は、Enterを押してeditorが開くと隠れる。編集中に何を書けばよいかが見えなくなる
    await update($, editing, () => ({ path: input.path, instructions: input.instructions ?? null })).catch(() => undefined)

    try {
      const outcome = await runHumanEdit(
        {
          root,
          // WHY TMUX_PANEも要求する: 分割対象のpaneが分からないと別のwindowを割ってしまう
          isInsideTmux: (tmux ?? '') !== '' && (tmuxPane ?? '') !== '',
          editor: pickEditor({ HUMAN_EDIT_EDITOR: humanEditEditor, VISUAL: visual, EDITOR: editorEnv }),
          backend,
          exists: path => $.fs.exists(path),
          realPath: path => $.fs.stat(path, { resolve: true }).then(s => s.realPath).catch(() => undefined),
          snapshot,
        },
        gate,
        input,
        next.signal,
      )
      if (!outcome.ok) return { deny: outcome.error }
      const { result } = outcome
      show(() => $.ui.toast(result.status === 'completed' ? `✓ Human edit completed: ${result.path}` : `Human edit cancelled: ${result.path}`))
      // WHY JSON文字列: plugin toolのresultはstringかcontent block配列しか受け付けない（2.1.295で実行して確認）
      return { result: JSON.stringify(result) }
    } finally {
      show(() => $.ui.status(undefined))
      await update($, editing, () => null).catch(() => undefined)
    }
  }).catch(($, e, next) => (next.called ? next(e) : { deny: `human_edit failed: ${next.error.message}` }))

  // 編集してもらっているあいだ、プロンプトの上の帯に、ファイルと指示を出し続ける。
  // WHY AbovePrompt: editorはtmuxのpaneを縦に割って開くので、Claude Codeの側は幅が変わらず、帯はそのまま見える。
  // WHY NOT Pane: Modが自分から開くpaneは、ターミナルが144桁より狭いと描かれない
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const now = await read($, editing)
    // 調査（survey）が帯を使っているあいだは譲る
    if (now === null || e.props.hasSurvey) return next(e)
    const { Box, Text } = $.ui.resolve(e)
    return (
      <Box flexDirection="column" width={e.props.bodyColumns}>
        <Box flexDirection="row" columnGap={1}>
          <Text bold color={ACCENT}>
            human_edit
          </Text>
          <Text>{now.path}</Text>
          <Text dimColor>下のpaneで編集中。editorを閉じると戻ります</Text>
        </Box>
        {now.instructions !== null && <Text>{now.instructions}</Text>}
      </Box>
    )
  })
}
