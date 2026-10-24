/**
 * Player pack: the file DM Command Center exports for the Player Companion,
 * so campaign info reaches the players without any server (send it on Discord,
 * a USB stick, anything). Every entry carries the DM's own reference, so
 * importing a newer pack updates what is there instead of adding duplicates.
 */

export const PLAYER_PACK_FORMAT = 'dmcc-player-pack'
export const PLAYER_PACK_VERSION = 1
export const PLAYER_PACK_EXTENSION = '.dmcc-pack.json'

export interface PackEntry {
  /** Stable reference from DM Command Center, e.g. "npc:12" */
  ref: string
  name: string
  description: string
}

export interface PackNpc extends PackEntry {
  /** ref of the place where the party met them */
  placeRef: string | null
}

export const PACK_QUEST_STATUSES = ['open', 'active', 'done', 'failed'] as const
export type PackQuestStatus = (typeof PACK_QUEST_STATUSES)[number]

export interface PackQuest extends PackEntry {
  status: PackQuestStatus
  reward: string
}

export interface PlayerPack {
  format: typeof PLAYER_PACK_FORMAT
  version: number
  exportedAt: string
  campaign: { ref: string, name: string, dmName: string }
  /** Character name the DM made the pack for, if any (shown as a hint on import) */
  forCharacter: string | null
  places: PackEntry[]
  npcs: PackNpc[]
  quests: PackQuest[]
}

export class PlayerPackError extends Error {}

const text = (value: unknown, max = 20000) => (typeof value === 'string' ? value.slice(0, max) : '')

function entry(raw: unknown, what: string): PackEntry {
  const r = (raw ?? {}) as Record<string, unknown>
  const ref = text(r.ref, 200)
  const name = text(r.name, 200).trim()
  if (!ref || !name) throw new PlayerPackError(`A ${what} in the file has no name or reference.`)
  return { ref, name, description: text(r.description) }
}

/** Checks an uploaded file and returns a clean pack; throws PlayerPackError with a message for the player */
export function parsePlayerPack(input: unknown): PlayerPack {
  const raw = (input ?? {}) as Record<string, unknown>
  if (raw.format !== PLAYER_PACK_FORMAT) throw new PlayerPackError('This is not a player pack from DM Command Center.')
  if (typeof raw.version !== 'number' || raw.version > PLAYER_PACK_VERSION) {
    throw new PlayerPackError('This pack was made by a newer DM Command Center. Update the Player Companion first.')
  }
  const campaign = (raw.campaign ?? {}) as Record<string, unknown>
  const campaignRef = text(campaign.ref, 200)
  const campaignName = text(campaign.name, 200).trim()
  if (!campaignRef || !campaignName) throw new PlayerPackError('The pack has no campaign.')
  const list = (value: unknown) => (Array.isArray(value) ? value : [])
  return {
    format: PLAYER_PACK_FORMAT,
    version: raw.version,
    exportedAt: text(raw.exportedAt, 40),
    campaign: { ref: campaignRef, name: campaignName, dmName: text(campaign.dmName, 200) },
    forCharacter: text(raw.forCharacter, 200) || null,
    places: list(raw.places).map(p => entry(p, 'place')),
    npcs: list(raw.npcs).map((n) => {
      const placeRef = text((n as Record<string, unknown>)?.placeRef, 200)
      return { ...entry(n, 'NPC'), placeRef: placeRef || null }
    }),
    quests: list(raw.quests).map((q) => {
      const r = (q ?? {}) as Record<string, unknown>
      const status = PACK_QUEST_STATUSES.includes(r.status as PackQuestStatus) ? (r.status as PackQuestStatus) : 'open'
      return { ...entry(q, 'quest'), status, reward: text(r.reward, 500) }
    }),
  }
}
