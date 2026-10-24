<template>
  <v-dialog v-model="open" max-width="560">
    <v-card :title="character ? 'Edit character' : 'New character'">
      <v-card-text>
        <v-text-field v-model="form.name" label="Name" autofocus :rules="[v => !!v?.trim() || 'Name is required']" />
        <v-row dense>
          <v-col cols="8">
            <v-text-field v-model="form.classLabel" label="Class" placeholder="e.g. Monk or Fighter 3 / Wizard 2" />
          </v-col>
          <v-col cols="4">
            <v-text-field v-model.number="form.level" label="Level" type="number" min="1" max="20" />
          </v-col>
          <v-col cols="6">
            <v-text-field v-model="form.race" label="Species / race" />
          </v-col>
          <v-col cols="6">
            <v-text-field v-model="form.background" label="Background" />
          </v-col>
          <v-col cols="4">
            <v-text-field v-model.number="form.hpMax" label="Max HP" type="number" min="0" />
          </v-col>
          <v-col cols="4">
            <v-text-field v-model.number="form.ac" label="AC" type="number" min="0" />
          </v-col>
          <v-col cols="4">
            <v-text-field v-model.number="form.speed" label="Speed (ft)" type="number" min="0" />
          </v-col>
        </v-row>
        <v-select
          v-model="form.campaignId"
          :items="campaignItems"
          label="Campaign"
          hint="Optional. Add campaigns on the Campaigns page."
          persistent-hint
        />
        <v-alert v-if="error" type="error" variant="tonal" density="compact" class="mt-3">{{ error }}</v-alert>
      </v-card-text>
      <v-card-actions>
        <v-spacer />
        <v-btn variant="text" @click="open = false">Cancel</v-btn>
        <v-btn color="primary" variant="flat" :loading="saving" :disabled="!form.name.trim()" @click="save">
          {{ character ? 'Save' : 'Create' }}
        </v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>

<script setup lang="ts">
import type { PlayerCharacter } from '@dmcc/character-core'

const open = defineModel<boolean>({ required: true })
const props = defineProps<{ character: PlayerCharacter | null }>()

const { campaigns, createCharacter, updateCharacter, setActive } = useCharacters()
const campaignItems = computed(() => [
  { title: 'No campaign', value: null },
  ...campaigns.value.map(c => ({ title: c.name, value: c.id })),
])

const blank = () => ({ name: '', classLabel: '', level: 1, race: '', background: '', hpMax: 0, ac: 10, speed: 30, campaignId: null as number | null })
const form = ref(blank())
const saving = ref(false)
const error = ref('')

watch(open, (isOpen) => {
  if (!isOpen) return
  error.value = ''
  if (!props.character) {
    form.value = blank()
    return
  }
  const sheet = sheetOf(props.character)
  form.value = {
    name: sheet.name,
    classLabel: sheet.classLabel,
    level: sheet.level,
    race: sheet.race,
    background: sheet.background,
    hpMax: sheet.hpMax,
    ac: sheet.ac,
    speed: sheet.speed,
    campaignId: props.character.campaignId,
  }
})

const num = (value: unknown, fallback: number) => (Number.isFinite(Number(value)) && value !== '' ? Number(value) : fallback)

async function save() {
  saving.value = true
  error.value = ''
  const { campaignId, ...rest } = form.value
  const values = {
    ...rest,
    name: rest.name.trim(),
    classLabel: rest.classLabel.trim(),
    race: rest.race.trim(),
    background: rest.background.trim(),
    level: Math.min(20, Math.max(1, num(rest.level, 1))),
    hpMax: Math.max(0, num(rest.hpMax, 0)),
    ac: Math.max(0, num(rest.ac, 10)),
    speed: Math.max(0, num(rest.speed, 30)),
  }
  try {
    if (props.character) {
      // Raising max HP on a fresh character also fills current HP
      const sheet = sheetOf(props.character)
      const hpCurrent = sheet.hpCurrent === sheet.hpMax ? values.hpMax : Math.min(sheet.hpCurrent, values.hpMax)
      await updateCharacter(props.character.id, { ...values, hpCurrent }, campaignId)
    }
    else {
      const created = await createCharacter({ ...values, hpCurrent: values.hpMax }, campaignId)
      await setActive(created.id)
    }
    open.value = false
  }
  catch (e) {
    error.value = (e as { data?: { message?: string } }).data?.message ?? 'Could not save the character.'
  }
  finally {
    saving.value = false
  }
}
</script>
