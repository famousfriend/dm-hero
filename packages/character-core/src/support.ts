/**
 * Import support report: for every field the Player Companion knows, whether a
 * given importer fills it fully, partly, or not at all. Shown in the import
 * preview so nothing is silently missing.
 */

export type Support = 'full' | 'partial' | 'none'

export interface FieldSupport {
  field: string
  label: string
  support: Support
  note?: string
}

export function supportSummary(fields: FieldSupport[]): Record<Support, number> {
  const out: Record<Support, number> = { full: 0, partial: 0, none: 0 }
  for (const f of fields) out[f.support]++
  return out
}
