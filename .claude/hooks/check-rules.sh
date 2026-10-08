#!/usr/bin/env bash
# PostToolUse hook for Edit/Write: reports AGENTS.md rule violations that the edit introduced
# (file too long, directory too crowded, history language or dependency lists in comments/docs).
# Only regressions against HEAD are reported, so files that were already over a limit do not nag.
set -u
root="${CLAUDE_PROJECT_DIR:-$(pwd)}"
file=$(jq -r '.tool_input.file_path // empty')
[ -n "$file" ] && [ -f "$file" ] || exit 0
case "$file" in "$root"/*) rel="${file#"$root"/}" ;; *) exit 0 ;; esac

in_head() { git -C "$root" cat-file -e "HEAD:$rel" 2>/dev/null; }
head_text() { git -C "$root" show "HEAD:$rel" 2>/dev/null; }
problems=()

# File and directory size.
limit=0
case "$rel" in
  packages/*/__tests__/*.ts) limit=500 ;;
  packages/*/src/*.ts|packages/*/src/*.tsx|packages/*/src/*.css|packages/*/build/*.mjs) limit=300 ;;
esac
if [ "$limit" -gt 0 ]; then
  lines=$(wc -l < "$file" | tr -d ' ')
  before=$(head_text | wc -l | tr -d ' ')
  if [ "$lines" -gt "$limit" ] && { ! in_head || [ "$lines" -gt "$before" ]; }; then
    problems+=("$rel has $lines lines (limit $limit). Split it by responsibility (AGENTS.md §3).")
  fi
  case "$rel" in packages/*/src/*)
    if ! in_head; then
      dir=$(dirname "$file")
      count=$(find "$dir" -maxdepth 1 -type f \( -name '*.ts' -o -name '*.tsx' -o -name '*.css' \) ! -name 'index.ts' ! -name '*.d.ts' | wc -l | tr -d ' ')
      [ "$count" -gt 8 ] && problems+=("$(dirname "$rel") now holds $count source files (limit 8). Group them into subfolders by responsibility (AGENTS.md §3).")
    fi ;;
  esac
fi

# History language and dependency lists.
pattern='no longer|previously|used to|legacy|formerly|was replaced|were replaced|backward[- ]compat|deprecated|@depends|@dependents|@usedBy'
scope=""
case "$rel" in
  documents/plans/*|documents/archive/*) ;;
  documents/*.md|README.md) scope=doc ;;
  packages/*/src/*.ts|packages/*/src/*.tsx|packages/*/src/*.css|packages/*/__tests__/*.ts) scope=code ;;
esac
if [ -n "$scope" ]; then
  matches() {
    # "legacy build" is the name of a pdf.js distribution, not history.
    if [ "$scope" = code ]; then grep -E '^[[:space:]]*(//|/?\*)'; else cat; fi | grep -viE 'legacy[/ ]build' | grep -icE "$pattern"
  }
  now=$(matches < "$file"); was=$(head_text | matches)
  if [ "${now:-0}" -gt "${was:-0}" ]; then
    hits=$(grep -inE "$pattern" "$file" | grep -viE 'legacy[/ ]build' | head -5)
    problems+=("$rel gained history language or dependency lists. Describe what is, without history, and drop @depends/@usedBy (AGENTS.md §3, §5):
$hits")
  fi
fi

[ ${#problems[@]} -eq 0 ] && exit 0
printf '%s\n' "${problems[@]}" >&2
exit 2
