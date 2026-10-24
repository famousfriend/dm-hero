/**
 * Player journal: the campaign info the DM chose to hand to the players
 * (quests, places, NPCs). DM CC saves it as a web page or a text file the
 * DM sends to the players; no server involved. Refs stay the same on every
 * export, so the players' own notes in the page carry over to newer copies.
 */

export interface PackEntry {
  /** Stable reference, e.g. "1a2b3c:npc:12" (install id : kind : id) */
  ref: string
  name: string
  description: string
}

export interface PackNpc extends PackEntry {
  /** ref of the exported place where the party met them */
  placeRef: string | null
}

export type PackQuestStatus = 'open' | 'active' | 'done' | 'failed'

export interface PackQuest extends PackEntry {
  status: PackQuestStatus
  reward: string
}

export interface PlayerPack {
  exportedAt: string
  campaign: { ref: string, name: string, dmName: string }
  /** Character the DM made it for; null = whole party */
  forCharacter: string | null
  places: PackEntry[]
  npcs: PackNpc[]
  quests: PackQuest[]
}
