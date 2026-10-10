import type { EngineInterface, Register } from 'claude-code'
import { isBackupRemote, remotesOf } from './push'

// リポジトリの直下から見た、チェックのスクリプトの場所。これがあるリポジトリだけを守る
const CHECK = 'scripts/check-public.sh'
// 拒む理由に入れる、スクリプトの出力の長さの上限（文字数）。末尾を残す。結論の行は最後に出る
const OUTPUT_MAX = 3_000
// 全履歴を調べる最初の push でも終わる長さ
const CHECK_TIMEOUT_MS = 60_000

// 作業ディレクトリが入っているリポジトリの直下。リポジトリの外なら null
const rootOf = async ($: EngineInterface): Promise<string | null> => {
  const cwd = await $.session.cwd()
  for (const argv of [
    ['jj', 'root'],
    ['git', 'rev-parse', '--show-toplevel'],
  ]) {
    // jj や git が入っていない、リポジトリの外、など。次の道具で試す
    const ran = await $.process.run(argv, { cwd, timeoutMs: 5_000 }).catch(() => null)
    if (ran !== null && ran.exitCode === 0 && ran.stdout.trim() !== '') return ran.stdout.trim()
  }
  return null
}

// push を止める理由を返す。止めないなら null。
// WHY スクリプトを呼ぶ: 調べる中身は、手で push する前にも走らせる。Mod の中に書くと、同じ規則が 2 か所になる
const blockReason = async ($: EngineInterface, remotes: string[]): Promise<string | null> => {
  const root = await rootOf($)
  if (root === null) return null
  const script = `${root}/${CHECK}`
  const has = await $.process.run(['test', '-x', script], { timeoutMs: 5_000 })
  if (has.exitCode !== 0) return null
  for (const remote of remotes) {
    const ran = await $.process.run([script, remote], { cwd: root, timeoutMs: CHECK_TIMEOUT_MS })
    if (ran.exitCode === 0) continue
    const output = `${ran.stdout}\n${ran.stderr}`.trim()
    return [
      `publish-guard blocked the push to "${remote}": ${CHECK} found something that must not be published.`,
      output.length > OUTPUT_MAX ? `...${output.slice(-OUTPUT_MAX)}` : output,
      'Fix the lines it lists, then push again. Do not work around the check; if a hit is a false positive, tell the user.',
    ].join('\n')
  }
  return null
}

export const register: Register = on => {
  // Claude が公開のリモートへ push する前に、リポジトリのチェックを走らせる。問題があれば push を実行させない。
  // WHY Mod で止める: jj は git の pre-push hook を実行しない。このリポジトリの push は、ほとんどが Claude の Bash から出る。
  // WHY NOT settings.json の hook: hook は Mod にまとめる（2026-10-10 に利用者が決めた）
  on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
    const remotes = remotesOf(e.command).filter(remote => !isBackupRemote(remote))
    if (remotes.length === 0) return next(e)
    const reason = await blockReason($, remotes)
    return reason === null ? next(e) : { deny: reason }
    // WHY 調べられなかったら止める: 時間切れや実行の失敗を「問題なし」と読むと、調べないまま公開される
  }).catch(($, e, next) =>
    next.called ? next(e) : { deny: `publish-guard could not run ${CHECK}, so the push is blocked: ${next.error.message}` },
  )
}
