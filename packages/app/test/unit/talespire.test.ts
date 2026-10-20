import { describe, it, expect } from 'vitest'
import { taleSpireDiceUrl } from '../../app/utils/taleSpire'

describe('TaleSpire dice links', () => {
  it('builds one link with several named rolls', () => {
    expect(taleSpireDiceUrl([
      { name: 'Scimitar hit', dice: '1d20+4' },
      { name: 'Damage', dice: '1d6 + 2' },
    ])).toBe('talespire://dice/Scimitarhit:1d20+4/Damage:1d6+2')
  })

  it('cleans names to one word', () => {
    expect(taleSpireDiceUrl([{ name: 'Fire Bolt ✨ (2)', dice: '2d10' }])).toBe('talespire://dice/FireBolt2:2d10')
    expect(taleSpireDiceUrl([{ name: '!!!', dice: 'd20' }])).toBe('talespire://dice/Roll:d20')
    expect(taleSpireDiceUrl([{ name: 'Épée', dice: 'd8' }])).toBe('talespire://dice/Epee:d8')
  })

  it('drops anything that is not plain dice', () => {
    expect(taleSpireDiceUrl([{ name: 'X', dice: '5' }])).toBeNull()
    expect(taleSpireDiceUrl([{ name: 'X', dice: '1d6/../board' }])).toBeNull()
    expect(taleSpireDiceUrl([{ name: 'X', dice: '+1d20-1' }])).toBe('talespire://dice/X:1d20-1')
    expect(taleSpireDiceUrl([])).toBeNull()
  })

  it('fits the pattern the desktop app accepts', () => {
    const allowed = /^talespire:\/\/dice\/[A-Za-z0-9]{1,32}:[0-9dD+-]{1,40}(\/[A-Za-z0-9]{1,32}:[0-9dD+-]{1,40}){0,5}$/
    const url = taleSpireDiceUrl(Array.from({ length: 9 }, (_, i) => ({ name: `Roll ${i}`, dice: '8d6+12' })))!
    expect(url).toMatch(allowed)
  })
})
