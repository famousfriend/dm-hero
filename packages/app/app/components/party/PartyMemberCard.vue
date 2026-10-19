<template>
  <v-card class="party-card h-100 d-flex flex-column" variant="outlined">
    <v-card-item>
      <template #prepend>
        <v-icon
          :icon="stats.inspiration ? 'mdi-star' : 'mdi-star-outline'"
          :color="stats.inspiration ? 'amber' : undefined"
          :title="$t('party.inspiration')"
          class="cursor-pointer"
          @click="setManual({ inspiration: !stats.inspiration })"
        />
      </template>
      <v-card-title class="text-title-large">
        {{ stats.name }}
        <v-icon v-if="isManual('name')" size="x-small" class="ml-1" :title="$t('party.manualValue')">mdi-pencil</v-icon>
      </v-card-title>
      <v-card-subtitle>
        {{ subtitle }}
      </v-card-subtitle>
      <template #append>
        <v-icon :icon="sync.icon" :color="sync.color" size="small" :title="sync.title" class="mr-1" />
        <v-menu>
          <template #activator="{ props: menuProps }">
            <v-btn icon="mdi-dots-vertical" variant="text" size="small" v-bind="menuProps" />
          </template>
          <v-list density="compact">
            <v-list-item prepend-icon="mdi-pencil" :title="$t('party.edit')" @click="emit('edit', member)" />
            <v-list-item
              v-if="member.ddbCharacterId"
              prepend-icon="mdi-refresh"
              :title="$t('party.refreshNow')"
              @click="emit('refresh', member)"
            />
            <v-list-item
              v-if="member.ddbCharacterId"
              prepend-icon="mdi-open-in-new"
              :title="$t('party.openSheet')"
              @click="openExternalUrl(ddbSheetUrl(member.ddbCharacterId))"
            />
            <v-list-item
              v-if="hasManual && member.ddb"
              prepend-icon="mdi-cloud-download-outline"
              :title="$t('party.useDdbValues')"
              @click="revertAll"
            />
          </v-list>
        </v-menu>
      </template>
    </v-card-item>

    <v-card-text class="flex-grow-1 pt-0">
      <!-- Hit points -->
      <div class="d-flex align-end ga-2 mb-1">
        <span class="text-headline-medium font-weight-bold" :class="hpTextClass">{{ stats.hpCurrent }}</span>
        <span class="text-title-medium text-medium-emphasis">/ {{ stats.hpMax }}</span>
        <v-chip v-if="stats.hpTemp" size="small" color="info" variant="tonal">
          +{{ stats.hpTemp }} {{ $t('party.temp') }}
        </v-chip>
        <v-icon
          v-if="isManual('hpCurrent') || isManual('hpTemp') || isManual('hpMax')"
          size="x-small"
          :title="manualHpTitle"
        >
          mdi-pencil
        </v-icon>
        <v-spacer />
        <span class="text-caption text-medium-emphasis" :title="explain('hpMax')">{{ $t('party.hp') }}</span>
      </div>
      <v-progress-linear :model-value="hpPercent" :color="hpColor" height="8" rounded class="mb-2" />
      <div class="d-flex align-center ga-1 mb-3">
        <v-btn size="small" variant="tonal" color="error" icon="mdi-minus" :title="$t('party.damage')" @click="changeHp(-1)" />
        <v-text-field
          v-model.number="hpAmount"
          type="number"
          min="1"
          density="compact"
          variant="outlined"
          hide-details
          class="hp-amount"
          @keydown.enter="changeHp(-1)"
        />
        <v-btn size="small" variant="tonal" color="success" icon="mdi-plus" :title="$t('party.heal')" @click="changeHp(1)" />
      </div>

      <!-- Core numbers -->
      <div class="d-flex flex-wrap ga-2 mb-3">
        <v-chip
          v-for="stat in coreStats"
          :key="stat.field"
          size="small"
          variant="tonal"
          :title="stat.title"
        >
          <strong class="mr-1">{{ stat.label }}</strong> {{ stat.value }}
          <v-icon v-if="isManual(stat.field)" end size="x-small">mdi-pencil</v-icon>
        </v-chip>
      </div>

      <!-- Conditions -->
      <div v-if="stats.conditions.length" class="d-flex flex-wrap ga-1 mb-3">
        <v-chip
          v-for="condition in stats.conditions"
          :key="condition"
          size="small"
          color="warning"
          variant="flat"
          closable
          @click:close="removeCondition(condition)"
        >
          {{ condition }}
        </v-chip>
      </div>

      <!-- Death saves (only when down) -->
      <div v-if="stats.hpCurrent === 0 && stats.hpMax > 0" class="mb-3">
        <div class="text-caption text-medium-emphasis mb-1">{{ $t('party.deathSaves') }}</div>
        <div class="d-flex align-center ga-3">
          <span class="d-flex align-center ga-1">
            <v-icon
              v-for="n in 3"
              :key="`s${n}`"
              size="small"
              color="success"
              class="cursor-pointer"
              :icon="n <= stats.deathSaveSuccesses ? 'mdi-circle' : 'mdi-circle-outline'"
              @click="setManual({ deathSaveSuccesses: n === stats.deathSaveSuccesses ? n - 1 : n })"
            />
          </span>
          <span class="d-flex align-center ga-1">
            <v-icon
              v-for="n in 3"
              :key="`f${n}`"
              size="small"
              color="error"
              class="cursor-pointer"
              :icon="n <= stats.deathSaveFailures ? 'mdi-close-circle' : 'mdi-circle-outline'"
              @click="setManual({ deathSaveFailures: n === stats.deathSaveFailures ? n - 1 : n })"
            />
          </span>
        </div>
      </div>

      <!-- Spell slots: click a dot to mark it used/free -->
      <div v-if="stats.spellSlots.length">
        <div class="text-caption text-medium-emphasis mb-1" :title="explain('spellSlots')">
          {{ $t('party.spellSlots') }}
          <v-icon v-if="isManual('spellSlots')" size="x-small">mdi-pencil</v-icon>
        </div>
        <div class="d-flex flex-wrap ga-3">
          <span v-for="slot in stats.spellSlots" :key="slot.level" class="d-flex align-center ga-1">
            <span class="text-caption mr-1">{{ slot.level }}</span>
            <v-icon
              v-for="n in slot.max"
              :key="n"
              size="x-small"
              class="cursor-pointer"
              color="primary"
              :icon="n <= slot.max - slot.used ? 'mdi-circle' : 'mdi-circle-outline'"
              @click="toggleSlot(slot.level, n)"
            />
          </span>
        </div>
      </div>
    </v-card-text>

    <v-card-actions class="text-caption text-medium-emphasis px-4">
      <span v-if="member.ddbError" class="text-warning d-flex align-center ga-1" :title="member.ddbError">
        <v-icon size="x-small">mdi-alert</v-icon>
        {{ member.ddbFetchedAt ? $t('party.ddbUnreachable', { time: fetchedAgo }) : $t('party.ddbNeverLoaded') }}
      </span>
      <span v-else-if="member.ddbFetchedAt">{{ $t('party.updated', { time: fetchedAgo }) }}</span>
      <span v-else-if="member.ddbCharacterId">{{ $t('party.notSyncedYet') }}</span>
      <span v-else>{{ $t('party.manualOnly') }}</span>
    </v-card-actions>
  </v-card>
</template>

<script setup lang="ts">
import { applyHpChange, ddbSheetUrl, type PartyField, type PartyMember, type PartyStats } from '~~/types/party'

const props = defineProps<{
  member: PartyMember
  /** Re-renders "x min ago" */
  now: number
}>()

const emit = defineEmits<{
  'edit': [member: PartyMember]
  'refresh': [member: PartyMember]
  'update-manual': [member: PartyMember, manual: Record<string, unknown>]
}>()

const { t } = useI18n()
const { openExternalUrl } = useElectron()

const hpAmount = ref<number | null>(null)
const stats = computed(() => props.member.effective)
const hasManual = computed(() => Object.keys(props.member.manual).length > 0)

const subtitle = computed(() => {
  const parts = [stats.value.classLabel || null, props.member.playerName ? t('party.playedBy', { name: props.member.playerName }) : null]
  return parts.filter(Boolean).join(' · ')
})

function isManual(field: PartyField): boolean {
  return props.member.manual[field] !== undefined
}

function explain(field: PartyField): string | undefined {
  if (isManual(field)) {
    const ddbValue = props.member.ddb?.[field]
    return ddbValue !== undefined && ddbValue !== null
      ? t('party.manualOverDdb', { value: JSON.stringify(ddbValue) })
      : t('party.manualValue')
  }
  return props.member.ddbExplain[field]
}

const manualHpTitle = computed(() =>
  props.member.ddb
    ? t('party.manualOverDdb', { value: `${props.member.ddb.hpCurrent} / ${props.member.ddb.hpMax} (+${props.member.ddb.hpTemp})` })
    : t('party.manualValue'),
)

const coreStats = computed(() =>
  (
    [
      ['ac', t('party.ac'), stats.value.ac],
      ['passivePerception', t('party.passivePerceptionShort'), stats.value.passivePerception],
      ['passiveInsight', t('party.passiveInsightShort'), stats.value.passiveInsight],
      ['passiveInvestigation', t('party.passiveInvestigationShort'), stats.value.passiveInvestigation],
      ['spellSaveDc', t('party.spellSaveDcShort'), stats.value.spellSaveDc],
    ] as Array<[PartyField, string, number | null]>
  )
    .filter(([field, , value]) => value !== null || isManual(field))
    .map(([field, label, value]) => ({
      field,
      label,
      value,
      title: [t(`party.fields.${field}`), explain(field)].filter(Boolean).join(': '),
    })),
)

const hpPercent = computed(() => (stats.value.hpMax > 0 ? (stats.value.hpCurrent / stats.value.hpMax) * 100 : 0))
const hpColor = computed(() => (hpPercent.value > 50 ? 'success' : hpPercent.value > 25 ? 'warning' : 'error'))
const hpTextClass = computed(() => (stats.value.hpCurrent === 0 && stats.value.hpMax > 0 ? 'text-error' : ''))

const fetchedAgo = computed(() => {
  if (!props.member.ddbFetchedAt) return t('party.never')
  // SQLite CURRENT_TIMESTAMP is UTC without a zone marker
  const seconds = Math.max(0, Math.round((props.now - Date.parse(`${props.member.ddbFetchedAt.replace(' ', 'T')}Z`)) / 1000))
  if (seconds < 60) return t('party.justNow')
  if (seconds < 3600) return t('party.minutesAgo', { n: Math.floor(seconds / 60) })
  return t('party.hoursAgo', { n: Math.floor(seconds / 3600) })
})

const sync = computed(() => {
  if (!props.member.ddbCharacterId) return { icon: 'mdi-account-edit', color: undefined, title: t('party.manualOnly') }
  if (props.member.ddbError) return { icon: 'mdi-cloud-alert', color: 'warning', title: props.member.ddbError }
  return { icon: 'mdi-cloud-check', color: 'success', title: t('party.linked') }
})

function setManual(manual: Partial<PartyStats>) {
  emit('update-manual', props.member, manual)
}

function changeHp(direction: 1 | -1) {
  const amount = Math.abs(Math.trunc(Number(hpAmount.value) || 0))
  if (!amount) return
  setManual(applyHpChange(stats.value, direction * amount))
  hpAmount.value = null
}

function removeCondition(condition: string) {
  setManual({ conditions: stats.value.conditions.filter(c => c !== condition) })
}

// Dots show free slots first; clicking the n-th dot makes exactly n slots free (or n-1 if it was the last free one)
function toggleSlot(level: number, n: number) {
  const slots = stats.value.spellSlots.map(s => ({ ...s }))
  const slot = slots.find(s => s.level === level)
  if (!slot) return
  const free = slot.max - slot.used
  const newFree = n === free ? n - 1 : n
  slot.used = slot.max - newFree
  setManual({ spellSlots: slots })
}

function revertAll() {
  const manual: Record<string, null> = {}
  for (const key of Object.keys(props.member.manual)) manual[key] = null
  emit('update-manual', props.member, manual)
}
</script>

<style scoped>
.hp-amount {
  max-width: 90px;
}
</style>
