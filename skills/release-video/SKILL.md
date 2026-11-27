---
name: release-video
description: 新しい機能を紹介する短い動画（字幕だけで分かる MP4）とリリースノートを、本物の画面を撮って HyperFrames で組んで作る。
when_to_use: 「リリース動画を作って」「紹介動画を作って」「機能の紹介ムービー」「Slack に流す動画」「リリースノートと動画」と言われたとき。
allowed-tools: Read, Write, Edit, Bash(gh pr view *), Bash(npm i *), Bash(npm init *), Bash(npx hyperframes *), Bash(node *), Bash(bun *), Bash(jq *), Bash(cp *), Bash(mkdir *), Bash(sh ~/.claude/skills/release-video/fetch-ffmpeg.sh *)
---

# リリース動画

新しい機能を社内に知らせる、45〜75秒の動画とリリースノートを作る。動画は、本物の画面の静止画をカメラとカーソルで動かして操作して見せ、下の帯の字幕だけで分かるようにする。Slack は音が出ない前提で流れるためだ。

道具は HyperFrames（HTML と GSAP で組み、MP4 に描き出す。Apache-2.0）。Remotion は、無料で使えるのが3人までの会社なので選ばない（remotion.dev/docs/license/pricing、2026-11 に確認）。HyperFrames と GSAP の入れ方と、つまずく所は `reference.md` にある。組み立ての前に読む。

## 完了の条件

- MP4（H.264、1920x1080、30fps、音なし、50MB 以下）と、場面ごとの静止画が、作業場所にある
- Slack にそのまま貼れるリリースノートの文がある
- 動画に、本番のデータ、実在の人のメールアドレス、利用者が出すと決めていない名前が映っていない

## 作業場所

`~/.claude/tmp/<プロダクト>-release-video/` に置き、プロダクトのリポジトリには入れない。

```
shoot/   撮影のスクリプト（プロダクトごとに書く。template/shoot.mjs を import）
shots/   撮った静止画（2倍の解像度）と cursor.json（押す要素の位置）
film/    build.mjs、engine.mjs、film.css、assets/、index.html
bin/     ffmpeg、ffprobe（PATH に無いとき）
stills/  納品の静止画
```

## 進め方

### 1. 台本を書き、利用者に見せる

PR の本文と画像（`gh pr view <番号>`）を読み、機能を利用者の言葉に直す。何を伝える動画かは、柱を2つ程度に絞る。細かい機能は、柱を支える場面として入れ、主役にしない。

台本は「秒・見せる画面・字幕」の表にし、作る前に利用者へ見せて返事を待つ。登場する人の名前、柱の言葉、入れる場面は利用者が決める。字幕にメニューの名前などを入れるときは、今の画面を撮って確かめてから書く。

字幕は1枚に1文で、「0.5秒 + 0.3秒 × 語数」より長く出す。読み切れない字幕は、後の `check` で `line_unread` になり、場面を延ばすことになる。

### 2. 本物の画面を撮る

開発サーバーを起こし、架空の人とデータを API で作って撮る。本番のデータは使わない。作った直後のデータベースを写しておき、撮り直す前に戻す（前の撮影で受けた依頼などが残ると、画面が台本と違う）。

撮影のスクリプトは、`template/shoot.mjs` の `launch`、`open`、`createShooter` を使う。1440x900 を2倍で撮る（寄ったときに字がにじまない）。`snap(page, 名前, 押す要素)` が静止画と押す要素の位置を残し、`save()` が `shots/cursor.json` に書く。結果だけを見せる場面（ほかの人の画面に届いた、など）は、API でデータを作ってから撮る。

撮った静止画は、Read で全部見る。

### 3. 組む

`template/` の `engine.mjs` と `film.css` を `film/` に写し、`build.example.mjs` を `film/build.mjs` として写して表を書き換える。`film.css` の先頭の token とフォントを、プロダクトの CSS の token に合わせる。gsap.min.js、撮った静止画、ロゴを `film/assets/` に置く。

| 場面 | engine の関数 | 使いどころ |
|---|---|---|
| 見出しの面 | `chapter` | 柱の始まり。行は意味の切れ目で自分で折る |
| 画面の場面 | `screen` | 本物の画面を切り替え、カメラ、カーソル、クリックの印、注目の枠で操作を見せる |
| 端末の場面 | `terminal` | Claude Code などから使う機能。確認の画面の文は、サーバーが実際に返す文を写す |
| 字幕の帯 | `captions` | 帯の左上に柱の名前、中央に字幕 |
| それ以外 | `raw` | 始まり、終わり（どこから使うか）、拡大して注記を並べる場面 |

見た目は、そのプロダクトの画面と同じものに見えるようにする。見出しはプロダクトの見出しと同じ書体、色は token だけ、端末はプロダクトの暗い面の token で作る。AI が作りがちな見た目（紫のグラデーション、真ん中に揃えただけの配置）にしない。

`node build.mjs` → `npx hyperframes check` → `npx hyperframes snapshot` で、直した所を contact sheet で見ながら直す。コマンドと警告の扱いは `reference.md` にある。

### 4. 描き出して確かめる

`npx hyperframes render` で MP4 にし、ffprobe で形と長さを、取り出したコマを並べた1枚で中身を見る。納品の静止画も、同じ取り出し方で作る。

### 5. リリースノートを書き、渡す

Slack の mrkdwn で、柱ごとに見出しと2〜3行を書く。何ができるようになったか、どこから使うか、を利用者の言葉で書き、PR の番号や技術の語は出さない。

利用者に渡すのは、MP4 と静止画の絶対パス、リリースノートの文、確かめていないこと（模した画面が本物と違いうる所、映った架空の名前など）。
