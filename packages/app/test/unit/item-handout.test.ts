import { describe, expect, it } from 'vitest'
import { applyBaseItem, buildHandoutMarkdown, emptyHandoutForm, handoutFormFromItem } from '../../app/utils/itemHandout'

describe('item handout (Homebrewery page text)', () => {
  it('builds a weapon page with subtitle, stats, bonus and description', () => {
    const form = applyBaseItem({ ...emptyHandoutForm(), name: 'Flame Tongue', category: 'weapon', rarity: 'rare', attunement: true, bonus: 1, description: 'It burns.' }, 'longsword')
    const md = buildHandoutMarkdown(form)
    expect(md).toContain('## Flame Tongue\n*Weapon (longsword), rare (requires attunement)*')
    expect(md).toContain('**Damage** 1d8 slashing')
    expect(md).toContain('**Properties** Versatile (1d10)')
    expect(md).toContain('+1 bonus to attack and damage rolls')
    expect(md).toContain('It burns.')
  })

  it('names who must attune and handles very rare / armor', () => {
    const form = applyBaseItem({ ...emptyHandoutForm(), name: 'Aegis', category: 'armor', rarity: 'very_rare', attunement: true, attunementBy: 'a paladin', bonus: 2 }, 'Plate')
    const md = buildHandoutMarkdown(form)
    expect(md).toContain('*Armor (plate), very rare (requires attunement by a paladin)*')
    expect(md).toContain('**Armor Class** 18')
    expect(md).toContain('+2 bonus to AC')
  })

  it('leaves out empty stats and keeps free-text base items', () => {
    const form = applyBaseItem({ ...emptyHandoutForm(), name: 'Cloak', category: 'wondrous' }, 'any sword')
    const md = buildHandoutMarkdown(form)
    expect(md).toBe('## Cloak\n*Wondrous item, uncommon*\n')
  })

  it('prefills from an app item', () => {
    const form = handoutFormFromItem({ name: 'Potion', description: 'Heals', metadata: { type: 'potion', rarity: 'common', weight: 0.5, properties: 'Fizzy, Red' } })
    expect(form).toMatchObject({ category: 'potion', rarity: 'common', weight: '0.5 lb.', properties: ['Fizzy', 'Red'], description: 'Heals' })
  })
})
