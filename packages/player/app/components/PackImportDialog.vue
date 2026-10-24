<template>
  <v-dialog v-model="open" max-width="560">
    <v-card title="Import from your DM">
      <v-card-text>
        <template v-if="!done">
          <p class="text-body-2 text-medium-emphasis mb-4">
            Your DM saves a player pack in DM Command Center and sends you the file. Pick it here; you see what changes before anything is saved.
          </p>
          <v-file-input
            v-model="file"
            label="Player pack file"
            :accept="`${PLAYER_PACK_EXTENSION},.json`"
            prepend-icon=""
            prepend-inner-icon="mdi-file-download-outline"
            show-size
            :loading="reading"
          />
        </template>

        <v-alert v-if="error" type="error" variant="tonal" density="compact" class="mb-3">{{ error }}</v-alert>

        <template v-if="preview">
          <v-alert :type="done ? 'success' : 'info'" variant="tonal" density="compact" class="mb-3">
            <template v-if="done">Done. {{ characterName }}'s journal is up to date.</template>
            <template v-else>
              For <strong>{{ characterName }}</strong> in
              <strong>{{ preview.campaign.name }}</strong><template v-if="preview.campaign.dmName"> (DM {{ preview.campaign.dmName }})</template><template v-if="preview.campaign.isNew">, a new campaign</template>.
            </template>
          </v-alert>
          <v-alert v-if="!done && otherCharacter" type="warning" variant="tonal" density="compact" class="mb-3">
            Your DM made this pack for {{ preview.forCharacter }}. Switch character first if it isn't meant for {{ characterName }}.
          </v-alert>
          <v-alert v-if="!done && preview.changesCampaign" type="warning" variant="tonal" density="compact" class="mb-3">
            {{ characterName }} moves to this campaign.
          </v-alert>

          <v-table density="compact" class="bg-transparent">
            <thead>
              <tr>
                <th />
                <th class="text-right">New</th>
                <th class="text-right">Updated</th>
                <th class="text-right">Same</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="row in rows" :key="row.label">
                <td><v-icon size="small" class="mr-2">{{ row.icon }}</v-icon>{{ row.label }}</td>
                <td class="text-right">{{ row.added }}</td>
                <td class="text-right">{{ row.updated }}</td>
                <td class="text-right text-medium-emphasis">{{ row.unchanged }}</td>
              </tr>
            </tbody>
          </v-table>
          <p v-if="!done" class="text-caption text-medium-emphasis mt-3">Your own notes are never changed. Nothing is removed.</p>
        </template>
      </v-card-text>
      <v-card-actions>
        <v-spacer />
        <template v-if="done">
          <v-btn color="primary" variant="flat" to="/journal" @click="open = false">Open journal</v-btn>
        </template>
        <template v-else>
          <v-btn variant="text" @click="open = false">Cancel</v-btn>
          <v-btn color="primary" variant="flat" :disabled="!preview" :loading="applying" @click="apply">Import</v-btn>
        </template>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>

<script setup lang="ts">
import { PLAYER_PACK_EXTENSION, type PackImportResult } from '@dmcc/character-core'

const open = defineModel<boolean>({ required: true })

const { activeSheet, load: loadCharacters } = useCharacters()
const { importPack } = useJournal()

const file = ref<File | null>(null)
const pack = ref<unknown>(null)
const preview = ref<PackImportResult | null>(null)
const reading = ref(false)
const applying = ref(false)
const done = ref(false)
const error = ref('')

const characterName = computed(() => activeSheet.value?.name || 'your character')
const otherCharacter = computed(() => {
  const target = preview.value?.forCharacter?.trim().toLowerCase()
  return !!target && target !== activeSheet.value?.name.trim().toLowerCase()
})

const rows = computed(() => {
  const c = preview.value?.counts
  if (!c) return []
  return [
    { label: 'Quests', icon: 'mdi-script-text-outline', ...c.quests },
    { label: 'NPCs', icon: 'mdi-account-group', ...c.npcs },
    { label: 'Places', icon: 'mdi-map-marker', ...c.places },
  ]
})

const messageOf = (e: unknown, fallback: string) => (e as { data?: { message?: string } }).data?.message ?? fallback

watch(open, (value) => {
  if (!value) return
  file.value = null
  pack.value = null
  preview.value = null
  done.value = false
  error.value = ''
})

watch(file, async (picked) => {
  pack.value = null
  preview.value = null
  error.value = ''
  if (!picked) return
  reading.value = true
  try {
    try {
      pack.value = JSON.parse(await picked.text())
    }
    catch {
      error.value = 'This file could not be read. Ask your DM to save the player pack again.'
      return
    }
    preview.value = await importPack(pack.value, false)
  }
  catch (e) {
    error.value = messageOf(e, 'Could not read the player pack.')
  }
  finally {
    reading.value = false
  }
})

async function apply() {
  applying.value = true
  error.value = ''
  try {
    preview.value = await importPack(pack.value, true)
    await loadCharacters()
    done.value = true
  }
  catch (e) {
    error.value = messageOf(e, 'Import failed.')
  }
  finally {
    applying.value = false
  }
}
</script>
