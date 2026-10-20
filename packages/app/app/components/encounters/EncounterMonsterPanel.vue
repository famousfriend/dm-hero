<template>
  <div v-if="block" class="monster-panel">
    <!-- Pick an attack or spell: rolls it (or says what to roll) and spends its uses -->
    <div class="d-flex align-center ga-2 flex-wrap mb-2">
      <span class="text-body-medium font-weight-medium">{{ $t('encounters.monster.title') }}</span>
      <v-spacer />
      <v-menu v-if="actionGroups.length" location="bottom end" max-height="480">
        <template #activator="{ props: menuProps }">
          <v-btn size="small" color="error" variant="tonal" prepend-icon="mdi-sword" append-icon="mdi-menu-down" v-bind="menuProps">
            {{ $t('encounters.monster.attack') }}
          </v-btn>
        </template>
        <v-list density="compact" max-width="440">
          <template v-for="group in actionGroups" :key="group.key">
            <v-list-subheader>
              {{ $t(`encounters.monster.sections.${group.key}`) }}
              <span v-if="group.key === 'legendary' && legendaryLeft !== null">· {{ $t('encounters.monster.left', { n: legendaryLeft }) }}</span>
            </v-list-subheader>
            <v-list-item
              v-for="action in group.actions"
              :key="`${group.key}-${action.name}`"
              :title="action.name"
              :subtitle="actionSubtitle(action)"
              :disabled="!canUse(action, group.key)"
              lines="two"
              @click="useAction(action, group.key)"
            />
          </template>
        </v-list>
      </v-menu>

      <v-menu v-for="casting in block.spellcasting" :key="casting.name" location="bottom end" max-height="480">
        <template #activator="{ props: menuProps }">
          <v-btn
            size="small"
            color="purple"
            variant="tonal"
            prepend-icon="mdi-auto-fix"
            append-icon="mdi-menu-down"
            :disabled="!casting.groups.length"
            v-bind="menuProps"
          >
            {{ block.spellcasting.length > 1 ? casting.name : $t('encounters.monster.castSpell') }}
          </v-btn>
        </template>
        <v-list density="compact" max-width="400">
          <v-list-item v-if="casting.saveDc || casting.attack" class="text-body-small text-medium-emphasis">
            {{ spellStats(casting) }}
          </v-list-item>
          <template v-for="group in casting.groups" :key="group.label">
            <v-list-subheader>{{ groupLabel(group) }}</v-list-subheader>
            <v-list-item
              v-for="spell in group.spells"
              :key="`${group.label}-${spell}`"
              :title="spell"
              :disabled="!canCast(casting, group, spell)"
              @click="cast(casting, group, spell)"
            >
              <template #append>
                <span v-if="group.perDay" class="text-body-small text-medium-emphasis mr-1">
                  {{ $t('encounters.monster.left', { n: innateLeft(spell, group.perDay) }) }}
                </span>
                <v-btn
                  icon="mdi-book-open-variant"
                  size="x-small"
                  variant="text"
                  :title="$t('encounters.monster.readSpell')"
                  @click.stop="codex.open(spellUid(spell))"
                />
              </template>
            </v-list-item>
          </template>
        </v-list>
      </v-menu>
    </div>

    <!-- What the last pick did -->
    <v-alert
      v-if="lastResult"
      density="compact"
      variant="tonal"
      :color="lastResult.crit ? 'success' : 'info'"
      closable
      class="mb-2"
      @click:close="lastResult = null"
    >
      <div class="text-body-medium font-weight-medium">{{ lastResult.title }}</div>
      <div v-if="lastResult.detail" class="text-body-small">{{ lastResult.detail }}</div>
    </v-alert>

    <!-- Spell slots and X/day spells left -->
    <div v-for="casting in block.spellcasting" :key="`slots-${casting.name}`" class="d-flex flex-wrap ga-3 mb-2">
      <template v-for="group in casting.groups" :key="`pips-${group.label}`">
        <div v-if="group.slots" class="d-flex align-center ga-1" :title="$t('encounters.monster.slotsLeft', { n: slotsLeft(group), max: group.slots })">
          <span class="text-body-small">{{ $t('encounters.monster.levelShort', { n: group.level }) }}</span>
          <v-icon v-for="n in group.slots" :key="n" size="14" color="purple">
            {{ n <= slotsLeft(group) ? 'mdi-circle' : 'mdi-circle-outline' }}
          </v-icon>
        </div>
      </template>
    </div>

    <!-- The important text: traits and what each action does -->
    <v-expansion-panels v-model="openPanels" multiple variant="accordion" class="mb-1">
      <v-expansion-panel v-for="section in textSections" :key="section.key" :value="section.key">
        <v-expansion-panel-title class="py-2 text-body-medium">
          {{ $t(`encounters.monster.sections.${section.key}`) }}
          <span class="text-medium-emphasis ml-2">({{ section.items.length }})</span>
        </v-expansion-panel-title>
        <v-expansion-panel-text>
          <div v-for="item in section.items" :key="item.name" class="mb-2 text-body-medium">
            <span class="font-weight-bold font-italic">{{ item.name }}.</span>
            {{ plain(item.text) }}
          </div>
        </v-expansion-panel-text>
      </v-expansion-panel>
    </v-expansion-panels>
  </div>
</template>

<script setup lang="ts">
import type { CodexEntry } from '~~/types/codex'
import { buildUid } from '~~/types/codex'
import type { EncounterParticipant, EncounterResource } from '~~/types/encounter'
import {
  abilityName,
  innateResourceName,
  legendaryCost,
  parseStatBlock,
  rollDice,
  slotResourceName,
  spellLookupName,
  type SpellGroup,
  type Spellcasting,
  type StatBlock,
  type StatBlockAction,
} from '~/utils/statBlock'

/**
 * A Codex monster in a fight: its abilities, an attack picker and a spell
 * picker. Picking rolls (or, with physical dice, says what to roll) and
 * spends recharge abilities, legendary actions, spell slots and X/day spells.
 */
const props = defineProps<{
  encounterId: number
  participant: EncounterParticipant
}>()

type ActionSection = 'actions' | 'bonusActions' | 'reactions' | 'legendary'

const { t } = useI18n()
const codex = useCodexStore()
const encounterStore = useEncounterStore()
const campaignStore = useCampaignStore()
const snackbarStore = useSnackbarStore()
const physicalDice = usePhysicalDice()

const block = ref<StatBlock | null>(null)
const openPanels = ref<string[]>(['traits', 'actions'])
const lastResult = ref<{ title: string, detail?: string, crit?: boolean } | null>(null)

watch(() => [props.participant.id, props.participant.ref_uid] as const, async ([, uid]) => {
  block.value = null
  lastResult.value = null
  if (!uid) return
  try {
    // With this campaign's own edits of the stat block
    const entry = await $fetch<CodexEntry>('/api/codex/entry', {
      query: { uid, campaignId: campaignStore.activeCampaignIdNumber ?? undefined },
    })
    if (props.participant.ref_uid === uid) block.value = parseStatBlock(entry.body)
  }
  catch {
    block.value = null
  }
}, { immediate: true })

const actionGroups = computed(() => {
  const b = block.value
  if (!b) return []
  const groups: Array<{ key: ActionSection, actions: StatBlockAction[] }> = [
    { key: 'actions', actions: b.actions },
    { key: 'bonusActions', actions: b.bonusActions },
    { key: 'reactions', actions: b.reactions },
    { key: 'legendary', actions: b.legendary },
  ]
  return groups.filter(g => g.actions.length)
})

const textSections = computed(() => {
  const b = block.value
  if (!b) return []
  const sections = [
    { key: 'traits', items: b.traits },
    { key: 'actions', items: b.actions },
    { key: 'bonusActions', items: b.bonusActions },
    { key: 'reactions', items: b.reactions },
    { key: 'legendary', items: b.legendary },
  ]
  return sections.filter(s => s.items.length)
})

// Always read the participant from the store: it is replaced after every change
function resources(): EncounterResource[] {
  const p = encounterStore.activeEncounter?.participants.find(x => x.id === props.participant.id)
  return p?.resources ?? props.participant.resources ?? []
}
const findResource = (name: string) => resources().find(r => r.name === name)
const left = (r: EncounterResource | undefined, max: number) => (r ? r.max_uses - r.used : max)

const legendaryLeft = computed(() => {
  const r = findResource('Legendary Actions')
  return r ? r.max_uses - r.used : null
})

function canUse(action: StatBlockAction, section: ActionSection) {
  if (section === 'legendary') return legendaryLeft.value === null || legendaryLeft.value >= legendaryCost(action.name)
  const r = findResource(abilityName(action.name))
  return !r || r.used < r.max_uses
}

const signed = (n: number) => (n >= 0 ? `+${n}` : `${n}`)

function actionSubtitle(action: StatBlockAction) {
  const parts: string[] = []
  if (action.toHit !== null) parts.push(t('encounters.monster.toHit', { n: signed(action.toHit) }))
  if (action.save) parts.push(t('encounters.monster.save', { save: action.save }))
  if (action.hit) parts.push(action.hit)
  else if (action.damageDice) parts.push(action.damageDice)
  const r = findResource(abilityName(action.name))
  if (r?.kind === 'recharge') parts.push(r.used ? t('encounters.resources.spent') : t('encounters.resources.ready'))
  else if (r && r.kind !== 'legendary') parts.push(t('encounters.monster.left', { n: r.max_uses - r.used }))
  return parts.join(' · ') || plain(action.text).slice(0, 90)
}

/** Spends uses of a limited ability; creates it the first time (spell slots, X/day spells). */
async function spend(name: string, max: number, cost = 1): Promise<boolean> {
  let r = findResource(name)
  if (!r) {
    const added = await encounterStore.updateResource(props.encounterId, props.participant.id, { op: 'add', name, kind: 'uses', max_uses: max })
    r = added ? findResource(name) : undefined
  }
  if (!r || r.max_uses - r.used < cost) return false
  return encounterStore.updateResource(props.encounterId, props.participant.id, { op: 'set', id: r.id, used: r.used + cost })
}

async function useAction(action: StatBlockAction, section: ActionSection) {
  const who = props.participant.display_name
  // Spend what the action costs: a legendary action, or its recharge / X/day use
  if (section === 'legendary') {
    if (legendaryLeft.value !== null && !(await spend('Legendary Actions', 3, legendaryCost(action.name)))) return failed()
  }
  else {
    const r = findResource(abilityName(action.name))
    if (r && !(await spend(r.name, r.max_uses))) return failed()
  }

  const name = `${who}: ${action.name}`
  if (physicalDice.value) {
    lastResult.value = {
      title: name,
      detail: [
        action.toHit !== null ? t('encounters.monster.rollToHit', { bonus: signed(action.toHit) }) : '',
        action.save ? t('encounters.monster.save', { save: action.save }) : '',
        action.damageDice ? t('encounters.monster.rollDamage', { dice: action.damageDice }) : '',
      ].filter(Boolean).join(' · ') || plain(action.text),
    }
    return
  }

  const d20 = action.toHit !== null ? rollDice('1d20')!.total : null
  const crit = d20 === 20
  const damage = action.damageDice ? rollDice(action.damageDice, crit) : null
  const parts: string[] = []
  if (d20 !== null) {
    parts.push(d20 === 1
      ? t('encounters.monster.natOne')
      : t('encounters.monster.attackRoll', { total: d20 + action.toHit!, roll: d20 }))
  }
  if (action.save) parts.push(t('encounters.monster.save', { save: action.save }))
  if (damage && d20 !== 1) parts.push(t('encounters.monster.damageRoll', { total: damage.total, dice: action.damageDice }))
  lastResult.value = {
    title: crit ? `${name} · ${t('encounters.monster.crit')}` : name,
    detail: parts.join(' · ') || plain(action.text),
    crit,
  }
}

// ---------------------------------------------------------------- spells

const slotsLeft = (group: SpellGroup) => left(findResource(slotResourceName(group.level ?? 0)), group.slots ?? 0)
const innateLeft = (spell: string, perDay: number) => left(findResource(innateResourceName(spell)), perDay)
const spellUid = (spell: string) => buildUid('spell', spellLookupName(spell), 'phb')

/** Lowest slot level at or above the spell's that still has a slot */
function slotGroupFor(casting: Spellcasting, group: SpellGroup): SpellGroup | null {
  if (!group.level) return null
  return casting.groups.find(g => g.slots && (g.level ?? 0) >= group.level! && slotsLeft(g) > 0) ?? null
}

function canCast(casting: Spellcasting, group: SpellGroup, spell: string) {
  if (group.perDay) return innateLeft(spell, group.perDay) > 0
  if (group.slots) return slotGroupFor(casting, group) !== null
  return true // cantrips and at-will spells
}

async function cast(casting: Spellcasting, group: SpellGroup, spell: string) {
  const who = props.participant.display_name
  let detail = t('encounters.monster.atWill')
  if (group.perDay) {
    if (!(await spend(innateResourceName(spell), group.perDay))) return failed()
    detail = t('encounters.monster.left', { n: innateLeft(spell, group.perDay) })
  }
  else if (group.slots) {
    const slot = slotGroupFor(casting, group)
    if (!slot || !(await spend(slotResourceName(slot.level!), slot.slots!))) return failed()
    detail = slot.level === group.level
      ? t('encounters.monster.slotUsed', { level: slot.level, n: slotsLeft(slot) })
      : t('encounters.monster.upcast', { level: slot.level, n: slotsLeft(slot) })
  }
  lastResult.value = {
    title: t('encounters.monster.casts', { name: who, spell }),
    detail: [detail, spellStats(casting)].filter(Boolean).join(' · '),
  }
}

function spellStats(casting: Spellcasting) {
  const parts: string[] = []
  if (casting.saveDc) parts.push(t('encounters.monster.spellDc', { n: casting.saveDc }))
  if (casting.attack !== null) parts.push(t('encounters.monster.toHit', { n: signed(casting.attack) }))
  return parts.join(' · ')
}

function groupLabel(group: SpellGroup) {
  if (group.slots) return `${group.label} · ${t('encounters.monster.slotsLeft', { n: slotsLeft(group), max: group.slots })}`
  return group.label
}

function failed() {
  snackbarStore.error(t('encounters.actionFailed'))
}

/** Stat block text without Markdown marks, for compact display */
function plain(text: string) {
  return text.replace(/[*_`]/g, '').replace(/\s+/g, ' ').trim()
}
</script>

<style scoped>
.monster-panel :deep(.v-expansion-panel-text__wrapper) {
  padding: 8px 16px 4px;
}
</style>
