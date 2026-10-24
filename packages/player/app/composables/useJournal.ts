import type { JournalNpc, JournalPlace, JournalQuest, NoteVisibility, PackImportResult, PlayerNote } from '@dmcc/character-core'

/** Notes, places, NPCs and quests of the active character; reloads when the character changes */
export function useJournal() {
  const { activeId } = useCharacters()
  const notes = useState<PlayerNote[]>('journalNotes', () => [])
  const places = useState<JournalPlace[]>('journalPlaces', () => [])
  const npcs = useState<JournalNpc[]>('journalNpcs', () => [])
  const quests = useState<JournalQuest[]>('journalQuests', () => [])
  const loadedFor = useState<number | null>('journalLoadedFor', () => null)

  async function load() {
    const characterId = activeId.value
    if (characterId === null) {
      notes.value = []
      places.value = []
      npcs.value = []
      quests.value = []
      loadedFor.value = null
      return
    }
    const data = await $fetch<{ notes: PlayerNote[], places: JournalPlace[], npcs: JournalNpc[], quests: JournalQuest[] }>('/api/journal', { query: { characterId } })
    notes.value = data.notes
    places.value = data.places
    npcs.value = data.npcs
    quests.value = data.quests
    loadedFor.value = characterId
  }

  watch(activeId, load, { immediate: true })

  async function createNote(note: { title: string, body: string, visibility: NoteVisibility }) {
    const created = await $fetch<PlayerNote>('/api/journal/notes', { method: 'POST', body: { ...note, characterId: activeId.value } })
    notes.value = [created, ...notes.value]
    return created
  }

  async function updateNote(id: number, changes: Partial<Pick<PlayerNote, 'title' | 'body' | 'visibility'>>) {
    const updated = await $fetch<PlayerNote>(`/api/journal/notes/${id}`, { method: 'PATCH', body: changes })
    notes.value = notes.value.map(n => (n.id === id ? updated : n))
    return updated
  }

  async function saveEntry(kind: 'places' | 'npcs', id: number | null, body: Record<string, unknown>) {
    if (id === null) await $fetch(`/api/journal/${kind}`, { method: 'POST', body: { ...body, characterId: activeId.value } })
    else await $fetch(`/api/journal/${kind}/${id}`, { method: 'PATCH', body })
    await load()
  }

  async function saveQuestNotes(id: number, playerNotes: string) {
    const updated = await $fetch<JournalQuest>(`/api/journal/quests/${id}`, { method: 'PATCH', body: { playerNotes } })
    quests.value = quests.value.map(q => (q.id === id ? updated : q))
  }

  /** Player pack from the DM: apply false only previews */
  async function importPack(pack: unknown, apply: boolean) {
    const result = await $fetch<PackImportResult>('/api/journal/import-pack', { method: 'POST', body: { characterId: activeId.value, pack, apply } })
    if (apply) await load()
    return result
  }

  async function remove(kind: 'notes' | 'places' | 'npcs' | 'quests', id: number) {
    await $fetch(`/api/journal/${kind}/${id}`, { method: 'DELETE' })
    await load()
  }

  return { notes, places, npcs, quests, loadedFor, load, createNote, updateNote, saveEntry, saveQuestNotes, importPack, remove }
}
