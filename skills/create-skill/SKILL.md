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

#### description と when_to_use の書き方

`description` と `when_to_use` の役割:

| フィールド | 役割 | 書き方 |
|---|---|---|
| `description` | スキルが何をするかの短い説明 | 1文で機能を簡潔に書く |
| `when_to_use` | いつ発火するかのトリガー条件 | ユーザーが発しそうな言葉・フレーズを列挙する |

`description` と `when_to_use` は合計1,536文字でモデルに渡される。スキルが多い環境では両方を短く保つことが重要。

**推奨パターン（通常スキル）**:
```yaml
description: 変更差分に対してコードレビューを実施する。
when_to_use: 「レビューして」「差分を見て」「PR前に確認して」「コードを見てほしい」と言われたとき。
```

**`disable-model-invocation: true` スキルの場合**: モデルが自動発火しないため `when_to_use` は不要。`description` だけユーザー向けの説明を書く。

- 曖昧・広範な `when_to_use` は誤発火の原因（例: 「コードを改善する」は何にでも該当）
- `description` にトリガーフレーズを書いてもモデルは参照するが、`when_to_use` に分離した方が精度が上がる

#### フロントマター設定の判断基準

| 状況 | 設定 |
|------|------|
| デプロイ、コミット、メッセージ送信など副作用がある | `disable-model-invocation: true` |
| ユーザーが直接呼ばない、Claudeの判断材料として使う | `user-invocable: false` |
| メインコンテキストを汚したくない重い処理 | `context: fork` + `agent: general-purpose` |

**`context: fork` の判断基準**: 「tool call の詳細を後で参照するか、結論だけ返せば十分か」を問う。探索・調査・レビューのように最終レポートだけ必要なら fork する。実装作業のようにメインコンテキストと状態を共有する必要があるなら fork しない。

#### モデル指定

`model` フロントマターでスキル実行時のモデルを上書きできる:

```yaml
model: haiku    # 軽量・高速・安価
model: sonnet   # バランス（デフォルト相当）
model: opus     # 高品質・推論力が必要な場合
```

指定なし（省略）の場合はメイン会話のモデルを継承する。

**使い分けの目安:**

| タスクの性質 | 推奨モデル |
|---|---|
| ファイル探索・grep・機械的な変換 | `haiku` |
| レビュー・分析・コード生成 | `sonnet` 以上 |
| アーキテクチャ判断・複雑な設計 | `opus` |

サブエージェント（teammate）を持つチーム系スキルでは、SKILL.md の `model` はコーディネーター自身に適用される。teammate 個別のモデルは teammate 定義ファイルのフロントマターで指定する。

#### プロンプトキャッシュの最適化

`context: fork` スキルをループから繰り返し呼ぶ場合、静的コンテンツをプロンプトの先頭に、変動コンテンツ（diff等）を末尾に配置するとキャッシュが効く。静的ドキュメントは `Read` ツールで読まずに `!cat` で埋め込む。詳細は `${CLAUDE_SKILL_DIR}/reference.md` を参照。

#### Gotchasセクション

スキル固有の落とし穴・注意点を末尾に書く。「同じ失敗を繰り返さない」ための知見蓄積が目的。
以下のテンプレートを参考にする:

```markdown
## Gotchas

- **[落とし穴の名前]**: 具体的な症状と対処法
- **[別の落とし穴]**: ...
```

内容がなければ省略してよい。あとから追記することを想定した設計にする。

### Step 4: 検証

作成したSKILL.mdが以下を満たすか確認する:

- フロントマターに `name`, `description` があるか
- 通常スキルはトリガーフレーズを `when_to_use` に分離しているか（`description` は短い機能説明のみ）
- `disable-model-invocation: true` スキルは `when_to_use` 不要
- 500行以内か
- 副作用がある操作に `disable-model-invocation: true` が設定されているか
- `allowed-tools` が必要最小限か（`Bash(*)` は広すぎる。`Bash(コマンド名 *)` で限定する）

---

## Gotchas

- **descriptionをユーザー向けの説明にしてしまう**: 通常スキル（model-invocable）の `description` はモデルのトリガー判断に使われる。「何をするスキルか」ではなく「いつ発火すべきか」を書く。`disable-model-invocation: true` のスキルのみ例外。
- **Bash(*)を使う**: `allowed-tools` に `Bash(*)` を書くとすべてのシェルコマンドが許可される。`Bash(jj *)`, `Bash(gh pr *)` のようにコマンドを限定すること。
- **Gotchasセクションを省く**: 知見が蓄積されないと同じ失敗を繰り返す。スキル作成後に気づいた注意点は即座に追記する習慣をつける。
- **500行を超える**: 読み込みコストが上がる。ドメイン知識やデータ定義は L3 ファイルに分離し、SKILL.md はオーケストレーターに徹する。
