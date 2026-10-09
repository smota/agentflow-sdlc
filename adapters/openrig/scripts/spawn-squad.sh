#!/usr/bin/env bash
set -euo pipefail

# spawn-squad.sh — Creates, lists, or removes parallel AgentFlow squads in OpenRig for multi-project workflows
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
KIND="delivery"
SIBLING=""
PRESET=""

show_help() {
  cat << 'EOF'
Usage:
  spawn-squad.sh [--kind delivery|product] [--sibling <rig>] [--preset <name>] <project-name> [project-cwd]
                                         Provision a per-project copy of one generic base
                                         (project-cwd defaults to the current directory)
  spawn-squad.sh --list                  List all configured AgentFlow squads
  spawn-squad.sh --remove <project-name> Remove a squad spec and its Pi bridge state

--kind delivery copies the delivery base (the default). --kind product copies the product base.
--sibling records that rig's seat sessions in this copy only.
--preset applies to a product copy. Delivery copies keep the base rig runtimes.

Examples:
  ./spawn-squad.sh --kind delivery --sibling agentflow-pm dev /path/to/project
  ./spawn-squad.sh --kind product --sibling agentflow-dev pm /path/to/project
  ./spawn-squad.sh --list
  ./spawn-squad.sh --remove my-project
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

  if [ "$rig_name" = "agentflow" ] || [ "$rig_name" = "agentflow-product" ]; then
    echo "ERROR: Refusing to remove the canonical base rig '$rig_name'. Use install-rig.sh to manage it." >&2
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

# Parse flags before the command or project name. --list and --remove stay commands.
POSITIONAL=()
while [ $# -gt 0 ]; do
  case "$1" in
    --kind)
      KIND="${2:?ERROR: --kind requires delivery or product.}"
      shift 2
      ;;
    --kind=*)
      KIND="${1#--kind=}"
      shift
      ;;
    --sibling)
      SIBLING="${2:?ERROR: --sibling requires a rig name.}"
      shift 2
      ;;
    --sibling=*)
      SIBLING="${1#--sibling=}"
      shift
      ;;
    --preset)
      PRESET="${2:?ERROR: --preset requires a preset name.}"
      shift 2
      ;;
    --preset=*)
      PRESET="${1#--preset=}"
      shift
      ;;
    --)
      shift
      POSITIONAL+=("$@")
      break
      ;;
    -*)
      POSITIONAL+=("$1")
      shift
      ;;
    *)
      POSITIONAL+=("$1")
      shift
      ;;
  esac
done
if [ ${#POSITIONAL[@]} -gt 0 ]; then
  set -- "${POSITIONAL[@]}"
else
  set --
fi

if [ "$KIND" != "delivery" ] && [ "$KIND" != "product" ]; then
  echo "ERROR: --kind must be delivery or product, not '$KIND'." >&2
  exit 1
fi

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
if [ "$KIND" = "product" ]; then
  BASE_SPEC_DIR="$HOME/.openrig/specs/agentflow-product"
else
  BASE_SPEC_DIR="$HOME/.openrig/specs/agentflow"
fi
if [ "$RIG_NAME" = "agentflow" ] || [ "$RIG_NAME" = "agentflow-product" ]; then
  echo "ERROR: '$RIG_NAME' is a generic base name. Pass a project copy name, such as dev or pm." >&2
  exit 1
fi

# Determine project target cwd
if [ -n "${2:-}" ]; then
  if [ ! -d "$2" ]; then
    echo "ERROR: Specified project directory '$2' does not exist." >&2
    exit 1
  fi
  PROJECT_CWD="$(cd "$2" && pwd)"
else
  PROJECT_CWD="$PWD"
fi

# Ensure base spec is installed. install-rig.sh writes both generic bases.
if [ ! -f "$BASE_SPEC_DIR/rig.yaml" ]; then
  echo "==> Base spec not found in $BASE_SPEC_DIR. Running install-rig.sh..."
  if [ -n "$PRESET" ]; then
    "$SCRIPT_DIR/install-rig.sh" --preset "$PRESET"
  else
    "$SCRIPT_DIR/install-rig.sh"
  fi
fi

if [ "$KIND" = "product" ]; then
  node -e '
    const fs = require("fs");
    const [file, requested] = process.argv.slice(1);
    const presets = {};
    let recommended = "";
    let section = "";
    let current = null;
    for (const line of fs.readFileSync(file, "utf8").split("\n")) {
      const top = line.match(/^(\S[^:]*):\s*(.*)$/);
      if (top) {
        section = top[1];
        if (section === "recommended") recommended = top[2].trim();
        continue;
      }
      if (section !== "presets") continue;
      const name = line.match(/^  (\S[^:]*):\s*$/);
      if (name) {
        current = presets[name[1]] = {};
        continue;
      }
      const seat = line.match(/^    (\S+):\s*(\S+)\s*$/);
      if (seat && current) current[seat[1]] = seat[2];
    }
    const preset = requested || recommended;
    if (!presets[preset]) {
      console.error(`ERROR: Unknown preset "${preset}". Known presets: ${Object.keys(presets).join(", ")}.`);
      process.exit(1);
    }
  ' "$BASE_SPEC_DIR/configurations.yaml" "$PRESET"
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

# Generate dedicated rig.yaml with the unique rig name. Do not require the base name to be agentflow.
awk -v name="$RIG_NAME" 'BEGIN { done = 0 } /^name: / && !done { print "name: " name; done = 1; next } { print }' \
  "$BASE_SPEC_DIR/rig.yaml" > "$TARGET_SPEC_DIR/rig.yaml"

if [ "$KIND" = "product" ]; then
  node -e '
    const fs = require("fs");
    const [configPath, rigPath, requested] = process.argv.slice(1);
    const presets = {};
    let recommended = "";
    let section = "";
    let current = null;
    for (const line of fs.readFileSync(configPath, "utf8").split("\n")) {
      const top = line.match(/^(\S[^:]*):\s*(.*)$/);
      if (top) {
        section = top[1];
        if (section === "recommended") recommended = top[2].trim();
        continue;
      }
      if (section !== "presets") continue;
      const name = line.match(/^  (\S[^:]*):\s*$/);
      if (name) {
        current = presets[name[1]] = {};
        continue;
      }
      const seat = line.match(/^    (\S+):\s*(\S+)\s*$/);
      if (seat && current) current[seat[1]] = seat[2];
    }
    const preset = requested || recommended;
    if (!presets[preset]) {
      console.error(`ERROR: Unknown preset "${preset}". Known presets: ${Object.keys(presets).join(", ")}.`);
      process.exit(1);
    }
    const chosen = presets[preset];
    const lines = fs.readFileSync(rigPath, "utf8").split("\n");
    const out = [];
    let member = null;
    for (let i = 0; i < lines.length; i += 1) {
      const id = lines[i].match(/^ +- id: (\S+)\s*$/);
      if (id) member = id[1];
      const runtimeLine = lines[i].match(/^ +runtime: \S+\s*$/);
      if (member && runtimeLine) {
        const runtime = chosen[`pm.${member}`];
        if (!runtime) {
          console.error(`ERROR: Preset "${preset}" has no runtime for pm.${member}.`);
          process.exit(1);
        }
        const indent = lines[i].match(/^ +/)[0];
        out.push(`${indent}runtime: ${runtime}`);
        const next = lines[i + 1] || "";
        if (runtime === "pi" && !/^ +model: /.test(next)) {
          out.push(`${indent}model: grok-cli/grok-4.7`);
        }
        if (runtime !== "pi" && /^ +model: /.test(next)) i += 1;
        continue;
      }
      out.push(lines[i]);
    }
    fs.writeFileSync(rigPath, out.join("\n"));
    console.log(preset);
  ' "$BASE_SPEC_DIR/configurations.yaml" "$TARGET_SPEC_DIR/rig.yaml" "$PRESET"
fi

# sibling.md is a real file in this copy. startup/ is a symlink to the generic base, so it cannot hold this.
{
  echo "# Sibling squad"
  echo
  if [ -z "$SIBLING" ]; then
    echo "No sibling squad was named for this copy. Do not invent session names."
  elif [ "$KIND" = "product" ]; then
    echo "This copy is the product squad \`$RIG_NAME\`."
    echo "The delivery squad for this project is \`$SIBLING\`."
    echo
    echo "- orch-arch@$SIBLING"
    echo "- dev-build-jr@$SIBLING"
    echo "- dev-build@$SIBLING"
    echo "- dev-build-sr@$SIBLING"
    echo "- dev-qa@$SIBLING"
    echo "- rev-review@$SIBLING"
    echo
    echo "A message to delivery is a question or the phase 1 handoff. It is not an implementation order."
  else
    echo "This copy is the delivery squad \`$RIG_NAME\`."
    echo "The product squad for this project is \`$SIBLING\`."
    echo
    echo "- pm-manager@$SIBLING"
    echo "- pm-analyst@$SIBLING"
    echo
    echo "Phases 0 and 1 belong to that product squad. This squad starts at phase 2."
    echo "A question to the analyst is allowed. Changing the outcome, a constraint, or an anti-goal waits for the person."
  fi
} > "$TARGET_SPEC_DIR/sibling.md"

if ! grep -q 'path: sibling.md' "$TARGET_SPEC_DIR/rig.yaml"; then
  awk '
    $0 ~ /path: startup\/context.md/ {
      print
      getline; print
      getline; print
      print "    - path: sibling.md"
      print "      delivery_hint: send_text"
      print "      required: true"
      next
    }
    { print }
  ' "$TARGET_SPEC_DIR/rig.yaml" > "$TARGET_SPEC_DIR/rig.yaml.tmp"
  mv "$TARGET_SPEC_DIR/rig.yaml.tmp" "$TARGET_SPEC_DIR/rig.yaml"
fi

echo "==> 2. Provisioning Pi state bridges for squad '$RIG_NAME'..."
if [ "$KIND" = "product" ]; then
  SEATS=()
  while IFS= read -r seat; do
    [ -n "$seat" ] && SEATS+=("$seat")
  done < <(awk -v rig="$RIG_NAME" '
    $0 ~ /^ +- id: / { id = $3 }
    $0 ~ /^ +runtime: pi$/ && id != "" { print "pm-" id "@" rig }
  ' "$TARGET_SPEC_DIR/rig.yaml")
else
  SEATS=(
    "orch-arch@$RIG_NAME"
    "rev-review@$RIG_NAME"
    "dev-build-jr@$RIG_NAME"
    "dev-build@$RIG_NAME"
    "dev-build-sr@$RIG_NAME"
    "dev-qa@$RIG_NAME"
  )
fi

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
