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
  </v-container>
</template>

<script setup lang="ts">
import type { PartyMember } from '~~/types/party'

const { t } = useI18n()
const campaignStore = useCampaignStore()
const snackbar = useSnackbarStore()

const campaignId = computed(() => campaignStore.activeCampaignIdNumber)
const members = ref<PartyMember[]>([])
const loading = ref(false)
const refreshing = ref(false)
const editing = ref<PartyMember | null>(null)
const now = ref(Date.now())

const hasLinked = computed(() => members.value.some(m => m.ddbCharacterId))

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

async function load() {
  if (!campaignId.value) return
  loading.value = true
  try {
    members.value = await $fetch<PartyMember[]>('/api/party', { query: { campaignId: campaignId.value } })
  }
  finally {
    loading.value = false
  }
}

async function refreshAll(force = false) {
  if (!campaignId.value || refreshing.value) return
  refreshing.value = true
  try {
    if (force) {
      for (const member of members.value.filter(m => m.ddbCharacterId)) {
        replaceMember(await $fetch<PartyMember>(`/api/party/${member.entityId}/refresh`, { method: 'POST' }))
      }
    }
    else {
      members.value = await $fetch<PartyMember[]>('/api/party/refresh', {
        method: 'POST',
        query: { campaignId: campaignId.value },
      })
    }
  }
  catch {
    snackbar.error(t('party.refreshFailed'))
  }
  finally {
    refreshing.value = false
  }
}

async function refreshOne(member: PartyMember) {
  replaceMember(await $fetch<PartyMember>(`/api/party/${member.entityId}/refresh`, { method: 'POST' }))
}

async function updateManual(member: PartyMember, manual: Record<string, unknown>) {
  try {
    replaceMember(await $fetch<PartyMember>(`/api/party/${member.entityId}`, { method: 'PATCH', body: { manual } }))
  }
  catch {
    snackbar.error(t('party.saveFailed'))
  }
}

function replaceMember(updated: PartyMember) {
  const index = members.value.findIndex(m => m.entityId === updated.entityId)
  if (index >= 0) members.value[index] = updated
  if (editing.value?.entityId === updated.entityId) editing.value = updated
}

// Timers: auto-refresh only while this page is open and visible; a clock for "x min ago"
let refreshTimer: ReturnType<typeof setInterval> | undefined
let clockTimer: ReturnType<typeof setInterval> | undefined

function scheduleRefresh() {
  clearInterval(refreshTimer)
  if (refreshSeconds.value > 0) {
    refreshTimer = setInterval(() => {
      if (document.visibilityState === 'visible' && hasLinked.value) refreshAll()
    }, refreshSeconds.value * 1000)
  }
}

watch(refreshSeconds, (value) => {
  try {
    localStorage.setItem(REFRESH_KEY, String(value))
  }
  catch {
    // storage unavailable: setting just isn't remembered
  }
  scheduleRefresh()
})

watch(campaignId, async () => {
  members.value = []
  await load()
  if (hasLinked.value) refreshAll()
})

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
  await load()
  if (hasLinked.value) refreshAll()
  scheduleRefresh()
  clockTimer = setInterval(() => (now.value = Date.now()), 15000)
})

onBeforeUnmount(() => {
  clearInterval(refreshTimer)
  clearInterval(clockTimer)
})
</script>

<style scoped>
.refresh-select {
  max-width: 200px;
}
</style>
