<template>
  <v-btn
    icon="mdi-content-copy"
    :size="size"
    variant="text"
    :loading="busy"
    @click.stop="duplicate"
  >
    <v-icon>mdi-content-copy</v-icon>
    <v-tooltip activator="parent" location="bottom">
      {{ $t('duplicate.action') }}
    </v-tooltip>
  </v-btn>
</template>

<script setup lang="ts">
type DuplicableType = 'npc' | 'item' | 'faction' | 'lore' | 'location'

const props = withDefaults(defineProps<{
  entityId: number
  entityType: DuplicableType
  name: string
  size?: string
}>(), { size: 'small' })

const emit = defineEmits<{ duplicated: [id: number] }>()

const { t } = useI18n()
const entitiesStore = useEntitiesStore()
const campaignStore = useCampaignStore()
const snackbarStore = useSnackbarStore()
const busy = ref(false)

// Reloads the list the copy shows up in
const REFRESH: Record<DuplicableType, (campaignId: number) => Promise<unknown>> = {
  npc: id => entitiesStore.fetchNPCs(id, true),
  item: id => entitiesStore.fetchItems(id, true),
  faction: id => entitiesStore.fetchFactions(id, true),
  lore: id => entitiesStore.fetchLore(id, true),
  location: id => entitiesStore.fetchLocations(id, true),
}

async function duplicate() {
  const campaignId = campaignStore.activeCampaignIdNumber
  if (busy.value || !campaignId) return
  busy.value = true
  const name = t('duplicate.copyName', { name: props.name })
  try {
    const { id } = await $fetch<{ id: number }>(`/api/entities/${props.entityId}/duplicate`, { method: 'POST', body: { name } })
    await REFRESH[props.entityType](campaignId)
    snackbarStore.success(t('duplicate.done', { name }))
    emit('duplicated', id)
  }
  catch (error) {
    console.error('Failed to duplicate:', error)
    snackbarStore.error(t('common.error'))
  }
  finally {
    busy.value = false
  }
}
</script>
