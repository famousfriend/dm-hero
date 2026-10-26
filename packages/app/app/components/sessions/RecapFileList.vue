<template>
  <div v-if="files.length" class="d-flex flex-wrap ga-2">
    <v-chip
      v-for="file in files"
      :key="file.id"
      variant="tonal"
      color="primary"
      :prepend-icon="fileIcon(file.fileName)"
      :closable="deletable"
      :title="$t('recaps.openFile', { name: file.fileName })"
      class="recap-file-chip"
      @click="openFile(file)"
      @click:close="emit('delete', file)"
    >
      <span class="text-truncate">{{ file.fileName }}</span>
      <span class="text-medium-emphasis ml-2 flex-shrink-0">{{ formatSize(file.sizeBytes) }}</span>
    </v-chip>
  </div>
</template>

<script setup lang="ts">
import { fileExtension, type RecapFile } from '~~/types/recaps'

withDefaults(defineProps<{ files: RecapFile[], deletable?: boolean }>(), { deletable: false })
const emit = defineEmits<{ delete: [file: RecapFile] }>()

const { openUploadFile } = useElectron()
const snackbar = useSnackbarStore()
const { t } = useI18n()

function fileIcon(name: string) {
  const ext = fileExtension(name)
  if (ext === '.pdf') return 'mdi-file-pdf-box'
  if (['.doc', '.docx', '.odt', '.rtf'].includes(ext)) return 'mdi-file-word-box'
  if (['.png', '.jpg', '.jpeg', '.gif', '.webp'].includes(ext)) return 'mdi-file-image'
  return 'mdi-file-document-outline'
}

function formatSize(bytes: number) {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

async function openFile(file: RecapFile) {
  const result = await openUploadFile(file.storedName)
  if (!result.success) snackbar.error(t('recaps.openFailed', { name: file.fileName }))
}
</script>

<style scoped>
.recap-file-chip {
  max-width: 100%;
}
</style>
