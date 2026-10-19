/**
 * Quests (the reserved "Quest" entity type) and continuity items: the things
 * that changed in a session and should not be forgotten.
 */

export const QUEST_STATUSES = ['open', 'active', 'done', 'failed'] as const
export type QuestStatus = (typeof QUEST_STATUSES)[number]

/** Still on the table: shown under "unresolved quests" */
export const UNRESOLVED_QUEST_STATUSES: readonly QuestStatus[] = ['open', 'active']

export interface LinkedEntity {
  id: number
  name: string
  /** Entity type name: NPC, Location, Item, Faction, Player, Quest ... */
  type: string
}

export interface Quest {
  id: number
  name: string
  description: string | null
  status: QuestStatus
  reward: string | null
  giver: LinkedEntity | null
  /** NPCs, places, items ... involved */
  involved: LinkedEntity[]
  updatedAt: string
  archivedAt: string | null
}

export interface QuestInput {
  name?: string
  description?: string | null
  status?: QuestStatus
  reward?: string | null
  giverId?: number | null
  involvedIds?: number[]
}

export const CONTINUITY_KINDS = ['decision', 'reveal', 'promise', 'debt', 'consequence', 'thread'] as const
export type ContinuityKind = (typeof CONTINUITY_KINDS)[number]

export interface ContinuityItem {
  id: number
  sessionId: number | null
  sessionTitle: string | null
  kind: ContinuityKind
  text: string
  status: 'open' | 'resolved'
  /** Bring this up at the start of the next session */
  nextSession: boolean
  entities: LinkedEntity[]
  createdAt: string
  resolvedAt: string | null
}

export interface ContinuityInput {
  sessionId?: number | null
  kind?: ContinuityKind
  text?: string
  status?: 'open' | 'resolved'
  nextSession?: boolean
  entityIds?: number[]
}

export interface LastMet {
  entity: LinkedEntity
  sessionId: number
  sessionTitle: string
  sessionNumber: number | null
  sessionDate: string | null
  /** Sessions held since then (0 = the latest session) */
  sessionsAgo: number
}
