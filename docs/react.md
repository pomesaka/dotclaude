# React レビュー観点

> **TL;DR**: Container/Presenter 分離を徹底し、ビジネスロジックはカスタムフックに集約して View を dumb 化する。`role` prop 禁止（ARIA 属性と衝突）。Props は明示型・肯定形 boolean・`on` プレフィックス統一。a11y・Biome a11y ルール → `react-a11y.md`。

TypeScript の観点に加え、以下の観点でレビューする。

## コンポーネント設計

- **1ファイル1コンポーネント**: 複数コンポーネントを1ファイルに export しない
- **Container/Presenter 分離**: データフェッチ・mutation と表示を分ける
  - Container: データ取得・イベントハンドラ・状態管理
  - Presenter: props を受け取るだけの純粋な表示
- **class コンポーネント禁止**: 関数コンポーネントのみ使う

## Props 設計

- Props の型は明示的に定義する（`type Props = { ... }`）
- boolean の props は肯定形にする（`isDisabled` > `isNotEnabled`）
- イベントハンドラは `on` prefix（`onClick`, `onSubmit`）
- **`role` を prop 名にしない**: Biome の `useValidAriaRole` が発火する。`variant`・`sender`・`kind` 等を使う

## フック

- カスタムフックは `use` prefix、1ファイル1フック export
- フック内にビジネスロジックを集約し、コンポーネントを薄く保つ
- **フックの言語は「ドメイン」、View の言語は「UI イベント」**: フックが返す関数はドメインアクション動詞で命名する（`selectFile`, `generate`）。`on` prefix は View props の言語。Container がドメイン → UI イベントへのマッピングを担う（`onSubmit={generate}`）
- **View が "smart" だと感じたら状態を吸い上げる**: `useState`・`useMutation`・非同期ロジックを View が持っていたらカスタムフックに移す
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

## 禁止パターン

- `useEffect` でのデータフェッチ（React Query 等を使う）
- `any` 型の Props
- インラインでの複雑なロジック（カスタムフックに抽出する）

## ObjectURL のライフサイクル管理

`useMemo + useEffect` の cleanup は state クリア時に revoke してしまう。**revoke するのは明示削除時とアンマウント時のみ**。

```tsx
const urlsToRevokeRef = useRef<Set<string>>(new Set());

useEffect(() => {
  const urls = urlsToRevokeRef.current;
  return () => { for (const url of urls) URL.revokeObjectURL(url); };
}, []);

function addFiles(files: File[]) {
  files.map(file => {
    const url = URL.createObjectURL(file);
    urlsToRevokeRef.current.add(url);
    return { file, url };
  });
}

function removeFile(index: number) {
  setPreviews(prev => {
    URL.revokeObjectURL(prev[index].url);
    urlsToRevokeRef.current.delete(prev[index].url);
    return prev.filter((_, i) => i !== index);
  });
}

function submit() { setPreviews([]); /* revoke しない */ }
```

## AsyncGenerator + ref cleanup は try/finally で

`for await` 後に `generatorRef.current = null` を書くだけでは例外時にクリーンアップが漏れる。

```tsx
generatorRef.current = gen;
try {
  for await (const event of gen) { ... }
} finally {
  generatorRef.current = null;
}
```

## React 19 の `useRef` 型変更

```ts
// NG: React 19 で TS2554
const timerRef = useRef<ReturnType<typeof setTimeout>>();

// OK: undefined を初期値として明示
const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
```

ミュータブル ref の初期値は `null` より `undefined` を優先する（cleanup 条件のチェックが一貫する）。

## SSR-safe な ISO 日付パース

`new Date("YYYY-MM-DD")` は UTC 解釈され JST で1日ずれる。サーバー・ブラウザ共通で安全なパターン:

```ts
const [y, m, d] = dateStr.split("-");
const date = new Date(Number(y), Number(m) - 1, Number(d));  // 常にローカル時刻
```

## `<Suspense>` は純粋 Client Component に効かない

async Server Component か `use(promise)` を使う CC でのみ fallback が発火する。`useState` / `useRouter` だけの CC を `<Suspense>` で包んでも無意味。

## Next.js App Router 部分ローディング

`loading.tsx` はルート全体を Suspense で包むため、動的部分だけスケルトンにしたい場合は:
1. `loading.tsx` を削除
2. `page.tsx` を non-async に
3. フェッチを子 async SC に切り出す
4. `<Suspense fallback={<Skeleton />}><DataFetcher /></Suspense>` で組み合わせる

## Biome Gotchas

- **`noArrayIndexKey`**: `key={i}` を JSX 内で使うとエラー。`.map()` 呼び出しを JSX 外の変数に切り出して `// biome-ignore` を置くか、content-based key を使う
- **`noAssignInExpressions`**: `(acc[k] ??= []).push(v)` は不可。if-else で明示的に分岐する
- **formatter**: 複数属性を持つ JSX で長い属性値があれば多行フォーマットを強制される。初めから多行で書く
- **`organize-imports`**: packages before relative、type before value。`biome check --write` で自動修正
- a11y 関連 Biome ルール → `react-a11y.md`
