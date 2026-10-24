import type { JournalNpc, JournalPlace, NoteVisibility, PlayerNote } from '@dmcc/character-core'

/** Notes, places and NPCs of the active character; reloads when the character changes */
export function useJournal() {
  const { activeId } = useCharacters()
  const notes = useState<PlayerNote[]>('journalNotes', () => [])
  const places = useState<JournalPlace[]>('journalPlaces', () => [])
  const npcs = useState<JournalNpc[]>('journalNpcs', () => [])
  const loadedFor = useState<number | null>('journalLoadedFor', () => null)

  async function load() {
    const characterId = activeId.value
    if (characterId === null) {
      notes.value = []
      places.value = []
      npcs.value = []
      loadedFor.value = null
      return
    }
    const data = await $fetch<{ notes: PlayerNote[], places: JournalPlace[], npcs: JournalNpc[] }>('/api/journal', { query: { characterId } })
    notes.value = data.notes
    places.value = data.places
    npcs.value = data.npcs
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

  async function remove(kind: 'notes' | 'places' | 'npcs', id: number) {
    await $fetch(`/api/journal/${kind}/${id}`, { method: 'DELETE' })
    await load()
  }

  return { notes, places, npcs, loadedFor, load, createNote, updateNote, saveEntry, remove }
}
