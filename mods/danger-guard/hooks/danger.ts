// Bash のコマンドから、マシンや利用者のデータを広く壊しうる呼び出しを読み取る。
// 対象は、作業中のリポジトリの外まで壊すもの。リポジトリの中の操作（git reset、jj abandon など）は見ない

import { broadTargetReason, isInsideProject, preciousTargetReason, resolve, type Place } from './paths'
import { invocationsOf, withoutHeredocs, type Invocation } from './shell'

export type Danger =
  // 実行させない。why は、Claude に返す理由（英語）
  | { kind: 'deny'; why: string }
  // プロセスを止める。argv は、止まるプロセスの PID を 1 行ずつ出すコマンド（pgrep か lsof）。label は、理由に出す、止め方の言い表し。
  // 何が止まるかを数えてから決める
  | { kind: 'match'; argv: string[]; label: string }
  // tmux のセッション、ウィンドウ、pane を閉じる。target は -t の値。利用者が開いているセッションなら止める
  | { kind: 'tmux'; target: string }
  // 作業ディレクトリの外のディレクトリを再帰的に消す。別のリポジトリなら止める
  | { kind: 'repos'; paths: string[] }

const deny = (why: string): Danger[] => [{ kind: 'deny', why }]

// 指定でない語（- で始まらない語）。-- の後ろは、すべて指定でない語
const operandsOf = (args: string[]): string[] => {
  const separator = args.indexOf('--')
  return separator === -1 ? args.filter(word => !word.startsWith('-')) : [...args.slice(0, separator).filter(word => !word.startsWith('-')), ...args.slice(separator + 1)]
}

// まとめて書いた 1 文字の指定（-rf）か、長い指定（--recursive）に、その指定があるか
const hasFlag = (args: string[], letters: string, long: string): boolean =>
  args.some(word => word === long || (/^-[A-Za-z]+$/.test(word) && Array.from(letters).some(letter => word.includes(letter))))

// 語を順に調べて、最初に見つかった理由を返す
const firstOf = (words: string[], reasonOf: (word: string) => string | null): string | null => {
  for (const word of words) {
    const reason = reasonOf(word)
    if (reason !== null) return reason
  }
  return null
}

// 語の中に、広い場所を指すものがあれば、その理由
const firstBroad = (words: string[], place: Place, project: string): string | null => firstOf(words, word => broadTargetReason(word, place, project))

const ASK = 'If the user really wants this, ask them to run it themselves with `! <command>`.'

// pkill に渡すシグナルの指定（-9、-INT、-SIGTERM）。pgrep には渡せない。
// WHY 大文字 2 文字以上: 1 文字の大文字（-F、-G、-P、-U）は、pgrep と共通の絞り込みの指定
const isSignal = (word: string): boolean => /^-(\d+|(SIG)?[A-Z][A-Z0-9]+)$/.test(word)
// 次の語を値として取る指定（macOS の pkill(1) で確認）
const TAKES_VALUE = new Set(['-F', '-G', '-P', '-U', '-d', '-g', '-t', '-u'])

// pkill と pgrep の引数を、同じプロセスに一致する pgrep の引数に直す。数えるものが無ければ null。
// 一致させる語に変数が入っていたら null（何に一致するかを、実行する前に確かめられない）
const pgrepArgsOf = (args: string[]): string[] | null => {
  const kept: string[] = []
  let pattern: string | null = null
  for (let at = 0; at < args.length; at++) {
    const word = args[at] ?? ''
    if (word === '--') {
      pattern = args[at + 1] ?? null
      break
    }
    if (isSignal(word)) continue
    if (TAKES_VALUE.has(word)) {
      kept.push(word, args[++at] ?? '')
      continue
    }
    if (word.startsWith('-')) {
      // -l は一覧の指定、-I は確認の指定。どのプロセスに一致するかは変えない
      const flags = word.slice(1).replace(/[lI]/g, '')
      if (flags !== '') kept.push(`-${flags}`)
      continue
    }
    pattern = word
    break
  }
  if (kept.some(word => word.includes('$')) || (pattern !== null && pattern.includes('$'))) return null
  if (pattern === null || pattern === '') {
    // 語が無くても、利用者や端末で絞っていれば、その全部が止まる（pkill -u me）
    return kept.some(word => TAKES_VALUE.has(word)) ? kept : null
  }
  return [...kept, '--', pattern]
}

// kill が、自分の全プロセスを止める形か（kill -9 -1、kill -- -1）。
// WHY 2 つ目以降の -1 だけを見る: kill -1 <PID> は、その PID に SIGHUP を送るだけ
const killsEverything = (args: string[]): boolean => {
  const separator = args.indexOf('--')
  if (separator !== -1) return args.slice(separator + 1).includes('-1')
  return args.slice(1).includes('-1') && (args[0] ?? '').startsWith('-')
}

// ディスクを消したり作り直したりする diskutil の動詞（小文字で比べる）
const DISKUTIL_VERBS = new Set(['erasedisk', 'erasevolume', 'reformat', 'partitiondisk', 'zerodisk', 'randomdisk', 'secureerase', 'eraseoptical'])
// 書き込み先にしてよい /dev の下のもの
const SAFE_DEVICES = new Set(['/dev/null', '/dev/stdout', '/dev/stderr', '/dev/tty'])
const isDevice = (path: string): boolean => path.startsWith('/dev/') && !SAFE_DEVICES.has(path) && !path.startsWith('/dev/fd/')

// 語の並びから、リダイレクトの書き込み先を読む。isAppend は、追記（>>）か
const redirectsOf = (words: string[]): { target: string; isAppend: boolean }[] =>
  words.flatMap((word, at) => {
    const found = /^\d*(>>?)(.*)$/.exec(word)
    if (found === null) return []
    const target = found[2] !== '' ? (found[2] ?? '') : (words[at + 1] ?? '')
    // 2>&1 は、ファイルへの書き込みではない
    return target === '' || target.startsWith('&') ? [] : [{ target, isAppend: found[1] === '>>' }]
  })

// 作業ディレクトリの外の一時的な場所。別のリポジトリかを調べない
const SCRATCH = ['/private/tmp/', '/tmp/', '/private/var/folders/', '/var/folders/']

// tmux で、セッション、ウィンドウ、pane を閉じる動詞
const TMUX_KILLS = new Set(['kill-session', 'kill-window', 'kill-pane', 'killw', 'killp'])
// killall の指定のうち、次の語を値として取るもの
const KILLALL_VALUE_FLAGS = new Set(['-u', '-t', '-c', '-s'])

// 1 つの呼び出しが危険なら、その中身。危険でなければ空。
// hasKill は、同じコマンドの中に kill があるか（pgrep や lsof の結果が kill に渡る形を拾うため）
const dangersOfOne = (invocation: Invocation, place: Place, project: string, hasKill: boolean): Danger[] => {
  const { name, args } = invocation
  // リダイレクトは、どのコマンドでも同じに読む。行頭がリダイレクトの語なら、それも含める
  const redirects = redirectsOf([name, ...args])
  const device = redirects.find(redirect => isDevice(redirect.target))
  if (device !== undefined) return deny(`danger-guard blocked this command: it writes straight to a device (${device.target}). ${ASK}`)
  for (const redirect of redirects.filter(one => !one.isAppend)) {
    const reason = preciousTargetReason(redirect.target, place, project)
    if (reason !== null) return deny(`danger-guard blocked this command: the redirect would overwrite ${reason}. Edit the file instead, or append with >>. ${ASK}`)
  }

  switch (name) {
    case 'sudo':
      // WHY 丸ごと止める: 管理者の権限で動くコマンドは、守る範囲の外まで壊せる（2026-10-11 に利用者が決めた）
      return deny(`danger-guard blocked this command: running as root or as another user (sudo, doas, su) is not allowed here. Find a way that does not need it. ${ASK}`)
    case 'rm': {
      const targets = operandsOf(args)
      if (!hasFlag(args, 'rR', '--recursive')) {
        const reason = firstOf(targets, word => preciousTargetReason(word, place, project))
        return reason === null ? [] : deny(`danger-guard blocked this command: it would delete ${reason}. ${ASK}`)
      }
      const reason = firstBroad(targets, place, project)
      if (reason !== null) return deny(`danger-guard blocked this command: it would recursively delete ${reason}. Delete the specific paths you created instead. ${ASK}`)
      // 作業ディレクトリの外で、一時的な場所でもないディレクトリは、別のリポジトリかを調べる
      const outside = targets
        .filter(word => !/[*?[]/.test(word))
        .map(word => resolve(word, place))
        .filter(path => path !== null)
        .filter(path => !isInsideProject(path, project) && !SCRATCH.some(scratch => path.startsWith(scratch)))
      return outside.length === 0 ? [] : [{ kind: 'repos', paths: outside }]
    }
    case 'mv': {
      // 最後の語は、移す先
      const reason = firstBroad(operandsOf(args).slice(0, -1), place, project)
      return reason === null ? [] : deny(`danger-guard blocked this command: it would move ${reason} away. ${ASK}`)
    }
    case 'rsync': {
      if (!args.some(word => word.startsWith('--del'))) return []
      const destination = operandsOf(args).at(-1) ?? ''
      // host:path は、ほかのマシン
      const reason = destination.includes(':') ? null : broadTargetReason(destination, place, project)
      return reason === null ? [] : deny(`danger-guard blocked this command: rsync --delete would remove whatever the source lacks from ${reason}. ${ASK}`)
    }
    case 'find': {
      const first = args.findIndex(word => word.startsWith('-') || word === '(' || word === '!')
      const roots = first === -1 ? args : args.slice(0, first)
      const deletes = args.includes('-delete') || args.some((word, at) => (word === '-exec' || word === '-execdir' || word === '-ok') && (args[at + 1] ?? '').split('/').at(-1) === 'rm')
      // WHY project を渡さない: 作業ディレクトリの下を、名前で絞って消すのは、ふつうの片付け
      const reason = deletes ? firstBroad(roots, place, '\0') : null
      return reason === null ? [] : deny(`danger-guard blocked this command: find would delete files under ${reason}. Narrow the starting directory. ${ASK}`)
    }
    case 'chmod':
    case 'chown':
    case 'chgrp': {
      if (!hasFlag(args, 'R', '--recursive')) return []
      // 最初の語は、権限か所有者
      const reason = firstBroad(operandsOf(args).slice(1), place, project)
      return reason === null ? [] : deny(`danger-guard blocked this command: it would change permissions or ownership recursively on ${reason}. ${ASK}`)
    }
    case 'dd': {
      const target = args.find(word => word.startsWith('of='))?.slice(3)
      return target !== undefined && isDevice(target) ? deny(`danger-guard blocked this command: dd would overwrite a device (${target}). ${ASK}`) : []
    }
    case 'diskutil': {
      const verb = (args[0] ?? '').toLowerCase()
      const isApfsDelete = verb === 'apfs' && (args[1] ?? '').toLowerCase().startsWith('delete')
      return DISKUTIL_VERBS.has(verb) || isApfsDelete ? deny(`danger-guard blocked this command: diskutil ${args.slice(0, 2).join(' ')} erases a disk or a volume. ${ASK}`) : []
    }
    case 'shutdown':
    case 'reboot':
    case 'halt':
    case 'poweroff':
      return deny(`danger-guard blocked this command: ${name} stops the machine and every session on it. ${ASK}`)
    case 'launchctl': {
      const isSession = args[0] === 'reboot' || (args[0] === 'bootout' && /^(system|(gui|user)\/\d+)$/.test(args[1] ?? ''))
      return isSession ? deny(`danger-guard blocked this command: launchctl ${args.slice(0, 2).join(' ')} ends the whole login session. ${ASK}`) : []
    }
    case 'osascript': {
      const script = args.join(' ')
      if (/\b(shut ?down|restart|log ?out)\b/i.test(script) && /System Events|loginwindow|Finder/i.test(script)) {
        return deny(`danger-guard blocked this command: the script shuts down, restarts or logs out of the machine. ${ASK}`)
      }
      return /\bquit\b/i.test(script) ? deny(`danger-guard blocked this command: the script quits the user's applications. ${ASK}`) : []
    }
    case 'crontab':
      return args.includes('-r') ? deny(`danger-guard blocked this command: crontab -r removes every scheduled job of the user. ${ASK}`) : []
    case 'gh':
      return args[0] === 'repo' && args[1] === 'delete' ? deny(`danger-guard blocked this command: gh repo delete removes the repository from GitHub for good. ${ASK}`) : []
    case 'tmux': {
      const verb = args.find(word => TMUX_KILLS.has(word) || word === 'kill-server')
      if (verb === undefined) return []
      const others = `danger-guard blocked this command: it ends tmux sessions other than the one you started, which hold the user's other Claude sessions. Use tmux kill-session -t <the name you created>. ${ASK}`
      if (verb === 'kill-server' || args.includes('-a')) return deny(others)
      const target = args[args.indexOf('-t') + 1]
      // -t が無ければ、いまのセッション。Claude 自身が動いている場所
      if (!args.includes('-t') || target === undefined || target.includes('$')) return deny(others)
      return [{ kind: 'tmux', target }]
    }
    case 'kill':
      return killsEverything(args)
        ? deny(`danger-guard blocked this command: "kill … -1" signals every process the user owns, including the terminal, the browser and other sessions. Signal the specific PIDs instead. ${ASK}`)
        : []
    case 'pkill':
    case 'pgrep': {
      if (name === 'pgrep' && !hasKill) return []
      const pgrep = pgrepArgsOf(args)
      if (pgrep === null) return []
      return [{ kind: 'match', argv: ['pgrep', ...pgrep], label: pgrep.includes('--') ? `the pattern "${pgrep.at(-1) ?? ''}"` : `${name} ${pgrep.join(' ')}` }]
    }
    case 'killall': {
      // killall は、名前がちょうど一致するプロセスを止める。-u は、その利用者のものに絞る
      const user = args[args.indexOf('-u') + 1]
      const owned = args.includes('-u') && user !== undefined && !user.includes('$') ? ['-u', user] : []
      const names = args.filter((word, at) => !word.startsWith('-') && !KILLALL_VALUE_FLAGS.has(args[at - 1] ?? '') && !word.includes('$'))
      if (names.length === 0) return owned.length === 0 ? [] : [{ kind: 'match', argv: ['pgrep', ...owned], label: `killall ${owned.join(' ')}` }]
      return names.map((process): Danger => ({ kind: 'match', argv: ['pgrep', ...owned, '-x', '--', process], label: `the name "${process}"` }))
    }
    case 'lsof': {
      // lsof -ti:3000 | xargs kill、kill $(lsof -ti:3000)。そのポートやファイルを使っているものが、すべて止まる
      const prints = args.some(word => /^-[A-Za-z]*t/.test(word))
      return hasKill && prints && !args.some(word => word.includes('$')) ? [{ kind: 'match', argv: ['lsof', ...args], label: `lsof ${args.join(' ')}` }] : []
    }
    default:
      return name.startsWith('mkfs') || name.startsWith('newfs') ? deny(`danger-guard blocked this command: ${name} formats a filesystem. ${ASK}`) : []
  }
}

// 自分自身をパイプで 2 つ呼び、裏で動かす関数を定義して呼ぶ形。プロセスを増やし続けて、マシンを止める
const FORK_BOMB = /(\w+|:)\s*\(\s*\)\s*\{\s*\1\s*\|\s*\1\s*&\s*\}\s*;\s*\1/

// コマンドに含まれる危険な呼び出し。place.cwd は、セッションの作業ディレクトリ。
// コマンドの中の cd を追い、その後ろの相対の道筋は、移った先から読む
export const dangersOf = (command: string, place: Place): Danger[] => {
  // WHY ヒアドキュメントの中身を除く: ファイルに書く文章やスクリプトで、実行するコマンドではない。
  // コメントに書いた危険なコマンドの形で、編集そのものが止まった（2026-10-11）
  const script = withoutHeredocs(command)
  if (FORK_BOMB.test(script)) return deny(`danger-guard blocked this command: it is a fork bomb. ${ASK}`)
  const project = place.cwd ?? '\0'
  const invocations = invocationsOf(script)
  const hasKill = invocations.some(invocation => invocation.name === 'kill')
  let here: Place = place
  return invocations.flatMap(invocation => {
    if (invocation.name === 'cd' || invocation.name === 'pushd') {
      const target = operandsOf(invocation.args)[0]
      // cd だけならホーム。読めない行き先（変数、cd -）の後は、相対の道筋を読まない
      const next = target === undefined ? (here.home ?? null) : target === '-' ? null : resolve(target, here)
      here = { ...here, cwd: next }
      return []
    }
    return dangersOfOne(invocation, here, project, hasKill)
  })
}

// 止めてはいけないプロセスの置き場所。利用者のアプリと、OS のもの。
// WHY /usr/bin や /bin を入れない: 自分で立てたスクリプトも、/bin/bash や /usr/bin/python3 から始まるコマンドラインになる
const PROTECTED = ['/Applications/', '/System/', '/Library/', '/usr/libexec/', '/usr/sbin/', '/sbin/']
// 置き場所に関係なく止めてはいけないプログラム。ほかのセッションと、それを載せているもの
const PROTECTED_NAMES = new Set(['tmux', 'claude'])

// そのコマンドラインのプロセスが、利用者のアプリ、OS のもの、ほかのセッションのどれかか。home は、利用者のホーム
export const isProtected = (commandLine: string, home: string | undefined): boolean => {
  const program = commandLine.split(' ')[0] ?? ''
  return (
    PROTECTED.some(prefix => commandLine.startsWith(prefix)) ||
    (home !== undefined && home !== '' && commandLine.startsWith(`${home}/Applications/`)) ||
    PROTECTED_NAMES.has(program.split('/').at(-1) ?? '')
  )
}

// ps -o pid=,command= の出力を、行ごとのコマンドラインにする
export const commandLinesOf = (stdout: string): string[] =>
  stdout
    .split('\n')
    .map(line => line.trim().replace(/^\d+\s+/, ''))
    .filter(line => line !== '')
