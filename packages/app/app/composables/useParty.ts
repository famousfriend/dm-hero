import type { PartyMember } from '~~/types/party'

/**
 * Party members of the active campaign with D&D Beyond refresh and manual edits.
 * Shared by the Party page and the Live Session page.
 */
export function useParty() {
  const { t } = useI18n()
  const campaignStore = useCampaignStore()
  const snackbar = useSnackbarStore()

  const campaignId = computed(() => campaignStore.activeCampaignIdNumber)
  const members = ref<PartyMember[]>([])
  const loading = ref(false)
  const refreshing = ref(false)
  const hasLinked = computed(() => members.value.some(m => m.ddbCharacterId))

  async function load() {
    if (!campaignId.value) return
    loading.value = true
    try {
      members.value = await $fetch<PartyMember[]>('/api/party', { query: { campaignId: campaignId.value } })
    }
    finally {
      loading.value = false
    }
  }

  async function refreshAll(force = false) {
    if (!campaignId.value || refreshing.value) return
    refreshing.value = true
    try {
      if (force) {
        for (const member of members.value.filter(m => m.ddbCharacterId)) {
          replaceMember(await $fetch<PartyMember>(`/api/party/${member.entityId}/refresh`, { method: 'POST' }))
        }
      }
      else {
        members.value = await $fetch<PartyMember[]>('/api/party/refresh', {
          method: 'POST',
          query: { campaignId: campaignId.value },
        })
      }
    }
    catch {
      snackbar.error(t('party.refreshFailed'))
    }
    finally {
      refreshing.value = false
    }
  }

  async function refreshOne(member: PartyMember) {
    replaceMember(await $fetch<PartyMember>(`/api/party/${member.entityId}/refresh`, { method: 'POST' }))
  }

  async function updateManual(member: PartyMember, manual: Record<string, unknown>) {
    try {
      replaceMember(await $fetch<PartyMember>(`/api/party/${member.entityId}`, { method: 'PATCH', body: { manual } }))
    }
    catch {
      snackbar.error(t('party.saveFailed'))
    }
  }

  // Listeners (e.g. the open edit dialog) follow updates through this hook
  const onReplace: Array<(member: PartyMember) => void> = []

  function replaceMember(updated: PartyMember) {
    const index = members.value.findIndex(m => m.entityId === updated.entityId)
    if (index >= 0) members.value[index] = updated
    for (const fn of onReplace) fn(updated)
  }

  /** Loads, then refreshes linked sheets once */
  async function loadAndRefresh() {
    await load()
    if (hasLinked.value) refreshAll()
  }

  // Auto-refresh only while the page using this is open and the window is visible
  let refreshTimer: ReturnType<typeof setInterval> | undefined
  function scheduleRefresh(seconds: number) {
    clearInterval(refreshTimer)
    if (seconds > 0) {
      refreshTimer = setInterval(() => {
        if (document.visibilityState === 'visible' && hasLinked.value) refreshAll()
      }, seconds * 1000)
    }
  }

  watch(campaignId, () => {
    members.value = []
    loadAndRefresh()
  })
  onBeforeUnmount(() => clearInterval(refreshTimer))

  return {
    campaignId,
    members,
    loading,
    refreshing,
    hasLinked,
    load,
    loadAndRefresh,
    refreshAll,
    refreshOne,
    updateManual,
    replaceMember,
    onReplace,
    scheduleRefresh,
  }
}
