<template>
  <div class="codex-links">
    <div v-if="!compact" class="text-body-medium text-medium-emphasis mb-3">{{ $t('codex.linksHint') }}</div>

    <div class="d-flex flex-wrap align-center ga-2" :class="{ 'mb-3': !readonly }">
      <v-chip
        v-for="link in links"
        :key="link.uid"
        size="small"
        :variant="link.available ? 'tonal' : 'outlined'"
        :prepend-icon="kindIcon(link.kind)"
        :closable="!readonly"
        :title="link.summary || link.name"
        @click="codex.open(link.uid)"
        @click:close="remove(link.uid)"
      >
        {{ link.name }}
        <v-icon v-if="link.sourceCode === 'bookmark'" end size="x-small">mdi-bookmark-outline</v-icon>
      </v-chip>
      <span v-if="!links.length && (readonly || compact)" class="text-body-small text-medium-emphasis">
        {{ $t('codex.noLinks') }}
      </span>
      <template v-if="compact && !readonly">
        <v-btn size="small" variant="text" prepend-icon="mdi-plus" @click="adding = !adding">
          {{ $t('codex.addReference') }}
        </v-btn>
      </template>
    </div>

    <div v-if="!readonly && (!compact || adding)" class="d-flex align-start ga-2 flex-wrap">
      <v-autocomplete
        v-model="selected"
        v-model:search="query"
        :items="results"
        item-title="name"
        item-value="uid"
        :loading="searching"
        :label="$t('codex.addReference')"
        :placeholder="$t('codex.searchPlaceholder')"
        :no-data-text="query.length < 2 ? $t('codex.typeToSearch') : $t('codex.noResults')"
        no-filter
        return-object
        density="compact"
        variant="outlined"
        hide-details
        prepend-inner-icon="mdi-book-search-outline"
        class="flex-grow-1 search-field"
        @update:model-value="add"
      >
        <template #item="{ props: itemProps, internalItem: item }">
          <v-list-item v-bind="itemProps" :prepend-icon="kindIcon(item.raw.kind)" :subtitle="item.raw.summary || undefined">
            <template #append>
              <span class="text-caption text-medium-emphasis">{{ sourceLabel(item.raw) }}</span>
            </template>
          </v-list-item>
        </template>
      </v-autocomplete>
      <v-btn variant="text" prepend-icon="mdi-bookmark-plus-outline" @click="openBookmarkDialog">
        {{ $t('codex.addBookmark') }}
      </v-btn>
      <v-btn variant="text" prepend-icon="mdi-flask-outline" @click="homebrewDialog = true">
        {{ $t('codex.edit.newHomebrew') }}
      </v-btn>
    </div>

    <!-- Your own entry, linked here right away -->
    <CodexEntryDialog v-model="homebrewDialog" mode="homebrew" :initial-name="query" @saved="add" />

    <!-- Link-only bookmark for content we can't bundle (PHB, XGE ...) -->
    <v-dialog v-model="bookmarkDialog" max-width="480">
      <v-card>
        <v-card-title>{{ $t('codex.addBookmark') }}</v-card-title>
        <v-card-text>
          <p class="text-body-medium text-medium-emphasis mb-4">{{ $t('codex.bookmarkHint') }}</p>
          <v-row dense>
            <v-col cols="12">
              <v-text-field v-model="bookmark.name" :label="$t('codex.bookmarkName')" density="compact" variant="outlined" autofocus />
            </v-col>
            <v-col cols="7">
              <v-select v-model="bookmark.kind" :items="kindItems" :label="$t('codex.bookmarkKind')" density="compact" variant="outlined" />
            </v-col>
            <v-col cols="5">
              <v-text-field v-model="bookmark.book" :label="$t('codex.bookmarkBook')" placeholder="XGE" density="compact" variant="outlined" />
            </v-col>
            <v-col cols="12">
              <v-text-field
                v-model="bookmark.url"
                :label="$t('codex.bookmarkUrl')"
                placeholder="https://2014.5e.tools/spells.html#toll%20the%20dead_xge"
                density="compact"
                variant="outlined"
              />
            </v-col>
          </v-row>
          <v-alert v-if="bookmarkError" type="error" variant="tonal" density="compact">{{ bookmarkError }}</v-alert>
        </v-card-text>
        <v-card-actions>
          <v-spacer />
          <v-btn variant="text" @click="bookmarkDialog = false">{{ $t('common.cancel') }}</v-btn>
          <v-btn color="primary" variant="flat" :loading="savingBookmark" @click="saveBookmark">{{ $t('common.save') }}</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>
  </div>
</template>

<script setup lang="ts">
import { CODEX_KINDS, parseUid, type CodexEntrySummary } from '~~/types/codex'

interface LinkedEntry extends CodexEntrySummary {
  available: boolean
}

const props = defineProps<{
  ownerType: 'entity' | 'encounter'
  ownerId: number
  readonly?: boolean
  /** One-line layout for pages without tabs (encounters) */
  compact?: boolean
}>()

const emit = defineEmits<{ changed: [count: number] }>()

const { t } = useI18n()
const codex = useCodexStore()
const snackbar = useSnackbarStore()

const links = ref<LinkedEntry[]>([])
const query = ref('')
const results = ref<CodexEntrySummary[]>([])
const selected = ref<CodexEntrySummary | null>(null)
const searching = ref(false)
const adding = ref(false)

const homebrewDialog = ref(false)
const bookmarkDialog = ref(false)
const savingBookmark = ref(false)
const bookmarkError = ref('')
const bookmark = reactive({ name: '', kind: 'spell', book: '', url: '' })

const kindItems = computed(() =>
  CODEX_KINDS.map(kind => ({ value: kind, title: kindLabel(kind) })),
)

function kindLabel(kind: string): string {
  const key = `codex.kinds.${kind}`
  const label = t(key)
  return label === key ? kind : label
}

function kindIcon(kind: string): string {
  return (
    {
      spell: 'mdi-auto-fix',
      monster: 'mdi-paw',
      condition: 'mdi-alert-circle-outline',
      item: 'mdi-sword',
      feat: 'mdi-star-four-points-outline',
    }[kind] ?? 'mdi-book-open-variant'
  )
}

function sourceLabel(entry: CodexEntrySummary): string {
  // Bookmarks show their book; bundled entries their dataset (SRD51)
  if (entry.sourceCode === 'bookmark') return (parseUid(entry.uid)?.source ?? '').toUpperCase()
  if (entry.sourceCode === 'hb') return t('codex.homebrew')
  return entry.sourceCode.toUpperCase()
}

const query$ = () => ({ ownerType: props.ownerType, ownerId: props.ownerId })

async function load() {
  try {
    links.value = await $fetch<LinkedEntry[]>('/api/codex/links', { query: query$() })
    emit('changed', links.value.length)
  }
  catch {
    links.value = []
  }
}

let searchTimer: ReturnType<typeof setTimeout> | undefined
watch(query, (value) => {
  clearTimeout(searchTimer)
  if (!value || value.length < 2) {
    results.value = []
    return
  }
  searchTimer = setTimeout(async () => {
    searching.value = true
    try {
      results.value = await $fetch<CodexEntrySummary[]>('/api/codex/search', { query: { q: value, limit: 15 } })
    }
    catch {
      results.value = []
    }
    finally {
      searching.value = false
    }
  }, 200)
})

async function add(entry: CodexEntrySummary | null) {
  if (!entry) return
  try {
    links.value = await $fetch<LinkedEntry[]>('/api/codex/links', { method: 'POST', body: { ...query$(), uid: entry.uid } })
    emit('changed', links.value.length)
  }
  catch {
    snackbar.error(t('codex.linkFailed'))
  }
  // Clear after the autocomplete has applied its own update
  await nextTick()
  selected.value = null
  query.value = ''
  results.value = []
}

async function remove(uid: string) {
  try {
    links.value = await $fetch<LinkedEntry[]>('/api/codex/links', { method: 'DELETE', query: { ...query$(), uid } })
    emit('changed', links.value.length)
  }
  catch {
    snackbar.error(t('codex.linkFailed'))
  }
}

function openBookmarkDialog() {
  Object.assign(bookmark, { name: query.value, kind: 'spell', book: '', url: '' })
  bookmarkError.value = ''
  bookmarkDialog.value = true
}

async function saveBookmark() {
  bookmarkError.value = ''
  savingBookmark.value = true
  try {
    const entry = await $fetch<CodexEntrySummary>('/api/codex/bookmarks', { method: 'POST', body: { ...bookmark } })
    bookmarkDialog.value = false
    await add(entry)
  }
  catch {
    bookmarkError.value = t('codex.bookmarkFailed')
  }
  finally {
    savingBookmark.value = false
  }
}

watch(() => [props.ownerType, props.ownerId], load, { immediate: true })
onBeforeUnmount(() => clearTimeout(searchTimer))
</script>

<style scoped>
.search-field {
  min-width: 240px;
}
</style>
