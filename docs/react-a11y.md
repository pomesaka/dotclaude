# Reactのa11y

> **TL;DR**: ReactのUIにrole、`aria-*`、live region、ラベルを書くときとレビューするときに読む。Biomeのa11yルールが拒否する書き方と代わり、live regionの置き方、アクセシブル名の決めごと、実際に踏んだ罠をまとめてある。

整理する前の版は`archive/2026-11-16/docs/react-a11y.md`にある。チャートのa11yは`charts.md`へ移した。

## Biomeのa11yルール

Biomeのa11yルールは、`<div>`にroleやariaを付ける前に、意味を持つ要素を使うよう求める。

| ルール | 拒否される書き方 | 代わり |
|---|---|---|
| `useAriaPropsSupportedByRole` | `<div aria-label>`、`<div aria-labelledby>` | `<section aria-labelledby={id}>` |
| `useSemanticElements`（region） | `<div role="region" aria-labelledby>` | `<section aria-labelledby={id}>` |
| `useSemanticElements`（group） | `<div role="group" aria-label>` | フォームのグループは`<fieldset>`と`<legend className="sr-only">`。フォーム以外（表の列のグループなど）は`<section aria-label="...">` |
| `useSemanticElements`（radio） | `<button role="radio" aria-checked>` | `sr-only`のradioと`<label>`（下の節） |
| `useSemanticElements`（link） | `<div role="link" aria-disabled>` | `<button type="button" disabled>`。hrefの無い`<a>`にも`<span>`を勧めてくることがある |
| `noRedundantRoles` | `<ol role="list">`、`<ul role="list">` | roleを省く |
| `noNoninteractiveTabindex` | `<span tabIndex={0}>`、`role="tabpanel" tabIndex={0}` | `<button type="button">`。WAI-ARIAのtabpanelが要るときだけ`// biome-ignore` |
| `noStaticElementInteractions` | `<div onClick>`、`<div onMouseEnter>`、`<div onMouseLeave>` | ハンドラを`<button>`などの操作できる要素へ移す |

- **`noStaticElementInteractions`は`onMouseEnter`と`onMouseLeave`も拒否する**（jsx-a11yより広い）。ホバーで状態を変えるなら、ハンドラを行の中の`<button>`に集める。コンテナの`onMouseLeave`での解除もできないので、隣の行のボタンの`onMouseEnter`で解除する。
- **同じ要素に条件つきの`role`と`aria-*`を並べると拒否される**。`role={cond ? "tabpanel" : undefined}`と`aria-labelledby={cond ? id : undefined}`は、条件が同じでも静的には安全と示せない。値だけの三項も同じ。要素ごと三項で分け、それぞれに固定の値を渡す。
- `<fieldset>`の既定の見た目は`className="border-0 p-0 m-0"`で消す。`<fieldset>`には`aria-label`を付けず、`<legend className="sr-only">`だけにする（名前が二重になる）。
- `aria-required`は`radiogroup`に付けない（WAI-ARIA 1.2で許されていない属性で、支援技術は無視する）。必須は、各`<input type="radio">`の`required`で表す。

## 操作の部品を手書きする前に、標準の入力と既存の部品で足りるかを見る

`role="slider"`のような手書きの部品は、キー操作、タッチの当たる広さ、読み上げ、見た目の目盛りを、全部自分で作り直す契約になる。置き換える前に、今の部品（標準の`<input type="range">`、プロジェクトとui-designの部品）が持つ見た目、操作、読み上げを並べ、標準の入力をCSSで装うだけでは足りない理由があるときだけ手書きにする。理由が言えないまま置き換えると、抜けた操作を後から1つずつ足すか、元の部品に戻すことになる。下の単一選択のradioと、「…」メニューのPopover APIは、この考えを当てはめた形だ。

## 単一選択は`sr-only`のradioにする

見た目がチップやカードでも、排他の選択なら`<fieldset>`と`<legend>`の中に、`<label>`で包んだ`sr-only`のradioを置く。グループの名前、選択の状態、矢印キーでの移動、1つのタブストップが、ブラウザの挙動として手に入る。`<button>`を並べると、支援技術には「ボタンがN個」としか伝わらない。`aria-pressed`は複数選択のトグルを表すので、単一選択には使わない。独立した操作がN個なら`<button>`のままでよい。

```tsx
<label className={cn("flex-1 border px-3 py-2.5 cursor-pointer", isSelected ? "border-primary bg-primary" : "border-border")}>
  <input type="radio" name="group-name" value={opt.value} checked={isSelected}
    onChange={() => onSelect(opt.value)} className="sr-only" />
  {opt.label}
</label>
```

## 操作できる要素の中に、操作できる要素を入れない

`<button>`や`<a>`の中の`<button>`は、クリックが外側へ伝わり、Next.jsはhydrationのエラーを出す。

- 見出し全体を`<button>`にした後で別の操作（フィルタのトグル）を足すときは、見出しを`<div className="flex items-center gap-2">`に戻し、操作ごとに兄弟の`<button>`を並べる。折りたたみには`aria-expanded`と`aria-controls`、トグルには`aria-pressed`を付ける。タッチ用のpaddingは、親でなく各ボタンに付け直す。
- `<Link><Button>`は、`<Button asChild><Link>...</Link></Button>`か`variant="link"`にする。
- Radixの`PopoverTrigger asChild`と`Button`の中に削除ボタンを置くと、buttonの中のbuttonになり、動きが壊れる。トリガーの中に置くしかないときは、内側を`<span role="button" tabIndex={0} onKeyDown={...}>`で書き、`onClick`で`e.stopPropagation()`、`onKeyDown`でEnterとSpaceを受ける。`<span role="button">`を使ってよいのは、この入れ子を避けるときだけにする。
- Radixの`asChild`でトリガーそのものを作るときは、`<span>`でなく`<button>`を渡す。`<span>`では`aria-haspopup`と`aria-expanded`は付くが、キーボードのフォーカスが保証されない。無効にしたいときは`<button disabled>`にする。

## live region

通知（読み込み、条件つきのエラー）はlive regionで伝える。

- **`role="alert"`は差し込んだ時点で読まれるので、条件つきで描いてよい**。`role="status"`と`aria-live`は、空の要素を先に置いて中身だけ変える。文字と一緒に差し込んだstatusは読まれないことがある（MDN「ARIA live regions」、2026-09-14に確認）。共有コンポーネントで`{message && <p role="status">}`と書くと、全画面に同じ欠陥が配られるので、`message === null`の間も空の`sr-only`の要素を置く。差し込みか中身の変化かは、スナップショットでは区別できない。変える前に要素へ印（`dataset.probe`）を付け、変えた後に文字の入った要素に印が残るかを見る（手順は`playwright-cli`のスキル）。
- **すぐ知らせるエラー、操作のロック、バリデーションの失敗はalert、進捗と、初めから並びうるエラー（DBのfailedの行）はstatusにする**。同じ画面でこの2つが混ざるのは正しい。レビューで「揃える」と指摘されやすいので、WHYとWHY NOTのコメントを書く。
- **live regionは、1つの文だけを入れた`sr-only`の要素に分ける**。コンテナ、ボタン、出力の本文に付けると、変わるたびに中身の全体が読まれる。Skeletonの集まりは`aria-hidden="true"`で隠し、知らせる文は別の要素に置く。コピー完了の通知は、ボタンの外の`sr-only`の要素で知らせる（操作できる要素の中のlive regionは無視されることがある）。ステップの一覧は、実行中のステップだけを知らせる。
- **隣り合う段階には違う文を割り当てる**。`aria-atomic="true"`のとき、中身が同じだと読み直されず、段階が変わったことが伝わらない。
- live regionに`aria-label`は付けない（中身と二重に読まれる）。飾りのアイコンとUnicodeの記号（✓、⚠）は`aria-hidden="true"`にする。静的な空の状態の`<div>`には`role="status"`を付けない。
- `aria-busy`は、`<div>`でなく、roleを持つ要素（`<section>`、`<main>`、`<article>`）に付ける。`aria-busy={isLoading || undefined}`と書くと、falseのときに属性が消える。
- Skeletonの中の操作できる要素には`inert`を付ける（React 19ではbooleanのpropとして書ける）。`pointer-events-none`と`aria-hidden`だけでは、キーボードのフォーカスが入る。

## アクセシブル名

- **`aria-label`は、見えている文字をそのまま先頭に含める**（WCAG 2.5.3 Label in Name。先頭に置くのはW3CのUnderstanding 2.5.3が勧める形で、2026-09-14に確認）。音声操作の利用者は、見えている文字を読み上げて操作する。見えている文字で足りるなら`aria-label`を消す。行ごとに対象の名前を足すときは「見えている文字（対象名）」の形にして、1つの関数（`labelWithSubject(visible, subject)`）で作る。見えている文字を削る形（`${name} を無効化`）や、種類の名前を足す形（`${name} の QR を無効化`）にはしない。後者は、名前が利用者の入力だと「検証用 QR の QR」と読まれる。状態で文字が変わるボタン（無効化と再有効化）は、見えている文字とラベルに同じ変数を渡す。レビューでは`rg -n 'aria-label=\{'`で拾い、ラベルの先頭がボタンの子の文字と同じかを見る。
- **ネイティブの`<dialog>`は、中の見出しを自動では名前にしない**。Esc、フォーカスの閉じ込め、inertはブラウザが担うが、名前は付かず「ダイアログ」とだけ読まれる。`useId()`のidを見出しに振り、`<dialog aria-labelledby={id}>`で結び、`getByRole('dialog', { name: ... })`で確かめる。
- 見えている警告の文があるときは、その文を`aria-label`に詰めず、`aria-describedby`で指す。ラベルは短い動詞にする。
- カードのリンクは、`<Link aria-labelledby={headingId}>`と`<h3 id={headingId}>`で、読まれる内容を見出しに絞る。

## そのほかの決めごとと罠

- **見た目だけ隠すときは、`hidden`や`display:none`でなく`sr-only`を使う**。`<label class="btn">...<input type="file" hidden></label>`は、マウスでは動くが、タブ順から消えてキーボードでは届かない。フォーカスリングは隠れたinputの側に出て見えないので、ラベルに出し直す（`has-[:focus-visible]:outline-2`）。判断基準は「この隠した要素は、フォーカスを受ける必要があるか」。
- **横スクロールの領域に置いた、幅いっぱいの透明な`<button>`は、クリックで横スクロールの位置が飛ぶ**。フォーカスが移り、ブラウザがその要素を見える範囲へスクロールする。`onMouseDown={(e) => e.preventDefault()}`で、クリックでのフォーカスの移動だけを止める（`onClick`とTabでのフォーカスは残る）。`tabIndex={-1}`では直らない。
- **一覧の行の「…」メニューは、ネイティブのPopover API（`popover="auto"`と`popoverTarget`）で作る**。自前の`position: absolute`は、祖先が`overflow-hidden`（角丸の表、カード）だと最後の行で切れるが、Popoverはtop layerに描かれるので切れない。閉じる、フォーカスを戻す、外側のクリック、Escはブラウザが担う。
  - 位置は自分で決める（対応ブラウザが揃うまでCSS anchor positioningには頼らない）。`onBeforeToggle`で`newState === "open"`のときにトリガーの`getBoundingClientRect()`を読んで`top`、`bottom`、`right`を入れる（`onToggle`では、1フレーム別の場所に出る）。
  - `role="menu"`を名乗ると矢印キーの移動を自分で実装する契約になるので、ボタンを並べるだけならroleを付けない。項目に`popoverTargetAction="hide"`を付けると、押した時点で閉じる。結果の通知はメニューの外に出し、確認のダイアログはメニューの外のstateで開く。
- **ランドマーク（`<section>`）は、独立した機能の単位にだけ付け、飾りのまとまりは素の`<div>`にする**。迷ったら`<section>`にする。素の`<div>`の`aria-label`は支援技術に無視される。レビューで足す、消すが揺れやすいので、この基準で決める。多すぎると感じたら、`<section>`と`aria-label`を一緒に消す。
- レイアウトが`<main>`を持っているなら、ページの側は`<section aria-label="...">`にする。
- `<Link>`を無効にするには、`aria-disabled`、`tabIndex={-1}`、`pointer-events-none`の3つが要る。`aria-disabled`だけでは、TabでフォーカスしてEnterで開ける。
