import { defineStore } from 'pinia'
import type { CodexEntry } from '~~/types/codex'

interface CodexUsage {
  ownerType: 'session' | 'document' | 'entity' | 'encounter'
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

    /** Removes the open bookmark from search; links to it keep their name. */
    async deleteBookmark() {
      const uid = this.currentUid
      if (!uid) return
      await $fetch('/api/codex/bookmarks', { method: 'DELETE', query: { uid } })
      this.close()
    },

    /** Removes the open homebrew entry from search; links to it keep their name. */
    async deleteHomebrew() {
      const uid = this.currentUid
      if (!uid) return
      await $fetch('/api/codex/homebrew', { method: 'DELETE', query: { uid } })
      this.close()
    },

    /** Back to the original text for the active campaign. */
    async resetCampaignEdit() {
      const uid = this.currentUid
      const campaignId = useCampaignStore().activeCampaignIdNumber
      if (!uid || !campaignId) return
      this.showEdited(await $fetch<CodexEntry>('/api/codex/campaign-edit', { method: 'DELETE', query: { uid, campaignId } }))
    },

    /** Shows an entry just saved from the edit dialog. */
    showEdited(entry: CodexEntry) {
      if (entry.uid !== this.currentUid) return
      this.entry = entry
      this.names[entry.uid] = entry.name
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
      const campaignId = useCampaignStore().activeCampaignIdNumber
      try {
        // With the active campaign's own edits, if any
        this.entry = await $fetch<CodexEntry>('/api/codex/entry', { query: { uid, campaignId: campaignId ?? undefined } })
        this.names[uid] = this.entry.name
      }
      catch {
        this.entry = null
        this.notFound = true
      }
      try {
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
