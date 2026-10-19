<template>
  <v-dialog :model-value="modelValue" max-width="640" @update:model-value="emit('update:modelValue', $event)">
    <v-card>
      <v-card-title>{{ quest ? $t('quests.edit') : $t('quests.create') }}</v-card-title>
      <v-card-text>
        <v-row dense>
          <v-col cols="12" sm="8">
            <v-text-field v-model="form.name" :label="$t('quests.name')" density="compact" variant="outlined" autofocus />
          </v-col>
          <v-col cols="12" sm="4">
            <v-select v-model="form.status" :items="statusItems" :label="$t('quests.status')" density="compact" variant="outlined" />
          </v-col>
          <v-col cols="12">
            <v-textarea v-model="form.description" :label="$t('quests.description')" rows="3" auto-grow density="compact" variant="outlined" />
          </v-col>
          <v-col cols="12" sm="6">
            <v-autocomplete
              v-model="form.giverId"
              :items="giverItems"
              item-title="name"
              item-value="id"
              :label="$t('quests.giver')"
              clearable
              density="compact"
              variant="outlined"
            >
              <template #item="{ props: itemProps, internalItem }">
                <v-list-item v-bind="itemProps" :prepend-icon="typeIcon(internalItem.raw.type)" :subtitle="typeLabel(internalItem.raw.type)" />
              </template>
            </v-autocomplete>
          </v-col>
          <v-col cols="12" sm="6">
            <v-text-field v-model="form.reward" :label="$t('quests.reward')" density="compact" variant="outlined" />
          </v-col>
          <v-col cols="12">
            <v-autocomplete
              v-model="form.involvedIds"
              :items="involvedItems"
              item-title="name"
              item-value="id"
              :label="$t('quests.involved')"
              :hint="$t('quests.involvedHint')"
              persistent-hint
              multiple
              chips
              closable-chips
              density="compact"
              variant="outlined"
            >
              <template #item="{ props: itemProps, internalItem }">
                <v-list-item v-bind="itemProps" :prepend-icon="typeIcon(internalItem.raw.type)" :subtitle="typeLabel(internalItem.raw.type)" />
              </template>
            </v-autocomplete>
          </v-col>
        </v-row>
        <v-alert v-if="error" type="error" variant="tonal" density="compact" class="mt-2">{{ error }}</v-alert>
      </v-card-text>
      <v-card-actions>
        <v-btn v-if="quest" color="error" variant="text" prepend-icon="mdi-delete-outline" @click="confirmDelete = true">
          {{ $t('common.delete') }}
        </v-btn>
        <v-spacer />
        <v-btn variant="text" @click="emit('update:modelValue', false)">{{ $t('common.cancel') }}</v-btn>
        <v-btn color="primary" variant="flat" :loading="saving" :disabled="!form.name.trim()" @click="save">
          {{ quest ? $t('common.save') : $t('common.create') }}
        </v-btn>
      </v-card-actions>
    </v-card>
    <UiDeleteConfirmDialog
      v-model="confirmDelete"
      :title="$t('quests.deleteTitle')"
      :message="$t('quests.deleteConfirm', { name: quest?.name })"
      @confirm="remove"
      @cancel="confirmDelete = false"
    />
  </v-dialog>
</template>

<script setup lang="ts">
import { QUEST_STATUSES, type Quest, type QuestStatus } from '~~/types/quests'

const props = defineProps<{
  modelValue: boolean
  /** Quest to edit; null creates a new one */
  quest: Quest | null
}>()

const emit = defineEmits<{
  'update:modelValue': [value: boolean]
  'saved': [quest: Quest]
  'deleted': [id: number]
}>()

const { t } = useI18n()
const campaignStore = useCampaignStore()
const { entities, load, typeIcon, typeLabel } = useLinkableEntities()

const saving = ref(false)
const confirmDelete = ref(false)
const error = ref('')
const form = reactive({
  name: '',
  description: '',
  status: 'open' as QuestStatus,
  reward: '',
  giverId: null as number | null,
  involvedIds: [] as number[],
})

const statusItems = computed(() => QUEST_STATUSES.map(status => ({ value: status, title: t(`quests.statuses.${status}`) })))
// Givers are people or groups; a quest can't involve itself
const giverItems = computed(() => entities.value.filter(e => ['NPC', 'Faction', 'Player'].includes(e.type)))
const involvedItems = computed(() => entities.value.filter(e => e.id !== props.quest?.id))

watch(
  () => props.modelValue,
  (open) => {
    if (!open) return
    error.value = ''
    const q = props.quest
    Object.assign(form, {
      name: q?.name ?? '',
      description: q?.description ?? '',
      status: q?.status ?? 'open',
      reward: q?.reward ?? '',
      giverId: q?.giver?.id ?? null,
      involvedIds: q?.involved.map(e => e.id) ?? [],
    })
    load()
  },
  { immediate: true },
)

async function save() {
  const campaignId = campaignStore.activeCampaignIdNumber
  if (!campaignId || !form.name.trim()) return
  saving.value = true
  error.value = ''
  try {
    const saved = props.quest
      ? await $fetch<Quest>(`/api/quests/${props.quest.id}`, { method: 'PATCH', body: { ...form } })
      : await $fetch<Quest>('/api/quests', { method: 'POST', body: { ...form, campaignId } })
    emit('saved', saved)
    emit('update:modelValue', false)
  }
  catch {
    error.value = t('quests.saveFailed')
  }
  finally {
    saving.value = false
  }
}

async function remove() {
  confirmDelete.value = false
  if (!props.quest) return
  try {
    await $fetch(`/api/quests/${props.quest.id}`, { method: 'DELETE' })
    emit('deleted', props.quest.id)
    emit('update:modelValue', false)
  }
  catch {
    error.value = t('quests.saveFailed')
  }
}
</script>
