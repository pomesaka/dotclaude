#!/usr/bin/env bash
# Usage: upload.sh <repo> <pr-or-issue-number> <file1> [file2 ...]
# Example: upload.sh Accel-Hack/ADeT 2276 screenshot.png demo.webm
#
# Uploads files to a draft GitHub release and prints browser_download_url for each.
# WebM/MP4 are automatically converted to GIF via ffmpeg (mise exec ffmpeg).
# Also cleans up screenshot draft releases older than 1 month.

set -euo pipefail

REPO="${1:?Usage: upload.sh <owner/repo> <number> <file...>}"
NUMBER="${2:?}"
shift 2
FILES=("$@")

# Cleanup releases older than 1 month
CUTOFF=$(date -v-1m +%s 2>/dev/null || date -d '1 month ago' +%s)
gh api "repos/${REPO}/releases" --paginate \
  --jq '.[] | select(.draft == true and ((.name | startswith("[screenshots]")) or (.name | startswith("[temp]")))) | "\(.id) \(.created_at)"' \
  | while read -r ID CREATED_AT; do
      CREATED=$(date -j -f "%Y-%m-%dT%H:%M:%SZ" "$CREATED_AT" +%s 2>/dev/null \
                || date -d "$CREATED_AT" +%s)
      if [ "$CREATED" -lt "$CUTOFF" ]; then
        >&2 echo "Deleting old release: $ID ($CREATED_AT)"
        gh api --method DELETE "repos/${REPO}/releases/${ID}" > /dev/null
      fi
    done

# Reuse existing draft release for this number, or create one
RELEASE_ID=$(gh api "repos/${REPO}/releases" --paginate \
  --jq ".[] | select(.draft == true and .name == \"[screenshots] #${NUMBER}\") | .id" \
  | head -1)

if [ -z "$RELEASE_ID" ]; then
  RELEASE_ID=$(gh api --method POST "repos/${REPO}/releases" \
    -f tag_name="screenshots-$(date +%s)" \
    -f name="[screenshots] #${NUMBER}" \
    -f body="Screenshot/video hosting for #${NUMBER}." \
    -F draft=true \
    --jq '.id')
  >&2 echo "Created release: $RELEASE_ID"
else
  >&2 echo "Reusing release: $RELEASE_ID"
fi

# Upload each file
for FILE in "${FILES[@]}"; do
  NAME=$(basename "$FILE")
  EXT=$(echo "${NAME##*.}" | tr '[:upper:]' '[:lower:]')

  # Convert video to GIF
  if [ "$EXT" = "webm" ] || [ "$EXT" = "mp4" ]; then
    GIF_NAME="${NAME%.*}.gif"
    GIF_FILE="${FILE%.*}.gif"
    >&2 echo "Converting ${NAME} to GIF..."
    mise exec ffmpeg -- ffmpeg -y -i "$FILE" \
      -vf "fps=10,scale=1280:-1:flags=lanczos" \
      -loop 0 "$GIF_FILE" 2>/dev/null
    FILE="$GIF_FILE"
    NAME="$GIF_NAME"
    EXT="gif"
  fi

  case "$EXT" in
    png)      CT="image/png" ;;
    jpg|jpeg) CT="image/jpeg" ;;
    gif)      CT="image/gif" ;;
    *)        CT="application/octet-stream" ;;
  esac

  URL=$(curl -s -X POST \
    -H "Authorization: Bearer $(gh auth token)" \
    -H "Accept: application/vnd.github+json" \
    -H "Content-Type: ${CT}" \
    --data-binary "@${FILE}" \
    "https://uploads.github.com/repos/${REPO}/releases/${RELEASE_ID}/assets?name=${NAME}" \
    | jq -r '.browser_download_url')

  echo "${NAME}	${URL}"
done
