#!/usr/bin/env node
import { spawnSync } from 'node:child_process'
const args = process.argv.slice(2)
const passthrough = ['scripts/validate-pr-manifest.mjs', ...args]
const result = spawnSync(process.execPath, passthrough, { stdio: 'inherit' })
process.exit(result.status ?? 1)
