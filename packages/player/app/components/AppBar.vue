<template>
  <v-app-bar border class="app-bar-draggable">
    <v-app-bar-title>
      <img src="/logo-small.png" alt="" class="app-logo mr-2" />
      DM CC <span class="text-primary">Player Companion</span>
      <v-chip size="x-small" variant="outlined" class="ml-2">v{{ version }}</v-chip>
    </v-app-bar-title>

    <v-spacer />

    <v-btn
      variant="text"
      prepend-icon="mdi-file-download-outline"
      class="mr-2 import-btn"
      :disabled="activeId === null"
      @click="importOpen = true"
    >
      Import from DM
    </v-btn>
    <PackImportDialog v-model="importOpen" />

    <!-- Active character: always visible, one click to switch -->
    <v-menu location="bottom end">
      <template #activator="{ props: menuProps }">
        <v-btn v-bind="menuProps" variant="tonal" color="primary" class="mr-3 character-switcher">
          <v-avatar size="28" color="primary" variant="flat" class="mr-2">
            <span class="text-caption font-weight-bold">{{ initial(activeSheet?.name) }}</span>
          </v-avatar>
          <span class="switcher-text">
            <span class="switcher-name">{{ activeSheet?.name || 'No character' }}</span>
            <span v-if="activeSheet" class="switcher-sub">
              {{ classLine(activeSheet) }}<template v-if="activeCampaign"> · {{ activeCampaign.name }}</template>
            </span>
          </span>
          <v-icon end>mdi-chevron-down</v-icon>
        </v-btn>
      </template>
      <v-list density="compact" min-width="260">
        <v-list-item
          v-for="character in characters"
          :key="character.id"
          :active="character.id === activeId"
          :title="sheetOf(character).name"
          :subtitle="subtitle(character)"
          @click="setActive(character.id)"
        >
          <template #prepend>
            <v-avatar size="28" color="secondary" class="mr-2">
              <span class="text-caption">{{ initial(sheetOf(character).name) }}</span>
            </v-avatar>
          </template>
        </v-list-item>
        <v-divider v-if="characters.length" class="my-1" />
        <v-list-item prepend-icon="mdi-account-plus-outline" title="Manage characters" to="/characters" />
      </v-list>
    </v-menu>
  </v-app-bar>
</template>

<script setup lang="ts">
import type { PlayerCharacter } from '@dmcc/character-core'

interface WindowControlsOverlay extends EventTarget {
  visible: boolean
  getTitlebarAreaRect(): DOMRect
  ongeometrychange: ((ev: Event & { titlebarAreaRect: DOMRect }) => void) | null
}

const version = useRuntimeConfig().public.appVersion
const { characters, activeId, activeSheet, active, campaignOf, setActive } = useCharacters()
const activeCampaign = computed(() => campaignOf(active.value))
const importOpen = ref(false)

const initial = (name?: string) => (name?.trim()[0] ?? '?').toUpperCase()

function subtitle(character: PlayerCharacter) {
  const campaign = campaignOf(character)
  const line = classLine(sheetOf(character))
  return campaign ? `${line} · ${campaign.name}` : line
}

// Windows draws its own window buttons over the right of the app bar; keep clear of them
const windowControlsRightEdge = ref('100%')
if (import.meta.client) {
  const overlay = (navigator as Navigator & { windowControlsOverlay?: WindowControlsOverlay }).windowControlsOverlay
  if (overlay?.visible) {
    const rect = overlay.getTitlebarAreaRect()
    windowControlsRightEdge.value = `${rect.x + rect.width}px`
  }
  if (overlay) {
    overlay.ongeometrychange = (e) => {
      windowControlsRightEdge.value = `${e.titlebarAreaRect.x + e.titlebarAreaRect.width}px`
    }
  }
}
</script>

<style scoped>
.app-logo {
  width: 28px;
  height: 28px;
  border-radius: 6px;
  vertical-align: middle;
}

.import-btn {
  text-transform: none;
  letter-spacing: normal;
}

.character-switcher {
  height: 44px !important;
  text-transform: none;
  letter-spacing: normal;
}

.switcher-text {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  line-height: 1.15;
  max-width: 260px;
}

.switcher-name {
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 100%;
}

.switcher-sub {
  font-size: 0.75rem;
  opacity: 0.75;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 100%;
}

/* Electron: the bar drags the window; buttons stay clickable */
.app-bar-draggable {
  -webkit-app-region: drag;
  padding-right: calc(100% - v-bind(windowControlsRightEdge));
}

.app-bar-draggable :deep(button),
.app-bar-draggable :deep(.v-btn),
.app-bar-draggable :deep(.v-chip) {
  -webkit-app-region: no-drag;
}
</style>
