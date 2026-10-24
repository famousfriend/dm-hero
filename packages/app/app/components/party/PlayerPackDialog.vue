<template>
  <v-dialog v-model="open" max-width="760" scrollable>
    <v-card :title="$t('party.pack.title')">
      <v-card-text>
        <p class="text-body-2 text-medium-emphasis mb-4">{{ $t('party.pack.intro') }}</p>

        <v-row dense>
          <v-col cols="12" sm="6">
            <v-select
              v-model="forCharacter"
              :items="characterItems"
              :label="$t('party.pack.forCharacter')"
              density="compact"
              variant="outlined"
            />
          </v-col>
          <v-col cols="12" sm="6">
            <v-text-field v-model="dmName" :label="$t('party.pack.dmName')" density="compact" variant="outlined" />
          </v-col>
        </v-row>

        <v-text-field
          v-model="search"
          prepend-inner-icon="mdi-magnify"
          :placeholder="$t('party.pack.search')"
          density="compact"
          variant="outlined"
          hide-details
          clearable
          class="mb-3"
        />

        <v-progress-linear v-if="loading" indeterminate class="mb-3" />

        <div v-for="section in sections" :key="section.key" class="mb-4">
          <div class="d-flex align-center mb-1">
            <v-icon :icon="section.icon" size="small" class="mr-2" />
            <span class="text-subtitle-2">{{ section.label }} ({{ selected[section.key].length }}/{{ section.items.length }})</span>
            <v-spacer />
            <v-btn size="small" variant="text" :disabled="!section.items.length" @click="toggleAll(section.key, section.items)">
              {{ allPicked(section.key, section.items) ? $t('party.pack.none') : $t('party.pack.all') }}
            </v-btn>
          </div>
          <div v-if="!section.items.length" class="text-body-2 text-medium-emphasis ml-7">{{ $t('party.pack.nothing') }}</div>
          <div class="pick-grid">
            <v-checkbox
              v-for="item in section.shown"
              :key="item.id"
              v-model="selected[section.key]"
              :value="item.id"
              :label="item.name"
              density="compact"
              hide-details
            />
          </div>
        </div>

        <v-switch v-model="includeDescriptions" color="warning" :label="$t('party.pack.includeDescriptions')" hide-details inset />
        <v-alert v-if="includeDescriptions" type="warning" variant="tonal" density="compact" class="mt-2">
          {{ $t('party.pack.secretsWarning') }}
        </v-alert>
        <v-alert v-if="error" type="error" variant="tonal" density="compact" class="mt-3">{{ error }}</v-alert>
      </v-card-text>
      <v-card-actions>
        <v-spacer />
        <v-btn variant="text" @click="open = false">{{ $t('common.cancel') }}</v-btn>
        <v-btn color="primary" variant="flat" prepend-icon="mdi-download" :loading="exporting" :disabled="!picked" @click="exportPack">
          {{ $t('party.pack.export') }}
        </v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>

<script setup lang="ts">
import { PLAYER_PACK_EXTENSION } from '@dmcc/character-core'
import type { PartyMember } from '~~/types/party'
import type { LinkedEntity, Quest } from '~~/types/quests'

const open = defineModel<boolean>({ required: true })
const props = defineProps<{ campaignId: number, campaignName: string, members: PartyMember[] }>()

const { t } = useI18n()
type Key = 'npcIds' | 'placeIds' | 'questIds'
interface Pickable { id: number, name: string }

const linkable = ref<LinkedEntity[]>([])
const quests = ref<Quest[]>([])
const selected = reactive<Record<Key, number[]>>({ npcIds: [], placeIds: [], questIds: [] })
const search = ref('')
const forCharacter = ref<string | null>(null)
const dmName = ref('')
const includeDescriptions = ref(false)
const loading = ref(false)
const exporting = ref(false)
const error = ref('')

const DM_NAME_KEY = 'dmcc-player-pack-dm-name'

const characterItems = computed(() => [
  { title: t('party.pack.wholeParty'), value: null },
  ...props.members.map(m => ({ title: m.effective.name || m.entityName, value: m.effective.name || m.entityName })),
])

const byType = (type: string): Pickable[] => linkable.value.filter(e => e.type === type).map(e => ({ id: e.id, name: e.name }))
const matches = (items: Pickable[]) => {
  const q = search.value?.trim().toLowerCase()
  return q ? items.filter(i => i.name.toLowerCase().includes(q)) : items
}

const sections = computed(() => {
  const list = [
    { key: 'questIds' as Key, label: t('party.pack.quests'), icon: 'mdi-script-text-outline', items: quests.value.map(q => ({ id: q.id, name: q.name })) },
    { key: 'npcIds' as Key, label: t('party.pack.npcs'), icon: 'mdi-account-group', items: byType('NPC') },
    { key: 'placeIds' as Key, label: t('party.pack.places'), icon: 'mdi-map-marker', items: byType('Location') },
  ]
  return list.map(s => ({ ...s, shown: matches(s.items) }))
})

const picked = computed(() => selected.npcIds.length + selected.placeIds.length + selected.questIds.length > 0)
const allPicked = (key: Key, items: Pickable[]) => items.length > 0 && items.every(i => selected[key].includes(i.id))
function toggleAll(key: Key, items: Pickable[]) {
  selected[key] = allPicked(key, items) ? [] : items.map(i => i.id)
}

watch(open, async (isOpen) => {
  if (!isOpen) return
  error.value = ''
  try {
    dmName.value = localStorage.getItem(DM_NAME_KEY) ?? ''
  }
  catch {
    // storage unavailable
  }
  loading.value = true
  try {
    const [entities, questList] = await Promise.all([
      $fetch<LinkedEntity[]>('/api/quests/linkable', { query: { campaignId: props.campaignId } }),
      $fetch<Quest[]>('/api/quests', { query: { campaignId: props.campaignId } }),
    ])
    linkable.value = entities
    quests.value = questList.filter(q => !q.archivedAt)
    // Start with the quests still on the table; NPCs and places are the DM's pick
    if (!selected.questIds.length) selected.questIds = quests.value.filter(q => q.status === 'open' || q.status === 'active').map(q => q.id)
  }
  catch {
    error.value = t('party.pack.loadFailed')
  }
  finally {
    loading.value = false
  }
})

async function exportPack() {
  exporting.value = true
  error.value = ''
  try {
    localStorage.setItem(DM_NAME_KEY, dmName.value.trim())
  }
  catch {
    // not remembered
  }
  try {
    const pack = await $fetch('/api/quests/player-pack', {
      method: 'POST',
      body: {
        campaignId: props.campaignId,
        ...selected,
        includeDescriptions: includeDescriptions.value,
        forCharacter: forCharacter.value,
        dmName: dmName.value,
      },
    })
    const name = [props.campaignName, forCharacter.value].filter(Boolean).join(' - ').replace(/[\\/:*?"<>|]+/g, '').trim() || 'player-pack'
    const url = URL.createObjectURL(new Blob([JSON.stringify(pack, null, 2)], { type: 'application/json' }))
    const link = document.createElement('a')
    link.href = url
    link.download = `${name}${PLAYER_PACK_EXTENSION}`
    link.click()
    URL.revokeObjectURL(url)
    open.value = false
  }
  catch {
    error.value = t('party.pack.exportFailed')
  }
  finally {
    exporting.value = false
  }
}
</script>

<style scoped>
.pick-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
  margin-left: 20px;
}
</style>
