# React 落とし穴・実装 Gotchas

> **TL;DR**: 実装中に踏む React 固有の罠。カテゴリ: [useEffect/StrictMode](#useeffect--strictmode)・[非同期・ストリーム](#非同期ストリーム)・[型・フォーム](#型フォーム)・[日付・UTC](#日付utc)・[React 19 新機能](#react-19-新機能)・[App Router/Suspense](#app-routersuspense)。設計規約 → `react.md`

## useEffect / StrictMode

### `useEffect` の適切な使い方

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

### `setInterval` は `useEffect` cleanup で必ず停止する

`setInterval` をカスタムフック内で使うとき、`clearInterval` を `useEffect` の cleanup に書かないとコンポーネントがアンマウントされた後もインターバルが動き続け、unmounted コンポーネントへの `setState` 呼び出しが発生する。React StrictMode の二重マウントでも二重 interval が起きる。

```ts
// ❌ アンマウント後もポーリングが走り続ける
function usePolling(jobId: string) {
  const intervalRef = useRef<ReturnType<typeof setInterval> | undefined>(undefined);
  const stopPolling = useCallback(() => {
    if (intervalRef.current !== undefined) {
      clearInterval(intervalRef.current);
      intervalRef.current = undefined;
    }
  }, []);
  const startPolling = useCallback(() => {
    intervalRef.current = setInterval(async () => { ... }, 2500);
  }, [stopPolling]);
  // cleanup がないためページ離脱後も setState が走る
  return { startPolling, stopPolling };
}

// ✅ useEffect cleanup で必ず stopPolling を呼ぶ
function usePolling(jobId: string) {
  const intervalRef = useRef<ReturnType<typeof setInterval> | undefined>(undefined);
  const stopPolling = useCallback(() => {
    if (intervalRef.current !== undefined) {
      clearInterval(intervalRef.current);
      intervalRef.current = undefined;
    }
  }, []);
  // WHY useEffect cleanup: コンポーネントが unmount された後も setInterval が走り続けると
  // unmounted コンポーネントへの setState が起きる。
  useEffect(() => {
    return () => stopPolling();
  }, [stopPolling]);
  return { stopPolling };
}
```

**判断基準**: `setInterval` / `setTimeout` を ref で管理するフックには **必ず** `useEffect(() => () => clear*(ref.current), [])` の cleanup を追加する。`clearInterval` を別の関数から呼ぶだけでは、ユーザーがページを離脱した場合をカバーできない。
<!-- importance: high | mentions: 1 | first-seen: 2026-06 -->

### setState updater 内に副作用を書かない（StrictMode 二重実行）

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

**判断基準**: updater は「次の状態を計算するだけ」に限定する。副作用は必ず `useEffect` へ。

初回マウント時にスキップしたいなら `useRef` フラグで制御する:
```tsx
const hasRunOnce = useRef(false);
useEffect(() => {
  if (!hasRunOnce.current) { hasRunOnce.current = true; return; }
  persist(isOpen); // 2回目以降のみ実行
}, [isOpen]);
```
<!-- importance: high | mentions: 2 | first-seen: 2026-05 -->

### ObjectURL のライフサイクル管理

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

### Mutation と非同期 UI 状態

- **`mutate` 後に即 Dialog を閉じると `isPending` フィードバックが消える**: `onDelete(id)` の直後に `setDialogOpen(false)` を呼ぶと、削除処理が進行中にダイアログが消えて `isPending` ボタン状態をユーザーが見られなくなる。`useMutation` の `onSuccess` コールバックで閉じる設計にする。props 側でも `onDelete: (id: string, onSuccess: () => void) => void` のシグネチャにして、呼び出し元が完了タイミングを制御できるようにする。
  <!-- importance: medium | mentions: 2 | first-seen: 2026-05 -->
- **mutation の `data` を `useEffect` で監視して別の state に写すのはアンチパターン — `mutate(vars, { onSuccess })` でイベント駆動にする**: `const m = useMutation(...)` の結果を編集可能な下書きへ取り込むとき、`useEffect(() => { if (m.data) setDraft(m.data) }, [m.data])` と書きたくなるが、これは「成功イベント」を「data の変化」として間接観測する derived-state アンチパターン。`m.data` は再フェッチ・再マウント・キャッシュ更新で予期せず再評価されて effect が再発火しうるし、「成功したら 1 回だけ取り込む」という意図が読み取れない。正しくは呼び出し時に `m.mutate(vars, { onSuccess: (data) => setDraft(data) })` を渡す（成功ごとに正確に 1 回発火）。再実行（再生成）で下書きをスケルトンへ戻したいなら mutate 直前に `setDraft(null)` する副作用も同じイベント駆動の流れに収まる。判断基準: **mutation 結果から state を導出する処理は useEffect でなく onSuccess に置く**。
  <!-- importance: medium | mentions: 1 | first-seen: 2026-06 -->

---

## 非同期・ストリーム

### AsyncGenerator + ref cleanup は try/finally で

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

### AsyncGenerator ストリームフックから完了データを返す

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

---

## 型・フォーム

### React 19 の `useRef` 型変更

```ts
// NG: React 19 で TS2554
const timerRef = useRef<ReturnType<typeof setTimeout>>();

// OK: undefined を初期値として明示
const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
```

ミュータブル ref の初期値は `null` より `undefined` を優先する（cleanup 条件のチェックが一貫する）。

### React 19 の `FormEvent` deprecated と onSubmit ハンドラーの型付け

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

**判断基準**: `bun run typecheck` が通るなら deprecated 警告 [6385] は受け入れてよい。型精度を落とすより正確な型を維持する方が重要。
<!-- importance: medium | mentions: 1 | first-seen: 2026-05 -->

---

## 日付・UTC

### Gantt / カレンダーの日付演算は全操作を UTC で統一する

ピクセル位置を日番号（epoch days）で管理する Gantt・カレンダー系コンポーネントで、Date 操作がローカルと UTC で混在すると **JST 等の環境で表示が1日ずれる**。
<!-- importance: high | mentions: 1 | first-seen: 2026-06 -->

- **原因**: `new Date("2026-06-02T00:00:00")` はローカル時刻として解釈 → JST では UTC 06-01 15:00 → 日番号が 06-01 になりバーが1列左にずれる
- **修正**: 日付文字列のパースは `Date.parse("...T00:00:00Z")`（末尾に `Z`）で UTC 固定。`Date` オブジェクトからの読み出しは `getUTCDate()` / `getUTCDay()` / `Date.UTC(y, m, d)` を使う。

```ts
// NG: ローカル時刻解釈 → JST で1日ずれる
const toDay = (s: string) => Math.floor(new Date(`${s}T00:00:00`).getTime() / DAY);
const today = Math.floor(Date.now() / DAY); // UTC 日番号（JST の「今日」と1日ずれる）

// OK: 全演算を UTC で統一
const toDay = (s: string) => Math.floor(Date.parse(`${s}T00:00:00Z`) / DAY);
const now = new Date();
const today = Math.floor(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()) / DAY);
```

### SSR-safe な ISO 日付パース

`new Date("YYYY-MM-DD")` は UTC 解釈され JST で1日ずれる。サーバー・ブラウザ共通で安全なパターン:

```ts
const [y, m, d] = dateStr.split("-");
const date = new Date(Number(y), Number(m) - 1, Number(d));  // 常にローカル時刻
```

---

## React 19 新機能

- **`React.FormEvent` は deprecated → `React.SyntheticEvent` を使う**: React 19 で `React.FormEvent<HTMLFormElement>` が deprecated になった。`<form onSubmit>` ハンドラの型は `React.SyntheticEvent<HTMLFormElement>` に移行する。`e.currentTarget` は引き続き利用可能。
  ```tsx
  // ❌ React 19 で deprecated
  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) { ... }

  // ✅
  async function handleSubmit(e: React.SyntheticEvent<HTMLFormElement>) { ... }
  ```
  <!-- importance: medium | mentions: 1 | first-seen: 2026-06 -->
- **React 19 フォームの標準形は `useActionState` + `<form action={fn}>`**: `onSubmit` + 手動 `isLoading` より宣言的で Server Actions と互換性がある。
  ```tsx
  const [state, formAction] = useActionState(async (_prev, formData) => {
    return { error: "..." };
  }, {});
  <form action={formAction}>
    <FormContent error={state.error} />  {/* useFormStatus で pending を読む */}
  </form>
  ```
  `useFormStatus` の制約: `<form>` の**子コンポーネント**でしか使えない（`form` を render するコンポーネント自身では不可）。フォームのインプット・ボタン群を `FormContent` のような内部コンポーネントに切り出して `useFormStatus` を呼ぶのが正しいパターン。
  <!-- importance: medium | mentions: 1 | first-seen: 2026-06 -->
- **`useActionState` の dispatch を `<form action>` 外（onClick / onSubmit ハンドラ）から直接呼ぶと isPending が立たない**: dispatch は transition 内で呼ばれることを前提としており、イベントハンドラから素で呼ぶと action 自体は実行されるが `isPending` が true にならない（React 19.2 実機確認: クリック後 300ms 経ってもボタンが disabled にならなかった）。typecheck は通るため気づきにくい。対処: `useTransition` を併用し `startTransition(() => dispatch(data))` で包む。pending は `useTransition` 側の `isPending` から取る（useActionState の第 3 戻り値ではなく）。
  ```tsx
  const [isPending, startTransition] = useTransition();
  const [state, submitAction] = useActionState(async (_prev, data) => { ... }, init);
  <View onSubmit={(data) => startTransition(() => submitAction(data))} isSubmitting={isPending} />
  ```
  `<form action={formAction}>` で渡す場合は React が transition を張るためこの問題は起きない。構造化データ（File 含む）を渡したい・presigned URL への直接 PUT が要る等で form action にできないケースで踏む。
  <!-- importance: high | mentions: 2 | first-seen: 2026-06 -->
- **`() => void` の props に async 関数を渡すと Promise rejection が uncaught になる**: `onLogout?: () => void` のように `void` 型の callback props に `async () => { await signOut(); }` を渡すと、TypeScript は型エラーを出さない（`void` は戻り値を無視する）が Promise の rejection は黙って飲まれる。対処: callback の型を `() => void | Promise<void>` と明示する。**判断基準**: onClick・onSubmit・onXxx 系の props が async な実装を受け取る可能性があれば `() => void | Promise<void>` を標準とする。
  <!-- importance: medium | mentions: 1 | first-seen: 2026-06 -->
- **Enter で submit する input は `e.nativeEvent.isComposing` をガードする**: `onKeyDown` で `e.key === "Enter"` を submit トリガーにすると、IME（日本語・中国語・韓国語等）の**変換確定 Enter でも発火**してしまう。`e.isComposing` でなく `e.nativeEvent.isComposing` を使うこと（React の合成イベントには `isComposing` が無い）。CJK ユーザー向けプロダクトでは必須。
  ```tsx
  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      submit();
    }
  }
  ```
  <!-- importance: high | mentions: 1 | first-seen: 2026-06 -->
- **async ポーリングに `setInterval` を使うと並列リクエストが積み重なる — 再帰 `setTimeout` を使う**: `setInterval(async () => { await fetch(...) }, 2000)` は前の fetch が 2s を超えても次の interval が発火し、リクエストが並列に積み重なる。再帰 `setTimeout`（fetch 完了後に `setTimeout(() => poll(id), interval)` でスケジュール）なら前の fetch が終わってから次をスケジュールするため直列化される。パターン:
  ```ts
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isActiveRef = useRef(false);
  const poll = useCallback(async (id: string) => {
    const res = await fetch(`/api/jobs/${id}`);
    const data = await res.json();
    setJob(data);
    if (data.step === "done" || data.step === "failed") { stop(); return; }
    if (isActiveRef.current) timeoutRef.current = setTimeout(() => poll(id), INTERVAL_MS);
  }, [stop]);
  ```
  `isActiveRef` で「アンマウント後のスケジュール」を防ぐ。useEffect のクリーンアップで `clearTimeout(timeoutRef.current)` を呼ぶ。
  <!-- importance: high | mentions: 1 | first-seen: 2026-06 -->
- **textarea の高さ自動調整は `useEffect([value])` でなくイベントハンドラで行う**: `el.style.height="auto"; el.style.height=scrollHeight+"px"` という DOM 同期を `useEffect(() => {...}, [value])` に書くと、effect 本体が `value` を参照しない（DOM ref しか読まない）ため biome `useExhaustiveDependencies` が「不要な依存」と誤検知してエラーになる。`onChange` 内で同期的にリサイズするのが正解。プログラムによる値クリア（送信後の `setValue("")`）は onChange を発火しないため、その箇所だけ明示的に `ref.style.height="auto"` で戻す。
  <!-- importance: medium | mentions: 1 | first-seen: 2026-06 -->

---

## App Router / Suspense

- **`<Suspense>` は純粋 Client Component に効かない**: async Server Component か `use(promise)` を使う CC でのみ fallback が発火する。`useState` / `useRouter` だけの CC を `<Suspense>` で包んでも無意味。

- **Next.js App Router 部分ローディング**: `loading.tsx` はルート全体を Suspense で包むため、動的部分だけスケルトンにしたい場合は:
  1. `loading.tsx` を削除
  2. `page.tsx` を non-async に
  3. フェッチを子 async SC に切り出す
  4. `<Suspense fallback={<Skeleton />}><DataFetcher /></Suspense>` で組み合わせる
