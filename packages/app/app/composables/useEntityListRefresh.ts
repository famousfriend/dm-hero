import type { CopyableEntityType } from '~~/types/entity-template'

/** Reloads the list a new or copied entry shows up in */
export function useEntityListRefresh() {
  const entitiesStore = useEntitiesStore()
  const campaignStore = useCampaignStore()
  const loaders: Record<CopyableEntityType, (campaignId: number) => Promise<unknown>> = {
    npc: id => entitiesStore.fetchNPCs(id, true),
    item: id => entitiesStore.fetchItems(id, true),
    faction: id => entitiesStore.fetchFactions(id, true),
    lore: id => entitiesStore.fetchLore(id, true),
    location: id => entitiesStore.fetchLocations(id, true),
  }
  return async (type: CopyableEntityType) => {
    const campaignId = campaignStore.activeCampaignIdNumber
    if (campaignId) await loaders[type](campaignId)
  }
}
