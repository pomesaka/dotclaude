# dotclaude

Personal Claude Code and Codex configuration.

## Managed files

| File | Description |
|------|-------------|
| `CLAUDE.md` | Global instructions for Claude |
| `AGENTS.md` | Global instructions for Codex |
| `docs/shared-agent-policy.md` | Shared policy |
| `settings.json` | Claude Code settings |
| `skills/` | Shared SKILL.md workflows |
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

Symlinks are created under `~/.claude/`, `~/.codex/`, and `~/.agents/skills/`. Existing user files/directories and Codex system skills are preserved. Only obsolete skill links owned by this repository are removed.

For isolated setup verification, set `DOTCLAUDE_HOME` to a temporary directory. Claude and Codex share the same skill source; Codex reads the portable instructions through `~/.agents/skills/<skill-name>/SKILL.md`. See [Codex notes](docs/codex.md).

## Publishing check

This repository is public. Before a push, `scripts/check-public.sh` scans the commits that are not on the remote yet (diffs, messages, author addresses) for names that must not be published and for strings shaped like keys or tokens.

- Names can be configured in `.private-names` (git-ignored): one regular expression per line. If the file is missing or empty, only the key and token checks run.
- The `publish-guard` Mod (`mods/publish-guard`) runs the check before a push Claude Code makes from this repository, and blocks the push on a hit.
- jj does not run git's pre-push hook. Before pushing by hand, run `scripts/check-public.sh` yourself.

Examples in `docs/` and `skills/` are written without project, client or company names ("ある案件で"). Keep it that way when adding one.
