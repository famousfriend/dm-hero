export const ENCOUNTER_STATUSES = ['setup', 'initiative', 'active', 'finished'] as const
export type EncounterStatus = (typeof ENCOUNTER_STATUSES)[number]

export interface Encounter {
  id: number
  campaign_id: number
  session_id: number | null
  name: string
  status: EncounterStatus
  round: number
  current_turn_index: number
  created_at: string
  updated_at: string
  finished_at: string | null
  deleted_at: string | null
  _participantCount?: number
}

export type EffectDurationType = 'infinite' | 'rounds' | 'concentration'

export interface EncounterEffect {
  id: number
  participant_id: number
  name: string
  icon: string | null
  duration_type: EffectDurationType
  duration_rounds: number | null
  remaining_rounds: number | null
}

export interface EncounterParticipant {
  id: number
  encounter_id: number
  /** null for monsters from the reference library */
  entity_id: number | null
  /** Codex monster, e.g. "monster:goblin|mm" */
  ref_uid: string | null
  display_name: string
  duplicate_index: number
  initiative: number | null
  current_hp: number
  max_hp: number
  temp_hp: number
  armor_class: number | null
  sort_order: number
  is_ko: boolean
  notes: string | null
  entity_type?: string
  entity_image?: string | null
  effects?: EncounterEffect[]
}

export interface EncounterWithParticipants extends Encounter {
  participants: EncounterParticipant[]
}
