---
name: create-skill
description: Claude Codeのスキル（カスタムスラッシュコマンド）を新規作成する。スキルの雛形生成、SKILL.mdの作成時に使用する。
argument-hint: "[skill-name]"
disable-model-invocation: true
allowed-tools: Read, Write, Bash(mkdir *)
---

# スキル新規作成

`$ARGUMENTS` の名前でスキルを作成する。
配置先はユーザーに確認する（プロジェクト `.claude/skills/` またはユーザーグローバル `~/.claude/skills/`）。

## 手順

### Step 1: 要件の確認

ユーザーにスキルの目的・用途をヒアリングし、以下を決定する:

- スキル名（`$ARGUMENTS` があればそれを使用）
- description（具体的なキーワードと「いつ使うか」を含める）
- 呼び出し制御（副作用があれば `disable-model-invocation: true`）
- 配置先（プロジェクト or ユーザーグローバル）

### Step 2: スキルガイドの読み込み

プロジェクトにスキルガイドがあれば読み込む:

```
docs/skills.md
```

なければ `${CLAUDE_SKILL_DIR}/reference.md` をリファレンスとする。

### Step 3: SKILL.md作成

以下の設計指針に従って作成する。

#### Progressive Disclosure（3層ローディング）

コンテキストウィンドウは共有資源。SKILL.mdは500行以内に収め、詳細は別ファイルに分離する:

| 層 | 内容 | 読み込みタイミング | 目安 |
|---|------|-------------------|------|
| L1 | name + description | 常時 | ~100トークン |
| L2 | SKILL.md本文 | スキル呼び出し時 | <5,000トークン |
| L3 | スクリプト・リファレンス | SKILL.md内で参照された時 | 必要な分だけ |

#### SKILL.mdの役割分担

SKILL.mdはオーケストレーター（制御フロー）に徹する。ドメイン知識やデータ定義は別ファイルに分離する。
判断が必要な処理はClaude（エージェント）に、確定的な処理はスクリプトに委譲する。

#### Why-Driven記述

ルールの羅列（「必ずXXXすること」）よりも理由を書く。理由が分かれば未知のケースにも対応できる。

#### descriptionの書き方

- 具体的なキーワードを含める（ユーザーが使いそうな言葉）
- 「いつ使うか」を明示する
- 曖昧・広範な記述は避ける（誤発火の原因）

#### フロントマター設定の判断基準

| 状況 | 設定 |
|------|------|
| デプロイ、コミット、メッセージ送信など副作用がある | `disable-model-invocation: true` |
| ユーザーが直接呼ばない、Claudeの判断材料として使う | `user-invocable: false` |
| メインコンテキストを汚したくない重い処理 | `context: fork` + `agent: general-purpose` |

#### プロンプトキャッシュの最適化

`context: fork` スキルをループから繰り返し呼ぶ場合、静的コンテンツをプロンプトの先頭に、変動コンテンツ（diff等）を末尾に配置するとキャッシュが効く。静的ドキュメントは `Read` ツールで読まずに `!cat` で埋め込む。詳細は `${CLAUDE_SKILL_DIR}/reference.md` を参照。

### Step 4: 検証

作成したSKILL.mdが以下を満たすか確認する:

- フロントマターに `name`, `description` があるか
- `description` が具体的か（「〜する」「〜時に使用する」の形式）
- 500行以内か
- 副作用がある操作に `disable-model-invocation: true` が設定されているか
- `allowed-tools` が必要最小限か
