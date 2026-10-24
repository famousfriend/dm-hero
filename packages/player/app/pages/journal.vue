<template>
  <div>
    <div class="d-flex align-center flex-wrap ga-3 mb-2">
      <h1 class="text-h5">NPCs &amp; Places</h1>
      <v-spacer />
      <v-text-field
        v-model="search"
        prepend-inner-icon="mdi-magnify"
        placeholder="Search"
        density="compact"
        hide-details
        clearable
        class="search-field"
      />
      <v-btn color="primary" variant="flat" prepend-icon="mdi-plus" :disabled="activeId === null" @click="edit(null)">
        {{ tab === 'npcs' ? 'Add NPC' : 'Add place' }}
      </v-btn>
    </div>

    <v-alert v-if="activeId === null" type="info" variant="tonal">Create a character first; NPCs and places belong to a character.</v-alert>

    <template v-else>
      <v-tabs v-model="tab" color="primary" class="mb-4">
        <v-tab value="npcs" prepend-icon="mdi-account-group">NPCs met ({{ npcs.length }})</v-tab>
        <v-tab value="places" prepend-icon="mdi-map-marker">Places ({{ places.length }})</v-tab>
      </v-tabs>

      <v-alert v-if="!shown.length" type="info" variant="tonal" density="compact">
        <template v-if="search">Nothing matches "{{ search }}".</template>
        <template v-else-if="tab === 'npcs'">No NPCs yet. Add the people you meet, or your DM can send them to you.</template>
        <template v-else>No places yet. Add where you've been, or your DM can send them to you.</template>
      </v-alert>

      <v-row>
        <v-col v-for="entry in shown" :key="entry.id" cols="12" md="6" xl="4">
          <v-card border class="entry-card h-100" @click="edit(entry)">
            <v-card-item>
              <v-card-title class="text-wrap">{{ entry.name }}</v-card-title>
              <v-card-subtitle v-if="tab === 'npcs'" class="text-wrap">
                <v-icon size="x-small" class="mr-1">mdi-map-marker</v-icon>
                {{ placeName((entry as JournalNpc).placeId) ?? 'Where you met: not set' }}
              </v-card-subtitle>
              <template #append>
                <v-chip v-if="entry.source === 'dm'" size="small" color="secondary" variant="flat" prepend-icon="mdi-crown">From DM</v-chip>
              </template>
            </v-card-item>
            <v-card-text>
              <p v-if="entry.description" class="pre-wrap mb-2">{{ entry.description }}</p>
              <p v-if="entry.playerNotes" class="pre-wrap text-medium-emphasis mb-2">
                <v-icon size="x-small" class="mr-1">mdi-pencil</v-icon>{{ entry.playerNotes }}
              </p>
              <div v-if="tab === 'places' && npcsAt(entry.id).length" class="text-body-2">
                <v-icon size="x-small" class="mr-1">mdi-account-group</v-icon>
                Met here: {{ npcsAt(entry.id).join(', ') }}
              </div>
            </v-card-text>
          </v-card>
        </v-col>
      </v-row>
    </template>

    <v-dialog v-model="formOpen" max-width="560">
      <v-card :title="dialogTitle">
        <v-card-text>
          <v-alert v-if="fromDm" type="info" variant="tonal" density="compact" class="mb-3">
            Your DM gave you this entry. Its name and description stay as the DM wrote them; your notes are yours.
          </v-alert>
          <v-text-field v-model="form.name" label="Name" :readonly="fromDm" autofocus />
          <v-select
            v-if="tab === 'npcs'"
            v-model="form.placeId"
            :items="placeItems"
            label="Where you met"
            :hint="places.length ? '' : 'Add places on the Places tab first.'"
            persistent-hint
          />
          <v-textarea v-model="form.description" label="Description" :readonly="fromDm" auto-grow rows="3" />
          <v-textarea v-model="form.playerNotes" label="My notes" auto-grow rows="3" />
          <v-alert v-if="error" type="error" variant="tonal" density="compact">{{ error }}</v-alert>
        </v-card-text>
        <v-card-actions>
          <v-btn v-if="editingId !== null" color="error" variant="text" prepend-icon="mdi-delete" @click="removeEntry">Remove</v-btn>
          <v-spacer />
          <v-btn variant="text" @click="formOpen = false">Cancel</v-btn>
          <v-btn color="primary" variant="flat" :disabled="!form.name.trim()" @click="save">Save</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>
  </div>
</template>

<script setup lang="ts">
import type { JournalNpc, JournalPlace } from '@dmcc/character-core'

const { activeId } = useCharacters()
const { npcs, places, saveEntry, remove } = useJournal()

const tab = ref<'npcs' | 'places'>('npcs')
const search = ref('')
const formOpen = ref(false)
const editingId = ref<number | null>(null)
const fromDm = ref(false)
const error = ref('')
const form = ref({ name: '', description: '', playerNotes: '', placeId: null as number | null })

const shown = computed<(JournalNpc | JournalPlace)[]>(() => {
  const list = tab.value === 'npcs' ? npcs.value : places.value
  const q = search.value?.trim().toLowerCase()
  if (!q) return list
  return list.filter(e => [e.name, e.description, e.playerNotes].some(t => t.toLowerCase().includes(q)))
})

const placeItems = computed(() => [{ title: 'Not set', value: null }, ...places.value.map(p => ({ title: p.name, value: p.id }))])
const placeName = (id: number | null) => places.value.find(p => p.id === id)?.name ?? null
const npcsAt = (placeId: number) => npcs.value.filter(n => n.placeId === placeId).map(n => n.name)
const dialogTitle = computed(() => {
  const what = tab.value === 'npcs' ? 'NPC' : 'place'
  return editingId.value === null ? `Add ${what}` : `Edit ${what}`
})

function edit(entry: JournalNpc | JournalPlace | null) {
  error.value = ''
  editingId.value = entry?.id ?? null
  fromDm.value = entry?.source === 'dm'
  form.value = {
    name: entry?.name ?? '',
    description: entry?.description ?? '',
    playerNotes: entry?.playerNotes ?? '',
    placeId: entry && 'placeId' in entry ? entry.placeId : null,
  }
  formOpen.value = true
}

async function save() {
  error.value = ''
  const body: Record<string, unknown> = fromDm.value
    ? { playerNotes: form.value.playerNotes }
    : { name: form.value.name.trim(), description: form.value.description, playerNotes: form.value.playerNotes }
  if (tab.value === 'npcs') body.placeId = form.value.placeId
  try {
    await saveEntry(tab.value, editingId.value, body)
    formOpen.value = false
  }
  catch (e) {
    error.value = (e as { data?: { message?: string } }).data?.message ?? 'Could not save.'
  }
}

async function removeEntry() {
  if (editingId.value === null) return
  await remove(tab.value, editingId.value)
  formOpen.value = false
}
</script>

<style scoped>
.search-field {
  max-width: 280px;
  min-width: 180px;
}

.entry-card {
  transition: border-color 0.15s ease;
}

.entry-card:hover {
  border-color: rgb(var(--v-theme-primary)) !important;
}

.pre-wrap {
  white-space: pre-wrap;
}
</style>
