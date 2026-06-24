# React レビュー観点

> **TL;DR**: Container/Presenter 分離を徹底し、ビジネスロジックはカスタムフックに集約して View を dumb 化する。`role` prop 禁止（ARIA 属性と衝突）。Props は明示型・肯定形 boolean・`on` プレフィックス統一。a11y・Biome a11y ルール → `react-a11y.md`。JSX の `key={i}` は Biome `noArrayIndexKey` で拒否 — content-based key か `.map()` 外変数に切り出して biome-ignore を付ける。`useState(initialValue)` は初回マウント時のみ有効 — sessionStorage 等の非同期初期値は hasMounted パターンで対処。実装中の落とし穴 → `react-gotchas.md`

TypeScript の観点に加え、以下の観点でレビューする。

## コンポーネント設計

- **1ファイル1コンポーネント**: 複数コンポーネントを1ファイルに export しない
- **Container/Presenter 分離**: データフェッチ・mutation と表示を分ける
  - Container: データ取得・イベントハンドラ・状態管理
  - Presenter: props を受け取るだけの純粋な表示
- **class コンポーネント禁止**: 関数コンポーネントのみ使う
- **pending → done 遷移でコンポーネントを切り替えるとレイアウトジャンプが起きる**: 状態ごとに別コンポーネントを使うと `status` 変化時に React がアンマウント→マウントしてセクション配置が丸ごと入れ替わる。対処: 全状態を1コンポーネントで表現してセクション順序を固定し、done でのみ現れるセクションは末尾に追加するだけにする。pending 中でもヘッダーを常駐させ、データ未着のセクションはプレースホルダーテキスト（例: "Web 検索後に表示されます"）で表示しておく。判断基準: "この状態変化でコンポーネントを差し替えたとき、既存セクションが動くか？" → 動くなら unified コンポーネントに移行する。
  <!-- importance: high | mentions: 1 | first-seen: 2026-05 -->

## Props 設計

- Props の型は明示的に定義する（`type Props = { ... }`）
- boolean の props は肯定形にする（`isDisabled` > `isNotEnabled`）
- イベントハンドラは `on` prefix（`onClick`, `onSubmit`）
- **`role` を prop 名にしない**: Biome の `useValidAriaRole` が発火する。`variant`・`sender`・`kind` 等を使う

## フック

- カスタムフックは `use` prefix、1ファイル1フック export
- フック内にビジネスロジックを集約し、コンポーネントを薄く保つ
- **フックの言語は「ドメイン」、View の言語は「UI イベント」**: フックが返す関数はドメインアクション動詞で命名する（`selectFile`, `generate`）。`on` prefix は View props の言語。Container がドメイン → UI イベントへのマッピングを担う（`onSubmit={generate}`）
- **TanStack Query のローディング状態**: `isLoading` と data 存在をセットで確認する。単に `!data` チェックだけでは初回フェッチと再フェッチを区別できない
  <!-- importance: medium | mentions: 1 | first-seen: 2026-05 -->
  ```ts
  const { data, isLoading } = useQuery(...)
  if (isLoading) return <Skeleton />  // 明示的な初回ローディング
  if (!data) return <Error />          // データ取得失敗
  ```
- **View が "smart" だと感じたら状態を吸い上げる**: `useState`・`useMutation`・非同期ロジックを View が持っていたらカスタムフックに移す
- **discriminated union の片方にしか必要ないフックはコンポーネントを分割する**: `useCopyFeedback("")` のように "wrong" なブランチでも空値でフックを呼んでしまうのは設計臭。hooks-at-top-level 制約でインラインの条件付き呼び出しはできないため、コンポーネントを `PendingXxx` / `DoneXxx` 等に分割し、フックを必要なコンポーネントにのみ閉じ込める。判断基準: "このフックはあるブランチでは実際に使われているか？" → 使われないなら分割せよ。
  <!-- importance: medium | mentions: 1 | first-seen: 2026-05 -->
- **フックは early return より前に**: `useCallback`・`useState` 等を条件分岐の early return より後に置くと `useHookAtTopLevel` lint エラーになる。early return が必要な場合でも全フックをコンポーネントトップに集約してから分岐する
  <!-- importance: high | mentions: 2 | first-seen: 2026-05 -->
- **stale closure**: conditional な `setState` は functional update で書く（`setJobName(prev => prev || file.name)`）
- **stale async result — generationRef パターン**: 非同期コールバック実行中に別操作が割り込んだ場合、古い Promise の結果を反映しないよう世代管理する
  ```ts
  const generationRef = useRef(0);
  const handleSubmit = useCallback(async () => {
    const gen = ++generationRef.current;
    const result = await onSummarize(input);
    if (generationRef.current === gen) setResult(result);  // 世代が変わっていれば無視
  }, [onSummarize, input]);
  const handleCancel = useCallback(() => { generationRef.current++; }, []);
  ```
- **`useState(initialValue)` は初回マウント時のみ適用される — sessionStorage / 非同期初期値を渡す場合は hasMounted パターン**: `useState(props.initialValue)` はコンポーネントの最初のレンダーにしか適用されない。親から `useEffect` 経由で非同期に計算した初期値を `setResume(value)` しても、子コンポーネントの `useState` は再度初期化されない。対処: 子コンポーネントを「初期値が確定してから初めてレンダーする」ように `hasMounted` フラグで制御する。
  ```tsx
  // ❌ useEffect で resume を取得 → DocumentNewView の useState は既に "" で初期化済み
  const [resume, setResume] = useState(null);
  useEffect(() => { setResume(consumeResumeInput()); }, []);
  return <DocumentNewView initialTemplateId={resume?.templateId} />;

  // ✅ hasMounted が true になるまで描画をスキップ → mount 時に resume が確定している
  const [resume, setResume] = useState(null);
  const [hasMounted, setHasMounted] = useState(false);
  useEffect(() => { setResume(consumeResumeInput()); setHasMounted(true); }, []);
  if (!hasMounted) return null;
  return <DocumentNewView initialTemplateId={resume?.templateId} />;
  ```
  判断基準: "子コンポーネントが `useState(props.xxx ?? default)` の形で props を初期値に使っているか？" → 使っているなら hasMounted パターンが必要。
  <!-- importance: high | mentions: 1 | first-seen: 2026-06 -->
- **early return の後で hook を呼べない → コンポーネントを分割する**: コンポーネントが早期 return（空状態・ローディング等）した後に hook を呼ぶ必要があるとき、React の「hook は条件分岐内・early return 後に呼べない」ルールに違反する。対処: コンポーネントを 2 層に分割する — 外側（`OuterComponent`）が early return を担い、内側（`InnerComponent`）が hook を呼ぶ。外側は early return を通過したときだけ内側をレンダーする。
  ```tsx
  // ❌ early return 後に useXxxPoll を呼べない（React ルール違反）
  function InvoicePage({ months }: Props) {
    if (months.length === 0) return <InvoiceEmptyState />;
    const { job } = useInvoiceMatchingPoll(jobId); // Hook after conditional return
    ...
  }

  // ✅ 外側が early return、内側が hook を呼ぶ
  function InvoicePage({ months }: Props) {
    if (months.length === 0) return <InvoiceEmptyState />;
    return <InvoicePageInner months={months} />;
  }
  function InvoicePageInner({ months }: Props) {
    const { job } = useInvoiceMatchingPoll(jobId); // OK: early return なし
    ...
  }
  ```
  <!-- importance: medium | mentions: 1 | first-seen: 2026-06 -->
- **async fetch → EventSource の2ステップは単一 `useEffect` に統合する**: fetch が resolve した後に別の effect が再実行されることはない（deps が変化しない限り）。fetch と EventSource を別 effect に分けると、fetch が完了しても EventSource effect が起動せず永遠に EventSource が開かない。正しい設計: 単一 effect 内で `const run = async () => { const data = await fetch(...); if (data.status === "done") return; es = new EventSource(...); }` として sequential に記述し、cleanup で `cancelled = true; es?.close()` を返す。
  ```ts
  useEffect(() => {
    let cancelled = false;
    let es: EventSource | null = null;
    const run = async () => {
      const snapshot = await fetchState(stateUrl);
      if (cancelled) return;
      setJob(snapshot);
      if (!snapshot || snapshot.status === "done" || snapshot.status === "failed") return;
      es = new EventSource(streamUrl);
      es.onmessage = (e) => { /* fold events */ };
    };
    void run();
    return () => { cancelled = true; es?.close(); };
  }, [stateUrl, streamUrl]);
  ```
  <!-- importance: high | mentions: 1 | first-seen: 2026-06 -->

## 禁止パターン

- `useEffect` でのデータフェッチ（React Query 等を使う）
- `any` 型の Props
- インラインでの複雑なロジック（カスタムフックに抽出する）
- **テーブル `<thead>` の条件付き `<th>` に対応する `<td>` も同じ条件でラップする**: `{condition && <th>...</th>}` で列を条件付き表示するとき、対応する `<tbody>` 側の `<td>` を条件なしで常時レンダリングすると thead=N列・tbody=N+1列になりテーブル構造違反になる（スクリーンリーダーが列の対応を誤解釈する）。判断基準: "この `<th>` の追加は `{condition && ...}` でラップされているか？" → YES なら対応する全 `<td>` も同じ `{condition && ...}` でラップする。実例: pairing-detail-table.tsx の「対処」列で `onResolutionToggle` の条件が `<th>` にのみ付き `<td>` が常時存在していた（quality reviewer が検出）。
  <!-- importance: medium | mentions: 1 | first-seen: 2026-06 -->
- **JSX の boolean guard で `??` を "OR" の代わりに使う**: `{condition && (a ?? b)}` の形で `??` を使うと、`a` が truthy のとき `a`（文字列・オブジェクト等）が返り JSX がそれを render しようとする。"どちらか一方が存在すれば表示" の意図なら `||` か `!= null` の OR を使う。
  <!-- importance: medium | mentions: 1 | first-seen: 2026-05 -->
  ```tsx
  // ❌ detail が "" (falsy) のとき collected != null の boolean が返る — 意図が曖昧
  {step.detail ?? step.collected != null}
  // ✅ 「どちらかが存在すれば表示」の意図を明示
  {step.detail != null || step.collected != null}
  ```

## useMemo で同一入力から複数派生値を作る（single-pass pattern）

同じ文字列（や配列）を2つの別フック・別関数でそれぞれパースすると、インデックス・位置・ID の結合が発生してどちらか一方が変わると壊れる。**1つの `useMemo` で全派生値をまとめて返す**のが正しい設計。

```tsx
// ❌ 2箇所でパースするとインデックス結合が生まれる
const blocks = useMemo(() => parseBlocks(report), [report]);   // \n\n split
const headings = useReportOutline(report);                      // line split — ズレうる

// ✅ 1回のパスで blocks + headings をまとめて返す
function useParsedReport(report: string) {
  return useMemo(() => {
    const blocks: ReportBlock[] = [];
    const headings: HeadingEntry[] = [];
    let counter = 0;
    for (const [key, block] of report.split("\n\n").entries()) {
      if (block.startsWith("## ")) {
        const id = `heading-${counter++}`;
        headings.push({ id, level: 2, text: block.slice(3).trim() });
        blocks.push({ type: "h2", headingId: id, key, text: block.slice(3).trim() });
      } else {
        blocks.push({ type: "p", text: block, key });
      }
    }
    return { blocks, headings };
  }, [report]);
}
```
<!-- importance: medium | mentions: 1 | first-seen: 2026-05 -->

## react-markdown で TOC を作るなら本文 id と目次 id を同じ正規化で揃える

react-markdown + remark-gfm で本文を描画し、別途 raw markdown から目次（TOC）を作るとき、**本文側の見出し id（rendered text 由来）と目次側の id（raw markdown 由来）がズレやすい**。書式付き見出し（`## **重要**動向`）でアンカーが効かない（クリックしても飛ばない）形で表面化する。

- 本文側: `components.h2` で id を振るには `children`（React 要素ツリー）からテキストを取り出す。`<strong>`・`<a>` 等インライン要素を含むと文字列でないので、`isValidElement` + `props.children` を再帰する `childrenToText` が必要。素朴な `String(children)` は `[object Object]` や一部欠落になる。
- 目次側: raw markdown 行から id を作るので、`**bold**`・`[text](url)`・`` `code` `` 等のインライン記法を除去してからスラッグ化する。
- **両者が同じ正規化（記法除去 → trim → 空白を `-`）に到達して初めて id が一致する**。片方だけ実装すると書式付き見出しでだけ静かに壊れる（プレーン見出しは一致するので気づきにくい）。
<!-- importance: medium | mentions: 1 | first-seen: 2026-06 -->

## 固定シェル + 内側パネルだけスクロール（h-screen + min-h-0 チェーン）

ヘッダー/サイドを固定し、特定パネル（リスト・本文）だけを独立スクロールさせる「アプリシェル」型レイアウトの 2 つの落とし穴:

1. **`h-full` は flex で伸ばされた親（height: auto）に対して解決しない** → 子の `height: 100%` が `auto` になりページ全体が伸びる。ルートを `h-screen`（ビューポート高を直接指定）にし、そこから各段を `flex flex-col min-h-0` で繋いで、スクロールさせたいパネルに `flex-1 min-h-0 overflow-y-auto` を付ける。**`min-h-0` が 1 段でも抜けると** flex item の min-content 高ではみ出し、パネルが縮まずページがスクロールする。
2. **`<a href="#id">` のアンカー遷移はスクロール可能な祖先を全て動かす（window も含む）** → 内側パネルだけ動かしたいのにブラウザ既定挙動でページ全体（window）もジャンプする。対処: `onClick` で `e.preventDefault()` し、対象見出しの**最近接スクロール祖先**（`scrollHeight > clientHeight` を上に辿る）に対してだけ `scrollBy({ top: delta })` する。`href` は中クリック・コピー用に残す。
3. **flex-COLUMN 内で `flex-1` から高さを得る overflow scroll container は、`clientHeight` が bound されていても `scrollHeight` を `documentElement.scrollHeight` に漏らす（Chromium）** → root を `overflow-hidden` にしても window は実際にはスクロールしないが、`documentElement.scrollHeight` が巨大化し phantom なページスクロール（ブラウザによっては縦スクロールバー）が出る。**祖先への `overflow:hidden` 追加でも、scroll container を div でラップしても止まらない**（overflow clip ではなく flex-column の「content 基準の高さ昇格」が原因のため）。唯一効くのは漏らす要素自身への **`contain: size layout`**（CSS containment で subtree を文書高から隔離）。`flex: 1 1 0%` で高さが外部決定されているので size containment は安全。**flex-ROW の scroll container（`flex-1 min-w-0 overflow-y-auto`）は同条件でも漏れない** — cross-axis stretch で高さが definite だから。切り分け: `el.style.contain='size layout'` を当てて `documentElement.scrollHeight` が落ちれば確定。実機計測で確認（ul を contain すると html scrollHeight 7739→900・内部スクロールは維持）。
<!-- importance: medium | mentions: 1 | first-seen: 2026-06 -->

## Biome Gotchas

- **`noArrayIndexKey`**: `key={i}` を JSX 内で使うとエラー。`.map()` 呼び出しを JSX 外の変数に切り出して `// biome-ignore` を置くか、content-based key を使う
  <!-- importance: high | mentions: 3 | first-seen: 2026-05 -->
  **静的配列で全要素が一意な場合は値そのものを key にする**（例: `[75, 60, 85, 55, 70].map((w) => <div key={w}>...`）。オブジェクト配列のプロパティアクセス `key={item.key}` も非フラグ（直接インデックス変数だけが対象）。
  **`// biome-ignore` は多行 JSX 要素では機能しない**: コメントを要素開始タグ `<div` の直前行に置いても、`key={i}` が属性として別の行にある場合は suppression が効かない。回避策: content-based key に変更するか、`.map()` を JSX の外の変数（`const items = arr.map(...)` ）に切り出してコメントを付ける。
- **`noAssignInExpressions`**: `(acc[k] ??= []).push(v)` は不可。if-else で明示的に分岐する
- **`useSemanticElements` が `role="radio"` on `<button>` を拒否**: 詳細は `react-a11y.md` 参照
- **formatter**: 複数属性を持つ JSX で長い属性値があれば多行フォーマットを強制される。初めから多行で書く
- **`organize-imports`**: packages before relative、type before value。`biome check --write` で自動修正
- a11y 関連 Biome ルール → `react-a11y.md`

## アプリ全体で共有する state は `useSyncExternalStore` + モジュール変数で作る

`useState` ベースの hook を複数コンポーネントから呼ぶと、それぞれが独立した state インスタンスを持つ。片方のコンポーネントが値を更新しても、他のインスタンスには伝わらない。

**典型的な症状**: ダークモードトグルを押すと toggle コンポーネント自身は再描画されるが、開きっぱなしの別コンポーネント（例: CodeMirror エディタ）の theme prop が古い値のまま残る。

**判断基準**: アプリ内で「1つしか存在しない」状態（テーマ、言語、認証状態など）はモジュールレベルの singleton store にする。`Context` も選択肢だが、アプリ全体 singleton なら Provider が増えるだけで利点がない。

source of truth が DOM にある場合（例: `<html>` クラスでテーマを管理）はさらにシンプルにできる。モジュール変数のキャッシュも `Set<Listener>` も不要 — DOM を直接読み、`window` event で通知する。

```ts
const EVENT = "my:flag-change";

function applyFlag(next: boolean) {
  document.documentElement.classList.toggle("my-flag", next);
  window.dispatchEvent(new Event(EVENT));
}

function subscribe(listener: () => void) {
  window.addEventListener(EVENT, listener);
  return () => window.removeEventListener(EVENT, listener);
}

export function useGlobalFlag() {
  const value = useSyncExternalStore(
    subscribe,
    () => document.documentElement.classList.contains("my-flag"),
    () => false,
  );
  return { value, toggle: () => applyFlag(!value) };
}
```

モジュール変数にキャッシュする版は、DOM 以外（API 状態、認証トークンなど）に向く:

```ts
type Listener = () => void;
const listeners = new Set<Listener>();
let value = false;

function subscribe(listener: Listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useGlobalFlag() {
  return useSyncExternalStore(subscribe, () => value, () => false);
}

export function setGlobalFlag(next: boolean) {
  value = next;
  for (const l of listeners) l();
}
```
<!-- importance: high | mentions: 2 | first-seen: 2026-05 -->

## `Response.json()` は一度しか読めない — ok/error 分岐の前に一度だけ読む

`fetch` の `Response` body は ReadableStream のため、`.json()` を複数回呼ぶと 2 回目以降は `TypeError: body used already` になる。ok チェックより前に一度だけ読んでおき、成功・失敗どちらのパスでも同じ変数を使いまわす。

```ts
// ❌ エラーパスと成功パスで別々に読む（2 回目で runtime error）
if (!res.ok) {
  const rawBody = await res.json();  // 1 回目
  setError(extractErrorMessage(rawBody));
  return;
}
const rawData = await res.json();    // 2 回目 → body used already

// ✅ 分岐の前に一度だけ読む
const rawData = await res.json().catch(() => ({}));
if (!res.ok) {
  setError(extractErrorMessage(rawData));
  return;
}
const count = rawData.data?.count ?? 0;
```

try/catch でエラー時に `{}` を返すフォールバック（`.catch(() => ({}))`）を付けると、JSON パース失敗（HTML エラーページ返却等）でもクラッシュしない。
<!-- importance: medium | mentions: 1 | first-seen: 2026-06 -->

## 二重送信防止は `disabled` よりレンダリング除去が構造的に強い

in-flight 中に送信トリガー（ボタン・ドロップゾーン等）を `disabled` にするだけでは、将来の変更で `disabled` を漏らした場合に防止が機能しなくなる。in-flight 状態に専用 UI（スピナーカード等）を表示し、**送信トリガー自体をレンダリングしない** 3 分岐構造の方が構造的に強い。

```tsx
// ❌ disabled 頼み（将来の拡張で漏れやすい）
<button disabled={isUploading} onClick={upload}>アップロード</button>

// ✅ in-flight 中はトリガーをレンダリングしない
{isUploading ? (
  <div>取り込み中… <Spinner /></div>
) : uploaded ? (
  <SuccessCard>差し替えボタン</SuccessCard>   // ← in-flight 中は描画されない
) : (
  <DropZone onDrop={upload} />               // ← in-flight 中は描画されない
)}
```

判断基準: 「同一フォームが複数の entry point（ボタン・ドロップ・キーボードショートカット等）を持つか？」YES なら全 entry point で disabled を揃えるコストが高いのでレンダリング除去一択。

## 動的に挿入されるローディングカードには `role="status"` + `aria-hidden` が必要

in-flight 中にスピナーカードをレンダリングする構造（上記「レンダリング除去」パターン）では、カードが**動的に DOM に挿入される**ため、スクリーンリーダーは mount 時の読み上げを行う。しかし `role="status"` がないと live region として扱われず、状態変化が通知されないリーダー実装もある。

```tsx
// ❌ role なし — 一部リーダーで読み上げが起きない
<div className="flex items-center gap-3">
  <RefreshCw className="animate-spin" />
  <p>取り込み中…</p>
</div>

// ✅ role="status" + aria-hidden でリーダーに正しく通知
<div role="status" aria-live="polite" className="flex items-center gap-3">
  <RefreshCw aria-hidden="true" className="animate-spin" />
  <p>取り込み中…</p>
</div>
```

- `role="status"` は `aria-live="polite"` を暗黙に含むが、明示すると意図が読みやすい
- 装飾的なアイコン（スピナー・チェックマーク等）は `aria-hidden="true"` でリーダーから隠す。テキストが意味を担うため二重読み上げが起きない
- **`aria-label` は付けない**: `role="status"` の live region に `aria-label` を付けると内容とラベルを二重読み上げするリーダーがある（「ステータス: 取り込み中… 取り込み中…」のようになる）
<!-- importance: medium | mentions: 1 | first-seen: 2026-06 -->

## 条件付きマウントのアラート div には `role="alert"` が必要

`isError && <div>...</div>` や `isMultiInvoice && mode === "view" && <div>...</div>` のように**条件分岐によって動的にマウントされるエラー・警告 div** は `role="alert"` を付ける。`role="alert"` は `aria-live="assertive"` を暗黙に含むため、DOM に挿入された瞬間にスクリーンリーダーが割り込み読み上げを行い、ユーザーに警告を届けられる。

`role="status"`（polite — 現在の読み上げを中断しない）との使い分け:
- **`role="alert"`**: エラー・操作ロック警告・入力バリデーション失敗 — 即座に伝える必要がある
- **`role="status"`**: ローディング・進捗 — 流れを妨げない程度に伝える

```tsx
// ❌ role なし — 条件付きマウントはスクリーンリーダーに通知されない
{isMultiInvoice && <div className="rounded-lg bg-destructive/10 ...">
  複数請求書が紐付いています。
</div>}

// ✅ role="alert" — マウント時に即時読み上げ
{isMultiInvoice && <div role="alert" className="rounded-lg bg-destructive/10 ...">
  <AlertTriangle aria-hidden="true" />
  複数請求書が紐付いています。
</div>}
```

静的に常時表示されている要素（非表示の切り替えに CSS class だけ使う場合）は `aria-live="assertive"` を直接付ける方が確実。`role="alert"` は「DOM に存在しない → 挿入」の遷移で発火するため、最初から存在して `hidden` → `visible` に変わるケースは拾えない。

**装飾的なテキスト文字（✓・⚠）も `aria-hidden="true"` が必要**: SVG アイコンコンポーネントだけでなく、`✓` や `⚠` のような Unicode 文字もスクリーンリーダーが「チェックマーク」「感嘆符」として読み上げる。意味はその後のテキストが担うため `<span aria-hidden="true">✓</span>` で隠す（実例: issue 242 の `AlignBadge`）。
<!-- importance: medium | mentions: 2 | first-seen: 2026-06 -->

**Radix UI の `asChild` でインタラクティブなトリガーを作るときは必ず `<button>` でラップする**: `<Popover.Trigger asChild>` や `<DropdownMenu.Trigger asChild>` に `<span>` を渡すと Radix が `aria-haspopup`・`aria-expanded` を付与はするがキーボードフォーカスを保証しない（`<span>` は本来フォーカス不可）。「バッジをクリックしてメニューを開く」のような UX では、バッジが対応済みでも未対応でも `<button>` でラップしてから `asChild` に渡すこと。対応済みで disabled にしたい場合は `<button disabled>` にすれば Radix がそれを尊重する。実例: issue 111 の `ResolutionBadge` で `<span asChild>` から `<button asChild>` に変更（quality reviewer 指摘）。
<!-- importance: medium | mentions: 1 | first-seen: 2026-06 -->
