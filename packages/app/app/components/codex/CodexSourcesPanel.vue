<template>
  <div>
    <p class="text-body-medium text-medium-emphasis mb-4">{{ $t('codex.sources.hint') }}</p>

    <div class="d-flex flex-wrap ga-2 mb-4">
      <v-btn color="primary" prepend-icon="mdi-file-upload-outline" :loading="reading" @click="fileInput?.click()">
        {{ $t('codex.sources.import') }}
      </v-btn>
      <input ref="fileInput" type="file" accept=".json,application/json" class="d-none" @change="onFile" />
    </div>

    <v-table density="comfortable">
      <thead>
        <tr>
          <th>{{ $t('codex.sources.name') }}</th>
          <th>{{ $t('codex.sources.code') }}</th>
          <th class="text-right">{{ $t('codex.sources.entries') }}</th>
          <th />
        </tr>
      </thead>
      <tbody>
        <tr v-for="source in sources" :key="source.code">
          <td>
            <div class="font-weight-medium">{{ sourceTitle(source) }}</div>
            <div class="text-body-small text-medium-emphasis">{{ originLabel(source.origin) }} · {{ source.license }}</div>
          </td>
          <td><code>{{ source.code.toUpperCase() }}</code></td>
          <td class="text-right">{{ source.entryCount }}</td>
          <td class="text-right">
            <v-btn
              v-if="source.origin === 'import'"
              icon="mdi-delete-outline"
              variant="text"
              size="small"
              color="error"
              :title="$t('codex.sources.remove')"
              @click="removeTarget = source"
            />
          </td>
        </tr>
      </tbody>
    </v-table>

    <!-- Confirm the import: code and title can be changed -->
    <v-dialog v-model="showImport" max-width="520">
      <v-card>
        <v-card-title>{{ $t('codex.sources.importTitle') }}</v-card-title>
        <v-card-text>
          <p class="text-body-medium mb-4">{{ $t('codex.sources.importHint', { file: fileName }) }}</p>
          <v-row dense>
            <v-col cols="8">
              <v-text-field v-model="form.title" :label="$t('codex.sources.name')" density="compact" variant="outlined" />
            </v-col>
            <v-col cols="4">
              <v-text-field
                v-model="form.code"
                :label="$t('codex.sources.code')"
                :hint="$t('codex.sources.codeHint')"
                persistent-hint
                density="compact"
                variant="outlined"
              />
            </v-col>
          </v-row>
          <v-alert v-if="error" type="error" variant="tonal" density="compact" class="mt-3">{{ error }}</v-alert>
        </v-card-text>
        <v-card-actions>
          <v-spacer />
          <v-btn variant="text" @click="showImport = false">{{ $t('common.cancel') }}</v-btn>
          <v-btn color="primary" variant="flat" :loading="importing" @click="runImport">{{ $t('codex.sources.importButton') }}</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>

    <v-dialog :model-value="!!removeTarget" max-width="440" @update:model-value="removeTarget = null">
      <v-card>
        <v-card-title>{{ $t('codex.sources.remove') }}</v-card-title>
        <v-card-text>{{ $t('codex.sources.removeConfirm', { name: removeTarget?.title, n: removeTarget?.entryCount }) }}</v-card-text>
        <v-card-actions>
          <v-spacer />
          <v-btn variant="text" @click="removeTarget = null">{{ $t('common.cancel') }}</v-btn>
          <v-btn color="error" variant="flat" @click="remove">{{ $t('codex.sources.remove') }}</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>
  </div>
</template>

<script setup lang="ts">
interface CodexSource {
  code: string
  title: string
  origin: string
  license: string
  entryCount: number
  importedAt: string
}

interface ImportResult {
  code: string
  title: string
  imported: number
  alreadyThere: number
  skipped: number
  ignored: string[]
}

const { t } = useI18n()
const snackbar = useSnackbarStore()

const sources = ref<CodexSource[]>([])
const fileInput = ref<HTMLInputElement | null>(null)
const reading = ref(false)
const importing = ref(false)
const showImport = ref(false)
const fileName = ref('')
const fileData = ref<unknown>(null)
const form = reactive({ code: '', title: '' })
const error = ref('')
const removeTarget = ref<CodexSource | null>(null)

async function load() {
  try {
    sources.value = await $fetch<CodexSource[]>('/api/codex/sources')
  }
  catch {
    sources.value = []
  }
}

function sourceTitle(source: CodexSource) {
  if (source.origin === 'user') return source.code === 'hb' ? t('codex.homebrew') : t('codex.sources.bookmarks')
  return source.title
}

function originLabel(origin: string) {
  return t(`codex.sources.origins.${origin === 'bundled' || origin === 'import' ? origin : 'user'}`)
}

/** Suggests a code and title from the file itself (5e.tools `_meta` or our `source`) */
function suggest(data: Record<string, unknown>) {
  const meta = (data._meta as { sources?: Array<{ abbreviation?: string, json?: string, full?: string }> } | undefined)?.sources?.[0]
  const own = data.source as { code?: string, title?: string } | undefined
  const base = fileName.value.replace(/\.json$/i, '')
  form.code = String(meta?.abbreviation || meta?.json || own?.code || base).replace(/[^a-z0-9]/gi, '').slice(0, 12).toUpperCase()
  form.title = String(meta?.full || own?.title || base)
}

async function onFile(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (!file) return
  reading.value = true
  try {
    fileName.value = file.name
    const data = JSON.parse(await file.text())
    if (!data || typeof data !== 'object') throw new Error('not an object')
    fileData.value = data
    suggest(data)
    error.value = ''
    showImport.value = true
  }
  catch {
    snackbar.error(t('codex.sources.notJson'))
  }
  finally {
    reading.value = false
  }
}

async function runImport() {
  importing.value = true
  error.value = ''
  try {
    const result = await $fetch<ImportResult>('/api/codex/import', {
      method: 'POST',
      body: { data: fileData.value, code: form.code, title: form.title },
    })
    showImport.value = false
    fileData.value = null
    const extra = [
      result.skipped ? t('codex.sources.skipped', { n: result.skipped }) : '',
      result.ignored.length ? t('codex.sources.ignored', { kinds: result.ignored.join(', ') }) : '',
    ].filter(Boolean).join(' ')
    snackbar.success(`${t('codex.sources.imported', { n: result.imported, name: result.title })} ${extra}`.trim())
    await load()
  }
  catch (err) {
    const message = (err as { data?: { message?: string } }).data?.message
    error.value = message || t('codex.sources.failed')
  }
  finally {
    importing.value = false
  }
}

async function remove() {
  const target = removeTarget.value
  removeTarget.value = null
  if (!target) return
  try {
    await $fetch('/api/codex/sources', { method: 'DELETE', query: { code: target.code } })
    snackbar.success(t('codex.sources.removed', { name: target.title }))
    await load()
  }
  catch {
    snackbar.error(t('codex.sources.failed'))
  }
}

onMounted(load)
</script>
