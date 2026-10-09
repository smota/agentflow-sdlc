#!/usr/bin/env bash
set -euo pipefail

# install-rig.sh — Installs or recovers the AgentFlow SDLC rig in OpenRig
# Usage: install-rig.sh [--preset <name>] [/path/to/project]
#   --preset selects a preset from agentflow/configurations.yaml (default: its recommended one).
#   Pi state bridges and the grok-cli marker are set up only for the preset's Pi seats.
#   With a repository path, also applies the Git hygiene excludes to that repository.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
OPENRIG_SOURCE_DIR="$(cd "$SCRIPT_DIR/../agentflow" && pwd)"
PRODUCT_SOURCE_DIR="$(cd "$SCRIPT_DIR/../agentflow-product" && pwd)"
TARGET_SPEC_DIR="$HOME/.openrig/specs/agentflow"
PRODUCT_SPEC_DIR="$HOME/.openrig/specs/agentflow-product"
PRESET=""
TARGET_REPO=""

while [ $# -gt 0 ]; do
  case "$1" in
    --preset)
      if [ -z "${2:-}" ]; then
        echo "ERROR: --preset requires a preset name." >&2
        exit 1
      fi
      PRESET="$2"
      shift 2
      ;;
    --preset=*)
      PRESET="${1#--preset=}"
      shift
      ;;
    -*)
      echo "ERROR: Unknown option '$1'." >&2
      exit 1
      ;;
    *)
      if [ -n "$TARGET_REPO" ]; then
        echo "ERROR: Unexpected argument '$1'; only one repository path is accepted." >&2
        exit 1
      fi
      TARGET_REPO="$1"
      shift
      ;;
  esac
done

if ! command -v node >/dev/null 2>&1; then
  echo "ERROR: node is required to read agentflow/configurations.yaml." >&2
  exit 1
fi

# Print the selected preset name, then one line per Pi seat as <seat-id-with-hyphens>@<rig>.
# configurations.yaml is flat two-level YAML, so a line scan is enough; no YAML dependency.
# The product base must declare the same preset name. Nothing is copied if either file rejects it.
read_preset_seats() {
  node -e '
    const fs = require("fs");
    const [file, requested, rigName] = process.argv.slice(1);
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
      console.error(`ERROR: Unknown preset "${preset}" in ${file}. Known presets: ${Object.keys(presets).join(", ")}.`);
      process.exit(1);
    }
    console.log(preset);
    for (const [seat, runtime] of Object.entries(presets[preset])) {
      if (runtime === "pi") console.log(`${seat.replace(/\./g, "-")}@${rigName}`);
    }
  ' "$1" "$PRESET" "$2"
}

DELIVERY_SEATS="$(read_preset_seats "$OPENRIG_SOURCE_DIR/configurations.yaml" agentflow)" || exit 1
PRODUCT_SEATS="$(read_preset_seats "$PRODUCT_SOURCE_DIR/configurations.yaml" agentflow-product)" || exit 1
PRESET="$(printf '%s\n' "$DELIVERY_SEATS" | head -n 1)"
PRODUCT_PRESET="$(printf '%s\n' "$PRODUCT_SEATS" | head -n 1)"
if [ "$PRESET" != "$PRODUCT_PRESET" ]; then
  echo "ERROR: Delivery preset '$PRESET' and product preset '$PRODUCT_PRESET' differ." >&2
  exit 1
fi
PI_SEATS=()
while IFS= read -r seat; do
  [ -n "$seat" ] && PI_SEATS+=("$seat")
done < <({
  printf '%s\n' "$DELIVERY_SEATS" | tail -n +2
  printf '%s\n' "$PRODUCT_SEATS" | tail -n +2
})

# A linked worktree has a .git file, not a directory, so ask Git instead of testing for .git/.
if [ -n "$TARGET_REPO" ] &&
  [ "$(git -C "$TARGET_REPO" rev-parse --is-inside-work-tree 2>/dev/null)" != "true" ]; then
  echo "ERROR: '$TARGET_REPO' is not a Git repository." >&2
  exit 1
fi

echo "==> Preset: $PRESET (Pi seats: ${PI_SEATS[*]:-none})"

echo "==> 1. Syncing AgentFlow delivery and product bases to the OpenRig user library..."
mkdir -p "$TARGET_SPEC_DIR" "$PRODUCT_SPEC_DIR"
cp -r "$OPENRIG_SOURCE_DIR"/* "$TARGET_SPEC_DIR"/
cp -r "$PRODUCT_SOURCE_DIR"/* "$PRODUCT_SPEC_DIR"/

echo "==> 2. Ensuring Pi state bridges for Grok 4.7 seats..."
if [ ${#PI_SEATS[@]} -eq 0 ]; then
  echo "   (Preset '$PRESET' has no Pi seats; skipping.)"
fi
# The ${arr[@]+...} form keeps an empty array safe under set -u on bash 3.2.
for seat in ${PI_SEATS[@]+"${PI_SEATS[@]}"}; do
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
if [ ${#PI_SEATS[@]} -eq 0 ]; then
  echo "   (Preset '$PRESET' has no Pi seats; skipping.)"
elif [ -f "$HOME/.pi/agent/auth.json" ]; then
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

echo "==> AgentFlow SDLC bases installed successfully!"
echo "    Delivery base: rig up agentflow --cwd /path/to/project"
echo "    Product base:  rig up agentflow-product --cwd /path/to/project"
echo "    Per-project copies: adapters/openrig/scripts/spawn-squad.sh --kind delivery|product <name> <path>"
