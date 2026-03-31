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

## フック

- カスタムフックは `use` prefix、1ファイル1フック export
- フック内にビジネスロジックを集約し、コンポーネントを薄く保つ
- 副作用（`useEffect`）は最小限に。依存配列を正確に書く

## 禁止パターン

- `useEffect` でのデータフェッチ（React Query 等を使う）
- `any` 型の Props
- インラインでの複雑なロジック（カスタムフックに抽出する）
