// Reads the canonical seat table. Kept out of lib/core, which does no file I/O.
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

export function loadSeatTable(packageRoot = process.cwd()) {
  return JSON.parse(readFileSync(resolve(packageRoot, 'manifests/seats.json'), 'utf8'))
}
