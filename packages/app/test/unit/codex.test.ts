import { describe, it, expect, beforeAll } from 'vitest'
import type Database from 'better-sqlite3'
import { getTestDb } from '../utils/test-db'
import { seedCodex, searchCodex, getCodexEntry, syncRefLinks, getCodexUsages } from '../../server/utils/codex'
import { extractMentionsFromMarkdown } from '../../server/utils/extract-mentions'
import {
  buildUid,
  parseUid,
  slugify,
  codexToken,
  extractCodexUids,
  externalUrl,
  nameFromSlug,
} from '../../types/codex'

describe('codex uid helpers', () => {
  it.each([
    ['Fireball', 'fireball'],
    ['  Ancient   Red Dragon ', 'ancient red dragon'],
    ['Hunter’s Mark', 'hunter\'s mark'],
    ['Antipathy/Sympathy', 'antipathy/sympathy'],
    ['Deep Gnome (Svirfneblin)', 'deep gnome (svirfneblin)'],
    ['Éclair', 'eclair'],
    ['Bad {{name}} <b>', 'bad name b'],
  ])('slugify(%j) = %j', (input, expected) => {
    expect(slugify(input)).toBe(expected)
  })

  it('builds and parses uids round-trip', () => {
    const uid = buildUid('monster', 'Will-o\'-Wisp', 'MM')
    expect(uid).toBe('monster:will-o\'-wisp|mm')
    expect(parseUid(uid)).toEqual({ kind: 'monster', slug: 'will-o\'-wisp', source: 'mm' })
    expect(parseUid('npc:12')).toBeNull()
    expect(parseUid('spell:<script>|phb')).toBeNull()
  })

  it('builds 5e.tools links per kind', () => {
    expect(externalUrl('spell:fireball|phb')).toBe('https://2014.5e.tools/spells.html#fireball_phb')
    expect(externalUrl('monster:ancient red dragon|mm')).toBe(
      'https://2014.5e.tools/bestiary.html#ancient%20red%20dragon_mm',
    )
    expect(externalUrl('condition:grappled|phb')).toBe('https://2014.5e.tools/conditionsdiseases.html#grappled_phb')
    expect(externalUrl('spell:telepathic bond|srd')).toBeNull()
    expect(externalUrl('rule:cover|phb')).toBeNull()
  })

  it('derives a display name from the slug', () => {
    expect(nameFromSlug('ancient red dragon')).toBe('Ancient Red Dragon')
    expect(nameFromSlug('antipathy/sympathy')).toBe('Antipathy/Sympathy')
  })
})

describe('codex token extraction', () => {
  const text = `Cast ${codexToken('spell:fireball|phb')} at the {{npc:3}} and {{ref:npc:goblin}}.
Then ${codexToken('condition:grappled|phb')} and ${codexToken('spell:fireball|phb')} again.`

  it('finds codex tokens, deduped, ignoring mentions and MCP refs', () => {
    expect(extractCodexUids(text)).toEqual(['spell:fireball|phb', 'condition:grappled|phb'])
    expect(extractCodexUids(null)).toEqual([])
  })

  it('does not change entity mention extraction', () => {
    expect(extractMentionsFromMarkdown(text)).toEqual([{ entityId: 3, type: 'npc' }])
  })
})

describe('codex data', () => {
  let db: Database.Database
  let campaignId: number

  beforeAll(() => {
    db = getTestDb()
    seedCodex(db)
    campaignId = Number(db.prepare('INSERT INTO campaigns (name) VALUES (?)').run('Codex Campaign').lastInsertRowid)
  })

  it('seeds SRD conditions, spells and monsters with attribution', () => {
    const counts = db
      .prepare('SELECT kind, COUNT(*) AS n FROM ref_entries GROUP BY kind ORDER BY kind')
      .all() as Array<{ kind: string, n: number }>
    expect(counts).toEqual([
      { kind: 'condition', n: 15 },
      { kind: 'monster', n: 325 },
      { kind: 'spell', n: 319 },
    ])
    const source = db.prepare('SELECT license, attribution FROM ref_sources WHERE code = ?').get('srd51') as {
      license: string
      attribution: string
    }
    expect(source.license).toBe('CC-BY-4.0')
    expect(source.attribution).toContain('System Reference Document 5.1')
  })

  it('is idempotent and keeps FTS in step', () => {
    const before = db.prepare('SELECT COUNT(*) AS n FROM ref_entries').get() as { n: number }
    seedCodex(db)
    db.prepare('UPDATE ref_sources SET version = ? WHERE code = ?').run('old', 'srd51')
    seedCodex(db) // forced re-upsert
    const after = db.prepare('SELECT COUNT(*) AS n FROM ref_entries').get() as { n: number }
    const fts = db.prepare('SELECT COUNT(*) AS n FROM ref_entries_fts').get() as { n: number }
    expect(after.n).toBe(before.n)
    expect(fts.n).toBe(after.n)
  })

  it('finds by prefix, name matches first', () => {
    const results = searchCodex(db, 'fire')
    expect(results[0]?.name).toBe('Fire Bolt')
    expect(results.map(r => r.name)).toContain('Fireball')
    expect(searchCodex(db, 'fireball')[0]).toMatchObject({
      uid: 'spell:fireball|phb',
      kind: 'spell',
      summary: '3rd-level evocation',
      sourceCode: 'srd51',
    })
  })

  it('tolerates typos and filters by kind', () => {
    expect(searchCodex(db, 'firebal')[0]?.name).toBe('Fireball')
    expect(searchCodex(db, 'grapled')[0]?.uid).toBe('condition:grappled|phb')
    const monsters = searchCodex(db, 'dragon', { kind: 'monster', limit: 5 })
    expect(monsters).toHaveLength(5)
    expect(monsters.every(r => r.kind === 'monster')).toBe(true)
    expect(searchCodex(db, '')).toEqual([])
    expect(searchCodex(db, '"*')).toEqual([])
  })

  it('searches the full dataset in under 50 ms', () => {
    const start = performance.now()
    for (const q of ['fire', 'dragon', 'grap', 'cure wounds', 'zzzz']) searchCodex(db, q)
    expect((performance.now() - start) / 5).toBeLessThan(50)
  })

  it('returns a full entry with link and license', () => {
    const entry = getCodexEntry(db, 'monster:goblin|mm')
    expect(entry).toMatchObject({
      name: 'Goblin',
      externalUrl: 'https://2014.5e.tools/bestiary.html#goblin_mm',
      license: 'CC-BY-4.0',
    })
    expect(entry?.body).toContain('Nimble Escape')
    expect(entry?.data).toMatchObject({ ac: 15, hp: 7 })
    expect(getCodexEntry(db, 'spell:nope|phb')).toBeNull()
  })

  it('syncs "used in" links from session notes and documents', () => {
    const sessionId = Number(
      db.prepare('INSERT INTO sessions (campaign_id, title, session_number) VALUES (?, ?, ?)').run(campaignId, 'Ambush', 4)
        .lastInsertRowid,
    )
    syncRefLinks(db, campaignId, 'session', sessionId, `${codexToken('spell:fireball|phb')} ${codexToken('spell:made up|hb')}`)
    expect(getCodexUsages(db, campaignId, 'spell:fireball|phb')).toEqual([
      { ownerType: 'session', ownerId: sessionId, title: 'Ambush' },
    ])
    // Unknown uids are still recorded
    expect(getCodexUsages(db, campaignId, 'spell:made up|hb')).toHaveLength(1)

    // Removing the token removes the link
    syncRefLinks(db, campaignId, 'session', sessionId, codexToken('spell:made up|hb'))
    expect(getCodexUsages(db, campaignId, 'spell:fireball|phb')).toEqual([])

    // Documents, and scoping by campaign
    const npcType = db.prepare('SELECT id FROM entity_types WHERE name = ?').get('NPC') as { id: number }
    const npcId = Number(
      db.prepare('INSERT INTO entities (type_id, campaign_id, name) VALUES (?, ?, ?)').run(npcType.id, campaignId, 'Sildar')
        .lastInsertRowid,
    )
    const docId = Number(
      db.prepare('INSERT INTO entity_documents (entity_id, title, content, date) VALUES (?, ?, ?, ?)')
        .run(npcId, 'Spells', '', '2026-10-19').lastInsertRowid,
    )
    syncRefLinks(db, campaignId, 'document', docId, codexToken('spell:fireball|phb'))
    expect(getCodexUsages(db, campaignId, 'spell:fireball|phb')).toEqual([
      { ownerType: 'document', ownerId: docId, title: 'Sildar: Spells', entityId: npcId, entityType: 'npc' },
    ])
    expect(getCodexUsages(db, campaignId + 1000, 'spell:fireball|phb')).toEqual([])
  })
})

describe('codex chips in rendered markdown', async () => {
  const { renderCodexChips } = await import('../../app/utils/codexChips')

  it('renders tokens as chips with uid and name', () => {
    const html = renderCodexChips('<p>Cast {{codex:spell:fireball|phb}} on {{npc:3}}</p>')
    expect(html).toContain('class="codex-chip" data-uid="spell:fireball|phb"')
    expect(html).toContain('</i>Fireball</span>')
    expect(html).toContain('{{npc:3}}')
  })

  it('accepts escaped or curly apostrophes and resolves real names', () => {
    const html = renderCodexChips('<p>{{codex:monster:will-o&#39;-wisp|mm}} {{codex:monster:will-o’-wisp|mm}}</p>', uid =>
      uid === 'monster:will-o\'-wisp|mm' ? 'Will-o\'-Wisp' : undefined,
    )
    expect(html.match(/data-uid="monster:will-o&#39;-wisp\|mm"/g)).toHaveLength(2)
    expect(html).toContain('Will-o&#39;-Wisp</span>')
  })

  it('strips tokens from attributes instead of rendering chips there', () => {
    const html = renderCodexChips('<h3 id="fight-{{codex:spell:fireball|phb}}">Fight {{codex:spell:fireball|phb}}</h3>')
    expect(html.startsWith('<h3 id="fight-">Fight <span class="codex-chip"')).toBe(true)
  })

  it('leaves look-alikes and unsafe text alone', () => {
    const input = '<p>{{codex:spell:<img src=x onerror=alert(1)>|phb}} {{ref:npc:1}} {{codex:spell:fire&amp;ice|phb}}</p>'
    expect(renderCodexChips(input)).toBe(input)
  })
})
