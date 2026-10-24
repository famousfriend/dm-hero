/**
 * Layered character values.
 *
 * Every field can come from three places, and the Player Companion must never
 * mix them up:
 *   source - what an import (D&D Beyond, JSON, PDF) or the calculator produced
 *   local  - what the player typed in by hand (an override)
 *   dm     - what the DM authorised over the connection (e.g. "you lose 8 HP")
 *
 * effective value = dm ?? local ?? source. Re-importing replaces only the
 * source layer, so overrides and DM changes survive a refresh.
 */

export type Layer = 'source' | 'local' | 'dm'

export interface LayeredValue<T> {
  source?: T
  local?: T
  dm?: T
  /** Short explanation of how the source value was calculated, for the UI */
  explain?: string
}

export type LayeredRecord<S> = { [K in keyof S]?: LayeredValue<S[K]> }

export function effective<T>(value: LayeredValue<T> | undefined): T | undefined {
  if (!value) return undefined
  if (value.dm !== undefined) return value.dm
  if (value.local !== undefined) return value.local
  return value.source
}

export function winningLayer<T>(value: LayeredValue<T> | undefined): Layer | null {
  if (!value) return null
  if (value.dm !== undefined) return 'dm'
  if (value.local !== undefined) return 'local'
  return value.source !== undefined ? 'source' : null
}

/** The flat, effective values: what the sheet shows */
export function resolve<S extends object>(record: LayeredRecord<S>): Partial<S> {
  const out: Partial<S> = {}
  for (const key of Object.keys(record) as (keyof S)[]) {
    const v = effective(record[key])
    if (v !== undefined) out[key] = v
  }
  return out
}

/** Set one layer of one field; undefined clears that layer */
export function setLayer<S, K extends keyof S>(
  record: LayeredRecord<S>,
  key: K,
  layer: Layer,
  value: S[K] | undefined,
): LayeredRecord<S> {
  const next: LayeredValue<S[K]> = { ...record[key] }
  if (value === undefined) delete next[layer]
  else next[layer] = value
  return { ...record, [key]: next }
}

export interface FieldChange<S, K extends keyof S = keyof S> {
  field: K
  before: S[K] | undefined
  after: S[K] | undefined
  /** true when a local or DM value hides this change from the sheet */
  shadowedBy: 'local' | 'dm' | null
}

function same(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b)
}

/**
 * What a refresh would change, for the preview the player approves. Only the
 * source layer is compared: local and DM values are reported as shadowing,
 * never overwritten.
 */
export function diffSource<S extends object>(record: LayeredRecord<S>, incoming: Partial<S>): FieldChange<S>[] {
  const keys = new Set<keyof S>([...(Object.keys(record) as (keyof S)[]), ...(Object.keys(incoming) as (keyof S)[])])
  const changes: FieldChange<S>[] = []
  for (const field of keys) {
    const before = record[field]?.source
    const after = incoming[field]
    if (after === undefined || same(before, after)) continue
    const layer = winningLayer(record[field])
    changes.push({ field, before, after, shadowedBy: layer === 'local' || layer === 'dm' ? layer : null })
  }
  return changes
}

/**
 * Apply an approved refresh: replace the source layer of the accepted fields
 * (all changed fields if `accept` is omitted). Local and DM layers are kept.
 */
export function applySource<S extends object>(
  record: LayeredRecord<S>,
  incoming: Partial<S>,
  explain: Partial<Record<keyof S, string>> = {},
  accept?: (keyof S)[],
): LayeredRecord<S> {
  const allowed = accept ? new Set(accept) : null
  const next: LayeredRecord<S> = { ...record }
  for (const field of Object.keys(incoming) as (keyof S)[]) {
    if (allowed && !allowed.has(field)) continue
    const value = incoming[field]
    if (value === undefined) continue
    next[field] = { ...record[field], source: value, explain: explain[field] ?? record[field]?.explain }
  }
  return next
}
