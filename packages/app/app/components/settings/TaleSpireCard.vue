<template>
  <v-card class="mt-6">
    <v-card-text>
      <div class="mb-4">
        <h2 class="text-headline-small mb-2">TaleSpire</h2>
        <p class="text-medium-emphasis text-body-medium mb-0">{{ $t('settings.taleSpire.subtitle') }}</p>
      </div>

      <v-switch
        v-model="taleSpire.enabled.value"
        :label="$t('settings.taleSpire.use')"
        color="primary"
        density="compact"
        hide-details
        class="mb-4"
      />

      <template v-if="isElectron">
        <div class="d-flex flex-wrap ga-3">
          <v-btn color="primary" variant="flat" prepend-icon="mdi-puzzle-plus" :loading="installing" @click="install()">
            {{ $t('settings.taleSpire.install') }}
          </v-btn>
          <v-btn v-if="notFound" variant="outlined" prepend-icon="mdi-folder-search" :loading="installing" @click="pickFolder">
            {{ $t('settings.taleSpire.pickFolder') }}
          </v-btn>
        </div>
        <v-alert v-if="notFound" type="warning" variant="tonal" density="compact" class="mt-3">
          {{ $t('settings.taleSpire.notFound') }}
        </v-alert>
        <v-alert v-if="installedPath" type="success" variant="tonal" density="compact" class="mt-3">
          <div>{{ $t('settings.taleSpire.installed') }}</div>
          <ol class="ts-steps mt-1">
            <li v-for="n in 3" :key="n">{{ $t(`settings.taleSpire.steps.s${n}`) }}</li>
          </ol>
        </v-alert>
        <div class="mt-2 text-body-small text-medium-emphasis">{{ $t('settings.taleSpire.installHint') }}</div>
      </template>
      <div v-else class="text-body-small text-medium-emphasis">{{ $t('settings.taleSpire.desktopOnly') }}</div>
    </v-card-text>
  </v-card>
</template>

<script setup lang="ts">
/** TaleSpire: the dice switch, and installing the DM Command Center panel ("symbiote") into TaleSpire */
const { t } = useI18n()
const taleSpire = useTaleSpire()
const { isElectron, selectFolder } = useElectron()
const snackbar = useSnackbarStore()

const installing = ref(false)
const notFound = ref(false)
const installedPath = ref<string | null>(null)

async function install(folder?: string) {
  const api = window.electronAPI
  if (!api?.installTaleSpirePanel) return
  installing.value = true
  try {
    const setup = await $fetch<{ url: string, key: string }>('/talespire-api/setup')
    const result = await api.installTaleSpirePanel({ ...setup, folder })
    notFound.value = !!result.notFound
    installedPath.value = result.success ? result.path ?? '' : null
    if (!result.success && !result.notFound) snackbar.error(t('settings.taleSpire.failed'))
  }
  catch {
    snackbar.error(t('settings.taleSpire.failed'))
  }
  finally {
    installing.value = false
  }
}

async function pickFolder() {
  const folder = await selectFolder({ title: t('settings.taleSpire.pickFolder') })
  if (folder) await install(folder)
}
</script>

<style scoped>
.ts-steps {
  padding-left: 20px;
}
</style>
