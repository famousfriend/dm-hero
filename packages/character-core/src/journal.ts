/**
 * A character's journal: notes, the NPCs they met and the places they went.
 * NPCs and places come from the player ('player') or from the DM ('dm', sent
 * over the table connection). A DM entry's name and description belong to the
 * DM; the player keeps their own notes on it. Shared with DM Command Center.
 */

export type JournalSource = 'player' | 'dm'

/** private: only this player. party: sent to the other players at the table */
export type NoteVisibility = 'private' | 'party'

export const NOTE_VISIBILITIES: NoteVisibility[] = ['private', 'party']

export interface PlayerNote {
  id: number
  characterId: number
  title: string
  body: string
  visibility: NoteVisibility
  createdAt: string
  updatedAt: string
}

export interface JournalPlace {
  id: number
  characterId: number
  source: JournalSource
  name: string
  description: string
  /** The player's own notes; on a DM entry the only part the player edits */
  playerNotes: string
  createdAt: string
  updatedAt: string
}

export interface JournalNpc extends JournalPlace {
  /** Where the character met them */
  placeId: number | null
}

export type JournalQuestStatus = 'open' | 'active' | 'done' | 'failed'

/** A quest the DM sent in a player pack; the player keeps their own notes on it */
export interface JournalQuest {
  id: number
  characterId: number
  name: string
  description: string
  status: JournalQuestStatus
  reward: string
  playerNotes: string
  createdAt: string
  updatedAt: string
}

/** What importing a player pack would do (preview) or did (apply) */
export interface PackImportResult {
  applied: boolean
  campaign: { name: string, dmName: string, isNew: boolean }
  /** The DM made the pack for another character (a hint; it can still be imported) */
  forCharacter: string | null
  /** The character is in another campaign now and will be moved to this one */
  changesCampaign: boolean
  counts: Record<'places' | 'npcs' | 'quests', { added: number, updated: number, unchanged: number }>
}
