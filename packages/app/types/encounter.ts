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
  /** Player characters at 0 HP: 3 successes = stable, 3 failures = dead */
  death_save_successes: number
  death_save_failures: number
  sort_order: number
  is_ko: boolean
  notes: string | null
  entity_type?: string
  entity_image?: string | null
  effects?: EncounterEffect[]
  resources?: EncounterResource[]
}

/**
 * recharge: one use, comes back on a d6 roll of recharge_min or higher at the start of the turn
 * uses: X per day (or per rest); legendary: X per round, back at the start of the turn
 */
export type EncounterResourceKind = 'recharge' | 'uses' | 'legendary'

export interface EncounterResource {
  id: number
  participant_id: number
  name: string
  kind: EncounterResourceKind
  max_uses: number
  used: number
  recharge_min: number | null
  sort_order: number
}

export type ResourceInput = Pick<EncounterResource, 'name' | 'kind'> & Partial<Pick<EncounterResource, 'max_uses' | 'recharge_min'>>

/** Participant PATCH body `{ resource: ... }` */
export type ResourceOp
  = | ({ op: 'add' } & ResourceInput)
    | { op: 'set', id: number, used: number }
    | { op: 'remove', id: number }

export interface EncounterWithParticipants extends Encounter {
  participants: EncounterParticipant[]
  /** Newest first */
  log?: EncounterLogEntry[]
}

/** What the action log stores before and after each change, for undo */
export interface LoggedState {
  current_hp: number
  max_hp: number
  temp_hp: number
  armor_class: number | null
  is_ko: boolean
  death_save_successes: number
  death_save_failures: number
}

export type DeathSaveResult = 'success' | 'failure' | 'crit' | 'critFail'

export type CombatAction
  = | { type: 'damage', amount: number }
    | { type: 'heal', amount: number }
    | { type: 'tempHp', amount: number }
    | { type: 'deathSave', result: DeathSaveResult }
    | { type: 'set', fields: Partial<LoggedState> }

export interface EncounterLogEntry {
  id: number
  participantId: number | null
  participantName: string
  round: number
  /** 'roll': a dice roll made in TaleSpire, only shown (amount = total, details = label and detail) */
  kind: CombatAction['type'] | 'roll'
  amount: number | null
  /** Why it came out this way: absorbed (temp HP), down, massive, dead, revived, stable, whileDown, kept, result */
  details: Record<string, unknown>
  before: LoggedState
  after: LoggedState
  createdAt: string
  undone: boolean
}
