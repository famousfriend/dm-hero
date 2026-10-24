<template>
  <div>
    <div class="d-flex align-center flex-wrap ga-3 mb-4">
      <h1 class="text-h5">Notes</h1>
      <v-spacer />
      <v-text-field
        v-model="search"
        prepend-inner-icon="mdi-magnify"
        placeholder="Search notes"
        density="compact"
        hide-details
        clearable
        class="search-field"
      />
      <v-btn color="primary" variant="flat" prepend-icon="mdi-plus" :disabled="activeId === null" @click="newNote">New note</v-btn>
    </div>

    <v-alert v-if="activeId === null" type="info" variant="tonal">Create a character first; notes belong to a character.</v-alert>

    <v-row v-else>
      <v-col cols="12" md="4">
        <v-alert v-if="!notes.length" type="info" variant="tonal" density="compact">No notes yet.</v-alert>
        <v-list v-else bg-color="transparent" class="pa-0">
          <v-list-item
            v-for="note in filtered"
            :key="note.id"
            :active="note.id === selectedId"
            border
            rounded
            class="mb-2"
            @click="select(note.id)"
          >
            <v-list-item-title class="text-wrap">{{ note.title || firstLine(note.body) }}</v-list-item-title>
            <v-list-item-subtitle>{{ formatDate(note.updatedAt) }}</v-list-item-subtitle>
            <template #append>
              <v-icon size="small" :title="note.visibility === 'party' ? 'Shared with the party' : 'Only you'">
                {{ note.visibility === 'party' ? 'mdi-account-group' : 'mdi-lock' }}
              </v-icon>
            </template>
          </v-list-item>
          <div v-if="search && !filtered.length" class="text-medium-emphasis pa-2">No note matches "{{ search }}".</div>
        </v-list>
      </v-col>

      <v-col cols="12" md="8">
        <v-card v-if="draft" border>
          <v-card-text>
            <div class="d-flex align-center flex-wrap ga-3 mb-3">
              <v-btn-toggle v-model="draft.visibility" mandatory density="comfortable" variant="outlined" color="primary" @update:model-value="save">
                <v-btn value="private" prepend-icon="mdi-lock">Only me</v-btn>
                <v-btn value="party" prepend-icon="mdi-account-group">Share with party</v-btn>
              </v-btn-toggle>
              <v-spacer />
              <span class="text-caption text-medium-emphasis">{{ saveState }}</span>
              <v-btn icon="mdi-delete" variant="text" color="error" title="Delete note" @click="confirmDelete = true" />
            </div>
            <v-alert v-if="draft.visibility === 'party'" type="info" variant="tonal" density="compact" class="mb-3">
              The other players will see this note once you connect to your DM's table (coming in a later update).
            </v-alert>
            <v-text-field v-model="draft.title" label="Title" @update:model-value="queueSave" />
            <v-textarea v-model="draft.body" label="Note" auto-grow rows="12" @update:model-value="queueSave" />
          </v-card-text>
        </v-card>
        <div v-else-if="notes.length" class="text-medium-emphasis pa-4">Pick a note on the left, or start a new one.</div>
      </v-col>
    </v-row>

    <v-dialog v-model="confirmDelete" max-width="400">
      <v-card title="Delete this note?">
        <v-card-text>This cannot be undone.</v-card-text>
        <v-card-actions>
          <v-spacer />
          <v-btn variant="text" @click="confirmDelete = false">Cancel</v-btn>
          <v-btn color="error" variant="flat" @click="deleteNote">Delete</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>
  </div>
</template>

<script setup lang="ts">
import type { NoteVisibility } from '@dmcc/character-core'

const { activeId } = useCharacters()
const { notes, createNote, updateNote, remove } = useJournal()

const search = ref('')
const selectedId = ref<number | null>(null)
const draft = ref<{ id: number, title: string, body: string, visibility: NoteVisibility } | null>(null)
const saveState = ref('')
const confirmDelete = ref(false)
let timer: ReturnType<typeof setTimeout> | undefined

const filtered = computed(() => {
  const q = search.value?.trim().toLowerCase()
  if (!q) return notes.value
  return notes.value.filter(n => n.title.toLowerCase().includes(q) || n.body.toLowerCase().includes(q))
})

const firstLine = (text: string) => text.trim().split('\n')[0]?.slice(0, 80) || 'Untitled'
const formatDate = (iso: string) => new Date(iso.replace(' ', 'T') + 'Z').toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })

async function flush() {
  clearTimeout(timer)
  timer = undefined
  if (!draft.value) return
  const { id, title, body, visibility } = draft.value
  saveState.value = 'Saving...'
  await updateNote(id, { title, body, visibility })
  saveState.value = 'Saved'
}

function queueSave() {
  saveState.value = ''
  clearTimeout(timer)
  timer = setTimeout(flush, 600)
}

const save = () => flush()

async function select(id: number) {
  if (timer) await flush()
  const note = notes.value.find(n => n.id === id)
  selectedId.value = id
  draft.value = note ? { id, title: note.title, body: note.body, visibility: note.visibility } : null
  saveState.value = ''
}

async function newNote() {
  if (timer) await flush()
  const created = await createNote({ title: 'New note', body: '', visibility: 'private' })
  await select(created.id)
}

async function deleteNote() {
  if (!draft.value) return
  clearTimeout(timer)
  timer = undefined
  await remove('notes', draft.value.id)
  draft.value = null
  selectedId.value = null
  confirmDelete.value = false
}

// Switching character: drop the open note of the previous one
watch(activeId, () => {
  clearTimeout(timer)
  timer = undefined
  draft.value = null
  selectedId.value = null
})

onBeforeUnmount(() => {
  if (timer) flush()
})
</script>

<style scoped>
.search-field {
  max-width: 280px;
  min-width: 180px;
}
</style>
