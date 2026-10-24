<template>
  <v-container>
    <div v-if="!campaignId" class="text-center py-16">
      <v-icon icon="mdi-shield-account" size="64" class="mb-4" color="primary" />
      <h2 class="text-headline-large mb-4">{{ $t('party.noCampaign') }}</h2>
      <v-btn color="primary" size="large" to="/campaigns" prepend-icon="mdi-arrow-right">
        {{ $t('party.chooseCampaign') }}
      </v-btn>
    </div>

    <div v-else>
      <div class="d-flex align-center flex-wrap ga-4 mb-4">
        <div class="flex-grow-1">
          <div class="text-headline-large mb-2">
            <v-icon icon="mdi-shield-account" size="36" class="mr-2" />
            {{ $t('party.title') }}
          </div>
          <p class="text-body-large text-medium-emphasis">{{ $t('party.subtitle') }}</p>
        </div>
        <v-select
          v-model="refreshSeconds"
          :items="refreshOptions"
          :label="$t('party.autoRefresh')"
          density="compact"
          variant="outlined"
          hide-details
          class="refresh-select"
        />
        <v-btn variant="tonal" prepend-icon="mdi-file-send-outline" @click="packOpen = true">
          {{ $t('party.pack.button') }}
        </v-btn>
        <v-btn
          color="primary"
          prepend-icon="mdi-refresh"
          :loading="refreshing"
          :disabled="!hasLinked"
          @click="refreshAll(true)"
        >
          {{ $t('party.refreshAll') }}
        </v-btn>
      </div>

      <v-progress-linear v-if="loading && !members.length" indeterminate />

      <v-alert v-else-if="!members.length" type="info" variant="tonal">
        {{ $t('party.empty') }}
        <template #append>
          <v-btn variant="text" to="/players">{{ $t('nav.players') }}</v-btn>
        </template>
      </v-alert>

      <v-row v-else>
        <v-col v-for="member in members" :key="member.entityId" cols="12" sm="6" lg="4" xl="3">
          <PartyMemberCard
            :member="member"
            :now="now"
            @edit="editing = $event"
            @refresh="refreshOne"
            @update-manual="updateManual"
          />
        </v-col>
      </v-row>
    </div>

    <PartyEditDialog :member="editing" @close="editing = null" @updated="replaceMember" />
    <PartyPlayerPackDialog
      v-if="campaignId"
      v-model="packOpen"
      :campaign-id="campaignId"
      :campaign-name="campaignStore.currentCampaign?.name ?? ''"
      :members="members"
    />
  </v-container>
</template>

<script setup lang="ts">
import type { PartyMember } from '~~/types/party'

const { t } = useI18n()
const {
  campaignId,
  members,
  loading,
  refreshing,
  hasLinked,
  loadAndRefresh,
  refreshAll,
  refreshOne,
  updateManual,
  replaceMember,
  onReplace,
  scheduleRefresh,
} = useParty()

const campaignStore = useCampaignStore()
const packOpen = ref(false)
const editing = ref<PartyMember | null>(null)
const now = ref(Date.now())
onReplace.push((updated) => {
  if (editing.value?.entityId === updated.entityId) editing.value = updated
})

// Auto-refresh interval, remembered per browser (0 = off)
const REFRESH_KEY = 'dmcc-party-refresh-seconds'
const refreshOptions = computed(() => [
  { title: t('party.refreshOff'), value: 0 },
  { title: t('party.everySeconds', { n: 30 }), value: 30 },
  { title: t('party.everyMinutes', { n: 1 }), value: 60 },
  { title: t('party.everyMinutes', { n: 2 }), value: 120 },
  { title: t('party.everyMinutes', { n: 5 }), value: 300 },
])
const refreshSeconds = ref(60)

watch(refreshSeconds, (value) => {
  try {
    localStorage.setItem(REFRESH_KEY, String(value))
  }
  catch {
    // storage unavailable: setting just isn't remembered
  }
  scheduleRefresh(value)
})

// A clock for "x min ago"
let clockTimer: ReturnType<typeof setInterval> | undefined

onMounted(async () => {
  try {
    const saved = Number(localStorage.getItem(REFRESH_KEY))
    if (refreshOptions.value.some(o => o.value === saved) && localStorage.getItem(REFRESH_KEY) !== null) {
      refreshSeconds.value = saved
    }
  }
  catch {
    // keep default
  }
  await loadAndRefresh()
  scheduleRefresh(refreshSeconds.value)
  clockTimer = setInterval(() => (now.value = Date.now()), 15000)
})

onBeforeUnmount(() => clearInterval(clockTimer))
</script>

<style scoped>
.refresh-select {
  max-width: 200px;
}
</style>
