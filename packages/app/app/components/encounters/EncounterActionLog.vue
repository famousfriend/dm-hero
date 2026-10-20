<template>
  <v-card variant="outlined">
    <v-card-title class="d-flex align-center ga-2 text-title-medium">
      <v-icon size="20">mdi-history</v-icon>
      {{ $t('encounters.log.title') }}
      <v-spacer />
      <v-btn
        size="small"
        variant="tonal"
        prepend-icon="mdi-undo"
        :disabled="!canUndo || undoing"
        :loading="undoing"
        @click="onUndo"
      >
        {{ $t('encounters.log.undo') }}
      </v-btn>
    </v-card-title>
    <v-card-text class="action-log pt-0">
      <div v-if="!entries.length" class="text-body-small text-medium-emphasis">{{ $t('encounters.log.empty') }}</div>
      <div
        v-for="entry in entries"
        :key="entry.id"
        class="action-log__entry d-flex align-start ga-2 py-1"
        :class="{ 'action-log__entry--undone': entry.undone }"
      >
        <v-icon size="16" :color="entry.undone ? undefined : kindColor(entry)" class="mt-1">{{ kindIcon(entry) }}</v-icon>
        <div class="text-body-small flex-grow-1">
          <span class="text-medium-emphasis">{{ $t('encounters.round') }} {{ entry.round }} · </span>
          {{ describe(entry) }}
          <span class="text-medium-emphasis"> → {{ entry.after.current_hp }}/{{ entry.after.max_hp }}</span>
          <span v-if="entry.undone" class="text-medium-emphasis"> ({{ $t('encounters.log.undone') }})</span>
        </div>
      </div>
    </v-card-text>
  </v-card>
</template>

<script setup lang="ts">
import type { EncounterLogEntry, LoggedState } from '~~/types/encounter'

const props = defineProps<{
  encounterId: number
  entries: EncounterLogEntry[]
}>()

const { t } = useI18n()
const encounterStore = useEncounterStore()
const snackbarStore = useSnackbarStore()

const undoing = ref(false)
const canUndo = computed(() => props.entries.some(e => !e.undone))

async function onUndo() {
  const entry = props.entries.find(e => !e.undone)
  if (!entry) return
  undoing.value = true
  const ok = await encounterStore.undoLastAction(props.encounterId)
  undoing.value = false
  if (ok) snackbarStore.success(t('encounters.log.undoneSnack', { action: describe(entry) }))
  else snackbarStore.error(t('encounters.actionFailed'))
}

const FIELD_LABELS: Record<keyof LoggedState, string> = {
  current_hp: 'encounters.hp',
  max_hp: 'encounters.log.maxHp',
  temp_hp: 'encounters.tempHp',
  armor_class: 'party.ac',
  is_ko: 'encounters.ko',
  death_save_successes: 'encounters.deathSaves.successes',
  death_save_failures: 'encounters.deathSaves.failures',
}

/** One readable sentence per entry, e.g. "Goblin (2) took 5 damage (3 absorbed by temp HP)" */
function describe(entry: EncounterLogEntry): string {
  const name = entry.participantName
  const amount = entry.amount ?? 0
  const d = entry.details as Record<string, unknown>
  const extras: string[] = []
  let text: string

  switch (entry.kind) {
    case 'damage':
      text = t('encounters.log.damage', { name, amount })
      if (d.absorbed) extras.push(t('encounters.log.absorbed', { n: d.absorbed as number }))
      if (d.whileDown) extras.push(t('encounters.log.whileDown'))
      if (d.massive) extras.push(t('encounters.log.massive'))
      else if (d.down) extras.push(t('encounters.log.down'))
      break
    case 'heal':
      text = t('encounters.log.heal', { name, amount })
      if (d.revived) extras.push(t('encounters.log.revived'))
      break
    case 'tempHp':
      text = t('encounters.log.tempHp', { name, amount })
      if (d.kept) extras.push(t('encounters.log.kept', { n: d.kept as number }))
      break
    case 'deathSave':
      text = t(`encounters.log.deathSave.${d.result as string}`, { name })
      break
    default: {
      const changes = (Object.keys(FIELD_LABELS) as Array<keyof LoggedState>)
        .filter(f => entry.before[f] !== entry.after[f])
        .filter(f => !(entry.after.is_ko === false && entry.before.is_ko && f.startsWith('death_save')))
        .map((f) => {
          const label = t(FIELD_LABELS[f])
          if (f === 'is_ko') return entry.after.is_ko ? t('encounters.log.koOn') : t('encounters.log.koOff')
          return `${label} ${entry.before[f] ?? '–'} → ${entry.after[f] ?? '–'}`
        })
      text = t('encounters.log.set', { name, changes: changes.join(', ') })
    }
  }
  if (d.stable) extras.push(t('encounters.log.stable'))
  if (d.dead) extras.push(t('encounters.log.dead'))
  return extras.length ? `${text} (${extras.join(', ')})` : text
}

function kindIcon(entry: EncounterLogEntry) {
  switch (entry.kind) {
    case 'damage': return 'mdi-sword'
    case 'heal': return 'mdi-heart'
    case 'tempHp': return 'mdi-shield-plus'
    case 'deathSave': return 'mdi-dice-d20'
    default: return 'mdi-pencil'
  }
}

function kindColor(entry: EncounterLogEntry) {
  switch (entry.kind) {
    case 'damage': return 'error'
    case 'heal': return 'success'
    case 'tempHp': return 'info'
    case 'deathSave': return 'warning'
    default: return undefined
  }
}
</script>

<style scoped>
.action-log {
  max-height: 260px;
  overflow-y: auto;
}

.action-log__entry--undone {
  text-decoration: line-through;
  opacity: 0.55;
}
</style>
