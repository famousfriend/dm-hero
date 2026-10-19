import type { LinkedEntity } from '~~/types/quests'

const TYPE_ICONS: Record<string, string> = {
  NPC: 'mdi-account',
  Location: 'mdi-map-marker',
  Item: 'mdi-sword',
  Faction: 'mdi-shield',
  Lore: 'mdi-book-open-variant',
  Player: 'mdi-account-star',
  Quest: 'mdi-script-text',
}

/** NPCs, places, items ... of the active campaign, for quest and continuity pickers. */
export function useLinkableEntities() {
  const campaignStore = useCampaignStore()
  const { t } = useI18n()
  const entities = ref<LinkedEntity[]>([])

  async function load() {
    const campaignId = campaignStore.activeCampaignIdNumber
    entities.value = campaignId
      ? await $fetch<LinkedEntity[]>('/api/quests/linkable', { query: { campaignId } }).catch(() => [])
      : []
  }

  const typeIcon = (type: string) => TYPE_ICONS[type] ?? 'mdi-link-variant'
  const typeLabel = (type: string) => {
    const key = `entityTypes.${type}`
    const label = t(key)
    return label === key ? type : label
  }

  return { entities, load, typeIcon, typeLabel }
}
