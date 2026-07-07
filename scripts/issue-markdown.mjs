import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

/**
 * Pure transform: replaces (or appends) a `## <sectionName>` section in a
 * GitHub issue/PR markdown body. Mirrors `replace_markdown_section` from the
 * removed apps/cli/src/commands/issue_markdown.rs.
 *
 * Callers make the actual GitHub API call with their own native tooling
 * (`gh issue edit --body-file -` for Codex/Agy, `mcp__github__issue_write`
 * for Claude Code) using the string this function returns.
 */
export function replaceMarkdownSection(body, sectionName, replacement, createIfMissing = false) {
  const normalizedSection = sectionName.trim()
  if (normalizedSection === '') {
    throw new Error('Section name cannot be empty.')
  }

  const lines = body.split('\n')
  const headingLine = `## ${normalizedSection}`
  const startIndex = lines.findIndex((line) => line.trim() === headingLine)

  const normalizedReplacement = replacement.replace(/^\n+|\n+$/g, '')

  if (startIndex !== -1) {
    let endIndex = lines.length
    for (let i = startIndex + 1; i < lines.length; i++) {
      if (lines[i].startsWith('## ')) {
        endIndex = i
        break
      }
    }

    const newLines = [...lines.slice(0, startIndex + 1)]
    if (normalizedReplacement !== '') {
      newLines.push('', ...normalizedReplacement.split('\n'))
    }
    newLines.push('', ...lines.slice(endIndex))

    return `${trimTrailingBlankLines(newLines).join('\n')}\n`
  }

  if (createIfMissing) {
    let newBody = body.replace(/\n+$/, '')
    if (newBody !== '') {
      newBody += '\n\n'
    }
    newBody += headingLine
    if (normalizedReplacement !== '') {
      newBody += `\n\n${normalizedReplacement}`
    }
    return `${newBody}\n`
  }

  throw new Error(
    `Section '${normalizedSection}' was not found. Pass --create-if-missing to append it.`,
  )
}

function trimTrailingBlankLines(lines) {
  const trimmed = [...lines]
  while (trimmed.length > 0 && trimmed[trimmed.length - 1] === '') {
    trimmed.pop()
  }
  return trimmed
}

function readStdin() {
  return readFileSync(0, 'utf8')
}

function main() {
  const args = process.argv.slice(2)
  const bodyFlagIndex = args.indexOf('--body')
  const sectionFlagIndex = args.indexOf('--section')
  const replacementFlagIndex = args.indexOf('--replacement')
  const createIfMissing = args.includes('--create-if-missing')

  if (sectionFlagIndex === -1 || replacementFlagIndex === -1) {
    process.stderr.write(
      'usage: node scripts/issue-markdown.mjs --section <name> --replacement <file> [--body <file>] [--create-if-missing]\n' +
        '  (reads the current body from stdin if --body is omitted)\n',
    )
    process.exit(2)
  }

  const body = bodyFlagIndex !== -1 ? readFileSync(args[bodyFlagIndex + 1], 'utf8') : readStdin()
  const section = args[sectionFlagIndex + 1]
  const replacement = readFileSync(args[replacementFlagIndex + 1], 'utf8')

  try {
    const updated = replaceMarkdownSection(body, section, replacement, createIfMissing)
    process.stdout.write(updated)
  } catch (error) {
    process.stderr.write(`[issue-markdown] ${error.message}\n`)
    process.exit(1)
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main()
}
