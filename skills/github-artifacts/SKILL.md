---
name: github-artifacts
description: HTML のページを、GitHub の issue の artifact（issue の右に開く pane）として上げる・直す。gh issue artifact を使う。
when_to_use: 「issue に artifact で置いて」「レポートを issue に上げて」「HTML を issue に添付して」と言われたとき。試験や調査の結果を issue に残すとき。ページの中身の決め方は explain-html、画像や動画の添付は upload-screenshots を使う。
argument-hint: "[issue の番号] [HTML のパス]"
allowed-tools: Read, Write, Edit, Skill, Bash(gh *), Bash(python3 *), Bash(open *), Bash("/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" *)
---

# github-artifacts

issue の artifact は、issue にぶら下げる文書・HTML・リンク。issue のページの「Artifacts」から開くと、右の pane に出る。HTML は `embedded_html` という型で保存され、pane の中でページとして描かれる。表やカードを並べたレポートを、Markdown のコメントより読みやすく残せる。

機能はプレビュー（gh のヘルプに「preview and subject to change without notice」とある）。下の挙動は 2026-10-28 に gh 2.103.3 で確かめたもの。

## 手順

1. **ページを作る**: 中身は `explain-html` スキルの手順で決める。下の「ページの制約」を守る
2. **pane の幅で見る**: headless の Chrome で、幅 760 px のスクショを撮って Read で見る。崩れていたら直す

   ```bash
   "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless=new --disable-gpu --hide-scrollbars --window-size=760,2400 --screenshot=<ページと同じ場所>/<名前>.png file://<ページの絶対パス>
   ```

3. **上げる**: `gh issue artifact create <issue> '<HTML の絶対パス>#<名前>'`。`#<名前>` が pane の見出しになる。省くとファイル名になる
4. **確かめる**: `gh issue artifact list <issue>` で番号と型（`embedded_html`）を見る。利用者に、issue のページの「Artifacts」から開けることを伝える
5. **直す**: `gh issue artifact edit <issue> <番号> --body-file <HTML のパス>`。番号は list で見る。create をやり直すと、別の artifact が増える

ほかのリポジトリの issue は `-R <owner>/<repo>` を付ける。

## gh の版

`gh issue artifact` は gh 2.103 から（HTML は cli/cli#14720 で対応）。`gh issue artifact --help` が無ければ、利用者に版を上げるか聞く。

この端末の gh は `~/opt/src/gh_<版>/` に置き、`/usr/local/bin/gh` からリンクしている。上げるときは、リリースの `gh_<版>_macOS_arm64.zip` と `gh_<版>_checksums.txt` を `gh release download` で取り、checksum を確かめてから `~/opt/src/gh_<版>` に展開し、`ln -sfn` でリンクを付け替える。古い版は消さない（リンクを戻せば元に戻る）。

## ページの制約

| 項目 | 挙動 | どうするか |
|---|---|---|
| JavaScript | 動かなかった。`<script>` で値を入れる計算機は、空のまま出た | 計算は Python などで作るときに済ませ、値を HTML に書く。選んだ値で答えを変えたいときは、ラジオやチェックと CSS の `:has()`・`counter()` で組む（下の例） |
| CSS | `<style>` は効く。`prefers-color-scheme` も GitHub のテーマに合わせて効いた | 色はトークンにし、ライトとダークの両方を書く |
| 幅 | pane は約 700 px。本文はさらに狭い | 表の短い列（「1 回目」など）に `white-space: nowrap`。カードは 2 列に落ちる形にする（4 枚を `auto-fit` で並べると 3 枚と 1 枚に割れた）。チェックの一覧は 1 列にする |
| 骨組み | `<!doctype html>` から書いたページが、そのまま描かれた | 骨組みは自分で書く |
| 外部の資源 | 確かめていない | フォントはシステムのものだけで組む。画像は data URI にする |

### JavaScript なしで選んだ値の合計を出す

選べる値の組ごとに、項目ごとの値を前もって計算し、CSS の規則として書き出す。合計は counter で足す。

```css
.calc { counter-reset: yen; }
/* 人数 2・12 か月・1 日 1 回で、Agoda にチェックがあるとき */
main:has(#a2:checked):has(#m12:checked):has(#r1:checked):has(#s-agoda:checked) .add-agoda { counter-increment: yen 984; }
.total::before { content: counter(yen); }
```

- `counter-increment` を持つ要素は、合計を出す要素より前に置く。`display: none` の要素は数えられないので、幅 0 の `inline-block` にする
- 項目ごとに足す要素を分ける（同じ要素に `counter-increment` を 2 つ書くと、後の 1 つしか効かない）
- counter は桁区切りを付けられない
- 組の数 × 項目の数だけ規則ができる。4 × 4 × 4 の組 × 8 項目で 576 規則、約 90 KB だった

## Gotchas

- **JavaScript の計算機をそのまま上げて、空のページを見せた**: pane の上に「Previewing runs this code」と出るが、`<script>` の結果は出なかった（2026-10-28）。上げる前に、JavaScript を切ったブラウザか、script を消した版で、ページが空にならないかを見る
  <!-- importance: high | mentions: 1 | first-seen: 2026-10 -->
- **ページの幅で崩れたのを、利用者のスクショで初めて知った**: 1280 px で撮ったスクショでは崩れが見えず、pane の幅で「1 回目」が折り返し、カードが 3 枚と 1 枚に割れた。撮るのは 760 px の幅で
  <!-- importance: medium | mentions: 1 | first-seen: 2026-10 -->
