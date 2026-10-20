<template>
  <div>
    <v-text-field
      v-model="draft"
      :placeholder="$t('live.notePlaceholder')"
      density="compact"
      variant="outlined"
      hide-details
      append-inner-icon="mdi-plus"
      class="mb-2"
      @keydown.enter="add"
      @click:append-inner="add"
    />
    <div v-if="!notesStore.pendingNotes.length" class="text-body-medium text-medium-emphasis">{{ $t('live.noNotes') }}</div>
    <div v-for="note in notesStore.pendingNotes" :key="note.id" class="d-flex align-start ga-1">
      <v-checkbox-btn density="compact" :title="$t('live.noteDone')" @update:model-value="notesStore.toggleCompleted(note.id)" />
      <span class="text-body-medium pt-2 note-text">{{ note.content }}</span>
    </div>
  </div>
</template>

<script setup lang="ts">
// The campaign's DM notes (same list as the Notes page), quick to add and tick off
const campaignStore = useCampaignStore()
const notesStore = useNotesStore()
const draft = ref('')

async function add() {
  const campaignId = campaignStore.activeCampaignIdNumber
  const content = draft.value.trim()
  if (!campaignId || !content) return
  if (await notesStore.addNote(campaignId, content)) draft.value = ''
}

watch(
  () => campaignStore.activeCampaignIdNumber,
  (id) => {
    if (id) notesStore.fetchNotes(id)
  },
  { immediate: true },
)
</script>

<style scoped>
.note-text {
  white-space: pre-line;
  word-break: break-word;
}
</style>
