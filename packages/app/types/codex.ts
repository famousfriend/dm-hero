/**
 * Reference Codex identifiers and markdown tokens, shared by app and server.
 *
 * uid:   "<kind>:<slug>|<source>"            e.g. spell:fireball|phb
 * token: "{{codex:<kind>:<slug>|<source>}}"  e.g. {{codex:spell:fireball|phb}}
 *
 * The slug is the lower-cased display name, so the 5e.tools deep link
 * (`page.html#<name>_<source>`) can be derived from the uid alone.
 * The token never matches the entity mention pattern `{{type:id}}`
 * (id is numeric) or MCP's `{{ref:...}}`.
 */

export const CODEX_KINDS = ['spell', 'monster', 'condition', 'item', 'feat', 'rule'] as const
export type CodexKind = (typeof CODEX_KINDS)[number]

export interface CodexUid {
  kind: string
  slug: string
  source: string
}

export interface CodexEntrySummary {
  uid: string
  kind: string
  name: string
  summary: string | null
  sourceCode: string
}

export interface CodexEntry extends CodexEntrySummary {
  body: string | null
  data: Record<string, unknown> | null
  externalUrl: string | null
  sourceTitle: string
  license: string
  attribution: string | null
}

// Characters a slug may contain. Kept narrow on purpose: everything here is
// safe inside HTML text and attributes without escaping (no & < > " or braces).
const SLUG_CHARS = 'a-z0-9\' /(),.\\-'
const UID_PATTERN = `([a-z]+):([${SLUG_CHARS}]+)\\|([a-z0-9]+)`

export const CODEX_UID_REGEX = new RegExp(`^${UID_PATTERN}$`)

/** Global regex for tokens; create a fresh one per use (it is stateful). */
export function codexTokenRegex(): RegExp {
  return new RegExp(`\\{\\{codex:${UID_PATTERN}\\}\\}`, 'g')
}

export function slugify(name: string): string {
  return name
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[‘’]/g, '\'')
    .toLowerCase()
    .replace(/[^a-z0-9' /(),.-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

export function buildUid(kind: string, name: string, source: string): string {
  return `${kind}:${slugify(name)}|${source.toLowerCase()}`
}

export function parseUid(uid: string): CodexUid | null {
  const match = CODEX_UID_REGEX.exec(uid)
  if (!match) return null
  return { kind: match[1]!, slug: match[2]!, source: match[3]! }
}

export function codexToken(uid: string): string {
  return `{{codex:${uid}}}`
}

/** Unique uids referenced by codex tokens in a markdown text, in order of appearance. */
export function extractCodexUids(markdown: string | null | undefined): string[] {
  if (!markdown) return []
  const seen = new Set<string>()
  for (const match of markdown.matchAll(codexTokenRegex())) {
    seen.add(`${match[1]}:${match[2]}|${match[3]}`)
  }
  return [...seen]
}

/** Fallback display name when the entry itself is not loaded: "ancient red dragon" -> "Ancient Red Dragon". */
export function nameFromSlug(slug: string): string {
  return slug.replace(/(^|[\s/(-])([a-z])/g, (_m, sep: string, ch: string) => sep + ch.toUpperCase())
}

const EXTERNAL_PAGES: Record<string, string> = {
  spell: 'spells.html',
  monster: 'bestiary.html',
  condition: 'conditionsdiseases.html',
  item: 'items.html',
  feat: 'feats.html',
}
const EXTERNAL_SOURCES = new Set(['phb', 'mm', 'dmg', 'xge', 'tce', 'vgm', 'mtf', 'scag', 'ftd', 'mpmm'])

/**
 * 2014.5e.tools deep link for an entry, or null when there is no matching page
 * (e.g. homebrew, or SRD-only names). Link only; we never fetch from it.
 */
export function externalUrl(uid: string): string | null {
  const parsed = parseUid(uid)
  if (!parsed) return null
  const page = EXTERNAL_PAGES[parsed.kind]
  if (!page || !EXTERNAL_SOURCES.has(parsed.source)) return null
  return `https://2014.5e.tools/${page}#${encodeURIComponent(parsed.slug)}_${parsed.source}`
}
