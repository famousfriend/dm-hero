<template>
  <div>
    <p class="text-body-medium text-medium-emphasis mb-3">{{ $t('recaps.hint') }}</p>

    <SharedEntityMarkdownEditor
      :model-value="modelValue"
      :placeholder="$t('recaps.placeholder')"
      :sessions="sessions"
      height="380px"
      @update:model-value="emit('update:modelValue', $event)"
    />

    <!-- Upload recap notes -->
    <div
      class="recap-drop mt-4 pa-4 text-center"
      :class="{ 'recap-drop--active': dragging }"
      @dragover.prevent="dragging = true"
      @dragleave.prevent="dragging = false"
      @drop.prevent="onDrop"
    >
      <v-icon size="32" color="primary" class="mb-1">mdi-file-upload-outline</v-icon>
      <div class="text-body-medium mb-2">{{ $t('recaps.dropHere') }}</div>
      <v-btn
        color="primary"
        variant="tonal"
        prepend-icon="mdi-paperclip"
        :loading="uploading"
        @click="fileInput?.click()"
      >
        {{ $t('recaps.chooseFiles') }}
      </v-btn>
      <div class="text-body-small text-medium-emphasis mt-2">{{ $t('recaps.fileTypes') }}</div>
      <input
        ref="fileInput"
        type="file"
        multiple
        :accept="RECAP_FILE_EXTENSIONS.join(',')"
        class="d-none"
        @change="onPick"
      />
    </div>

    <div v-if="files.length" class="mt-4">
      <div class="text-title-small mb-2">{{ $t('recaps.attachments') }}</div>
      <SessionsRecapFileList :files="files" deletable @delete="deletingFile = $event" />
    </div>

    <UiDeleteConfirmDialog
      :model-value="!!deletingFile"
      :title="$t('recaps.deleteFileTitle')"
      :message="$t('recaps.deleteFileConfirm', { name: deletingFile?.fileName })"
      :loading="deleting"
      @confirm="confirmDelete"
      @cancel="deletingFile = null"
    />
  </div>
</template>

<script setup lang="ts">
import { RECAP_FILE_EXTENSIONS, type RecapFile, type SessionRecap } from '~~/types/recaps'

// Write a session's recap and attach recap notes. Text files go into the text
// (saved with the rest of the form); other files are uploaded right away.
const props = withDefaults(defineProps<{
  modelValue: string
  sessionId: number
  sessions?: Array<{ id: number, title: string, session_number?: number | null }>
}>(), { sessions: () => [] })

const emit = defineEmits<{
  'update:modelValue': [value: string]
  'files-changed': []
}>()

const { t } = useI18n()
const snackbar = useSnackbarStore()
const { uploadRecapFiles } = useRecapUpload()

const files = ref<RecapFile[]>([])
const fileInput = ref<HTMLInputElement | null>(null)
const dragging = ref(false)
const uploading = ref(false)
const deletingFile = ref<RecapFile | null>(null)
const deleting = ref(false)

async function loadFiles() {
  try {
    files.value = (await $fetch<SessionRecap>(`/api/quests/recaps/${props.sessionId}`)).files
  }
  catch (error) {
    console.error('Failed to load recap files:', error)
  }
}
watch(() => props.sessionId, loadFiles, { immediate: true })

async function handleFiles(list: FileList | null | undefined) {
  // Copy now: the input is cleared right after this call starts
  const picked = Array.from(list ?? [])
  if (!picked.length) return
  uploading.value = true
  try {
    const result = await uploadRecapFiles(props.sessionId, picked, props.modelValue)
    if (result.recap !== props.modelValue) emit('update:modelValue', result.recap)
    if (result.uploaded) {
      await loadFiles()
      emit('files-changed')
    }
  }
  finally {
    uploading.value = false
  }
}

function onDrop(event: DragEvent) {
  dragging.value = false
  handleFiles(event.dataTransfer?.files)
}

function onPick(event: Event) {
  const input = event.target as HTMLInputElement
  handleFiles(input.files)
  input.value = ''
}

async function confirmDelete() {
  if (!deletingFile.value) return
  deleting.value = true
  try {
    await $fetch(`/api/quests/recaps/files/${deletingFile.value.id}`, { method: 'DELETE' })
    deletingFile.value = null
    await loadFiles()
    emit('files-changed')
  }
  catch (error) {
    console.error('Failed to delete recap file:', error)
    snackbar.error(t('recaps.deleteFailed'))
  }
  finally {
    deleting.value = false
  }
}
</script>

<style scoped>
.recap-drop {
  border: 2px dashed rgba(var(--v-theme-on-surface), 0.25);
  border-radius: 8px;
  transition: border-color 0.15s, background-color 0.15s;
}
.recap-drop--active {
  border-color: rgb(var(--v-theme-primary));
  background-color: rgba(var(--v-theme-primary), 0.08);
}
</style>
