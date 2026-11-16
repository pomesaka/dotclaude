# Codex Notes

## Skills Compatibility

Codex and Claude Code both use `SKILL.md`-based skills, so the core shape is portable:

- A skill is a directory containing `SKILL.md`
- YAML frontmatter must include `name` and `description`
- Additional `scripts/`, `references/`, and `assets/` directories are useful for progressive disclosure

The portable part is the workflow instruction body. Claude Code-specific execution metadata is not fully portable.

## Claude Code Syntax to Translate

When using existing Claude Code skills in Codex, translate these patterns mentally:

- `allowed-tools`: treat as intent and safety guidance, not an enforced Codex permission list
- `AskUserQuestion`: ask the user directly, or use Codex's available user-input mechanism when present
- `Agent` or subagent instructions: use Codex subagents only if configured in the current environment; otherwise perform the work directly
- `$ARGUMENTS`: use the explicit text the user supplied with the skill invocation
- `!command` expansion in Markdown: run the command only when it is needed and allowed
- `~/.claude/...`: prefer the equivalent `~/.codex/...` or shared repo path when using Codex

## Codex Skill Best Practices

- Keep `description` concise and trigger-focused. Codex uses it for implicit skill selection, and long descriptions may be shortened in the initial skills list.
- Front-load trigger words in `description`, especially user phrases like "review", "create PR", or "use design".
- Keep `SKILL.md` focused on the repeatable workflow. Move long policies, examples, and reference material into `references/`.
- Put deterministic or fragile operations in `scripts/` instead of prose.
- Prefer repo-scoped skills in `.agents/skills/` when the workflow is project-specific.
- Use user-scoped skills in `~/.agents/skills/` for personal workflows that apply across repositories.
- Restart Codex if a new or edited skill does not appear.

## Slash Commands

Codex CLI slash commands are built-in controls such as `/model`, `/permissions`, `/compact`, and `/diff`.

As of Codex CLI 0.133.0, repository skills do not become `/skill-name` commands automatically. Invoke skills with `$skill-name`, natural language, or Codex's skill picker when available.

## AGENTS.md Best Practices

- Put reusable personal defaults in `~/.codex/AGENTS.md`.
- Put project rules in repository `AGENTS.md`.
- Put narrow overrides close to the specialized directory, using `AGENTS.override.md` when it should replace the normal file at that level.
- Keep global guidance stable and concise. Project-specific build, lint, and architecture rules belong in the project.
- If a repo already uses another instruction filename, add it to `project_doc_fallback_filenames` in `~/.codex/config.toml`.

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
