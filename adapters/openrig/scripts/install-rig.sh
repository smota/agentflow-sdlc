#!/usr/bin/env bash
set -euo pipefail

# install-rig.sh — Installs or recovers the AgentFlow SDLC rig in OpenRig
# Usage: install-rig.sh [/path/to/project]
#   With a repository path, also applies the Git hygiene excludes to that repository.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
OPENRIG_SOURCE_DIR="$(cd "$SCRIPT_DIR/../agentflow" && pwd)"
TARGET_SPEC_DIR="$HOME/.openrig/specs/agentflow"
TARGET_REPO="${1:-}"

# A linked worktree has a .git file, not a directory, so ask Git instead of testing for .git/.
if [ -n "$TARGET_REPO" ] &&
  [ "$(git -C "$TARGET_REPO" rev-parse --is-inside-work-tree 2>/dev/null)" != "true" ]; then
  echo "ERROR: '$TARGET_REPO' is not a Git repository." >&2
  exit 1
fi

echo "==> 1. Syncing AgentFlow rig spec to OpenRig user library..."
mkdir -p "$TARGET_SPEC_DIR"
cp -r "$OPENRIG_SOURCE_DIR"/* "$TARGET_SPEC_DIR"/

echo "==> 2. Ensuring Pi state bridges for Grok 4.7 seats..."
for seat in orch-arch@agentflow rev-review@agentflow dev-build-jr@agentflow dev-build@agentflow dev-build-sr@agentflow dev-qa@agentflow; do
  mkdir -p "$HOME/.openrig/state/pi/$seat/agent"
  if [ -f "$HOME/.pi/agent/settings.json" ]; then
    ln -sf "$HOME/.pi/agent/settings.json" "$HOME/.openrig/state/pi/$seat/agent/settings.json"
  fi
  if [ -f "$HOME/.pi/agent/models-store.json" ]; then
    ln -sf "$HOME/.pi/agent/models-store.json" "$HOME/.openrig/state/pi/$seat/agent/models-store.json"
  fi
  if [ -f "$HOME/.pi/agent/auth.json" ]; then
    ln -sf "$HOME/.pi/agent/auth.json" "$HOME/.openrig/state/pi/$seat/agent/auth.json"
  fi
  if [ -d "$HOME/.pi/agent/npm" ]; then
    ln -sfn "$HOME/.pi/agent/npm" "$HOME/.openrig/state/pi/$seat/agent/npm"
  fi
done

echo "==> 3. Ensuring grok-cli vault marker in ~/.pi/agent/auth.json..."
if [ -f "$HOME/.pi/agent/auth.json" ]; then
  node -e '
    const fs = require("fs");
    const path = require("os").homedir() + "/.pi/agent/auth.json";
    const auth = JSON.parse(fs.readFileSync(path, "utf-8"));
    if (!auth["grok-cli"]) {
      auth["grok-cli"] = {
        type: "oauth",
        access: "pi-grok-cli-account-vault-v1",
        refresh: "pi-grok-cli-account-vault-v1",
        expires: 9007199254740991
      };
      fs.writeFileSync(path, JSON.stringify(auth, null, 2), { mode: 0o600 });
      console.log("   Added grok-cli marker to ~/.pi/agent/auth.json");
    } else {
      console.log("   grok-cli marker already present in ~/.pi/agent/auth.json");
    }
  '
fi

echo "==> 4. Ensuring Git hygiene in the target repository..."
EXCLUDES=(
  "CLAUDE.local.md"
  "AGENTS.md"
  "/.openrig/"
  ".openrig/"
  "/.worktrees/"
  ".worktrees/"
  ".claude/settings.local.json"
  "gate-lane-verdict.json"
)

if [ -z "$TARGET_REPO" ]; then
  echo "   (No target repository given; skipping. Pass a repository path to apply the excludes.)"
else
  # Git resolves info/exclude to the common git dir, which is the file it reads for every worktree.
  excludefile="$(git -C "$TARGET_REPO" rev-parse --path-format=absolute --git-path info/exclude)"
  mkdir -p "$(dirname "$excludefile")"
  touch "$excludefile"
  for line in "${EXCLUDES[@]}"; do
    if ! grep -qxF "$line" "$excludefile"; then
      echo "$line" >> "$excludefile"
    fi
  done
  echo "   Git hygiene exclusions configured in $excludefile"
fi

echo "==> 5. Syncing OpenRig spec library..."
if command -v rig >/dev/null 2>&1; then
  if rig daemon status 2>/dev/null | grep -q "running"; then
    rig specs sync
  else
    echo "   (OpenRig daemon not running; spec will be indexed upon next daemon start or 'rig specs sync')"
  fi
fi

echo "==> AgentFlow SDLC rig installed successfully!"
echo "    Launch with: rig up agentflow --cwd /path/to/project"
