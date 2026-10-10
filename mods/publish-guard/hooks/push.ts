// 行き先を書かない push が向かうリモート。jj も git も、設定が無ければ origin に送る
const DEFAULT_REMOTE = 'origin'

// 値を取る、git の全体のオプション。サブコマンドを探すときに、値ごと読み飛ばす
const GIT_VALUE_OPTIONS = ['-C', '-c', '--git-dir', '--work-tree', '--namespace']

// jj git push の引数から、リモートの名前を読む
const jjRemote = (args: string[]): string => {
  for (const [index, arg] of args.entries()) {
    if (arg === '--remote') return args[index + 1] ?? DEFAULT_REMOTE
    if (arg.startsWith('--remote=')) return arg.slice('--remote='.length)
  }
  return DEFAULT_REMOTE
}

// 1 つのコマンド（区切りをまたがない単位）が push なら、向かうリモートの名前を返す。push でなければ null
const remoteOf = (words: string[]): string | null => {
  // 先頭の VAR=value は読み飛ばす
  const start = words.findIndex(word => !/^[A-Za-z_][A-Za-z0-9_]*=/.test(word))
  const [program, ...rest] = start === -1 ? [] : words.slice(start)
  if (program === 'jj') {
    const at = rest.findIndex((word, index) => word === 'git' && rest[index + 1] === 'push')
    return at === -1 ? null : jjRemote(rest.slice(at + 2))
  }
  if (program === 'git') {
    let at = 0
    while (at < rest.length && (rest[at] ?? '').startsWith('-')) at += GIT_VALUE_OPTIONS.includes(rest[at] ?? '') ? 2 : 1
    if (rest[at] !== 'push') return null
    // git push の最初の位置引数がリモート。オプションしか無ければ既定のリモート
    return rest.slice(at + 1).find(word => !word.startsWith('-')) ?? DEFAULT_REMOTE
  }
  return null
}

// Bash のコマンドの中の push が向かうリモートの名前を、出てきた順に返す。push が無ければ空。
// WHY 区切りで分ける: `jj git fetch && jj git push` のように、ほかのコマンドの後ろに付くことが多い。
// WHY NOT シェルの構文を解析する: 引用符や $() の中までは追わない。Claude が打つ push は、ほぼ素の形で来る。
//   拾えなかった形は調べずに通るので、手で打つ push と同じく、check-public.sh を自分で走らせる前提になる
export const remotesOf = (command: string): string[] =>
  command
    .split(/&&|\|\||[;|&\n]/)
    .map(part => remoteOf(part.trim().split(/\s+/)))
    .filter(remote => remote !== null)

// バックアップ用の非公開のリモート。ぼかす前の履歴を持っているので、調べずに通す。
// WHY 名前で決める: リモートが公開かどうかを hook の中から確かめるには、GitHub に問い合わせることになり、push のたびに遅くなる
export const isBackupRemote = (remote: string): boolean => remote.startsWith('private')
