<template>
  <div>
    <div v-if="!openEncounters.length" class="text-body-medium text-medium-emphasis mb-2">{{ $t('live.noEncounters') }}</div>
    <v-list v-else density="compact" class="py-0">
      <v-list-item
        v-for="encounter in openEncounters"
        :key="encounter.id"
        :title="encounter.name"
        :subtitle="statusLabel(encounter)"
        :prepend-icon="encounter.status === 'active' ? 'mdi-sword-cross' : 'mdi-sword'"
        class="px-1"
        @click="openCombat(encounter.id)"
      >
        <template #append>
          <v-icon size="small">mdi-chevron-right</v-icon>
        </template>
      </v-list-item>
    </v-list>
    <div class="d-flex ga-2 mt-2">
      <v-text-field
        v-model="newName"
        :placeholder="$t('live.newEncounter')"
        density="compact"
        variant="outlined"
        hide-details
        @keydown.enter="create"
      />
      <v-btn icon="mdi-plus" size="small" variant="tonal" :disabled="!newName.trim()" :title="$t('encounters.create')" @click="create" />
    </div>
  </div>
</template>

<script setup lang="ts">
import type { Encounter } from '~~/types/encounter'

const { t } = useI18n()
const router = useRouter()
const campaignStore = useCampaignStore()
const encounterStore = useEncounterStore()
const snackbar = useSnackbarStore()
const newName = ref('')

// Running fights first, then prepared ones
const openEncounters = computed(() =>
  encounterStore.encounters
    .filter(e => e.status !== 'finished' && !e.deleted_at)
    .sort((a, b) => Number(b.status === 'active') - Number(a.status === 'active')),
)

function statusLabel(encounter: Encounter) {
  const status = t(`encounters.statuses.${encounter.status}`)
  return encounter.status === 'active' ? `${status} · ${t('encounters.round')} ${encounter.round}` : status
}

async function openCombat(id: number) {
  await router.push('/encounters')
  await encounterStore.openEncounter(id)
}

async function create() {
  const campaignId = campaignStore.activeCampaignIdNumber
  const name = newName.value.trim()
  if (!campaignId || !name) return
  const encounter = await encounterStore.createEncounter(campaignId, name)
  if (!encounter) {
    snackbar.error(t('palette.createFailed'))
    return
  }
  newName.value = ''
  await openCombat(encounter.id)
}

watch(
  () => campaignStore.activeCampaignIdNumber,
  (id) => {
    if (id) encounterStore.fetchEncounters(id, true)
  },
  { immediate: true },
)
</script>
