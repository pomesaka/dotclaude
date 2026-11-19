// コンペのフォルダを配り、人がブラウザで比較ページを見られるようにする。
//
//   bun serve.ts <コンペのフォルダ> [--port 5310]
//   portless <名前> bun ~/.claude/skills/design-competition/serve.ts <コンペのフォルダ>
//
// portless から呼ぶと、portless が渡す PORT で待ち受ける。止めるまで動き続けるので、
// エージェントはバックグラウンドで起動する。
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { startServer } from './server'

const args = process.argv.slice(2)
const dir = args.find((a) => !a.startsWith('--'))
const flag = args.indexOf('--port')
const port = Number(flag >= 0 ? args[flag + 1] : (process.env.PORT ?? 5310))

if (!dir || !existsSync(resolve(dir, 'index.html'))) {
  console.error(`使い方: bun serve.ts <コンペのフォルダ> [--port 5310]\n${dir ?? '(フォルダ無し)'} に index.html がありません。先に bun init.ts <フォルダ> で作ってください。`)
  process.exit(2)
}
if (!Number.isInteger(port) || port < 0) {
  console.error(`ポートが数ではありません: ${port}`)
  process.exit(2)
}

const server = startServer(resolve(dir), port)
console.log(`${resolve(dir)} を http://${server.hostname}:${server.port}/ で配っています`)
