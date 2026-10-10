# Claude Code Mods の作り方で分かったこと

> **TL;DR**: 作る前に`plugin-authoring`スキルを読み込む。`$`を渡す関数はファイルの先頭の階層に置く。`Raster`に日本語は置けないので`Text`を重ねる。`Image`はtmuxの中で出ない。キーボードを受け取れるのはpaneと帯だけ。型検査が通っても読み込みで弾かれるので、`claude plugin validate`と`claude plugin test`を毎回流す。

Mods（`plugins/mods`）は早期アクセスで、型定義の冒頭に「予告なく変わる」とある。ここに書いたのは、v2.1.295で`mods/human-edit`と`mods/rich`を作ったときに確かめたことだ（2026-10-09）。版が上がったら、型定義（`<mod>/.claude-plugin/types/claude-code/index.d.ts`）で確かめ直す。

## 読み込みと設定

- **dotclaudeのModは、フォルダのマーケットプレイスから入れている**: リポジトリ直下の`.claude-plugin/marketplace.json`が一覧で、`settings.json`の`extraKnownMarketplaces`と`enabledPlugins`に登録がある。マーケットプレイスがフォルダで`source`が相対パスなら、コピーではなくフォルダから直接読まれる（`claude plugin list`の`Read from:`で確認）。編集は`/reload-plugins`で反映する。Modを足す手順は`mods/README.md`
- `settings.json`の`env.CLAUDE_CODE_PLUGIN_DIRS`に絶対パスを書いても読み込める。複数は`:`で区切る（バイナリが`path.delimiter`で分けている）。親のフォルダを書いて中身をまとめて読ませることはできない。こちらは保存のたびに自動で読み込み直される。変更は再起動するまで効かない。マーケットプレイスから入れたModと同時に指定すると二重になる
- `plugin-authoring`スキルを読み込むと、`~/.claude/dev-mods/<セッションID>/`が監視され、そこに書いたModは番の終わりに読み込み直される。利用者が一度だけ許可を聞かれる
- 読み込まれたModのディレクトリには、エンジンが`tsconfig.json`と`.claude-plugin/types/`を書き出す。`types/`は中の`.gitignore`で追跡対象外になる。`tsconfig.json`はコミットしてよい
- 一度も読み込んでいないModを型検査するときは、別の場所に`tsconfig.json`を置き、読み込み済みのModの`.claude-plugin/types`を`typeRoots`に指す
- スキルの名前とModのスラッシュコマンドの名前が同じだと、スキルが優先されてModのコマンドを呼べない。Modのコマンドは別の名前にする（`/rich`と重なり、`/rich-pane`に変えた）
  <!-- importance: medium | mentions: 1 | first-seen: 2026-10 -->

## 型検査は通るのに、読み込みで弾かれるもの

- **`$`を渡す先の関数は、ファイルの先頭の階層に宣言する**: `register`の中に`const draw = ($, ...) => ...`を置くと、`$ is passed to "draw", which is not a function declared at the top of this file`で読み込みに失敗する。`tsc`は通る
  <!-- importance: high | mentions: 1 | first-seen: 2026-10 -->
- **`Uint8Array.prototype.toBase64`は型に無い**: 型定義の例は使っているが、同じ型定義が指定する`lib: es2023`には宣言が無い。base64への変換は自前で書く
- **状態の操作に答えるhookは`{ value }`を返す**: テストで`ui.open`に答えるなら`{ value: { isPlaced: true } }`。`{ isPlaced: true }`を直接返すと無視される
- **plugin toolの`result`は文字列かcontent blockの配列だけ**: オブジェクトを返すなら`JSON.stringify`する
- **同じイベントは、matcher無しで2回登録できない**: `on("tool.call") is registered twice without a matcher`で読み込みに失敗する。2つ目は`on('tool.call', { tool: 'Bash' }, ...)`のようにmatcherを付ける。matcherは文字列でなくオブジェクトで書く
- **`Button`の中に`Box`は置けない**: `holds strings and Text, not <Box>`で、その描画のhookが丸ごと飛ばされる。行全体を押せるようにはできないので、行の中の1つの`Text`をボタンにする
- **別のModのファイルは`import`できない**: `cannot import "../../rich/hooks/layout" (from hooks/cursor.ts): it is outside the plugin's folder`で、`claude plugin validate`も`claude plugin test`も失敗する（v2.1.295、2026-10-10に確認）。`$.ui.open`で開けるpaneも自分のModのものだけなので、Modどうしで部品は共有できない。別のModの描画を使いたいときは、Claudeにそのツールを呼ばせる
  <!-- importance: medium | mentions: 1 | first-seen: 2026-10 -->
- **`$.env.get`の名前は、文字列をその場に書く**: 定数で渡すと`$.env.get takes a literal name as its first argument, so the variables a module reads and writes can be listed`で読み込みに失敗する。`tsc`は通る
- **`$.ui.open`の`focus`は`true`しか書けない**: フォーカスを移さないときは、項目ごと省く
- **テストで共有する土台は、`.test`の付かないファイルに置ける**: `tests/world.tsx`のような名前なら、`claude plugin test`はテストとして拾わず、各テストから`import`できる（`mods/status-band`で確認）

## Claudeに文脈を渡す

- **セッションの始めに説明を渡すなら`classic.SessionStart`**: `const result = await next(e)`の後に、`{ ...result, additionalContext: [...(result.additionalContext ?? []), text] }`を返す。ほかのhookが足した分を消さないよう、後ろへ足す。起動、再開、fork、`/clear`、compactのたびに来る（`e.source`）。サブエージェントから来たときは`e.agent_id`があるので、渡さないなら見分ける。claude-deckのModと`mods/status-band`が使っている
  <!-- importance: high | mentions: 1 | first-seen: 2026-10 -->
- **利用者の画面を変えるModは、その説明もClaudeに渡す**: 帯やボタンを足しても、新しいセッションのClaudeはそれを知らない。画面に出ているもの、操作がClaudeにどう届くか、Modが送る文の意味を、Mod自身に持たせて渡す。説明をModの隣に置けば、Modを外したマシンでは説明も消える

## モデルに聞く

- **hookからモデルを呼べる**: `$.model.fork({ prompt })`は、メインが最後に送った要求（モデル、システムプロンプト、会話）の後ろに`prompt`を足して1回だけ答えさせる。ツールは使えず、依頼と返事は会話に残らない。`$.model.complete({ model, prompt })`は、会話を持たない単発の呼び出しで、モデルを選べる。どちらも失敗で例外を投げず、`isAnswered`と`reason`で分かれる（forkは`mods/next-step`の最初の版で動かして確認。completeは同じModのいまの版が使っているが、実機での確認はまだ。「hookは自分では考えられない」と誤って答えたことがある）
  <!-- importance: high | mentions: 1 | first-seen: 2026-10 -->
- **forkはモデルを選べず、遅い**: 入力は`prompt`だけで、メインのモデルに会話の全文を読ませる。ターンのたびに呼ぶ用途では、返事が来るまでの待ち時間が目立った（`mods/next-step`で利用者が確認、秒数は未計測）。速さが要るなら、`$.session.messages()`で読んだ会話の末尾だけを`$.model.complete`で小さいモデルに渡す。`model`、`effort`、`maxTokens`、`timeoutMs`を指定できる。サブエージェントのforkも同じで、`model`は無視されて親と同じになる（型定義の`AgentSpawnInput.model`）
  <!-- importance: medium | mentions: 1 | first-seen: 2026-10 -->
- **`turn.complete`でforkしても、直前の答えは会話に入っていない**: forkが使うのは「最後に送った要求」で、その要求への返事である最後の答えは含まれない（型定義のforkの説明）。`e.answer`を依頼の文に入れて渡す
- **`turn.complete`のhookは、モデルの返事を待たずに戻ってよい**: `void think($, ...)`で投げておけば、hookが戻った後も問い合わせは走り切り、返事で`$.state`を書き換えると帯が描き直される（v2.1.295、2026-10-10に`mods/next-step`のforkで確認）。待つと、返事が来るまでの数秒、ターンが終わらない
- **`Button`に`hotkey`を付けると、エンジンが札の前に「1: 」とキーを描く**: 自分でも番号を書くと「1: 1 …」と二重になる（`AbovePrompt`の帯で確認）
- **`turn.complete`はサブエージェントのターンでも来る**: `e.agentId`があればサブエージェント。`turn.start`は、サブエージェントの実行では来ない

## ツールの呼び出し（`tool.call`）

- **入力は平ら**: Bashのコマンドは`e.command`で読む。`e.input`は無い
- **結果は`const ran = await next(e)`の`ran.result`**: 型は`{} | null`で、項目は見えない。形を確かめてから読む。Bashなら`stdout`、`stderr`、`gitOperation`などが入る
- **Bashの結果の`gitOperation`で、gitとPRの操作が分かる**: Claude Codeがコマンドの文字列を見て分類し、`commit`（`sha`、`kind`、`branch`）、`push`、`pr`（`number`、`url`、`action`）を入れる。`gh pr create`は`action: 'created'`、`gh pr edit`は`edited`になる。出力からURLを探す処理を自分で書かなくて済む（`mods/status-band`がPRの一覧に使っている）。操作が無いコマンドでは`undefined`
  <!-- importance: high | mentions: 1 | first-seen: 2026-10 -->
- **手元のセッションでは、GitHubのイベントを受け取れない**: `session.receive`のhookと`subscribe_pr_activity`ツールは型定義とバイナリにあるが、ツールはRemote Controlをつないでも一覧に出ない。`/autofix-pr`はクラウドに別のセッションを起こし、Webhookはそちらに届く。引数は指示文として使われ、PRは「いまのgitのブランチ」から探すので、jjの作業コピーでは`not on any branch`で止まる（v2.1.295のバイナリと実行結果で確認）。PRの状態は`gh`で取りに行くしかない
  <!-- importance: medium | mentions: 1 | first-seen: 2026-10 -->
- **複数のPRの状態は、`gh api graphql`の1回で取る**: `gh pr view`は1個ずつしか見られない。`r0: repository(owner:, name:) { p3: pullRequest(number: 3) { ... } }`のように別名を付けて並べれば、リポジトリをまたいで1回で取れる。CIは`commits(last: 1) { nodes { commit { statusCheckRollup { state } } } }`でまとめた値が返り、チェックが無ければ`null`
- **`gitOperation`が見るのは`git <動詞>`と`gh pr <動詞>`の形だけ**: `jj git push`は`push`にならず、`gh api`で作ったPRは`pr`にならない。`gh pr close`の結果には`url`が無く、`number`だけが入る（バイナリの正規表現と、実際のPRで確認）

## 描画

- **描ける場所は6つ**: pane（横置きか上置き。どちらになるかは画面の側が決める）、プロンプトの上の帯（`AbovePrompt`）、プロンプトの下の行（`PromptHint`）、会話の中の行（`CommandOutput`か`ToolUse`を自分の木で置き換える）、既存の行の差し替え、toastとstatus。画面全体を覆う表示は無い
- **プロンプトの下にも、色とボタン付きの木を描ける**: `PromptHint`は`manual mode on`や`esc to interrupt`が出る行で、自分の木を返せる。元の表示は`const original = await next(e)`で取れるので、`<Box flexDirection="column">{自分の行}{original}</Box>`のように並べれば消さずに済む。`$.ui.status(text)`は色もボタンも無い文字だけなので、混同しない（「下には文字しか出せない」と誤って答えたことがある）
  <!-- importance: medium | mentions: 1 | first-seen: 2026-10 -->
- **モデルが開くpaneは、幅が足りないと描かれない**: 利用者の操作を受けない`$.ui.open`は、144桁（一度開いた後は110桁）より狭いと`isPlaced: false`で待たされる。利用者が打ったコマンドから開けば幅に関係なく出る。開き直すコマンドを用意しておく
- **`Raster`には幅1の文字しか置けない**: 日本語のラベルは置けない。枠と線を`Raster`に描き、同じ親の中に`<Box position="absolute" top left>`で`Text`を重ねる。全角は2桁として位置を計算する
  <!-- importance: high | mentions: 1 | first-seen: 2026-10 -->
- **`Image`はtmuxの中で出ない**: Claude Codeは環境変数`TMUX`か`STY`があると、問い合わせずに「絵は描けない」と決める（バイナリの判定関数で確認）。`alt`の文字が出る。`CLAUDE_CODE_FORCE_TERMINAL_IMAGES=1`で強制すると、場所だけ確保されて中身が出ない。tmuxの`allow-passthrough`は関係が無い。tmuxの外のGhostty 1.3.1では、PNGが絵として出ることを確かめた
  <!-- importance: high | mentions: 1 | first-seen: 2026-10 -->
- **`Svg`はターミナルに無い**: デスクトップアプリ、VS Code、モバイルの表だけにある
- **セッションの状態（`$.state`）は開き直すと消えうる**: 会話の行は、記録に残る`ToolUse`の`props.input`から描く。そうすれば開き直しても同じ行を描ける（`rich`で確認済み）。ただし`$.state`に入れていた値は消える。「送信済み」を`$.state`に持つと、開き直した後に過去の行のボタンがもう一度押せる状態に戻り、答え済みの質問を送り直せてしまう（`rich`で起きた）。押されたくないものは`$.store`に残す。`$.store`は描画の途中でも読める。書き込みで描き直しは起きないので、書いた後に`$.state`の値を更新して描き直させる
  <!-- importance: high | mentions: 1 | first-seen: 2026-10 -->
- **「済んだもの」だけを`$.store`に残さない。「まだのもの」も残す**: 済んだ記録だけだと、記録に無いものを「まだ」と見なすことになり、上限を超えて消えた古いものが、また未処理に戻る。両方を残し、どちらにも無いものは閉じたものとして扱う。件数には上限を付けて、古いものから消す（`rich`は未回答30件、答え50件）

## 操作

- **キーボードを受け取れるのはpaneと帯だけ**: `ui.focus`の対象がこの2つしか無い。会話の行に置いた`Select`には矢印キーが届かない。会話の行では、クリックで押せる`Button`を並べる
  <!-- importance: high | mentions: 1 | first-seen: 2026-10 -->
- **ボタンから pane を開くなら、ボタンと pane を同じModに置く**: `$.ui.open`が開けるのは自分のModの pane だけ。別のModの pane を開くには、そのModのスラッシュコマンドを`$.command.run`で実行することになり、ターンの途中に押すとターンが終わるまで開かない（PRの一覧を別のModに分けたときに起きて、`status-band`に取り込んだ）。コマンドの登録に`immediate: true`を付けて`/reload-plugins`した後も、利用者の確認では直らなかった。`command.register`を`session.start`で呼んでいたので、読み込み直しでは登録が更新されなかった可能性があり、原因は切り分けていない
  <!-- importance: high | mentions: 1 | first-seen: 2026-10 -->
- **`Button`の`hotkey`に書けるのは、数字1つか小文字1つだけ**: 大文字、`Enter`、矢印は書けない。Shiftを押しても小文字と同じ扱いになるので（型定義に「Shift+w is `"w"`」）、`y`と`Y`を別の操作にはできない。押されたときに渡る値にも、Shiftの有無は入っていない
- **一覧をキーで選ぶ仕組みは、`Client`が無くても作れる**: `j`と`k`をhotkeyに持つボタンを置き、押されたら「何行目を選んでいるか」を`$.state`に書いて描き直す。1回押すたびにhookを往復するが、数十行の一覧なら足りる。`Client`ならキーを自分で受けられてShiftも区別できるが、キーが届くのはその部分をクリックした後だけなので、キーボードで使う一覧には向かない（`mods/status-band`のPRと参照のpane）
  <!-- importance: medium | mentions: 1 | first-seen: 2026-10 -->
- **paneの下にキーのヒントを残すなら、一覧を収まる分だけ描く**: paneは、描いた木が見えている行数より長いと、全体が流れる。下に置いたボタンも一緒に流れて見えなくなる。下に固定する部品は無いので、`e.props.scroll.bodyRows`（見えている行数）から一覧に使える行数を出し、選んでいる行の前後だけを描く。はみ出した分は「あと N 件」と件数で示す。折り返す文は高さが読めないので、選んでいる行だけ全文を出し、ほかは1行に切る（`mods/status-band/hooks/cursor.ts`の`windowOf`）
  <!-- importance: medium | mentions: 1 | first-seen: 2026-10 -->
- **`Button`の`hotkey`は、置いた場所がキーボードを持っているあいだだけ効く**: paneをクリックするか`ctrl+x tab`でフォーカスを移してから押す
- **答えは`$.prompt.submit({ text, asUser: true })`でそのまま送れる**: 利用者が打って送ったのと同じ扱いで届く。`asUser`を付けないと「プラグインが送った」という枠が付く。番の途中で呼ぶと、番が終わるまで待たされる。入力欄に入れるだけなら`$.prompt.fill`
- **`$.prompt.submit`は、`tool.call`のhookから呼べない**: `called from a tool.call hook, it would wait on the turn this hook is holding; submit from a later event (turn.complete)`で拒まれる。送信はいまのターンが終わるのを待つので、ターンを止めている側から呼ぶと待ち合いになる。ツールの後に送りたい文は`$.state`に溜め、`turn.complete`のhookで送る。そこでも`await`せずに`void`で投げる（`mods/status-band`のマージの知らせで確認）。ボタンの`onPress`からは、その場で呼べる
  <!-- importance: high | mentions: 1 | first-seen: 2026-10 -->
- **`command.run`のhookからも`$.prompt.submit`は呼べない**: `tool.call`と同じ文で拒まれる（`called from a command.run hook, it would wait on the turn this hook is holding`）。`$.clock.after(0, ...)`を挟んでも同じだった（`claude plugin test`で確認、v2.1.295）。コマンドからClaudeに伝えたいことは、結果の`context`（Claudeだけが読む文。ターンは始めない）で返す。`context`は、利用者の次のプロンプトと一緒にClaudeに届く（`mods/devrep`の`/devrep on`で、2026-10-10に実機で確認）
  <!-- importance: medium | mentions: 1 | first-seen: 2026-10 -->
- **`prompt.submit`のhookが受け取る出どころは、`asUser`を付けても`{ kind: 'plugin', name, asUser: true }`**: テストで「利用者の文として送ったか」を見るなら、`e.origin.asUser`を読む
- **一定の間隔で動かすなら`$.clock.every(ms, fn)`**: 戻り値の`cancel()`で止める。1回だけなら`$.clock.after`。戻り値はJSONにできないので`$.state`には置けず、モジュールの変数に持つ。Modを読み込み直すと、エンジンが古いタイマーを止める。テストでは`on('clock.every', ...)`が1周期ごとに呼ばれるので、`Promise`を返しておき、テストの側でそれを解決して時間を進める（`mods/status-band/tests/world.tsx`の`tick()`）
- **同じhookの中で状態を読み直しても、書く前の値が返る**: 型定義に「1回のdispatchの`get`は、同じ時点を読む」とある。`update`した直後の値が要るなら、状態から読み直さずに、書いた値を関数の戻り値で受け渡す
- **書き込みは描画の外でする**: 描画中の`$.state.set`は拒否される。ボタンの`onPress`の中で`update($, atom, fn)`を使う。続けて処理するときは、描いた時点の値でなく`update`の戻り値を使う

## テスト（`claude plugin test`）

- `test(name, async ($, on) => ...)`の`on`は、`$`を最初に呼ぶ前に登録する。後から登録すると`on("...") after the test first called $`で失敗する
- テストの土台にはエンジンの描画が無い。hookが`next(e)`を返す経路を確かめるには、テストの側で`on('ui.render', ...)`に目印の木を返させる
- `prompt.submit`や`ui.open`のように外へ出る呼び出しも、テストの側で`on`を登録して答える。登録が無いと`no implementation for ...`になる
- `$.tool.call`の引数は平らに書く（`{ tool, title, blocks }`）。`{ tool, input: {...} }`ではない
- JSXを書くテストは`.test.tsx`にする

## tmuxと環境変数

- `tmux new-window`で起動したプロセスには、`tmux`を呼んだ側の環境変数は引き継がれない。tmuxサーバーの環境（`tmux set-environment -g`）か、`new-window -e`で渡す。claude-deckは`-e`で3つだけ渡している
