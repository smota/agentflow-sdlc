#!/usr/bin/env node
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { startMcpStdioServer } from '../lib/mcp/server.mjs'

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
startMcpStdioServer({ packageRoot, targetDir: process.cwd() })
