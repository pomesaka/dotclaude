# React 落とし穴・実装 Gotchas

> **TL;DR**: 実装中に見落としやすい React 固有の注意点。カテゴリ: [useEffect/StrictMode](#useeffect--strictmode)・[非同期・ストリーム](#非同期ストリーム)・[型・フォーム](#型フォーム)・[日付・UTC](#日付utc)・[React 19 新機能](#react-19-新機能)・[App Router/Suspense](#app-routersuspense)。設計規約 → `react.md`

## useEffect / StrictMode

### `useEffect` の適切な使い方

`useEffect` が妥当なのは「副作用」「外部システム同期」「ブラウザ API 呼び出し」など限定的なケースのみ。必ず WHY コメントを添える。コメントがないと不要な副作用に見える。

```tsx
// WHY: router.replace はブラウザナビゲーション（副作用）のためレンダー中に呼べない。
// ローディング完了後に両方 null = 無効 ID → リダイレクト。
useEffect(() => {
  if (isLoading) return;
  if (!pending && !historyEntry) router.replace("/");
}, [isLoading, pending, historyEntry, router]);
```
<!-- importance: medium | mentions: 1 | first-seen: 2026-05 -->

### ポーリングフックは再帰 `setTimeout` + `useEffect` cleanup で書く

`setInterval(async () => { await fetch(...) }, 2000)` は前の fetch が interval を超えても次が発火し、リクエストが並列に積み重なる。再帰 `setTimeout`（fetch 完了後に次を schedule）なら直列化される。さらに ref で管理する timer は必ず `useEffect` cleanup で `clearTimeout` する（WHY: unmount 後もタイマーが走ると unmounted コンポーネントへの `setState` が起きる。StrictMode の二重マウントでも二重起動する）。`isActiveRef` で unmount 後の再 schedule を防ぐ。

```ts
// ✅ 再帰 setTimeout: fetch 完了後に次を schedule → 直列化
const timeoutRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
const isActiveRef = useRef(false);
const poll = useCallback(async (id: string) => {
  const res = await fetch(`/api/jobs/${id}`);
  const data = await res.json();
  setJob(data);
  if (data.step === "done" || data.step === "failed") { stop(); return; }
  if (isActiveRef.current) timeoutRef.current = setTimeout(() => poll(id), INTERVAL_MS);
}, [stop]);
// WHY useEffect cleanup: clear* を別関数から呼ぶだけではページ離脱をカバーできない
useEffect(() => {
  return () => {
    isActiveRef.current = false;
    if (timeoutRef.current !== undefined) clearTimeout(timeoutRef.current);
  };
}, []);
```

**判断基準**: `setInterval` / `setTimeout` を ref で管理するフックには必ず `useEffect(() => () => clear*(ref.current), [])` の cleanup を追加する。
<!-- importance: high | mentions: 2 | first-seen: 2026-06 -->

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

初回マウント時にスキップしたいなら `useRef` フラグで制御する。
```tsx
const hasRunOnce = useRef(false);
useEffect(() => {
  if (!hasRunOnce.current) { hasRunOnce.current = true; return; }
  persist(isOpen); // 2回目以降のみ実行
}, [isOpen]);
```
<!-- importance: high | mentions: 2 | first-seen: 2026-05 -->

### ObjectURL のライフサイクル管理

`useMemo + useEffect` の cleanup は state クリア時に revoke してしまう。revoke するのは明示削除時とアンマウント時のみ。

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

**mutation の副作用・派生 state は「イベント駆動」で書く。data/useEffect の間接観測は誤発火する。** `data` の変化を `useEffect` で監視すると再フェッチ・再マウント・キャッシュ更新で予期せず再発火し、「成功したら 1 回」の意図が消える。

1. **Dialog クローズ・下書き取り込みは `onSuccess`（`mutate` の第 2 引数）で行う**。成功ごとに正確に 1 回発火する。`mutate` 直後の `setDialogOpen(false)` は処理進行中にダイアログが消え `isPending` フィードバックが見えなくなる。props 側も `onDelete: (id: string, onSuccess: () => void) => void` のシグネチャにして呼び出し元が完了タイミングを制御できるようにする。
2. **ユーザーから見てエラーな状態は `mutationFn` 内で `throw` する**。`return { duplicate: true }` のような flag 返却だと `onSuccess` が走って「完了」フィードバックが出る（エラー UI に乗らない）。throw すれば `onError` / `mutation.error` に乗り既存のエラー表示 UI がそのまま使える。
3. **row 型が「DB 値 + 他クエリからの導出」になったら optimistic update は原理的に再構成不能**。`onMutate`/`onError` を残さず `onSettled` で invalidate に切り替える（残すと導出フィールドが古いまま反映されるか、optimistic コードが dead code として残る）。判断: 「mutation の入力だけで row 全フィールドを再構成できるか」NO なら諦める。楽観の体験が必要ならサーバ側 mutation を速くするか、Server Action で最新 row 配列を返して `setQueryData` で差し替える。実例: ある案件の `LineItemMatchRow` の導出 `status`（issue 254 で導入 → issue 268 で optimistic 除去）。

<!-- importance: medium | mentions: 5 | first-seen: 2026-05 -->

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

## コンポーネント分割

### JSX helper を既存コンポーネントから抽出するとき import の棚卸しをする

既存の `return` 内 JSX をインライン `switch` に書き直して helper コンポーネントに抽出するとき、親コンポーネントの import 宣言を更新し忘れやすい（コンポーネント分割でアイコン・型・サードパーティが helper 側に移動してもビルド時まで気付かない）。

対処は次のとおり。
1. helper を書く前に「helper が使うアイコン・型・コンポーネント名」を箇条書きでメモする
2. helper ファイルの先頭にまとめて import を追加してから JSX を移す
3. 分割後に `bun run typecheck` を即実行して import 漏れを検出する

実例: `StagedUploadStatusCells` helper（switch-case で `extractionStatus` を分岐）抽出時に `CheckCircle2`/`RefreshCw` の import を追加し忘れ typecheck fail。親コンポーネントの import 宣言に追記して修正。
<!-- importance: medium | mentions: 1 | first-seen: 2026-06 -->

### セクション見出しに複数の interactive 要素（折りたたみボタン＋トグル等）が必要になったら、外側の `<button>` ごと `<div>` + 兄弟 `<button>` 群に再構成する

「見出し全体をクリックで折りたたむ」ために見出し全体を `<button>` にした後、そこへ別の独立操作（フィルタトグル・件数バッジのクリック等）を追加しようとすると button-in-button になり不正 HTML になる（ブラウザは内側の button をテキストとして扱い、クリックが外側にバブルする）。

対処: 見出しを `<div className="flex items-center gap-2">` に戻し、各操作（折りたたみ・トグル）を独立した兄弟 `<button>` として配置する。折りたたみボタンは `aria-expanded`/`aria-controls`、トグルボタンは `aria-pressed` を持つ。ラベル部分（クリック不要なテキスト）は非 button の `<div>`/`<span>` のままでよい。再構成時にタッチターゲット用の padding（`py-2.5` 等）を親 `<div>` に付けたままにするとヒット領域が縮む点に注意（各 interactive 要素側に付け直す）。

実例: `InvoiceLifecycleTable` の見出し（元は「折りたたみ全体を1つの `<button>`」）に「要対応のみ」フィルタトグルを追加する際、`<div>` + 折りたたみ用アイコンボタン + トグルボタンの兄弟配置に再構成した（issue 971）。
<!-- importance: medium | mentions: 1 | first-seen: 2026-07 -->

---

## ブラウザ API / セキュリティ

### `node:crypto` はブラウザで動かない — `"use client"` コンポーネントでは `crypto.getRandomValues` を使う

`"use client"` コンポーネントから `import { randomBytes } from "node:crypto"` すると実行時にクラッシュする（Node.js 専用モジュール）。クライアントサイドで暗号学的乱数が必要なときは Web Crypto API の `crypto.getRandomValues(new Uint8Array(N))` を使う。

```ts
// NG: "use client" 内では使えない
import { randomBytes } from "node:crypto";
const bytes = randomBytes(16);

// OK: Web Crypto API（ブラウザ・Node 18+ 両対応）
const bytes = crypto.getRandomValues(new Uint8Array(16));
```

`packages/core/src/crypto/index.ts` のような `node:crypto` ベースのサーバー専用ユーティリティを Client Component に import しても同じクラッシュが起きる。クライアント・サーバー両対応にするには実装を Web Crypto に統一するか、subpath export でクライアント専用版を別ファイルに切り出す。
<!-- importance: medium | mentions: 1 | first-seen: 2026-06 -->

---

## 型・フォーム

### 必須 props のデストラクチャリングにデフォルト値を付けない

型が `boolean`（optional でない）の props に `isLoading = false` のようなデフォルト値をデストラクチャリングで付けると、呼び出し側が渡し忘れたときに型エラーではなくデフォルト値で隠蔽される。型を required に変更したなら、デストラクチャリングのデフォルト値も同時に削除すること。

```tsx
// NG: isLoading が required 型なのにデフォルト値が隠蔽
function Comp({ value, isLoading = false }: { value: string; isLoading: boolean }) { ... }

// OK: デフォルト値なしで渡し忘れを型エラーとして検知
function Comp({ value, isLoading }: { value: string; isLoading: boolean }) { ... }
```
<!-- importance: medium | mentions: 1 | first-seen: 2026-06 -->

### React 19 の `useRef` 型変更

```ts
// NG: React 19 で TS2554
const timerRef = useRef<ReturnType<typeof setTimeout>>();

// OK: undefined を初期値として明示
const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
```

ミュータブル ref の初期値は `null` より `undefined` を優先する（cleanup 条件のチェックが一貫する）。

### React 19 の `FormEvent` は deprecated だが移行しない

React 19 で `FormEvent<HTMLFormElement>` が deprecated [6385] になったが、代替には見落としやすい問題が多い: DOM 型の `SubmitEvent` は合成イベント型と非互換（型エラー 2322）、`{ preventDefault(): void }` 引数型は型精度が落ちて「フォーム送信イベント」の意図が型システムから消える。

**WHY 現状維持**: typecheck が通る限り [6385] は IDE 警告のみで、型精度を落とすより正確な型（`FormEvent<HTMLFormElement>` のまま、または JSX の onSubmit ハンドラーとして型推論に任せる）を保つ方が重要。`SyntheticEvent<HTMLFormElement>` への移行も可（`e.currentTarget` は維持される）だが必須ではない。
<!-- importance: medium | mentions: 2 | first-seen: 2026-05 -->

### チェックボックスは `onClick` スタブ + `onChange={() => {}}` ではなく `onChange` のみで実装する

チェックボックスの選択処理を `onClick={(e) => handleSelect(e, key)}` + `onChange={() => {}}` で書くパターンは、`onClick` でロジックを担い `onChange` は React の制御コンポーネント要件を満たすだけのスタブになっている。
このとき後から `onClick` ハンドラーを削除・移動すると `_toggleSelect` のような未使用関数が残り、TypeScript TS6133 エラーになる（Biome が `_` prefix に rename しても TypeScript 側では未使用警告が残る）。

正しくは `onChange` ひとつだけで実装する。`e.stopPropagation()` が必要な場合も `onChange` 内で呼べる。

```tsx
// NG: onClick でロジック + onChange スタブ
<input
  type="checkbox"
  checked={isSelected}
  onChange={() => {}}        // スタブ: 実体なし
  onClick={(e) => {          // 実ロジックここ
    e.stopPropagation();
    toggle(key);
  }}
/>

// OK: onChange 一本で実装
<input
  type="checkbox"
  checked={isSelected}
  onChange={(e) => {
    e.stopPropagation();
    toggle(key);
  }}
/>
```
<!-- importance: medium | mentions: 1 | first-seen: 2026-06 -->

---

## 日付・UTC

### Gantt / カレンダーの日付演算は全操作を UTC で統一する

ピクセル位置を日番号（epoch days）で管理する Gantt・カレンダー系コンポーネントで、Date 操作がローカルと UTC で混在すると JST 等の環境で表示が1日ずれる。
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

`new Date("YYYY-MM-DD")` は UTC 解釈され JST で1日ずれる。サーバー・ブラウザ共通で安全なパターンは次のとおり。

```ts
const [y, m, d] = dateStr.split("-");
const date = new Date(Number(y), Number(m) - 1, Number(d));  // 常にローカル時刻
```

---

## React 19 新機能

- **`FormEvent` の deprecated 対応**: → [型・フォーム](#型フォーム)節「React 19 の `FormEvent` は deprecated だが移行しない」を参照（移行必須ではない）。
- **React 19 フォームの標準形は `useActionState` + `<form action={fn}>`**: `onSubmit` + 手動 `isLoading` より宣言的で Server Actions と互換性がある。
  ```tsx
  const [state, formAction] = useActionState(async (_prev, formData) => {
    return { error: "..." };
  }, {});
  <form action={formAction}>
    <FormContent error={state.error} />  {/* useFormStatus で pending を読む */}
  </form>
  ```
  `useFormStatus` の制約: `<form>` の子コンポーネントでしか使えない（`form` を render するコンポーネント自身では不可）。フォームのインプット・ボタン群を `FormContent` のような内部コンポーネントに切り出して `useFormStatus` を呼ぶのが正しいパターン。
  <!-- importance: medium | mentions: 1 | first-seen: 2026-06 -->
- **`useActionState` の dispatch を `<form action>` 外（onClick / onSubmit ハンドラ）から直接呼ぶと isPending が立たない**: dispatch は transition 内で呼ばれることを前提としており、イベントハンドラから素で呼ぶと action 自体は実行されるが `isPending` が true にならない（React 19.2 実機確認: クリック後 300ms 経ってもボタンが disabled にならなかった）。typecheck は通るため気づきにくい。対処: `useTransition` を併用し `startTransition(() => dispatch(data))` で包む。pending は `useTransition` 側の `isPending` から取る（useActionState の第 3 戻り値ではなく）。
  ```tsx
  const [isPending, startTransition] = useTransition();
  const [state, submitAction] = useActionState(async (_prev, data) => { ... }, init);
  <View onSubmit={(data) => startTransition(() => submitAction(data))} isSubmitting={isPending} />
  ```
  `<form action={formAction}>` で渡す場合は React が transition を張るためこの問題は起きない。構造化データ（File 含む）を渡したい・presigned URL への直接 PUT が要る等で form action にできないケースで起きる。
  <!-- importance: high | mentions: 2 | first-seen: 2026-06 -->
- **`() => void` の props に async 関数を渡すと Promise rejection が uncaught になる**: `onLogout?: () => void` のように `void` 型の callback props に `async () => { await signOut(); }` を渡すと、TypeScript は型エラーを出さない（`void` は戻り値を無視する）が Promise の rejection は知らないうちに無視される。対処: callback の型を `() => void | Promise<void>` と明示する。**判断基準**: onClick・onSubmit・onXxx 系の props が async な実装を受け取る可能性があれば `() => void | Promise<void>` を標準とする。
  <!-- importance: medium | mentions: 1 | first-seen: 2026-06 -->
- **Enter で submit する input は `e.nativeEvent.isComposing` をガードする**: `onKeyDown` で `e.key === "Enter"` を submit トリガーにすると、IME（日本語・中国語・韓国語等）の変換確定 Enter でも発火してしまう。`e.isComposing` でなく `e.nativeEvent.isComposing` を使うこと（React の合成イベントには `isComposing` が無い）。CJK ユーザー向けプロダクトでは必須。
  ```tsx
  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      submit();
    }
  }
  ```
  <!-- importance: high | mentions: 1 | first-seen: 2026-06 -->
- **textarea の高さ自動調整は `useEffect([value])` でなくイベントハンドラで行う**: `el.style.height="auto"; el.style.height=scrollHeight+"px"` という DOM 同期を `useEffect(() => {...}, [value])` に書くと、effect 本体が `value` を参照しない（DOM ref しか読まない）ため biome `useExhaustiveDependencies` が「不要な依存」と誤検知してエラーになる。`onChange` 内で同期的にリサイズするのが正解。プログラムによる値クリア（送信後の `setValue("")`）は onChange を発火しないため、その箇所だけ明示的に `ref.style.height="auto"` で戻す。
  <!-- importance: medium | mentions: 1 | first-seen: 2026-06 -->

---

## App Router / Suspense

- **Radix Dialog は `open={true}` が残ると body に `pointer-events: none` がかかりページ全体が操作不能になる**: Server Action 成功後にダイアログを閉じ忘れると Radix が body の `pointer-events: none` を解除しないため、他のボタン・メニューが一切クリックできなくなる（リロードまで症状が持続）。対処: `useActionState` の返値 `state` を `useEffect` で監視し、`state?.success` が `true` になった時点で `setOpen(false)` を呼ぶ。`useActionState` を使う全ダイアログで同パターンに従う。WHY NOT `onSubmit` での即時クローズ: SA の完了前にダイアログが閉じると isPending 中の UI が消えてフィードバックが得られない。
  <!-- importance: high | mentions: 1 | first-seen: 2026-06 -->

- **`<Suspense>` は純粋 Client Component に効かない**: async Server Component か `use(promise)` を使う CC でのみ fallback が発火する。`useState` / `useRouter` だけの CC を `<Suspense>` で包んでも無意味。

- **保存中に `<input disabled={isSaving}>` にすると、フォーカス中の要素が disabled になった時点でブラウザが native blur を発火させ、`onBlur` ハンドラの commit を再度呼んでしまう**: インライン編集 UI（クリック→input→blur/Enter で保存）で「保存中は input を触らせない」ために `disabled` を付けるのは自然だが、フォーカスを持つ要素が disabled になると強制的にフォーカスが外れ blur イベントが発火する。これは Escape キャンセルや保存成功時の `setIsEditing(false)`（input がアンマウントされる）でも同様に起きる。この「自己都合の blur」を「ユーザーがクリックで外に出た」通常の blur と区別しないと、保存中の commit() が再入し DB 書き込み・ログ追記が二重発生する。対処: `useRef` の再入ガード（`if (isSaving) return`）と、意図的に閉じる直前に立てる `suppressBlurRef`（`onBlur` 内で見て早期 return）の2点セットで防ぐ。判断基準: 「disabled や unmount を伴う状態変更の直後に blur ハンドラが自分の意図と無関係に発火しうるか」YES なら再入ガードが要る。
  <!-- importance: medium | mentions: 1 | first-seen: 2026-07 -->

- **Radix UI `DropdownMenu` を `Dialog` 内で使うと透明オーバーレイが Dialog を閉じる**: `DropdownMenu` はデフォルトでポインターイベントをブロックする透明オーバーレイを生成する。`Dialog` 内でドロップダウンを開いた後にモーダル内の別要素をクリックすると、クリックがオーバーレイに当たり Dialog の `onPointerDownOutside` が発火してモーダルが閉じる。対処: `<DropdownMenu modal={false}>` を指定する（オーバーレイ生成を抑制）。`onPointerDownOutside` にカスタムチェック（role="menu" など）を足す方法は根本解決にならない（透明なオーバーレイが role を持たないため）。WHY NOT `onPointerDownOutside` カスタム判定: イベントターゲットがオーバーレイの `<div>` になるため、DropdownMenu コンテンツ要素の `role` を確認しても常に「Dialog 外クリック」と判定される。
  <!-- importance: high | mentions: 1 | first-seen: 2026-06 -->

- **Next.js App Router 部分ローディング**: `loading.tsx` はルート全体を Suspense で包むため、動的部分だけスケルトンにしたい場合は次の手順にする。
  1. `loading.tsx` を削除
  2. `page.tsx` を non-async に
  3. フェッチを子 async SC に切り出す
  4. `<Suspense fallback={<Skeleton />}><DataFetcher /></Suspense>` で組み合わせる

- **TanStack Query の `initialData` は「mount 時の queryKey」にしか対応しない。key が可変な hook では mount 時引数を `useRef` に固定して一致判定してから渡す**: SSR data を `initialData` で seed する hook の queryKey が state 由来（選択月・選択タブ等）で remount なしに切り替わる場合、`initialData` をそのまま渡すと「初期データと別の key のキャッシュを初期データで seed する」思いがけない失敗になる（切替先の画面に別データが一瞬〜永続で表示される。`staleTime: Infinity` だと refetch もされず固着）。「このコンポーネントは key が変わるとき remount される」という仮定に頼るのは危険。soft navigation で React が同位置コンポーネントを remount する保証はない。対処: `const initialRef = useRef({ key, initialData })` で mount 時の組を固定し、`initialData: () => key === initialRef.current.key ? initialRef.current.initialData : undefined` と関数形式で一致判定する。remount の有無に依存せず「初回 mount の key だけ SSR data を再利用し、他は必ず fetch」が保証される。実例: ある案件の issue の `useMonthlyMatching`（月切替で queryKey が変わる一覧ページ）。
  <!-- importance: high | mentions: 1 | first-seen: 2026-07 -->

- **`data === undefined` を「fetch 中」とだけ解釈すると fetch 失敗時に無限ローディングになる。undefined を消費する hook は `isError` / `refetch` も公開契約に含める**: useQuery の `data` は fetch 中も retry 尽きた失敗後も `undefined` のまま。呼び出し側が `data === undefined ? <Spinner /> : <Content />` と書くと、エラー時にスピナーが永久表示され再試行手段もない。データ取得 hook を設計する時点で「undefined は 2 状態（loading / error）を含む」ことをコメントで明示し、`isError` と `refetch` を戻り値に含めて呼び出し側がエラー分岐 + 再試行導線（`role="alert"` + 再試行ボタン）を描き分けられるようにする。判断基準: 「この hook の data が undefined のまま確定するパスがあるか」YES なら loading/error の描き分け材料をセットで公開する。実例: ある案件の issue レビューで検出（月切替 fetch の失敗が無限スピナーになっていた）。
  <!-- importance: medium | mentions: 1 | first-seen: 2026-07 -->
