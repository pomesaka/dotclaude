# dotclaude

Personal [Claude Code](https://claude.ai/code) configuration.

## Managed files

| File | Description |
|------|-------------|
| `CLAUDE.md` | Global instructions for Claude |
| `settings.json` | Claude Code settings |
| `skills/` | Custom slash commands |
| `commands/` | Additional commands |

## Setup

```bash
git clone git@github.com:pomesaka/dotclaude.git ~/github.com/pomesaka/dotclaude
cd ~/github.com/pomesaka/dotclaude
./setup.sh
```

Symlinks are created under `~/.claude/`. Existing non-symlink files are left untouched.
