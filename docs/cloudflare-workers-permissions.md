# Cloudflare API トークン: Workers の権限まわりの罠

Pulumi（`@pulumi/cloudflare`）で Worker を新規作成しようとして 403 が返った際の調査（2026-09-25）。

## 新しい権限体系（2026-09-15 GA）の「Workers Editor」は新規作成できない

Cloudflare は 2026-09-15 に、Workers のアカウント全体権限を「1 Worker・1 プロダクト・Developer Platform 全体」に絞れる新しい権限体系（Metadata Read-Only / Content Read-Only / Editor / Admin の 4 ロール）を GA した。旧来の「Workers Scripts」系の権限は残っているが、新しい体系に置き換わっていく方針。

- **Editor**: 既存 Worker の読み取り・更新・デプロイ・リネームはできるが、新しい Worker の作成・削除はできない（[Workers roles and permissions](https://developers.cloudflare.com/workers/authorization/workers/)）
- **新しい Worker を作るには product レベルの Admin が要る**。per-Worker スコープは「まだ存在しない Worker」には付けられないので、初回作成時は必ず Admin（または legacy の Workers Scripts: Edit）が必要
- 対処: 初回デプロイ（Worker 作成）は Admin か legacy 権限で行い、Worker ができた後にその Worker だけの Editor へ絞り直す

症状は `assets-upload-session` などの API が `403 { "message": "No access to the specified resource." }` を返すだけで、権限が足りないことしか分からず「どの権限が足りないか」は各 API の "Accepted Permissions" ドキュメント（`https://developers.cloudflare.com/api/resources/.../methods/create/`）を個別に確認しないと分からない。

## 権限の変更は反映まで数分かかることがある

トークンの権限を編集した直後は、同じ操作がまだ 403 になることがある。ある案件では legacy の「Workers Scripts Write」を足してから約 5 分後に通った。数分待っても直らない場合だけ、権限の付け先（Account 単位 / Zone 単位のどちらの塊に入っているか）を疑う。

## Email Service: 任意の宛先へ送るには Workers Paid が要る

`send_email` binding で「検証済みの宛先」以外（任意の外部アドレス）に送るには、アカウントが Workers Paid プランである必要がある（[Pricing](https://developers.cloudflare.com/email-service/platform/pricing/) / [Limits](https://developers.cloudflare.com/email-service/platform/limits/)）。Workers Free だと `POST /accounts/{id}/email/sending/limits` 等の Email Service の API 自体が `403 Unauthorized`（code 2036）を返し、権限の問題と区別しにくい。ログインコードの送信のような「任意のユーザーへのメール」機能を作るときは、先にプランを確認する。

Workers Free には他にも実務に影響する制限がある: 1 リクエストの CPU 時間 10ms（Paid は既定 30 秒・最大 5 分）、1 リクエストの外部呼び出し 50 回（Paid は 10,000 回）。Webhook の署名検証・JWT 検証・外部 API 呼び出しをするアプリは Free の 10ms に収まらないことがある（[Workers Limits](https://developers.cloudflare.com/workers/platform/limits/)）。
