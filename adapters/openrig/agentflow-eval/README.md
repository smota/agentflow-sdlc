# AgentFlow Evaluation Rig (`agentflow-eval`)

The dedicated out-of-band evaluation and dogfooding squad for autonomous AgentFlow SDLC projects.

## Overview

The `eval.tester` seat continuously exercises shipped increments on trunk against golden user journeys, CLI stress scenarios, and exploratory edge cases. It emits empirical intake findings into `.agentflow/intake/finding-<id>.json` which feed the backlog intake queue (`triage:intake`).

## Quick Start

```bash
# Start the evaluation squad
rig up agentflow-eval --cwd /path/to/project

# Check status
rig ps --nodes --rig agentflow-eval

# Provision a per-project squad
agentflow-sdlc adapters squads provision openrig --kind eval <project> <path>
```

A repository joins the existing evaluation spec with a workspace catalog entry and `rig up <spec> --name <rig> --cwd <repo>`. Eval provisioning uses the existing `agentflow-eval` base rather than a new topology per repository. The provision command above stays available.
