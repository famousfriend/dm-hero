import { describe, it, expect } from 'vitest'
import srd from '../../server/codex-data/srd-5.1.json'
import { abilityName, legendaryCost, parseStatBlock, rollDice, spellLookupName } from '../../app/utils/statBlock'

const monster = (name: string) => (srd.entries as Array<{ kind: string, name: string, body: string }>)
  .find(e => e.kind === 'monster' && e.name === name)!.body

describe('stat block parsing', () => {
  it('reads attacks with to-hit and damage', () => {
    const goblin = parseStatBlock(monster('Goblin'))
    expect(goblin.traits.map(t => t.name)).toEqual(['Nimble Escape'])
    expect(goblin.actions).toMatchObject([
      { name: 'Scimitar', toHit: 4, damageDice: '1d6 + 2', hit: '5 (1d6 + 2) slashing damage' },
      { name: 'Shortbow', toHit: 4, damageDice: '1d6 + 2' },
    ])
  })

  it('reads prepared spells with slots', () => {
    const [casting] = parseStatBlock(monster('Mage')).spellcasting
    expect(casting).toMatchObject({ name: 'Spellcasting', saveDc: 14, attack: 6 })
    expect(casting!.groups.map(g => [g.level, g.slots, g.spells.length])).toEqual([[0, null, 4], [1, 4, 4], [2, 3, 2], [3, 3, 3], [4, 3, 2], [5, 1, 1]])
    expect(casting!.groups[3]!.spells).toContain('fireball')
  })

  it('reads innate spells, also when two groups share a line', () => {
    const [casting] = parseStatBlock(monster('Djinni')).spellcasting
    expect(casting!.groups.map(g => [g.label, g.perDay, g.spells.length])).toEqual([['At will', null, 3], ['3/day each', 3, 3], ['1/day each', 1, 6]])
    expect(casting!.groups[2]!.spells[0]).toBe('conjure elemental (air elemental only)')
    expect(spellLookupName('conjure elemental (air elemental only)')).toBe('conjure elemental')
  })

  it('reads legendary actions and saves', () => {
    const dragon = parseStatBlock(monster('Adult Red Dragon'))
    expect(dragon.legendary.map(a => a.name)).toEqual(expect.arrayContaining(['Detect', 'Tail Attack', 'Wing Attack (Costs 2 Actions)']))
    expect(dragon.actions.find(a => a.name.startsWith('Fire Breath'))).toMatchObject({ save: 'DC 21 Dexterity', damageDice: '18d6' })
    expect(abilityName('Fire Breath (Recharge 5-6)')).toBe('Fire Breath')
    expect(legendaryCost('Wing Attack (Costs 2 Actions)')).toBe(2)
  })

  it('handles every SRD monster without throwing', () => {
    for (const e of srd.entries as Array<{ kind: string, body: string }>) {
      if (e.kind === 'monster') expect(() => parseStatBlock(e.body)).not.toThrow()
    }
    expect(parseStatBlock(null).actions).toEqual([])
    expect(parseStatBlock(monster('Cat')).actions[0]).toMatchObject({ toHit: 0, damageDice: '1' })
  })

  it('rolls dice expressions', () => {
    const max = () => 0.999
    expect(rollDice('1d6 + 2', false, max)).toEqual({ total: 8, rolls: [6], modifier: 2 })
    expect(rollDice('2d8+1d6-1', true, max)!.total).toBe(8 * 4 + 6 * 2 - 1)
    expect(rollDice('lots')).toBeNull()
  })
})
