/**
 * TaleSpire dice links (DM Command Center M12b): talespire://dice/Name:1d20+5/Damage:1d8+3
 * puts the dice in the TaleSpire dice tray, ready to throw. Names are one word,
 * rolls are dice and numbers only. Returns null when nothing usable is left.
 */
export interface TaleSpireRoll {
  name: string
  dice: string
}

export function taleSpireDiceUrl(rolls: TaleSpireRoll[]): string | null {
  const parts: string[] = []
  for (const roll of rolls.slice(0, 6)) {
    const name = roll.name.normalize('NFD').replace(/[^A-Za-z0-9]/g, '').slice(0, 32) || 'Roll'
    const dice = roll.dice.replace(/\s+/g, '').toLowerCase()
    // Only plain terms like 2d6, d20, +3, -1
    if (!/^[+-]?(\d*d\d+|\d+)([+-](\d*d\d+|\d+))*$/.test(dice) || !dice.includes('d') || dice.length > 40) continue
    parts.push(`${name}:${dice.replace(/^\+/, '')}`)
  }
  return parts.length ? `talespire://dice/${parts.join('/')}` : null
}
