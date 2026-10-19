<template>
  <v-card class="mt-6">
    <v-card-text>
      <div class="mb-4">
        <h2 class="text-headline-small mb-2">
          {{ $t('settings.backups.title') }}
        </h2>
        <p class="text-medium-emphasis text-body-medium">
          {{ $t('settings.backups.subtitle', { count: maxBackups }) }}
        </p>
      </div>

      <div class="d-flex flex-column flex-sm-row mb-4">
        <v-btn :loading="creating" color="secondary" variant="outlined" @click="createBackup">
          <v-icon start>mdi-database-plus</v-icon>
          {{ $t('settings.backups.createNow') }}
        </v-btn>
        <v-btn
          v-if="electron.isElectron"
          color="secondary"
          variant="outlined"
          class="ml-sm-4 mt-3 mt-sm-0"
          @click="importBackupFile"
        >
          <v-icon start>mdi-database-import</v-icon>
          {{ $t('settings.backups.importFile') }}
        </v-btn>
      </div>

      <v-table v-if="backups.length > 0" density="compact">
        <thead>
          <tr>
            <th>{{ $t('settings.backups.created') }}</th>
            <th>{{ $t('settings.backups.size') }}</th>
            <th />
          </tr>
        </thead>
        <tbody>
          <tr v-for="backup in backups" :key="backup.name">
            <td>
              {{ formatDate(backup.createdAt) }}
              <div class="text-body-small text-medium-emphasis">{{ backup.name }}</div>
            </td>
            <td>{{ formatSize(backup.size) }}</td>
            <td class="text-right">
              <v-btn size="small" variant="text" color="warning" @click="confirmRestore = backup">
                {{ $t('settings.backups.restore') }}
              </v-btn>
            </td>
          </tr>
        </tbody>
      </v-table>
      <p v-else-if="loaded" class="text-body-small text-medium-emphasis">
        {{ $t('settings.backups.empty') }}
      </p>

      <div v-if="directory" class="mt-3 text-body-small text-medium-emphasis">
        {{ $t('settings.backups.location') }}: {{ directory }}
      </div>
    </v-card-text>

    <v-dialog :model-value="!!confirmRestore" max-width="520" @update:model-value="confirmRestore = null">
      <v-card v-if="confirmRestore">
        <v-card-title>{{ $t('settings.backups.confirmTitle') }}</v-card-title>
        <v-card-text>
          {{ $t('settings.backups.confirmText', { date: formatDate(confirmRestore.createdAt) }) }}
        </v-card-text>
        <v-card-actions>
          <v-spacer />
          <v-btn variant="text" @click="confirmRestore = null">
            {{ $t('common.cancel') }}
          </v-btn>
          <v-btn :loading="restoring" color="warning" variant="elevated" @click="restore(confirmRestore)">
            {{ $t('settings.backups.restore') }}
          </v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>
  </v-card>
</template>

<script setup lang="ts">
interface BackupInfo {
  name: string
  size: number
  createdAt: string
}

const { t, locale } = useI18n()
const electron = useElectron()
const snackbar = useSnackbarStore()

const backups = ref<BackupInfo[]>([])
const directory = ref('')
const maxBackups = ref(20)
const loaded = ref(false)
const creating = ref(false)
const restoring = ref(false)
const confirmRestore = ref<BackupInfo | null>(null)

async function loadBackups() {
  try {
    const result = await $fetch<{ backups: BackupInfo[], directory: string, maxBackups: number }>('/api/backups')
    backups.value = result.backups
    directory.value = result.directory
    maxBackups.value = result.maxBackups
    loaded.value = true
  }
  catch (error) {
    console.error('[Backups] Failed to load backups:', error)
  }
}

async function createBackup() {
  creating.value = true
  try {
    await $fetch('/api/backup', { method: 'POST' })
    snackbar.success(t('settings.backups.createSuccess'))
    await loadBackups()
  }
  catch {
    snackbar.error(t('settings.backups.failed'))
  }
  finally {
    creating.value = false
  }
}

async function importBackupFile() {
  const result = await electron.importBackupFile()
  if (result.success) {
    await loadBackups()
  }
  else if (!result.canceled) {
    snackbar.error(`${t('settings.backups.failed')}: ${result.error}`)
  }
}

async function restore(backup: BackupInfo) {
  restoring.value = true
  try {
    await $fetch('/api/backups/restore', { method: 'POST', body: { name: backup.name } })
    snackbar.success(t('settings.backups.restoreSuccess'))
    // Every store holds data from the old database - start fresh
    setTimeout(() => window.location.reload(), 800)
  }
  catch (error) {
    const message = (error as { data?: { message?: string } }).data?.message
    snackbar.error(`${t('settings.backups.restoreFailed')}${message ? `: ${message}` : ''}`)
    restoring.value = false
    confirmRestore.value = null
  }
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleString(locale.value)
}

function formatSize(bytes: number) {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

onMounted(loadBackups)
</script>
