<template>
  <!-- At-a-glance numbers from the Party data (D&D Beyond or typed in) -->
  <v-card v-if="stats" variant="outlined" class="mb-4 pa-3">
    <div class="d-flex align-center flex-wrap ga-2 mb-2">
      <v-icon color="primary">mdi-card-account-details-star-outline</v-icon>
      <span class="text-title-small">{{ $t('players.quickInfo') }}</span>
      <span v-if="classText" class="text-body-medium text-medium-emphasis">· {{ classText }}</span>
    </div>
    <v-row dense>
      <v-col v-for="tile in tiles" :key="tile.key" cols="6" sm="4" :md="tiles.length > 5 ? 2 : undefined">
        <div class="text-center pa-2 rounded quick-tile d-flex flex-column justify-space-between h-100">
          <div class="text-body-small text-medium-emphasis quick-label">{{ tile.label }}</div>
          <div class="text-headline-small font-weight-bold">{{ tile.value }}</div>
        </div>
      </v-col>
    </v-row>
    <div v-if="stats.conditions.length" class="d-flex flex-wrap ga-1 mt-2">
      <v-chip v-for="c in stats.conditions" :key="c" size="small" color="warning" variant="tonal">{{ c }}</v-chip>
    </div>
  </v-card>
</template>

<script setup lang="ts">
import type { PartyMember } from '~~/types/party'

const props = defineProps<{ entityId: number, refreshKey?: number }>()

const { t } = useI18n()
const campaignStore = useCampaignStore()
const member = ref<PartyMember | null>(null)

async function load() {
  const campaignId = campaignStore.activeCampaignIdNumber
  if (!campaignId) return
  try {
    const members = await $fetch<PartyMember[]>('/api/party', { query: { campaignId } })
    member.value = members.find(m => m.entityId === props.entityId) ?? null
  }
  catch {
    member.value = null
  }
}
watch(() => [props.entityId, props.refreshKey], load, { immediate: true })

const stats = computed(() => member.value?.effective ?? null)
const classText = computed(() => {
  const s = stats.value
  if (!s) return ''
  return [s.classLabel, s.level && !s.classLabel.includes(String(s.level)) ? `${t('players.ddb.level')} ${s.level}` : '']
    .filter(Boolean)
    .join(' ')
})
const tiles = computed(() => {
  const s = stats.value
  if (!s) return []
  const hp = s.hpMax ? `${s.hpCurrent}/${s.hpMax}${s.hpTemp ? ` +${s.hpTemp}` : ''}` : '—'
  const list = [
    { key: 'ac', label: t('party.fields.ac'), value: String(s.ac) },
    { key: 'hp', label: t('party.fields.hpCurrent'), value: hp },
    { key: 'pp', label: t('party.fields.passivePerception'), value: String(s.passivePerception) },
    { key: 'pins', label: t('party.fields.passiveInsight'), value: String(s.passiveInsight) },
    { key: 'pinv', label: t('party.fields.passiveInvestigation'), value: String(s.passiveInvestigation) },
  ]
  if (s.spellSaveDc) list.push({ key: 'dc', label: t('party.fields.spellSaveDc'), value: String(s.spellSaveDc) })
  return list
})
</script>

<style scoped>
.quick-tile {
  background: rgba(var(--v-theme-on-surface), 0.04);
}

.quick-label {
  overflow-wrap: anywhere;
  line-height: 1.2;
}
</style>
