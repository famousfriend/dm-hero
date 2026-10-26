<template>
  <v-container>
    <UiPageHeader :title="$t('recaps.title')" :subtitle="$t('recaps.subtitle')" />

    <!-- Upload recap notes -->
    <v-card variant="outlined" class="mb-6">
      <v-card-title class="d-flex align-center">
        <v-icon icon="mdi-file-upload-outline" class="mr-2" color="primary" />
        {{ $t('recaps.uploadTitle') }}
      </v-card-title>
      <v-card-text>
        <p class="text-body-medium text-medium-emphasis mb-4">{{ $t('recaps.uploadHint') }}</p>
        <v-row dense>
          <v-col cols="12" md="5">
            <v-select
              v-model="uploadTarget"
              :items="sessionOptions"
              :label="$t('recaps.forSession')"
              variant="outlined"
              density="comfortable"
            />
          </v-col>
          <v-col v-if="uploadTarget === NEW_SESSION" cols="12" md="4">
            <v-text-field
              v-model="newSessionTitle"
              :label="$t('recaps.newSessionTitle')"
              variant="outlined"
              density="comfortable"
            />
          </v-col>
          <v-col cols="12" :md="uploadTarget === NEW_SESSION ? 3 : 7">
            <div
              class="recap-drop d-flex align-center justify-center ga-3 pa-3"
              :class="{ 'recap-drop--active': dragging }"
              @dragover.prevent="dragging = true"
              @dragleave.prevent="dragging = false"
              @drop.prevent="onDrop"
            >
              <span class="text-body-medium text-medium-emphasis d-none d-sm-inline">{{ $t('recaps.dropShort') }}</span>
              <v-btn
                color="primary"
                prepend-icon="mdi-paperclip"
                :loading="uploading"
                :disabled="!canUpload"
                @click="fileInput?.click()"
              >
                {{ $t('recaps.chooseFiles') }}
              </v-btn>
            </div>
            <input
              ref="fileInput"
              type="file"
              multiple
              :accept="RECAP_FILE_EXTENSIONS.join(',')"
              class="d-none"
              @change="onPick"
            />
          </v-col>
        </v-row>
        <div class="text-body-small text-medium-emphasis">{{ $t('recaps.fileTypes') }}</div>
      </v-card-text>
    </v-card>

    <!-- The story so far -->
    <div class="d-flex align-center flex-wrap ga-2 mb-3">
      <div class="text-title-large flex-grow-1">
        <v-icon icon="mdi-book-open-page-variant" class="mr-1" />
        {{ $t('recaps.storySoFar') }}
      </div>
      <v-switch
        v-model="showEmpty"
        :label="$t('recaps.showEmpty')"
        color="primary"
        density="compact"
        hide-details
        class="flex-grow-0 mr-2"
      />
      <v-btn-toggle v-model="order" density="compact" variant="outlined" mandatory divided>
        <v-btn value="newest">{{ $t('recaps.newestFirst') }}</v-btn>
        <v-btn value="oldest">{{ $t('recaps.oldestFirst') }}</v-btn>
      </v-btn-toggle>
    </div>

    <v-progress-linear v-if="loading && !recaps.length" indeterminate />
    <v-alert v-else-if="!recaps.length" type="info" variant="tonal">
      {{ $t('recaps.noSessions') }}
    </v-alert>
    <v-alert v-else-if="!shownRecaps.length" type="info" variant="tonal">
      {{ $t('recaps.noneYet') }}
    </v-alert>

    <v-card v-for="item in shownRecaps" :key="item.sessionId" class="mb-4">
      <div class="d-flex align-center ga-2 px-4 pt-4">
        <v-icon icon="mdi-text-box-check-outline" color="primary" />
        <span v-if="item.sessionNumber" class="text-title-large text-medium-emphasis">#{{ item.sessionNumber }}</span>
        <span class="text-title-large text-truncate">{{ item.title }}</span>
        <v-spacer />
        <span v-if="item.date" class="text-body-small text-medium-emphasis flex-shrink-0">{{ formatDate(item.date) }}</span>
        <v-btn
          size="small"
          variant="tonal"
          :prepend-icon="hasRecap(item) ? 'mdi-pencil' : 'mdi-plus'"
          class="flex-shrink-0"
          @click="openEditor(item)"
        >
          {{ hasRecap(item) ? $t('common.edit') : $t('recaps.addRecap') }}
        </v-btn>
      </div>
      <v-card-text>
        <SessionsRecapView :recap="item.recap" :files="item.files" :editor-id="`recap-${item.sessionId}`" />
      </v-card-text>
    </v-card>

    <!-- Edit one recap -->
    <v-dialog v-model="editorOpen" max-width="1000" scrollable persistent>
      <v-card v-if="editing">
        <v-card-title class="d-flex align-center ga-2">
          <v-icon icon="mdi-text-box-check-outline" color="primary" />
          <span v-if="editing.sessionNumber" class="text-medium-emphasis">#{{ editing.sessionNumber }}</span>
          <span class="text-truncate">{{ editing.title }}</span>
        </v-card-title>
        <v-card-text style="max-height: 75vh; overflow-y: auto">
          <SessionsRecapEditor
            v-model="editingText"
            :session-id="editing.sessionId"
            :sessions="sessionsForEditor"
            @files-changed="load"
          />
        </v-card-text>
        <v-card-actions>
          <v-spacer />
          <v-btn variant="text" :disabled="saving" @click="editorOpen = false">{{ $t('common.cancel') }}</v-btn>
          <v-btn color="primary" :loading="saving" @click="saveEditor">{{ $t('common.save') }}</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>
  </v-container>
</template>

<script setup lang="ts">
import { RECAP_FILE_EXTENSIONS, type SessionRecap } from '~~/types/recaps'

const NEW_SESSION = 0

const { t, locale } = useI18n()
const campaignStore = useCampaignStore()
const snackbar = useSnackbarStore()
const { uploadRecapFiles } = useRecapUpload()

const recaps = ref<SessionRecap[]>([])
const loading = ref(false)
const order = ref<'newest' | 'oldest'>('newest')
const showEmpty = ref(false)

const uploadTarget = ref<number>(NEW_SESSION)
const newSessionTitle = ref('')
const fileInput = ref<HTMLInputElement | null>(null)
const dragging = ref(false)
const uploading = ref(false)

const editorOpen = ref(false)
const editing = ref<SessionRecap | null>(null)
const editingText = ref('')
const saving = ref(false)

const hasRecap = (item: SessionRecap) => !!item.recap || item.files.length > 0

const shownRecaps = computed(() => {
  const list = showEmpty.value ? recaps.value : recaps.value.filter(hasRecap)
  return order.value === 'newest' ? list : [...list].reverse()
})

const sessionLabel = (item: SessionRecap) => (item.sessionNumber ? `#${item.sessionNumber} ${item.title}` : item.title)

const sessionOptions = computed(() => [
  ...recaps.value.map(item => ({ title: sessionLabel(item), value: item.sessionId })),
  { title: t('recaps.newSession'), value: NEW_SESSION },
])

const sessionsForEditor = computed(() =>
  recaps.value.map(item => ({ id: item.sessionId, title: item.title, session_number: item.sessionNumber })))

const canUpload = computed(() => uploadTarget.value !== NEW_SESSION || !!newSessionTitle.value.trim())

function formatDate(date: string) {
  const parsed = new Date(date)
  return Number.isNaN(parsed.getTime()) ? date : parsed.toLocaleDateString(locale.value)
}

async function load() {
  const campaignId = campaignStore.activeCampaignIdNumber
  if (!campaignId) return
  loading.value = true
  try {
    recaps.value = await $fetch<SessionRecap[]>('/api/quests/recaps', { query: { campaignId } })
    // Default the upload to the latest session
    if (uploadTarget.value === NEW_SESSION || !recaps.value.some(r => r.sessionId === uploadTarget.value)) {
      uploadTarget.value = recaps.value[0]?.sessionId ?? NEW_SESSION
    }
  }
  catch (error) {
    console.error('Failed to load recaps:', error)
  }
  finally {
    loading.value = false
  }
}

async function createSession(): Promise<number> {
  const highest = Math.max(0, ...recaps.value.map(r => r.sessionNumber ?? 0))
  const session = await $fetch<{ id: number }>('/api/sessions', {
    method: 'POST',
    body: {
      campaignId: campaignStore.activeCampaignIdNumber,
      title: newSessionTitle.value.trim(),
      session_number: highest + 1,
      date: new Date().toISOString().slice(0, 10),
    },
  })
  return session.id
}

async function handleFiles(list: FileList | null | undefined) {
  // Copy now: the input is cleared right after this call starts
  const picked = Array.from(list ?? [])
  if (!picked.length || !canUpload.value) return
  uploading.value = true
  try {
    const sessionId = uploadTarget.value === NEW_SESSION ? await createSession() : uploadTarget.value
    const current = recaps.value.find(r => r.sessionId === sessionId)?.recap ?? ''
    const result = await uploadRecapFiles(sessionId, picked, current)
    if (result.recap !== current) {
      await $fetch(`/api/quests/recaps/${sessionId}`, { method: 'PATCH', body: { recap: result.recap } })
    }
    newSessionTitle.value = ''
    uploadTarget.value = sessionId
    await load()
  }
  catch (error) {
    console.error('Recap upload failed:', error)
    snackbar.error(t('recaps.saveFailed'))
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

function openEditor(item: SessionRecap) {
  editing.value = item
  editingText.value = item.recap ?? ''
  editorOpen.value = true
}

async function saveEditor() {
  if (!editing.value) return
  saving.value = true
  try {
    await $fetch(`/api/quests/recaps/${editing.value.sessionId}`, { method: 'PATCH', body: { recap: editingText.value } })
    editorOpen.value = false
    snackbar.success(t('recaps.saved'))
    await load()
  }
  catch (error) {
    console.error('Failed to save recap:', error)
    snackbar.error(t('recaps.saveFailed'))
  }
  finally {
    saving.value = false
  }
}

watch(() => campaignStore.activeCampaignIdNumber, load, { immediate: true })
</script>

<style scoped>
.recap-drop {
  min-height: 48px;
  border: 2px dashed rgba(var(--v-theme-on-surface), 0.25);
  border-radius: 8px;
  transition: border-color 0.15s, background-color 0.15s;
}
.recap-drop--active {
  border-color: rgb(var(--v-theme-primary));
  background-color: rgba(var(--v-theme-primary), 0.08);
}
</style>
