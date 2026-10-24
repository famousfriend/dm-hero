<template>
  <div>
    <v-card v-if="loaded && !activeSheet" class="mx-auto mt-8 text-center pa-8" max-width="520" border>
      <v-icon size="64" color="primary" class="mb-4">mdi-shield-account-outline</v-icon>
      <h1 class="text-h5 mb-2">Welcome to the Player Companion</h1>
      <p class="text-medium-emphasis mb-6">Create your character by hand, or paste the link to your public D&amp;D Beyond sheet.</p>
      <v-btn color="primary" variant="flat" size="large" prepend-icon="mdi-account-plus" @click="formOpen = true">
        Create a character
      </v-btn>
    </v-card>

    <template v-else-if="activeSheet && active">
      <v-card border class="mb-4">
        <v-card-item>
          <template #prepend>
            <v-avatar size="72" color="primary">
              <span class="text-h4">{{ (activeSheet.name[0] ?? '?').toUpperCase() }}</span>
            </v-avatar>
          </template>
          <v-card-title class="text-h5 text-wrap">{{ activeSheet.name }}</v-card-title>
          <v-card-subtitle class="text-wrap">
            {{ classLine(activeSheet) }}
            <template v-if="activeSheet.race"> · {{ activeSheet.race }}</template>
            <template v-if="activeSheet.background"> · {{ activeSheet.background }}</template>
          </v-card-subtitle>
          <div class="text-body-2 text-medium-emphasis mt-1">
            <v-icon size="small" class="mr-1">mdi-map-legend</v-icon>
            {{ campaign ? campaign.name : 'No campaign' }}<template v-if="campaign?.dmName"> · DM {{ campaign.dmName }}</template>
          </div>
          <template #append>
            <v-btn variant="text" prepend-icon="mdi-pencil" @click="formOpen = true">Edit</v-btn>
          </template>
        </v-card-item>
      </v-card>

      <v-row>
        <v-col v-for="stat in stats" :key="stat.label" cols="6" md="3">
          <v-card border class="stat-tile text-center py-4">
            <v-icon :color="stat.color" size="28">{{ stat.icon }}</v-icon>
            <div class="stat-value">{{ stat.value }}</div>
            <div class="text-caption text-medium-emphasis text-uppercase">{{ stat.label }}</div>
          </v-card>
        </v-col>
      </v-row>

      <v-card border class="mt-4">
        <v-card-item>
          <v-card-title class="text-subtitle-1">
            <v-icon size="small" class="mr-1">mdi-script-text-outline</v-icon>
            Current quests
          </v-card-title>
          <template #append>
            <v-btn variant="text" size="small" to="/journal">Journal</v-btn>
          </template>
        </v-card-item>
        <v-list v-if="currentQuests.length" density="compact" bg-color="transparent">
          <v-list-item v-for="quest in currentQuests" :key="quest.id" to="/journal">
            <v-list-item-title class="text-wrap">{{ quest.name }}</v-list-item-title>
            <v-list-item-subtitle v-if="quest.reward" class="text-wrap">{{ quest.reward }}</v-list-item-subtitle>
            <template #append>
              <v-chip v-if="quest.status === 'active'" size="x-small" color="primary" variant="flat">Active</v-chip>
            </template>
          </v-list-item>
        </v-list>
        <v-card-text v-else class="text-medium-emphasis">No quests yet. Your DM can send them with a player pack (Import from DM, top right).</v-card-text>
      </v-card>

      <v-card border class="mt-4">
        <v-card-item>
          <v-card-title class="text-subtitle-1">
            <v-icon size="small" class="mr-1">mdi-notebook-outline</v-icon>
            Recent notes
          </v-card-title>
          <template #append>
            <v-btn variant="text" size="small" to="/notes">All notes</v-btn>
          </template>
        </v-card-item>
        <v-list v-if="notes.length" density="compact" bg-color="transparent">
          <v-list-item v-for="note in notes.slice(0, 3)" :key="note.id" to="/notes">
            <v-list-item-title class="text-wrap">{{ note.title || note.body.trim().split('\n')[0] || 'Untitled' }}</v-list-item-title>
            <template #append>
              <v-icon size="small">{{ note.visibility === 'party' ? 'mdi-account-group' : 'mdi-lock' }}</v-icon>
            </template>
          </v-list-item>
        </v-list>
        <v-card-text v-else class="text-medium-emphasis">No notes yet.</v-card-text>
      </v-card>
    </template>

    <CharacterFormDialog v-model="formOpen" :character="activeSheet ? active : null" />
  </div>
</template>

<script setup lang="ts">
const { active, activeSheet, loaded, campaignOf } = useCharacters()
const { notes, quests } = useJournal()
const currentQuests = computed(() => quests.value.filter(q => q.status === 'active' || q.status === 'open').slice(0, 5))
const formOpen = ref(false)
const campaign = computed(() => campaignOf(active.value))

const signed = (n: number) => (n >= 0 ? `+${n}` : `${n}`)
const stats = computed(() => {
  const s = activeSheet.value
  if (!s) return []
  return [
    { label: 'Hit points', value: s.hpTemp ? `${s.hpCurrent} / ${s.hpMax} (+${s.hpTemp})` : `${s.hpCurrent} / ${s.hpMax}`, icon: 'mdi-heart', color: 'error' },
    { label: 'Armor class', value: s.ac, icon: 'mdi-shield', color: 'info' },
    { label: 'Initiative', value: signed(s.initiative), icon: 'mdi-lightning-bolt', color: 'warning' },
    { label: 'Speed', value: `${s.speed} ft`, icon: 'mdi-run-fast', color: 'success' },
  ]
})
</script>

<style scoped>
.stat-tile {
  transition: border-color 0.15s ease;
}

.stat-tile:hover {
  border-color: rgb(var(--v-theme-primary)) !important;
}

.stat-value {
  font-size: 1.75rem;
  font-weight: 600;
  line-height: 1.3;
}
</style>
