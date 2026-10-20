import { readFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import type Database from 'better-sqlite3'
import { Marked } from 'marked'
import sharp from 'sharp'
import { SHARE_TYPE_CONFIG, SHARE_TYPES, type BuiltField, type LocalizedText, type ShareType } from '~~/types/share'
import { translateAll } from './i18n'
import { SHARE_KINDS } from './registry'
import { getUploadPath } from '../paths'

/*
 * Player handout as ONE html file (DM Command Center M10): works offline, can be
 * printed or sent to players. What goes in is decided by the same field
 * policies as the online game table (kinds/*.ts) - private fields can't be
 * picked - and names use the table's aliases, so nothing leaks that the live
 * table wouldn't show either.
 */

const LOCALES = ['en', 'de', 'es', 'fr', 'it', 'zh-CN'] as const
type Locale = (typeof LOCALES)[number]

export class PlayerExportError extends Error {
  constructor(public statusCode: number, message: string) {
    super(message)
  }
}

export interface PlayerExportCandidate {
  type: ShareType
  id: number
  name: string
  /** Alias players see at the game table, if any */
  alias: string | null
  /** Already shared at the game table (preselected) */
  shared: boolean
}

export interface PlayerExportRequest {
  title?: unknown
  locale?: unknown
  /** Picked entries */
  items?: unknown
  /** Ticked fields per type */
  fields?: unknown
}

const tableOf = (db: Database.Database, campaignId: number) =>
  (db.prepare('SELECT id FROM game_tables WHERE campaign_id = ?').get(campaignId) as { id: number } | undefined)?.id ?? 0

/** Everything that could go into a handout, with what the game table already shares */
export function listPlayerExportCandidates(db: Database.Database, campaignId: number): PlayerExportCandidate[] {
  const tableId = tableOf(db, campaignId)
  const byEntityType = new Map(SHARE_TYPES.map(type => [SHARE_TYPE_CONFIG[type].entityType as string, type]))
  const rows = db.prepare(`
    SELECT e.id, e.name, t.name AS type_name, s.id AS share_id, s.display_name
    FROM entities e
    JOIN entity_types t ON t.id = e.type_id
    LEFT JOIN game_table_shares s ON s.entity_id = e.id AND s.game_table_id = ?
    WHERE e.campaign_id = ? AND e.deleted_at IS NULL
    ORDER BY e.name COLLATE NOCASE
  `).all(tableId, campaignId) as Array<{ id: number, name: string, type_name: string, share_id: number | null, display_name: string | null }>
  return rows
    .filter(row => byEntityType.has(row.type_name))
    .map(row => ({ type: byEntityType.get(row.type_name)!, id: row.id, name: row.name, alias: row.display_name, shared: row.share_id != null }))
}

const escapeHtml = (text: string) => text
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&#39;')

const SAFE_LINK = /^(https?:|mailto:)/i

// Raw HTML in the DM's text is shown as text, links only to the web, and
// pictures inside text are dropped (they point at files on the DM's computer)
const markdown = new Marked({
  gfm: true,
  breaks: true,
  renderer: {
    html({ text }) {
      return escapeHtml(text)
    },
    link({ href, title, tokens }) {
      const label = this.parser.parseInline(tokens)
      if (!SAFE_LINK.test(href)) return label
      return `<a href="${escapeHtml(href)}"${title ? ` title="${escapeHtml(title)}"` : ''} target="_blank" rel="noopener noreferrer">${label}</a>`
    },
    image({ text }) {
      return escapeHtml(text)
    },
  },
})

export function renderPlayerMarkdown(text: string): string {
  return markdown.parse(text, { async: false })
}

function pick(text: LocalizedText | undefined, locale: Locale): string {
  if (text == null) return ''
  if (typeof text === 'string') return text
  return text[locale] ?? text.en ?? Object.values(text)[0] ?? ''
}

/** Entity image -> small webp inside the file. Missing or broken images are left out. */
async function embedImage(source: string): Promise<string | null> {
  const root = resolve(getUploadPath())
  const path = resolve(join(root, source))
  if (!path.startsWith(root)) return null
  try {
    const data = await sharp(await readFile(path)).rotate().resize({ width: 640, withoutEnlargement: true }).webp({ quality: 78 }).toBuffer()
    return `data:image/webp;base64,${data.toString('base64')}`
  }
  catch {
    return null
  }
}

function parseRequest(db: Database.Database, campaignId: number, request: PlayerExportRequest) {
  const locale: Locale = LOCALES.includes(request.locale as Locale) ? request.locale as Locale : 'en'
  const items = Array.isArray(request.items) ? request.items : []
  const fields = (request.fields && typeof request.fields === 'object' ? request.fields : {}) as Record<string, unknown>
  const allowed = new Map(listPlayerExportCandidates(db, campaignId).map(c => [`${c.type}:${c.id}`, c]))

  const picked: PlayerExportCandidate[] = []
  for (const item of items as Array<{ type?: unknown, id?: unknown }>) {
    const candidate = allowed.get(`${item?.type}:${item?.id}`)
    if (candidate && !picked.includes(candidate)) picked.push(candidate)
  }
  if (!picked.length) throw new PlayerExportError(400, 'Pick at least one entry')

  const ticked = (type: ShareType) => {
    const list = Array.isArray(fields[type]) ? (fields[type] as unknown[]).map(String) : []
    return list.filter(field => SHARE_KINDS[type]!.fields.includes(field))
  }
  const title = String(request.title ?? '').trim().slice(0, 120)
  return { locale, picked, ticked, title }
}

/** The handout itself: one html file with styles and images inside */
export async function buildPlayerExport(db: Database.Database, campaignId: number, request: PlayerExportRequest): Promise<string> {
  const campaign = db.prepare('SELECT name FROM campaigns WHERE id = ?').get(campaignId) as { name: string } | undefined
  if (!campaign) throw new PlayerExportError(404, 'Campaign not found')
  const { locale, picked, ticked, title: chosenTitle } = parseRequest(db, campaignId, request)
  const tableId = tableOf(db, campaignId)
  const title = chosenTitle || campaign.name

  const sections: string[] = []
  const contents: string[] = []
  for (const type of SHARE_TYPES) {
    const kind = SHARE_KINDS[type]!
    const fields = ticked(type)
    const articles: string[] = []
    for (const candidate of picked.filter(c => c.type === type)) {
      const built = kind.build(db, candidate.id, fields, { tableId })
      if (!built) continue
      articles.push(await renderArticle(candidate, candidate.alias ?? built.title, built.fields, locale))
    }
    if (!articles.length) continue
    const heading = escapeHtml(pick(translateAll(kind.typeLabel), locale) || type)
    contents.push(`<a href="#${type}">${heading}</a>`)
    sections.push(`<section id="${type}"><h2>${heading}</h2>${articles.join('')}</section>`)
  }

  return `<!doctype html>
<html lang="${locale}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>${STYLES}</style>
</head>
<body>
<header><h1>${escapeHtml(title)}</h1><nav>${contents.join('')}</nav></header>
<main>${sections.join('')}</main>
</body>
</html>
`
}

async function renderArticle(candidate: PlayerExportCandidate, name: string, fields: BuiltField[], locale: Locale): Promise<string> {
  let image = ''
  const facts: string[] = []
  const texts: string[] = []
  for (const field of fields) {
    const label = escapeHtml(pick(field.label, locale))
    if (field.format === 'image') {
      const src = await embedImage(field.source)
      if (src) image = `<img src="${src}" alt="">`
    }
    else if (field.format === 'markdown') {
      texts.push(`<div class="text">${renderPlayerMarkdown(pick(field.value, locale))}</div>`)
    }
    else {
      facts.push(`<dt>${label}</dt><dd>${escapeHtml(pick(field.value, locale))}</dd>`)
    }
  }
  return `<article id="${candidate.type}-${candidate.id}">${image}<h3>${escapeHtml(name)}</h3>${facts.length ? `<dl>${facts.join('')}</dl>` : ''}${texts.join('')}</article>`
}

const STYLES = `
:root{color-scheme:light dark;--bg:#faf7f2;--card:#fff;--text:#2b2620;--muted:#6f655a;--line:#e3dbcf;--accent:#8a3b2e}
@media (prefers-color-scheme:dark){:root{--bg:#1d1a17;--card:#27231f;--text:#ece6dc;--muted:#a99f92;--line:#3a342d;--accent:#e08a74}}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--text);font:16px/1.55 Georgia,"Times New Roman",serif}
header,main{max-width:860px;margin:0 auto;padding:24px 16px}
header{padding-bottom:0}
h1{font-size:2rem;margin:0 0 8px;color:var(--accent)}
nav{display:flex;flex-wrap:wrap;gap:8px 16px}
nav a{color:var(--accent)}
h2{border-bottom:2px solid var(--accent);padding-bottom:4px;margin-top:32px}
article{background:var(--card);border:1px solid var(--line);border-radius:8px;padding:16px;margin:16px 0;overflow:hidden;break-inside:avoid}
article img{float:right;max-width:40%;max-height:260px;margin:0 0 8px 16px;border-radius:6px}
h3{margin:0 0 8px;font-size:1.3rem}
dl{display:grid;grid-template-columns:max-content 1fr;gap:2px 12px;margin:0 0 8px}
dt{color:var(--muted)}
dd{margin:0}
.text p{margin:0 0 8px}
a{color:var(--accent)}
@media (max-width:560px){article img{float:none;display:block;max-width:100%;margin:0 0 8px}}
@media print{body{background:#fff;color:#000}article{border-color:#ccc}nav{display:none}}
`

/**
 * GET  /api/campaigns/:id/player-export   what could go in
 * POST /api/campaigns/:id/player-export   { title?, locale, items: [{type, id}], fields: {type: [field]} } -> html
 */
export async function handlePlayerExportRequest(db: Database.Database, method: string, campaignId: number, body: PlayerExportRequest | null) {
  if (method === 'GET') return listPlayerExportCandidates(db, campaignId)
  if (method === 'POST') return buildPlayerExport(db, campaignId, body ?? {})
  throw new PlayerExportError(405, 'Method not allowed')
}
