import type { EditOutcome, EditRequest, HumanEditBackend } from './backend'

/**
 * pane内で走るwrapper。引数はargvで受け、シェル文字列に埋め込まない（path・instructionsはモデル由来）。
 * $1 editor  $2 file  $3 exit codeを書くファイル  $4 tmux wait-forのchannel  $5 instructions  $6 開く行（無ければ空）
 *
 * WHY exit codeをファイルに書く: tmux wait-forは終了コードを運ばない。paneが閉じた後でもmodが読める。
 * WHY 一時ファイルに書いてからmv: modは「ファイルがある＝書き終わった」と読むので、空ファイルを読ませない。
 */
export const WRAPPER_SCRIPT = `#!/bin/sh
editor=$1
file=$2
done_file=$3
channel=$4
instructions=$5
line=$6

if [ -n "$instructions" ]; then
  printf '%s\\n\\n' "$instructions"
  printf 'Press Enter to open %s ' "$file"
  read -r _
fi

if [ -z "$editor" ]; then
  for candidate in nvim vim vi; do
    if command -v "$candidate" >/dev/null 2>&1; then
      editor=$candidate
      break
    fi
  done
fi

if [ -z "$editor" ]; then
  printf 'human_edit: no editor found (set HUMAN_EDIT_EDITOR)\\n' >&2
  status=127
  sleep 3
else
  # WHY 引用符なしで展開: EDITOR="code --wait"のように引数付きで設定するのが慣習なので語分割させる。
  # glob展開だけは止める。editorはユーザー自身の環境変数でモデル入力ではない。
  # WHY +N: nvim、vim、viは「+行番号」でその行にカーソルを置いて開く。+Nが通じないeditorは使わない前提（2026-10-09に利用者が決めた）。
  # WHY \${line:+...}: 行の指定が無いときは何も足さず、editorの既定の位置で開く（shで展開を確認）
  set -f
  $editor \${line:+"+$line"} "$file"
  status=$?
  set +f
fi

printf '%s' "$status" > "$done_file.tmp" && mv "$done_file.tmp" "$done_file"
tmux wait-for -S "$channel"
exit "$status"
`

export type SplitWindowArgs = {
  targetPane: string
  cwd: string
  wrapperPath: string
  editor: string
  file: string
  doneFile: string
  channel: string
  instructions: string
  /** 開く行。指定が無ければ空文字 */
  line: string
}

// WHY 複数引数で渡す: tmux 3.xはshell-commandが2引数以上だとシェルを通さずexecvpする。
// 1つの文字列に連結するとシェル解釈され、path経由のコマンドインジェクションになる。
export const splitWindowArgv = (a: SplitWindowArgs): string[] => [
  'tmux', 'split-window', '-v', '-l', '40%',
  '-t', a.targetPane, '-c', a.cwd,
  '-P', '-F', '#{pane_id}',
  'sh', a.wrapperPath, a.editor, a.file, a.doneFile, a.channel, a.instructions, a.line,
]

export const waitForArgv = (channel: string): string[] => ['tmux', 'wait-for', channel]
// WHY list-panesで全列挙する: tmux 3.4の`display-message -p -t <消えたpane>`はexit 0で空文字を返し、生存判定に使えない
export const listPanesArgv = (): string[] => ['tmux', 'list-panes', '-a', '-F', '#{pane_id}']
export const killPaneArgv = (paneId: string): string[] => ['tmux', 'kill-pane', '-t', paneId]

export type RunResult = { exitCode: number; stdout: string; stderr: string }

export type TmuxDeps = {
  /** process.run相当。timeoutMsを過ぎたらrejectする */
  run: (argv: readonly string[], init?: { timeoutMs?: number }) => Promise<RunResult>
  write: (path: string, text: string) => Promise<void>
  read: (path: string) => Promise<string>
  exists: (path: string) => Promise<boolean>
  /** $TMUX_PANE。Claude Codeが動いているpaneを分割する */
  targetPane: string
  tmpRoot: string
  newId: () => string
}

/**
 * 1回のwait-forを区切る長さ。paneがユーザーに閉じられた（kill-pane / prefix + x）ときwrapperは
 * exit codeもsignalも残さずに消える（tmux 3.4で確認。HUPのtrapも実行されない）ので、この間隔でpaneの生存を確かめる。
 * WHY $.clock.sleepでポーリングしない: sleepはhookの10秒予算を消費する。process.runの待ちは消費しない。
 * WHY 1.5秒: tool callの中断（next.signal）はこの区切りの合間にしか見られない。中断後にhookが動いてよいのは
 * 5秒まで（型定義の`lingerMs: 5_000`、v2.1.294）なので、区切り + kill-paneがその中に収まる長さにする。
 * 長くすると中断後もpaneとgateが残り、直後のhuman_editが「already in progress」で失敗する。
 */
export const WAIT_SLICE_MS = 1_500

export const createTmuxBackend = (deps: TmuxDeps): HumanEditBackend => ({
  name: 'tmux',
  edit: async (request: EditRequest, signal: AbortSignal): Promise<EditOutcome> => {
    const id = deps.newId()
    const dir = `${deps.tmpRoot}/claude-human-edit/${id}`
    const wrapperPath = `${dir}/edit.sh`
    const doneFile = `${dir}/exit-code`
    const channel = `claude-human-edit-${id}`

    await deps.write(wrapperPath, WRAPPER_SCRIPT)
    try {
      const split = await deps.run(splitWindowArgv({
        targetPane: deps.targetPane,
        cwd: request.cwd,
        wrapperPath,
        editor: request.editor,
        file: request.absolutePath,
        doneFile,
        channel,
        instructions: request.instructions ?? '',
        line: request.line === undefined ? '' : String(request.line),
      }))
      if (split.exitCode !== 0) {
        throw new Error(`tmux split-window failed: ${split.stderr.trim()}`)
      }
      const paneId = split.stdout.trim()

      const readExit = async (): Promise<EditOutcome | undefined> => {
        if (!(await deps.exists(doneFile))) return undefined
        const code = Number.parseInt((await deps.read(doneFile)).trim(), 10)
        return Number.isNaN(code) ? { kind: 'cancelled' } : { kind: 'exited', exitCode: code }
      }

      for (;;) {
        if (signal.aborted) {
          await deps.run(killPaneArgv(paneId)).catch(() => undefined)
          return { kind: 'cancelled' }
        }
        const done = await readExit()
        if (done !== undefined) return done
        await deps.run(waitForArgv(channel), { timeoutMs: WAIT_SLICE_MS }).catch(() => undefined)
        const afterWait = await readExit()
        if (afterWait !== undefined) return afterWait
        const panes = await deps.run(listPanesArgv()).catch(() => undefined)
        const isAlive = panes !== undefined && panes.exitCode === 0 && panes.stdout.split('\n').includes(paneId)
        if (!isAlive) {
          // wrapperがexit codeを書いた直後にpaneが消えた場合を拾うため、もう一度だけ読む
          return (await readExit()) ?? { kind: 'cancelled' }
        }
      }
    } finally {
      await deps.run(['rm', '-rf', dir]).catch(() => undefined)
    }
  },
})
