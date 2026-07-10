#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'
import { discoverExtensionPacks, loadExtensionPack } from '../lib/extension-packs.mjs'

const [command, value] = process.argv.slice(2)

function usage() {
  console.log(`Usage:
  node scripts/extension-pack.mjs list
  node scripts/extension-pack.mjs inspect <pack-dir>
  node scripts/extension-pack.mjs scaffold <pack-dir> <id>
`)
}

if (!command || command === '--help' || command === '-h') {
  usage()
  process.exit(0)
}

if (command === 'list') {
  const packs = discoverExtensionPacks(process.cwd())
  if (!packs.length) {
    console.log('No extension packs discovered under extensions/ or contrib/.')
    process.exit(0)
  }
  for (const pack of packs)
    console.log(`${pack.manifest.id}\t${pack.manifest.kind}\t${pack.relativeDir}`)
  process.exit(0)
}

if (command === 'inspect') {
  if (!value) {
    usage()
    process.exit(1)
  }
  const pack = loadExtensionPack(value, process.cwd())
  console.log(JSON.stringify({ dir: pack.relativeDir, manifest: pack.manifest }, null, 2))
  process.exit(0)
}

if (command === 'scaffold') {
  const id = process.argv[4]
  if (!value || !id) {
    usage()
    process.exit(1)
  }
  const dir = path.resolve(process.cwd(), value)
  fs.mkdirSync(path.join(dir, 'templates'), { recursive: true })
  fs.mkdirSync(path.join(dir, 'tools'), { recursive: true })
  fs.mkdirSync(path.join(dir, 'validators'), { recursive: true })
  fs.writeFileSync(
    path.join(dir, 'extension-pack.yaml'),
    `id: ${id}\nkind: engineering-approach\nversion: 0.1.0\ndescription: Repository-local engineering approach extension pack.\nprinciples: principles.md\ndocumentation:\n  - README.md\nrequiredSkills: []\nrequiredCapabilities: []\ntemplates: []\ntools: []\nvalidators: []\n`,
  )
  fs.writeFileSync(
    path.join(dir, 'README.md'),
    `# ${id}\n\nDescribe the extension pack, when it applies, and how it changes SDLC role-pass expectations.\n`,
  )
  fs.writeFileSync(
    path.join(dir, 'principles.md'),
    `# Principles\n\n- State the engineering approach principles enforced by this pack.\n`,
  )
  console.log(`Scaffolded ${path.relative(process.cwd(), dir)}`)
  process.exit(0)
}

usage()
process.exit(1)
