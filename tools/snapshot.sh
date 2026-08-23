#!/usr/bin/env bash
#
# snapshot.sh — local-only save points. Nothing here ever touches a network.
# =============================================================================
# WHY THIS EXISTS
#
#   We need to be able to undo a bad change without GitHub being involved in
#   any way. So this keeps a private history in .snapshots/ that:
#
#     * has NO git remote, and refuses to run if one ever appears
#     * is a separate --git-dir, so the working tree is never `git init`-ed
#       and no .git folder appears in the project
#     * also writes a plain .tar.gz of every save point, so a snapshot is
#       recoverable even without git
#
#   Two independent copies, because a backup you have not tested is a rumour.
#
# USAGE
#   tools/snapshot.sh save "message"   take a save point
#   tools/snapshot.sh list             show save points
#   tools/snapshot.sh diff [ref]       what changed since a save point
#   tools/snapshot.sh restore <ref>    roll the tree back (saves first)
#   tools/snapshot.sh files <ref>      list files in a save point
#   tools/snapshot.sh show <ref> <f>   print one file from a save point
# =============================================================================
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SNAP="$ROOT/.snapshots"
GITDIR="$SNAP/git"
TARDIR="$SNAP/tar"
G=(git --git-dir="$GITDIR" --work-tree="$ROOT")

# Artefacts the repo's .gitignore excludes, but which we MUST keep: they are
# the output of GPU runs and hand-calibration and cannot be regenerated from
# source. A backup that silently drops the irreplaceable files is worse than
# no backup, because you only find out when you need it.
FORCE=(
  "dev/cache/models"
  "dev/cache/consequence-raster.json"
  "dev/cache/dense-consequence.json"
  "dev/cache/exposure.json"
  "ml/data/ood_calibration.json"
  "ml/data/consequence_labels.json"
)

EXCLUDES=(
  ".snapshots" "node_modules" "dist" ".vite" "__pycache__" ".venv"
  "research/data" "ml/data" "ml/tiles" "ml/contradictions"
  "*.mp4" "*.zip" "*.tif" "*.pt" "*.pkl" "*.png" "*.jpg"
  "formal/states" ".env"
)

die() { printf '\n  %s\n\n' "$1" >&2; exit 1; }

init() {
  mkdir -p "$TARDIR"
  if [ ! -d "$GITDIR" ]; then
    git init --quiet --bare "$GITDIR"
    "${G[@]}" config user.name  "astromesh-snapshot"
    "${G[@]}" config user.email "snapshot@localhost"
    "${G[@]}" config core.excludesFile "$SNAP/ignore"
    # Belt and braces: make pushing impossible even if a remote is ever added.
    "${G[@]}" config remote.pushDefault "/dev/null"
    printf '%s\n' "${EXCLUDES[@]}" > "$SNAP/ignore"
    echo "  initialised local snapshot store at .snapshots/  (no remote, never pushed)"
  fi
  printf '%s\n' "${EXCLUDES[@]}" > "$SNAP/ignore"
  # Refuse to operate if anything ever wired a remote in.
  if [ -n "$("${G[@]}" remote 2>/dev/null)" ]; then
    die "REFUSING TO RUN: the snapshot store has a git remote. It must stay local-only."
  fi
}

cmd_save() {
  init
  local msg="${1:-save point}" stamp
  stamp="$(date +%Y%m%d-%H%M%S)"
  "${G[@]}" add -A
  # ...then force in the irreplaceable artefacts the .gitignore would drop.
  for f in "${FORCE[@]}"; do
    [ -e "$ROOT/$f" ] && "${G[@]}" add -f "$f" 2>/dev/null || true
  done
  if "${G[@]}" diff --cached --quiet 2>/dev/null; then
    echo "  nothing changed since the last save point"
    return 0
  fi
  "${G[@]}" commit --quiet -m "$stamp  $msg"
  local short; short="$("${G[@]}" rev-parse --short HEAD)"
  "${G[@]}" tag "snap-$stamp"

  # independent tarball copy
  local tarargs=()
  for e in "${EXCLUDES[@]}"; do tarargs+=(--exclude="$e"); done
  tar -czf "$TARDIR/$stamp.tar.gz" -C "$ROOT" "${tarargs[@]}" . 2>/dev/null || true

  local n; n=$("${G[@]}" diff --name-only HEAD~1 HEAD 2>/dev/null | wc -l || echo '?')
  printf '  saved  %s  [%s]  %s file(s)\n  tarball .snapshots/tar/%s.tar.gz\n' \
    "snap-$stamp" "$short" "$n" "$stamp"
}

cmd_list() {
  init
  echo
  "${G[@]}" log --oneline --decorate -30 2>/dev/null || echo "  no save points yet"
  echo
  echo "  tarballs:"
  ls -1t "$TARDIR" 2>/dev/null | head -10 | sed 's/^/    /' || echo "    none"
  echo
}

cmd_diff() { init; "${G[@]}" diff --stat "${1:-HEAD}" -- . ; }
cmd_files() { init; "${G[@]}" ls-tree -r --name-only "${1:?need a ref}"; }
cmd_show() { init; "${G[@]}" show "${1:?ref}:${2:?path}"; }

cmd_restore() {
  init
  local ref="${1:?usage: restore <snap-tag|hash>}"
  "${G[@]}" rev-parse --verify "$ref" >/dev/null 2>&1 || die "no such save point: $ref"
  # Always save the current state first — restoring must never lose work.
  cmd_save "auto-save before restoring $ref" || true
  "${G[@]}" checkout -f "$ref" -- .
  printf '\n  restored the tree to %s\n  the state before this restore is the save point above it.\n\n' "$ref"
}

case "${1:-}" in
  save)    shift; cmd_save "$*" ;;
  list|ls) cmd_list ;;
  diff)    shift; cmd_diff "${1:-HEAD}" ;;
  files)   shift; cmd_files "${1:-}" ;;
  show)    shift; cmd_show "${1:-}" "${2:-}" ;;
  restore) shift; cmd_restore "${1:-}" ;;
  *) sed -n '/^# USAGE/,/^# ===/p' "$0" | sed 's/^# \{0,1\}//' ;;
esac
