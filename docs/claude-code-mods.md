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
- **forkはモデルを選べない。そのかわり、会話の全部をキャッシュから読む**: 入力は`prompt`だけ。メインが最後に送った要求（モデル、システムプロンプト、ツール、会話）をそのまま送り直すので、APIのキャッシュが効く（型定義の説明）。キャッシュはモデルごとなので、モデルを選ぶ入力が無い。Claude Code自身の次のプロンプトの案（prompt suggestion）も同じやり方で作られている（実行ファイルの`prompt_suggestion`の呼び出しで確認）。小さいモデルに聞きたいなら`$.model.complete`で、`$.session.messages()`から自分で会話を渡す。`model`、`effort`、`maxTokens`、`timeoutMs`を指定できるが、渡した分はキャッシュなしで読まれる。スキルの`context: fork`は名前が同じでも別物で、会話を引き継がない新しいサブエージェントにスキルの文を渡す（公式の文書）。だからモデルを選べる
- **会話の末尾だけを小さいモデルに渡した案は、それらしいだけで的を外す**: `mods/next-step`で、haikuに末尾の6発言を渡して「次に送るとよい指示」を聞いたところ、的を射た案が出なかった。会話の全部を読ませて「利用者が打とうとしている文を当てる」と頼む形（fork）に戻した。forkを最初に試したときに遅く感じたのは、4つの案を説明つきのJSONで書かせていたからだと見ている（未計測）
- **`prompt.suggest`のhookで、Claude Code自身の案を受け取れる**: `e.origin.kind === 'suggestion'`がエンジンの案で、`e.text`がその文。`next(e)`を返せば入力欄の薄い表示は残る。エンジンは、次の一手がはっきりしないターンやエラーの後には案を出さないので、このhookも来ない。`mods/next-step`は、これを札を出すきっかけにしている。hookの中から`void`で`$.model.fork`を投げて、返事で`$.state`を書き換える形も動く（2026-10-10に実機で確認）
  <!-- importance: medium | mentions: 1 | first-seen: 2026-10 -->
- **`turn.complete`でforkしても、直前の答えは会話に入っていない**: forkが使うのは「最後に送った要求」で、その要求への返事である最後の答えは含まれない（型定義のforkの説明）。`e.answer`を依頼の文に入れて渡す
- **`turn.complete`のhookは、モデルの返事を待たずに戻ってよい**: `void think($, ...)`で投げておけば、hookが戻った後も問い合わせは走り切り、返事で`$.state`を書き換えると帯が描き直される（v2.1.295、2026-10-10に`mods/next-step`のforkで確認）。待つと、返事が来るまでの数秒、ターンが終わらない
- **`Button`に`hotkey`を付けると、エンジンが札の前に「1: 」とキーを描く**: 自分でも番号を書くと「1: 1 …」と二重になる（`AbovePrompt`の帯で確認）
- **`turn.complete`はサブエージェントのターンでも来る**: `e.agentId`があればサブエージェント。`turn.start`は、サブエージェントの実行では来ない
- **会話を引き継いだエージェントを立てて、続けてやりとりできる**: `$.agent.spawn({ prompt, description, subagentType: 'fork' })`は、メインの会話とモデルを引き継いだフォークを立てて`{ model, agentId }`を返す。答えは、その`agentId`が付いた`turn.complete`の`e.answer`で届く。答え終わった後も`$.session.send({ to: { agentId }, text })`で続きを送ると、前のやりとりを覚えたまま答える。フォークはツールを使える。メインのターンの最中でも、paneの`Input`の`onSubmit`から立てることも送ることもできる。途中で立てたフォークは、進行中のターンのそこまでを見ている（v2.1.296、2026-10-11にスクラッチパッドの試作で確認。モデルはHaiku）
  <!-- importance: high | mentions: 1 | first-seen: 2026-10 -->
- **立てたフォークのツールは、`tool.call`のhookで絞れる**: フォークはメインと同じツールと権限で動くので、そのままだとファイルを書ける。`tool.call`の入力にはそのループの`e.agentId`が付く（メインでは無い）。自分が立てた`agentId`を覚えておき、その呼び出しのうち通したくないツールに`{ deny: 理由 }`を返すと、フォークは理由を読んで「拒否された」と答える。`Write`と`Bash`を止めて`Read`だけ通す形で確認した（v2.1.296、2026-10-11に同じ試作で確認）
  <!-- importance: high | mentions: 1 | first-seen: 2026-10 -->
- **複数のModが、同じ場所の描画を重ねて包める。ただし幅は下へ渡せない**: `ui.render`のhookは`await next(e)`で下の層の木を受け取り、包んで返せる。`PromptHint`で、status-bandの帯を受け取った試作のMod2つが、`<Box flexDirection="row">{inner}<Button/></Box>`で右にボタンを足すと、帯と同じ行の右端に積まれた。帯の箱は、足した分だけ縮んだ（200桁と100桁で確認）。次の2つは拒否される。`next({ ...e, viewport: 狭めた幅 })`は`next() passed an argument with a changed viewport (the envelope is the engine's; a rewrite keeps surface, component, requestId, viewport)`で例外になる。受け取った木を`width`を付けた`Box`の下に置くと、`ui.render (PromptHint) refused: engine node under a Box with prop "width"; the engine drew its own`と会話に出て、重ねたhookの全部が捨てられ、エンジンの元の表示だけになる（status-bandの帯も消える）。積む順は読み込みの順で、`--plugin-dir`で先に渡したModがいちばん外（右端）、入れてあるModがその内側だった。入れてあるModどうしは、`settings.json`の`enabledPlugins`に先に書いたほうが外側になる。`claude plugin install`は末尾に足すので、入れたばかりのModはいちばん内側になる。`refs`が`status-band`より後ろにあると、札は帯の右でなく、帯の下の3行目に出た。`refs`を前に書き直すと、帯の行の右端に出た。札を足すModどうしも同じで、`pending`、`refs`、`status-band`の順に書くと、帯の右に`refs  pending`と並ぶ。型定義の段（tier）は、管理者が配るModと利用者が入れたModを分けるもので、利用者が入れたModどうしの順は決めない（v2.1.296、2026-10-11にスクラッチパッドの試作と`mods/refs`で確認）
  <!-- importance: medium | mentions: 1 | first-seen: 2026-10 -->
- **立てたエージェントとの会話は、エンジンの画面に任せられる。paneに作り直さない**: 画面の下の並び（エージェントが動いているあいだ出る。下矢印で選んでEnter）か`/tasks`の一覧からエージェントを選ぶと、その会話が通常のセッションと同じ表示で開く。入力欄が`Message @fork…`になり、打った文がそのエージェントに届く。richの`show`も会話の行に描かれる。開いているあいだ、Modのpaneは横に残り、paneの`e.props.view.agentId`に、開いているエージェントのIDが入る（メインを開いていれば無い）。どの会話を開くかは利用者が切り替えるもので、Modからは切り替えられない（型定義に「The person's to switch, the plugin's to read」）。`mods/pending`は最初、paneに入力欄と答えの描画を自作したが、この画面に置き換えた（v2.1.296、2026-10-11に実機で確認）
  <!-- importance: high | mentions: 1 | first-seen: 2026-10 -->
- **Modのモジュール変数は、セッションを裏に回して戻すと消える**: 入力欄で左矢印を押すとセッションの一覧（`← for agents`）に移り、Escで戻ると、paneが消え、モジュール変数が初期値に戻っていた。覚えていたエージェントのIDが消えて、終了の知らせの遮断が効かず、メインが1ターン動いた。消えて困る値は`$.store`に持つか、エンジンから読み直せる形にする。`mods/pending`は、相談用のエージェントかどうかを`$.agent.list()`の説明の文で判定し、開いている相談は`$.store`に持つ（v2.1.296、2026-10-11に実機で確認）
  <!-- importance: high | mentions: 1 | first-seen: 2026-10 -->
- **描くhookの中では、状態を書けない**: `ui.render`のhookの中で`update($, atom, …)`を呼ぶと、`state.set: denied: it was made while ui.render is being dispatched, and drawing is pure`で、そのhookが飛ばされる。描くときに`$.store`から読み直す必要があれば、読むだけにして、書き戻すのはボタンやほかのイベントの処理に置く（`claude plugin test`で確認、v2.1.296）
  <!-- importance: medium | mentions: 1 | first-seen: 2026-10 -->
- **部品の`onPress`や`onSubmit`の中から立てたエージェントには、そのMod自身のhookが呼ばれない**: `Button`の`onPress`から`$.agent.spawn`したフォークのツールの呼び出しには、同じModの`tool.call`、`tool.check`、`agent.spawn`のhookが1度も呼ばれず、絞り込みが効かなかった（フォークの`touch`が通った）。`turn.complete`と終了の知らせの`prompt.submit`は届く。同じ処理を`on('ui.press', { plugin, component: 'Pane' }, ...)`のhookの中へ移すと、hookが呼ばれて拒否できた。`command.run`のhookから立てたときも呼ばれる。エージェントへの`$.session.send`も、`ui.input`のhookの中から送る形にしている。ボタンの動きがそのModのほかのhookに掛かるなら、`onPress`は空にして`ui.press`のhookに書く（v2.1.296、2026-10-11に`mods/pending`（当時は`mods/status-band`の中）の相談のpaneで確認）
  <!-- importance: high | mentions: 1 | first-seen: 2026-10 -->
- **`claude plugin test`の土台は、`agent.spawn`の答えの`agentId`を捨てる**: テストで`on('agent.spawn', ...)`が`{ model, agentId }`を返しても、Modが受け取るのは`{ model: 'inherit' }`になる（型定義に「agentIdはcoreが入れる」とある）。`on('agent.spawn')`を登録しないと`no implementation for agent.spawn`で失敗する。`mods/pending`は、IDが無いときに`$.agent.list()`から説明の一致するエージェントを探す道を持ち、テストは`on('agent.list', ...)`でIDを答えている。`$.tool.call`にも`agentId`は渡せないので、サブエージェントのツールを絞るhookは、判定を関数に出して試す
  <!-- importance: medium | mentions: 1 | first-seen: 2026-10 -->
- **動いている最中のエージェントに`$.session.send`した文は、そのターンの中で読まれる**: エージェントには「The coordinator sent a message while you were working: …」として届き、1回の`turn.complete`にまとめて答える。`Input`は送ると空になるので、待ち中の送信を断ると打った文が消える。断らずに送る（同じ確認）
  <!-- importance: medium | mentions: 1 | first-seen: 2026-10 -->
- **`tool.check`のエンジンの判定は「読むだけ」の判定ではない**: `tool.check`のhookで`await next(e)`すると、エンジンの判定`{ decision, rule?, reason? }`が読める。`e.agentId`も付く。autoモードで見た判定は次のとおり。設定の許可ルールに合うコマンド（`ls`、`rg`、`cat`）は`allow`で`rule`にそのルールが入る。`rg x > out.txt`と`ls && touch x`は、許可ルールに合う部分があっても`ask`になる（リダイレクトと、つないだ先の書き込みをエンジンが見分ける）。許可ルールに無いコマンドは、`pwd`や`echo hi`でも`ask`になる。`sed -i.bak …`は`Bash(sed:*)`のルールで`allow`になる。`allow`は「利用者が確認なしで通すと決めた」という意味で、ファイルを書き換えるコマンドも含む。読み取り専用に絞るなら、自分で読むコマンドの一覧を持ち、エンジンの`allow`は「リダイレクトが無い」ことの確認に使う（v2.1.296、2026-10-11に同じ試作で確認）
  <!-- importance: medium | mentions: 1 | first-seen: 2026-10 -->
- **Modが立てたエージェントが終わると、メインに知らせが届いてメインが1ターン動く**: `prompt.submit`に`origin.kind === 'task-notification'`で来る。文は`<task-notification><task-id>エージェントのID</task-id><tool-use-id>toolu_plugin_…`で始まる。メインが動いている最中は、ターンが終わるまで待たされてから届く。`prompt.submit`のhookが`next`を呼ばずに`{ drop: 理由 }`を返すと、メインは動かない。ただし会話の行に「Prompt dropped by a hook: 理由」が1行出る。バックグラウンドのシェルが終わった知らせも同じ出どころなので、止めるのは`task-id`が自分の立てたエージェントのものだけにする。観察では、知らせが届いたのは`session.send`で続きを送った後の答えのときだけで、最初の答えの後は4〜11秒待っても届かなかった（理由は調べていない。同じ試作で確認）
  <!-- importance: high | mentions: 1 | first-seen: 2026-10 -->

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
