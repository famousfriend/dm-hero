<template>
  <v-app>
    <ClientOnly>
      <NavigationDrawer
        v-model="drawer"
        v-model:rail="rail"
        :has-active-campaign="hasActiveCampaign"
        :active-campaign-name="activeCampaignName"
        :is-search-active="showSearch"
        @search-click="showSearch = true"
      />
    </ClientOnly>

    <AppBar
      :current-locale="currentLocale"
      @change-locale="changeLocale"
      @search-click="showSearch = true"
    />

    <!-- Per-theme ambience (embers, fireflies, ...) behind every page, under the content;
         self-gates on theme + the Playfulness setting -->
    <ClientOnly>
      <SharedDashboardAmbient />
    </ClientOnly>

    <v-main class="main-no-scroll">
      <div class="content-scrollable">
        <v-container fluid>
          <NuxtPage />
        </v-container>
      </div>
    </v-main>

    <!-- Reference Codex panel: opened by clicking a reference chip in any note -->
    <ClientOnly>
      <CodexSidebar />
    </ClientOnly>

    <!-- Ctrl+K command palette (also "/" and the search buttons) -->
    <ClientOnly>
      <CommandPalette v-model="showSearch" />
    </ClientOnly>

    <!-- Global Snackbar -->
    <v-snackbar
      v-model="snackbarStore.show"
      :color="snackbarStore.color"
      :timeout="snackbarStore.timeout"
      location="top"
    >
      {{ snackbarStore.message }}
      <template v-if="snackbarStore.persistent" #actions>
        <v-btn variant="text" @click="snackbarStore.hide()">
          {{ $t('common.close') }}
        </v-btn>
      </template>
    </v-snackbar>

    <!-- Global music player – lives here so playback survives navigation.
         Full bar on /music, floating mini player everywhere else. -->
    <ClientOnly>
      <MusicPlayerBar />
      <MusicMiniPlayer v-if="route.path !== '/music'" />
    </ClientOnly>
  </v-app>
</template>

<script setup lang="ts">
import { useLocale } from 'vuetify'
import { isAppLocale, toVuetifyLocale, type AppLocale } from '~~/types/locale'
import NavigationDrawer from '~/components/layout/NavigationDrawer.vue'
import AppBar from '~/components/layout/AppBar.vue'
import CommandPalette from '~/components/layout/CommandPalette.vue'

const vuetifyLocale = useLocale()
const { locale, setLocale } = useI18n()
const drawer = ref(true)
const rail = ref(false)
const showSearch = ref(false)
const entitiesStore = useEntitiesStore()

// Stores
const campaignStore = useCampaignStore()
const snackbarStore = useSnackbarStore()
const notesStore = useNotesStore()

// Active campaign from store (not cookie - store is the source of truth)
const activeCampaignName = computed(() => campaignStore.currentCampaign?.name || null)
const musicPlayer = useMusicPlayer()
const route = useRoute()
const hasActiveCampaign = computed(() => campaignStore.hasActiveCampaign)

// Language
const currentLocale = computed(() => locale.value)
const localeCookie = useCookie<AppLocale>('locale', {
  maxAge: 60 * 60 * 24 * 365, // 1 year
})

// Sync Vuetify locale with i18n locale fox
watch(
  locale,
  (newLocale) => {
    vuetifyLocale.current.value = toVuetifyLocale(newLocale as AppLocale)
  },
  { immediate: true },
)

// Initialize campaign and locale from cookie on mount
onMounted(() => {
  campaignStore.initFromCookie()
  // Restore the music library so the player is ready on every page (dashboard scenes, sessions)
  musicPlayer.init()

  // Initialize locale from cookie
  if (isAppLocale(localeCookie.value)) {
    setLocale(localeCookie.value)
  }
})

// Load notes when campaign changes (for badge in drawer)
// Only run on client to avoid SSR hydration issues with loading state
if (import.meta.client) {
  watch(
    () => campaignStore.activeCampaignId,
    (newId) => {
      if (newId) {
        notesStore.fetchNotes(Number(newId))
      }
      else {
        notesStore.clearNotes()
      }
    },
    { immediate: true },
  )
}

function changeLocale(newLocale: string) {
  if (isAppLocale(newLocale)) {
    setLocale(newLocale)
    localeCookie.value = newLocale
  }
}

// Watch for AI/MCP bulk-imports: poll the import signal and, when it advances,
// show a snackbar and refresh the loaded lists + card counts ONCE. This fires
// only for external (AI) imports — the app's own create endpoints never touch
// the signal — so manual user creation does not trigger a reload.
if (import.meta.client) {
  const foldersStore = useFoldersStore()
  const { t } = useI18n()
  let lastSeq = -1

  const handleAiImport = async (action: 'import' | 'update', campaignId: number | null, total: number) => {
    const active = campaignStore.activeCampaignIdNumber
    const here = !!campaignId && active === campaignId
    const key = `aiImport.${action === 'update' ? 'updated' : 'imported'}${here ? '' : 'Other'}`
    if (here) {
      snackbarStore.success(t(key, { count: total }))
      await entitiesStore.refetchLoaded(active!)
      await foldersStore.refetchLoaded()
    }
    else {
      snackbarStore.info(t(key, { count: total }))
    }
  }

  const pollImportSignal = async () => {
    // Nothing to show while the window is minimised or hidden
    if (document.hidden) return
    try {
      const sig = await $fetch<{ seq: number, action: 'import' | 'update' | null, campaignId: number | null, total: number }>(
        '/api/import/status',
      )
      // First poll establishes the baseline so we don't react to imports that
      // happened before the app was opened.
      if (lastSeq === -1) {
        lastSeq = sig.seq
        return
      }
      if (sig.seq > lastSeq) {
        lastSeq = sig.seq
        await handleAiImport(sig.action ?? 'import', sig.campaignId, sig.total)
      }
    }
    catch {
      // server not reachable yet / transient — try again next tick
    }
  }

  let timer: ReturnType<typeof setInterval> | undefined
  onMounted(() => {
    pollImportSignal()
    timer = setInterval(pollImportSignal, 5000)
  })
  onUnmounted(() => {
    if (timer) clearInterval(timer)
  })
}

// Keyboard Shortcuts
onMounted(() => {
  const handleKeydown = (e: KeyboardEvent) => {
    // Check if user is typing in an input field
    const target = e.target as HTMLElement
    const isTyping
      = target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable

    // Ctrl+K / Cmd+K toggles the command palette, even while typing
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
      e.preventDefault()
      showSearch.value = !showSearch.value
      return
    }
    // "/" öffnet Suche (nur wenn NICHT in Eingabefeld)
    if (e.key === '/' && !showSearch.value && !isTyping) {
      e.preventDefault()
      showSearch.value = true
    }
    // ESC schließt Suche
    if (e.key === 'Escape' && showSearch.value) {
      showSearch.value = false
    }
  }

  window.addEventListener('keydown', handleKeydown)
  onUnmounted(() => {
    window.removeEventListener('keydown', handleKeydown)
  })
})
</script>

<style>
/* Prevent body/html scrolling */
html {
  overflow: hidden !important;
}

.v-application {
  height: 100vh;
  overflow: hidden;
}

/* v-main should not scroll itself; it sits above the fixed ambience layer (z-index 0) */
.main-no-scroll {
  position: relative;
  z-index: 1;
  overflow: hidden !important;
  /* 64px = AppBar height; --v-layout-bottom = music player bar when visible */
  height: calc(100vh - 64px - var(--v-layout-bottom, 0px));
}

/* Inner container scrolls - scrollbar starts below AppBar */
.content-scrollable {
  height: 100%;
  overflow-y: auto;
  overflow-x: hidden;
}

/* Long words and names wrap instead of running out of their box */
body {
  overflow-wrap: break-word;
}
</style>
