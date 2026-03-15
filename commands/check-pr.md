# Check PR Details and Comments

This command checks PR details and review comments.

## Usage

```bash
# View PR summary
gh pr view <pr-number>

# View PR review comments with file path and line numbers
gh api repos/Accel-Hack/ADeT/pulls/<pr-number>/comments | jq -r '.[] | "[\(.user.login)] \(.path):\(.line)\n\(.body)\n---"'
```

## Example for PR #1213

```bash
# PR summary
gh pr view 1213

# Review comments
gh api repos/Accel-Hack/ADeT/pulls/1213/comments | jq -r '.[] | "[\(.user.login)] \(.path):\(.line)\n\(.body)\n---"'
```

## Output Format

Review comments will show:
- User who commented
- File path and line number
- Comment body
- Separator line (---)