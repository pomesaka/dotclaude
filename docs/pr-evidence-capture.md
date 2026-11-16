# PR 証跡スクショの撮り方（オフライン・実 CSS 検証）

dev サーバーを起動せずに、PR の「動作確認」に貼るスクショを作る手順。PDF オーバーレイ・canvas 描画・複雑な CSS 状態（hover/focus 等）を持つ UI で使う。整理する前の版は `archive/2026-11-16/docs/pr-evidence-capture.md` にある。

1. 実データ（実 PDF 等）を、リポジトリの実装の関数（座標計算・抽出処理など）に通して、本物の出力値を得る
2. 実装が使う CSS の定数（`MARK_KIND_CLASS` のようなスタイル定義オブジェクト）を import して HTML を書く。Tailwind のクラスを手で並べない。import できないときは、どの定数の値を写したかをコメントに書く
3. puppeteer-core と、システムに入っている Chrome（`executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"`）で撮る。Chromium を新しくダウンロードしない

`:hover` や `:focus-visible` は、クラスの付け替えでなく `page.mouse.move(x, y)` や `page.keyboard` で本物の状態を起こして撮る。`.js-hover` のようなクラスで見た目だけを作ると、実装のセレクタが正しく書かれているかを確かめられない。
<!-- importance: medium | mentions: 1 | first-seen: 2026-09 -->
