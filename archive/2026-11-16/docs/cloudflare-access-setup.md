# Cloudflare Access (Zero Trust) セットアップの注意点

Self-hosted application を手動で設定するときに見落としやすい点。ある案件で施設用 Access アプリを作った際に確認（2026-09-18）。

## AUD Tag と Application ID を混同しない

Access アプリの Overview ページには似た形の値が2つ並ぶ。

- **AUD Tag**（JWT 検証に使う値）: 64 桁の 16 進数、ハイフンなし
- **Application ID**: 36 桁のハイフン区切り UUID（8-4-4-4-12）

Application ID を AUD として設定すると、JWT 検証コードは `audience` 不一致で 401 "invalid access token" を全リクエストで返す（503 setting-missing ではなく、一見正常に設定されているように見えるので気づきにくい）。値を控えるときは桁数とハイフンの有無で判別する。

## Access は deny-by-default — ポリシーが 0 件だと誰も通らない

Cloudflare 公式: "Since Access is deny by default, users who do not match a Block policy will still be denied access unless they explicitly match an Allow policy." ポリシーを1つも作らないと動かない。認可を別テーブル（DB）だけで管理したい設計でも、Access 側には最低 1 つ `Allow` + Include `Everyone` のポリシーが要る（Access は「本人確認」だけを担当し、「何を見せるか」は DB 側に委ねる設計と両立する）。

## Path のマッチングは wildcard が親パスを含まない

公式: "Using a wildcard in the Path field does not cover the parent path nor the apex domain." つまり `/facility/*` は `/facility` 自体をカバーしない。逆に bare path がプレフィックスとして働くかは公式ドキュメントで明言されておらず未確定。両方のリスクを避けるには bare path と `/*` wildcard の両方をアプリの Path リストに登録する（1 アプリに複数 Path エントリを追加できる）。

## One-time PIN は新規組織のデフォルトではない

公式: "New Zero Trust organizations use the Cloudflare identity provider as their default login method. OTP is no longer added automatically, but you can set it up at any time." デフォルトの Cloudflare identity provider は Cloudflare アカウントを持つ人しかログインできないので、外部の一般ユーザー（ホテルスタッフ等、Cloudflare アカウントを持たない相手）には使えない。Identity providers 一覧に OTP が無ければ Zero Trust 設定側で明示的に追加する必要がある。

## Session duration はセキュリティ設定ではなくUX設定になりうる

認可判断を（Access のポリシーでなく）呼び出し先アプリ側の DB から毎リクエスト引く設計なら、Access の session duration は「トークン失効までの長さ」でしかなく、DB 側で権限を外せば次のリクエストから即座に反映される。この場合 session duration は「ログインし直しの頻度」という UX トレードオフに過ぎず、セキュリティの強弱ではない（blast radius が大きい区画は短め、小さい区画は長めでよい）。逆に Access のポリシー自体が認可の唯一の砦なら session duration はセキュリティ設定になる。どちらの設計かで意味が変わることに注意。
