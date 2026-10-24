import { describe, it, expect } from 'vitest'
import { effective, setLayer, supportSummary, type LayeredRecord } from '../src'

describe('layers', () => {
  it('dm beats local beats source', () => {
    expect(effective({ source: 1 })).toBe(1)
    expect(effective({ source: 1, local: 2 })).toBe(2)
    expect(effective({ source: 1, local: 2, dm: 3 })).toBe(3)
  })

  it('clearing an override falls back to the import', () => {
    let r: LayeredRecord<{ ac: number }> = { ac: { source: 15 } }
    r = setLayer(r, 'ac', 'local', 17)
    expect(effective(r.ac)).toBe(17)
    r = setLayer(r, 'ac', 'local', undefined)
    expect(effective(r.ac)).toBe(15)
  })

  it('counts import support', () => {
    expect(supportSummary([
      { field: 'ac', label: 'AC', support: 'full' },
      { field: 'spellSlots', label: 'Spell slots', support: 'partial' },
      { field: 'inventory', label: 'Inventory', support: 'none' },
    ])).toEqual({ full: 1, partial: 1, none: 1 })
  })
})
