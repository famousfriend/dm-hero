<template>
  <div v-if="encounter">
    <!-- Header -->
    <div class="d-flex align-center ga-2 mb-4">
      <v-btn icon="mdi-arrow-left" variant="text" @click="encounterStore.closeEncounter()" />
      <span class="text-headline-medium">{{ encounter.name }}</span>
      <v-chip size="small" :color="statusColor(encounter.status)" variant="tonal">
        {{ $t(`encounters.statuses.${encounter.status}`) }}
      </v-chip>
      <v-spacer />
      <!-- Players' HP and AC from the Party view / D&D Beyond, at any time in the fight -->
      <v-btn
        v-if="hasPlayers && encounter.status !== 'finished'"
        size="small"
        variant="tonal"
        prepend-icon="mdi-cloud-sync"
        :loading="syncing"
        :title="$t('encounters.syncPlayersHint')"
        @click="syncPlayers"
      >
        {{ $t('encounters.syncPlayers') }}
      </v-btn>
      <!-- Round + Turn navigation (combat only) -->
      <template v-if="isCombat">
        <v-chip color="primary" variant="tonal" prepend-icon="mdi-refresh">
          {{ $t('encounters.round') }} {{ encounter.round }}
        </v-chip>
        <v-btn icon="mdi-chevron-left" size="small" variant="tonal" @click="encounterStore.prevTurn()" />
        <v-btn icon="mdi-chevron-right" size="small" variant="tonal" @click="onAdvanceTurn" />
      </template>
    </div>

    <!-- Rules this encounter needs at hand (monsters, spells, conditions) -->
    <div class="d-flex align-center ga-2 mb-4">
      <span class="text-body-medium text-medium-emphasis">{{ $t('codex.linkedReferences') }}:</span>
      <CodexLinksPanel owner-type="encounter" :owner-id="encounter.id" compact class="flex-grow-1" />
    </div>

    <!-- SETUP PHASE: participant list + add -->
    <template v-if="encounter.status === 'setup'">
      <EncountersEncounterSetupList
        :participants="encounterStore.participants"
        @remove="onRemove"
        @update-participant="onUpdate"
      />
      <div class="d-flex ga-2 mt-4">
        <v-btn color="primary" prepend-icon="mdi-plus" @click="showAdd = true">
          {{ $t('encounters.addParticipants') }}
        </v-btn>
        <v-spacer />
        <v-btn
          color="info"
          prepend-icon="mdi-lightning-bolt"
          :disabled="encounterStore.participants.length === 0"
          @click="toInitiative"
        >
          {{ $t('encounters.rollInitiative') }}
        </v-btn>
      </div>
    </template>

    <!-- INITIATIVE PHASE: enter initiative values -->
    <template v-else-if="encounter.status === 'initiative'">
      <EncountersEncounterSetupList
        :participants="encounterStore.participants"
        show-initiative
        @remove="onRemove"
        @update-participant="onUpdate"
      />
      <div class="d-flex ga-2 mt-4">
        <v-btn color="primary" prepend-icon="mdi-plus" @click="showAdd = true">
          {{ $t('encounters.addParticipants') }}
        </v-btn>
        <v-spacer />
        <v-btn
          color="success"
          prepend-icon="mdi-sword-cross"
          :disabled="!allIniSet"
          @click="startCombat"
        >
          {{ $t('encounters.startCombat') }}
        </v-btn>
      </div>
    </template>

    <!-- ACTIVE: the cool combat view -->
    <template v-else-if="encounter.status === 'active'">
      <EncountersEncounterDiceRoller class="mb-3" />
      <EncountersEncounterCombatView
        :participants="encounterStore.participants"
        :current-turn-index="encounter.current_turn_index"
        :encounter-id="encounter.id"
        @update-participant="onUpdate"
        @select-participant="onSelectTile"
        @remove-participant="onRemove"
      />
      <div class="d-flex ga-2 mt-4">
        <v-btn color="primary" prepend-icon="mdi-plus" variant="tonal" @click="showAdd = true">
          {{ $t('encounters.addParticipants') }}
        </v-btn>
        <v-spacer />
        <v-btn color="error" prepend-icon="mdi-stop" @click="showEndDialog = true">
          {{ $t('encounters.endCombat') }}
        </v-btn>
      </div>
      <EncountersEncounterActionLog class="mt-4" :encounter-id="encounter.id" :entries="encounter.log ?? []" />
    </template>

    <!-- FINISHED: read-only summary -->
    <template v-else-if="encounter.status === 'finished'">
      <EncountersEncounterCombatView
        :participants="encounterStore.participants"
        :current-turn-index="-1"
        :encounter-id="encounter.id"
        @update-participant="onUpdate"
      />
      <div class="d-flex justify-end mt-4">
        <v-btn color="primary" prepend-icon="mdi-restart" @click="resetEncounter">
          {{ $t('encounters.restart') }}
        </v-btn>
      </div>
      <EncountersEncounterActionLog v-if="encounter.log?.length" class="mt-4" :encounter-id="encounter.id" :entries="encounter.log" />
    </template>

    <ClientOnly>
      <EncountersEncounterAddParticipantDialog
        v-model="showAdd"
        :encounter-id="encounter.id"
        :existing-participants="encounterStore.participants"
        :require-initiative="isCombat || encounter.status === 'initiative'"
      />
    </ClientOnly>

    <!-- Expired effects dialog -->
    <v-dialog v-model="showExpiredDialog" max-width="400" persistent>
      <v-card>
        <v-card-title class="d-flex align-center">
          <v-icon color="warning" class="mr-2">mdi-timer-off</v-icon>
          {{ $t('encounters.effectsExpired') }}
        </v-card-title>
        <v-card-text>
          <v-list density="compact">
            <v-list-item v-for="name in expiredEffectNames" :key="name">
              <template #prepend>
                <v-icon color="warning" size="small">mdi-close-circle</v-icon>
              </template>
              <v-list-item-title>{{ name }}</v-list-item-title>
            </v-list-item>
          </v-list>
        </v-card-text>
        <v-card-actions>
          <v-spacer />
          <v-btn color="primary" variant="flat" @click="showExpiredDialog = false">
            {{ $t('common.ok') }}
          </v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>

    <!-- End combat confirmation -->
    <v-dialog v-model="showEndDialog" max-width="400">
      <v-card>
        <v-card-title class="d-flex align-center">
          <v-icon color="error" class="mr-2">mdi-alert</v-icon>
          {{ $t('encounters.endCombat') }}
        </v-card-title>
        <v-card-text>{{ $t('encounters.endCombatConfirm') }}</v-card-text>
        <v-card-actions>
          <v-spacer />
          <v-btn variant="text" @click="showEndDialog = false">{{ $t('common.cancel') }}</v-btn>
          <v-btn color="error" variant="flat" @click="endCombat">{{ $t('encounters.endCombat') }}</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>
  </div>
</template>

<script setup lang="ts">
import type { EncounterParticipant } from '~~/types/encounter'
import type { PartyMember } from '~~/types/party'

const { t } = useI18n()
const encounterStore = useEncounterStore()
const snackbarStore = useSnackbarStore()

const showAdd = ref(false)
const showEndDialog = ref(false)
const showExpiredDialog = ref(false)
const expiredEffectNames = ref<string[]>([])
const encounter = computed(() => encounterStore.activeEncounter)
const isCombat = computed(() => encounter.value?.status === 'active')
const allIniSet = computed(() =>
  encounterStore.participants.length > 0
  && encounterStore.participants.every(p => p.initiative != null),
)

const syncing = ref(false)
const hasPlayers = computed(() => encounterStore.participants.some(p => p.entity_type === 'Player' && p.entity_id))

/** Refreshes linked D&D Beyond sheets, then copies each player's HP, temp HP and AC into this fight (logged, undoable) */
async function syncPlayers() {
  if (!encounter.value) return
  syncing.value = true
  try {
    const members = await $fetch<PartyMember[]>('/api/party/refresh', { method: 'POST', query: { campaignId: encounter.value.campaign_id } })
    const byEntity = new Map(members.map(m => [m.entityId, m]))
    let changed = 0
    for (const p of encounterStore.participants) {
      const member = p.entity_type === 'Player' && p.entity_id ? byEntity.get(p.entity_id) : undefined
      if (!member) continue
      const stats = member.effective
      const updates: Partial<EncounterParticipant> = {}
      if (stats.hpMax && stats.hpMax !== p.max_hp) updates.max_hp = stats.hpMax
      if (stats.hpMax && stats.hpCurrent !== p.current_hp) updates.current_hp = stats.hpCurrent
      if (stats.hpTemp !== p.temp_hp) updates.temp_hp = stats.hpTemp
      if (stats.ac && stats.ac !== p.armor_class) updates.armor_class = stats.ac
      if (!Object.keys(updates).length) continue
      if (await encounterStore.updateParticipant(encounter.value.id, p.id, updates)) changed++
    }
    const failed = members.filter(m => m.ddbError && encounterStore.participants.some(p => p.entity_id === m.entityId))
    if (failed.length) snackbarStore.warning(t('encounters.syncPlayersFailed', { names: failed.map(m => m.entityName).join(', ') }))
    else snackbarStore.success(changed ? t('encounters.syncPlayersDone', { n: changed }) : t('encounters.syncPlayersSame'))
  }
  catch {
    snackbarStore.error(t('party.refreshFailed'))
  }
  finally {
    syncing.value = false
  }
}

async function onRemove(id: number) {
  if (!encounter.value) return
  const ok = await encounterStore.removeParticipant(encounter.value.id, id)
  if (ok) snackbarStore.success(t('encounters.participantRemoved'))
}

async function onUpdate(id: number, updates: Partial<EncounterParticipant>) {
  if (!encounter.value) return
  await encounterStore.updateParticipant(encounter.value.id, id, updates)
}

async function toInitiative() {
  await encounterStore.updateEncounterStatus('initiative')
}

async function startCombat() {
  await encounterStore.sortByInitiative()
  const ok = await encounterStore.updateEncounterStatus('active', { round: 1, current_turn_index: 0 })
  if (ok) snackbarStore.success(t('encounters.combatStarted'))
}

async function onAdvanceTurn() {
  const { expiredEffects, recharges } = await encounterStore.advanceTurn()
  if (expiredEffects.length > 0) {
    expiredEffectNames.value = expiredEffects
    showExpiredDialog.value = true
  }
  // Start of a monster's turn: recharge rolls (or a reminder to roll a real d6)
  if (recharges.length > 0) {
    const lines = recharges.map((r) => {
      if (r.roll === null) return t('encounters.resources.rollNow', { name: r.name })
      return t(r.recharged ? 'encounters.resources.recharged' : 'encounters.resources.notRecharged', { name: r.name, roll: r.roll })
    })
    snackbarStore.info(lines.join(' · '), { timeout: 8000 })
  }
}

async function endCombat() {
  showEndDialog.value = false
  const ok = await encounterStore.updateEncounterStatus('finished', { finished_at: new Date().toISOString() })
  if (ok) snackbarStore.success(t('encounters.combatEnded'))
}

async function resetEncounter() {
  const ok = await encounterStore.updateEncounterStatus('setup', { round: 0, current_turn_index: 0, finished_at: null })
  if (ok) snackbarStore.success(t('encounters.encounterReset'))
}

function onSelectTile(index: number) {
  if (!encounter.value || !isCombat.value) return
  encounterStore.updateEncounterStatus(encounter.value.status, { current_turn_index: index })
}

function statusColor(status: string) {
  switch (status) {
    case 'setup': return 'grey'
    case 'initiative': return 'info'
    case 'active': return 'success'
    case 'finished': return 'default'
    default: return 'grey'
  }
}
</script>
