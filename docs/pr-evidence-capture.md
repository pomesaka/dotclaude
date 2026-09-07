# PR 証跡スクショの撮り方（オフライン・実 CSS 検証）

dev サーバーを起動せずに、PR の「動作確認」に貼る信頼できるスクショを作る手順。PDF オーバーレイ・canvas 描画・複雑な CSS 状態（hover/focus 等）を持つ UI で有効。

## パターン: 実装関数 → 本番 CSS と同一の HTML → 実ブラウザでスクショ

1. **実データを実装関数に通す**: モックでなく実ファイル（実 PDF 等）をリポジトリの実関数（座標計算・抽出処理など）に通し、本物の出力値を得る。
2. **本番と同一の CSS を展開した HTML を書く**: Tailwind クラスを手で列挙せず、実装側の定数（例: `MARK_KIND_CLASS` のようなスタイル定義オブジェクト）の値をそのまま `.tsx`/`.ts` から import するか、コメントで「この CSS は `<定数名>` の値をそのまま転記した」と明記して同期を保証する。
3. **puppeteer-core + システムインストール済み Chrome でスクショ**: 新規に Chromium をダウンロードせず `executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"` を渡す。

## `:hover`/`:focus` 状態は JS のクラス付け替えでなく実マウス操作で再現する

`.js-hover` のような JS で付け外しするクラスでシミュレートすると、実装が `:hover` セレクタで書かれているか・意図通りの CSS プロパティが変わるかまでは検証できない（「それらしく見える別の実装」でも同じスクショになりうる）。
`page.mouse.move(x, y)` で対象要素の中心へ実際にカーソルを移動させ、ブラウザの本物の `:hover` を発火させてから撮る方が高忠実度。`:focus-visible` も同様に `element.focus()` でなく実際のキーボード操作（Tab）か `page.keyboard` 経由で発火させるとより確実。

**判断基準**: 「このスクショは "CSS セレクタが正しく書かれているか" まで検証しているか、それとも "それらしい見た目" を作っているだけか」。後者ならレビュアーへの説得力が落ちる。

<!-- importance: medium | mentions: 1 | first-seen: 2026-09 -->

## Node ESM: `node_modules` はスクリプト自身のパス基準で解決される — CWD ではない

`node script.mjs` を実行するとき、`import` の解決は **プロセスの CWD ではなく、import 元ファイル（script.mjs 自身)が置かれているディレクトリ**を基準に `node_modules` を辿る。`cd <node_modules を持つディレクトリ> && node /別の場所/script.mjs` のように CWD だけ合わせても `ERR_MODULE_NOT_FOUND` になる。

**対処**: 一時的な検証スクリプトを書くときは、実行対象の `.mjs`/`.ts` ファイル自体を `node_modules` を持つディレクトリ（または `package.json` があるディレクトリ）の中にコピー/作成してから実行する。

<!-- importance: medium | mentions: 1 | first-seen: 2026-09 -->
