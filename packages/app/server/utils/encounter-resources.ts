import type Database from 'better-sqlite3'
import type { EncounterResource, EncounterResourceKind, ResourceInput, ResourceOp } from '~~/types/encounter'

/*
 * Limited-use abilities in a fight (DM Command Center M7.3): recharge abilities
 * ("Acid Breath (Recharge 5-6)"), X/Day uses and legendary actions.
 * Codex monsters get theirs read from the stat block when they join a fight;
 * the DM can add, use and restore them for any participant.
 */

export class ResourceError extends Error {}

const KINDS: EncounterResourceKind[] = ['recharge', 'uses', 'legendary']

/** SRD legendary creatures can take 3 legendary actions per round */
const LEGENDARY_ACTIONS = 3

/** Reads limited-use abilities from a stat block in Markdown (`***Name (3/Day).***`). */
export function parseMonsterResources(bodyMd: string | null | undefined): ResourceInput[] {
  if (!bodyMd) return []
  const found: ResourceInput[] = []
  // Bold-italic headers whose parentheses say how often they can be used
  for (const match of bodyMd.matchAll(/\*\*\*([^*(]+?)\s*\(([^)]*)\)\.?\*\*\*/g)) {
    const name = match[1]!.trim()
    const note = match[2]!
    const recharge = note.match(/Recharge (\d)(?:\s*[-–]\s*\d)?/i)
    const perDay = note.match(/(\d+)\s*\/\s*Day/i)
    if (recharge) found.push({ name, kind: 'recharge', max_uses: 1, recharge_min: Number(recharge[1]) })
    else if (perDay) found.push({ name, kind: 'uses', max_uses: Number(perDay[1]) })
    else if (/Recharges after a (Short or )?Long Rest/i.test(note)) found.push({ name, kind: 'uses', max_uses: 1 })
  }
  const legendary = bodyMd.match(/can take (\d+) legendary actions/i)
  if (legendary || /^#+\s*Legendary Actions/im.test(bodyMd)) {
    found.push({ name: 'Legendary Actions', kind: 'legendary', max_uses: legendary ? Number(legendary[1]) : LEGENDARY_ACTIONS })
  }
  return found
}

function cleanInput(input: ResourceInput): Required<ResourceInput> {
  const name = String(input.name ?? '').trim().slice(0, 100)
  if (!name) throw new ResourceError('Name is required')
  if (!KINDS.includes(input.kind)) throw new ResourceError('Unknown kind')
  const recharge = input.kind === 'recharge'
  const maxUses = recharge ? 1 : Math.trunc(Number(input.max_uses ?? 1))
  if (!Number.isFinite(maxUses) || maxUses < 1 || maxUses > 99) throw new ResourceError('Uses must be between 1 and 99')
  const min = recharge ? Math.trunc(Number(input.recharge_min ?? 6)) : null
  if (min !== null && (!Number.isFinite(min) || min < 2 || min > 6)) throw new ResourceError('Recharge must be between 2 and 6')
  return { name, kind: input.kind, max_uses: maxUses, recharge_min: min }
}

export function addResources(db: Database.Database, participantId: number | bigint, inputs: ResourceInput[]) {
  const order = db
    .prepare('SELECT COALESCE(MAX(sort_order), -1) AS n FROM encounter_resources WHERE participant_id = ?')
    .get(participantId) as { n: number }
  let sortOrder = order.n + 1
  const insert = db.prepare(
    'INSERT INTO encounter_resources (participant_id, name, kind, max_uses, recharge_min, sort_order) VALUES (?, ?, ?, ?, ?, ?)',
  )
  for (const input of inputs) {
    const r = cleanInput(input)
    insert.run(participantId, r.name, r.kind, r.max_uses, r.recharge_min, sortOrder++)
  }
}

export function listResources(db: Database.Database, participantId: number | string): EncounterResource[] {
  return db
    .prepare('SELECT * FROM encounter_resources WHERE participant_id = ? ORDER BY sort_order, id')
    .all(participantId) as EncounterResource[]
}

/** Adds, uses/restores (`set` the used count) or removes one of a participant's abilities. */
export function applyResourceOp(db: Database.Database, participantId: number, op: ResourceOp) {
  if (op.op === 'add') {
    addResources(db, participantId, [op])
    return
  }
  const row = db
    .prepare('SELECT id, max_uses FROM encounter_resources WHERE id = ? AND participant_id = ?')
    .get(op.id, participantId) as { id: number, max_uses: number } | undefined
  if (!row) throw new ResourceError('Ability not found')
  if (op.op === 'remove') {
    db.prepare('DELETE FROM encounter_resources WHERE id = ?').run(row.id)
  }
  else if (op.op === 'set') {
    const used = Math.min(row.max_uses, Math.max(0, Math.trunc(Number(op.used)) || 0))
    db.prepare('UPDATE encounter_resources SET used = ? WHERE id = ?').run(used, row.id)
  }
  else {
    throw new ResourceError('Unknown operation')
  }
}
