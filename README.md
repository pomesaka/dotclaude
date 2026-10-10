# dotclaude

Personal [Claude Code](https://claude.ai/code) configuration.

## Managed files

| File | Description |
|------|-------------|
| `CLAUDE.md` | Global instructions for Claude |
| `settings.json` | Claude Code settings |
| `skills/` | Custom slash commands |
| `commands/` | Additional commands |
| `mods/` | Claude Code Mods (installed from this folder as the `dotclaude` marketplace; see `mods/README.md`) |
| `docs/` | Notes Claude reads on demand |
| `scripts/` | The publishing check |

## Setup

```bash
git clone git@github.com:pomesaka/dotclaude.git ~/github.com/pomesaka/dotclaude
cd ~/github.com/pomesaka/dotclaude
./setup.sh
```

Symlinks are created under `~/.claude/`. Existing non-symlink files are left untouched.

## Publishing check

This repository is public. Before a push, `scripts/check-public.sh` scans the commits that are not on the remote yet (diffs, messages, author addresses) for names that must not be published and for strings shaped like keys or tokens.

- The names live in `.private-names` (git-ignored): one regular expression per line. Without that file the check fails, so a new machine cannot push unchecked.
- The `publish-guard` Mod (`mods/publish-guard`) runs the check before a push Claude Code makes from this repository, and blocks the push on a hit.
- jj does not run git's pre-push hook. Before pushing by hand, run `scripts/check-public.sh` yourself.

Examples in `docs/` and `skills/` are written without project, client or company names ("ある案件で"). Keep it that way when adding one.
