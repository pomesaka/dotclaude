---
name: e2e-plan-adet
description: 新しい画面・機能のE2Eテストを作成する。新しい画面を実装したとき、または既存画面にE2Eテストを追加したいときに使う。
allowed-tools: Bash(playwright-cli:*), AskUserQuestion, Write, Read, Glob
---

# E2Eテスト作成

AskUserQuestion で要件をヒアリングし、playwright-cli で UI を実際に探索した上で、プロジェクト規約に沿った Playwright テストファイルを生成する。

## Step 1: 要件ヒアリング

AskUserQuestion で以下を確認する:

1. **テスト対象の画面**: URL またはナビゲーション手順（例: 「ログイン後、AccelHack → utokenpj → 機能一覧に遷移」）
2. **テストしたいシナリオ**: 「〇〇したら〇〇が表示されること」の形式で。複数あれば全て。
3. **配置先**: 既存カテゴリ（`Glob` で `e2e/tests/*/` を確認して選択肢提示）か新規カテゴリか

## Step 2: 環境確認

`e2e/.env.e2e` を Read して以下を取得する:
- `PLAYWRIGHT_BASE_URL` → ベースURL
- `TEST_USER_EMAIL` / `TEST_USER_PASSWORD` → ログイン認証情報

## Step 3: UI探索

playwright-cli で対象画面まで実際に遷移し、要素を把握する。

```bash
# ログイン（2ステップ: メール入力 → 「次へ」→ パスワード入力 → 「ログイン」）
playwright-cli open {PLAYWRIGHT_BASE_URL}/auth/signin
# snapshot で ref を確認してから fill/click

# 対象画面まで遷移
playwright-cli goto {target_path}  # または画面ごとにクリックで遷移

# 要素ツリー取得
playwright-cli snapshot
```

ユーザーが「〇〇をクリックしたら」と言っている場合は、その操作後のスナップショットも取って遷移後の状態を把握する。

探索後、確認した内容をユーザーに見せてシナリオを確定させる。
不明点があれば再度 AskUserQuestion で確認する。

## Step 4: テスト生成

### ファイル配置

```
e2e/tests/
  fixtures/
    auth.ts       ← login() ヘルパー（変更不要）
  <category>/
    <name>.spec.ts
```

### テンプレート

```typescript
import { test, expect } from '@playwright/test';
import { login } from '../fixtures/auth';  // 深さに応じてパスを調整

test.describe('<カテゴリ番号>. <カテゴリ名>', () => {
  test('<項番>: <操作> → <期待結果>', async ({ page }) => {
    await login(page);  // 認証が必要なテストのみ

    await page.goto('<path>');

    // 操作
    await page.getByRole('<role>', { name: '<name>' }).<action>();

    // 検証
    await expect(page.<assertion>).toBeVisible();
  });
});
```

### 命名規則

- `test.describe`: リグレッションテンプレートの番号と名前（例: `2. 組織管理`）
- `test`: 項番 + "操作 → 期待結果"（例: `2-1: 組織を新規作成 → 一覧に表示される`）
- ファイル名: カテゴリの内容を表す短い名前（例: `management.spec.ts`）

### セレクタ優先順位

1. `getByRole('button', { name: '...' })` — アクセシビリティロール（最優先）
2. `getByLabel('...')` — フォームフィールド
3. `getByText('...')` — テキスト一致
4. `locator('[data-testid="..."]')` — テストID
5. CSS セレクタは最終手段

### 認証

- 認証が必要なテストは `login()` ヘルパーを使う
- 各テストは独立したブラウザコンテキストで動くため、毎回ログインが必要

## Step 5: 完了

生成したファイルパスをユーザーに伝える。
単体実行の案内:

```bash
task e2e:run -- --grep "<テスト名のキーワード>"
```
