# コードの設計

> **TL;DR**: コードのまとまりと境界を見る3つの問いと、設計で実際に間違えた点を置く。コードレビューと、複雑さの診断で読む。

整理する前の版は`archive/2026-11-16/docs/`の`cohesion.md`、`readability.md`、`design.md`にある。命名は`glossary-policy.md`、コメントと実装の規則は`coding-policy.md`、言語ごとの作法は`go.md`と`typescript.md`が持つ。

## まとまりを見る問い

- **変える理由は1つか**。目的を1文で言うのに接続詞が要る関数と、`utils`や`helpers`のほかに中身を表す名前が付けられないファイルは、分ける候補になる。
- **名前から予想できない副作用が無いか**。`getX()`がDBに書く、`calculateX()`が外部のAPIを呼ぶ、のような関数は、名前か処理のどちらかを直す。
- **同じ知識の導出は、2か所目で関数にまとめる**。片方だけ直されると食い違うからだ。形が似ているだけで、別々の理由で変わるものはまとめない。

## 実際に間違えた点

### 循環するimportは、間接化の前に型の置き場を見直す
<!-- mentions: 1 | first-seen: 2026-06 -->

AがBの型を使いたいが、直接importすると循環するとき、interfaceとadapterを足す前に、循環の向きを見る。原因が「BからAへのimportが既にある」ことだけなら、共有する型を、既にimportされている側のパッケージへ移せば循環は消える。間接化は、両方向に依存が要るときに使う。interfaceとadapterを足した直後にも、型の移動で消せないかを見直す。判断基準は「この型は、どちらのパッケージに属するか」。

### APIクライアントは、URLの文字列でなく型のついた値を返す
<!-- mentions: 1 | first-seen: 2026-06 -->

クライアントが`stateUrl(id)`のようなURLの文字列を返すと、fetchとパースが呼び出し側に移り、スキーマがクライアントと呼び出し側の両方に重複する。クライアントは、URL、スキーマ、fetch、`EventSource`、パースをすべて持ち、呼び出し側には型のついた値だけを渡す。

- 読み取りは`getState(id): Promise<Job | null>`。失敗でthrowせず`null`を返すと、購読を始める前の初期値としてそのまま使える
- 購読は`streamEvents(id, signal): AsyncIterable<Event>`。`EventSource`はクライアントの中に閉じる
- 操作（`kick`など）は失敗でthrowする。読み取りと操作で失敗の返し方が違うのは、呼び出し側の使い方が違うからで、揃えない

### 購読の受け手がReactのeffect 1つなら、callbackでなく`AsyncIterable`で返す
<!-- mentions: 1 | first-seen: 2026-06 -->

callback（`onEvent`、`onError`、unsubscribe）で返すと、受け手は停止の処理を完了、失敗、エラー、unmountの複数の箇所から呼び、`setState`のupdaterの中で副作用を起こすことになる。`AsyncIterable`にすると、受け手は`await getState()`の後に`for await`を回す1つの関数になる。停止はループの終了と`signal.abort()`に集まり、初期値の取得と購読の順番も入れ替わらない。

代わりに、クライアントの側に、届いたイベントをqueueに積んで`for await`へ渡す処理が要る。`EventSource`を閉じる処理は、generatorの`finally`の1か所に置く。受け手が複数あるか、Reactでないなら、callbackでよい。

### helperに抽出したら、WHYのコメントもhelperへ移す
<!-- mentions: 1 | first-seen: 2026-07 -->

共通の処理をhelperに抽出したとき、元の関数にWHYのコメントを残すと、同じ説明が2か所に並び、片方だけ直される。WHYはhelperに1か所だけ置き、元の関数には参照（TypeScriptなら`{@link helperName}`）と、その関数だけの事情を残す。判断基準は「この段落が説明しているのは、helperの実装か、この関数だけの事情か」。コメントの規則の全体は`coding-policy.md`の「コメント」にある。

### ある型をパースする処理は、その型の知識を持つ層に置く
<!-- mentions: 1 | first-seen: 2026-05 -->

`ProviderAnalyzer<T>.parse()`のように、型`T`のパースを受け持つ層があるなら、`T`をパースする処理はすべてそこに置く。「AIで解析するからaction層に置く」のように、処理の手段（静的か、AIか）で置き場所を決めると、型の知識が2つの層に分かれる。判断基準は「これは、どの型の知識か」。
