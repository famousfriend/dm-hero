<template>
  <v-container fluid class="live-page">
    <div v-if="!campaignId" class="text-center py-16">
      <v-icon icon="mdi-play-circle-outline" size="64" class="mb-4" color="primary" />
      <h2 class="text-headline-large mb-4">{{ $t('party.noCampaign') }}</h2>
      <v-btn color="primary" size="large" to="/campaigns" prepend-icon="mdi-arrow-right">
        {{ $t('party.chooseCampaign') }}
      </v-btn>
    </div>

    <template v-else>
      <div class="d-flex align-center flex-wrap ga-3 mb-4">
        <div class="flex-grow-1">
          <div class="text-headline-medium">
            <v-icon icon="mdi-play-circle-outline" size="32" class="mr-1" />
            {{ $t('live.title') }}
          </div>
          <p class="text-body-medium text-medium-emphasis">{{ $t(`live.modeHint.${layout.mode}`) }}</p>
        </div>
        <v-btn-toggle v-model="layout.mode" mandatory divided density="comfortable" variant="outlined" color="primary">
          <v-btn value="prep" prepend-icon="mdi-notebook-edit-outline">{{ $t('live.modes.prep') }}</v-btn>
          <v-btn value="live" prepend-icon="mdi-dice-d20">{{ $t('live.modes.live') }}</v-btn>
        </v-btn-toggle>
        <v-menu :close-on-content-click="false">
          <template #activator="{ props: menuProps }">
            <v-btn v-bind="menuProps" variant="text" prepend-icon="mdi-view-dashboard-edit-outline">{{ $t('live.panels') }}</v-btn>
          </template>
          <v-list density="compact">
            <v-list-subheader>{{ $t('live.panelsHint', { mode: $t(`live.modes.${layout.mode}`) }) }}</v-list-subheader>
            <v-list-item v-for="panel in LIVE_PANELS" :key="panel" @click="panelState(panel).shown = !panelState(panel).shown">
              <template #prepend>
                <v-checkbox-btn :model-value="panelState(panel).shown" density="compact" />
              </template>
              <v-list-item-title>{{ $t(`live.panel.${panel}`) }}</v-list-item-title>
            </v-list-item>
            <v-divider class="my-1" />
            <v-list-item prepend-icon="mdi-restore" :title="$t('live.resetLayout')" @click="resetLayout" />
          </v-list>
        </v-menu>
      </div>

      <!-- Client only: panels come from browser-saved layout and client stores -->
      <ClientOnly>
        <SharedPinboard class="mb-4" />

        <v-row>
          <v-col v-for="(column, index) in columns" :key="index" cols="12" md="6" lg="4">
            <template v-for="panel in column" :key="panel">
              <LivePanel
                v-if="panelState(panel).shown"
                v-model:collapsed="panelState(panel).collapsed"
                :title="$t(`live.panel.${panel}`)"
                :icon="PANEL_ICONS[panel]"
                :color="panel === 'next' ? 'warning' : undefined"
              >
                <template v-if="panel === 'party'" #actions>
                  <v-btn
                    icon="mdi-refresh"
                    size="x-small"
                    variant="text"
                    :loading="party.refreshing.value"
                    :disabled="!party.hasLinked.value"
                    :title="$t('party.refreshAll')"
                    @click="party.refreshAll(true)"
                  />
                  <v-btn icon="mdi-open-in-new" size="x-small" variant="text" to="/party" :title="$t('nav.party')" />
                </template>
                <template v-else-if="panel === 'session' && currentSession" #actions>
                  <v-btn icon="mdi-open-in-new" size="x-small" variant="text" to="/sessions" :title="$t('nav.sessions')" />
                </template>
                <template v-else-if="panel === 'quests'" #actions>
                  <v-btn icon="mdi-open-in-new" size="x-small" variant="text" to="/quests" :title="$t('nav.quests')" />
                </template>

                <LivePartyList
                  v-if="panel === 'party'"
                  :members="party.members.value"
                  :loading="party.loading.value"
                  @edit="editing = $event"
                  @update-manual="party.updateManual"
                />

                <LiveCombat v-else-if="panel === 'combat'" />

                <template v-else-if="panel === 'session'">
                  <template v-if="sessions.length">
                    <v-select
                      v-model="sessionId"
                      :items="sessionItems"
                      :label="$t('live.currentSession')"
                      density="compact"
                      variant="outlined"
                      hide-details
                      class="mb-3"
                    />
                    <p class="text-body-small text-medium-emphasis mb-2">{{ $t('continuity.hint') }}</p>
                    <QuestsContinuityList v-if="sessionId" :session-id="sessionId" @changed="nextList?.reload()" />
                  </template>
                  <div v-else class="text-body-medium text-medium-emphasis">
                    {{ $t('live.noSessions') }}
                    <v-btn variant="text" size="small" to="/sessions">{{ $t('sessions.create') }}</v-btn>
                  </div>
                </template>

                <LiveNotes v-else-if="panel === 'notes'" />

                <LiveLookup v-else-if="panel === 'lookup'" />

                <QuestsContinuityList
                  v-else-if="panel === 'next'"
                  :ref="setNextList"
                  readonly
                  open-only
                  next-only
                  show-session
                  :empty-text="$t('quests.nextSessionEmpty')"
                />

                <template v-else-if="panel === 'quests'">
                  <div v-if="!openQuests.length" class="text-body-medium text-medium-emphasis">{{ $t('quests.openThreadsEmpty') }}</div>
                  <v-list v-else density="compact" class="py-0">
                    <v-list-item
                      v-for="quest in openQuests"
                      :key="quest.id"
                      :title="quest.name"
                      :subtitle="quest.giver ? $t('quests.givenBy', { name: quest.giver.name }) : undefined"
                      :to="`/quests?highlight=${quest.id}`"
                      class="px-1"
                    >
                      <template #append>
                        <v-chip size="x-small" variant="tonal">{{ $t(`quests.statuses.${quest.status}`) }}</v-chip>
                      </template>
                    </v-list-item>
                  </v-list>
                </template>
              </LivePanel>
            </template>
          </v-col>
        </v-row>
      </ClientOnly>
    </template>

    <PartyEditDialog :member="editing" @close="editing = null" @updated="party.replaceMember" />
  </v-container>
</template>

<script setup lang="ts">
import type { PartyMember } from '~~/types/party'
import { UNRESOLVED_QUEST_STATUSES, type Quest } from '~~/types/quests'
import {
  LIVE_PANELS,
  defaultLiveLayout,
  liveLayoutKey,
  normalizeLiveLayout,
  type LiveLayout,
  type LivePanel,
} from '~~/types/live'

interface SessionRow {
  id: number
  title: string
  session_number: number | null
  date: string | null
}

const campaignStore = useCampaignStore()
const campaignId = computed(() => campaignStore.activeCampaignIdNumber)

// Fixed regions: who's at the table | what's happening | what to remember
const columns: LivePanel[][] = [
  ['party', 'combat'],
  ['session', 'notes'],
  ['lookup', 'next', 'quests'],
]
const PANEL_ICONS: Record<LivePanel, string> = {
  party: 'mdi-shield-account',
  combat: 'mdi-sword-cross',
  session: 'mdi-script-text-outline',
  notes: 'mdi-notebook-outline',
  lookup: 'mdi-book-search-outline',
  next: 'mdi-calendar-arrow-right',
  quests: 'mdi-script-text',
}

// --- Layout, remembered per campaign ---------------------------------------
const layout = ref<LiveLayout>(defaultLiveLayout())
const panelState = (panel: LivePanel) => layout.value.panels[layout.value.mode][panel]

function loadLayout() {
  if (!campaignId.value) return
  try {
    const raw = localStorage.getItem(liveLayoutKey(campaignId.value))
    layout.value = normalizeLiveLayout(raw ? JSON.parse(raw) : null)
  }
  catch {
    layout.value = defaultLiveLayout()
  }
}

function resetLayout() {
  layout.value = { ...defaultLiveLayout(), mode: layout.value.mode }
}

watch(
  layout,
  (value) => {
    if (!campaignId.value) return
    try {
      localStorage.setItem(liveLayoutKey(campaignId.value), JSON.stringify(value))
    }
    catch {
      // storage unavailable: the layout just isn't remembered
    }
  },
  { deep: true },
)

// --- Party (auto-refresh every minute while this page is open) ---------------
const party = useParty()
const editing = ref<PartyMember | null>(null)
party.onReplace.push((updated) => {
  if (editing.value?.entityId === updated.entityId) editing.value = updated
})

// --- Sessions and quests ------------------------------------------------------
const sessions = ref<SessionRow[]>([])
const sessionId = ref<number | null>(null)
const quests = ref<Quest[]>([])
// Inside v-for a plain template ref would be an array, so keep it by hand
const nextList = ref<{ reload: () => void } | null>(null)
const setNextList = (el: unknown) => {
  nextList.value = (el as { reload: () => void } | null) ?? null
}

const currentSession = computed(() => sessions.value.find(s => s.id === sessionId.value) ?? null)
const sessionItems = computed(() =>
  sessions.value.map(s => ({ value: s.id, title: s.session_number ? `#${s.session_number} ${s.title}` : s.title })),
)
const openQuests = computed(() => quests.value.filter(q => UNRESOLVED_QUEST_STATUSES.includes(q.status)))

// Newest session first: by date, then number
function newestFirst(a: SessionRow, b: SessionRow) {
  return (b.date ?? '').localeCompare(a.date ?? '') || (b.session_number ?? 0) - (a.session_number ?? 0) || b.id - a.id
}

async function loadCampaignData() {
  if (!campaignId.value) return
  const [s, q] = await Promise.all([
    $fetch<SessionRow[]>('/api/sessions', { query: { campaignId: campaignId.value } }).catch(() => []),
    $fetch<Quest[]>('/api/quests', { query: { campaignId: campaignId.value } }).catch(() => []),
  ])
  sessions.value = [...s].sort(newestFirst)
  sessionId.value = sessions.value[0]?.id ?? null
  quests.value = q
}

watch(campaignId, () => {
  loadLayout()
  loadCampaignData()
})

onMounted(async () => {
  loadLayout()
  loadCampaignData()
  await party.loadAndRefresh()
  party.scheduleRefresh(60)
})
</script>

<style scoped>
.live-page {
  max-width: 1600px;
}
</style>
