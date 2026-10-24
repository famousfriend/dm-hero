import { describe, it, expect } from 'vitest'
import { PLAYER_PACK_FORMAT, parsePlayerPack } from '../src'

const pack = (extra: Record<string, unknown> = {}) => ({
  format: PLAYER_PACK_FORMAT,
  version: 1,
  exportedAt: '2026-10-24T00:00:00Z',
  campaign: { ref: 'abc:1', name: 'Crimson Moon', dmName: 'Raul' },
  places: [{ ref: 'abc:location:2', name: 'Saltmarsh', description: 'Town' }],
  npcs: [{ ref: 'abc:npc:3', name: 'Vex', description: '', placeRef: 'abc:location:2' }],
  quests: [{ ref: 'abc:quest:4', name: 'Find the door', description: '', status: 'weird', reward: '50 gp' }],
  ...extra,
})

describe('player pack', () => {
  it('reads a pack and cleans odd values', () => {
    const parsed = parsePlayerPack(pack())
    expect(parsed.campaign.name).toBe('Crimson Moon')
    expect(parsed.npcs[0]!.placeRef).toBe('abc:location:2')
    expect(parsed.quests[0]!.status).toBe('open')
    expect(parsed.forCharacter).toBeNull()
  })

  it('refuses other files, newer versions and nameless entries', () => {
    expect(() => parsePlayerPack({ hello: 1 })).toThrow(/not a player pack/)
    expect(() => parsePlayerPack(pack({ version: 99 }))).toThrow(/newer/)
    expect(() => parsePlayerPack(pack({ npcs: [{ ref: 'x' }] }))).toThrow(/NPC/)
  })
})
