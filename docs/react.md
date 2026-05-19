# React レビュー観点

TypeScript の観点に加え、以下の観点でレビューする。

## コンポーネント設計

- **1ファイル1コンポーネント**: 複数のコンポーネントを1ファイルに export しない
- **Container/Presenter 分離**: データフェッチ・mutation と表示を分ける
  - Container: データ取得・イベントハンドラ・状態管理
  - Presenter: props を受け取るだけの純粋な表示
- **class コンポーネント禁止**: 関数コンポーネントのみ使う

## Props 設計

- Props の型は明示的に定義する（`type Props = { ... }`）
- boolean の props は肯定形にする（`isDisabled` > `isNotEnabled`）
- イベントハンドラは `on` prefix（`onClick`, `onSubmit`）
- **`role` を prop 名にしない**: React は `role` を HTML の ARIA role 属性として扱うため、Biome の `useValidAriaRole` ルールが発火する。ユーザー/エージェントの区別などには `variant`、`sender`、`kind` 等を使う。

## フック

- カスタムフックは `use` prefix、1ファイル1フック export
- フック内にビジネスロジックを集約し、コンポーネントを薄く保つ
- 副作用（`useEffect`）は最小限に。依存配列を正確に書く
- **フックの言語は「ドメイン」、View の言語は「UI イベント」**: フックが返す関数はドメインアクション動詞で命名する（`selectFile`, `generate`, `reset`）。`on` prefix（`onFileSelect`, `onSubmit`）は View props の言語であって、フックがやっていることの名前ではない。Container（クライアントコンポーネント）がドメイン → UI イベントへのマッピングを担う（例: `onSubmit={generate}`）。命名がずれていたら、それは責務の境界がずれているサイン。
- **View が "smart" だと感じたら状態を吸い上げる**: View コンポーネントが内部で `useState`・`useMutation`・非同期ロジックを持っていると、テスト・再利用・ライブラリ（TanStack Query 等）との統合が難しくなる。そのときは View を「props を受け取って描画するだけ」の dumb component に変え、ロジックをカスタムフック（Container）に移す。View の `onSubmit` が `() => void` になれば、フック内の `mutate()` をそのまま渡せるようになる。
- **stale closure 対策**: フック内のイベントハンドラで state を読むとクロージャが古い値を掴む。conditional な `setState` は functional update で書く。
  ```ts
  // ❌ クロージャが古い jobName を読む
  if (!jobName) setJobName(file.name);
  
  // ✅ functional update でクロージャ問題を回避
  setJobName(prev => prev || file.name);
  ```

- **stale async result 対策（generationRef パターン）**: 非同期コールバック（`onSummarize: (input) => Promise<string>` 等）の実行中にユーザーが別の操作（履歴選択・リセット等）をした場合、古い Promise の結果を画面に反映してしまうことがある。`generationRef` カウンタで世代管理し、完了時に世代が一致しなければ結果を無視する。
  ```ts
  const generationRef = useRef(0);

  const handleSubmit = useCallback(async (e) => {
    const gen = ++generationRef.current;
    setIsProcessing(true);
    const result = await onSummarize(input);
    if (generationRef.current === gen) {  // 世代が変わっていれば無視
      setIsProcessing(false);
      setResult(result);
    }
  }, [onSummarize, input]);

  const handleCancel = useCallback(() => {
    generationRef.current++;  // インクリメントで進行中の Promise を失効させる
    setIsProcessing(false);
  }, []);
  ```

## a11y 注意点

- **`<div>` に `aria-label` を直接付けない**: Biome の `useAriaPropsSupportedByRole` ルールがエラーを出す。ラベル付けしたいコンテナには `<section>`（implicit `region` role）か `role="region"` を使う。ローディング UI やランドマーク的なラッパーで頻発しやすい。
- **`<main>` の二重ネスト禁止**: HTML 仕様では1ページに `<main>` は1つ。AppLayout 等のシェルコンポーネントがすでに `<main>` を持っている場合、配下のページコンポーネントで再度 `<main>` を使うと仕様違反。代わりに `<section aria-label="...">` を使う。
- **`role="status"` は動的ローディングコンテナのみ**: `role="status"` は ARIA ライブリージョンで、スクリーンリーダーが変化を検知して読み上げる用途向け。静的な空状態 `<div>` に付けるのは誤り（意味的に「ここは更新されるエリア」と宣言することになる）。スケルトンのローディング UI のラッパーにのみ使う。`<ul aria-busy>` より `<div role="status"><ul>` のネストが正確。
- **`role="status"` で Skeleton 要素を囲むと各子要素の追加がアナウンスされる**: `role="status"` はライブリージョンのため、内部に `<Skeleton>` を動的に追加すると AT が各バーを読み上げてしまう。テキストアナウンスと視覚的 Skeleton は分離する: `<p className="sr-only">読み込み中</p>` を先頭に置き、**Skeleton 群は `<div aria-hidden="true">` で囲む**（`aria-busy="true"` では AT が子要素をまだ読み上げる場合がある。`aria-hidden` で完全に隠す）。
- **`aria-live` live region は常時 DOM に存在させる**: AT はページロード時（または DOM 挿入時）に live region を登録する。`{condition && <div aria-live="polite">}` のように条件付きでレンダリングすると、condition が `true` になった瞬間に挿入されるが一部の AT（NVDA 等）はそれを拾えない。正しくは常時 DOM に置き、content を条件で切り替える:
  ```tsx
  // ❌ 条件付きマウント — AT が拾えないことがある
  {isStreaming && <div aria-live="polite">{text}</div>}

  // ✅ 常時 DOM に存在 — content を切り替える
  <div aria-live="polite" aria-atomic="true" className="sr-only">
    {isStreaming ? text : ""}
  </div>
  ```
  処理フェーズが複数ある場合は **phase に応じた固定ステータスメッセージだけを流す**。出力テキスト本体を live region に渡してはいけない（AT がテキスト更新のたびに全文読み上げを試みる）。また、`aria-atomic="true"` の AT は **DOM コンテンツが同一の場合は再読み上げをスキップする**ため、意味的に近い隣接フェーズに同じ文字列を割り当てると AT がフェーズ変化を検知できない。各フェーズに固有の文字列を割り当てる:
  ```tsx
  // ❌ 生成中の本文を live region に流す — AT が差分ごとに読み上げる
  {isGenerating ? "処理中" : outputText}

  // ❌ 隣接フェーズを同一文字列に — aria-atomic AT がフェーズ変化を検知しない
  {phase === "step1" || phase === "step2" ? "処理中" : phase === "done" ? "完了" : ""}

  // ✅ フェーズごとに固有メッセージ + Partial<Record> パターン
  const PHASE_MESSAGES: Partial<Record<Phase, string>> = {
    step1: "ステップ1を処理中",
    step2: "ステップ2を処理中",
    done: "処理が完了しました",
  };
  <div aria-live="polite" aria-atomic="true" className="sr-only">
    {PHASE_MESSAGES[phase] ?? ""}
  </div>
  ```
  ネストした三項演算子より `Partial<Record<Phase, string>>` の定数レコードの方がフェーズ追加時の漏れを防ぎやすく可読性も高い。
- **`aria-busy="true"` は role を持つ要素に付ける**: `<div>` の暗黙 role は `generic` で、`aria-busy` をサポートしない実装の AT がある。`<section>`（implicit `region` role）または `<main>`・`<article>` 等のランドマーク要素に `aria-busy` を付けると確実に機能する。ローディング中の section には `aria-busy={isLoading || undefined}` を付与し（`false` 時は属性を除去）、`undefined` の場合は属性自体が DOM から消える。どうしても generic div に `aria-busy` を付けざるを得ない場合は `<p className="sr-only">読み込み中</p>` を内部に配置して AT への通知を補完する。
- **`<a>` 内に `<button>` は HTML 仕様違反**: `<Link><Button>` のネストは `<a>` 内に `<button>` が入るため、HTML の「インタラクティブコンテンツのネスト禁止」違反。ボタンスタイルのリンクは `asChild` パターンで解決: Button コンポーネントが Radix Slot の `asChild` をサポートしていれば `<Button asChild><Link href="...">テキスト</Link></Button>` とする。Button が `asChild` なしの場合は `variant="link"` か直接 `<a>` にスタイルを当てる。
- **WAI-ARIA tabpanel の `tabIndex={0}` は Biome `noNoninteractiveTabindex` でブロックされる**: `role="tabpanel"` は WAI-ARIA 仕様でキーボードナビゲーションのために `tabIndex={0}` が推奨されているが、Biome がエラーを出す。`// biome-ignore lint/a11y/noNoninteractiveTabindex: WAI-ARIA tabpanel パターン` で抑制する。
- **`<div role="group">` は Biome `useSemanticElements` でブロックされる**: アクションバーやボタングループに `<div role="group" aria-label="...">` を使うと Biome がエラーを出す。`<fieldset>` + `<legend className="sr-only">` を使う。`<fieldset>` のデフォルトスタイル（border・padding・margin）は `className="border-0 p-0 m-0"` でリセットする。
- **`<ol>` / `<ul>` への `role="list"` は Biome `noRedundantRoles` でブロックされる**: `list-none` 適用時の Safari VoiceOver 対策として `role="list"` を追加することがあるが、Biome がエラーを出す（`<ol>` / `<ul>` は既に暗黙的に `list` role を持つため冗長とみなされる）。このプロジェクトでは `list-none` + `aria-label` の組み合わせで意味論を担保する形にとどめる。
  ```tsx
  // ❌ Biome エラー
  <div role="group" aria-label="書類アクション">...</div>
  
  // ✅ OK
  <fieldset className="border-0 p-0 m-0">
    <legend className="sr-only">書類アクション</legend>
    ...
  </fieldset>
  ```
- **カードリンクの accessible name は `aria-labelledby` で見出しに絞る**: `<Link>` がカード全体を囲む場合（カード型リンク）、スクリーンリーダーはカード内の全テキスト（説明文・バッジ等）をリンク名として読み上げる。`aria-labelledby={headingId}` を Link に付与し、カード内の見出し要素に `id={headingId}` を付けることで読み上げ内容を見出しに絞れる。
  ```tsx
  const headingId = `template-heading-${item.id}`;
  <Link href={href} aria-labelledby={headingId}>
    <Card>
      <h3 id={headingId}>{item.title}</h3>
      <p>{item.description}</p>  {/* これはリンク名に含まれなくなる */}
    </Card>
  </Link>
  ```
- **`<fieldset>` に `aria-label` と `<legend>` を両方付けると二重アクセシブル名になる**: `<div role="group">` の代替として `<fieldset aria-label="...">` を使った後に `<legend>` も付けてしまうパターン。スクリーンリーダーが両方を読み上げる。正しくは `<legend className="sr-only">ラベル</legend>` だけを使い、`aria-label` は付けない。
- **WCAG 2.5.3 Label in Name**: visible text と accessible name（`aria-label` 等）のミスマッチは WCAG 2.5.3 違反。例: `<button aria-label="ダウンロード"><span aria-hidden="true">DL</span></button>` は visible テキスト "DL" と aria-label "ダウンロード" が不一致。修正: aria-label を削除して visible テキストだけにするか、visible テキストと accessible name を揃える（例: `<button>ダウンロード</button>`）。

## Next.js App Router ローディングパターン

`loading.tsx` はルートセグメント全体を Suspense で包むため、静的なヘッダーやボタンもスケルトン扱いになる。動的部分だけスケルトンにしたい場合は次のパターンを使う:

**部分ローディング（推奨）**:
1. `loading.tsx` を削除
2. `page.tsx` を non-async にする（フェッチしない）
3. フェッチを子 async Server Component に切り出す
4. `page.tsx` で静的要素 + `<Suspense fallback={<Skeleton />}><DataFetcher /></Suspense>` を組み合わせる

```tsx
// page.tsx（non-async）
export default function Page() {
  return (
    <div>
      <header>静的ヘッダー — 即時表示</header>
      <Suspense fallback={<ListSkeleton />}>
        <DataFetcher />   {/* async SC — フェッチ中は fallback が表示される */}
      </Suspense>
    </div>
  );
}
```

Client Component でも同様に `useQuery` の `isLoading` で内部ローディング状態を管理し、インプットエリア等の静的要素をローディングの外に出せる。

## 禁止パターン

- `useEffect` でのデータフェッチ（React Query 等を使う）
- `any` 型の Props
- インラインでの複雑なロジック（カスタムフックに抽出する）

## ObjectURL のライフサイクル管理

`URL.createObjectURL` で作った URL を React state で管理するとき、`useMemo` + `useEffect` の組み合わせは submit 後に URL を早期 revoke してしまう落とし穴がある。

**問題**: `setAttachments([])` を呼ぶと `useMemo` が再計算され、`useEffect` cleanup が旧 URL を revoke する。しかしその URL はすでに TanStack Query cache 等のメッセージ content 内で参照されており、画像が壊れる。

**安全なパターン**:

```tsx
const urlsToRevokeRef = useRef<Set<string>>(new Set());

// アンマウント時に未 revoke の URL を一括解放
useEffect(() => {
  const urls = urlsToRevokeRef.current;
  return () => { for (const url of urls) URL.revokeObjectURL(url); };
}, []);

function addFiles(files: File[]) {
  const previews = files.map(file => {
    const url = URL.createObjectURL(file);
    urlsToRevokeRef.current.add(url);  // 追跡に追加
    return { file, url };
  });
  setPreviews(prev => [...prev, ...previews]);
}

function removeFile(index: number) {
  setPreviews(prev => {
    const removed = prev[index];
    if (removed) {
      URL.revokeObjectURL(removed.url);          // 明示削除時は即 revoke
      urlsToRevokeRef.current.delete(removed.url);
    }
    return prev.filter((_, i) => i !== index);
  });
}

// submit では revoke しない（URL は送信メッセージから参照され続ける）
function submit() {
  setPreviews([]);  // クリアするだけ
  onSubmit(content);
}
```

ルール: **「revoke するのは、ユーザーが明示的に削除したとき」か「コンポーネントがアンマウントされたとき」のみ。** submit による state クリアは revoke のトリガーにしない。

## Biome `noArrayIndexKey` と JSX の落とし穴

`key={i}` を使うと Biome の `noArrayIndexKey` ルールが発火する。Suppression コメントの配置には以下の制約がある:

- **JSX ブロック内では `// biome-ignore` は使えない**（`{/* ... */}` も suppression として機能しない）
- **multi-line JSX element の `key` 行の直前にも置けない**（JSX attribute 内に `//` コメント不可）
- **template literal 内の index も検出される**: `key={\`prefix-${i}\`}` のように `i` がサフィックスであっても `noArrayIndexKey` が発火する

**対処法**:
1. `.map()` 呼び出しを JSX 外の変数に切り出し、その直前に `// biome-ignore` を置く
2. content-based key を使う（`key={\`img-${url}\`}` 等）
3. `ContentPart` 等の型に `id` フィールドを追加する（最も根本的な解決）

## Biome `noAssignInExpressions` — `??=` を式の中で使えない

`(acc[key] ??= []).push(v)` のように代入式を式の途中で使うと `noAssignInExpressions` が発火する。

```ts
// NG: biome が弾く
(acc[t.category] ??= []).push(t);

// OK: ローカル変数で明示的に分岐
const group = acc[t.category];
if (group) {
  group.push(t);
} else {
  acc[t.category] = [t];
}
```

`reduce` のアキュムレータに `Partial<Record<K, V[]>>` を使うパターンでよく出る。

## React 19 の `useRef` 型変更

React 19 の型定義では `useRef<T>()` に初期値なし呼び出しが禁止された。T が `undefined` を含まない場合に型エラーになる。

```ts
// NG: React 19 で TS2554 "Expected 1 arguments, but got 0"
const timerRef = useRef<ReturnType<typeof setTimeout>>();

// OK: T | undefined にして undefined を初期値として明示する
const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
```

ミュータブル ref（in-flight な generator・timer ID など）の初期値は `null` より `undefined` を優先する。`null` と `undefined` が混在すると cleanup 時の条件チェック（`!= null` vs `=== undefined`）が増え、型の一貫性も崩れる。

## SSR-safe な ISO 日付パース

`new Date("YYYY-MM-DD")` は UTC 解釈されるため、JST 環境では1日前の日付になる。`T00:00:00` 付与でローカル時刻にできるが、SSR（Node.js）とブラウザでタイムゾーンが異なると hydration mismatch になる。

**最も安全なパターン**:

```ts
const [yearStr, monthStr, dayStr] = dateStr.split("-");
if (!yearStr || !monthStr || !dayStr) return dateStr; // フォールバック
const d = new Date(Number(yearStr), Number(monthStr) - 1, Number(dayStr));
```

`new Date(year, month-1, day)` は常にローカル時刻で初期化されるため、サーバー・ブラウザ共通で安全。

## `<Suspense>` は純粋 Client Component に効かない

`<Suspense>` の fallback が発火するのは:
1. **async Server Component** の streaming 待機中
2. **Client Component が `use(promise)` で Promise を読んでいる場合**

`useState` / `useRouter` / `useEffect` だけを使う純粋 Client Component を `<Suspense>` で囲んでも fallback は一切表示されない。無意味なラッパーを書かないこと。

```tsx
// NG: DocumentNewView は "use client" の純粋 CC — fallback は発火しない
<Suspense fallback={<div>読み込み中...</div>}>
  <DocumentNewView />
</Suspense>

// OK: 不要な Suspense を外してシンプルに
<DocumentNewView />
```

非同期 Server Component や `use()` hook がなければ Suspense は削除してよい。

## Biome `noRedundantRoles` — セマンティックタグへの明示的 role は不要

`<ol role="list">` や `<ul role="list">` のように、HTML の暗黙的 ARIA role と同じ値を `role` 属性で明示すると `noRedundantRoles` が発火する。

```tsx
// NG: <ol> はデフォルトで role="list"
<ol role="list">

// OK: role 属性を省略
<ol>
```

`aria-label` だけ付けたい場合も `role` は省略してよい。

## Biome formatter と長い JSX 属性

複数の属性を持つ JSX 要素で一部の属性値が長い場合、Biome は多くの場合で多行フォーマットを強制する。特に `className` と別の属性（`aria-hidden`、`aria-label` など）を組み合わせるときに注意。

```tsx
// NG: 単行は Biome に却下される場合がある
<p className="text-xs font-semibold tracking-widest uppercase text-primary" aria-hidden="true">F03 / {id}</p>

// OK: 多行フォーマット
<p
  className="text-xs font-semibold tracking-widest uppercase text-primary"
  aria-hidden="true"
>
  F03 / {id}
</p>
```

この要件は Biome の formatter ルール（`formatWithOptions`）に基づくもので、`.editorconfig` の `max_line_length` や Biome 設定の `line_width` に影響される。回避策はないため、長い属性値を持つ JSX は初めから多行で書く。

## Biome `useSemanticElements` — `role="radio"` on `<button>` は reject

Biome の `useSemanticElements` ルールは `role="radio"` を `<button>` に付けることを禁止する。`<input type="radio">` を使えというエラーになる。

**toggle button group**（複数の排他的な選択肢を切り替えるボタン群）には `aria-pressed` が正しいパターン。`role="radio"` + `aria-checked` ではなく、`<button type="button" aria-pressed={isSelected}>` を使う。

```tsx
// NG: Biome useSemanticElements が reject
<button role="radio" aria-checked={isSelected}>...</button>

// OK: toggle button pattern
<button type="button" aria-pressed={isSelected}>...</button>
```

本物のラジオグループが必要なら `<input type="radio">` + `<label>` を使い、CSS でカスタムスタイルを当てる。

## Biome `organize-imports` — import 順序

相対 import をアルファベット順で並べる場合、`../` より上階層の `../` が先に来なければならない（Biome の organize-imports が自動的に処理）。

```tsx
// NG: organize-imports が並び替える
import { NewTranscriptionForm } from "./new-transcription-form";
import { SupportedFormats } from "../supported-formats";

// OK: 上階層が先
import { SupportedFormats } from "../supported-formats";
import { NewTranscriptionForm } from "./new-transcription-form";
```

`git diff` を見たときに意図的な import 変更か organize-imports による自動変更かが混在するのを避けるため、初めから正しい順序で書く。

## AsyncGenerator + ref cleanup は try/finally で

`generatorRef.current = null` を `for await` ループの直後に書くだけでは、ループ中に例外が起きたときにクリーンアップが実行されない。**常に `try/finally` でラップする**。

```tsx
// NG: 例外時に generatorRef がリーク
const gen = onSubmit(file);
generatorRef.current = gen;
for await (const event of gen) { ... }
generatorRef.current = null; // 例外が来るとここに到達しない

// OK: try/finally で確実にクリーンアップ
generatorRef.current = gen;
try {
  for await (const event of gen) { ... }
} finally {
  generatorRef.current = null;
}
```

この `generatorRef` パターンは、アンマウント時やリセット時に in-flight な generator を `generatorRef.current?.return(undefined)` で中断するために使われる。cleanup が漏れると、コンポーネントアンマウント後も古い generator の結果が state に書き込まれ得る。

## JSX サブコンポーネント抽出後は即 lint

inline の深いネスト内では Biome のフォーマッタが通していた JSX が、コンポーネントを抽出して shallow な文脈に移すと行長判定が変わって違反になることがある（例: 深い indent 内で許容されていた単一行 `<p>` が、top-level では multi-line を要求されるケース）。

**コンポーネントを抽出したら即 `bun run lint` を実行する**。抽出→lint→修正を 1 サイクルにすること。
