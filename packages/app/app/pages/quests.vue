<template>
  <v-container>
    <UiPageHeader :title="$t('quests.title')" :subtitle="$t('quests.subtitle')">
      <template #actions>
        <v-btn color="primary" prepend-icon="mdi-plus" size="large" @click="openQuest(null)">
          {{ $t('quests.create') }}
        </v-btn>
      </template>
    </UiPageHeader>

    <v-row>
      <!-- Quests -->
      <v-col cols="12" lg="7">
        <div class="d-flex align-center flex-wrap ga-2 mb-3">
          <div class="text-title-large flex-grow-1">
            <v-icon icon="mdi-script-text" class="mr-1" />
            {{ $t('quests.questsHeading') }}
          </div>
          <v-btn-toggle v-model="filter" density="compact" variant="outlined" mandatory divided>
            <v-btn value="unresolved">{{ $t('quests.filterUnresolved') }}</v-btn>
            <v-btn value="done">{{ $t('quests.filterResolved') }}</v-btn>
            <v-btn value="all">{{ $t('quests.filterAll') }}</v-btn>
          </v-btn-toggle>
        </div>

        <v-progress-linear v-if="loading && !quests.length" indeterminate />
        <v-alert v-else-if="!filteredQuests.length" type="info" variant="tonal">
          {{ quests.length ? $t('quests.noneInFilter') : $t('quests.empty') }}
        </v-alert>

        <v-card
          v-for="quest in filteredQuests"
          :id="`quest-${quest.id}`"
          :key="quest.id"
          class="mb-3 quest-card"
          :class="{ highlighted: highlightedId === quest.id }"
          hover
          @click="openQuest(quest)"
        >
          <v-card-title class="d-flex align-center ga-2 pb-1">
            <span class="flex-grow-1 text-truncate">{{ quest.name }}</span>
            <v-chip size="small" :color="statusColor(quest.status)" variant="tonal">
              {{ $t(`quests.statuses.${quest.status}`) }}
            </v-chip>
          </v-card-title>
          <v-card-text>
            <div v-if="quest.description" class="text-body-medium mb-2 description">{{ quest.description }}</div>
            <div class="d-flex flex-wrap align-center ga-1">
              <v-chip v-if="quest.giver" size="small" variant="outlined" :prepend-icon="typeIcon(quest.giver.type)">
                {{ $t('quests.givenBy', { name: quest.giver.name }) }}
              </v-chip>
              <v-chip v-for="entity in quest.involved" :key="entity.id" size="small" variant="tonal" :prepend-icon="typeIcon(entity.type)">
                {{ entity.name }}
              </v-chip>
              <v-chip v-if="quest.reward" size="small" variant="text" prepend-icon="mdi-treasure-chest">
                {{ quest.reward }}
              </v-chip>
            </div>
          </v-card-text>
        </v-card>
      </v-col>

      <v-col cols="12" lg="5">
        <!-- For next session -->
        <v-card variant="outlined" class="mb-4">
          <v-card-title class="d-flex align-center">
            <v-icon icon="mdi-calendar-arrow-right" color="warning" class="mr-2" />
            {{ $t('quests.nextSession') }}
          </v-card-title>
          <v-card-subtitle class="text-wrap">{{ $t('quests.nextSessionHint') }}</v-card-subtitle>
          <v-card-text>
            <QuestsContinuityList
              ref="nextList"
              readonly
              open-only
              next-only
              show-session
              :empty-text="$t('quests.nextSessionEmpty')"
              @changed="openList?.reload()"
            />
          </v-card-text>
        </v-card>

        <!-- Open threads -->
        <v-card variant="outlined" class="mb-4">
          <v-card-title class="d-flex align-center">
            <v-icon icon="mdi-source-branch" class="mr-2" />
            {{ $t('quests.openThreads') }}
          </v-card-title>
          <v-card-subtitle class="text-wrap">{{ $t('quests.openThreadsHint') }}</v-card-subtitle>
          <v-card-text>
            <QuestsContinuityList
              ref="openList"
              readonly
              open-only
              show-session
              :empty-text="$t('quests.openThreadsEmpty')"
              @changed="nextList?.reload()"
            />
          </v-card-text>
        </v-card>

        <!-- Last met NPCs -->
        <v-card variant="outlined">
          <v-card-title class="d-flex align-center">
            <v-icon icon="mdi-account-clock" class="mr-2" />
            {{ $t('quests.lastMet') }}
          </v-card-title>
          <v-card-subtitle class="text-wrap">{{ $t('quests.lastMetHint') }}</v-card-subtitle>
          <v-card-text>
            <div v-if="!lastMet.length" class="text-body-medium text-medium-emphasis">{{ $t('quests.lastMetEmpty') }}</div>
            <v-list v-else density="compact" class="py-0">
              <v-list-item
                v-for="row in lastMet"
                :key="row.entity.id"
                prepend-icon="mdi-account"
                :title="row.entity.name"
                :subtitle="lastMetLabel(row)"
                :to="`/npcs?highlight=${row.entity.id}`"
              />
            </v-list>
          </v-card-text>
        </v-card>
      </v-col>
    </v-row>

    <QuestsQuestDialog v-model="dialogOpen" :quest="editing" @saved="onSaved" @deleted="onDeleted" />
  </v-container>
</template>

<script setup lang="ts">
import { UNRESOLVED_QUEST_STATUSES, type LastMet, type Quest, type QuestStatus } from '~~/types/quests'

const { t } = useI18n()
const route = useRoute()
const campaignStore = useCampaignStore()
const { typeIcon } = useLinkableEntities()

const quests = ref<Quest[]>([])
const lastMet = ref<LastMet[]>([])
const loading = ref(false)
const filter = ref<'unresolved' | 'done' | 'all'>('unresolved')
const dialogOpen = ref(false)
const editing = ref<Quest | null>(null)
const highlightedId = ref<number | null>(null)
// Resolving an item in one list updates the other
const nextList = ref<{ reload: () => void } | null>(null)
const openList = ref<{ reload: () => void } | null>(null)

const filteredQuests = computed(() => {
  if (filter.value === 'all') return quests.value
  const unresolved = (q: Quest) => UNRESOLVED_QUEST_STATUSES.includes(q.status)
  return quests.value.filter(q => (filter.value === 'unresolved' ? unresolved(q) : !unresolved(q)))
})

const STATUS_COLORS: Record<QuestStatus, string> = { open: 'info', active: 'primary', done: 'success', failed: 'error' }
const statusColor = (status: QuestStatus) => STATUS_COLORS[status]

function lastMetLabel(row: LastMet): string {
  const ago = row.sessionsAgo === 0 ? t('quests.lastSession') : t('quests.sessionsAgo', { count: row.sessionsAgo }, row.sessionsAgo)
  const number = row.sessionNumber ? `#${row.sessionNumber} ` : ''
  return `${number}${row.sessionTitle} · ${ago}`
}

async function load() {
  const campaignId = campaignStore.activeCampaignIdNumber
  if (!campaignId) return
  loading.value = true
  try {
    const [q, met] = await Promise.all([
      $fetch<Quest[]>('/api/quests', { query: { campaignId } }),
      $fetch<LastMet[]>('/api/quests/last-met', { query: { campaignId } }).catch(() => []),
    ])
    quests.value = q
    lastMet.value = met
  }
  finally {
    loading.value = false
  }
  applyHighlight()
}

function applyHighlight() {
  const id = Number(route.query.highlight)
  const quest = id ? quests.value.find(q => q.id === id) : undefined
  if (!quest) return
  highlightedId.value = id
  if (!UNRESOLVED_QUEST_STATUSES.includes(quest.status)) filter.value = 'all'
  openQuest(quest)
}

function openQuest(quest: Quest | null) {
  editing.value = quest
  dialogOpen.value = true
}

function onSaved(quest: Quest) {
  const exists = quests.value.some(q => q.id === quest.id)
  quests.value = exists ? quests.value.map(q => (q.id === quest.id ? quest : q)) : [quest, ...quests.value]
}

function onDeleted(id: number) {
  quests.value = quests.value.filter(q => q.id !== id)
}

watch(() => campaignStore.activeCampaignIdNumber, load, { immediate: true })
watch(() => route.query.highlight, applyHighlight)
</script>

<style scoped>
.description {
  white-space: pre-line;
  display: -webkit-box;
  -webkit-line-clamp: 3;
  line-clamp: 3;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.quest-card.highlighted {
  outline: 2px solid rgb(var(--v-theme-primary));
}
</style>
