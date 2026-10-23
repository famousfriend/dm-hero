<template>
  <!-- Typed-in character numbers for a new player (no D&D Beyond sheet) -->
  <v-card variant="outlined" class="mb-4 pa-3">
    <div class="d-flex align-center mb-1">
      <v-icon class="mr-2" color="primary">mdi-sword-cross</v-icon>
      <span class="text-title-small">{{ $t('players.manual.title') }}</span>
    </div>
    <p class="text-body-medium text-medium-emphasis mb-3">{{ $t('players.manual.intro') }}</p>

    <v-row dense>
      <v-col cols="12" sm="8">
        <v-text-field
          v-model="character.classLabel"
          :label="$t('players.manual.classLabel')"
          :placeholder="$t('players.manual.classPlaceholder')"
          variant="outlined"
          density="comfortable"
        />
      </v-col>
      <v-col cols="12" sm="4">
        <v-text-field v-model.number="character.level" :label="$t('players.manual.level')" type="number" min="1" max="20" variant="outlined" density="comfortable" />
      </v-col>
      <v-col cols="6" sm="3">
        <v-text-field v-model.number="character.hpMax" :label="$t('players.manual.hpMax')" type="number" min="0" variant="outlined" density="comfortable" />
      </v-col>
      <v-col cols="6" sm="3">
        <v-text-field v-model.number="character.ac" :label="$t('players.manual.ac')" type="number" min="0" variant="outlined" density="comfortable" />
      </v-col>
      <v-col cols="6" sm="3">
        <v-text-field v-model.number="character.speed" :label="$t('players.manual.speed')" type="number" min="0" step="5" variant="outlined" density="comfortable" />
      </v-col>
      <v-col cols="6" sm="3">
        <v-text-field v-model.number="character.passivePerception" :label="$t('players.manual.passivePerception')" type="number" min="0" variant="outlined" density="comfortable" />
      </v-col>
    </v-row>

    <div class="text-body-small text-medium-emphasis mb-1">{{ $t('players.manual.abilities') }}</div>
    <v-row dense>
      <v-col v-for="ability in ABILITIES" :key="ability" cols="4" sm="2">
        <v-text-field
          v-model.number="character.scores[ability]"
          :label="$t(`statPresets.dnd5e.${ability}`)"
          :hint="modifierText(character.scores[ability])"
          persistent-hint
          type="number"
          min="1"
          max="30"
          variant="outlined"
          density="comfortable"
        />
      </v-col>
    </v-row>
  </v-card>
</template>

<script setup lang="ts">
import { ABILITIES, type ManualCharacter } from './manual-character'

const character = defineModel<ManualCharacter>({ required: true })

function modifierText(score: number | '' | undefined): string {
  if (typeof score !== 'number' || !Number.isFinite(score)) return ' '
  const mod = Math.floor((score - 10) / 2)
  return mod >= 0 ? `+${mod}` : String(mod)
}
</script>
