import type { Candidate, Candidates, Finding, Kind } from '../types'

// 文書に上げる回数。WHY 2 回: 1 回きりの事故から書いた規則が積み重なり、11-16 からの 3 日で、よく読む文書が 1.5 倍になった（2026-11-19 に pomesaka と決めた）
export const PROMOTE_AT = 2
// 控えに持つ数と、1 件に持つ根拠の数
export const CANDIDATES_MAX = 100
export const EVIDENCE_MAX = 5

export const EMPTY_CANDIDATES: Candidates = { next: 1, list: [] }

const field = (value: unknown, key: string): unknown =>
  typeof value === 'object' && value !== null && key in value ? Reflect.get(value, key) : undefined

export const isKind = (value: unknown): value is Kind => value === 'doc' || value === 'mechanism'

const candidateOf = (value: unknown): Candidate[] => {
  const id = field(value, 'id')
  const title = field(value, 'title')
  const detail = field(value, 'detail')
  const kind = field(value, 'kind')
  const count = field(value, 'count')
  const evidence = field(value, 'evidence')
  const lastAt = field(value, 'lastAt')
  const writtenAt = field(value, 'writtenAt')
  if (typeof id !== 'string' || typeof title !== 'string' || typeof detail !== 'string' || !isKind(kind)) return []
  if (typeof count !== 'number' || typeof lastAt !== 'number') return []
  return [
    {
      id,
      title,
      detail,
      kind,
      count,
      evidence: Array.isArray(evidence) ? evidence.filter((one): one is string => typeof one === 'string') : [],
      lastAt,
      writtenAt: typeof writtenAt === 'number' ? writtenAt : null,
    },
  ]
}

// $.store から読んだ値を、控えとして読む。形が合わない項目は捨てる
export const candidatesOf = (stored: unknown): Candidates => {
  const list = field(stored, 'list')
  const next = field(stored, 'next')
  const read = Array.isArray(list) ? list.flatMap(candidateOf) : []
  const highest = Math.max(0, ...read.map(one => Number(one.id.replace(/^c/, '')) || 0))
  return { next: typeof next === 'number' && next > highest ? next : highest + 1, list: read }
}

// 文書に上げるか。仕組みにできる発見は、何回出ても文書に書かない
const shouldPromote = (candidate: Candidate, isSevere: boolean): boolean => candidate.kind === 'doc' && (candidate.count >= PROMOTE_AT || isSevere)

// 文書に上げた控えの回数を 0 に戻し、上げた時刻を付ける。
// WHY tally と分ける: 書き手を立てられなかったら、回数を残して次に出たときに上げ直す
// WHY 上げた後も控えに残す: 文書にした後でまた出たら、文が伝わっていない。もう一度上げて、書き手に文を直させる
export const markWritten = (current: Candidates, ids: readonly string[], at: number): Candidates => ({
  ...current,
  list: current.list.map(one => (ids.includes(one.id) ? { ...one, count: 0, writtenAt: at } : one)),
})

// 発見を控えに数え、文書に上げる控えを返す。
// WHY 落とす順: 回数の少ないものから、同じなら古いものから。何度も出ているものほど残す
export const tally = (current: Candidates, findings: readonly Finding[], at: number): { candidates: Candidates; promoted: Candidate[] } => {
  let next = current.next
  let list = [...current.list]
  const promoted: Candidate[] = []
  for (const finding of findings) {
    const before = finding.same === null ? undefined : list.find(one => one.id === finding.same)
    const counted: Candidate =
      before === undefined
        ? { id: `c${next++}`, title: finding.title, detail: finding.detail, kind: finding.kind, count: 1, evidence: [finding.evidence].filter(one => one !== ''), lastAt: at, writtenAt: null }
        : {
            ...before,
            detail: finding.detail,
            kind: finding.kind,
            count: before.count + 1,
            evidence: [finding.evidence, ...before.evidence].filter(one => one !== '').slice(0, EVIDENCE_MAX),
            lastAt: at,
          }
    if (shouldPromote(counted, finding.isSevere)) promoted.push(counted)
    list = [counted, ...list.filter(one => one.id !== counted.id)]
  }
  const ranked = [...list].sort((a, b) => b.count - a.count || b.lastAt - a.lastAt)
  const dropped = new Set(ranked.slice(CANDIDATES_MAX).map(one => one.id))
  return { candidates: { next, list: list.filter(one => !dropped.has(one.id)) }, promoted }
}

const KIND_LABEL: { [kind in Kind]: string } = { doc: '文書', mechanism: '仕組み' }

// 分岐に渡す控えの一覧。同じ発見を見分けるのに、見出しと防ぎ方だけを渡す
export const candidatesForJudge = (list: readonly Candidate[]): string =>
  list.length === 0 ? 'まだ無い' : list.map(one => `- ${one.id}（${KIND_LABEL[one.kind]}）${one.title}`).join('\n')

// /retro candidates で見せる一覧。回数の多い順
export const candidatesText = (list: readonly Candidate[]): string =>
  [...list]
    .sort((a, b) => b.count - a.count || b.lastAt - a.lastAt)
    .map(one => `${one.id}  ${one.count} 回  ${KIND_LABEL[one.kind]}${one.writtenAt === null ? '' : '（文書に上げた）'}  ${one.title}\n    ${one.detail}`)
    .join('\n')
