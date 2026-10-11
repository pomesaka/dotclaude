import type { EngineInterface, Register } from 'claude-code'
import { commandLinesOf, dangersOf, isProtected, type Danger } from './danger'

const ASK = 'If the user really wants this, ask them to run it themselves with `! <command>`.'

// 拒む理由に並べる、巻き込まれるプロセスの数の上限
const LISTED_MAX = 8
// 一度に止めてよいプロセスの数。超えたら、利用者のアプリを含まなくても拒む
// WHY 30: テストが立てたサーバーやブラウザをまとめて片付ける呼び出しは通したい。目安で、測って決めた値ではない
const MATCHED_MAX = 30

// そのコマンドが PID として出したプロセスのコマンドライン。調べられなければ null
const matchedBy = async ($: EngineInterface, argv: string[]): Promise<string[] | null> => {
  const found = await $.process.run(argv, { timeoutMs: 5_000 })
  // 1 は、一致するプロセスが無い（pgrep も lsof も同じ）。ほかは、引数の誤りなど。止めるコマンドも同じ理由で失敗するので、止めない
  if (found.exitCode === 1) return []
  if (found.exitCode !== 0) return null
  const pids = found.stdout
    .split('\n')
    .map(pid => pid.trim())
    .filter(pid => /^\d+$/.test(pid))
  if (pids.length === 0) return []
  const listed = await $.process.run(['ps', '-o', 'pid=,command=', '-p', pids.join(',')], { timeoutMs: 5_000 })
  return listed.exitCode === 0 ? commandLinesOf(listed.stdout) : null
}

const exists = async ($: EngineInterface, path: string): Promise<boolean> => (await $.process.run(['test', '-e', path], { timeoutMs: 5_000 })).exitCode === 0

// 呼び出しを止める理由を返す。止めないなら null
const blockReason = async ($: EngineInterface, danger: Danger, home: string | undefined): Promise<string | null> => {
  switch (danger.kind) {
    case 'deny':
      return danger.why
    case 'tmux': {
      // 利用者が開いているセッションは、Claude が試しに立てたものではない
      const attached = await $.process.run(['tmux', 'display-message', '-p', '-t', danger.target, '#{session_attached}'], { timeoutMs: 5_000 })
      if (attached.exitCode !== 0 || !(Number.parseInt(attached.stdout.trim(), 10) > 0)) return null
      return `danger-guard blocked this command: the tmux session "${danger.target}" has a client attached, so the user is using it; it holds their other Claude sessions. Close only the sessions you created. ${ASK}`
    }
    case 'repos': {
      for (const path of danger.paths) {
        if ((await exists($, `${path}/.git`)) || (await exists($, `${path}/.jj`))) {
          return `danger-guard blocked this command: ${path} is another repository, outside the working directory of this session. ${ASK}`
        }
      }
      return null
    }
    case 'match': {
      const matched = await matchedBy($, danger.argv)
      if (matched === null) return null
      const others = matched.filter(line => isProtected(line, home))
      if (others.length === 0 && matched.length <= MATCHED_MAX) return null
      const listed = (others.length > 0 ? others : matched).slice(0, LISTED_MAX).map(line => `  ${line.slice(0, 120)}`)
      return [
        others.length > 0
          ? `danger-guard blocked this command: ${danger.label} also matches ${others.length} process(es) that are the user's applications or the system's (${matched.length} matched in all):`
          : `danger-guard blocked this command: ${danger.label} matches ${matched.length} processes:`,
        ...listed,
        'With pkill -f the pattern is matched anywhere in the full command line ("cat" matches "/Applications/…").',
        `Signal the specific PIDs you started (kill <pid>), or use a pattern that matches only them, such as the full path of the script. List first with pgrep -fl. ${ASK}`,
      ].join('\n')
    }
  }
}

export const register: Register = on => {
  // Claude が Bash でコマンドを実行する前に、マシンや利用者のデータを広く壊しうる呼び出しが無いかを読む。あれば実行させない。
  // 見るのは、作業中のリポジトリの外まで壊すものだけ（広い場所の削除、ディスクの消去、電源、全プロセスの停止など）。
  // WHY: 別のセッションの pkill -f "cat" が、/Applications（Appli"cat"ions）の下のアプリを全部止めた（2026-10-11）。
  // ターミナルも止まり、その中の caffeinate も終わって、Mac がスリープした。同じ種類の事故をまとめて防ぐ。
  // WHY pkill は語の長さで決めない: 短くても安全な語（自分で立てたスクリプトの名前）があり、長くても危ない語がある。
  // 実際に一致するプロセスを数えるのが、いちばん確か。
  // WHY NOT settings.json の hook: hook は Mod にまとめる（2026-10-10 に利用者が決めた）
  on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
    const home = await $.env.get('HOME')
    for (const danger of dangersOf(e.command, { cwd: await $.session.cwd(), home })) {
      const reason = await blockReason($, danger, home)
      if (reason !== null) return { deny: reason }
    }
    return next(e)
    // WHY 調べられなかったら通す: この hook はすべての Bash を通る。読み損ねただけで、コマンドを止めない
  }).catch((_$, e, next) => next(e))
}
