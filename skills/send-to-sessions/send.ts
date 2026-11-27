// claude-deck の止まっているセッションに、入力欄が空のときだけ文を送る（/reload-plugins など）。
// 使い方: bun send.ts [--text <文>] [--only <名前,...>] [--dry-run]
//   --text   送る文。省けば /reload-plugins
//   --only   送るセッションの名前か alias（カンマ区切り、部分一致）。省けば止まっている全部
//   --dry-run 送らずに、送る先と飛ばす理由だけを出す
// 終了コード: 0 送った（--dry-run なら送れる先を出した）、2 引数の誤り、3 claude-deck か tmux を読めない

// 送ってよい状態。running と waiting_approval / waiting_answer に送ると、打った文が次の発言として積まれるか、
// 承認や回答の画面に入る
const SENDABLE = new Set(['idle', 'waiting_action'])
const DEFAULT_TEXT = '/reload-plugins'

export type Session = { id: string; name: string; alias: string; status: string }

/**
 * 画面の写し（色つき）から、入力欄に打たれている文を返す。入力欄が見つからなければ null。
 * WHY 薄い字を除く: 入力欄に薄い字（ESC[2m）で出る文は、次の発言の案で、利用者が打った文ではない。
 *   色を外して読むと、案も書きかけに見える（2026-11-28 に 17 個のセッションのうち 13 個がそう見えた）
 */
export function typedText(screen: string): string | null {
  const plain = (line: string) => line.replace(/\x1b\[[0-9;]*m/g, '')
  const prompt = screen.split('\n').reverse().find(line => plain(line).startsWith('❯'))
  if (prompt === undefined) return null
  return plain(prompt.replace(/\x1b\[2m.*?(\x1b\[0m|$)/g, '')).slice(1).trim()
}

export type Plan = { session: Session; action: 'send' } | { session: Session; action: 'skip'; reason: string }

/** 送るか飛ばすかを決める。screen は色つきの画面の写し、ウィンドウが無ければ null */
export function planFor(session: Session, self: string, only: string[], screen: string | null): Plan | null {
  if (session.id === self) return null
  if (only.length > 0 && !only.some(o => session.name.includes(o) || session.alias.includes(o))) return null
  if (screen === null) return null
  if (!SENDABLE.has(session.status)) return { session, action: 'skip', reason: session.status }
  const typed = typedText(screen)
  if (typed === null) return { session, action: 'skip', reason: '入力欄が見つからない' }
  if (typed !== '') return { session, action: 'skip', reason: `書きかけがある（${[...typed].slice(0, 30).join('')}）` }
  return { session, action: 'send' }
}

export function parseArgs(args: string[]): { text: string; only: string[]; dryRun: boolean } | string {
  let text = DEFAULT_TEXT
  let only: string[] = []
  let dryRun = false
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]
    const value = args[i + 1]
    if (arg === '--dry-run') dryRun = true
    else if (arg === '--text' && value !== undefined && value.trim() !== '') (text = value), i++
    else if (arg === '--only' && value !== undefined) (only = value.split(',').map(s => s.trim()).filter(Boolean)), i++
    else return `知らない引数か、値が無い: ${arg}`
  }
  if (text.includes('\n')) return '--text に改行は入れられない（入力欄で途中の Enter が送られる）'
  return { text, only, dryRun }
}

/** claude-deck list の JSON から、送り先を決めるのに要る欄だけを読む。id の無い行は捨てる */
export const sessionsOf = (raw: unknown): Session[] => {
  if (!Array.isArray(raw)) return []
  return raw.flatMap((s: unknown) => {
    if (typeof s !== 'object' || s === null) return []
    const field = (key: string) => (key in s && typeof Reflect.get(s, key) === 'string' ? String(Reflect.get(s, key)) : '')
    const id = field('id')
    return id === '' ? [] : [{ id, name: field('name') || id, alias: field('alias'), status: field('status') }]
  })
}

if (import.meta.main) {
  const run = (cmd: string[]) => {
    const r = Bun.spawnSync(cmd, { stdout: 'pipe', stderr: 'pipe' })
    return { ok: r.exitCode === 0, out: r.stdout.toString(), err: r.stderr.toString() }
  }
  const args = parseArgs(process.argv.slice(2))
  if (typeof args === 'string') {
    console.error(`send.ts: ${args}`)
    process.exit(2)
  }
  const bin = process.env.CLAUDE_DECK_BIN ?? 'claude-deck'
  const listed = run([bin, 'list'])
  const windows = run(['tmux', 'list-windows', '-t', 'claude-deck', '-F', '#{window_name}'])
  if (!listed.ok || !windows.ok) {
    console.error(`send.ts: claude-deck list か tmux list-windows が失敗した: ${(listed.err || windows.err).trim()}`)
    process.exit(3)
  }
  const open = new Set(windows.out.split('\n').filter(Boolean))
  const self = process.env.CLAUDE_DECK_SESSION_ID ?? ''
  let sent = 0
  for (const session of sessionsOf(JSON.parse(listed.out))) {
    const target = `claude-deck:${session.id}`
    const screen = open.has(session.id) ? run(['tmux', 'capture-pane', '-p', '-e', '-t', target, '-S', '-8']).out : null
    const plan = planFor(session, self, args.only, screen)
    if (plan === null) continue
    if (plan.action === 'skip') {
      console.log(`飛ばした ${session.name}: ${plan.reason}`)
      continue
    }
    if (args.dryRun) {
      console.log(`送れる ${session.name}`)
      continue
    }
    // -l で文字どおりに打ってから、Enter を別に送る。文の中の語が tmux のキー名として読まれないため
    run(['tmux', 'send-keys', '-t', target, '-l', args.text])
    run(['tmux', 'send-keys', '-t', target, 'Enter'])
    sent++
    console.log(`送った ${session.name}`)
  }
  if (!args.dryRun) console.log(`${sent} 個のセッションに「${args.text}」を送った。このセッションには送っていない`)
}
