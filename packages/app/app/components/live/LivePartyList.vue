<template>
  <div>
    <v-progress-linear v-if="loading && !members.length" indeterminate />
    <div v-else-if="!members.length" class="text-body-medium text-medium-emphasis">
      {{ $t('party.empty') }}
    </div>
    <div v-for="member in members" :key="member.entityId" class="party-row py-2">
      <div class="d-flex align-center ga-2">
        <span class="text-body-large font-weight-medium text-truncate flex-grow-1 member-name" @click="emit('edit', member)">
          {{ member.effective.name }}
          <v-icon v-if="member.effective.inspiration" size="x-small" color="warning" :title="$t('party.fields.inspiration')">mdi-star</v-icon>
          <v-icon v-if="member.ddbError" size="x-small" color="error" :title="member.ddbError">mdi-cloud-alert</v-icon>
        </span>
        <v-chip size="x-small" variant="tonal" prepend-icon="mdi-shield-outline" :title="$t('party.fields.ac')">
          {{ member.effective.ac }}
        </v-chip>
        <v-chip size="x-small" variant="tonal" prepend-icon="mdi-eye-outline" :title="$t('party.fields.passivePerception')">
          {{ member.effective.passivePerception }}
        </v-chip>
      </div>
      <div class="d-flex align-center ga-2 mt-1">
        <v-progress-linear
          :model-value="hpPercent(member)"
          :color="hpColor(member)"
          height="14"
          rounded
          class="flex-grow-1"
        >
          <span class="text-caption font-weight-bold">
            {{ member.effective.hpCurrent }}/{{ member.effective.hpMax }}<template v-if="member.effective.hpTemp"> +{{ member.effective.hpTemp }}</template>
          </span>
        </v-progress-linear>
        <v-text-field
          v-model="hpInput[member.entityId]"
          :placeholder="$t('live.hpPlaceholder')"
          :title="$t('live.hpHint')"
          density="compact"
          variant="outlined"
          hide-details
          single-line
          class="hp-input"
          @keydown.enter="applyHp(member)"
        />
      </div>
      <div v-if="member.effective.conditions.length || isDown(member)" class="d-flex flex-wrap ga-1 mt-1">
        <v-chip v-if="isDown(member)" size="x-small" color="error" variant="flat" prepend-icon="mdi-skull-outline">
          {{ $t('live.deathSaves', { ok: member.effective.deathSaveSuccesses, fail: member.effective.deathSaveFailures }) }}
        </v-chip>
        <v-chip v-for="condition in member.effective.conditions" :key="condition" size="x-small" color="warning" variant="tonal">
          {{ condition }}
        </v-chip>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { applyHpChange, type PartyMember } from '~~/types/party'

defineProps<{
  members: PartyMember[]
  loading: boolean
}>()

const emit = defineEmits<{
  'edit': [member: PartyMember]
  'update-manual': [member: PartyMember, manual: Record<string, unknown>]
}>()

const hpInput = reactive<Record<number, string>>({})

const hpPercent = (m: PartyMember) => (m.effective.hpMax > 0 ? (100 * m.effective.hpCurrent) / m.effective.hpMax : 0)
const isDown = (m: PartyMember) => m.effective.hpMax > 0 && m.effective.hpCurrent === 0
function hpColor(m: PartyMember) {
  const pct = hpPercent(m)
  return pct > 50 ? 'success' : pct > 25 ? 'warning' : 'error'
}

/** "-7" deals 7 damage (temp HP first), "+5" or "5" heals 5 */
function applyHp(member: PartyMember) {
  const text = (hpInput[member.entityId] ?? '').trim()
  const amount = Number.parseInt(text, 10)
  if (!text || Number.isNaN(amount) || amount === 0) return
  emit('update-manual', member, applyHpChange(member.effective, amount))
  hpInput[member.entityId] = ''
}
</script>

<style scoped>
.party-row + .party-row {
  border-top: 1px solid rgba(var(--v-border-color), var(--v-border-opacity));
}

.member-name {
  cursor: pointer;
}

.hp-input {
  max-width: 92px;
}
</style>
