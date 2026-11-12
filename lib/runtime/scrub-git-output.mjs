// Makes git's own words safe to send to a person (#584): no absolute paths, home directories,
// remote URLs, credentials or tokens.
import { homedir } from 'node:os'

// Turns git's own words into something safe to send to a person.
export function scrubReason(text, { roots = [], remoteUrls = [] } = {}) {
  let out = String(text)
  for (const url of remoteUrls.filter(Boolean)) out = out.split(url).join('<remote>')
  // URLs first (they swallow any credential in them), then bare tokens, scheme-less `user:secret@host`, scp-like
  // remotes and Authorization headers.
  out = out.replace(/\bauthorization:[ \t]*\S+(?:[ \t]+\S+)?/gi, 'authorization: <redacted>')
  out = out.replace(/\b[a-z][a-z0-9+.-]*:\/\/[^\s'"<>)]+/gi, '<url>')
  out = out.replace(/\b(?:gh[pousr]_|github_pat_)\w+/g, '<token>')
  out = out.replace(/[^\s'"/@:]+:[^\s'"/@]+@[\w.-]+(?:[:/][^\s'"]*)?/g, '<remote>')
  out = out.replace(/\b[\w.-]+@[\w.-]+:[^\s'"]+/g, '<remote>')
  for (const root of [...new Set(roots.filter(Boolean))].sort((a, b) => b.length - a.length)) {
    out = out.split(`${root}/`).join('').split(root).join('.')
  }
  // A Windows profile path, with either slash.
  out = out.replace(/\b[A-Za-z]:[\\/]+Users[\\/]+[^\\/\s'"]+/gi, '~')
  const home = homedir()
  if (home && home.length > 1) out = out.split(home).join('~')
  return out
}
