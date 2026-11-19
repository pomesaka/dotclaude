// path が root の中か。root そのものも中とみなす
export const isUnder = (path: string, root: string): boolean => {
  const base = root.endsWith('/') ? root : `${root}/`
  return path === root || path.startsWith(base)
}

export const parentOf = (path: string): string => path.slice(0, Math.max(1, path.lastIndexOf('/')))

// Write の先が、知らせるべき場所か。作業ディレクトリの外で、親のフォルダがまだ無く、一時の置き場でもない。
// WHY 親のフォルダが無いことで見る: パスを 1 文字違えると、Write は親のフォルダを作って成功し、エラーにならない。
//   作業ディレクトリの外に新しくフォルダができたことが、写し間違いのいちばん確かな印になる
// WHY 作業ディレクトリの中は知らせない: 新しいモジュールのフォルダを作るのは、ふつうの作業
export const isStray = (filePath: string, hasParent: boolean, cwd: string, temps: readonly string[]): boolean =>
  !hasParent && filePath.startsWith('/') && !isUnder(filePath, cwd) && !temps.some(temp => isUnder(filePath, temp))

// Claude に添える文
export const noticeOf = (filePath: string, cwd: string): string =>
  [
    `write-guard: ${filePath} は作業ディレクトリ（${cwd}）の外で、親のフォルダ ${parentOf(filePath)} はこの Write で新しくできた。`,
    'パスを手で組み立てて 1 文字違えると、Write はこうして別の場所にフォルダを作って成功する。',
    '意図した場所なら、そのまま続ける。違うなら、書いたファイルとできたフォルダを消し、直前の道具の出力（Read や fd で読めたパス）から写したパスで書き直す。',
  ].join('\n')
