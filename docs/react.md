# Reactの規約と罠

> **TL;DR**: Reactのコンポーネントとフックを書くときとレビューするときに読む。利用者の設計の選択（Container/Presenter、フックの名付け、状態の持ち方）と、React 19、TanStack Query、Radix UIで実際に踏んだ罠をまとめてある。a11yは`react-a11y.md`、App RouterとSuspenseは`nextjs.md`にある。

整理する前の版は`archive/2026-11-16/docs/react.md`と`archive/2026-11-16/docs/react-gotchas.md`にある。

## 規約

- **Container/Presenterに分ける**。データの取得、mutation、状態はContainerとカスタムフックに置き、Presenter（View）はpropsを受けて表示するだけにする。Viewが`useState`、`useMutation`、非同期の処理を持っていたら、フックへ移す。
- **1つのファイルからexportするコンポーネントは1つ、フックも1つ**。Skeletonと、hookを閉じ込めるための内側のコンポーネントは同じファイルに置いてよい。Skeletonを同じファイルからexportするのは好ましくないが、`<Suspense fallback>`で使うために要るかどうかは、そのプロジェクトで実装する側が決める。
- **フックが返す関数はドメインの動詞で名付け（`selectFile`、`generate`）、Viewのpropsは`on`で始める**。Containerが`onSubmit={generate}`と対応づける。
- **`role`をpropの名前にしない**。Biomeの`useValidAriaRole`が反応する。`variant`、`sender`、`kind`を使う。
- **通常のデータ取得はReact QueryかServer Componentで行う**。`useEffect`は外部との同期（ブラウザのAPI、ナビゲーション）に限る。`useEffect`で取得してよいのは、ストリーム（EventSource）や、接続と一体の初回の取得だけ。そのときは1つのeffectに順に書き、cleanupで止める。fetchとEventSourceを別のeffectに分けると、fetchが終わっても依存が変わらないので、EventSourceのeffectは走らない。
- **アプリに1つしか無い状態（テーマ、言語、認証）は、モジュールのstoreと`useSyncExternalStore`で持つ**。`useState`のフックを複数の場所から呼ぶと別々のstateになり、片方の更新がもう片方に届かない。Contextは、アプリ全体で1つならProviderが増えるだけになる。元の値がDOMにあるとき（`<html>`のクラス）は、キャッシュを持たずにDOMを直接読み、`window`のイベントで知らせる。
- **フォームは`useActionState`と`<form action>`で書く**。pendingは`useActionState`の3つめの戻り値から取る。`useFormStatus`は`<form>`の子でしか読めず（formを描くコンポーネント自身では常に`pending: false`）、間にコンポーネントが増える。使うのは、formの中に独立した送信の領域が複数あるとき、深い入れ子でpendingを読みたいとき、Server Actionでない素の`<form action="...">`を扱うときに限る。
- **二重送信は、`disabled`でなく、送信のきっかけを描画しないことで防ぐ**。送信中は専用のUI（スピナーのカード）だけを出し、ボタンやドロップゾーンを描かない。`disabled`は、入り口（ボタン、ドロップ、ショートカット）が増えたときに付け忘れる。
- **全要素に共通の既定を持つUIの状態は、既定から外れた要素のSetで持つ**。既定が全部閉じるなら`expandedIds`、全部開くなら`collapsedIds`を、空のSetで始める。既定の側を全idで初期化すると、再取得やページングで増えた要素だけが逆の状態で現れる。判断基準は「データが増えたとき、新しい要素はどちらの状態で現れるべきか」。
- **分岐の片側やearly returnの後でしか使わないhookは、内側のコンポーネント（`XxxInner`）に分けて、そこで呼ぶ**。外側が分岐を担う。`useCopyFeedback("")`のように、使わない分岐で空の値を渡して呼ぶのも同じ問題。
- **asyncの実装を受けうるcallbackのpropsは、`() => void | Promise<void>`と書く**。`() => void`にasyncの関数を渡しても型エラーにならず、rejectionが捕まえられないまま残る。
- **React 19で`FormEvent<HTMLFormElement>`はdeprecatedになったが、移行しない**。DOMの`SubmitEvent`は合成イベントと型が合わず、`{ preventDefault(): void }`は型の精度が落ちる。警告はIDEに出るだけでtypecheckは通る。`SyntheticEvent<HTMLFormElement>`へ移してもよい。

## 状態と非同期の設計

- **mutationの後の処理は、成功のイベントで書く**。`data`の変化を`useEffect`で見ると、再取得、再マウント、キャッシュの更新でも走り、「成功したら1回」にならない。当てはめ方は3つある。
  - 成功の後の処理は`onSuccess`（`mutate`の第2引数）に置く。propsも`onDelete: (id, onSuccess) => void`の形にして、呼び出し元が完了の時点を決められるようにする。
  - 利用者から見てエラーの状態は、`mutationFn`の中でthrowする。`return { duplicate: true }`のように返すと`onSuccess`が走り、エラーの表示に載らない。
  - 行の型が「DBの値と、ほかのクエリからの導出」になったら、optimistic updateをやめて`onSettled`でinvalidateする。判断基準は「mutationの入力だけで、行の全フィールドを組み立て直せるか」。
- **ダイアログは、保存が成功したときだけ閉じる**。`void onSave(...)`の直後に閉じると、失敗したときに入力が消え、エラーを出す場所も無い。保存のpropsは`Promise`を返す契約にし（`mutateAsync`）、失敗したら入力を残して、ダイアログの中に`role="alert"`でエラーを出す。閉じる処理は成功のイベント（`await`の後、`onSuccess`）に置く。Server Actionでも同じで、アクションの完了を待ち、成功なら閉じる。Radix Dialogは`open={true}`が残ると、bodyに`pointer-events: none`がかかったままになり、リロードするまでページ全体が操作できない。
- **`useQuery`の`data === undefined`は、読み込み中と失敗の2つを含む**。`data === undefined ? <Spinner />`と書くと、失敗したときにスピナーが消えない。`isLoading`（初回の取得）で読み込みを判定し、`!data`を失敗として分ける。データを取るフックは`isError`と`refetch`も返し、呼び出し側がエラーと再試行のボタンを描けるようにする。再取得中（`isFetching`）はSkeletonを出さず、古いデータを見せたままにする。
- **TanStack Queryの`initialData`は、マウントした時点のqueryKeyにだけ対応する**。keyがstateで変わるフック（選んだ月、タブ）にそのまま渡すと、切り替えた先のキャッシュまで初期データで埋まる。`staleTime: Infinity`だと再取得もされない。`const initialRef = useRef({ key, initialData })`で組を固定し、`initialData: () => key === initialRef.current.key ? initialRef.current.initialData : undefined`と書く。keyが変わるときに再マウントされる、という仮定には頼らない。
- **行ごとの操作のエラーは、「そのエラーが前提にしていた内容」で消す時点を決める**。`useEffect(() => setError(null), [items])`は、失敗した本人の再取得が新しい`items`を作るので、読む前に消える。エラーに「どの行への操作か」と「そのときの行の状態」を持たせ、描画のときに今のデータと照らして出すかを決める。判定は純粋な関数（`visibleError(error, items)`）にして、テストで固定する。判断基準は「このエラーは、何が変わったら意味を失うか」。
- **サーバー由来の一覧に、まだDBに無い一時的な行（アップロード中）を混ぜるときは、表示の層でunionを作る**。サーバーの型とクエリには足さない。クライアントだけの行の型（`origin: "uploading"`）を定義し、`type DisplayRow = DbRow | TransientRow`を表が受け、`mergeRows(dbRows, transientRows)`の1か所で、永続化された後にDBの行と一致するキー（S3のkeyなど）で重複を除く。一時的な行は、再取得が終わるのを待ってから除く。サーバーの契約にクライアントの状態が混ざると、行の出どころを追えなくなる。
- **同じ入力から作る複数の派生値（ブロックと見出し、本文と目次）は、1回の処理で一緒に作る**。別々に加工すると、idや位置がずれる。react-markdownで本文の見出しidと目次のidを別々に作るなら、両方を同じ正規化（インライン記法を除く、trim、空白を`-`に）に通す。本文の側は`children`が要素の木なので、`String(children)`でなく再帰して文字を取り出す。揃っていないと、書式つきの見出しだけアンカーが効かない。
- **ブラウザにしか無い値（sessionStorage、localStorage）を初期値にするときは、マウントの後に読み、値が決まってから子を描く**。`useState(() => sessionStorage.getItem(...))`は、`"use client"`があってもSSRで実行されて`window is not defined`で落ちる。また`useState(props.initial)`は最初の描画でしか使われないので、親が後から値を入れても子は初期化し直さない。`hasMounted`のフラグを`useEffect`で立て、立つまで`null`を返す。SSRに効かせたいUIの状態（サイドバー、テーマ、ロケール）はCookieに置き、SCで`next/headers`から読んでpropsで渡す。このときはフラグが要らない。
- **状態が変わるたびにコンポーネントを差し替えない**。pendingとdoneで別のコンポーネントにすると、アンマウントとマウントでセクションの並びが入れ替わる。1つのコンポーネントで全部の状態を表し、doneでだけ現れるセクションは末尾に足す。データがまだ無いセクションには、見出しを残して仮の文を出す。
- **ストリームを読むフック（AsyncGenerator）は、`try/finally`でrefを片付け、例外のときはUIを待機の状態へ戻す**。上流のPromiseにも`.catch()`を付ける。完了の値はstateから読み返さず（古い値を掴む）、ループの中の変数に溜めて`Promise<Result>`で返す。
- **`setState`のupdaterには副作用を書かない**。StrictModeではupdaterが2回走る。
- ObjectURLをrevokeするのは、利用者が消したときとアンマウントのときだけにする。`useMemo`と`useEffect`のcleanupに任せると、stateを空にした時点でrevokeされる。

## 実際に踏んだ罠

- **`useActionState`のdispatchを`<form action>`の外（onClickのハンドラ）から直接呼ぶと、`isPending`が立たない**（React 19.2で確認）。actionは実行され、typecheckも通る。`startTransition(() => dispatch(data))`で包み、pendingは`useTransition`の`isPending`から取る。Fileを含む構造化したデータを渡すときなど、form actionにできない場面で起きる。
- **Enterで送信するinputは、`e.nativeEvent.isComposing`を確かめる**。IMEの変換を確定するEnterでも`onKeyDown`が走る。Reactの合成イベントには`isComposing`が無い。
- **保存中に`<input disabled={isSaving}>`にすると、フォーカスを持つ要素がdisabledになった時点でblurが起き、`onBlur`のcommitがもう一度走る**。Escapeでの取り消しや、保存の後のアンマウントでも起きる。`if (isSaving) return`の再入のガードと、意図して閉じる直前に立てる`suppressBlurRef`の2つで防ぐ。
- **Radix UIの`DropdownMenu`を`Dialog`の中で使うときは`modal={false}`を付ける**。既定では透明なオーバーレイが作られ、メニューを開いた後のクリックがそこに当たって、Dialogの`onPointerDownOutside`が走り、Dialogが閉じる。`onPointerDownOutside`で`role`を見て除く方法は効かない（イベントの対象が、roleを持たないオーバーレイになる）。
- **textareaの高さの自動調整は、`useEffect([value])`でなく`onChange`の中で行う**。effectの本体が`value`を読まないので、Biomeの`useExhaustiveDependencies`が要らない依存として報告する。送信後の`setValue("")`は`onChange`を起こさないので、そこだけ`ref.style.height = "auto"`で戻す。
- **`<thead>`の`<th>`を条件つきで出すなら、対応する`<td>`も同じ条件で包む**。片方だけだと列の数が合わず、スクリーンリーダーが列の対応を誤る。
- JSXの表示の条件で「どちらかがあれば出す」を`a ?? b`で書かない。`||`か、`!= null`どうしのORで書く。
- チェックボックスは`onChange`だけで書く。`onClick`にロジックを置いて`onChange`を空の関数にすると、後で`onClick`を動かしたときに使われない関数が残る。

## 日付

日付だけの値は、解釈する時刻帯を1つに決めて、パースと読み出しを揃える。

- **日の番号で位置を決める画面（ガント、カレンダー）は、全部の演算をUTCに揃える**。`new Date("2026-06-02T00:00:00")`はローカルの時刻として解釈され、JSTではUTCの06-01 15:00になり、日の番号が1つずれる（node 22で確認）。パースは`Date.parse("...T00:00:00Z")`、読み出しは`getUTCDate()`と`Date.UTC(y, m, d)`を使う。
- **`new Date("YYYY-MM-DD")`はUTCとして解釈される**。ローカルの日付として読むと、UTCより西の時刻帯で1日ずれる（node 22で確認。JSTではずれない）。ローカルの日付として扱うなら、`new Date(Number(y), Number(m) - 1, Number(d))`で組み立てる。
