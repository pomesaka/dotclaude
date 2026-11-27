# HyperFrames と GSAP で、つまずく所

2026-11 に HyperFrames 0.9.102、GSAP 3.13.0 で確かめた。版が進めば変わりうる。

## 入れ方

- `npm i hyperframes@0.9.102 gsap@3.13.0 --ignore-scripts` で入る。install のスクリプトは無く、依存の esbuild もスクリプト無しで動いた。
- 利用状況を PostHog に送る。すべてのコマンドに `HYPERFRAMES_NO_TELEMETRY=1` を付ける（`DO_NOT_TRACK=1` でも止まる）。
- HyperFrames のスキルは入れない。そのスキルは、最初に `npx hyperframes events` で使用状況を送るよう求める。読むのは npm パッケージの中の文書で足りる: `node_modules/hyperframes/dist/skills/hyperframes/SKILL.md`、`dist/docs/` の `compositions.md`、`data-attributes.md`、`gsap.md`、`rendering.md`、`references/format.md`。
- ffmpeg と ffprobe の両方が要る（libx264 付き）。PATH か、`HYPERFRAMES_FFMPEG_PATH` と `HYPERFRAMES_FFPROBE_PATH` で渡す。無ければ `fetch-ffmpeg.sh` で取り出す。auto mode に止められたら、利用者に `! sh <スキルの場所>/fetch-ffmpeg.sh <置き場所>` を打ってもらう。

## コマンド

```sh
export HYPERFRAMES_NO_TELEMETRY=1 HYPERFRAMES_FFMPEG_PATH=$W/bin/ffmpeg HYPERFRAMES_FFPROBE_PATH=$W/bin/ffprobe
node build.mjs
npx hyperframes check --json > check.json          # findings の rule、severity、message を jq で数えて読む
npx hyperframes snapshot --at 9,13.5,22 --no-end -o snaps   # snaps/contact-sheet.jpg を Read で見る
npx hyperframes render -o ../out.mp4 -q delivery --fps 30 < /dev/null > render.log 2>&1
```

- render は 67秒の動画で約70秒（capture 19秒、encode 44秒）。大きさは 21MB だった。
- 確かめは `ffprobe -show_entries stream=codec_name,width,height,r_frame_rate,pix_fmt -show_entries format=duration` と、`ffmpeg -ss <秒> -i out.mp4 -frames:v 1` で取り出したコマを `vstack`/`hstack` で1枚に並べて Read で見る。

## check の警告

| rule | 扱い |
|---|---|
| `line_unread` | 直す。字幕や画面の文が「0.5秒 + 0.3秒 × 語数」より短く出ている。字幕を分けるか、場面を延ばす |
| `nested_structure_needs_subcomposition` | 残してよい。場面を1つのファイルにまとめたため |
| `text_below_floor` | 残してよい。撮った画面の中の小さな字に出る |
| `font_face_local_only` | 残してよい。`local()` のフォントは、その Mac で描き出すときだけ効く |
| 2MB を超える画像を inline しない | 残してよい。ローカルの描き出しでは問題ない |

## GSAP の決まり

- タイムラインは `gsap.timeline({ paused: true })` で作り、`window.__timelines["<data-composition-id>"] = tl` で登録する。描き出しは、このタイムラインを1コマずつ進めて撮る。
- `Date.now()`、乱数、タイマー、`repeat: -1` を使わない。コマごとに同じ絵にならない。
- `.clip` の要素そのものを `display` や `visibility` で動かさない。出す時刻は `data-start` と `data-duration` が決める。
- transform は CSS に書かず `tl.set` で置く。CSS の transform は GSAP に上書きされ、食い違う。
- `fromTo` は、作った時点で from の値を描く。場面の途中で始まる `fromTo`（クリックの印、押したときのカーソルの縮み）は `immediateRender: false` にする。付けないと、場面の頭から印が見える。
- GSAP は CSS 変数の値を補間しない。色を動かすときは値で書く。
- 文字を打つ見せ方は、`width: "auto"` でなく `clipPath: "inset(0% 100% 0% 0%)"` → `"inset(0% 0% 0% 0%)"` に `ease: "steps(文字数)"`。
- gsap は CDN から読まず、`assets/gsap.min.js` に写して読む。

## 撮影でつまずいた所

- 自作の選択の部品（listbox）がある画面で、選択肢の名前で取るとページの中の複数に当たる（strict mode violation）。開いた listbox で絞る: `page.getByRole("listbox", { name }).getByRole("option", { name, exact: true })`。
- 日付の欄が英語の形（12/01/2026）で出る。context の `locale` だけでは足りず、`chromium.launch({ args: ["--lang=ja-JP"] })` が要る（`shoot.mjs` の `launch`）。
- 見せたい区画がページの下にあると、上の別の物（警告の文など）が映る。その区画を中央へ送ってから撮る（`snap` の `center`）。先に1枚試し撮りして Read で見る。
- 撮り直すたびに、データを撮影の前の状態へ戻す。前の撮影で受けた依頼や足したタスクが残ると、画面が台本と違う。作った直後のデータベースを写しておき、撮り直しの前に戻して開発サーバーを起動し直す。

## 組み立てでつまずいた所

- 倍率1の全体表示は、1440 の画面が 1920 の中で小さく、字が読めない。休む位置も 1.2〜1.3倍にする。
- 画面が 1920 より狭い倍率で、映したい点に合わせて横をずらすと、左に寄って見える。狭いときは中央に置く（`engine.mjs` の `camAt`）。
- 見出しを自動で折り返すと「もらえるよ／うになりました」のように語の途中で折れる。行を配列で渡し、意味の切れ目で自分で折る。
- 注記の欄に背景が無いと、下の画面が透けて読めない。欄は帯の幅いっぱいの、背景のある面に置く。
