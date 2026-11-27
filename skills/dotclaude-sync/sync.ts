// dotclaude の作業コピーに溜まった変更を、まとめてコミットして push するための、判断の要らない手。
//   bun sync.ts plan                       変わっているファイルを、書いたセッションごとに束ねて出す
//   bun sync.ts check                      作業コピーで足した行を検査する（公開しない名前、指す先の実在）
//   bun sync.ts commit -F <msg> <path…>    メッセージを検査してから、そのファイルだけをコミットする
//   bun sync.ts push                       リモートの main に追いつき、検査して push し、記録を片付ける
//   bun sync.ts prune                      作業コピーに残っていないファイルの記録を消す
// 判断（どう分けるか、メッセージに何を書くか、名前を読んで見つけること）は、スキルの本文が受け持つ。
// WHY 記録の形は Mod の関数で読む: 書く側と読む側で形を 1 か所に寄せる
import { existsSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'

import { type Entry, formatEntry, LEDGER_DIR, parseEntries } from '../../mods/dotclaude-ledger/hooks/ledger'
import { candidatesText, foldEvents, parseEvents, RETRO_DIR } from '../../mods/retro/hooks/candidates'
import { growthNotice } from '../curate-docs/growth'

// リポジトリの直下。このファイルは skills/dotclaude-sync/ にある。~/.claude/skills のリンクから呼ばれても実体で数える
const root = dirname(dirname(dirname(realpathSync(import.meta.path))))
const ledgerDir = join(homedir(), LEDGER_DIR)
const CLAUDE_LINKS = ['docs', 'skills', 'rules', 'agents', 'commands', 'archive']

const run = (argv: string[]): { code: number; out: string; err: string } => {
  const ran = Bun.spawnSync(argv, { cwd: root })
  return { code: ran.exitCode, out: ran.stdout.toString(), err: ran.stderr.toString() }
}

// WHY 成功しても stderr を出す: jj は結果（作ったコミット、push した先）を stderr に書く。
//   出さないと、確かめるために jj log を呼び直すことになる
const must = (argv: string[]): string => {
  const ran = run(argv)
  if (ran.code !== 0) throw new Error(`${argv.join(' ')} failed:\n${ran.err}${ran.out}`)
  process.stderr.write(ran.err)
  return ran.out
}

const lines = (text: string): string[] => text.split('\n').filter(line => line !== '')

// 作業コピー（@）で変わっているファイル。リポジトリの直下からの相対パス
const changedFiles = (): Set<string> => new Set(lines(must(['jj', 'diff', '--name-only', '-r', '@'])))

const ledgerFiles = (): string[] => {
  try {
    return readdirSync(ledgerDir)
      .filter(name => name.endsWith('.jsonl'))
      .map(name => join(ledgerDir, name))
  } catch {
    // 記録がまだ 1 件も無い
    return []
  }
}

const entries = (): Entry[] => ledgerFiles().flatMap(path => parseEntries(readFileSync(path, 'utf8')))

const writerOf = (entry: Entry): string => (entry.agentId === undefined ? `session=${entry.session}` : `session=${entry.session} agent=${entry.agentId}`)

const oneLine = (text: string): string => text.replaceAll('\n', ' ')

// 書いたセッション（サブエージェントは別）ごとに、そのセッションだけが書いたファイルを束ねる。
// 複数のセッションが書いたファイルと、記録の無いファイルは別に出す。どちらも、差分を読んで分けるか決める
const plan = (): void => {
  const changed = changedFiles()
  if (changed.size === 0) {
    console.log('作業コピーに変更はありません')
    return
  }
  const known = entries().filter(entry => changed.has(entry.file))
  const writersOf = new Map<string, Set<string>>()
  for (const entry of known) writersOf.set(entry.file, (writersOf.get(entry.file) ?? new Set()).add(writerOf(entry)))
  const groups = new Map<string, Entry[]>()
  for (const entry of known) groups.set(writerOf(entry), [...(groups.get(writerOf(entry)) ?? []), entry])

  for (const [writer, mine] of groups) {
    const files = [...new Set(mine.map(entry => entry.file))].filter(file => writersOf.get(file)?.size === 1)
    if (files.length === 0) continue
    const last = mine.at(-1)
    console.log(`## ${writer}`)
    console.log(`  cwd: ${last?.cwd ?? ''}`)
    for (const why of [...new Set(mine.map(entry => entry.why))]) console.log(`  why: ${oneLine(why)}`)
    for (const file of files.sort()) console.log(`  - ${file}`)
  }
  const mixed = [...writersOf].filter(([, writers]) => writers.size > 1)
  if (mixed.length > 0) {
    console.log('## 複数のセッションが書いたファイル（差分を読み、必要なら jj split で分ける）')
    for (const [file] of mixed) {
      console.log(`  - ${file}`)
      for (const entry of known.filter(one => one.file === file)) console.log(`      ${writerOf(entry)}: ${oneLine(entry.excerpt)}`)
    }
  }
  const unknown = [...changed].filter(file => !writersOf.has(file)).sort()
  if (unknown.length > 0) {
    console.log('## 記録の無いファイル（Bash で書いたか、Mod を入れる前の変更。差分だけで判断する）')
    for (const file of unknown) console.log(`  - ${file}`)
  }
}

// 足した行に書かれた ~/.claude/<リンク>/… のパスが、リポジトリに実在するか
const missingPaths = (added: string): string[] => {
  const pattern = new RegExp(`~/\\.claude/((?:${CLAUDE_LINKS.join('|')})/[A-Za-z0-9._/-]+)`, 'g')
  const paths = new Set([...added.matchAll(pattern)].map(match => (match[1] ?? '').replace(/[.]+$/, '')))
  return [...paths].filter(path => !path.includes('<') && !existsSync(join(root, path)))
}

const check = (): boolean => {
  let isClean = true
  const pub = run(['scripts/check-public.sh', '--working-copy'])
  process.stderr.write(pub.err)
  process.stdout.write(pub.out)
  if (pub.code !== 0) isClean = false
  const added = lines(must(['jj', 'diff', '--git', '-r', '@']))
    .filter(line => line.startsWith('+') && !line.startsWith('+++'))
    .join('\n')
  const missing = missingPaths(added)
  if (missing.length > 0) {
    console.error(`check: 足した行が指す次のパスが、リポジトリにありません:\n${missing.map(path => `  - ${path}`).join('\n')}`)
    isClean = false
  }
  // スキルと scripts/ の TypeScript は、速いので毎回全部を見る
  for (const argv of [
    ['bunx', 'tsc', '-p', 'tsconfig.json'],
    ['bun', 'test', 'skills', 'scripts'],
  ]) {
    const ran = run(argv)
    if (ran.code !== 0) {
      console.error(`check: ${argv.join(' ')} が落ちました:\n${ran.out}${ran.err}`)
      isClean = false
    }
  }
  // 変えた Mod のテストだけを走らせる。
  // WHY 全部を走らせない: 変えていない Mod のテストが落ちていると、そのたびにコミットが止まる。全体は scripts/check.sh で見る
  const mods = new Set([...changedFiles()].map(file => file.match(/^mods\/([^/]+)\//)?.[1]).filter(mod => mod !== undefined))
  for (const mod of mods) {
    // WHY validate も走らせる: 型の契約（types/index.d.ts）の書き方の誤りは、テストでは落ちず、読み込みで弾かれる
    const validated = run(['claude', 'plugin', 'validate', `mods/${mod}`])
    if (validated.code !== 0) {
      console.error(`check: mods/${mod} の claude plugin validate が落ちました:\n${validated.out.split('\n').filter(line => line.includes('❯') || line.includes('✘')).join('\n')}`)
      isClean = false
    }
    if (!existsSync(join(root, 'mods', mod, 'tests'))) continue
    const tested = run(['claude', 'plugin', 'test', `mods/${mod}`])
    if (tested.code !== 0) {
      console.error(`check: mods/${mod} のテストが落ちました:\n${tested.out}${tested.err}`)
      isClean = false
    }
  }
  if (isClean) console.log('check: 問題は見つかりませんでした')
  return isClean
}

// 記録にある、ほかのプロジェクトの名前（github.com/<組織>/<リポジトリ> の 2 つ）とセッションの ID。
// WHY メッセージから止める: 記録の cwd と why を材料に WHY を書くので、名前を書き写しやすい
const privateWords = (): string[] => {
  const ownOwner = root.match(/github\.com\/([^/]+)\//)?.[1]
  const words = new Set<string>()
  for (const entry of entries()) {
    words.add(entry.session)
    if (entry.cwd.startsWith(root)) continue
    const repo = entry.cwd.match(/github\.com\/([^/]+)\/([^/]+)/)
    const names = repo === null ? [entry.cwd.slice(entry.cwd.lastIndexOf('/') + 1)] : [repo[1] ?? '', repo[2] ?? '']
    for (const name of names) if (name.length >= 4 && name !== ownOwner) words.add(name)
  }
  return [...words]
}

const commit = (args: string[]): void => {
  const at = args.indexOf('-F')
  const messageFile = at === -1 ? undefined : args[at + 1]
  const paths = args.filter((_, index) => index !== at && index !== at + 1)
  if (messageFile === undefined || paths.length === 0) throw new Error('usage: bun sync.ts commit -F <message file> <path…>')
  const message = readFileSync(messageFile, 'utf8')
  if (!/^Co-Authored-By: /m.test(message)) throw new Error('メッセージの末尾に、システムが渡した帰属の行（Co-Authored-By と Claude-Session）を入れる')
  const leaked = privateWords().filter(word => message.toLowerCase().includes(word.toLowerCase()))
  if (leaked.length > 0) throw new Error(`メッセージに、記録にあるプロジェクトの名前かセッションの ID が入っています: ${leaked.join(', ')}。「ある案件で」のように書き直す`)
  process.stdout.write(must(['jj', 'commit', ...paths, '-m', message]))
}

const prune = (): void => {
  const changed = changedFiles()
  for (const path of ledgerFiles()) {
    const kept = parseEntries(readFileSync(path, 'utf8')).filter(entry => changed.has(entry.file))
    if (kept.length === 0) rmSync(path)
    else writeFileSync(path, kept.map(formatEntry).join(''))
  }
}

// リモートの main に追いつき、検査して push する。
// WHY 追いつく: ほかのセッションも dotclaude にコミットして push している。遅れたまま push すると拒まれる
const push = (): void => {
  must(['jj', 'git', 'fetch'])
  const behind = lines(must(['jj', 'log', '--no-graph', '-r', 'main@origin ~ ::@', '-T', 'commit_id ++ "\\n"']))
  if (behind.length > 0) {
    process.stdout.write(must(['jj', 'rebase', '-b', '@', '-d', 'main@origin']))
  }
  const conflicted = lines(must(['jj', 'log', '--no-graph', '-r', 'conflicts() & (main@origin..@)', '-T', 'change_id.short() ++ "\\n"']))
  if (conflicted.length > 0) throw new Error(`rebase で競合しました: ${conflicted.join(', ')}。直してから push し直す`)
  const ahead = lines(must(['jj', 'log', '--no-graph', '-r', 'main@origin..@- ~ empty()', '-T', 'commit_id ++ "\\n"']))
  if (ahead.length === 0) {
    console.log('push するコミットがありません')
    return
  }
  must(['jj', 'bookmark', 'set', 'main', '-r', '@-'])
  const pub = run(['scripts/check-public.sh', 'origin', 'main'])
  process.stdout.write(pub.out)
  process.stderr.write(pub.err)
  if (pub.code !== 0) throw new Error('check-public.sh が止めました。挙がった行を直してから push し直す')
  process.stdout.write(must(['jj', 'git', 'push', '-b', 'main']))
  prune()
  // WHY push の後に測る: 指示の文書が増えるのは、ほかのセッションの書き込みがここで入るとき
  const notice = growthNotice()
  if (notice !== null) console.log(notice)
  const requests = pendingRequests()
  if (requests !== '') console.log(`\nスキル、エージェント、Mod への要望（retro の控え。直したら mcp__retro__drop_finding で外す）:\n${requests}`)
}

// retro の控えのうち、スキル、エージェント、Mod への要望を、回数の多い順に出す。
// WHY ここで出す: 要望を直すのは、dotclaude で開いたセッションだけ。push のたびに目に入るようにする
const pendingRequests = (): string => {
  const dir = join(homedir(), RETRO_DIR)
  if (!existsSync(dir)) return ''
  const events = readdirSync(dir)
    .filter(name => name.endsWith('.jsonl'))
    .flatMap(name => parseEvents(readFileSync(join(dir, name), 'utf8')))
  const requests = foldEvents(events).filter(one => one.kind === 'request')
  return requests.length === 0 ? '' : candidatesText(requests)
}

const [command, ...rest] = process.argv.slice(2)
try {
  if (command === 'plan') plan()
  else if (command === 'check') process.exit(check() ? 0 : 1)
  else if (command === 'commit') commit(rest)
  else if (command === 'push') push()
  else if (command === 'prune') prune()
  else {
    console.error('usage: bun sync.ts plan|check|commit -F <msg> <path…>|push|prune')
    process.exit(2)
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
}
