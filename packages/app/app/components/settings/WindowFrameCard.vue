<template>
  <!-- Desktop app on Windows only: standard title bar instead of the app's own -->
  <v-card v-if="available" class="mt-6">
    <v-card-text>
      <h2 class="text-headline-small mb-2">
        {{ $t('settings.window.title') }}
      </h2>
      <p class="text-medium-emphasis text-body-medium mb-2">
        {{ $t('settings.window.description') }}
      </p>
      <v-switch
        :model-value="nativeFrame"
        :label="$t('settings.window.nativeFrame')"
        :loading="saving"
        :disabled="saving"
        color="primary"
        hide-details
        inset
        density="comfortable"
        @update:model-value="save"
      />
      <p class="text-medium-emphasis text-body-small mt-2 mb-0">
        {{ $t('settings.window.restartHint') }}
      </p>
    </v-card-text>
  </v-card>
</template>

<script setup lang="ts">
const { electronAPI } = useElectron()
const available = computed(() => electronAPI?.platform === 'win32' && !!electronAPI.setWindowPrefs)
const nativeFrame = ref(false)
const saving = ref(false)

onMounted(async () => {
  if (available.value) nativeFrame.value = (await electronAPI!.getWindowPrefs!()).nativeFrame === true
})

// Saving restarts the app (the title bar can't change on an open window)
async function save(value: boolean | null) {
  nativeFrame.value = value === true
  saving.value = true
  await electronAPI!.setWindowPrefs!({ nativeFrame: nativeFrame.value })
}
</script>
