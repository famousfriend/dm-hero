import { describe, it, expect } from 'vitest'
import type { PlayerPack } from '../../types/player-pack'
import { playerJournalFileName, playerJournalHtml, playerJournalText } from '../../app/utils/playerJournal'

const pack: PlayerPack = {
  exportedAt: '2026-10-24T12:00:00Z',
  campaign: { ref: 'ab:campaign:1', name: 'Curse of Strahd', dmName: 'Raul' },
  forCharacter: 'Kara',
  places: [{ ref: 'ab:location:5', name: 'Barovia', description: 'Foggy village' }],
  npcs: [
    { ref: 'ab:npc:9', name: 'Ismark', description: '', placeRef: 'ab:location:5' },
    { ref: 'ab:npc:10', name: '</script><img src=x onerror=alert(1)>', description: '', placeRef: null },
  ],
  quests: [
    { ref: 'ab:quest:3', name: 'Bury the Burgomaster', description: '', status: 'done', reward: '' },
    { ref: 'ab:quest:2', name: 'Escort Ireena', description: 'Keep her safe', status: 'active', reward: '50 gp' },
  ],
}

describe('player journal export', () => {
  it('names the file after the campaign and character', () => {
    expect(playerJournalFileName(pack)).toBe('Curse of Strahd - Kara - journal')
    expect(playerJournalFileName({ ...pack, campaign: { ...pack.campaign, name: 'A/B: "C"' }, forCharacter: null })).toBe('AB C - journal')
  })

  it('writes a plain text version with quests first and who was met where', () => {
    const text = playerJournalText(pack)
    expect(text.indexOf('[Active] Escort Ireena')).toBeLessThan(text.indexOf('[Done] Bury the Burgomaster'))
    expect(text).toContain('Reward: 50 gp')
    expect(text).toContain('Met here: Ismark')
    expect(text).toContain('* Ismark (met at Barovia)')
    expect(text.startsWith('CURSE OF STRAHD\nJournal of Kara · DM Raul')).toBe(true)
  })

  it('builds a self-contained page that cannot be broken out of by names', () => {
    const html = playerJournalHtml(pack)
    expect(html).toContain('<title>Curse of Strahd - Kara - journal</title>')
    expect(html).not.toContain('</script><img')
    expect(html).not.toMatch(/(src|href)=["']https?:/)
    const data = html.match(/<script id="journal-data" type="application\/json">([^<]*)<\/script>/)
    expect(JSON.parse(data![1]!)).toEqual(pack)
  })
})
