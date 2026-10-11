import type { JjCounts, LogEntry } from '../types'

// WHY --ignore-working-copy: 付けないと jj は実行のたびに作業コピーを記録し、操作ログが増える。
// ツールのたびに走る更新では記録を増やさない。
// 代わりに、最後に誰かが jj を実行した後のファイルの編集は数に入らない。
// 番の終わりにだけ SNAPSHOT_ARGV で記録して、追いつかせる
const QUIET = '--ignore-working-copy'

// 作業コピーを記録してから、変わったファイルを数える（CHANGED_ARGV から --ignore-working-copy を外したもの）。
// WHY 番の終わりだけ: Edit や Write で編集しただけでは jj に記録されず、作業の後も件数が古いままになる
// （2026-10-09 に利用者から指摘）。番の終わりは Claude のコマンドが動いていないので、記録がぶつからない。
// 記録が増えるのは、番のあいだにファイルが変わったときだけ（jj st を 1 回打つのと同じ）
export const SNAPSHOT_ARGV = ['jj', 'diff', '--summary', '-r', '@']

// どのリモートにも無い、空でないコミット。作業コピーのコミット（@）も、中身があれば数える
export const UNPUSHED_ARGV = ['jj', 'log', QUIET, '--no-graph', '-r', '(::@ ~ ::remote_bookmarks()) ~ empty()', '-T', '"x\\n"']

// 作業コピーのコミット（@）で変わったファイル。このリポジトリの運用では、まだコミットしていない変更にあたる
export const CHANGED_ARGV = ['jj', 'diff', QUIET, '--summary', '-r', '@']

// ログの pane に出す範囲。作業コピーから遡って 20 件
// WHY ancestors(@): 一直線の履歴を前提にしている。@ から辿れない別の枝は出ない
const LOG_REVSET = 'ancestors(@, 20)'

// 1 コミットを 1 行に、タブ区切りで出す。項目の順番は parseLog と対で決めている。
// pushed の判定は「どれかのリモートのブックマークから辿れるか」。帯の unpushed の数え方と同じ
const LOG_TEMPLATE = [
  'change_id.shortest(8)',
  'if(current_working_copy, "@", "")',
  'if(self.contained_in("::remote_bookmarks()"), "pushed", "")',
  'if(empty, "empty", "")',
  'local_bookmarks.map(|b| b.name()).join(",")',
  'committer.timestamp().ago()',
  'description.first_line()',
].join(' ++ "\\t" ++ ')

export const LOG_ARGV = ['jj', 'log', QUIET, '--no-graph', '-r', LOG_REVSET, '-T', `${LOG_TEMPLATE} ++ "\\n"`]

const AGE_UNITS: { [unit: string]: string } = {
  second: 's',
  minute: 'm',
  hour: 'h',
  day: 'd',
  week: 'w',
  month: 'mo',
  year: 'y',
}

// jj の「14 minutes ago」を「14m」に縮める。読めない形はそのまま返す
export const shortAge = (ago: string): string => {
  const match = /^(\d+) ([a-z]+?)s? ago$/.exec(ago)
  const unit = match?.[2] === undefined ? undefined : AGE_UNITS[match[2]]
  return match?.[1] === undefined || unit === undefined ? ago : `${match[1]}${unit}`
}

export const parseLog = (stdout: string): LogEntry[] =>
  stdout.split('\n').flatMap(line => {
    const [id, workingCopy, pushed, empty, bookmarks, age, ...title] = line.split('\t')
    if (id === undefined || id === '' || age === undefined) return []
    return [
      {
        id,
        isWorkingCopy: workingCopy === '@',
        isPushed: pushed === 'pushed',
        isEmpty: empty === 'empty',
        bookmarks: bookmarks === undefined || bookmarks === '' ? [] : bookmarks.split(','),
        age: shortAge(age),
        // 説明の 1 行目にタブが入っていても、切らずに戻す
        title: title.join('\t'),
      },
    ]
  })

export type RunResult = { exitCode: number; stdout: string }

const lineCount = (stdout: string): number => stdout.split('\n').filter(line => line.trim() !== '').length

// どちらかが失敗したら null。jj のリポジトリの外では exitCode が 1 になる
export const countsOf = (unpushed: RunResult, changed: RunResult): JjCounts | null =>
  unpushed.exitCode !== 0 || changed.exitCode !== 0
    ? null
    : { unpushed: lineCount(unpushed.stdout), changed: lineCount(changed.stdout) }
