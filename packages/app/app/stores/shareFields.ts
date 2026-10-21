import { defineStore } from 'pinia'
import type { ShareType } from '~~/types/share'

interface ShareFieldsState {
  /** Fields each share type offers (from the server) */
  shareKinds: Partial<Record<ShareType, string[]>>
  /** The DM's remembered ticks per share type */
  shareDefaults: Partial<Record<ShareType, string[]>>
}

// Which fields of an NPC, location, item ... can go into a player handout
export const useShareFieldsStore = defineStore('shareFields', {
  state: (): ShareFieldsState => ({
    shareKinds: {},
    shareDefaults: {},
  }),

  actions: {
    /** Fields per share type - fetched once */
    async ensureShareKinds() {
      if (Object.keys(this.shareKinds).length) return
      const [kinds, defaults] = await Promise.all([
        $fetch<Partial<Record<ShareType, string[]>>>('/api/game-table/share-kinds'),
        $fetch<Partial<Record<ShareType, string[]>>>('/api/game-table/share-defaults'),
      ])
      this.shareKinds = kinds
      this.shareDefaults = defaults
    },
  },
})
