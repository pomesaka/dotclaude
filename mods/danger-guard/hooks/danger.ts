// Bash のコマンドから、マシンや利用者のデータを広く壊しうる呼び出しを読み取る。
// 対象は、作業中のリポジトリの外まで壊すもの。リポジトリの中の操作（git reset、jj abandon など）は見ない

import { broadTargetReason, resolve, type Place } from './paths'
import { invocationsOf, type Invocation } from './shell'

export type Danger =
  // 実行させない。why は、Claude に返す理由（英語）
  | { kind: 'deny'; why: string }
  // 名前やコマンドラインの一致でプロセスを止める。pgrep は、同じプロセスを数えるための引数。
  // 何が止まるかを数えてから決める
  | { kind: 'match'; pgrep: string[] }

const deny = (why: string): Danger[] => [{ kind: 'deny', why }]

// 指定でない語（- で始まらない語）。-- の後ろは、すべて指定でない語
const operandsOf = (args: string[]): string[] => {
  const separator = args.indexOf('--')
  return separator === -1 ? args.filter(word => !word.startsWith('-')) : [...args.slice(0, separator).filter(word => !word.startsWith('-')), ...args.slice(separator + 1)]
}

// まとめて書いた 1 文字の指定（-rf）か、長い指定（--recursive）に、その指定があるか
const hasFlag = (args: string[], letters: string, long: string): boolean =>
  args.some(word => word === long || (/^-[A-Za-z]+$/.test(word) && Array.from(letters).some(letter => word.includes(letter))))

// 語の中に、広い場所を指すものがあれば、その理由
const firstBroad = (words: string[], place: Place, project: string): string | null => {
  for (const word of words) {
    const reason = broadTargetReason(word, place, project)
    if (reason !== null) return reason
  }
  return null
}

const ASK = 'If the user really wants this, ask them to run it themselves with `! <command>`.'

// pkill に渡すシグナルの指定（-9、-INT、-SIGTERM）。pgrep には渡せない。
// WHY 大文字 2 文字以上: 1 文字の大文字（-F、-G、-P、-U）は、pgrep と共通の絞り込みの指定
const isSignal = (word: string): boolean => /^-(\d+|(SIG)?[A-Z][A-Z0-9]+)$/.test(word)
// 次の語を値として取る指定（macOS の pkill(1) で確認）
const TAKES_VALUE = new Set(['-F', '-G', '-P', '-U', '-d', '-g', '-t', '-u'])

// pkill と pgrep の引数を、同じプロセスに一致する pgrep の引数に直す。一致させる語が無ければ null。
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
  if (pattern === null || pattern === '' || pattern.includes('$')) return null
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

// 1 つの呼び出しが危険なら、その中身。危険でなければ空。
// hasKill は、同じコマンドの中に kill があるか（pgrep の結果が kill に渡る形を拾うため）
const dangersOfOne = (invocation: Invocation, place: Place, project: string, hasKill: boolean): Danger[] => {
  const { name, args } = invocation
  // リダイレクトでデバイスに書く（> /dev/disk2）。どのコマンドでも同じ
  const redirected = args.flatMap((word, at) => (/^\d*>>?$/.test(word) ? [args[at + 1] ?? ''] : [word.replace(/^\d*>>?/, '')].filter(rest => rest !== word)))
  if (redirected.some(isDevice)) return deny(`danger-guard blocked this command: it writes straight to a device (${redirected.find(isDevice)}). ${ASK}`)

  switch (name) {
    case 'rm': {
      if (!hasFlag(args, 'rR', '--recursive')) return []
      const reason = firstBroad(operandsOf(args), place, project)
      return reason === null ? [] : deny(`danger-guard blocked this command: it would recursively delete ${reason}. Delete the specific paths you created instead. ${ASK}`)
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
      const endsSession = /\b(shut ?down|restart|log ?out)\b/i.test(script) && /System Events|loginwindow|Finder/i.test(script)
      return endsSession ? deny(`danger-guard blocked this command: the script shuts down, restarts or logs out of the machine. ${ASK}`) : []
    }
    case 'crontab':
      return args.includes('-r') ? deny(`danger-guard blocked this command: crontab -r removes every scheduled job of the user. ${ASK}`) : []
    case 'tmux': {
      const isAll = args.includes('kill-server') || (args.includes('kill-session') && args.includes('-a'))
      return isAll ? deny(`danger-guard blocked this command: it ends tmux sessions other than the one you started, which hold the user's other Claude sessions. Use tmux kill-session -t <name>. ${ASK}`) : []
    }
    case 'kill':
      return killsEverything(args)
        ? deny(`danger-guard blocked this command: "kill … -1" signals every process the user owns, including the terminal, the browser and other sessions. Signal the specific PIDs instead. ${ASK}`)
        : []
    case 'pkill':
    case 'pgrep': {
      if (name === 'pgrep' && !hasKill) return []
      const pgrep = pgrepArgsOf(args)
      return pgrep === null ? [] : [{ kind: 'match', pgrep }]
    }
    case 'killall': {
      // killall は、名前がちょうど一致するプロセスを止める。-u などの値を取る指定は、値ごと落とす
      const names = args.filter((word, at) => !word.startsWith('-') && !['-u', '-t', '-c', '-s'].includes(args[at - 1] ?? '') && !word.includes('$'))
      return names.map((process): Danger => ({ kind: 'match', pgrep: ['-x', '--', process] }))
    }
    default:
      return name.startsWith('mkfs') || name.startsWith('newfs') ? deny(`danger-guard blocked this command: ${name} formats a filesystem. ${ASK}`) : []
  }
}

// :(){ :|:& };: の形。プロセスを増やし続けて、マシンを止める
const FORK_BOMB = /(\w+|:)\s*\(\s*\)\s*\{\s*\1\s*\|\s*\1\s*&\s*\}\s*;\s*\1/

// コマンドに含まれる危険な呼び出し。place.cwd は、セッションの作業ディレクトリ。
// コマンドの中の cd を追い、その後ろの相対の道筋は、移った先から読む
export const dangersOf = (command: string, place: Place): Danger[] => {
  if (FORK_BOMB.test(command)) return deny(`danger-guard blocked this command: it is a fork bomb. ${ASK}`)
  const project = place.cwd ?? '\0'
  const invocations = invocationsOf(command)
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
