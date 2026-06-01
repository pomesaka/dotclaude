# React レビュー観点

> **TL;DR**: Container/Presenter 分離を徹底し、ビジネスロジックはカスタムフックに集約して View を dumb 化する。`role` prop 禁止（ARIA 属性と衝突）。Props は明示型・肯定形 boolean・`on` プレフィックス統一。a11y・Biome a11y ルール → `react-a11y.md`。JSX の `key={i}` は Biome `noArrayIndexKey` で拒否 — content-based key か `.map()` 外変数に切り出して biome-ignore を付ける。`useState(initialValue)` は初回マウント時のみ有効 — sessionStorage 等の非同期初期値は hasMounted パターンで対処。

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

## 禁止パターン

- `useEffect` でのデータフェッチ（React Query 等を使う）
- `any` 型の Props
- インラインでの複雑なロジック（カスタムフックに抽出する）
- **JSX の boolean guard で `??` を "OR" の代わりに使う**: `{condition && (a ?? b)}` の形で `??` を使うと、`a` が truthy のとき `a`（文字列・オブジェクト等）が返り JSX がそれを render しようとする。"どちらか一方が存在すれば表示" の意図なら `||` か `!= null` の OR を使う。
  <!-- importance: medium | mentions: 1 | first-seen: 2026-05 -->
  ```tsx
  // ❌ detail が "" (falsy) のとき collected != null の boolean が返る — 意図が曖昧
  {step.detail ?? step.collected != null}
  // ✅ 「どちらかが存在すれば表示」の意図を明示
  {step.detail != null || step.collected != null}
  ```

## useEffect の適切な使い方

`useEffect` が妥当なのは「副作用」「外部システム同期」「ブラウザ API 呼び出し」など限定的なケースのみ。**必ず WHY コメントを添える**。コメントがないと不要な副作用に見える。

```tsx
// WHY: router.replace はブラウザナビゲーション（副作用）のためレンダー中に呼べない。
// ローディング完了後に両方 null = 無効 ID → リダイレクト。
useEffect(() => {
  if (isLoading) return;
  if (!pending && !historyEntry) router.replace("/");
}, [isLoading, pending, historyEntry, router]);
```
<!-- importance: medium | mentions: 1 | first-seen: 2026-05 -->

## setState updater 内に副作用を書かない（StrictMode 二重実行）

`setState(prev => { sideEffect(); return next; })` の形はアンチパターン。React StrictMode では updater が二重実行されるため、`localStorage.setItem` などの副作用が2回走る。

```tsx
// ❌ StrictMode で localStorage に2回書き込まれる
const toggle = useCallback(() => {
  setIsOpen((prev) => {
    const next = !prev;
    localStorage.setItem(KEY, String(next)); // ← ここが2回実行される
    return next;
  });
}, []);

// ✅ 副作用は useEffect に分離する
const toggle = useCallback(() => {
  setIsOpen((prev) => !prev);
}, []);

useEffect(() => {
  if (isLoaded) localStorage.setItem(KEY, String(isOpen));
}, [isOpen, isLoaded]);
```

**判断基準**: updater は「次の状態を計算するだけ」に限定する。ネットワーク・localStorage・DOM 操作などの副作用は必ず `useEffect` へ。

初回マウント時にスキップしたいなら `useRef` フラグで制御する:
```tsx
const hasRunOnce = useRef(false);
useEffect(() => {
  if (!hasRunOnce.current) { hasRunOnce.current = true; return; }
  persist(isOpen); // 2回目以降のみ実行
}, [isOpen]);
```
<!-- importance: high | mentions: 2 | first-seen: 2026-05 -->

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
さらに、ジェネレータが throw した場合に UI がローディング状態のまま固まるため `catch` でフォールバック遷移も入れる。
上流の `Promise`（例: 計画生成）も同様に `.catch()` を付けないと中間フェーズで固まる。

```tsx
generatorRef.current = gen;
try {
  for await (const event of gen) { ... }
} catch {
  // ジェネレータ例外 → UIを安全な状態（idle 等）に戻す
  setState((prev) => (prev.phase === "running" ? { ...prev, phase: "idle" } : prev));
} finally {
  generatorRef.current = null;
}

// 上流の Promise も同様
void generatePlan(theme, depth)
  .then((plan) => { setState(... "planning" ...); })
  .catch(() => { setState((s) => s.phase === "loading" ? { ...s, phase: "idle" } : s); });
```

## AsyncGenerator ストリームフックから完了データを返す

`startStream(gen)` は `Promise<Result>` を返すようにし、ループ内でローカル変数に最終値を蓄積して `return` する。React state を読み返すと stale closure になる。

```ts
const startStream = useCallback(
  async (gen: AsyncGenerator<Event>): Promise<Result> => {
    let finalData = defaultResult;
    generatorRef.current = gen;
    try {
      for await (const event of gen) {
        if (event.type === "done") {
          finalData = { report: event.report, sources: event.sources };
          setReport(event.report);   // レンダリング用
          setSources(event.sources); // レンダリング用
        }
      }
    } finally {
      generatorRef.current = undefined;
    }
    return finalData; // ← state ではなくローカル変数を返す（stale closure 回避）
  },
  [],
);

// 呼び出し側は .then(result => ...) で完了データを受け取る
void stream.startStream(gen)
  .then(result => { configRef.current.onComplete(result); })
  .catch(() => { setState(prev => prev.phase === "running" ? {...prev, phase: "idle"} : prev); });
```
<!-- importance: medium | mentions: 1 | first-seen: 2026-05 -->

## React 19 の `useRef` 型変更

```ts
// NG: React 19 で TS2554
const timerRef = useRef<ReturnType<typeof setTimeout>>();

// OK: undefined を初期値として明示
const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
```

ミュータブル ref の初期値は `null` より `undefined` を優先する（cleanup 条件のチェックが一貫する）。

## React 19 の `FormEvent` deprecated と onSubmit ハンドラーの型付け

React 19 で `FormEvent` が deprecated [6385] になった。代替を探すと落とし穴が多い。

```ts
// NG: SubmitEvent (DOM型) は React 合成イベント型と互換なし → 型エラー 2322
const handleSubmit = (e: SubmitEvent) => { e.preventDefault(); };

// NG: 型精度後退。型システムから「フォーム送信イベント」の意図が消える
const handleSubmit = (e: { preventDefault(): void }) => { e.preventDefault(); };

// OK: FormEvent<HTMLFormElement> のまま（typecheck エラーではなく IDE 警告のみ）
const handleSubmit = (e: FormEvent<HTMLFormElement>) => { e.preventDefault(); };

// OK: 型推論に任せる（JSX の onSubmit ハンドラーとして型が推論される）
const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => { e.preventDefault(); };
```

**判断基準**: `bun run typecheck` が通るなら deprecated 警告 [6385] は受け入れてよい。型精度を落とすより正確な型を維持する方が重要。React 19 対応の完全な解決（`FormEvent` 削除）は別 issue で対処する。
<!-- importance: medium | mentions: 1 | first-seen: 2026-05 -->

## Gantt / カレンダーの日付演算は全操作を UTC で統一する

ピクセル位置を日番号（epoch days）で管理する Gantt・カレンダー系コンポーネントで、Date 操作がローカルと UTC で混在すると **JST 等の環境で表示が1日ずれる**。
<!-- importance: high | mentions: 1 | first-seen: 2026-06 -->

- **原因**: `new Date("2026-06-02T00:00:00")` はローカル時刻として解釈 → JST では UTC 06-01 15:00 → 日番号が 06-01 になりバーが1列左にずれる
- **修正**: 日付文字列のパースは `Date.parse("...T00:00:00Z")`（末尾に `Z`）で UTC 固定。`Date` オブジェクトからの読み出しは `getUTCDate()` / `getUTCDay()` / `Date.UTC(y, m, d)` を使う。`Date.now() / DAY` は UTC 日番号になり、ローカルの「今日」と1日ずれることがある（`Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()) / DAY` で同じ空間に写す）。

```ts
// NG: ローカル時刻解釈 → JST で1日ずれる
const toDay = (s: string) => Math.floor(new Date(`${s}T00:00:00`).getTime() / DAY);
const today = Math.floor(Date.now() / DAY); // UTC 日番号（JST の「今日」と1日ずれる）

// OK: 全演算を UTC で統一
const toDay = (s: string) => Math.floor(Date.parse(`${s}T00:00:00Z`) / DAY);
const now = new Date();
const today = Math.floor(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()) / DAY);
```

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

## Mutation と非同期 UI 状態

- **`mutate` 後に即 Dialog を閉じると `isPending` フィードバックが消える**: `onDelete(id)` の直後に `setDialogOpen(false)` を呼ぶと、削除処理が進行中にダイアログが消えて `isPending` ボタン状態をユーザーが見られなくなる。`useMutation` の `onSuccess` コールバックで閉じる設計にする。props 側でも `onDelete: (id: string, onSuccess: () => void) => void` のシグネチャにして、呼び出し元が完了タイミングを制御できるようにする。
  <!-- importance: medium | mentions: 2 | first-seen: 2026-05 -->

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
