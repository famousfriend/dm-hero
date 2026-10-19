<template>
  <v-autocomplete
    v-model="selected"
    v-model:search="query"
    :items="results"
    item-title="name"
    item-value="uid"
    :loading="searching"
    :placeholder="$t('live.lookupPlaceholder')"
    :no-data-text="query.length < 2 ? $t('codex.typeToSearch') : $t('codex.noResults')"
    no-filter
    return-object
    density="compact"
    variant="outlined"
    hide-details
    prepend-inner-icon="mdi-book-search-outline"
    @update:model-value="open"
  >
    <template #item="{ props: itemProps, internalItem }">
      <v-list-item v-bind="itemProps" :subtitle="internalItem.raw.summary || undefined">
        <template #append>
          <span class="text-caption text-medium-emphasis">{{ internalItem.raw.kind }}</span>
        </template>
      </v-list-item>
    </template>
  </v-autocomplete>
</template>

<script setup lang="ts">
import type { CodexEntrySummary } from '~~/types/codex'

// Rules lookup: pick an entry, read it in the reference sidebar
const codex = useCodexStore()
const query = ref('')
const results = ref<CodexEntrySummary[]>([])
const selected = ref<CodexEntrySummary | null>(null)
const searching = ref(false)

let timer: ReturnType<typeof setTimeout> | undefined
watch(query, (value) => {
  clearTimeout(timer)
  if (!value || value.length < 2) {
    results.value = []
    return
  }
  timer = setTimeout(async () => {
    searching.value = true
    try {
      results.value = await $fetch<CodexEntrySummary[]>('/api/codex/search', { query: { q: value, limit: 10 } })
    }
    catch {
      results.value = []
    }
    finally {
      searching.value = false
    }
  }, 200)
})

async function open(entry: CodexEntrySummary | null) {
  if (!entry) return
  await codex.open(entry.uid)
  // Clear after the autocomplete has applied its own update
  await nextTick()
  selected.value = null
  query.value = ''
  results.value = []
}

onBeforeUnmount(() => clearTimeout(timer))
</script>
