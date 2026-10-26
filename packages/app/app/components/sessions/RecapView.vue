<!-- eslint-disable vue/no-v-html -->
<template>
  <div>
    <ClientOnly v-if="recap">
      <MdPreview
        :model-value="recap"
        :language="currentLocale"
        :theme="editorTheme"
        :sanitize="sanitizeHtml"
        :editor-id="editorId"
        preview-only
        class="recap-preview"
        style="height: auto"
        @click="handleClick"
      />
    </ClientOnly>
    <div v-else-if="!files.length" class="text-body-medium text-disabled">
      {{ $t('recaps.empty') }}
    </div>

    <SessionsRecapFileList v-if="files.length" :files="files" :class="recap ? 'mt-3' : ''" />

    <SharedEntityPreviewDialog
      v-model="showEntityPreview"
      :entity-type="previewEntityType"
      :entity-id="previewEntityId"
    />
  </div>
</template>

<script setup lang="ts">
import { LazyMdPreview as MdPreview } from '~/utils/mdEditor'
import 'md-editor-v3/lib/preview.css'
import { useTheme } from 'vuetify'
import type { RecapFile } from '~~/types/recaps'

// A session's recap, read-only: the text with entity badges, then the attached notes
withDefaults(defineProps<{ recap: string | null, files?: RecapFile[], editorId: string }>(), { files: () => [] })

type PreviewableEntityType = 'npc' | 'location' | 'item' | 'faction' | 'lore' | 'player'

const { locale } = useI18n()
const theme = useTheme()
const entitiesStore = useEntitiesStore()
const codexStore = useCodexStore()

const currentLocale = computed(() => (locale.value === 'de' ? 'de-DE' : 'en-US'))
const editorTheme = computed<'light' | 'dark'>(() => (theme.global.current.value.dark ? 'dark' : 'light'))

const showEntityPreview = ref(false)
const previewEntityId = ref<number | null>(null)
const previewEntityType = ref<PreviewableEntityType>('npc')

const ENTITY_STYLE: Record<string, { icon: string, color: string }> = {
  npc: { icon: 'mdi-account', color: '#D4A574' },
  location: { icon: 'mdi-map-marker', color: '#8B7355' },
  item: { icon: 'mdi-sword', color: '#CC8844' },
  faction: { icon: 'mdi-shield', color: '#7B92AB' },
  lore: { icon: 'mdi-book-open-variant', color: '#9C6B98' },
  player: { icon: 'mdi-account-star', color: '#4CAF50' },
}

function entityName(type: string, id: number): string {
  const lists: Record<string, Array<{ id: number, name: string }> | undefined> = {
    npc: entitiesStore.npcs,
    location: entitiesStore.locations,
    item: entitiesStore.items,
    faction: entitiesStore.factions,
    lore: entitiesStore.lore,
    player: entitiesStore.players,
  }
  return lists[type]?.find(e => e.id === id)?.name || `#${id}`
}

function sanitizeHtml(html: string): string {
  const badge = (type: string, id: string) => {
    const style = ENTITY_STYLE[type] ?? { icon: 'mdi-link', color: '#888888' }
    const entityId = Number.parseInt(id, 10)
    let label = escapeHtml(entityName(type, entityId))
    if (type === 'player') {
      const humanName = entitiesStore.players?.find(e => e.id === entityId)?.metadata?.player_name
      label = humanName ? `${escapeHtml(humanName)} <span style="font-size: 0.75rem; opacity: 0.8;">(${label})</span>` : `<em>${label}</em>`
    }
    return `<span class="entity-badge" data-type="${type}" data-id="${id}" style="background-color: ${style.color}; color: white; padding: 2px 8px; border-radius: 12px; font-size: 0.875rem; display: inline-flex; align-items: center; gap: 4px; cursor: pointer;"><i class="mdi ${style.icon}"></i>${label}</span>`
  }

  // Heading ids built from "### Heading {{npc:1}}" would otherwise contain a badge
  let result = html.replace(/(<h[1-6][^>]*id=")([^"]*)(">)/g, (_m, prefix, id, suffix) =>
    prefix + id.replace(/\{\{\w+:\d+\}\}/g, '').replace(/--+/g, '-').replace(/-$/g, '') + suffix)
  result = result.replace(/\{\{(\w+):(\d+)\}\}/g, (_m, type, id) => badge(type, id))
  result = result.replace(/<a[^>]*href="(\w+):(\d+)"[^>]*>([^<]+)<\/a>/g, (_m, type, id) => badge(type, id))
  return renderCodexChips(result, uid => codexStore.names[uid])
}

function handleClick(event: MouseEvent) {
  const badge = (event.target as HTMLElement).closest('.entity-badge')
  const type = badge?.getAttribute('data-type')
  const id = badge?.getAttribute('data-id')
  if (!badge || !type || !id || !(type in ENTITY_STYLE)) return
  event.preventDefault()
  event.stopPropagation()
  previewEntityId.value = Number.parseInt(id, 10)
  previewEntityType.value = type as PreviewableEntityType
  showEntityPreview.value = true
}
</script>

<style scoped>
.recap-preview {
  background: transparent;
  overflow-wrap: anywhere;
}
</style>
