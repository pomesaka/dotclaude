---
name: playwright-cli
description: Automates browser interactions for web testing, form filling, screenshots, and data extraction. Use when the user needs to navigate websites, interact with web pages, fill forms, take screenshots, test web applications, or extract information from web pages.
allowed-tools: Bash(playwright-cli:*)
model: haiku
---

# Browser Automation with playwright-cli

## Quick start

```bash
# open new browser
playwright-cli open
# navigate to a page
playwright-cli goto https://playwright.dev
# interact with the page using refs from the snapshot
playwright-cli click e15
playwright-cli type "page.click"
playwright-cli press Enter
# take a screenshot (rarely used, as snapshot is more common)
playwright-cli screenshot
# close the browser
playwright-cli close
```

## Commands

### Core

```bash
playwright-cli open
# open and navigate right away
playwright-cli open https://example.com/
playwright-cli goto https://playwright.dev
playwright-cli type "search query"
playwright-cli click e3
playwright-cli dblclick e7
playwright-cli fill e5 "user@example.com"
playwright-cli drag e2 e8
playwright-cli hover e4
playwright-cli select e9 "option-value"
playwright-cli upload ./document.pdf
playwright-cli check e12
playwright-cli uncheck e12
playwright-cli snapshot
playwright-cli snapshot --filename=after-click.yaml
playwright-cli eval "document.title"
playwright-cli eval "el => el.textContent" e5
playwright-cli dialog-accept
playwright-cli dialog-accept "confirmation text"
playwright-cli dialog-dismiss
playwright-cli resize 1920 1080
playwright-cli close
```

### Navigation

```bash
playwright-cli go-back
playwright-cli go-forward
playwright-cli reload
```

### Keyboard

```bash
playwright-cli press Enter
playwright-cli press ArrowDown
playwright-cli keydown Shift
playwright-cli keyup Shift
```

### Mouse

```bash
playwright-cli mousemove 150 300
playwright-cli mousedown
playwright-cli mousedown right
playwright-cli mouseup
playwright-cli mouseup right
playwright-cli mousewheel 0 100
```

### Save as

```bash
playwright-cli screenshot
playwright-cli screenshot e5
playwright-cli screenshot --filename=page.png
playwright-cli pdf --filename=page.pdf
```

### Tabs

```bash
playwright-cli tab-list
playwright-cli tab-new
playwright-cli tab-new https://example.com/page
playwright-cli tab-close
playwright-cli tab-close 2
playwright-cli tab-select 0
```

### Storage

```bash
playwright-cli state-save
playwright-cli state-save auth.json
playwright-cli state-load auth.json

# Cookies
playwright-cli cookie-list
playwright-cli cookie-list --domain=example.com
playwright-cli cookie-get session_id
playwright-cli cookie-set session_id abc123
playwright-cli cookie-set session_id abc123 --domain=example.com --httpOnly --secure
playwright-cli cookie-delete session_id
playwright-cli cookie-clear

# LocalStorage
playwright-cli localstorage-list
playwright-cli localstorage-get theme
playwright-cli localstorage-set theme dark
playwright-cli localstorage-delete theme
playwright-cli localstorage-clear

# SessionStorage
playwright-cli sessionstorage-list
playwright-cli sessionstorage-get step
playwright-cli sessionstorage-set step 3
playwright-cli sessionstorage-delete step
playwright-cli sessionstorage-clear
```

### Network

```bash
playwright-cli route "**/*.jpg" --status=404
playwright-cli route "https://api.example.com/**" --body='{"mock": true}'
playwright-cli route-list
playwright-cli unroute "**/*.jpg"
playwright-cli unroute
```

### DevTools

```bash
playwright-cli console
playwright-cli console warning
playwright-cli network
playwright-cli run-code "async page => await page.context().grantPermissions(['geolocation'])"
playwright-cli tracing-start
playwright-cli tracing-stop
playwright-cli video-start
playwright-cli video-stop video.webm
```

## Open parameters
```bash
# Use specific browser when creating session
playwright-cli open --browser=chrome
playwright-cli open --browser=firefox
playwright-cli open --browser=webkit
playwright-cli open --browser=msedge
# Connect to browser via extension
playwright-cli open --extension

# Use persistent profile (by default profile is in-memory)
playwright-cli open --persistent
# Use persistent profile with custom directory
playwright-cli open --profile=/path/to/profile

# Start with config file
playwright-cli open --config=my-config.json

# Close the browser
playwright-cli close
# Delete user data for the default session
playwright-cli delete-data
```

## Snapshots

After each command, playwright-cli provides a snapshot of the current browser state.

```bash
> playwright-cli goto https://example.com
### Page
- Page URL: https://example.com/
- Page Title: Example Domain
### Snapshot
[Snapshot](.playwright-cli/page-2026-02-14T19-22-42-679Z.yml)
```

You can also take a snapshot on demand using `playwright-cli snapshot` command.

If `--filename` is not provided, a new snapshot file is created with a timestamp. Default to automatic file naming, use `--filename=` when artifact is a part of the workflow result.

## Browser Sessions

```bash
# create new browser session named "mysession" with persistent profile
playwright-cli -s=mysession open example.com --persistent
# same with manually specified profile directory (use when requested explicitly)
playwright-cli -s=mysession open example.com --profile=/path/to/profile
playwright-cli -s=mysession click e6
playwright-cli -s=mysession close  # stop a named browser
playwright-cli -s=mysession delete-data  # delete user data for persistent session

playwright-cli list
# Close all browsers
playwright-cli close-all
# Forcefully kill all browser processes
playwright-cli kill-all
```

## Local installation

In some cases user might want to install playwright-cli locally. If running globally available `playwright-cli` binary fails, use `npx playwright-cli` to run the commands. For example:

```bash
npx playwright-cli open https://example.com
npx playwright-cli click e1
```

## Example: Form submission

```bash
playwright-cli open https://example.com/form
playwright-cli snapshot

playwright-cli fill e1 "user@example.com"
playwright-cli fill e2 "password123"
playwright-cli click e3
playwright-cli snapshot
playwright-cli close
```

## Example: Multi-tab workflow

```bash
playwright-cli open https://example.com
playwright-cli tab-new https://example.com/other
playwright-cli tab-list
playwright-cli tab-select 0
playwright-cli snapshot
playwright-cli close
```

## Example: Debugging with DevTools

```bash
playwright-cli open https://example.com
playwright-cli click e4
playwright-cli fill e7 "test"
playwright-cli console
playwright-cli network
playwright-cli close
```

```bash
playwright-cli open https://example.com
playwright-cli tracing-start
playwright-cli click e4
playwright-cli fill e7 "test"
playwright-cli tracing-stop
playwright-cli close
```

## Gotchas

- **アクセシビリティ検証は `snapshot` の ARIA ツリーで足り、足りないときは `run-code` + CDP を使う（`page.accessibility.snapshot()` は現行 playwright に存在しない）**: `playwright-cli snapshot` が出す YAML は role と accessible name を持つので、「ボタンの名前が行ごとに区別できるか」「live region が `status` / `alert` として出ているか」はこれだけで確認できる。ツリーから落ちている要素（`ignored` 扱いか、単に名前が無いのか）まで見たいときは `playwright-cli run-code "async page => { const s = await page.context().newCDPSession(page); await s.send('Accessibility.enable'); return (await s.send('Accessibility.getFullAXTree')).nodes; }"` を使う。`page.accessibility.snapshot()` は削除済みで `TypeError: Cannot read properties of undefined` になるので呼ばない。出力は巨大なので `rg '"role"|"name"' <保存先>` で絞る（**`rg -v '^\s*[]{}[]'` のような否定フィルタは文字クラスが閉じずに regex parse error になる**。残したい行を正のパターンで指定する）。
  <!-- importance: medium | mentions: 1 | first-seen: 2026-09 -->

- **`--filename=` スナップショットはカレントディレクトリに保存される**: `playwright-cli snapshot --filename=iter01.yaml` はそのまま CWD に保存される。リポジトリ内のディレクトリで実行すると jj/git に追跡され PR に混入する。必ず `~/.claude/tmp/` などの絶対パスを指定すること。例: `playwright-cli screenshot --filename=/Users/username/.claude/tmp/snap.png`
  <!-- importance: high | mentions: 1 | first-seen: 2026-05 -->

- **セッション全体の `.playwright-cli/` ディレクトリもリポジトリ内に生成される。`.gitignore` に追加する**: `playwright-cli open` を起動すると CWD に `.playwright-cli/` ディレクトリが生成されてコンソールログ・ページスナップショットが蓄積される。`--filename=` で個別ファイルを外に出しても、セッション記録ファイル（`console-*.log`・`page-*.yml`）は常に `.playwright-cli/` に残る。リポジトリで playwright-cli を使う前に `.gitignore` に `.playwright-cli/` が含まれているか確認し、なければ追加する。既に snapshot が working copy に入った場合は `jj file untrack ".playwright-cli/*"` で除外する（`.gitignore` 更新だけでは追跡済みファイルは消えない）。
  <!-- importance: high | mentions: 2 | first-seen: 2026-06 -->

- **`default` セッションはマシン上の全 Claude セッションで共有される。検証では必ず `-s=<名前>` を付ける**: 別セッションが同じ `default` ブラウザで `goto` すると、自分の操作の途中で URL が別ポート（別ワークスペースの dev サーバー）に変わり、「自分の変更が効いていない」ように見える。対処: `playwright-cli -s=<workspace名> open ...` で始め、以降のコマンドにも毎回 `-s=` を付ける。症状が出たら `playwright-cli -s=<名前> eval "location.href"` でまず URL を確認する。
- **名前付きセッションは必ず `open` で始める。dev サーバーが動いていても `goto` 単体は失敗する**: `playwright-cli -s=<名前> goto <url>` は `The browser '<名前>' is not open, please run open first` で落ちる（`-s=` の名前はブラウザの実体を指しており、`open` がその起動を兼ねるため）。`open <url>` が `goto` も兼ねるので、最初の 1 コマンドを `open <url>` にすればコマンドが 1 往復減る。
  <!-- importance: high | mentions: 1 | first-seen: 2026-09 -->

- **ファイル選択まわり: `upload` はワークスペース配下のファイルしか受け付けず、失敗するとファイルチューザーの状態が消える**: スクラッチパッドや `/tmp` のファイルを渡すと "outside allowed roots" で拒否される。拒否された後に同じパスを直しても、ファイルチューザーの待ち状態は失われているので**チューザーを開く操作からやり直す**必要がある（モーダル内なら再度開く）。置き場は gitignore 済みの `.playwright-cli/` が安全。また、`sr-only` で隠した `<input type="file">` を `click` するとラベルがクリックを奪ってタイムアウトする。可視の `<label>` の ref を `click` する。
  <!-- importance: medium | mentions: 1 | first-seen: 2026-09 -->

- **「同じ要素の中身が変わったのか、要素ごと差し替わったのか」はスナップショットでは区別できない。変化前に `eval` で目印を付ける**: ARIA スナップショットもスクショも最終状態の文字しか見せない。live region（`role="status"` は既存要素の中身の変化しか読まれない）や React の key 付け替えの検証では、`playwright-cli -s=<名前> eval "document.querySelector('[role=status]').dataset.probe = '0'"` → 状態を変える操作 → `eval "document.querySelector('[role=status]').outerHTML"` で `data-probe="0"` が文字入りの要素に残っているかを見る。残っていれば同一ノード。
  <!-- importance: medium | mentions: 1 | first-seen: 2026-09 -->

## Specific tasks

* **Request mocking** [references/request-mocking.md](references/request-mocking.md)
* **Running Playwright code** [references/running-code.md](references/running-code.md)
* **Browser session management** [references/session-management.md](references/session-management.md)
* **Storage state (cookies, localStorage)** [references/storage-state.md](references/storage-state.md)
* **Test generation** [references/test-generation.md](references/test-generation.md)
* **Tracing** [references/tracing.md](references/tracing.md)
* **Video recording** [references/video-recording.md](references/video-recording.md)
