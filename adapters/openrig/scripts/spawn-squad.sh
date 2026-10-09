#!/usr/bin/env bash
set -euo pipefail

# spawn-squad.sh — Creates, lists, or removes parallel AgentFlow squads in OpenRig for multi-project workflows
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BASE_SPEC_DIR="$HOME/.openrig/specs/agentflow"

show_help() {
  cat << 'EOF'
Usage:
  spawn-squad.sh <project-name> [project-cwd]     Provision a dedicated parallel squad for a project
  spawn-squad.sh --list                           List all configured AgentFlow squads
  spawn-squad.sh --remove <project-name>          Remove a squad spec and its Pi bridge state

Examples:
  ./spawn-squad.sh holoself ~/code/holoself
  ./spawn-squad.sh nextstep
  ./spawn-squad.sh --list
  ./spawn-squad.sh --remove holoself
EOF
}

normalize_rig_name() {
  local raw="$1"
  if [[ "$raw" =~ ^agentflow- ]]; then
    echo "$raw"
  else
    echo "agentflow-$raw"
  fi
}

list_squads() {
  echo "==> Configured AgentFlow Squads in OpenRig:"
  echo ""
  printf "%-25s %-12s %s\n" "RIG NAME" "STATUS" "SPEC DIRECTORY"
  printf "%-25s %-12s %s\n" "-------------------------" "------------" "----------------------------------------"
  
  for dir in "$HOME/.openrig/specs"/agentflow*; do
    if [ -d "$dir" ] && [ -f "$dir/rig.yaml" ]; then
      local rigname
      rigname="$(basename "$dir")"
      local status="stopped"
      if command -v rig >/dev/null 2>&1; then
        if rig ps 2>/dev/null | grep -qw "$rigname"; then
          status="running"
        fi
      fi
      printf "%-25s %-12s %s\n" "$rigname" "$status" "$dir"
    fi
  done
  echo ""
}

remove_squad() {
  local target_raw="$1"
  local rig_name
  rig_name="$(normalize_rig_name "$target_raw")"

  if [ "$rig_name" = "agentflow" ]; then
    echo "ERROR: Refusing to remove the canonical base rig 'agentflow'. Use install-rig.sh to manage it." >&2
    exit 1
  fi

  local target_dir="$HOME/.openrig/specs/$rig_name"
  echo "==> Removing squad '$rig_name'..."

  # Stop rig if running
  if command -v rig >/dev/null 2>&1; then
    if rig ps 2>/dev/null | grep -qw "$rig_name"; then
      echo "    Stopping running rig '$rig_name'..."
      rig down "$rig_name" --yes || true
    fi
  fi

  # Remove spec dir
  if [ -d "$target_dir" ]; then
    rm -rf "$target_dir"
    echo "    Removed spec directory: $target_dir"
  fi

  # Remove Pi bridges
  for seat_dir in "$HOME/.openrig/state/pi"/*@"$rig_name"; do
    if [ -d "$seat_dir" ]; then
      rm -rf "$seat_dir"
      echo "    Removed Pi bridge: $seat_dir"
    fi
  done

  # Sync specs if daemon is running
  if command -v rig >/dev/null 2>&1; then
    rig specs sync >/dev/null 2>&1 || true
  fi

  echo "==> Squad '$rig_name' successfully removed."
}

# Parse options
if [ "${1:-}" = "-h" ] || [ "${1:-}" = "--help" ]; then
  show_help
  exit 0
fi

if [ "${1:-}" = "--list" ] || [ "${1:-}" = "-l" ]; then
  list_squads
  exit 0
fi

if [ "${1:-}" = "--remove" ] || [ "${1:-}" = "-r" ]; then
  if [ -z "${2:-}" ]; then
    echo "ERROR: Missing project name to remove." >&2
    show_help
    exit 1
  fi
  remove_squad "$2"
  exit 0
fi

if [ -z "${1:-}" ]; then
  show_help
  exit 1
fi

PROJECT_RAW="$1"
RIG_NAME="$(normalize_rig_name "$PROJECT_RAW")"
TARGET_SPEC_DIR="$HOME/.openrig/specs/$RIG_NAME"

# Determine project target cwd
if [ -n "${2:-}" ]; then
  if [ ! -d "$2" ]; then
    echo "ERROR: Specified project directory '$2' does not exist." >&2
    exit 1
  fi
  PROJECT_CWD="$(cd "$2" && pwd)"
else
  # Default heuristics
  if [ -d "$HOME/code/$PROJECT_RAW" ]; then
    PROJECT_CWD="$(cd "$HOME/code/$PROJECT_RAW" && pwd)"
  else
    PROJECT_CWD="$PWD"
  fi
fi

# Ensure base spec is installed
if [ ! -f "$BASE_SPEC_DIR/rig.yaml" ]; then
  echo "==> Base AgentFlow rig spec not found in ~/.openrig/specs/agentflow. Running install-rig.sh..."
  "$SCRIPT_DIR/install-rig.sh"
fi

echo "==> 1. Provisioning spec for squad '$RIG_NAME'..."
mkdir -p "$TARGET_SPEC_DIR"

# Symlink shared assets from base spec
ln -sfn "$BASE_SPEC_DIR/agents" "$TARGET_SPEC_DIR/agents"
ln -sfn "$BASE_SPEC_DIR/startup" "$TARGET_SPEC_DIR/startup"
ln -sfn "$BASE_SPEC_DIR/CULTURE.md" "$TARGET_SPEC_DIR/CULTURE.md"
ln -sfn "$BASE_SPEC_DIR/README.md" "$TARGET_SPEC_DIR/README.md"
if [ -f "$BASE_SPEC_DIR/configurations.yaml" ]; then
  ln -sfn "$BASE_SPEC_DIR/configurations.yaml" "$TARGET_SPEC_DIR/configurations.yaml"
fi

# Generate dedicated rig.yaml with the unique rig name
sed "s/^name: agentflow$/name: $RIG_NAME/" "$BASE_SPEC_DIR/rig.yaml" > "$TARGET_SPEC_DIR/rig.yaml"

echo "==> 2. Provisioning Pi state bridges for squad '$RIG_NAME'..."
SEATS=(
  "orch-arch@$RIG_NAME"
  "rev-review@$RIG_NAME"
  "dev-build-jr@$RIG_NAME"
  "dev-build@$RIG_NAME"
  "dev-build-sr@$RIG_NAME"
  "dev-qa@$RIG_NAME"
)

for seat in "${SEATS[@]}"; do
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

echo "==> 3. Ensuring Git hygiene in target project '$PROJECT_CWD'..."
if [ -d "$PROJECT_CWD/.git" ]; then
  excludefile="$PROJECT_CWD/.git/info/exclude"
  mkdir -p "$(dirname "$excludefile")"
  touch "$excludefile"
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
  for line in "${EXCLUDES[@]}"; do
    if ! grep -qxF "$line" "$excludefile"; then
      echo "$line" >> "$excludefile"
    fi
  done
  echo "   Git hygiene exclusions configured in $excludefile"
fi

echo "==> 4. Syncing and validating spec with OpenRig daemon..."
if command -v rig >/dev/null 2>&1; then
  if rig daemon status 2>/dev/null | grep -q "running"; then
    rig specs sync >/dev/null 2>&1 || true
    rig spec validate "$TARGET_SPEC_DIR/rig.yaml"
  fi
fi

echo ""
echo "================================================================================"
echo "  Squad '$RIG_NAME' successfully provisioned!"
echo "  Target working directory: $PROJECT_CWD"
echo "================================================================================"
echo ""
echo "  Launch this squad in parallel:"
echo "    rig up $RIG_NAME --cwd $PROJECT_CWD"
echo ""
echo "  Monitor this squad:"
echo "    rig ps --nodes --rig $RIG_NAME"
echo ""
echo "  Freeze this squad (instant snapshot):"
echo "    rig down $RIG_NAME --snapshot"
echo ""
echo "  Resume this squad:"
echo "    rig up $RIG_NAME --existing"
echo ""
echo "  Remove this squad when finished:"
echo "    ./adapters/openrig/scripts/spawn-squad.sh --remove $PROJECT_RAW"
echo "================================================================================"
