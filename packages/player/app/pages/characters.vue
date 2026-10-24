<template>
  <div>
    <div class="d-flex align-center mb-4">
      <h1 class="text-h5">Characters</h1>
      <v-spacer />
      <v-btn color="primary" variant="flat" prepend-icon="mdi-account-plus" @click="edit(null)">New character</v-btn>
    </div>

    <v-alert v-if="loaded && !characters.length" type="info" variant="tonal">
      No characters yet. Create your first one to get started.
    </v-alert>

    <v-row>
      <v-col v-for="character in characters" :key="character.id" cols="12" sm="6" lg="4">
        <v-card
          class="character-card"
          :class="{ 'is-active': character.id === activeId }"
          border
          @click="setActive(character.id)"
        >
          <v-card-item>
            <template #prepend>
              <v-avatar size="48" color="primary">
                <span class="text-h6">{{ (sheetOf(character).name[0] ?? '?').toUpperCase() }}</span>
              </v-avatar>
            </template>
            <v-card-title class="text-wrap">{{ sheetOf(character).name }}</v-card-title>
            <v-card-subtitle class="text-wrap">
              {{ classLine(sheetOf(character)) }}<template v-if="sheetOf(character).race"> · {{ sheetOf(character).race }}</template>
            </v-card-subtitle>
            <template #append>
              <v-chip v-if="character.id === activeId" color="primary" size="small" variant="flat">Active</v-chip>
            </template>
          </v-card-item>
          <v-card-text class="pt-0 text-medium-emphasis">
            <v-icon size="small" class="mr-1">mdi-map-legend</v-icon>
            {{ campaignOf(character)?.name ?? 'No campaign' }}
          </v-card-text>
          <v-card-actions>
            <v-spacer />
            <v-btn variant="text" prepend-icon="mdi-pencil" @click.stop="edit(character)">Edit</v-btn>
            <v-btn variant="text" color="error" prepend-icon="mdi-delete" @click.stop="toDelete = character">Delete</v-btn>
          </v-card-actions>
        </v-card>
      </v-col>
    </v-row>

    <CharacterFormDialog v-model="formOpen" :character="editing" />

    <v-dialog :model-value="!!toDelete" max-width="420" @update:model-value="toDelete = null">
      <v-card title="Delete character?">
        <v-card-text>
          {{ toDelete ? sheetOf(toDelete).name : '' }} and everything stored for them will be removed. This cannot be undone.
        </v-card-text>
        <v-card-actions>
          <v-spacer />
          <v-btn variant="text" @click="toDelete = null">Cancel</v-btn>
          <v-btn color="error" variant="flat" @click="confirmDelete">Delete</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>
  </div>
</template>

<script setup lang="ts">
import type { PlayerCharacter } from '@dmcc/character-core'

const { characters, activeId, loaded, campaignOf, setActive, deleteCharacter } = useCharacters()

const formOpen = ref(false)
const editing = ref<PlayerCharacter | null>(null)
const toDelete = ref<PlayerCharacter | null>(null)

function edit(character: PlayerCharacter | null) {
  editing.value = character
  formOpen.value = true
}

async function confirmDelete() {
  if (!toDelete.value) return
  await deleteCharacter(toDelete.value.id)
  toDelete.value = null
}
</script>

<style scoped>
.character-card {
  transition: border-color 0.15s ease, background-color 0.15s ease;
}

.character-card:hover {
  border-color: rgb(var(--v-theme-primary)) !important;
}

.character-card.is-active {
  border-color: rgb(var(--v-theme-primary)) !important;
  background: rgba(var(--v-theme-primary), 0.06);
}
</style>
