/** Numbers typed into the new-player form; '' is an empty field. */
export const ABILITIES = ['str', 'dex', 'con', 'int', 'wis', 'cha'] as const

type NumberField = number | ''

export interface ManualCharacter {
  classLabel: string
  level: NumberField
  hpMax: NumberField
  ac: NumberField
  speed: NumberField
  passivePerception: NumberField
  scores: Record<(typeof ABILITIES)[number], NumberField>
}

export function emptyManualCharacter(): ManualCharacter {
  return {
    classLabel: '',
    level: '',
    hpMax: '',
    ac: '',
    speed: '',
    passivePerception: '',
    scores: { str: '', dex: '', con: '', int: '', wis: '', cha: '' },
  }
}

const num = (v: NumberField) => (typeof v === 'number' && Number.isFinite(v) ? v : undefined)

/** Body for PATCH /api/party/:id: party numbers (manual) and Stat Block values (sheet). */
export function manualCharacterPatch(c: ManualCharacter) {
  const manual: Record<string, unknown> = {}
  if (c.classLabel.trim()) manual.classLabel = c.classLabel.trim()
  if (num(c.level) !== undefined) manual.level = num(c.level)
  if (num(c.hpMax) !== undefined) {
    manual.hpMax = num(c.hpMax)
    manual.hpCurrent = num(c.hpMax)
  }
  if (num(c.ac) !== undefined) manual.ac = num(c.ac)
  if (num(c.passivePerception) !== undefined) manual.passivePerception = num(c.passivePerception)
  const scores = Object.fromEntries(ABILITIES.map(a => [a, num(c.scores[a])]).filter(([, v]) => v !== undefined))
  const sheet = { scores, hpMax: num(c.hpMax), ac: num(c.ac), speed: num(c.speed) }
  const hasSheet = Object.keys(scores).length > 0 || [sheet.hpMax, sheet.ac, sheet.speed].some(v => v !== undefined)
  return Object.keys(manual).length || hasSheet ? { manual, sheet } : null
}
