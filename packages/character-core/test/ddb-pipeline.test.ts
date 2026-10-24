/**
 * Proof of concept: the DM app's existing D&D Beyond mapper feeds the shared
 * layered model unchanged. Uses the real sheet fixture from the DM app tests.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { mapDdbCharacter, unwrapDdbResponse } from '../src'
import { applySource, diffSource, resolve, setLayer, winningLayer, type LayeredRecord } from '../src'

interface CharacterValues {
  name: string
  level: number
  hpMax: number
  hpCurrent: number
  ac: number
  speed: number
  initiative: number
  str: number
  conditions: string[]
}

function loadMonk() {
  const json = JSON.parse(readFileSync(new URL('../../app/test/fixtures/ddb-monk-7.json', import.meta.url), 'utf8'))
  return mapDdbCharacter(unwrapDdbResponse(json))
}

function toValues(m: ReturnType<typeof loadMonk>): Partial<CharacterValues> {
  return {
    name: m.stats.name,
    level: m.stats.level,
    hpMax: m.stats.hpMax,
    hpCurrent: m.stats.hpCurrent,
    ac: m.stats.ac,
    speed: m.sheet.speed,
    initiative: m.sheet.initiative,
    str: m.sheet.scores.str,
    conditions: m.stats.conditions,
  }
}

describe('D&D Beyond -> layered character', () => {
  const mapped = loadMonk()
  const imported = toValues(mapped)

  it('a first import fills only the source layer, with explanations', () => {
    const record = applySource<CharacterValues>({}, imported, mapped.explain as Partial<Record<keyof CharacterValues, string>>)
    expect(resolve(record)).toEqual(imported)
    expect(winningLayer(record.ac)).toBe('source')
    expect(record.ac?.explain).toBeTruthy()
  })

  it('player overrides and DM changes survive a refresh', () => {
    let record: LayeredRecord<CharacterValues> = applySource({}, imported)
    record = setLayer(record, 'ac', 'local', 99) // player adds a homebrew shield
    record = setLayer(record, 'hpCurrent', 'dm', 3) // DM applied damage at the table

    const refreshed = { ...imported, ac: (imported.ac ?? 10) + 1, hpCurrent: (imported.hpCurrent ?? 0) - 5, level: (imported.level ?? 1) + 1 }
    const changes = diffSource(record, refreshed)

    expect(changes.map(c => c.field).sort()).toEqual(['ac', 'hpCurrent', 'level'])
    expect(changes.find(c => c.field === 'ac')?.shadowedBy).toBe('local')
    expect(changes.find(c => c.field === 'hpCurrent')?.shadowedBy).toBe('dm')
    expect(changes.find(c => c.field === 'level')?.shadowedBy).toBeNull()

    // Player approves only the level-up
    const after = resolve(applySource(record, refreshed, {}, ['level']))
    expect(after.level).toBe((imported.level ?? 1) + 1)
    expect(after.ac).toBe(99)
    expect(after.hpCurrent).toBe(3)
  })

  it('an unchanged refresh reports nothing', () => {
    const record = applySource<CharacterValues>({}, imported)
    expect(diffSource(record, imported)).toEqual([])
  })
})
