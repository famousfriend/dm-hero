<template>
  <div>
    <div class="d-flex align-center ga-2 mb-2">
      <span class="text-body-medium font-weight-medium">{{ $t('encounters.resources.title') }}</span>
      <v-spacer />
      <v-btn size="small" variant="tonal" prepend-icon="mdi-plus" @click="showAdd = !showAdd">
        {{ $t('encounters.resources.add') }}
      </v-btn>
    </div>

    <!-- Add an ability by hand -->
    <div v-if="showAdd" class="d-flex align-center ga-2 mb-2 flex-wrap">
      <v-text-field
        v-model="newName"
        :label="$t('encounters.resources.name')"
        density="compact"
        variant="outlined"
        hide-details
        style="max-width: 180px;"
        @keydown.enter="onAdd"
      />
      <v-select
        v-model="newKind"
        :items="kinds"
        density="compact"
        variant="outlined"
        hide-details
        style="max-width: 190px;"
      />
      <v-text-field
        v-model.number="newNumber"
        type="number"
        :label="newKind === 'recharge' ? $t('encounters.resources.rechargeOn') : $t('encounters.resources.uses')"
        density="compact"
        variant="outlined"
        hide-details
        :min="newKind === 'recharge' ? 2 : 1"
        :max="newKind === 'recharge' ? 6 : 99"
        style="max-width: 110px;"
      />
      <v-btn icon="mdi-check" size="small" color="primary" variant="tonal" :disabled="!newName.trim()" @click="onAdd" />
    </div>

    <div v-if="!resources.length" class="text-body-small text-medium-emphasis">{{ $t('encounters.resources.none') }}</div>

    <div
      v-for="r in resources"
      :key="r.id"
      class="resource-row d-flex align-center ga-2 py-1 flex-wrap"
      :class="{ 'resource-row--spent': r.used >= r.max_uses }"
    >
      <v-icon size="18" :color="kindColor(r.kind)">{{ kindIcon(r.kind) }}</v-icon>
      <span class="text-body-medium resource-row__name">{{ r.name }}</span>
      <span class="text-body-small text-medium-emphasis">{{ kindLabel(r) }}</span>

      <!-- Uses left as pips -->
      <div v-if="r.kind !== 'recharge'" class="d-flex align-center" :title="$t('encounters.resources.left', { n: r.max_uses - r.used, max: r.max_uses })">
        <v-icon v-for="n in Math.min(r.max_uses, 10)" :key="n" size="14" :color="kindColor(r.kind)">
          {{ n <= r.max_uses - r.used ? 'mdi-circle' : 'mdi-circle-outline' }}
        </v-icon>
        <span v-if="r.max_uses > 10" class="text-body-small ml-1">{{ r.max_uses - r.used }}/{{ r.max_uses }}</span>
      </div>
      <v-chip v-else size="x-small" :color="r.used ? 'default' : 'success'" variant="tonal">
        {{ r.used ? $t('encounters.resources.spent') : $t('encounters.resources.ready') }}
      </v-chip>

      <v-spacer />

      <v-btn size="small" variant="tonal" :disabled="r.used >= r.max_uses" @click="setUsed(r, r.used + 1)">
        {{ $t('encounters.resources.use') }}
      </v-btn>

      <!-- Recharge roll: the app rolls, or the DM enters a physical d6 -->
      <template v-if="r.kind === 'recharge' && r.used">
        <v-menu v-if="physicalDice" location="bottom">
          <template #activator="{ props: menuProps }">
            <v-btn size="small" variant="tonal" color="primary" prepend-icon="mdi-dice-6" v-bind="menuProps">
              {{ $t('encounters.resources.enterD6') }}
            </v-btn>
          </template>
          <v-card class="pa-2 d-flex ga-1">
            <v-btn v-for="n in 6" :key="n" size="small" variant="tonal" min-width="36" @click="onRecharge(r, n)">{{ n }}</v-btn>
          </v-card>
        </v-menu>
        <v-btn v-else size="small" variant="tonal" color="primary" prepend-icon="mdi-dice-6" @click="onRecharge(r, Math.floor(Math.random() * 6) + 1)">
          {{ $t('encounters.resources.rollRecharge') }}
        </v-btn>
      </template>

      <v-btn
        icon="mdi-restore"
        size="x-small"
        variant="text"
        :disabled="!r.used"
        :title="$t('encounters.resources.restore')"
        @click="setUsed(r, 0)"
      />
      <v-btn icon="mdi-close" size="x-small" variant="text" :title="$t('common.delete')" @click="remove(r)" />
    </div>
  </div>
</template>

<script setup lang="ts">
import type { EncounterParticipant, EncounterResource, EncounterResourceKind } from '~~/types/encounter'
import { isSpellResource } from '~/utils/statBlock'

const props = defineProps<{
  encounterId: number
  participant: EncounterParticipant
}>()

const { t } = useI18n()
const encounterStore = useEncounterStore()
const snackbarStore = useSnackbarStore()
const physicalDice = usePhysicalDice()

// Spell slots and X/day spells are shown by the spell picker instead
const resources = computed(() => (props.participant.resources ?? []).filter(r => !isSpellResource(r.name)))

const showAdd = ref(false)
const newName = ref('')
const newKind = ref<EncounterResourceKind>('uses')
const newNumber = ref<number>(3)

const kinds = computed(() => [
  { title: t('encounters.resources.kinds.uses'), value: 'uses' },
  { title: t('encounters.resources.kinds.recharge'), value: 'recharge' },
  { title: t('encounters.resources.kinds.legendary'), value: 'legendary' },
])

// Sensible numbers when switching kind: Recharge 5-6, 3 legendary actions
watch(newKind, (kind) => {
  newNumber.value = kind === 'recharge' ? 5 : 3
})

async function send(op: Parameters<typeof encounterStore.updateResource>[2]) {
  const ok = await encounterStore.updateResource(props.encounterId, props.participant.id, op)
  if (!ok) snackbarStore.error(t('encounters.actionFailed'))
  return ok
}

async function onAdd() {
  const name = newName.value.trim()
  if (!name) return
  const n = Math.trunc(Number(newNumber.value))
  const ok = await send(
    newKind.value === 'recharge'
      ? { op: 'add', name, kind: 'recharge', recharge_min: n }
      : { op: 'add', name, kind: newKind.value, max_uses: n },
  )
  if (ok) {
    newName.value = ''
    showAdd.value = false
  }
}

const setUsed = (r: EncounterResource, used: number) => send({ op: 'set', id: r.id, used })
const remove = (r: EncounterResource) => send({ op: 'remove', id: r.id })

async function onRecharge(r: EncounterResource, roll: number) {
  const recharged = rechargeSucceeds(roll, r.recharge_min)
  if (recharged) await setUsed(r, 0)
  const key = recharged ? 'encounters.resources.recharged' : 'encounters.resources.notRecharged'
  snackbarStore.info(t(key, { name: r.name, roll }))
}

function kindLabel(r: EncounterResource) {
  if (r.kind === 'recharge') {
    const min = r.recharge_min ?? 6
    return t('encounters.resources.rechargeRange', { range: min >= 6 ? '6' : `${min}–6` })
  }
  return t(`encounters.resources.kinds.${r.kind}`)
}

function kindIcon(kind: EncounterResourceKind) {
  if (kind === 'recharge') return 'mdi-battery-charging'
  if (kind === 'legendary') return 'mdi-crown'
  return 'mdi-counter'
}

function kindColor(kind: EncounterResourceKind) {
  if (kind === 'recharge') return 'warning'
  if (kind === 'legendary') return 'purple'
  return 'info'
}
</script>

<style scoped>
.resource-row {
  border-bottom: 1px solid rgba(var(--v-border-color), 0.08);
}

.resource-row--spent .resource-row__name {
  text-decoration: line-through;
  opacity: 0.6;
}
</style>
