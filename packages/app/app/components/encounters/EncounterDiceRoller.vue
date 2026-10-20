<template>
  <div class="dice-roller pa-3 rounded">
    <!-- Dice buttons -->
    <div class="d-flex align-center ga-1 flex-wrap">
      <v-btn
        v-for="die in dice"
        :key="die"
        size="small"
        :variant="selected[die] ? 'flat' : 'tonal'"
        :color="selected[die] ? 'primary' : undefined"
        class="dice-btn"
        @click="increment(die)"
        @contextmenu.prevent="decrement(die)"
      >
        <span class="font-weight-bold">d{{ die }}</span>
        <v-badge
          v-if="selected[die] > 1"
          :content="selected[die]"
          color="primary"
          floating
          offset-x="-2"
          offset-y="-2"
        />
      </v-btn>

      <!-- Modifier -->
      <div class="d-flex align-center ga-1 ml-2">
        <v-btn icon size="x-small" variant="text" @click="modifier--">
          <v-icon size="16">mdi-minus</v-icon>
        </v-btn>
        <span class="text-body-medium font-weight-bold" style="min-width: 32px; text-align: center;">
          {{ modifier >= 0 ? `+${modifier}` : modifier }}
        </span>
        <v-btn icon size="x-small" variant="text" @click="modifier++">
          <v-icon size="16">mdi-plus</v-icon>
        </v-btn>
      </div>

      <!-- Roll + Clear -->
      <v-btn
        color="primary"
        size="small"
        :disabled="!hasSelection"
        class="ml-2"
        @click="physicalDice ? startEntry() : roll()"
      >
        <v-icon start size="16">{{ physicalDice ? 'mdi-keyboard-outline' : 'mdi-dice-multiple' }}</v-icon>
        {{ physicalDice ? $t('encounters.dice.enterResults') : $t('encounters.roll') }}
      </v-btn>
      <v-btn
        v-if="hasSelection || modifier !== 0"
        icon
        size="x-small"
        variant="text"
        @click="clear"
      >
        <v-icon size="16">mdi-close</v-icon>
      </v-btn>

      <v-spacer />
      <v-switch
        v-model="physicalDice"
        :label="$t('encounters.dice.physical')"
        :title="$t('encounters.dice.physicalHint')"
        color="primary"
        density="compact"
        hide-details
        class="flex-grow-0"
      />
    </div>

    <!-- Physical dice: type in what each die shows -->
    <div v-if="entries.length" class="mt-2 d-flex align-center ga-2 flex-wrap">
      <v-text-field
        v-for="(entry, i) in entries"
        :key="i"
        v-model.number="entry.value"
        type="number"
        :label="`d${entry.die}`"
        :min="1"
        :max="entry.die"
        :error="entry.value != null && !validEntry(entry)"
        density="compact"
        variant="outlined"
        hide-details
        :autofocus="i === 0"
        class="dice-entry"
        @keydown.enter="finishEntry"
      />
      <v-btn color="primary" size="small" :disabled="!entries.every(validEntry)" @click="finishEntry">
        {{ $t('encounters.dice.total') }}
      </v-btn>
    </div>

    <!-- Result -->
    <div v-if="lastResult" class="mt-2 d-flex align-center ga-2">
      <span class="text-headline-small font-weight-bold text-primary">{{ lastResult.total }}</span>
      <span class="text-body-medium text-medium-emphasis">=</span>
      <span class="text-body-medium text-medium-emphasis">{{ lastResult.breakdown }}</span>
    </div>
  </div>
</template>

<script setup lang="ts">
const dice = [4, 6, 8, 10, 12, 20] as const
type Die = typeof dice[number]

const selected = reactive<Record<Die, number>>({ 4: 0, 6: 0, 8: 0, 10: 0, 12: 0, 20: 0 })
const modifier = ref(0)
const lastResult = ref<{ total: number, breakdown: string } | null>(null)

const hasSelection = computed(() => dice.some(d => selected[d] > 0))

const physicalDice = usePhysicalDice()
const entries = ref<Array<{ die: Die, value: number | null }>>([])

const validEntry = (e: { die: Die, value: number | null }) =>
  e.value != null && Number.isInteger(e.value) && e.value >= 1 && e.value <= e.die

function startEntry() {
  entries.value = dice.flatMap(die => Array.from({ length: selected[die] }, () => ({ die, value: null })))
  lastResult.value = null
}

function finishEntry() {
  if (!entries.value.length || !entries.value.every(validEntry)) return
  const rolls = {} as Record<Die, number[]>
  for (const e of entries.value) (rolls[e.die] ??= []).push(e.value!)
  showResult(rolls)
  entries.value = []
}

function increment(die: Die) {
  if (selected[die] < 20) selected[die]++
}

function decrement(die: Die) {
  if (selected[die] > 0) selected[die]--
}

function clear() {
  for (const d of dice) selected[d] = 0
  modifier.value = 0
  lastResult.value = null
  entries.value = []
}

function roll() {
  const rolls = {} as Record<Die, number[]>
  for (const die of dice) {
    rolls[die] = Array.from({ length: selected[die] }, () => Math.floor(Math.random() * die) + 1)
  }
  showResult(rolls)
}

/** Total and breakdown, the same for app rolls and typed-in physical dice */
function showResult(rollsByDie: Record<Die, number[]>) {
  const parts: string[] = []
  let total = 0

  for (const die of dice) {
    const rolls = rollsByDie[die] ?? []
    const count = rolls.length
    if (!count) continue

    const sum = rolls.reduce((a, b) => a + b, 0)
    total += sum

    if (count === 1) {
      parts.push(`d${die}: ${rolls[0]}`)
    }
    else {
      parts.push(`${count}d${die}: ${rolls.join(' + ')} = ${sum}`)
    }
  }

  if (modifier.value !== 0) {
    total += modifier.value
    parts.push(modifier.value >= 0 ? `+${modifier.value}` : `${modifier.value}`)
  }

  lastResult.value = { total, breakdown: parts.join(' | ') }
}
</script>

<style scoped>
.dice-roller {
  border: 1px solid rgba(var(--v-border-color), 0.12);
}
.dice-entry {
  max-width: 76px;
}
.dice-btn {
  min-width: 44px !important;
  position: relative;
}
</style>
