<template>
  <!-- Non-modal reference panel. Teleported above dialogs (session notes are edited
       in one) so it can be read next to whatever is open. -->
  <Teleport to="body">
    <v-slide-x-reverse-transition>
      <v-card v-if="codex.isOpen" class="codex-sidebar d-flex flex-column" elevation="16" rounded="0">
        <div class="d-flex align-center pa-2 flex-shrink-0">
          <v-btn
            icon="mdi-arrow-left"
            variant="text"
            size="small"
            :disabled="!codex.canGoBack"
            :title="$t('codex.back')"
            @click="codex.back()"
          />
          <v-icon class="mx-1" size="small">mdi-book-open-page-variant</v-icon>
          <span class="text-body-large font-weight-medium text-truncate flex-grow-1">
            {{ codex.entry?.name || $t('codex.title') }}
          </span>
          <v-btn icon="mdi-close" variant="text" size="small" :title="$t('common.close')" @click="codex.close()" />
        </div>
        <v-divider />

        <div class="flex-grow-1 overflow-y-auto pa-4">
          <v-progress-linear v-if="codex.loading && !codex.entry" indeterminate />

          <template v-else-if="codex.entry">
            <div class="d-flex flex-wrap ga-2 mb-3">
              <v-chip size="small" variant="tonal">{{ kindLabel(codex.entry.kind) }}</v-chip>
              <v-chip size="small" variant="outlined">{{ codex.entry.sourceCode.toUpperCase() }}</v-chip>
            </div>
            <ClientOnly>
              <MdPreview
                v-if="codex.entry.body"
                id="codex-sidebar-preview"
                :model-value="codex.entry.body"
                :theme="editorTheme"
                class="codex-body"
              />
            </ClientOnly>
          </template>

          <v-alert v-else-if="codex.notFound" type="info" variant="tonal" density="compact">
            {{ $t('codex.notFound', { uid: codex.currentUid }) }}
          </v-alert>

          <template v-if="codex.usages.length">
            <v-divider class="my-4" />
            <div class="text-body-medium font-weight-medium mb-1">{{ $t('codex.usedIn') }}</div>
            <v-list density="compact" class="py-0">
              <v-list-item
                v-for="usage in codex.usages"
                :key="`${usage.ownerType}-${usage.ownerId}`"
                :prepend-icon="usage.ownerType === 'session' ? 'mdi-calendar' : 'mdi-file-document-outline'"
                :title="usage.title"
              />
            </v-list>
          </template>
        </div>

        <v-divider />
        <div class="pa-3 flex-shrink-0">
          <v-btn
            v-if="externalUrl"
            block
            variant="tonal"
            prepend-icon="mdi-open-in-new"
            class="mb-2"
            @click="openExternalUrl(externalUrl)"
          >
            {{ $t('codex.openExternal') }}
          </v-btn>
          <div v-if="codex.entry?.license" class="text-caption text-medium-emphasis">
            {{ codex.entry.sourceTitle }} · {{ codex.entry.license }}
            <span v-if="codex.entry.attribution" :title="codex.entry.attribution">ⓘ</span>
          </div>
        </div>
      </v-card>
    </v-slide-x-reverse-transition>
  </Teleport>
</template>

<script setup lang="ts">
import { MdPreview } from 'md-editor-v3'
import { useTheme } from 'vuetify'
import { externalUrl as buildExternalUrl } from '~~/types/codex'

const codex = useCodexStore()
const { t } = useI18n()
const theme = useTheme()
const { openExternalUrl } = useElectron()

const editorTheme = computed<'light' | 'dark'>(() => (theme.global.current.value.dark ? 'dark' : 'light'))

// Also offered when the entry is not in the local dataset (e.g. a PHB-only spell)
const externalUrl = computed(() =>
  codex.entry?.externalUrl ?? (codex.currentUid ? buildExternalUrl(codex.currentUid) : null),
)

function kindLabel(kind: string): string {
  const key = `codex.kinds.${kind}`
  const label = t(key)
  return label === key ? kind : label
}

// Chips are plain HTML produced by renderCodexChips(), so clicks are handled
// here once instead of in every markdown view.
function onDocumentClick(event: MouseEvent) {
  const chip = (event.target as HTMLElement | null)?.closest?.('.codex-chip')
  const uid = chip?.getAttribute('data-uid')
  if (!uid) return
  event.preventDefault()
  event.stopPropagation()
  codex.open(uid)
}

// Esc closes the panel before it reaches an open dialog underneath
function onKeydown(event: KeyboardEvent) {
  const inPopup = (event.target as HTMLElement | null)?.closest?.('.quick-search-card')
  if (event.key === 'Escape' && codex.isOpen && !inPopup) {
    event.stopImmediatePropagation()
    codex.close()
  }
}

onMounted(() => {
  document.addEventListener('click', onDocumentClick, true)
  window.addEventListener('keydown', onKeydown, true)
})
onBeforeUnmount(() => {
  document.removeEventListener('click', onDocumentClick, true)
  window.removeEventListener('keydown', onKeydown, true)
})
</script>

<style scoped>
.codex-sidebar {
  position: fixed;
  top: 0;
  right: 0;
  bottom: 0;
  width: min(420px, 100vw);
  z-index: 3000;
}

.codex-body :deep(.md-editor-preview-wrapper) {
  padding: 0;
}
</style>
