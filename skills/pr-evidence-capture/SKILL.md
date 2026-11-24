---
name: pr-evidence-capture
description: PRやREADMEに貼る画面の画像を作る。devサーバーを起動せずにWebの画面を撮る方法と、端末の画面を画像にする方法を持つ。
when_to_use: PRの「動作確認」やREADMEに貼るスクショを作るとき。PDFの重ね描き、canvas、hoverやfocusの状態を持つ画面を撮るとき。端末やClaude Codeの画面を画像にするとき。撮った画像を上げるのは upload-screenshots を使う。
allowed-tools: Read, Write, Bash
---

# 画面の画像の撮り方

## devサーバーを起動せずにWebの画面を撮る

PDFの重ね描き、canvasの描画、込み入ったCSSの状態（hover、focusなど）を持つ画面で使う。

1. 実データ（実際のPDFなど）を、リポジトリの実装の関数（座標の計算、抽出の処理など）に通して、本物の出力値を得る
2. 実装が使うCSSの定数（`MARK_KIND_CLASS`のようなスタイルの定義のオブジェクト）をimportしてHTMLを書く。Tailwindのクラスを手で並べない。importできないときは、どの定数の値を写したかをコメントに書く
3. puppeteer-coreと、システムに入っているChrome（`executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"`）で撮る。Chromiumを新しくダウンロードしない

`:hover`や`:focus-visible`は、クラスの付け替えでなく`page.mouse.move(x, y)`や`page.keyboard`で本物の状態を起こして撮る。`.js-hover`のようなクラスで見た目だけを作ると、実装のセレクタが正しく書かれているかを確かめられない。

## 撮る前に、写したい状態になっているかを同じスクリプトの中で確かめる

画面の一部だけが先に切り替わり、残りが前の状態のままの画が撮れることがある。TUIで一覧のカーソルを動かした直後に撮ると、見出しは選んだ項目なのに、隣の欄は前の項目の中身を写していた。撮影のスクリプトに、写す状態がそろったかの確認（選んだ項目と、表示している中身が同じものを指しているか）を入れ、そろうまで撮らない。

処理の最中のような、すぐに過ぎる状態を撮るときは、その状態の始まりを検出するコマンドと撮るコマンドを、1つの監視のコマンドにつなぐ（`until rg -q '<始まりの印>' <ログ>; do sleep 1; done; <撮るスクリプト>`）。検出を見てから人やモデルが撮る指示を出すと、そのあいだに状態が過ぎる。

## 端末の画面を画像にする

freeze（charmbracelet/freeze v0.2.2、miseの`aqua:charmbracelet/freeze`、2026-11に確認）には次の癖がある。

- スクリプトの中で標準入力をつながずに呼ぶと、入力を待って止まる。`</dev/null`を渡すと2秒で終わった
- フォントは.ttfだけを受け付け、.otfは`.otf is not a supported font extension`で断る
- JetBrains Monoの.ttfでも、Claude Codeが出す記号（⏺ ⎿ ✻ ⏵）は四角に化ける。取り込んだANSIの文字列の中で、これらをフォントにある近い記号に置き換えてから描く

画像にする手順を組んだら、量産する前に1枚だけ描き、画像を開いて、止まらないことと化けた字が無いことを目で確かめる。化けた字は終了コードに出ず、止まる道具は全部を流してから気づくことになる。
