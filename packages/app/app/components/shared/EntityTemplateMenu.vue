<template>
  <v-menu v-model="open" location="bottom end" :close-on-content-click="false">
    <template #activator="{ props: menuProps }">
      <v-btn variant="tonal" size="large" prepend-icon="mdi-file-document-multiple-outline" v-bind="menuProps">
        {{ $t('templates.fromTemplate') }}
      </v-btn>
    </template>
    <v-card min-width="320" max-width="420">
      <v-list v-if="templates.length" density="compact">
        <v-list-item
          v-for="tpl in templates"
          :key="tpl.id"
          :title="tpl.name"
          :subtitle="tpl.isDefault ? $t('templates.defaultLabel') : undefined"
          :disabled="busy"
          @click="create(tpl)"
        >
          <template #prepend>
            <v-icon>mdi-file-document-outline</v-icon>
          </template>
          <template #append>
            <v-btn
              :icon="tpl.isDefault ? 'mdi-star' : 'mdi-star-outline'"
              :color="tpl.isDefault ? 'warning' : undefined"
              size="small"
              variant="text"
              :title="tpl.isDefault ? $t('templates.unsetDefault') : $t('templates.setDefault')"
              @click.stop="toggleDefault(tpl)"
            />
            <v-btn icon="mdi-delete-outline" size="small" variant="text" :title="$t('common.delete')" @click.stop="remove(tpl)" />
          </template>
        </v-list-item>
      </v-list>
      <v-card-text v-else-if="loaded" class="text-body-medium text-medium-emphasis">
        {{ $t('templates.none') }}
      </v-card-text>
      <v-card-text v-if="templates.length" class="pt-0 text-body-small text-medium-emphasis">
        {{ $t('templates.defaultHint') }}
      </v-card-text>
    </v-card>
  </v-menu>
</template>

<script setup lang="ts">
import type { CopyableEntityType, EntityTemplate } from '~~/types/entity-template'

const props = defineProps<{ entityType: CopyableEntityType }>()

const { t } = useI18n()
const snackbarStore = useSnackbarStore()
const campaignStore = useCampaignStore()
const refreshList = useEntityListRefresh()

const open = ref(false)
const loaded = ref(false)
const busy = ref(false)
const templates = ref<EntityTemplate[]>([])

async function load() {
  try {
    templates.value = await $fetch<EntityTemplate[]>('/api/templates/list', { query: { type: props.entityType } })
  }
  catch (error) {
    console.error('Failed to load templates:', error)
  }
  loaded.value = true
}

// Templates are saved from the cards, so reload whenever the menu opens
watch(open, (isOpen) => {
  if (isOpen) load()
})

async function create(tpl: EntityTemplate) {
  const campaignId = campaignStore.activeCampaignIdNumber
  if (!campaignId || busy.value) return
  busy.value = true
  try {
    await $fetch(`/api/templates/${tpl.id}/create`, { method: 'POST', body: { campaignId } })
    await refreshList(props.entityType)
    open.value = false
    snackbarStore.success(t('templates.created', { name: tpl.name }))
  }
  catch (error) {
    console.error('Failed to create from template:', error)
    snackbarStore.error(t('common.error'))
  }
  finally {
    busy.value = false
  }
}

async function toggleDefault(tpl: EntityTemplate) {
  try {
    await $fetch(`/api/templates/${tpl.id}`, { method: 'PATCH', body: { isDefault: !tpl.isDefault } })
    await load()
  }
  catch (error) {
    console.error('Failed to set default template:', error)
    snackbarStore.error(t('common.error'))
  }
}

async function remove(tpl: EntityTemplate) {
  try {
    await $fetch(`/api/templates/${tpl.id}`, { method: 'DELETE' })
    await load()
    snackbarStore.success(t('templates.deleted', { name: tpl.name }))
  }
  catch (error) {
    console.error('Failed to delete template:', error)
    snackbarStore.error(t('common.error'))
  }
}
</script>
