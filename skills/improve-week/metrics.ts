// Gengar（Claude Code の OpenTelemetry を受ける手元の Prometheus と Loki）から、直近の時間とトークンのかかり方を読む。
// 性能を直す所を探す材料にする。どこを直すかは、読んだエージェントが決める。
//
//   bun metrics.ts [--days 7]
//
// Prometheus か Loki が ready を返さなければ、そう書いて 1 で終わる。指標と属性の名前は
// ~/github.com/pomesaka/Gengar/docs/otel-metrics-reference.md にある
const PROMETHEUS = { base: 'http://127.0.0.1:9090', readyPath: '/-/ready' }
const LOKI = { base: 'http://127.0.0.1:3100', readyPath: '/ready' }
const SERVICE = '{service_name="claude-code"}'

const field = (value: unknown, key: string): unknown =>
  typeof value === 'object' && value !== null && key in value ? Reflect.get(value, key) : undefined

export type Row = { labels: { [key: string]: string }; value: number }

// Prometheus と Loki の instant query の答え（resultType vector）を行にする。値の大きい順
export const rowsOf = (body: unknown): Row[] => {
  const result = field(field(body, 'data'), 'result')
  if (!Array.isArray(result)) return []
  const rows = result.flatMap(item => {
    const pair = field(item, 'value')
    const value = Array.isArray(pair) ? Number(pair[1]) : Number.NaN
    const metric = field(item, 'metric')
    if (!Number.isFinite(value) || typeof metric !== 'object' || metric === null) return []
    const labels = Object.fromEntries(Object.entries(metric).flatMap(([key, label]) => (typeof label === 'string' ? [[key, label]] : [])))
    return [{ labels, value }]
  })
  return rows.sort((a, b) => b.value - a.value)
}

export const formatRows = (rows: Row[], keys: string[], top: number): string =>
  rows
    .slice(0, top)
    .map(row => `${Math.round(row.value).toLocaleString('en-US').padStart(14)}  ${keys.map(key => row.labels[key] ?? '-').join('  ')}`)
    .join('\n')

const isReady = async ({ base, readyPath }: { base: string; readyPath: string }): Promise<boolean> => {
  const ready = await fetch(`${base}${readyPath}`, { signal: AbortSignal.timeout(3_000) }).catch(() => null)
  return ready !== null && ready.ok
}

// 失敗は投げずに理由の文で返す。並べて投げたクエリの1つが先に落ちても、捕まらない reject で終了コードが 1 にならないように
const query = async (base: string, path: string, promql: string): Promise<Row[] | string> => {
  const url = `${base}${path}?${new URLSearchParams({ query: promql, time: String(Math.floor(Date.now() / 1000)) })}`
  try {
    const answer = await fetch(url, { signal: AbortSignal.timeout(30_000) })
    if (!answer.ok) return `取れなかった: ${answer.status} ${await answer.text()}`
    return rowsOf(await answer.json())
  } catch (error) {
    return `取れなかった: ${String(error)}`
  }
}

const main = async (args: string[]): Promise<void> => {
  const daysAt = args.indexOf('--days')
  const days = daysAt === -1 ? 7 : Number(args[daysAt + 1])
  if (!Number.isInteger(days) || days <= 0) {
    console.error('使い方: bun metrics.ts [--days 7]')
    process.exit(2)
  }
  const range = `${days}d`
  const servers = [PROMETHEUS, LOKI]
  const ready = await Promise.all(servers.map(isReady))
  const down = servers.filter((_, i) => ready[i] !== true)
  if (down.length > 0) {
    console.log(`ready が返らない: ${down.map(server => server.base).join(', ')}。Gengar の docker compose が動いていない`)
    process.exit(1)
  }
  const prometheus = (promql: string) => query(PROMETHEUS.base, '/api/v1/query', promql)
  const loki = (logql: string) => query(LOKI.base, '/loki/api/v1/query', logql)
  const sections: { title: string; keys: string[]; rows: Promise<Row[] | string> }[] = [
    {
      title: `トークン（種類とモデルごと、${range}）`,
      keys: ['type', 'model'],
      rows: prometheus(`sum by (type, model) (increase({__name__="claude_code.token.usage_tokens_total"}[${range}]))`),
    },
    {
      title: `スキルごとの API の所要時間の合計（ミリ秒、${range}）`,
      keys: ['skill_name'],
      rows: loki(`sum by (skill_name) (sum_over_time(${SERVICE} | event_name="api_request" | unwrap duration_ms [${range}]))`),
    },
    {
      title: `スキルごとの読んだキャッシュのトークン（${range}）`,
      keys: ['skill_name'],
      rows: loki(`sum by (skill_name) (sum_over_time(${SERVICE} | event_name="api_request" | unwrap cache_read_tokens [${range}]))`),
    },
    {
      title: `道具ごとの所要時間の合計（ミリ秒、${range}）`,
      keys: ['tool_name'],
      rows: loki(`sum by (tool_name) (sum_over_time(${SERVICE} | event_name="tool_result" | unwrap duration_ms [${range}]))`),
    },
    {
      title: `道具ごとの失敗の数（${range}）`,
      keys: ['tool_name'],
      rows: loki(`sum by (tool_name) (count_over_time(${SERVICE} | event_name="tool_result" | success="false" [${range}]))`),
    },
    {
      title: `所要時間の長いセッション（API の合計、ミリ秒、${range}）`,
      keys: ['session_id'],
      rows: loki(`topk(10, sum by (session_id) (sum_over_time(${SERVICE} | event_name="api_request" | unwrap duration_ms [${range}])))`),
    },
  ]
  for (const section of sections) {
    console.log(`\n== ${section.title}`)
    const rows = await section.rows
    console.log(typeof rows === 'string' ? rows : formatRows(rows, section.keys, 15) || '（0 件）')
  }
}

if (import.meta.main) await main(process.argv.slice(2))
