// コンペのフォルダを配る静的なサーバー。serve.ts（人が見る）と check.ts（撮る）が使う。
import { existsSync, statSync } from 'node:fs'
import { join, resolve, sep } from 'node:path'

// フォルダの外を指す道（../ や %2e%2e）は、ファイルを探す前に断る
export const filePath = (root: string, urlPath: string): string | null => {
  let decoded: string
  try {
    decoded = decodeURIComponent(urlPath)
  } catch {
    return null
  }
  const base = resolve(root)
  const target = resolve(join(base, decoded.endsWith('/') ? `${decoded}index.html` : decoded))
  if (target !== base && !target.startsWith(base + sep)) return null
  if (existsSync(target) && statSync(target).isDirectory()) return join(target, 'index.html')
  return target
}

export const startServer = (root: string, port: number, hostname = '127.0.0.1') =>
  Bun.serve({
    port,
    hostname,
    fetch(req) {
      const path = filePath(root, new URL(req.url).pathname)
      if (path === null) return new Response('forbidden', { status: 403 })
      const file = Bun.file(path)
      // 作り直したモックをすぐ見られるように、ブラウザに持たせない
      return file.exists().then((ok) => (ok ? new Response(file, { headers: { 'cache-control': 'no-store' } }) : new Response('not found', { status: 404 })))
    },
  })
