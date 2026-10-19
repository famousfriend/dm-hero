<template>
  <div class="continuity-list">
    <!-- Add form -->
    <v-card v-if="!readonly" variant="outlined" class="pa-3 mb-4">
      <div class="d-flex flex-wrap ga-2 align-start">
        <v-select
          v-model="draft.kind"
          :items="kindItems"
          :label="$t('continuity.kind')"
          density="compact"
          variant="outlined"
          hide-details
          class="kind-select"
        />
        <v-text-field
          v-model="draft.text"
          :label="$t('continuity.whatHappened')"
          :placeholder="$t('continuity.textPlaceholder')"
          density="compact"
          variant="outlined"
          hide-details
          class="flex-grow-1 text-field"
          @keydown.enter="add"
        />
      </div>
      <div class="d-flex flex-wrap ga-2 align-center mt-2">
        <v-autocomplete
          v-model="draft.entityIds"
          :items="entities"
          item-title="name"
          item-value="id"
          :label="$t('continuity.involves')"
          multiple
          chips
          closable-chips
          density="compact"
          variant="outlined"
          hide-details
          class="flex-grow-1 text-field"
        >
          <template #item="{ props: itemProps, internalItem }">
            <v-list-item v-bind="itemProps" :prepend-icon="typeIcon(internalItem.raw.type)" :subtitle="typeLabel(internalItem.raw.type)" />
          </template>
        </v-autocomplete>
        <v-checkbox v-model="draft.nextSession" :label="$t('continuity.bringUpNext')" density="compact" hide-details />
        <v-btn color="primary" variant="flat" :disabled="!draft.text.trim()" :loading="saving" @click="add">
          {{ $t('common.add') }}
        </v-btn>
      </div>
    </v-card>

    <v-progress-linear v-if="loading && !items.length" indeterminate />
    <div v-else-if="!visibleItems.length" class="text-body-medium text-medium-emphasis py-4">
      {{ emptyText || $t('continuity.empty') }}
    </div>

    <v-list v-else density="compact" class="py-0">
      <v-list-item v-for="item in visibleItems" :key="item.id" class="px-1 continuity-item">
        <template #prepend>
          <v-checkbox-btn
            :model-value="item.status === 'resolved'"
            :title="$t(item.status === 'resolved' ? 'continuity.reopen' : 'continuity.resolve')"
            @update:model-value="setStatus(item, $event ? 'resolved' : 'open')"
          />
        </template>
        <div class="d-flex flex-wrap align-center ga-1">
          <v-chip size="x-small" :color="kindColor(item.kind)" variant="tonal" :prepend-icon="kindIcon(item.kind)">
            {{ $t(`continuity.kinds.${item.kind}`) }}
          </v-chip>
          <span :class="{ 'text-decoration-line-through text-medium-emphasis': item.status === 'resolved' }">{{ item.text }}</span>
          <v-icon
            v-if="item.nextSession"
            size="small"
            color="warning"
            :title="$t('continuity.bringUpNext')"
          >
            mdi-calendar-arrow-right
          </v-icon>
        </div>
        <div class="d-flex flex-wrap align-center ga-1 mt-1">
          <v-chip
            v-for="entity in item.entities"
            :key="entity.id"
            size="x-small"
            variant="outlined"
            :prepend-icon="typeIcon(entity.type)"
          >
            {{ entity.name }}
          </v-chip>
          <span v-if="showSession && item.sessionTitle" class="text-caption text-medium-emphasis">
            {{ $t('continuity.fromSession', { title: item.sessionTitle }) }}
          </span>
        </div>
        <template v-if="!readonly" #append>
          <v-btn
            :icon="item.nextSession ? 'mdi-calendar-remove' : 'mdi-calendar-arrow-right'"
            size="small"
            variant="text"
            :title="$t(item.nextSession ? 'continuity.notNext' : 'continuity.bringUpNext')"
            @click="patch(item, { nextSession: !item.nextSession })"
          />
          <v-btn icon="mdi-delete-outline" size="small" variant="text" :title="$t('common.delete')" @click="remove(item)" />
        </template>
      </v-list-item>
    </v-list>
  </div>
</template>

<script setup lang="ts">
import { CONTINUITY_KINDS, type ContinuityInput, type ContinuityItem, type ContinuityKind } from '~~/types/quests'

const props = defineProps<{
  /** Items recorded in this session (and new items go there) */
  sessionId?: number
  /** Only open items, e.g. "for next session" */
  openOnly?: boolean
  /** Only items flagged to bring up next session */
  nextOnly?: boolean
  readonly?: boolean
  showSession?: boolean
  emptyText?: string
}>()

/** Fired after the user adds, edits or removes an item (not on load) */
const emit = defineEmits<{ changed: [items: ContinuityItem[]] }>()

const { t } = useI18n()
const campaignStore = useCampaignStore()
const snackbar = useSnackbarStore()
const { entities, load: loadEntities, typeIcon, typeLabel } = useLinkableEntities()

const items = ref<ContinuityItem[]>([])
const loading = ref(false)
const saving = ref(false)
const draft = reactive({ kind: 'decision' as ContinuityKind, text: '', entityIds: [] as number[], nextSession: false })

const kindItems = computed(() => CONTINUITY_KINDS.map(kind => ({ value: kind, title: t(`continuity.kinds.${kind}`) })))

const KIND_STYLE: Record<ContinuityKind, { icon: string, color: string }> = {
  decision: { icon: 'mdi-sign-direction', color: 'primary' },
  reveal: { icon: 'mdi-eye-outline', color: 'info' },
  promise: { icon: 'mdi-handshake-outline', color: 'success' },
  debt: { icon: 'mdi-scale-unbalanced', color: 'warning' },
  consequence: { icon: 'mdi-alert-decagram-outline', color: 'error' },
  thread: { icon: 'mdi-source-branch', color: undefined as unknown as string },
}
const kindIcon = (kind: ContinuityKind) => KIND_STYLE[kind].icon
const kindColor = (kind: ContinuityKind) => KIND_STYLE[kind].color

// Resolved items stay visible (struck through) until the list reloads
const visibleItems = computed(() => (props.nextOnly ? items.value.filter(i => i.nextSession || i.status === 'resolved') : items.value))

async function load() {
  const campaignId = campaignStore.activeCampaignIdNumber
  if (!campaignId) return
  loading.value = true
  try {
    items.value = await $fetch<ContinuityItem[]>('/api/quests/continuity', {
      query: { campaignId, sessionId: props.sessionId, status: props.openOnly ? 'open' : undefined },
    })
    if (props.nextOnly) items.value = items.value.filter(i => i.nextSession)
  }
  catch {
    items.value = []
  }
  finally {
    loading.value = false
  }
}

async function add() {
  const campaignId = campaignStore.activeCampaignIdNumber
  if (!campaignId || !draft.text.trim() || saving.value) return
  saving.value = true
  try {
    const item = await $fetch<ContinuityItem>('/api/quests/continuity', {
      method: 'POST',
      body: { campaignId, sessionId: props.sessionId, ...draft },
    })
    items.value = [item, ...items.value]
    Object.assign(draft, { text: '', entityIds: [], nextSession: false })
    emit('changed', items.value)
  }
  catch {
    snackbar.error(t('continuity.saveFailed'))
  }
  finally {
    saving.value = false
  }
}

async function patch(item: ContinuityItem, body: ContinuityInput) {
  try {
    const updated = await $fetch<ContinuityItem>(`/api/quests/continuity/${item.id}`, { method: 'PATCH', body })
    items.value = items.value.map(i => (i.id === updated.id ? updated : i))
    emit('changed', items.value)
  }
  catch {
    snackbar.error(t('continuity.saveFailed'))
  }
}

const setStatus = (item: ContinuityItem, status: 'open' | 'resolved') => patch(item, { status })

async function remove(item: ContinuityItem) {
  try {
    await $fetch(`/api/quests/continuity/${item.id}`, { method: 'DELETE' })
    items.value = items.value.filter(i => i.id !== item.id)
    emit('changed', items.value)
  }
  catch {
    snackbar.error(t('continuity.saveFailed'))
  }
}

watch(() => [props.sessionId, campaignStore.activeCampaignIdNumber], load, { immediate: true })
onMounted(() => {
  if (!props.readonly) loadEntities()
})

defineExpose({ reload: load })
</script>

<style scoped>
.kind-select {
  max-width: 180px;
}

.text-field {
  min-width: 240px;
}

.continuity-item :deep(.v-list-item__content) {
  overflow: visible;
}
</style>
