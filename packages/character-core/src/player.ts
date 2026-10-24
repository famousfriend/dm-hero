/**
 * Player Companion character model. Every sheet value is layered (see
 * layers.ts), so an import never overwrites what the player typed or what the
 * DM set. Phase 1 holds the identity basics; later phases add fields here.
 */
import { resolve, type LayeredRecord } from './layers'

export interface PlayerSheet {
  name: string
  classLabel: string
  level: number
  race: string
  background: string
  hpMax: number
  hpCurrent: number
  hpTemp: number
  ac: number
  speed: number
  initiative: number
}

export const EMPTY_PLAYER_SHEET: PlayerSheet = {
  name: '',
  classLabel: '',
  level: 1,
  race: '',
  background: '',
  hpMax: 0,
  hpCurrent: 0,
  hpTemp: 0,
  ac: 10,
  speed: 30,
  initiative: 0,
}

export interface PlayerCharacter {
  id: number
  campaignId: number | null
  ddbCharacterId: string | null
  values: LayeredRecord<PlayerSheet>
  createdAt: string
  updatedAt: string
}

export interface PlayerCampaign {
  id: number
  name: string
  dmName: string
  createdAt: string
}

/** What the sheet shows: every layer resolved, gaps filled with defaults */
export function playerSheet(character: Pick<PlayerCharacter, 'values'>): PlayerSheet {
  return { ...EMPTY_PLAYER_SHEET, ...resolve(character.values) }
}
