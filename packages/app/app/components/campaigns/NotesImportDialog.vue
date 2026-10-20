<template>
  <v-dialog v-model="dialogVisible" max-width="900" scrollable :persistent="importing">
    <v-card>
      <v-card-title class="d-flex align-center">
        <v-icon class="mr-2">mdi-file-import-outline</v-icon>
        {{ $t('notesImport.title') }}
      </v-card-title>

      <v-card-text style="max-height: 72vh">
        <!-- 1. The notes: a file or pasted text -->
        <template v-if="step === 'source'">
          <p class="text-body-medium text-medium-emphasis mb-4">{{ $t('notesImport.intro') }}</p>
          <v-file-input
            v-model="file"
            accept=".docx,.md,.markdown,.txt"
            :label="$t('notesImport.file')"
            prepend-icon="mdi-file-word-outline"
            variant="outlined"
            density="comfortable"
            :error-messages="fileError"
            show-size
          />
          <div class="text-center text-medium-emphasis my-2">{{ $t('notesImport.or') }}</div>
          <v-textarea
            v-model="pasted"
            :label="$t('notesImport.paste')"
            :placeholder="$t('notesImport.pastePlaceholder')"
            variant="outlined"
            rows="8"
            auto-grow
            max-rows="16"
          />
          <v-alert type="info" variant="tonal" density="compact" class="mt-2">
            {{ $t('notesImport.tip', { button: $t('connectAi.button') }) }}
          </v-alert>
        </template>

        <!-- 2. What was found: fix types and names, untick what to leave out -->
        <template v-else-if="step === 'review'">
          <div class="d-flex flex-wrap align-center ga-2 mb-3">
            <v-chip
              v-for="kind in countedKinds"
              :key="kind.kind"
              size="small"
              variant="tonal"
              :color="KIND_COLORS[kind.kind]"
              :prepend-icon="KIND_ICONS[kind.kind]"
            >
              {{ kindLabel(kind.kind) }}: {{ kind.count }}
            </v-chip>
            <v-spacer />
            <v-btn size="small" variant="text" @click="setAll(true)">{{ $t('common.selectAll') }}</v-btn>
            <v-btn size="small" variant="text" @click="setAll(false)">{{ $t('common.deselectAll') }}</v-btn>
          </div>
          <v-alert v-if="!rows.length" type="warning" variant="tonal">{{ $t('notesImport.nothingFound', { button: $t('connectAi.button') }) }}</v-alert>

          <div
            v-for="row in rows"
            :key="row.index"
            class="note-row d-flex align-start ga-2 py-2"
            :class="{ 'note-row--off': !row.selected }"
            :style="{ paddingLeft: `${Math.min(row.level, 4) * 12}px` }"
          >
            <v-checkbox-btn v-model="row.selected" density="compact" class="flex-grow-0" />
            <div class="flex-grow-1" style="min-width: 0">
              <div class="d-flex flex-wrap align-center ga-2">
                <v-text-field
                  v-model="row.name"
                  :placeholder="$t('notesImport.untitled')"
                  density="compact"
                  variant="underlined"
                  hide-details
                  class="note-name"
                />
                <v-select
                  v-model="row.kind"
                  :items="kindItems"
                  density="compact"
                  variant="outlined"
                  hide-details
                  class="note-kind"
                  @update:model-value="row.selected = row.kind !== 'skip'"
                />
                <v-chip v-if="exists(row)" size="x-small" color="warning" variant="tonal">{{ $t('notesImport.exists') }}</v-chip>
              </div>
              <div v-if="row.path.length" class="text-body-small text-medium-emphasis mt-1">{{ row.path.join(' › ') }}</div>
              <div v-if="row.body" class="note-preview text-body-small mt-1">{{ row.body }}</div>
            </div>
          </div>

          <v-switch
            v-model="linkNames"
            :label="$t('notesImport.linkNames')"
            color="primary"
            density="compact"
            hide-details
            class="mt-2"
          />
          <div class="text-body-small text-medium-emphasis">{{ $t('notesImport.backupNote') }}</div>
        </template>

        <!-- 3. Done -->
        <template v-else>
          <v-alert type="success" variant="tonal" class="mb-3">
            <div class="font-weight-medium">{{ $t('notesImport.done', { n: result.total }) }}</div>
            <div class="text-body-small mt-1">{{ resultLine }}</div>
          </v-alert>
          <p class="text-body-medium">{{ $t('notesImport.undoHint') }}</p>
        </template>
      </v-card-text>

      <v-card-actions>
        <template v-if="step === 'source'">
          <v-spacer />
          <v-btn variant="text" @click="dialogVisible = false">{{ $t('common.cancel') }}</v-btn>
          <v-btn color="primary" variant="flat" :disabled="!file && !pasted.trim()" :loading="reading" @click="read">
            {{ $t('notesImport.read') }}
          </v-btn>
        </template>
        <template v-else-if="step === 'review'">
          <v-btn variant="text" :disabled="importing" @click="step = 'source'">{{ $t('common.back') }}</v-btn>
          <v-spacer />
          <v-btn color="primary" variant="flat" prepend-icon="mdi-import" :disabled="!selected.length" :loading="importing" @click="doImport">
            {{ $t('notesImport.import', { n: selected.length }) }}
          </v-btn>
        </template>
        <template v-else>
          <v-btn color="warning" variant="text" prepend-icon="mdi-undo" :loading="undoing" :disabled="!backupName" @click="undo">
            {{ $t('notesImport.undo') }}
          </v-btn>
          <v-spacer />
          <v-btn color="primary" variant="flat" @click="dialogVisible = false">{{ $t('common.close') }}</v-btn>
        </template>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>

<script setup lang="ts">
import { docxHeadingStyles, docxToMarkdown, LINK_KEYS, linkMentions, NOTE_KINDS, splitNotes, type LinkTarget, type NoteKind } from '~/utils/notesImport'

/**
 * "Import my notes": a Word or text file (or pasted notes) split at its
 * headings into NPCs, places, items, factions, lore, quests and sessions.
 * The DM checks the guesses, then everything is created in one go, with
 * names in the text turned into links. A backup is taken first, so the
 * whole import can be undone.
 */
const props = defineProps<{ campaignId: number }>()
const dialogVisible = defineModel<boolean>({ default: false })

interface Row {
  index: number
  name: string
  kind: NoteKind
  level: number
  body: string
  path: string[]
  sessionNumber: number | null
  selected: boolean
}

const { t } = useI18n()
const snackbar = useSnackbarStore()
const entitiesStore = useEntitiesStore()
const foldersStore = useFoldersStore()

const KIND_ICONS: Record<NoteKind, string> = {
  NPC: 'mdi-account', Location: 'mdi-map-marker', Item: 'mdi-sword', Faction: 'mdi-shield-account',
  Lore: 'mdi-book-open-variant', Quest: 'mdi-flag-checkered', Session: 'mdi-calendar-text', skip: 'mdi-minus-circle-outline',
}
const KIND_COLORS: Record<NoteKind, string> = {
  NPC: 'primary', Location: 'success', Item: 'amber', Faction: 'deep-purple', Lore: 'brown', Quest: 'orange', Session: 'blue', skip: 'grey',
}

const step = ref<'source' | 'review' | 'done'>('source')
const file = ref<File | File[] | null>(null)
const fileError = ref('')
const pasted = ref('')
const reading = ref(false)
const importing = ref(false)
const undoing = ref(false)
const rows = ref<Row[]>([])
const linkNames = ref(true)
const backupName = ref<string | null>(null)
const result = ref<{ total: number, byKind: Partial<Record<NoteKind, number>> }>({ total: 0, byKind: {} })
const existingEntities = ref<Array<{ id: number, type: string, name: string }>>([])
/** "NPC:klarg" for everything already in the campaign */
const taken = ref(new Set<string>())
const exists = (row: Row) => taken.value.has(`${row.kind}:${row.name.trim().toLowerCase()}`)

watch(dialogVisible, (open) => {
  if (!open) return
  step.value = 'source'
  file.value = null
  fileError.value = ''
  pasted.value = ''
  rows.value = []
  backupName.value = null
})

const kindLabel = (kind: NoteKind) => t(`notesImport.kinds.${kind}`)
const kindItems = computed(() => NOTE_KINDS.map(kind => ({ title: kindLabel(kind), value: kind })))
const selected = computed(() => rows.value.filter(r => r.selected && r.kind !== 'skip' && r.name.trim()))
const countedKinds = computed(() => NOTE_KINDS.filter(k => k !== 'skip')
  .map(kind => ({ kind, count: selected.value.filter(r => r.kind === kind).length }))
  .filter(k => k.count))
const resultLine = computed(() => Object.entries(result.value.byKind).map(([kind, n]) => `${kindLabel(kind as NoteKind)}: ${n}`).join(' · '))

function setAll(on: boolean) {
  for (const row of rows.value) row.selected = on && row.kind !== 'skip' && !exists(row)
}

/** The file (or pasted text) as Markdown */
async function readMarkdown(): Promise<string> {
  const picked = Array.isArray(file.value) ? file.value[0] : file.value
  if (!picked) return pasted.value
  if (/\.docx$/i.test(picked.name)) {
    const JSZip = (await import('jszip')).default
    const zip = await JSZip.loadAsync(picked)
    const documentXml = await zip.file('word/document.xml')?.async('string')
    if (!documentXml) throw new Error('not a Word file')
    const stylesXml = await zip.file('word/styles.xml')?.async('string')
    return docxToMarkdown(documentXml, docxHeadingStyles(stylesXml ?? ''))
  }
  return picked.text()
}

async function read() {
  reading.value = true
  fileError.value = ''
  try {
    const markdown = await readMarkdown()
    const [existing, sessions] = await Promise.all([
      $fetch<{ entities: Array<{ id: number, type: string, name: string }> }>('/api/import/entities', { query: { campaignId: props.campaignId, limit: 500 } }),
      $fetch<Array<{ title: string }>>('/api/sessions', { query: { campaignId: props.campaignId } }),
    ])
    existingEntities.value = existing.entities
    taken.value = new Set([
      ...existing.entities.map(e => `${e.type}:${e.name.toLowerCase()}`),
      ...sessions.map(s => `Session:${s.title.toLowerCase()}`),
    ])
    rows.value = splitNotes(markdown).map(section => ({
      index: section.index,
      name: section.title,
      kind: section.kind,
      level: section.level,
      body: section.body,
      path: section.path,
      sessionNumber: section.sessionNumber,
      selected: section.kind !== 'skip' && !taken.value.has(`${section.kind}:${section.title.toLowerCase()}`),
    }))
    step.value = 'review'
  }
  catch {
    fileError.value = t('notesImport.readFailed')
  }
  finally {
    reading.value = false
  }
}

/** Links to what's already in the campaign */
function existingTargets(asRef: boolean): LinkTarget[] {
  return existingEntities.value
    .filter(e => LINK_KEYS[e.type])
    .map(e => ({ name: e.name, token: asRef ? `{{ref:existing:${e.id}}}` : `{{${LINK_KEYS[e.type]}:${e.id}}}` }))
}

async function doImport() {
  importing.value = true
  const picked = selected.value.map(r => ({ ...r, name: r.name.trim() }))
  const byKind: Partial<Record<NoteKind, number>> = {}
  const count = (kind: NoteKind) => (byKind[kind] = (byKind[kind] ?? 0) + 1)
  try {
    // A backup first: "Undo import" puts it back
    backupName.value = (await $fetch<{ name: string }>('/api/backup', { method: 'POST' })).name

    // Quests first (without links), so the others can link to them
    const quests = picked.filter(r => r.kind === 'Quest')
    const questIds = new Map<Row, number>()
    for (const row of quests) {
      const quest = await $fetch<{ id: number }>('/api/quests', { method: 'POST', body: { campaignId: props.campaignId, name: row.name, description: row.body } })
      questIds.set(row, quest.id)
      count('Quest')
    }

    // NPCs, places, items, factions and lore in one go, linking each other with {{ref:...}}
    const entities = picked.filter(r => ['NPC', 'Location', 'Item', 'Faction', 'Lore'].includes(r.kind))
    const refs = new Map(entities.map((row, i) => [row, `n${i + 1}`]))
    const refTargets: LinkTarget[] = [
      ...entities.map(row => ({ name: row.name, token: `{{ref:${refs.get(row)}}}` })),
      ...quests.map(row => ({ name: row.name, token: `{{ref:existing:${questIds.get(row)}}}` })),
      ...existingTargets(true),
    ]
    let refToId: Record<string, number> = {}
    if (entities.length) {
      const created = await $fetch<{ refToId: Record<string, number> }>('/api/import/bulk', {
        method: 'POST',
        query: { source: 'notes' },
        body: {
          campaignId: props.campaignId,
          entities: entities.map(row => ({
            ref: refs.get(row),
            type: row.kind,
            name: row.name,
            description: linkNames.value ? linkMentions(row.body, refTargets, row.name) : row.body,
          })),
          relations: [],
        },
      })
      refToId = created.refToId
      for (const row of entities) count(row.kind)
    }

    // Now every id is known: quests get their links, sessions are made with them
    const idTargets: LinkTarget[] = [
      ...entities.map(row => ({ name: row.name, token: `{{${LINK_KEYS[row.kind]}:${refToId[refs.get(row)!]}}}` })),
      ...quests.map(row => ({ name: row.name, token: `{{quest:${questIds.get(row)}}}` })),
      ...existingTargets(false),
    ]
    if (linkNames.value) {
      for (const row of quests) {
        const description = linkMentions(row.body, idTargets, row.name)
        if (description !== row.body) await $fetch(`/api/quests/${questIds.get(row)}`, { method: 'PATCH', body: { description } })
      }
    }
    for (const row of picked.filter(r => r.kind === 'Session')) {
      await $fetch('/api/sessions', {
        method: 'POST',
        body: {
          campaignId: props.campaignId,
          title: row.name,
          session_number: row.sessionNumber,
          notes: linkNames.value ? linkMentions(row.body, idTargets) : row.body,
        },
      })
      count('Session')
    }

    result.value = { total: Object.values(byKind).reduce((a, b) => a + (b ?? 0), 0), byKind }
    step.value = 'done'
    await Promise.all([entitiesStore.refetchLoaded(props.campaignId), foldersStore.refetchLoaded()])
  }
  catch {
    snackbar.error(t('notesImport.failed'))
    // Something may already be saved; the backup can take it back
    if (backupName.value && Object.keys(byKind).length) {
      result.value = { total: Object.values(byKind).reduce((a, b) => a + (b ?? 0), 0), byKind }
      step.value = 'done'
    }
  }
  finally {
    importing.value = false
  }
}

async function undo() {
  if (!backupName.value) return
  undoing.value = true
  try {
    await $fetch('/api/backups/restore', { method: 'POST', body: { name: backupName.value } })
    snackbar.success(t('notesImport.undone'))
    // Every store holds data from before the undo - start fresh
    setTimeout(() => window.location.reload(), 800)
  }
  catch {
    snackbar.error(t('notesImport.undoFailed'))
    undoing.value = false
  }
}
</script>

<style scoped>
.note-row {
  border-bottom: 1px solid rgba(var(--v-border-color), 0.08);
}
.note-row--off {
  opacity: 0.5;
}
.note-name {
  min-width: 180px;
  max-width: 340px;
}
.note-kind {
  max-width: 170px;
}
.note-preview {
  white-space: pre-line;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
  opacity: 0.75;
}
</style>
