// Shared markdown-section/field/table parsing used by PR-manifest and role-attribution
// validators. Kept dependency-free so it can run against PR manifests, workflow-status
// comments, and handover comments alike.

function escapeRegExp(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * Extract the body of a `## Heading` (or `### Heading` when `level` is 3) section, up to the
 * next heading of the same level. Returns null when the heading is not present.
 */
export function extractSection(content, heading, level = 2) {
  const hashes = '#'.repeat(level)
  const headingRe = new RegExp(`^${hashes}\\s+${escapeRegExp(heading)}\\s*$`, 'm')
  const match = headingRe.exec(content)
  if (match === null) {
    return null
  }

  const start = match.index + match[0].length
  const rest = content.slice(start)
  const nextHeadingRe = new RegExp(`^${hashes}\\s+`, 'm')
  const nextHeading = rest.search(nextHeadingRe)
  return (nextHeading === -1 ? rest : rest.slice(0, nextHeading)).trim()
}

export function hasSection(content, heading, level = 2) {
  return extractSection(content, heading, level) !== null
}

/**
 * Read a `- Label: value` or `**Label:** value` field out of a section body.
 */
export function fieldValue(section, label) {
  if (section === null || section === undefined) {
    return null
  }

  const escaped = escapeRegExp(label)
  const bulletMatch = section.match(new RegExp(`^-\\s+${escaped}:\\s*(.+)$`, 'm'))
  if (bulletMatch) {
    return bulletMatch[1].trim()
  }
  const boldMatch = section.match(new RegExp(`^\\*\\*${escaped}:?\\*\\*:?\\s*(.+)$`, 'm'))
  return boldMatch?.[1]?.trim() ?? null
}

function splitTableRow(line) {
  return line
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map((cell) => cell.trim())
}

/**
 * Parse a GitHub-flavored markdown table (header, separator, data rows) out of a section body.
 * Returns `{ header, rows }` where `rows` is an array of raw cell-string arrays, or null when no
 * table is present.
 */
export function parseMarkdownTable(section) {
  if (!section) {
    return null
  }

  const tableLines = section
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.startsWith('|'))

  if (tableLines.length < 2) {
    return null
  }

  const header = splitTableRow(tableLines[0])
  const rows = tableLines.slice(2).map(splitTableRow)
  return { header, rows }
}
