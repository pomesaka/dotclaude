# React a11y + Biome a11y ルール

> **TL;DR**: Biome の a11y ルールは「セマンティック HTML を使え」の自動強制。`<div>` に role/aria を付ける前にセマンティックタグを検討する。aria-live は常時 DOM に存在させ、フェーズごとに固有メッセージを割り当てる。

## Biome a11y ルール早見表

| Biome rule | NG パターン | 正しい代替 |
|---|---|---|
| `useAriaPropsSupportedByRole` | `<div aria-label>` / `<div aria-labelledby>` | `<section aria-labelledby={id}>`。`role="region"` はさらに `useSemanticElements` に弾かれるため `<section>` を使う |
| `useSemanticElements` (region) | `<div role="region" aria-labelledby>` | `<section aria-labelledby={id}>` |
| `noRedundantRoles` | `<ol role="list">` | `<ol>`（role 省略） |
| `noNoninteractiveTabindex` | `<span tabIndex={0}>` / `role="tabpanel" tabIndex={0}` | `<button type="button">` に置き換える（`<button>` はデフォルトで keyboard-focusable）。WAI-ARIA tabpanel パターンが必要な場合のみ `// biome-ignore` |
| `useSemanticElements` (group) | `<div role="group" aria-label>` | フォームのグループなら `<fieldset>` + `<legend className="sr-only">`。**フォーム以外（データテーブルの列グループ等）では `<fieldset>` は意味的に不適切** → `<section aria-label="...">` を使う（section は landmark role を持ち aria-label が有効に機能する）。`<fieldset>` の `aria-label` は付けない（`<legend>` で代替） |
| `useSemanticElements` (radio) | `<button role="radio" aria-checked>` | 単一選択グループは native `<input type="radio" className="sr-only">`＋`<label>`（詳細は本文）。`aria-pressed` は複数選択トグル用なので単一選択に使わない |
| `noRedundantRoles` (list) | `<ul role="list">` | `<ul>`（role 省略。`list-none` + `aria-label` で意味論を担保） |
| `noStaticElementInteractions` | `<div onClick>` / **`<div onMouseEnter>` / `<div onMouseLeave>`** | ハンドラを `<button>` 等の interactive 要素へ移す |

### `noStaticElementInteractions` は mouse enter/leave も弾く
<!-- importance: high | mentions: 1 | first-seen: 2026-06 -->

`onClick` だけでなく `onMouseEnter` / `onMouseLeave` を非 interactive 要素（`<div>` 等）に付けても弾かれる（jsx-a11y の handler リストより広い）。ホバーで状態を変えるなら、ハンドラは行内の既存 `<button>` に集約する。「コンテナ全体の onMouseLeave で解除」したくなるが、それも div では弾かれるので、解除も近接の button の onMouseEnter で代替する（例: ハイライト解除は隣接行のボタンに `onMouseEnter={() => clear()}`）。

### 横幅いっぱいの `<button>` オーバーレイはクリックで横スクロールが飛ぶ
<!-- importance: high | mentions: 1 | first-seen: 2026-06 -->

横スクロール領域内に「トラック幅いっぱいの透明 `<button>`」（ガントのバー行クリック領域など）を置くと、クリック時にフォーカスが移り、ブラウザがその幅広要素を可視域へスクロールして横スクロール位置が飛ぶ。対処: `onMouseDown={(e) => e.preventDefault()}` でクリック時のフォーカス移動だけ抑止する（`onClick` は発火し続け、Tab キーでのフォーカスも残る＝ a11y を壊さない）。`tabIndex={-1}` では解決しない（クリックフォーカスは残る）。

`<fieldset>` のデフォルトスタイルは `className="border-0 p-0 m-0"` でリセットする。本物のラジオグループが必要なら `<input type="radio">` + `<label>` を CSS でスタイリングする。

### 条件付き `role` + `aria-*` は Biome が静的に弾く

`role={cond ? "tabpanel" : undefined}` と `aria-labelledby={cond ? id : undefined}` を同じ要素に並べると、Biome の `useAriaPropsSupportedByRole` が「role のない div に aria-labelledby がある」と判定してエラーにする（条件が同一であっても静的解析では安全性を証明できない）。値の三項（`aria-labelledby={cond ? "id-a" : "id-b"}`）も同様に静的に拒否される。

修正パターン: 要素ごと三項で分岐し、それぞれに固定の文字列を渡す。

```tsx
// NG
<div
  role={isAdmin ? "tabpanel" : undefined}
  aria-labelledby={isAdmin ? id : undefined}
>...</div>

// OK
{isAdmin ? (
  <div role="tabpanel" aria-labelledby={id}>...</div>
) : (
  <div>...</div>
)}
```
<!-- importance: medium | mentions: 1 | first-seen: 2026-05 -->

## aria-live region

**動的に変わる通知（ローディング・条件付きエラー）は live region role を付ける。ただし「差し込みで読まれる」のは `role="alert"` だけ。`role="status"` は要素を先に置いておき中身だけ変える**（MDN "ARIA live regions" の Note: 支援技術が監視するのは既存 live region の中身の変化で、文字と一緒に差し込んだ status は読まれないことがある。alert は差し込みでも読まれる・2026-09-14 確認）。共有コンポーネントで `{message && <p role="status">}` と書くと全画面に同じ欠陥が配られるので、`message === null` の間も空の `sr-only` 要素として置く（React は Fragment 内の同じ位置の要素を使い回すので、読み込み中 → 成功でも同じ要素のまま）。検証: 状態を変える前に `eval` で対象要素に `dataset.probe` を付け、変化後にその属性が文字入りの要素に残っているかを見る。残っていれば差し込みでなく中身の変化。見た目・ARIA スナップショットの文字だけでは両者を区別できない。実例: MEGURU PR #18 のレビューで共有 `StatusText` が差し込み型だった（2026-09-14）。`role="alert"`（= assertive）はエラー・操作ロック・バリデーション失敗など即時割り込み、`role="status"`（= polite）はローディング・進捗と、ページ初期ロード時から並びうる永続エラー（DB の failed 行等。毎回 assertive 割り込みはノイズ）に使う。装飾アイコン・Unicode 文字（✓・⚠）は `aria-hidden="true"`（テキストが意味を担うので二重読み上げ回避）、live region に `aria-label` は付けない（内容とラベルの二重読み上げ）。初期表示要素の hidden→visible は role では拾えないので `aria-live` を直接付ける。同一画面で「操作直後の transient エラー = alert / ロード時から存在しうる永続エラー = status」の非対称は正当。レビューで「揃えろ」と指摘されやすいため WHY / WHY NOT コメントで守る（実例: issue 965 の uploading 失敗セル = alert / staging 抽出失敗セル = status）。
```tsx
// ✅ role="alert" — 条件付きマウントで DOM 挿入された瞬間に割り込み読み上げ
{isMultiInvoice && <div role="alert" className="rounded-lg bg-destructive/10 ...">
  <AlertTriangle aria-hidden="true" />
  複数請求書が紐付いています。
</div>}
```
<!-- importance: high | mentions: 5 | first-seen: 2026-06 -->

**常時 DOM に存在させる**: `{condition && <div aria-live>}` のように条件付きマウントすると NVDA 等の AT が登録できない。常時置いて content を切り替える。

**フェーズごとに固有メッセージを割り当てる**: `aria-atomic="true"` の AT は DOM content が同一の場合に再読み上げをスキップするため、隣接フェーズに同じ文字列を使うとフェーズ変化を検知できない。

```tsx
const PHASE_MESSAGES: Partial<Record<Phase, string>> = {
  step1: "ステップ1を処理中",
  step2: "ステップ2を処理中",
  done:  "処理が完了しました",
};

// 常時 DOM に存在
<div aria-live="polite" aria-atomic="true" className="sr-only">
  {PHASE_MESSAGES[phase] ?? ""}
</div>
```

出力テキスト本体を live region に流してはいけない（AT が差分ごとに全文読み上げを試みる）。

**live region は「単一メッセージの独立 sr-only span」に隔離する**（WHY: `role="status"` / `aria-live` をコンテナや interactive 要素に付けると AT が変化のたびに内部全体の再読み上げを試みる）。3 つの適用: ① Skeleton 群は `aria-hidden="true"` で隠し、アナウンステキストは別の sr-only 要素に置く、② ボタンのコピー完了通知等はボタンの外の sr-only span でアナウンスする（AT がインタラクティブ要素内の live region を無視することがある）、③ 動的ステップリストは list container に `role="status"` を付けず、running 中のステップだけを sr-only span でアナウンスする。
```tsx
// ❌ ボタン内の aria-live は AT が無視することがある
<button onClick={handleCopy}>
  <span aria-live="polite">{copied ? "コピーしました" : ""}</span>
  コピー
</button>

// ✅ ボタン外の sr-only span でアナウンス
<span role="status" aria-live="polite" className="sr-only">
  {copied ? "クリップボードにコピーしました" : ""}
</span>
<button onClick={handleCopy}>コピー</button>
```
<!-- importance: high | mentions: 3 | first-seen: 2026-05 -->

**`aria-busy` は role を持つ要素に**: `<div>`（暗黙 role: generic）の `aria-busy` はサポート外の AT がある。`<section>`・`<main>`・`<article>` 等のランドマーク要素に付ける。`aria-busy={isLoading || undefined}` とすると false 時に属性が DOM から消える。
<!-- importance: medium | mentions: 2 | first-seen: 2026-05 -->

**スケルトン内のインタラクティブ要素に `inert` を使う**: `pointer-events-none` + `aria-hidden` だけではキーボードフォーカスが通り抜けてしまう。React 19 では `inert` を boolean prop として使える。
```tsx
<div className="pointer-events-none" aria-hidden="true" inert>
  {/* フォーム・ボタン等のスケルトン */}
</div>
```
`inert` はポインタ・キーボード・AT の全アクセスを遮断する。`pointer-events-none` と `aria-hidden` は冗長になるが意図を明示するため残してよい。
<!-- importance: medium | mentions: 1 | first-seen: 2026-05 -->

## その他の ARIA パターン

- **一覧の行に畳む「…」メニューは、`overflow-hidden` な祖先（角丸の表・カード）から自由なネイティブ Popover API（`popover="auto"` + `popoverTarget`）で作る**: 自前の `position: absolute` 配置は祖先が `overflow-hidden` を持つと最後の行のメニューが表の下端で切れる。Popover API は top layer に描画されるので祖先の overflow に関係なく切れない。位置は座標を自分で決め打ちする（対応ブラウザが揃うまで CSS anchor positioning には頼らない）: `onBeforeToggle` で `newState === "open"` のときトリガーの `getBoundingClientRect()` を読み `top`/`bottom`/`right` を直接セットする（`onToggle` ではなく `onBeforeToggle`。表示される前に位置を決めないと 1 フレーム別の場所に出る）。下に十分な空きが無ければ `bottom` 指定に切り替えて上へ開く。閉じる・フォーカスを戻す・外側クリックでの close・Esc はブラウザが Popover API としてやってくれるので自前実装は不要（`role="menu"` を名乗ると矢印キー移動を自前実装する契約になるので、単なるボタンの羅列なら role は付けない）。メニュー項目の `<button>` に `popoverTarget={id} popoverTargetAction="hide"` を付けると押すとすぐにメニューが閉じる。結果の通知（「コピーしました」等）はメニューの外（行の下等）に出す。閉じたメニューは `display: none` 相当になるので、項目の `onSelect` 内で確認ダイアログ（`<dialog>` 等）を開いても表示され続ける（`showModal()` はメニューの外側の state で管理する）。実例: MEGURU `src/admin/components/ActionMenu.tsx`（2026-09-18）。
  <!-- importance: medium | mentions: 1 | first-seen: 2026-09 -->
- **`<main>` は1ページに1つ**: AppLayout がすでに `<main>` を持つ場合、ページコンポーネントでは `<section aria-label="...">` を使う
- **`<a>` 内に `<button>` は HTML 仕様違反**: `<Link><Button>` ネストは不可。`asChild` パターン（`<Button asChild><Link>...</Link></Button>`）か `variant="link"` で解決
- **Radix `PopoverTrigger asChild` + `Button` の内部にインタラクティブ要素を置くと `<button>` inside `<button>` になる**: `PopoverTrigger asChild` は children を button としてレンダリングするため、内部に chips の削除ボタン等を置くと HTML 仕様違反になり Next.js が hydration エラーを報告する。対処: 内部のインタラクティブ要素は `<button>` ではなく `<span role="button" tabIndex={0} onKeyDown={...}>` で実装する。
  ```tsx
  // ❌ button > button — hydration error
  <PopoverTrigger asChild>
    <Button>
      <button onClick={handleUnselect}>✕</button>  {/* 内側の <button> が違反 */}
    </Button>
  </PopoverTrigger>

  // ✅ span role="button" で代替
  <PopoverTrigger asChild>
    <Button>
      <span role="button" tabIndex={0}
        onClick={(e) => { e.stopPropagation(); handleUnselect(); }}
        onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); handleUnselect(); } }}>✕</span>
    </Button>
  </PopoverTrigger>
  ```
  <!-- importance: high | mentions: 1 | first-seen: 2026-05 -->
- **Radix UI の `asChild` でインタラクティブなトリガーを作るときは必ず `<button>` でラップする**: `<Popover.Trigger asChild>` や `<DropdownMenu.Trigger asChild>` に `<span>` を渡すと Radix が `aria-haspopup`・`aria-expanded` を付与はするがキーボードフォーカスを保証しない（`<span>` は本来フォーカス不可）。「バッジをクリックしてメニューを開く」のような UX では、バッジが対応済みでも未対応でも `<button>` でラップしてから `asChild` に渡すこと。対応済みで disabled にしたい場合は `<button disabled>` にすれば Radix がそれを尊重する。実例: issue 111 の `ResolutionBadge` で `<span asChild>` から `<button asChild>` に変更（quality reviewer 指摘）。
  <!-- importance: medium | mentions: 1 | first-seen: 2026-06 -->
- **「見た目だけ隠す」を `hidden` / `display:none` でやると、その要素はタブ順から消える。`sr-only` を使う**: `<label class="btn">ラベル<input type="file" hidden></label>` のように隠した input をラベルでボタンに見せるパターンは、マウスでは普通に動くのでレビューでも実機でも気づかれないが、キーボードだけのユーザーはそのボタンに到達できない。`sr-only`（視覚的に隠すがフォーカスは受ける）に替える。ただしブラウザ既定のフォーカスリングは隠れた input 側に出て見えないので、ラベル側に出し直すところまでが 1 セット: `.btn:has(:focus-visible) { outline: 2px solid ... }`（Tailwind なら `has-[:focus-visible]:outline-2`）。`:focus`ではなく`:focus-visible`にするとマウスクリックでは出ない。判断基準: 「この隠し要素はフォーカスを受け取る必要があるか？」YES なら `hidden` は使えない
  <!-- importance: high | mentions: 1 | first-seen: 2026-09 -->
- **ネイティブ `<dialog>` は中身の見出しを自動ではアクセシブル名にしない**: Esc・フォーカストラップ・inert 化はブラウザがやってくれるので「`<dialog>` に任せれば a11y は済む」と思いやすいが、名前だけは付かず、スクリーンリーダーは「ダイアログ」としか読まない（追加なのか誰の編集なのか分からない）。`useId()` で採番した id を見出しに振り、`<dialog aria-labelledby={id}>` で結ぶ。検証は `getByRole('dialog', { name: ... })` かアクセシビリティツリーに名前が出るかで見る
  <!-- importance: high | mentions: 1 | first-seen: 2026-09 -->
- **「見た目はチップ/ボタン、実体は単一選択」は `<button>` の羅列ではなく `<fieldset>` + `sr-only` な radio にする**: 金額プリセット・期間切り替えのようなチップ UI を `<button>` で並べると、支援技術には「ボタンが N 個」としか伝わらず、単一選択であることも選択中の値も矢印キー移動も無い。`<fieldset>`/`<legend>` + `<label>` で包んだ `sr-only` radio に替えると、グループ名・選択状態・矢印キーでの移動・1 タブストップがすべてブラウザのネイティブ挙動として手に入る（上の WAI-ARIA Tabs のように `onKeyDown` を自前で書く必要がない）。見た目は `<label>` 側の class で従来どおり作れる。判断基準: 「これは排他選択か？」YES なら radio、独立した操作が N 個なら button のまま
  <!-- importance: high | mentions: 1 | first-seen: 2026-09 -->
- **カードリンクの accessible name**: `<Link aria-labelledby={headingId}>` + `<h3 id={headingId}>` で読み上げ内容を見出しに絞る
- **`<fieldset aria-label>` + `<legend>` は二重アクセシブル名**: `<legend className="sr-only">` だけ使い `aria-label` は付けない
- **`role="status"` は動的コンテナのみ**: 静的な空状態 `<div>` に付けない（「ここは更新されるエリア」と宣言することになる）
- **タブは `aria-current="page"` ではなく `aria-selected`**: `aria-current="page"` はページネーション・サイトマップで「現在のページ」を示す。タブコンテキストでは WAI-ARIA Tabs パターン（`<div role="tablist">` + `<button role="tab" aria-selected={...}>`）または単に `aria-selected={isActive}` を使う
  <!-- importance: medium | mentions: 1 | first-seen: 2026-05 -->
- **WAI-ARIA Tabs: roving tabindex だけでは不十分。矢印キーナビゲーションが必須**: `role="tablist"` を使う場合、`tabIndex={active ? 0 : -1}` の roving tabindex に加えて `onKeyDown` で ArrowLeft/ArrowRight によるフォーカス移動を実装すること。WAI-ARIA Tabs パターンの仕様要件。
  ```tsx
  const handleKeyDown = (e: KeyboardEvent, index: number) => {
    if (e.key === "ArrowRight") {
      const next = (index + 1) % TABS.length;
      const nextTab = TABS[next];
      if (nextTab) { setTab(nextTab); tabRefs.current[next]?.focus(); }
    } else if (e.key === "ArrowLeft") {
      const prev = (index - 1 + TABS.length) % TABS.length;
      const prevTab = TABS[prev];
      if (prevTab) { setTab(prevTab); tabRefs.current[prev]?.focus(); }
    }
  };
  ```
  <!-- importance: medium | mentions: 1 | first-seen: 2026-05 -->
- **`<Link>` の無効化には `tabIndex={-1}` + `aria-disabled` + `pointer-events-none` の3点セットが必要**: `aria-disabled` だけでは Tab でフォーカスして Enter でリンクを起動できてしまう。`tabIndex={-1}` でフォーカスを外すことで初めてキーボードからも無効化できる。
  ```tsx
  <Link
    href={href}
    aria-disabled={isPending}
    tabIndex={isPending ? -1 : undefined}
    className={`...${isPending ? " pointer-events-none opacity-50" : ""}`}
  >
    キャンセル
  </Link>
  ```
  <!-- importance: high | mentions: 1 | first-seen: 2026-05 -->
- **`role="link"` on `<div>` も Biome `useSemanticElements` が拒否**: disabled なナビゲーション項目を `<div role="link" aria-disabled>` で表現するとBiome エラー。`<button type="button" disabled>` が正しい代替（ナビ操作ではなくアクションとして扱い、 disabled でインタラクション不可を表現）。`<a>` を使いたい場合は `href` 省略 + `aria-disabled` が必要だがBiome の `useSemanticElements` が `href` なし `<a>` に対して `<span>` 推奨を出すことがある。`<button disabled>` が最も安全。
  <!-- importance: high | mentions: 1 | first-seen: 2026-05 -->
- **`aria-required` は `radiogroup` に付けられない**: WAI-ARIA 1.2 の `radiogroup` ロールの許可属性に `aria-required` は含まれない。「このフィールドは必須」を伝えたい場合は各 `<input type="radio">` に `required` 属性を付けるか、ブラウザの form バリデーションに任せる。Biome はこれを静的に検出しないことがあるが、AT（スクリーンリーダー）は無視するため実害も伝達もない。ならば付けない方が正確。
  <!-- importance: medium | mentions: 1 | first-seen: 2026-06 -->
- **ネイティブ `<button disabled>` に `aria-disabled` を重複させない**: `disabled` 属性があれば AT は自動的に「無効」と認識する。`aria-disabled` を追加すると二重アナウンスになるスクリーンリーダーが存在する。`aria-disabled` が必要なのは `disabled` を付けずにフォーカスを保持したいとき（e.g. フォーカスリングを残してユーザーにエラーを気づかせる UX）のみ。
  <!-- importance: medium | mentions: 1 | first-seen: 2026-06 -->
- **WCAG SC 2.5.3 (Label in Name): `aria-label` は可視テキストを包含しなければならない**: `aria-label` が AT のアクセシブル名を上書きするため、音声操作ユーザーが可視テキストを読んでコマンドを発話しても一致しない。fix パターン: (a) `aria-label` を削除して可視テキストそのままをアクセシブル名にする、(b) 可視テキストを完全に含む文字列に `aria-label` を変更する。例: ボタン内テキスト「ドラッグ&ドロップ または クリックして選択」に対して `aria-label="ファイルをドラッグアンドドロップ、またはクリックして選択"` → 違反。解決策 (a): `aria-label` を削除するだけ。亜種: 一覧の行・カードごとに対象名を足すときも、可視テキストをそのまま先頭に置く。`${name} を編集` は可視テキスト「編集」を含むが先頭でなく、「QR を無効化」→ `${name} を無効化` のように可視テキストの一部を削ると包含すら崩れる（W3C Understanding 2.5.3 は可視テキストを先頭に置くのを best practice としている・2026-09-14 確認）。形は「可視テキスト（対象名）」に固定し、1 関数（`labelWithSubject(visible, subject)` 等）に閉じる。状態で文字が変わるボタン（無効化 ⇄ 再有効化・コピー ⇄ コピーしました）は、可視テキストとラベルに同じ変数を渡す（別々に書くと片方だけ更新される）。レビューでは `rg -n 'aria-label=\{'` で拾い、ラベルの先頭がボタンの子テキストと一致するかを見る。実例: MEGURU PR #18（2026-09-14）。
  <!-- importance: high | mentions: 2 | first-seen: 2026-06 -->
- **Biome `useSemanticElements` が `role="radio"` on `<button>` を拒否**: 単一選択グループをボタン＋`role="radio"` で実装すると Biome がエラー。ネイティブの `<input type="radio" className="sr-only">` を `<label>` で包み、ラベル要素にカード状のスタイルを適用する。これで Biome・a11y・キーボード操作すべてが正しく動く。`aria-pressed` はボタンのトグル（複数選択を示唆）なので単一選択に使ってはいけない。
  ```tsx
  <label className={cn("flex-1 border px-3 py-2.5 cursor-pointer", isSelected ? "border-primary bg-primary" : "border-border")}>
    <input type="radio" name="group-name" value={opt.value} checked={isSelected}
      onChange={() => onSelect(opt.value)} className="sr-only" />
    {opt.label}
  </label>
  ```
  <!-- importance: high | mentions: 1 | first-seen: 2026-05 -->
- **ランドマーク（`<section>`＝暗黙 `role="region"`）は独立した機能単位（フォームエリア・ユーザーセクション等）にのみ付ける。装飾的グルーピングは素の `<div>`。曖昧なら `<section>` 寄せが安全**（WHY: 素の `<div>` は `aria-label` を付けても AT が無視する／`<section>` vs `role="region"` vs `<div>` の選択は複数の正当な答えがありレビュアー間で追加↔削除が揺れやすいので基準を固定する）。`<div>` へ移す場合は `role="region" aria-label="..."` を明示。「ランドマーク過剰」と感じるなら `<section>` ごと削除し `aria-label` も削除するのが一貫している。
  <!-- importance: medium | mentions: 2 | first-seen: 2026-06 -->
- **カスタムダイアログ（`<dialog>` / Radix UI 非使用）はフォーカス管理を手動で行う**: ネイティブ `<dialog>` や Radix `Dialog` を使わないカスタムオーバーレイは開時のフォーカス移動・Escape キーを自前で実装する。`tabIndex={-1}` を付けた内側コンテナに `useRef` でフォーカスを当て (`dialogRef.current?.focus()`)、外側コンテナに `onKeyDown` で Escape を捕捉する。
  ```tsx
  const dialogRef = useRef<HTMLDivElement>(null);
  useEffect(() => { if (open) dialogRef.current?.focus(); }, [open]);

  <div role="dialog" aria-modal="true" aria-labelledby="title-id"
    onKeyDown={(e) => { if (e.key === "Escape") setOpen(false); }}>
    <div ref={dialogRef} tabIndex={-1} className="... focus:outline-none">
      ...
    </div>
  </div>
  ```
  `focus:outline-none` を忘れるとフォーカスリングが意図しない場所に出る。Radix/headlessui が使えるならそちらが正解（フォーカストラップも含む）。
  <!-- importance: medium | mentions: 1 | first-seen: 2026-06 -->
- **key-value ペア（ファイル名・作成者・日時等）のメタ情報は `<dl>/<dt>/<dd>` で表現する**: `<span>ファイル名: foo.mp4</span>` のようなコロン区切り表示はスクリーンリーダーに「用語/説明」の関係を伝えない。`<dl>` (description list) / `<dt>` (term) / `<dd>` (detail) を使うことで AT がペアを構造として認識する。アイコンには `aria-hidden="true"` を付けて読み上げを抑止し、`<dt>` にラベルを書く。
  ```tsx
  <dl className="flex items-center gap-1.5 text-xs">
    <FileAudio className="size-3.5 shrink-0" aria-hidden="true" />
    <dt className="font-medium">ファイル名</dt>
    <dd className="truncate">{fileName}</dd>
  </dl>
  ```
  **判断基準**: UI に「〇〇: 値」という表示パターンがあれば `<dl>/<dt>/<dd>` 候補。単なる説明文（段落）なら `<p>` でよい。実例: issue 258 の `minutes-detail-view.tsx` でファイル名表示を `<span>ファイル名:</span>` から `<dl>/<dt>/<dd>` に変更（quality reviewer 指摘）。
  <!-- importance: medium | mentions: 1 | first-seen: 2026-06 -->
- **チャートライブラリが描く `<svg>` はタブ順に現れる前提で名前を与え、同じ数字を持つ表を併置して `aria-label` からその表を名前で指す**: ライブラリは図の `<svg>` に `role="application"` + `tabindex="0"` を自分で付けることがある（recharts 3.10.1 で実測・2026-09-11。`<BarChart>` に渡した `aria-label` はその svg まで届く）。名前を与えないと「アプリケーション」とだけ読まれ、そこが何で中に何があるのか分からないまま必ず 1 タブストップ消費する行き止まりになる。さらに図そのものにはデータ点を 1 つずつ読ませる手段が無い（recharts 3.10.1 は svg にフォーカスして矢印キーを押してもツールチップが動かないことを実測）ので、名前だけ付けても中身には到達できない。対処: 同じ数字を持つ表（`<caption className="sr-only">` で名前を付ける）を下に置き、図の `aria-label` を「…の棒グラフ。同じ数字は下の『<表の名前>』にもあります」にする。図と表の呼び名は定数 1 つから両方に渡す（別々に書くと片方の rename で案内が食い違う）。判断基準: 「この図の中の 1 データ点に、キーボードだけで到達できるか？」NO なら表を併置する。
  <!-- importance: high | mentions: 1 | first-seen: 2026-09 -->
- **`aria-label` に種類名を足すとき、その名前がユーザー入力なら種類名が二重になる**: `aria-label={`${qr.name} の QR を無効化`}` は名前が「検証用 QR」のとき「検証用 QR の QR を無効化」と読まれる（実機のアクセシビリティツリーで確認・2026-09-11）。画像の `alt` も同じ（`${name} QR` → 「検証用 QR QR」）。一覧の行・カードのボタンは可視テキストが全部同じになるので `aria-label` で名前を入れる必要がある一方、種類名は画面の見出し（「◯◯ の QR」）が既に担っている。ただし可視テキストから種類名を削って「名前 + 動詞」にしてはいけない。可視テキスト「QR を無効化」がラベル「101 を無効化」に含まれず WCAG 2.5.3 違反になる（上の Label in Name 参照・2026-09-14 訂正）。可視テキストはそのまま先頭に置き、名前は括弧で後ろに足す（「QR を無効化（検証用 QR）」。括弧で区切れば種類名が続けて読まれない）。判断基準: 「このラベルを、名前の欄に種類名を入れた実データで読み上げてみて自然か？」と「ラベルが可視テキストで始まっているか？」の両方。
  <!-- importance: medium | mentions: 2 | first-seen: 2026-09 -->
- **可視の警告テキストがある場合、`aria-label` に副作用テキストを重複させるより `aria-describedby` で参照する**: ボタンの隣に「この操作は〇〇をリセットします」という visible な警告段落がある場合、`aria-label="差し替える（〇〇がリセットされます）"` のように副作用テキストを aria-label に詰め込むのは WCAG anti-pattern。スクリーンリーダーが label と可視テキストを両方読み上げ、情報が重複する（二度読み）。対処: 警告段落に `id="warning-id"` を付け、ボタンに `aria-label="<動詞>"` + `aria-describedby="warning-id"` を設定する。label は短いアクション名・describedby は可視の補足テキストを参照する形が WCAG の推奨パターン。
  ```tsx
  <p id="replace-warning">操作の効果説明（可視テキスト）</p>
  <Button aria-label="差し替える" aria-describedby="replace-warning">差し替える</Button>
  ```
  実例: issue 224 の差し替えボタンで長い aria-label から `aria-describedby="replace-warning"` パターンに修正（PR #180 Round 2 quality reviewer 指摘）。
  <!-- importance: medium | mentions: 1 | first-seen: 2026-06 -->
