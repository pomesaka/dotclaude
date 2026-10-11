// Bash のコマンドを、実行されるコマンドの並びに分ける。
// シェルの文法の全部は読まない。変数の展開はせず、語のまま残す

// ヒアドキュメント（<<EOF … EOF）の中身を取り除く。中身は、ファイルに書く文章や、ほかの言語のスクリプトで、シェルのコマンドではない。
// シェルに渡すヒアドキュメント（bash <<EOF）の中身は、実行されるコマンドなので残す
export const withoutHeredocs = (command: string): string => {
  const kept: string[] = []
  // 読み飛ばしている最中の、終わりの目印。null は、読み飛ばしていない
  let until: { tag: string; isIndented: boolean } | null = null
  for (const line of command.split('\n')) {
    if (until !== null) {
      if ((until.isIndented ? line.trim() : line) === until.tag) until = null
      continue
    }
    kept.push(line)
    const found = /^(.*?)<<(-?)\s*(['"]?)([A-Za-z_][A-Za-z0-9_]*)\3/.exec(line)
    const tag = found?.[4]
    if (found === null || tag === undefined) continue
    const isForShell = /(^|[\s;|&(])(ba|z)?sh(\s+-\w+)*\s*$/.test(found[1] ?? '')
    if (!isForShell) until = { tag, isIndented: found[2] === '-' }
  }
  return kept.join('\n')
}

// 引用符の外の区切り（; | & 改行、括弧、バッククォート）でコマンドを分け、それぞれを語に分ける
export const segmentsOf = (command: string): string[][] => {
  const segments: string[][] = []
  let words: string[] = []
  let word = ''
  let hasWord = false
  let quote: '"' | "'" | null = null
  const endWord = (): void => {
    if (hasWord) words.push(word)
    word = ''
    hasWord = false
  }
  const endSegment = (): void => {
    endWord()
    if (words.length > 0) segments.push(words)
    words = []
  }
  for (let at = 0; at < command.length; at++) {
    const char = command[at] ?? ''
    if (quote !== null) {
      if (char === quote) quote = null
      else if (char === '\\' && quote === '"' && at + 1 < command.length) word += command[++at] ?? ''
      else word += char
      continue
    }
    if (char === '"' || char === "'") {
      quote = char
      hasWord = true
    } else if (char === '\\' && at + 1 < command.length) {
      word += command[++at] ?? ''
      hasWord = true
    } else if (';|&\n()`'.includes(char)) endSegment()
    else if (char === ' ' || char === '\t') endWord()
    else {
      // $( は、中のコマンドの始まり。$ を語に残さない
      if (char === '$' && command[at + 1] === '(') continue
      word += char
      hasWord = true
    }
  }
  endSegment()
  return segments
}

// 実行するコマンドの名前（道筋を除いたもの）と、その後ろの語
export type Invocation = { name: string; args: string[] }

// ほかのコマンドを包んで実行するコマンド。これと、その指定を飛ばした次の語が、実行するコマンド
const WRAPPERS = new Set(['command', 'builtin', 'exec', 'nohup', 'time', 'xargs', 'env', 'timeout', 'gtimeout', 'nice', 'ionice', 'caffeinate', 'stdbuf'])
// 包むコマンドの指定のうち、次の語を値として取るもの（xargs -I {}、nice -n 10 など）
const WRAPPER_VALUE_FLAGS = new Set(['-I', '-J', '-L', '-n', '-P', '-R', '-s', '-E', '-k', '-S', '-u', '-w'])
// 管理者や別の利用者として実行するコマンド。後ろに何が続いても、名前を sudo に揃えて返す
const ELEVATING = new Set(['sudo', 'doas', 'su'])
const isAssignment = (word: string): boolean => /^[A-Za-z_][A-Za-z0-9_]*=/.test(word)
// 文字列をコマンドとして実行するシェル
const SHELLS = new Set(['sh', 'bash', 'zsh'])
// 入れ子を読む深さの上限
const DEPTH_MAX = 3

const invocationOf = (words: string[]): Invocation | null => {
  for (let at = 0; at < words.length; at++) {
    const word = words[at] ?? ''
    if (isAssignment(word)) continue
    const name = word.split('/').at(-1) ?? word
    if (ELEVATING.has(name)) return { name: 'sudo', args: words.slice(at + 1) }
    if (!WRAPPERS.has(name)) return { name, args: words.slice(at + 1) }
    // 包むコマンドの指定、待ち時間（timeout 5）、環境変数（env A=1）を飛ばす
    while (at + 1 < words.length) {
      const next = words[at + 1] ?? ''
      if (next.startsWith('-')) at += WRAPPER_VALUE_FLAGS.has(next) ? 2 : 1
      else if (/^\d+(\.\d+)?[smhd]?$/.test(next) || isAssignment(next)) at += 1
      else break
    }
  }
  return null
}

// コマンドに含まれる呼び出しを、書かれた順に返す。sh -c "…" と eval "…" は、中のコマンドも読む
export const invocationsOf = (command: string, depth = 0): Invocation[] =>
  segmentsOf(command)
    .map(invocationOf)
    .filter(invocation => invocation !== null)
    .flatMap(invocation => {
      const inner = SHELLS.has(invocation.name)
        ? invocation.args[invocation.args.indexOf('-c') + 1]
        : invocation.name === 'eval'
          ? invocation.args.join(' ')
          : undefined
      const isNested = inner !== undefined && depth < DEPTH_MAX && (invocation.name === 'eval' || invocation.args.includes('-c'))
      return isNested ? [invocation, ...invocationsOf(inner, depth + 1)] : [invocation]
    })
