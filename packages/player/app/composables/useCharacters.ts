import { playerSheet, type PlayerCampaign, type PlayerCharacter, type PlayerSheet } from '@dmcc/character-core'

type SheetEdits = { [K in keyof PlayerSheet]?: PlayerSheet[K] | null }

/** Characters, campaigns and the active character, shared by every page */
export function useCharacters() {
  const characters = useState<PlayerCharacter[]>('characters', () => [])
  const campaigns = useState<PlayerCampaign[]>('campaigns', () => [])
  const activeId = useState<number | null>('activeCharacterId', () => null)
  const loaded = useState('charactersLoaded', () => false)

  const active = computed(() => characters.value.find(c => c.id === activeId.value) ?? null)
  const activeSheet = computed(() => (active.value ? playerSheet(active.value) : null))
  const campaignOf = (character: PlayerCharacter | null) =>
    campaigns.value.find(c => c.id === character?.campaignId) ?? null

  async function load() {
    const [list, camps] = await Promise.all([
      $fetch<{ characters: PlayerCharacter[], activeId: number | null }>('/api/characters'),
      $fetch<PlayerCampaign[]>('/api/campaigns'),
    ])
    characters.value = list.characters
    activeId.value = list.activeId
    campaigns.value = camps
    loaded.value = true
  }

  async function setActive(id: number) {
    const result = await $fetch<{ activeId: number | null }>('/api/characters/active', { method: 'PUT', body: { id } })
    activeId.value = result.activeId
  }

  async function createCharacter(values: SheetEdits, campaignId: number | null) {
    const created = await $fetch<PlayerCharacter>('/api/characters', { method: 'POST', body: { values, campaignId } })
    await load()
    return created
  }

  async function updateCharacter(id: number, values: SheetEdits, campaignId?: number | null) {
    const body: Record<string, unknown> = { values }
    if (campaignId !== undefined) body.campaignId = campaignId
    const updated = await $fetch<PlayerCharacter>(`/api/characters/${id}`, { method: 'PATCH', body })
    characters.value = characters.value.map(c => (c.id === id ? updated : c))
  }

  async function deleteCharacter(id: number) {
    await $fetch(`/api/characters/${id}`, { method: 'DELETE' })
    await load()
  }

  async function createCampaign(name: string, dmName: string) {
    await $fetch('/api/campaigns', { method: 'POST', body: { name, dmName } })
    await load()
  }

  async function updateCampaign(id: number, name: string, dmName: string) {
    await $fetch(`/api/campaigns/${id}`, { method: 'PATCH', body: { name, dmName } })
    await load()
  }

  async function deleteCampaign(id: number) {
    await $fetch(`/api/campaigns/${id}`, { method: 'DELETE' })
    await load()
  }

  return {
    characters, campaigns, activeId, active, activeSheet, loaded, campaignOf,
    load, setActive, createCharacter, updateCharacter, deleteCharacter,
    createCampaign, updateCampaign, deleteCampaign,
  }
}

export function sheetOf(character: PlayerCharacter) {
  return playerSheet(character)
}

/** "Fighter 5" / "Level 5" */
export function classLine(sheet: PlayerSheet) {
  return sheet.classLabel ? `${sheet.classLabel} ${sheet.level}` : `Level ${sheet.level}`
}
