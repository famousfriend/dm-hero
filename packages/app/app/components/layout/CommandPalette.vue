<template>
  <v-dialog
    :model-value="modelValue"
    max-width="720"
    scrollable
    @update:model-value="$emit('update:model-value', $event)"
  >
    <v-card class="command-palette">
      <v-card-title class="d-flex align-center ga-2">
        <v-text-field
          ref="inputRef"
          v-model="query"
          autofocus
          clearable
          hide-details
          :placeholder="pending ? $t('palette.namePlaceholder', { type: pending.label }) : $t('palette.placeholder')"
          :prepend-inner-icon="pending ? pending.icon : 'mdi-magnify'"
          variant="solo"
          flat
          @keydown="onKeydown"
        />
        <v-btn
          v-if="!pending"
          :icon="entitiesStore.showArchived ? 'mdi-archive-check' : 'mdi-archive-off'"
          :color="entitiesStore.showArchived ? 'warning' : undefined"
          variant="text"
          @click="entitiesStore.toggleShowArchived()"
        >
          <v-icon>{{ entitiesStore.showArchived ? 'mdi-archive-check' : 'mdi-archive-off' }}</v-icon>
          <v-tooltip activator="parent" location="bottom">
            {{ $t('common.showArchived') }}
          </v-tooltip>
        </v-btn>
      </v-card-title>
      <v-divider />

      <v-card-text class="pa-0 palette-results">
        <!-- Second step of a "New ..." command: the typed text becomes the name -->
        <div v-if="pending" class="pa-4 text-body-medium text-medium-emphasis">
          {{ $t('palette.nameHint') }}
        </div>

        <v-list v-else-if="flat.length" density="compact" class="py-1">
          <template v-for="group in groups" :key="group.key">
            <v-list-subheader>{{ group.title }}</v-list-subheader>
            <v-list-item
              v-for="item in group.items"
              :key="item.key"
              :active="item.index === activeIndex"
              :prepend-icon="item.icon"
              :title="item.title"
              :subtitle="item.subtitle"
              @click="run(item)"
              @mousemove="activeIndex = item.index"
            >
              <template v-if="item.chips?.length" #append>
                <v-chip v-for="chip in item.chips" :key="chip" size="x-small" variant="tonal" class="ml-1">
                  {{ chip }}
                </v-chip>
              </template>
            </v-list-item>
          </template>
        </v-list>

        <div v-else class="text-center text-disabled py-8">
          {{ query.trim() ? $t('search.noResults') : $t('palette.empty') }}
        </div>
      </v-card-text>

      <v-divider />
      <div class="d-flex flex-wrap ga-4 px-4 py-2 text-caption text-medium-emphasis">
        <span><kbd>↑</kbd> <kbd>↓</kbd> {{ $t('palette.keyMove') }}</span>
        <span><kbd>Enter</kbd> {{ $t('palette.keyOpen') }}</span>
        <span><kbd>Esc</kbd> {{ pending ? $t('palette.keyBack') : $t('palette.keyClose') }}</span>
        <v-spacer />
        <span><kbd>Ctrl</kbd> + <kbd>K</kbd></span>
      </div>
    </v-card>
  </v-dialog>
</template>

<script setup lang="ts">
import { NAV_ITEMS } from '~/utils/navItems'
import { NAV_KEYS } from '~~/types/navigation'
import type { CodexEntrySummary } from '~~/types/codex'

/**
 * Ctrl+K command palette: entities, rules references, pages and commands in
 * one list. Replaces the old global search dialog ("/" still opens it).
 */

interface EntityResult {
  id: number
  name: string
  type: string
  icon: string
  color: string
  linkedEntities?: string[]
  archived_at?: string | null
}

type PaletteTarget
  = | { kind: 'entity', id: number, type: string, name: string }
    | { kind: 'reference', uid: string }
    | { kind: 'page', to: string }
    | { kind: 'create', type: CreateType }
    | { kind: 'combat', encounterId: number }

interface PaletteItem {
  key: string
  group: 'recent' | 'commands' | 'entities' | 'references' | 'pages'
  icon: string
  title: string
  subtitle?: string
  chips?: string[]
  target: PaletteTarget
  index: number
}

type RecentItem = Omit<PaletteItem, 'index' | 'group' | 'chips'>

type CreateType = 'NPC' | 'Location' | 'Item' | 'Faction' | 'Lore' | 'Player' | 'Encounter'

const props = defineProps<{ modelValue: boolean }>()
const emit = defineEmits<{ 'update:model-value': [value: boolean] }>()

const { t } = useI18n()
const router = useRouter()
const campaignStore = useCampaignStore()
const entitiesStore = useEntitiesStore()
const encounterStore = useEncounterStore()
const codex = useCodexStore()
const snackbar = useSnackbarStore()

const query = ref('')
const activeIndex = ref(0)
const entityResults = ref<EntityResult[]>([])
const referenceResults = ref<CodexEntrySummary[]>([])
const recent = ref<RecentItem[]>([])
const pending = ref<{ type: CreateType, label: string, icon: string } | null>(null)
const inputRef = ref<{ focus: () => void } | null>(null)

const campaignId = computed(() => campaignStore.activeCampaignIdNumber)

// ---------------------------------------------------------------------------
// Sources
// ---------------------------------------------------------------------------

const ENTITY_ROUTES: Record<string, string> = {
  NPC: '/npcs',
  Location: '/locations',
  Item: '/items',
  Faction: '/factions',
  Lore: '/lore',
  Session: '/sessions',
  Player: '/players',
  Group: '/groups',
}

const CREATE_TYPES: Array<{ type: CreateType, icon: string, api?: string, route: string }> = [
  { type: 'NPC', icon: 'mdi-account-plus', api: 'npcs', route: '/npcs' },
  { type: 'Location', icon: 'mdi-map-marker-plus', api: 'locations', route: '/locations' },
  { type: 'Item', icon: 'mdi-sword', api: 'items', route: '/items' },
  { type: 'Faction', icon: 'mdi-shield-plus', api: 'factions', route: '/factions' },
  { type: 'Lore', icon: 'mdi-book-plus', api: 'lore', route: '/lore' },
  { type: 'Player', icon: 'mdi-account-star', api: 'players', route: '/players' },
  { type: 'Encounter', icon: 'mdi-sword-cross', route: '/encounters' },
]

function typeLabel(type: string): string {
  if (type === 'Encounter') return t('palette.encounter')
  const key = `entityTypes.${type}`
  const label = t(key)
  return label === key ? type : label
}

const normalize = (text: string) => text.toLocaleLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '')
const matches = (text: string, q: string) => normalize(text).includes(normalize(q))

const runningCombat = computed(() => encounterStore.encounters.find(e => e.status === 'active') ?? null)

const commandItems = computed<Omit<PaletteItem, 'index'>[]>(() => {
  if (!campaignId.value) return []
  const items: Omit<PaletteItem, 'index'>[] = []
  if (runningCombat.value) {
    items.push({
      key: `combat-${runningCombat.value.id}`,
      group: 'commands',
      icon: 'mdi-sword-cross',
      title: t('palette.openCombat'),
      subtitle: runningCombat.value.name,
      target: { kind: 'combat', encounterId: runningCombat.value.id },
    })
  }
  for (const c of CREATE_TYPES) {
    items.push({
      key: `create-${c.type}`,
      group: 'commands',
      icon: c.icon,
      title: t('palette.create', { type: typeLabel(c.type) }),
      target: { kind: 'create', type: c.type },
    })
  }
  const q = query.value.trim()
  return q ? items.filter(i => matches(`${i.title} ${i.subtitle ?? ''}`, q)) : items
})

const pageItems = computed<Omit<PaletteItem, 'index'>[]>(() => {
  const q = query.value.trim()
  if (!q) return []
  const music = { isPlaying: { value: false } }
  return NAV_KEYS.flatMap((key) => {
    const nav = NAV_ITEMS[key]
    if (!nav?.to || (nav.needsCampaign && !campaignId.value)) return []
    const title = t(nav.title)
    return matches(title, q)
      ? [{ key: `page-${key}`, group: 'pages' as const, icon: nav.icon(music), title, target: { kind: 'page' as const, to: nav.to } }]
      : []
  })
})

const entityItems = computed<Omit<PaletteItem, 'index'>[]>(() =>
  entityResults.value
    .filter(r => entitiesStore.showArchived || !r.archived_at)
    .map(r => ({
      key: `entity-${r.type}-${r.id}`,
      group: 'entities' as const,
      icon: r.icon,
      title: r.name,
      subtitle: typeLabel(r.type),
      chips: r.linkedEntities?.slice(0, 3),
      target: { kind: 'entity' as const, id: r.id, type: r.type, name: r.name },
    })),
)

const referenceItems = computed<Omit<PaletteItem, 'index'>[]>(() =>
  referenceResults.value.map(r => ({
    key: `ref-${r.uid}`,
    group: 'references' as const,
    icon: 'mdi-book-open-page-variant',
    title: r.name,
    subtitle: r.summary || undefined,
    target: { kind: 'reference' as const, uid: r.uid },
  })),
)

const recentItems = computed<Omit<PaletteItem, 'index'>[]>(() =>
  query.value.trim() ? [] : recent.value.map(r => ({ ...r, group: 'recent' as const })),
)

// Exact-substring matches (commands, pages) first, then the fuzzier searches
const GROUP_ORDER: PaletteItem['group'][] = ['recent', 'commands', 'pages', 'entities', 'references']

const flat = computed<PaletteItem[]>(() => {
  const byGroup = {
    recent: recentItems.value,
    commands: commandItems.value,
    entities: entityItems.value,
    references: referenceItems.value,
    pages: pageItems.value,
  }
  return GROUP_ORDER.flatMap(g => byGroup[g]).map((item, index) => ({ ...item, index }))
})

const groups = computed(() =>
  GROUP_ORDER.map(key => ({
    key,
    title: t(`palette.groups.${key}`),
    items: flat.value.filter(i => i.group === key),
  })).filter(g => g.items.length),
)

// ---------------------------------------------------------------------------
// Searching
// ---------------------------------------------------------------------------

let searchTimer: ReturnType<typeof setTimeout> | undefined
let searchSeq = 0

watch(query, (value) => {
  activeIndex.value = 0
  if (pending.value) return
  clearTimeout(searchTimer)
  const q = (value ?? '').trim()
  if (!q) {
    entityResults.value = []
    referenceResults.value = []
    return
  }
  searchTimer = setTimeout(() => search(q), 150)
})

async function search(q: string) {
  const seq = ++searchSeq
  const [entities, references] = await Promise.all([
    campaignId.value
      ? $fetch<EntityResult[]>('/api/search', { query: { q, campaignId: campaignId.value } }).catch(() => [])
      : Promise.resolve([]),
    q.length >= 2
      ? $fetch<CodexEntrySummary[]>('/api/codex/search', { query: { q, limit: 5 } }).catch(() => [])
      : Promise.resolve([]),
  ])
  if (seq !== searchSeq) return // a newer query is on its way
  entityResults.value = entities.slice(0, 12)
  referenceResults.value = references
}

// ---------------------------------------------------------------------------
// Recent items (per campaign, this browser only)
// ---------------------------------------------------------------------------

const recentKey = computed(() => `dmcc-palette-recent-${campaignId.value ?? 'none'}`)

function loadRecent() {
  try {
    recent.value = JSON.parse(localStorage.getItem(recentKey.value) || '[]')
  }
  catch {
    recent.value = []
  }
}

function remember(item: PaletteItem) {
  if (item.target.kind === 'create' || item.target.kind === 'combat') return
  const entry: RecentItem = { key: item.key, icon: item.icon, title: item.title, subtitle: item.subtitle, target: item.target }
  recent.value = [entry, ...recent.value.filter(r => r.key !== item.key)].slice(0, 8)
  try {
    localStorage.setItem(recentKey.value, JSON.stringify(recent.value))
  }
  catch {
    // storage unavailable: recents just aren't kept
  }
}

// ---------------------------------------------------------------------------
// Running an item
// ---------------------------------------------------------------------------

function close() {
  emit('update:model-value', false)
}

function entityPath(type: string, id: number, name: string): string {
  const params = new URLSearchParams({ highlight: String(id), search: `"${name}"` })
  return `${ENTITY_ROUTES[type] ?? '/npcs'}?${params.toString()}`
}

async function openCombat(encounterId: number) {
  await router.push('/encounters')
  await encounterStore.openEncounter(encounterId)
}

async function run(item: PaletteItem) {
  const target = item.target
  if (target.kind === 'create') {
    const type = CREATE_TYPES.find(c => c.type === target.type)!
    pending.value = { type: target.type, label: typeLabel(target.type), icon: type.icon }
    query.value = ''
    nextTick(() => inputRef.value?.focus())
    return
  }
  remember(item)
  close()
  if (target.kind === 'entity') await navigateTo(entityPath(target.type, target.id, target.name))
  else if (target.kind === 'reference') await codex.open(target.uid)
  else if (target.kind === 'page') await navigateTo(target.to)
  else if (target.kind === 'combat') await openCombat(target.encounterId)
}

async function createPending() {
  const name = query.value.trim()
  if (!pending.value || !name || !campaignId.value) return
  const type = CREATE_TYPES.find(c => c.type === pending.value!.type)!
  try {
    if (type.type === 'Encounter') {
      const encounter = await encounterStore.createEncounter(campaignId.value, name)
      if (!encounter) throw new Error('create failed')
      close()
      await openCombat(encounter.id)
    }
    else {
      const created = await $fetch<{ id: number, name: string }>(`/api/${type.api}`, {
        method: 'POST',
        body: { name, campaignId: campaignId.value },
      })
      close()
      await navigateTo(entityPath(type.type, created.id, created.name))
    }
    snackbar.success(t('palette.created', { name }))
  }
  catch {
    snackbar.error(t('palette.createFailed'))
  }
}

function onKeydown(event: KeyboardEvent) {
  if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
    event.preventDefault()
    const count = flat.value.length
    if (!count) return
    activeIndex.value = (activeIndex.value + (event.key === 'ArrowDown' ? 1 : count - 1)) % count
    document.querySelector('.command-palette .v-list-item--active')?.scrollIntoView({ block: 'nearest' })
  }
  else if (event.key === 'Enter') {
    event.preventDefault()
    if (pending.value) createPending()
    else if (flat.value[activeIndex.value]) run(flat.value[activeIndex.value]!)
  }
  else if (event.key === 'Escape' && pending.value) {
    // Leave the name step, not the palette
    event.preventDefault()
    event.stopPropagation()
    pending.value = null
    query.value = ''
  }
}

watch(
  () => props.modelValue,
  (open) => {
    if (open) {
      query.value = ''
      pending.value = null
      activeIndex.value = 0
      loadRecent()
      if (campaignId.value) encounterStore.fetchEncounters(campaignId.value).catch(() => {})
    }
  },
)

onBeforeUnmount(() => clearTimeout(searchTimer))
</script>

<style scoped>
.palette-results {
  max-height: min(60vh, 520px);
  overflow-y: auto;
}

kbd {
  background-color: rgba(var(--v-theme-on-surface), 0.1);
  border-radius: 4px;
  padding: 1px 5px;
  font-family: monospace;
  font-size: 0.9em;
}
</style>
