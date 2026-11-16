# Codex Notes

The version before the 2026-11-16 cleanup is at `archive/2026-11-16/docs/codex.md`.

## Skills Compatibility

Codex and Claude Code both use `SKILL.md`-based skills (a directory containing `SKILL.md` with `name` and `description` in the YAML frontmatter), so the workflow instruction body is portable. Claude Code-specific execution metadata is not fully portable.

## Claude Code Syntax to Translate

When using existing Claude Code skills in Codex, translate these patterns mentally:

- `allowed-tools`: treat as intent and safety guidance, not an enforced Codex permission list
- `AskUserQuestion`: ask the user directly, or use Codex's available user-input mechanism when present
- `Agent` or subagent instructions: use Codex subagents only if configured in the current environment; otherwise perform the work directly
- `$ARGUMENTS`: use the explicit text the user supplied with the skill invocation
- `!command` expansion in Markdown: run the command only when it is needed and allowed
- `~/.claude/...`: prefer the equivalent `~/.codex/...` or shared repo path when using Codex

## Where Skills and Instructions Live

- Repo-scoped skills go in `.agents/skills/` when the workflow is project-specific. User-scoped skills go in `~/.agents/skills/` for personal workflows that apply across repositories.
- Reusable personal defaults go in `~/.codex/AGENTS.md`; project rules go in the repository `AGENTS.md`.
- Codex uses `description` for implicit skill selection and may shorten long descriptions in the initial skills list, so put the trigger phrases first.
- Restart Codex if a new or edited skill does not appear.

## Slash Commands

Codex CLI slash commands are built-in controls such as `/model`, `/permissions`, `/compact`, and `/diff`.

As of Codex CLI 0.133.0, repository skills do not become `/skill-name` commands automatically. Invoke skills with `$skill-name`, natural language, or Codex's skill picker when available.

## Config Practices

Common user-level settings live in `~/.codex/config.toml`.

Useful defaults:

```toml
approval_policy = "on-request"
sandbox_mode = "workspace-write"
model_reasoning_effort = "high"
web_search = "cached"
```

Do not symlink the entire `~/.codex/config.toml` from this repository unless machine-local state such as trusted projects is also intentionally managed here.
