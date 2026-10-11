// Bash のコマンドを、実行されるコマンドの並びに分ける。
// シェルの文法の全部は読まない。変数の展開はせず、語のまま残す

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

// コマンドの前に付く語。これらを飛ばした最初の語が、実行するコマンド
const PREFIXES = new Set(['sudo', 'command', 'exec', 'nohup', 'time', 'xargs', 'env'])
const isAssignment = (word: string): boolean => /^[A-Za-z_][A-Za-z0-9_]*=/.test(word)
// 文字列をコマンドとして実行するシェル
const SHELLS = new Set(['sh', 'bash', 'zsh'])
// 入れ子を読む深さの上限
const DEPTH_MAX = 3

const invocationOf = (words: string[]): Invocation | null => {
  const start = words.findIndex(word => !PREFIXES.has(word) && !isAssignment(word))
  const first = words[start]
  return first === undefined ? null : { name: first.split('/').at(-1) ?? first, args: words.slice(start + 1) }
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
