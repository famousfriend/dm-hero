<template>
  <v-menu location="bottom end">
    <template #activator="{ props: menuProps }">
      <v-btn icon :size="size" variant="text" :loading="busy" v-bind="menuProps" @click.stop>
        <v-icon>mdi-content-copy</v-icon>
        <v-tooltip activator="parent" location="bottom">
          {{ $t('duplicate.menu') }}
        </v-tooltip>
      </v-btn>
    </template>
    <v-list density="compact">
      <v-list-item prepend-icon="mdi-content-copy" :title="$t('duplicate.action')" @click="duplicate" />
      <v-list-item prepend-icon="mdi-file-document-plus-outline" :title="$t('templates.saveAs')" @click="openSave" />
    </v-list>
  </v-menu>

  <!-- Save as template: just a name -->
  <v-dialog v-model="showSave" max-width="420">
    <v-card>
      <v-card-title>{{ $t('templates.saveAs') }}</v-card-title>
      <v-card-text>
        <p class="text-body-medium mb-3">{{ $t('templates.saveHint') }}</p>
        <v-text-field
          v-model="templateName"
          :label="$t('templates.name')"
          variant="outlined"
          density="compact"
          autofocus
          hide-details
          @keydown.enter="saveTemplate"
        />
      </v-card-text>
      <v-card-actions>
        <v-spacer />
        <v-btn variant="text" @click="showSave = false">{{ $t('common.cancel') }}</v-btn>
        <v-btn color="primary" variant="flat" :disabled="!templateName.trim()" :loading="busy" @click="saveTemplate">
          {{ $t('common.save') }}
        </v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>

<script setup lang="ts">
import type { CopyableEntityType } from '~~/types/entity-template'

const props = withDefaults(defineProps<{
  entityId: number
  entityType: CopyableEntityType
  name: string
  size?: string
}>(), { size: 'small' })

const emit = defineEmits<{ duplicated: [id: number] }>()

const { t } = useI18n()
const snackbarStore = useSnackbarStore()
const refreshList = useEntityListRefresh()
const busy = ref(false)
const showSave = ref(false)
const templateName = ref('')

async function duplicate() {
  if (busy.value) return
  busy.value = true
  const name = t('duplicate.copyName', { name: props.name })
  try {
    const { id } = await $fetch<{ id: number }>(`/api/templates/duplicate/${props.entityId}`, { method: 'POST', body: { name } })
    await refreshList(props.entityType)
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

function openSave() {
  templateName.value = props.name
  showSave.value = true
}

async function saveTemplate() {
  const name = templateName.value.trim()
  if (!name || busy.value) return
  busy.value = true
  try {
    await $fetch('/api/templates/save', { method: 'POST', body: { entityId: props.entityId, name } })
    showSave.value = false
    snackbarStore.success(t('templates.saved', { name }))
  }
  catch (error) {
    console.error('Failed to save template:', error)
    snackbarStore.error(t('common.error'))
  }
  finally {
    busy.value = false
  }
}
</script>
