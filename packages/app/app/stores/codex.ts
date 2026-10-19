import { defineStore } from 'pinia'
import type { CodexEntry } from '~~/types/codex'

interface CodexUsage {
  ownerType: 'session' | 'document'
  ownerId: number
  title: string
  entityId?: number
  entityType?: string
}

/** Reference Codex sidebar: which entry is open, its history and "used in" list. */
export const useCodexStore = defineStore('codex', {
  state: () => ({
    isOpen: false,
    history: [] as string[],
    entry: null as CodexEntry | null,
    usages: [] as CodexUsage[],
    loading: false,
    notFound: false,
    // uid -> real name, so chips show "Will-o'-Wisp" once an entry was seen
    names: {} as Record<string, string>,
  }),

  getters: {
    currentUid: state => state.history[state.history.length - 1] ?? null,
    canGoBack: state => state.history.length > 1,
  },

  actions: {
    async open(uid: string) {
      if (this.currentUid !== uid) this.history.push(uid)
      this.isOpen = true
      await this.load(uid)
    },

    async back() {
      if (this.history.length < 2) return
      this.history.pop()
      await this.load(this.currentUid!)
    },

    close() {
      this.isOpen = false
      this.history = []
      this.entry = null
      this.usages = []
    },

    async load(uid: string) {
      this.loading = true
      this.notFound = false
      try {
        this.entry = await $fetch<CodexEntry>('/api/codex/entry', { query: { uid } })
        this.names[uid] = this.entry.name
      }
      catch {
        this.entry = null
        this.notFound = true
      }
      try {
        const campaignId = useCampaignStore().activeCampaignIdNumber
        this.usages = campaignId
          ? await $fetch<CodexUsage[]>('/api/codex/usages', { query: { uid, campaignId } })
          : []
      }
      catch {
        this.usages = []
      }
      finally {
        this.loading = false
      }
    },
  },
})
