<template>
  <!-- Fill in a magic item, copy the page text and paste it into The Homebrewery,
       which turns it into an official-looking page to save as PDF for the players -->
  <!-- Max height keeps the top clear of the window title bar (it swallows clicks in the desktop app) -->
  <v-dialog v-model="dialogVisible" max-width="980" max-height="calc(100vh - 160px)" scrollable>
    <v-card>
      <v-card-title class="d-flex align-center">
        <v-icon icon="mdi-script-text-outline" class="me-2" />
        <span class="text-truncate">{{ $t('items.handout.title') }}</span>
        <v-spacer />
        <v-btn icon="mdi-close" variant="text" size="small" :aria-label="$t('common.close')" @click="dialogVisible = false" />
      </v-card-title>
      <v-divider />

      <v-card-text>
        <v-row>
          <v-col cols="12" md="7">
            <v-text-field v-model="form.name" :label="$t('items.handout.name')" variant="outlined" density="comfortable" />
            <v-row density="compact">
              <v-col cols="12" sm="6">
                <v-select
                  v-model="form.category"
                  :items="categoryItems"
                  :label="$t('items.handout.category')"
                  variant="outlined"
                  density="comfortable"
                />
              </v-col>
              <v-col cols="12" sm="6">
                <v-select
                  v-model="form.rarity"
                  :items="rarityItems"
                  :label="$t('items.handout.rarity')"
                  variant="outlined"
                  density="comfortable"
                />
              </v-col>
            </v-row>

            <v-row v-if="form.category === 'weapon' || form.category === 'armor'" density="compact">
              <v-col cols="12" sm="6">
                <!-- Picking an SRD weapon/armor fills in its damage, properties and weight -->
                <v-combobox
                  :model-value="form.baseItem"
                  :items="baseItems"
                  :label="$t('items.handout.baseItem')"
                  :hint="$t('items.handout.baseItemHint')"
                  persistent-hint
                  variant="outlined"
                  density="comfortable"
                  @update:model-value="onBaseItem"
                />
              </v-col>
              <v-col cols="12" sm="6">
                <v-select
                  v-model="form.bonus"
                  :items="bonusItems"
                  :label="$t('items.handout.bonus')"
                  variant="outlined"
                  density="comfortable"
                />
              </v-col>
            </v-row>

            <div class="d-flex flex-wrap align-center ga-3 mt-2">
              <v-switch v-model="form.attunement" :label="$t('items.handout.attunement')" color="primary" density="compact" hide-details />
              <v-combobox
                v-if="form.attunement"
                v-model="form.attunementBy"
                :items="ATTUNEMENT_SUGGESTIONS"
                :label="$t('items.handout.attunementBy')"
                variant="outlined"
                density="compact"
                hide-details
                class="attune-by"
              />
            </div>

            <v-row density="compact" class="mt-2">
              <v-col v-if="form.category !== 'armor'" cols="12" sm="6">
                <v-text-field
                  v-model="form.damage"
                  :label="$t('items.handout.damage')"
                  placeholder="1d8 slashing + 1d6 fire"
                  variant="outlined"
                  density="comfortable"
                />
              </v-col>
              <v-col v-if="form.category === 'armor'" cols="12" sm="6">
                <v-text-field v-model="form.armorClass" :label="$t('items.handout.armorClass')" variant="outlined" density="comfortable" />
              </v-col>
              <v-col cols="12" sm="6">
                <v-text-field v-model="form.charges" :label="$t('items.handout.charges')" variant="outlined" density="comfortable" />
              </v-col>
            </v-row>

            <v-combobox
              v-model="form.properties"
              :items="WEAPON_PROPERTIES"
              :label="$t('items.handout.properties')"
              :hint="$t('items.handout.propertiesHint')"
              persistent-hint
              multiple
              chips
              closable-chips
              variant="outlined"
              density="comfortable"
              class="mb-4"
            />

            <v-row density="compact">
              <v-col cols="6">
                <v-text-field v-model="form.weight" :label="$t('items.handout.weight')" variant="outlined" density="comfortable" />
              </v-col>
              <v-col cols="6">
                <v-text-field v-model="form.value" :label="$t('items.handout.value')" variant="outlined" density="comfortable" />
              </v-col>
            </v-row>

            <v-textarea
              v-model="form.description"
              :label="$t('items.handout.description')"
              :hint="$t('items.handout.descriptionHint')"
              persistent-hint
              variant="outlined"
              rows="5"
              auto-grow
              class="mb-2"
            />
            <v-text-field
              v-model="form.imageUrl"
              :label="$t('items.handout.imageUrl')"
              :hint="$t('items.handout.imageUrlHint')"
              persistent-hint
              variant="outlined"
              density="comfortable"
            />
          </v-col>

          <v-col cols="12" md="5">
            <div class="text-subtitle-2 mb-1">
              {{ $t('items.handout.preview') }}
            </div>
            <pre class="handout-text">{{ markdown }}</pre>
            <v-alert type="info" variant="tonal" density="compact" class="mt-3 text-body-2">
              <div class="font-weight-medium mb-1">
                {{ $t('items.handout.stepsTitle') }}
              </div>
              <ol class="handout-steps">
                <li>{{ $t('items.handout.step1') }}</li>
                <li>{{ $t('items.handout.step2') }}</li>
                <li>{{ $t('items.handout.step3') }}</li>
                <li>{{ $t('items.handout.step4') }}</li>
              </ol>
            </v-alert>
          </v-col>
        </v-row>
      </v-card-text>

      <v-divider />
      <v-card-actions class="flex-wrap ga-2">
        <v-btn variant="text" prepend-icon="mdi-restore" @click="reset">
          {{ $t('items.handout.reset') }}
        </v-btn>
        <v-spacer />
        <v-btn variant="tonal" :prepend-icon="copied ? 'mdi-check' : 'mdi-content-copy'" @click="copyText">
          {{ copied ? $t('items.handout.copied') : $t('items.handout.copy') }}
        </v-btn>
        <v-btn color="primary" variant="flat" prepend-icon="mdi-open-in-new" @click="copyAndOpen">
          {{ $t('items.handout.copyAndOpen') }}
        </v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>

<script setup lang="ts">
import type { Item } from '~~/types/item'
import {
  applyBaseItem,
  ATTUNEMENT_SUGGESTIONS,
  buildHandoutMarkdown,
  emptyHandoutForm,
  HANDOUT_CATEGORIES,
  HANDOUT_RARITIES,
  handoutFormFromItem,
  HOMEBREWERY_NEW_URL,
  SRD_ARMOR,
  SRD_WEAPONS,
  WEAPON_PROPERTIES,
} from '~/utils/itemHandout'

const props = defineProps<{ item?: Item | null }>()
const dialogVisible = defineModel<boolean>({ default: false })

const { t } = useI18n()
const { openExternalUrl } = useElectron()
const snackbarStore = useSnackbarStore()

const form = ref(emptyHandoutForm())

function reset() {
  form.value = props.item ? handoutFormFromItem(props.item) : emptyHandoutForm()
}

// Fresh form from the item each time the dialog opens
watch(dialogVisible, (open) => {
  if (open) reset()
})

const categoryItems = computed(() => HANDOUT_CATEGORIES.map(value => ({ value, title: t(`items.handout.categories.${value}`) })))
const rarityItems = computed(() => HANDOUT_RARITIES.map(value => ({
  value,
  title: value === 'varies' ? t('items.handout.rarityVaries') : t(`items.rarities.${value}`),
})))
const bonusItems = computed(() => [0, 1, 2, 3].map(value => ({ value, title: value ? `+${value}` : t('items.handout.noBonus') })))
const baseItems = computed(() => (form.value.category === 'armor' ? SRD_ARMOR : SRD_WEAPONS).map(b => b.name))

function onBaseItem(value: string | null) {
  form.value = applyBaseItem(form.value, value ?? '')
}

const markdown = computed(() => buildHandoutMarkdown(form.value))

const copied = ref(false)
async function writeClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
    return true
  }
  catch {
    // Plain-HTTP web app has no clipboard API: old-style copy via a hidden textarea
    const area = document.createElement('textarea')
    area.value = text
    area.style.position = 'fixed'
    area.style.opacity = '0'
    document.body.appendChild(area)
    area.select()
    const ok = document.execCommand('copy')
    area.remove()
    return ok
  }
}

async function copyText(): Promise<boolean> {
  const ok = await writeClipboard(markdown.value)
  if (!ok) {
    snackbarStore.error(t('items.handout.copyFailed'))
    return false
  }
  copied.value = true
  setTimeout(() => (copied.value = false), 1500)
  return true
}

async function copyAndOpen() {
  if (await copyText()) await openExternalUrl(HOMEBREWERY_NEW_URL)
}
</script>

<style scoped>
.handout-text {
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  font-size: 0.8rem;
  line-height: 1.45;
  max-height: 340px;
  overflow: auto;
  padding: 10px 12px;
  border-radius: 6px;
  background: rgba(var(--v-theme-on-surface), 0.06);
}

.handout-steps {
  padding-left: 1.2em;
}

.attune-by {
  min-width: 220px;
  flex: 1 1 220px;
}
</style>
