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

## a11y 注意点

- **`<div>` に `aria-label` を直接付けない**: Biome の `useAriaPropsSupportedByRole` ルールがエラーを出す。ラベル付けしたいコンテナには `<section>`（implicit `region` role）か `role="region"` を使う。ローディング UI やランドマーク的なラッパーで頻発しやすい。
- **`<main>` の二重ネスト禁止**: HTML 仕様では1ページに `<main>` は1つ。AppLayout 等のシェルコンポーネントがすでに `<main>` を持っている場合、配下のページコンポーネントで再度 `<main>` を使うと仕様違反。代わりに `<section aria-label="...">` を使う。

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

## Biome lint ルール（よく引っかかるパターン）

### `noArrayIndexKey` — リスト要素に index key を使わない

```tsx
// NG: Biome が noArrayIndexKey で弾く
items.map((item, i) => <div key={i} />)

// OK: stable key を使う（id や複合フィールド）
items.map((item) => <div key={item.id} />)
items.map((item) => <div key={`${item.timestamp}-${item.speaker}`} />)
```

静的ダミーデータでも `key={index}` は lint エラーになる。実装時から stable key を使うこと。

### `useSemanticElements` — `role` で代替できる要素は semantic 要素を使う

```tsx
// NG: Biome が useSemanticElements で弾く
<div role="button" tabIndex={0} onKeyDown={...} onClick={...}>

// OK: <button> を使う（Enter/Space は native で処理される）
<button type="button" onClick={...}>
```

`<button>` に変更した場合、drag event ハンドラの型を `React.DragEvent<HTMLDivElement>` → `React.DragEvent<HTMLElement>` に変更が必要になることがある。

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

## SSR-safe な ISO 日付パース

`new Date("YYYY-MM-DD")` は UTC 解釈されるため、JST 環境では1日前の日付になる。`T00:00:00` 付与でローカル時刻にできるが、SSR（Node.js）とブラウザでタイムゾーンが異なると hydration mismatch になる。

**最も安全なパターン**:

```ts
const [yearStr, monthStr, dayStr] = dateStr.split("-");
if (!yearStr || !monthStr || !dayStr) return dateStr; // フォールバック
const d = new Date(Number(yearStr), Number(monthStr) - 1, Number(dayStr));
```

`new Date(year, month-1, day)` は常にローカル時刻で初期化されるため、サーバー・ブラウザ共通で安全。

## Biome `noRedundantRoles` — セマンティックタグへの明示的 role は不要

`<ol role="list">` や `<ul role="list">` のように、HTML の暗黙的 ARIA role と同じ値を `role` 属性で明示すると `noRedundantRoles` が発火する。

```tsx
// NG: <ol> はデフォルトで role="list"
<ol role="list">

// OK: role 属性を省略
<ol>
```

`aria-label` だけ付けたい場合も `role` は省略してよい。

## a11y（アクセシビリティ）詳細

### `aria-labelledby` は参照先 ID の存在を確認する

`aria-labelledby="some-id"` を書く際は、`id="some-id"` を持つ要素が DOM 上に実在することを確認する。
`SectionLabel` 等のコンポーネントが内部で `id` を付与しない場合は `aria-label` に変更する。

```tsx
// NG: SectionLabel が id="section-summary" を持たなければ labelledby が機能しない
<section aria-labelledby="section-summary">
  <SectionLabel title="サマリー" />

// OK: aria-label で直接テキストを指定する
<section aria-label="サマリー">
  <SectionLabel title="サマリー" />
```

### `role="status"` には読み上げ可能テキストが必要

`role="status"` は live region として機能するが、**テキストコンテンツがない**と支援技術が読み上げない。
`aria-label` を `div` に付けるだけでは不十分なため、`<span className="sr-only">` でテキストを内包する。

```tsx
// NG: aria-label だけでは live region として読み上げられないことがある
<div role="status" aria-label="処理中">
  <Loader2 aria-hidden="true" />
</div>

// OK: sr-only テキストを内包して読み上げを保証する
<div role="status">
  <span className="sr-only">処理中</span>
  <Loader2 aria-hidden="true" />
</div>
```

### 視覚的に隠した `<input>` は支援技術からも隠す

`sr-only` で視覚的に隠した `<input type="file">` が別の操作手段（ボタン）経由でのみ使われる場合、
支援技術が重複要素を読み上げないよう `aria-hidden="true"` + `tabIndex={-1}` を付与する。

```tsx
// ボタン経由でのみ input をトリガーする設計の場合
<button onClick={() => fileInputRef.current?.click()}>
  ファイルを選択
</button>
<input
  ref={fileInputRef}
  type="file"
  className="sr-only"
  aria-hidden="true"
  tabIndex={-1}
/>
```
