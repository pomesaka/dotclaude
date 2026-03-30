---
name: update-adet-docs
description: ADeTプロジェクトのドキュメント（docs/、README.md、CONTRIBUTING.md、CLAUDE.md等）が実際のコードと整合しているかを調査・修正する。新機能追加後やリファクタリング後にドキュメントを最新化したい時に使用する。
disable-model-invocation: true
allowed-tools: Read, Edit, Write, Grep, Glob, Bash(task *), Bash(jj *), Bash(cat *), Bash(ls *)
---

# ADeT ドキュメント更新スキル

`docs/`、ルートの `README.md`/`CONTRIBUTING.md`/`CLAUDE.md`、`backend/*.md`、`frontend/*.md` が実際のコードと整合しているかを調査し、ズレを修正する。

## 調査対象ドキュメント

- `docs/*.md` — 機能説明・運用手順・設計ドキュメント
- `README.md`, `CONTRIBUTING.md`, `CLAUDE.md`, `GLOSSARY.md`
- `backend/README.md`, `backend/CONTRIBUTING.md`, `backend/CODING_CONVENTIONS.md`
- `frontend/README.md`, `frontend/CONTRIBUTING.md`, `frontend/CODING_CONVENTIONS.md`

## 手順

### Step 1: 変更範囲の特定

現在の差分を確認し、どのドメインが変更されたかを把握する:

```bash
jj diffu
```

変更ドメインの例:
- **Backend（Go）の変更** → `backend/README.md`, `backend/CODING_CONVENTIONS.md`, `CLAUDE.md` の該当セクション
- **Frontend（TS）の変更** → `frontend/README.md`, `frontend/CODING_CONVENTIONS.md`, `CLAUDE.md` の該当セクション
- **API/OpenAPI の変更** → `docs/` 内の機能説明、`CONTRIBUTING.md` のAPI定義フロー
- **DB/マイグレーションの変更** → `docs/schema-management.md`, `CLAUDE.md` の DB Operations セクション
- **新機能追加** → `docs/` 内の対応ドキュメント、`README.md` の概要セクション
- **ディレクトリ構造の変更** → `backend/CONTRIBUTING.md`, `frontend/CONTRIBUTING.md` の構造図

### Step 2: ドキュメント検証

変更に関連するドキュメントを読み込み、以下の観点でズレを探す:

#### ファイルパス・ディレクトリ構造の検証

ドキュメントに記載されているパスが実際に存在するかを確認する:
- 存在確認: `ls <path>` または `Glob` ツールで照合
- ディレクトリ構造図がコードベースの実態と一致しているか

#### コマンドの検証

ドキュメントに記載されているコマンドが実際に定義されているかを確認する:
- `task` コマンド → `Taskfile.yml` の `tasks:` セクションを grep
- `bun run` スクリプト → `frontend/package.json` の `scripts:` を grep

#### API・エンドポイントの検証

ドキュメントに記載されているAPIパス・レスポンス形式が `openapi/` と一致しているか:
- `Grep` で endpoint パスを照合

#### ライブラリバージョンの検証

CLAUDE.md の「Main Libraries」セクションに記載されているバージョンが実際と一致しているか:
- Go ライブラリ: `backend/go.mod` と照合
- Frontend ライブラリ: `frontend/package.json` と照合

#### アーキテクチャ説明の検証

実装パターンの説明（UseCase構造、Repository パターン等）が実際の実装と乖離していないか:
- 代表的なファイルを `Read` して説明と照合する

### Step 3: 修正実施

検出したズレを `Edit` ツールで修正する。

修正の優先度:
1. **高**: 存在しないパス・コマンドの記述（手順に従うと失敗する）
2. **中**: バージョン番号・設定値のズレ（古い情報で混乱を招く）
3. **低**: 説明文の細かな不整合（誤解を招かない程度のズレ）

修正時の注意:
- ドキュメントの「なぜ」（WHY）が記述されている場合は保持する
- トラブルシューティングセクションは追加しない（CLAUDE.md の制約）
- 既存の文体・フォーマットに合わせる

### Step 4: 報告

修正結果を以下の形式で報告する:

```
## ドキュメント更新完了

### 修正したファイル
- `docs/xxx.md` — 変更内容の概要

### 確認済み（変更なし）
- `README.md` — 問題なし

### 要確認（自動修正できなかった箇所）
- `docs/yyy.md` L42 — 手動での判断が必要な理由
```
