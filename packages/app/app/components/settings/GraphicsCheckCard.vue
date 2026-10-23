<template>
  <!-- Desktop app only: shows whether the window draws with the graphics card -->
  <v-card v-if="available" class="mt-6">
    <v-card-text>
      <h2 class="text-headline-small mb-2">
        {{ $t('settings.graphics.title') }}
      </h2>
      <p class="text-medium-emphasis text-body-medium mb-3">
        {{ $t('settings.graphics.description') }}
      </p>

      <div v-if="info" class="mb-3">
        <div v-for="row in rows" :key="row.label" class="d-flex align-center ga-2 mb-1">
          <v-icon :icon="row.ok ? 'mdi-check-circle' : 'mdi-alert-circle'" :color="row.ok ? 'success' : 'warning'" size="small" />
          <span class="text-body-medium">{{ row.label }}:</span>
          <span class="text-body-medium text-medium-emphasis text-truncate">{{ row.value }}</span>
        </div>
      </div>

      <v-btn variant="tonal" size="small" :prepend-icon="copied ? 'mdi-check' : 'mdi-content-copy'" :disabled="!info" class="mb-3" @click="copy">
        {{ copied ? $t('settings.graphics.copied') : $t('settings.graphics.copy') }}
      </v-btn>

      <v-switch
        :model-value="info?.forceGpu ?? false"
        :label="$t('settings.graphics.forceGpu')"
        :loading="saving"
        :disabled="!info || saving"
        color="primary"
        hide-details
        inset
        density="comfortable"
        @update:model-value="save"
      />
      <p class="text-medium-emphasis text-body-small mt-2 mb-0">
        {{ $t('settings.graphics.restartHint') }}
      </p>

      <v-divider class="my-4" />
      <!-- Records what every part of the app does while it stutters, for Claude to read -->
      <h3 class="text-title-medium mb-1">
        {{ $t('settings.graphics.recordTitle') }}
      </h3>
      <p class="text-medium-emphasis text-body-medium mb-3">
        {{ $t('settings.graphics.recordDescription') }}
      </p>
      <v-btn
        variant="tonal"
        size="small"
        prepend-icon="mdi-record-rec"
        :disabled="!canRecord || recording"
        @click="record"
      >
        {{ recording ? $t('settings.graphics.recording') : $t('settings.graphics.record') }}
      </v-btn>
    </v-card-text>
  </v-card>
</template>

<script setup lang="ts">
import type { GraphicsInfo } from '~/composables/useElectron'

const { t } = useI18n()
const { electronAPI } = useElectron()
const available = computed(() => !!electronAPI?.getGraphicsInfo)
const info = ref<GraphicsInfo | null>(null)
const saving = ref(false)
const copied = ref(false)

onMounted(async () => {
  if (available.value) info.value = await electronAPI!.getGraphicsInfo!()
})

// Chromium reports e.g. 'enabled', 'enabled_on', 'disabled_software', 'unavailable_off'
const isOn = (status?: string) => !!status && status.startsWith('enabled')

const rows = computed(() => {
  const i = info.value
  if (!i) return []
  const software = !i.renderer || /swiftshader|software|basic render/i.test(i.renderer)
  return [
    { label: t('settings.graphics.compositing'), value: i.featureStatus.gpu_compositing ?? '?', ok: isOn(i.featureStatus.gpu_compositing) },
    { label: t('settings.graphics.rasterization'), value: i.featureStatus.rasterization ?? '?', ok: isOn(i.featureStatus.rasterization) },
    { label: t('settings.graphics.card'), value: i.renderer ?? '?', ok: !software },
    { label: t('settings.graphics.refresh'), value: i.windowDisplayHz ? `${i.windowDisplayHz} Hz` : '?', ok: true },
  ]
})

async function copy() {
  try {
    await navigator.clipboard.writeText(JSON.stringify(info.value, null, 2))
    copied.value = true
    setTimeout(() => (copied.value = false), 1500)
  }
  catch {
    // clipboard blocked - nothing else to do
  }
}

const canRecord = computed(() => !!electronAPI?.recordPerformanceTrace)
const recording = ref(false)

// The window keeps recording when this page is left; Explorer opens on the file when done
async function record() {
  recording.value = true
  const result = await electronAPI!.recordPerformanceTrace!()
  setTimeout(() => (recording.value = false), result.seconds * 1000)
}

// Saving restarts the app (Chromium reads these switches only at startup)
async function save(value: boolean | null) {
  saving.value = true
  await electronAPI!.setGraphicsPrefs!({ forceGpu: value === true })
}
</script>
