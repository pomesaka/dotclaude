# Tailwindの色とレイアウト

> **TL;DR**: Tailwindで画面を組むときとレビューするときに読む。レスポンシブの数値の決めごと、色のトークンの使い方、固定シェルのレイアウトで実際に踏んだ罠と測り方をまとめてある。

整理する前の版は`archive/2026-11-16/docs/`の`tailwind-cva-patterns.md`、`responsive.md`、`react.md`にある。

## レスポンシブの決めごと

- ブレークポイントは`sm:`と`lg:`の2つを使う。BtoBなので主な対象は`lg:`（1024px以上）。`md:`、`xl:`、`2xl:`は、特別な理由があるときだけ使う。1つのプロパティには2段階まで（`text-sm lg:text-base`）。4段階の連なりは読みにくい。
- 余白は`p-4 lg:p-8`。ページのタイトル（h1）だけ`text-2xl lg:text-4xl`と大きさを変え、本文とラベルは変えない。`text-3xl`以上が無条件で付いていたら、対応の漏れを疑う。
- タップできる要素は44px以上にする（`min-h-11 lg:min-h-9`、ナビのリンクは`py-3 lg:py-2`）。操作できる要素の`py-1`や`py-0.5`は指摘する。
- グリッドは、カードとダッシュボードが`grid-cols-1 sm:grid-cols-2 lg:grid-cols-3`、フォームのフィールドが`grid-cols-1 lg:grid-cols-2`。フォームの本体は`max-w-lg`の1列でよい。
- 表は`min-w-full`のまま`<div className="overflow-x-auto">`で包み、縮めない。
- サイドバーは`lg:`で切り替える。`lg:`以上は固定で出し（`hidden lg:block`）、それ未満はヘッダーのバーとDrawerにする（`lg:hidden`）。この2つの対が揃っているかを見る。片方だけ書いて、両方出る、両方消える誤りが多い。

## 色とトークン

- **同じCSSプロパティを出すユーティリティ（`bg-*`、`border-*`、`text-*`、`ring-*`）を、1つの要素に重ねない**。勝つのはクラスの並び順でなく、生成されたCSSの順になる（Tailwind v4）。CVAでは、色を`theme`のvariantに置かず、`{ variant: "default", theme: "primary" }`のcompound variantに置く。`variant="outline"`のときは背景のクラスが付かないので、競合しない。文字列の連結（`${BASE} border-green`）でも同じなので、ベースの定数から色を抜き、状態ごとに排他で足す。失敗してもエラーは出ず、`ring-*`のような別のプロパティだけが効いて、選択の状態が弱いだけに見える。疑ったら`getComputedStyle(el).borderColor`を測る。
- **`--accent`は、`--muted`と見分けられる値にする**。`bg-muted`の領域で`hover:bg-accent`を使うと、2つが近い値のときにホバーの変化が見えない。Tailwind v4では、既定値として`accent`と`muted`に同じかほぼ同じ値が入っていることがある。Lightでは`--accent`を暗く（muted 95.5%に対して91%）、Darkでは明るくする（16%に対して23%）。
- **コンポーネントに`dark:`のクラスがあるなら、トークンの設計を直す**。LightとDarkの切り替えはトークンの定義（`globals.css`）だけで済ませ、コンポーネントは意味のトークン（`text-destructive`、`bg-accent`）だけを参照する。`dark:text-blue-300`のような直書きは、そのトークンのDarkの値が合っていないことを表す。Darkの側の明度と彩度を直して、`dark:`を消す。
- **操作の要素のトークン（`--primary`、`--secondary`、`--destructive`）を、レイアウトの背景に使わない**。表のヘッダーやセクションの区切りには`bg-muted`、`card`、`background`を使う。判断基準は「ここにボタンを置いても違和感がないか」。
- **グリッドの列の幅より大きい`size`のButtonを置かない**。`size="icon"`は`h-9 w-9`（36px）に展開され、16pxや24pxの列からはみ出して隣を押す。paddingでは直らない。`className="size-4 p-0"`のように、列の幅に合わせた大きさを直接書く。

## 固定シェルと内側のスクロール

ヘッダーとサイドを固定し、特定のパネルだけをスクロールさせるレイアウトで踏んだ罠。

- **高さを1画面に固定する指定は`lg:`を付ける**（`lg:h-full lg:overflow-hidden`）。全幅に付けると、縦に積まれたモバイルの中身が1画面で切られ、下がスクロールできない白い画面になる。モバイルは固定せず、`<main overflow-y-auto>`かページが自然にスクロールする。
- **`h-full`は、flexで伸ばされた親（height: auto）に対しては効かない**。ルートを`h-screen`にし、各段を`flex flex-col min-h-0`でつなぎ、スクロールさせるパネルに`flex-1 min-h-0 overflow-y-auto`を付ける。`min-h-0`が1段でも抜けると、パネルが縮まずにページがスクロールする。
- **`<a href="#id">`のアンカーは、スクロールできる祖先を全部動かす**（windowも含む）。内側のパネルだけを動かすなら、`onClick`で`e.preventDefault()`し、見出しにいちばん近いスクロールできる祖先（`scrollHeight > clientHeight`を上へたどる）にだけ`scrollBy({ top: delta })`する。`href`は中クリックとコピーのために残す。
- **flexの縦並びの中で`flex-1`から高さを得るスクロールのコンテナは、`scrollHeight`を`documentElement.scrollHeight`へ漏らす**（Chromiumで実測）。windowはスクロールしないが、文書の高さが大きくなり、ブラウザによっては縦のスクロールバーが出る。祖先の`overflow:hidden`でも、divで包んでも止まらない。漏らす要素に`contain: size layout`を付ける。flexの横並びのコンテナでは起きない。`el.style.contain = 'size layout'`を当てて`documentElement.scrollHeight`が下がれば、これが原因。
- **中身が途切れる、白い画面になる不具合は、実際にスクロールする要素で測る**。このレイアウトでは内側の`<main>`がスクロールするので、`window.scrollY`や`documentElement.scrollHeight`で測ると、直っていないのに通る。中身の要素から祖先をたどり、各祖先の`height`、`overflowY`、`scrollHeight`、`clientHeight`を出す。`scrollHeight == clientHeight`なのに子があふれている祖先が、切っている場所になる。直した後は、スクロールするコンテナで`scrollHeight > clientHeight`になることと、最下部までスクロールして末尾の要素が画面の中に入ることを見る。
- **内側だけを横スクロールさせる枠（`overflow-x-auto`）には、`relative`を一緒に付ける**。枠の中の`sr-only`は`position: absolute`なので、枠が位置の基準でないと枠で切られず、スクロールで隠れた位置のまま文書の幅を広げる（Chrome、Tailwind v4で実測）。内側のスクロールする要素の幅だけを測ると通るので、その要素と`documentElement`の両方の`scrollWidth`を、狭い幅と文字の拡大200%で測る。判断基準は「枠の中に、`absolute`で置かれた要素（`sr-only`を含む）があるか」。
- **印刷では、`print:`で高さとoverflowの制限を外す**。コンテナに`print:block print:h-auto print:overflow-visible`、スクロールする領域に`print:overflow-visible print:h-auto`、サイドバーに`print:hidden`を付ける。`h-screen overflow-hidden`のままだと、PDFで中身が切れる。

## 測ってから直すもの

- **gridの兄弟の「高さが揃っていない」という報告は、先に両方の`getBoundingClientRect().height`を測る**。gridの子は既定の`align-items: stretch`で枠が揃う。枠は同じで、中身の行数が少ない側の下が空いて短く見えていることがある。そのときは枠でなく中身の配置を直す（`flex flex-col`にして、中身の側に`flex-1`と中央寄せを付ける）。
- 特定の兄弟の間だけ余白を増やすなら、親の`space-y-*`を変えず、対象の要素に`mt-*`か`mb-*`を付ける。`space-y-6`から`space-y-8`への変更は、画面で見分けにくい。
- `p-0`と同じ要素に`pb-*`を足すと、CSSの出力の順によって`p-0`が勝つことがある。`p-0`を`pt-0`などに分けてから足す。
