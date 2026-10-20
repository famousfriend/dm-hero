/*
 * "Import my notes" (DM Command Center M11b): the DM's own notes as Markdown
 * (typed, pasted, or read from a Word file) are split at their headings, and
 * each part gets a guessed type that the DM checks before anything is saved.
 * No AI: notes without headings or PDFs are what the Claude import is for.
 * Pure functions, so they run in the browser and in tests.
 */

export type NoteKind = 'NPC' | 'Location' | 'Item' | 'Faction' | 'Lore' | 'Quest' | 'Session' | 'skip'
export const NOTE_KINDS: NoteKind[] = ['NPC', 'Location', 'Item', 'Faction', 'Lore', 'Quest', 'Session', 'skip']

export interface NoteSection {
  /** Position in the file, stable while reviewing */
  index: number
  title: string
  level: number
  /** Text under the heading, without its sub-sections */
  body: string
  /** Headings above it, outermost first */
  path: string[]
  hasChildren: boolean
  kind: NoteKind
  /** "Session 3" -> 3 */
  sessionNumber: number | null
}

// ------------------------------------------------------------------ Word files

const XML_ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: '\'' }
const decodeXml = (text: string) => text.replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (whole, code: string) => {
  if (code[0] === '#') return String.fromCodePoint(code[1]?.toLowerCase() === 'x' ? Number.parseInt(code.slice(2), 16) : Number(code.slice(1)))
  return XML_ENTITIES[code] ?? whole
})

/** Heading level per Word style id, from styles.xml ("heading 2" is named in English in every Word language) */
export function docxHeadingStyles(stylesXml: string): Map<string, number> {
  const levels = new Map<string, number>()
  for (const match of stylesXml.matchAll(/<w:style\b[^>]*w:styleId="([^"]+)"[^>]*>([\s\S]*?)<\/w:style>/g)) {
    const [, id, inner] = match
    const name = inner!.match(/<w:name w:val="([^"]+)"/)?.[1]?.toLowerCase() ?? ''
    const outline = inner!.match(/<w:outlineLvl w:val="(\d)"/)?.[1]
    const heading = name.match(/^heading (\d)$/)?.[1]
    if (name === 'title') levels.set(id!, 1)
    else if (heading) levels.set(id!, Number(heading))
    else if (outline !== undefined) levels.set(id!, Number(outline) + 1)
  }
  return levels
}

/** word/document.xml -> Markdown with headings and list items; other formatting is dropped */
export function docxToMarkdown(documentXml: string, headingStyles = new Map<string, number>()): string {
  const lines: string[] = []
  const body = documentXml.match(/<w:body>([\s\S]*)<\/w:body>/)?.[1] ?? documentXml
  for (const [paragraph] of body.matchAll(/<w:p\b[\s\S]*?<\/w:p>/g)) {
    const style = paragraph.match(/<w:pStyle w:val="([^"]+)"/)?.[1]
    const outline = paragraph.match(/<w:pPr>[\s\S]*?<w:outlineLvl w:val="(\d)"/)?.[1]
    const level = (style && (headingStyles.get(style) ?? Number(style.match(/^Heading(\d)$/i)?.[1] ?? 0))) || (outline !== undefined ? Number(outline) + 1 : 0)
    const text = decodeXml([...paragraph.matchAll(/<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>|<w:tab\/>|<w:br\/>/g)]
      .map(m => (m[0] === '<w:tab/>' ? ' ' : m[0] === '<w:br/>' ? '\n' : m[1]))
      .join('')).trim()
    if (!text) {
      lines.push('')
      continue
    }
    if (level >= 1 && level <= 6) lines.push('', `${'#'.repeat(level)} ${text.replace(/\n/g, ' ')}`, '')
    else if (/<w:numPr>/.test(paragraph)) lines.push(`- ${text}`)
    else lines.push(text, '')
  }
  return lines.join('\n').replace(/\n{3,}/g, '\n\n').trim()
}

// ------------------------------------------------------------------ splitting

const HEADING = /^(#{1,6})\s+(.+?)\s*#*\s*$/
// A line that is only bold text works as a name heading in many notes ("**Klarg**")
const BOLD_LINE = /^\*\*([^*]{1,80})\*\*:?\s*$/
// ...and so does a list item that starts with a bold name ("- **Sildar**: a human fighter")
const BOLD_ITEM = /^\s*[-*+]\s+\*\*([^*]{1,80}?):?\*\*\s*[:–—-]?\s*(.*)$/

const clean = (title: string) => title.replace(/[*_`]/g, '').replace(/\s+/g, ' ').trim()

/** Splits Markdown at its headings into sections with their place in the outline, and guesses each type */
export function splitNotes(markdown: string): NoteSection[] {
  const sections: NoteSection[] = []
  const stack: NoteSection[] = []
  let current: NoteSection | null = null
  const lines = markdown.replace(/\r\n?/g, '\n').split('\n')
  let preface = ''

  const open = (title: string, level: number) => {
    while (stack.length && stack[stack.length - 1]!.level >= level) stack.pop()
    const parent = stack[stack.length - 1]
    if (parent) parent.hasChildren = true
    current = { index: sections.length, title: clean(title), level, body: '', path: stack.map(s => s.title), hasChildren: false, kind: 'skip', sessionNumber: null }
    sections.push(current)
    stack.push(current)
  }

  // Bold-line names sit one level below the last real heading
  let headingLevel = 0
  for (const line of lines) {
    const heading = line.match(HEADING)
    const bold = !heading && (line.match(BOLD_LINE) ?? line.match(BOLD_ITEM))
    if (heading) {
      headingLevel = heading[1]!.length
      open(heading[2]!, headingLevel)
    }
    else if (bold) {
      open(bold[1]!, headingLevel + 1)
      if (bold[2]) (current as unknown as NoteSection).body += `${bold[2]}\n`
    }
    else if (current) (current as NoteSection).body += `${line}\n`
    else preface += `${line}\n`
  }
  for (const section of sections) {
    section.body = section.body.replace(/^\n+|\s+$/g, '')
    section.sessionNumber = sessionNumberOf(section.title)
    section.kind = guessKind(section)
  }
  // Text before the first heading is kept as one lore part, unticked by default
  if (preface.trim()) {
    sections.unshift({ index: -1, title: '', level: 0, body: preface.trim(), path: [], hasChildren: false, kind: 'skip', sessionNumber: null })
    sections.forEach((s, i) => (s.index = i))
  }
  return sections
}

// ------------------------------------------------------------------ guessing

/** Group headings that say what the parts below them are (English and German) */
const GROUP_WORDS: Array<[Exclude<NoteKind, 'skip'>, RegExp]> = [
  ['Session', /^(sessions?|session (notes|log)|recaps?|game log|sitzungen|spielabende|spielberichte)$/i],
  ['NPC', /^(npcs?|non[- ]player characters?|characters|people|cast|personen|charaktere|nscs?|figuren)$/i],
  ['Location', /^(locations?|places?|areas?|regions?|settlements?|towns?|cities|dungeons?|orte|schauplätze|regionen|städte)$/i],
  ['Item', /^(items?|magic items?|treasures?|loot|equipment|artifacts?|gegenstände|schätze|beute|magische gegenstände)$/i],
  ['Faction', /^(factions?|organi[sz]ations?|guilds?|groups|clans?|fraktionen|gilden|organisationen)$/i],
  ['Quest', /^(quests?|(plot )?hooks?|adventures?|missions?|jobs|side quests?|aufträge|abenteuer|questen)$/i],
  ['Lore', /^(lore|history|background|world|legends?|myths?|religion|gods|deities|hintergrund|geschichte|welt|legenden)$/i],
]

const SESSION_TITLE = /^(session|sitzung|spielabend|game night|episode|ep\.?|s)\s*#?\s*(\d{1,4})\b/i
export function sessionNumberOf(title: string): number | null {
  const match = title.match(SESSION_TITLE)
  return match ? Number(match[2]) : null
}

const groupKind = (title: string) => GROUP_WORDS.find(([, re]) => re.test(title.replace(/[:.]$/, '').trim()))?.[0] ?? null

/** Session titles win; otherwise the nearest group heading above decides; the rest is lore */
export function guessKind(section: Pick<NoteSection, 'title' | 'path' | 'body' | 'hasChildren'>): NoteKind {
  if (sessionNumberOf(section.title) !== null) return 'Session'
  // A group heading itself ("NPCs") holds the others, it isn't one
  if (groupKind(section.title) && (section.hasChildren || !section.body)) return 'skip'
  for (let i = section.path.length - 1; i >= 0; i--) {
    const kind = groupKind(section.path[i]!)
    if (kind) return kind
  }
  if (!section.body) return 'skip'
  return 'Lore'
}

// ------------------------------------------------------------------ links

export interface LinkTarget {
  name: string
  /** What replaces the first mention, e.g. "{{ref:n3}}" or "{{npc:12}}" */
  token: string
}

const escapeRe = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/**
 * Turns the first mention of each known name into a link. Longer names first
 * ("Glasstaff's Tower" before "Glasstaff"), whole words only, never inside an
 * existing {{...}} link or a Markdown link, never the part's own name.
 */
export function linkMentions(text: string, targets: LinkTarget[], ownName = ''): string {
  let result = text
  const sorted = targets
    .filter(t => t.name.trim().length >= 3 && t.name.toLowerCase() !== ownName.toLowerCase())
    .sort((a, b) => b.name.length - a.name.length)
  for (const target of sorted) {
    const re = new RegExp(`(?<![\\p{L}\\p{N}])${escapeRe(target.name.trim())}(?![\\p{L}\\p{N}])`, 'u')
    // Skip mentions inside {{...}} or [...](...)
    const protectedRanges = [...result.matchAll(/\{\{[^}]*\}\}|\[[^\]]*\]\([^)]*\)/g)].map(m => [m.index!, m.index! + m[0].length])
    let offset = 0
    let match: RegExpExecArray | null
    while ((match = re.exec(result.slice(offset)))) {
      const start = offset + match.index
      if (!protectedRanges.some(([a, b]) => start >= a! && start < b!)) {
        result = result.slice(0, start) + target.token + result.slice(start + match[0].length)
        break
      }
      offset = start + match[0].length
    }
  }
  return result
}

/** Link key per type, as used in {{npc:12}} */
export const LINK_KEYS: Record<string, string> = { NPC: 'npc', Location: 'location', Item: 'item', Faction: 'faction', Lore: 'lore', Quest: 'quest', Player: 'player' }
