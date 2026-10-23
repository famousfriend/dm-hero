<template>
  <!-- D&D Beyond character link, first thing in the player form: paste the link and the
       party numbers (HP, AC, passives, conditions...) load from the sheet -->
  <v-card variant="tonal" color="primary" class="mb-4 pa-3 ddb-section">
    <div class="d-flex align-center mb-1">
      <v-icon class="mr-2">mdi-link-variant</v-icon>
      <span class="text-title-small">{{ $t('players.ddb.title') }}</span>
    </div>

    <!-- Linked: what came from the sheet -->
    <template v-if="member?.ddbCharacterId">
      <div class="d-flex flex-wrap align-center ga-2 mt-2">
        <v-chip color="success" variant="flat" size="small" prepend-icon="mdi-check">
          {{ $t('players.ddb.linked') }}
        </v-chip>
        <span v-if="member.ddb" class="text-body-medium text-on-surface">{{ summary }}</span>
      </div>
      <v-alert v-if="member.ddbError" type="warning" variant="tonal" density="compact" class="mt-2">
        {{ member.ddbError }}
      </v-alert>
      <div class="d-flex flex-wrap ga-2 mt-3">
        <v-btn size="small" variant="flat" color="primary" prepend-icon="mdi-refresh" :loading="busy" @click="refresh">
          {{ $t('players.ddb.refresh') }}
        </v-btn>
        <v-btn size="small" variant="text" prepend-icon="mdi-open-in-new" @click="openExternalUrl(ddbSheetUrl(member.ddbCharacterId))">
          {{ $t('players.ddb.open') }}
        </v-btn>
        <v-btn size="small" variant="text" prepend-icon="mdi-link-variant-off" :disabled="busy" @click="unlink">
          {{ $t('players.ddb.unlink') }}
        </v-btn>
      </div>
    </template>

    <!-- Not linked: paste a link -->
    <template v-else>
      <p class="text-body-medium text-on-surface mb-3">
        {{ entityId ? $t('players.ddb.intro') : $t('players.ddb.introCreate') }}
      </p>
      <div class="d-flex flex-wrap ga-2 align-start">
        <v-text-field
          ref="linkField"
          v-model="link"
          :label="$t('party.ddbLink')"
          placeholder="https://www.dndbeyond.com/characters/12345678"
          :error-messages="linkError"
          :hint="!entityId && linkValid ? $t('players.ddb.loadsOnSave') : undefined"
          :persistent-hint="!entityId && linkValid"
          prepend-inner-icon="mdi-content-paste"
          density="comfortable"
          variant="outlined"
          bg-color="surface"
          class="flex-grow-1 link-field"
          @update:model-value="onInput"
        />
        <v-btn
          v-if="entityId"
          color="primary"
          variant="flat"
          height="48"
          prepend-icon="mdi-download"
          :loading="busy"
          :disabled="!link.trim()"
          @click="linkNow"
        >
          {{ $t('players.ddb.link') }}
        </v-btn>
      </div>
      <details class="mt-2 text-body-small text-on-surface">
        <summary class="cursor-pointer">{{ $t('players.ddb.howTo') }}</summary>
        <ol class="mt-1 ml-5">
          <li>{{ $t('players.ddb.step1') }}</li>
          <li>{{ $t('players.ddb.step2') }}</li>
          <li>{{ $t('players.ddb.step3') }}</li>
        </ol>
      </details>
      <div v-if="entityId" class="d-flex align-center flex-wrap ga-2 mt-2">
        <v-btn size="small" variant="text" prepend-icon="mdi-file-upload-outline" :disabled="busy" @click="fileInput?.click()">
          {{ $t('party.importFile') }}
        </v-btn>
        <span class="text-caption">{{ $t('party.importFileHint') }}</span>
        <input ref="fileInput" type="file" accept=".json,application/json" hidden @change="importFile" />
      </div>
    </template>
  </v-card>
</template>

<script setup lang="ts">
import type { PartyMember } from '~~/types/party'
import { ddbSheetUrl, parseDdbCharacterId } from '~~/types/party'

/**
 * Edit mode (entityId set): links, refreshes and unlinks right away.
 * Create mode: only collects the link (v-model); the dialog links it after saving.
 */
const props = defineProps<{ entityId?: number | null, autofocus?: boolean }>()
const link = defineModel<string>('link', { default: '' })
const emit = defineEmits<{ updated: [member: PartyMember] }>()

const { t } = useI18n()
const { openExternalUrl } = useElectron()
const campaignStore = useCampaignStore()
const snackbar = useSnackbarStore()

const member = ref<PartyMember | null>(null)
const busy = ref(false)
const linkError = ref('')
const fileInput = ref<HTMLInputElement | null>(null)
const linkField = ref<{ focus: () => void } | null>(null)

const linkValid = computed(() => !!parseDdbCharacterId(link.value))
const summary = computed(() => {
  const s = member.value?.ddb
  if (!s) return ''
  const parts = [s.name, [s.classLabel, s.level ? `${t('players.ddb.level')} ${s.level}` : ''].filter(Boolean).join(' '), `HP ${s.hpCurrent}/${s.hpMax}`, `AC ${s.ac}`]
  return parts.filter(Boolean).join(' · ')
})

async function load() {
  member.value = null
  const campaignId = campaignStore.activeCampaignIdNumber
  if (!props.entityId || !campaignId) return
  try {
    const members = await $fetch<PartyMember[]>('/api/party', { query: { campaignId } })
    member.value = members.find(m => m.entityId === props.entityId) ?? null
  }
  catch {
    // Party data is optional here; the field still works
  }
}
watch(() => props.entityId, load, { immediate: true })

onMounted(() => {
  if (props.autofocus) nextTick(() => linkField.value?.focus())
})

function onInput() {
  linkError.value = link.value.trim() && !linkValid.value ? t('party.invalidLink') : ''
}

function setMember(updated: PartyMember) {
  member.value = updated
  emit('updated', updated)
}

async function linkNow() {
  if (!props.entityId) return
  if (!linkValid.value) {
    linkError.value = t('party.invalidLink')
    return
  }
  busy.value = true
  try {
    await $fetch<PartyMember>(`/api/party/${props.entityId}`, { method: 'PATCH', body: { ddbLink: link.value } })
    setMember(await $fetch<PartyMember>(`/api/party/${props.entityId}/refresh`, { method: 'POST' }))
    link.value = ''
  }
  catch {
    linkError.value = t('party.invalidLink')
  }
  finally {
    busy.value = false
  }
}

async function refresh() {
  busy.value = true
  try {
    setMember(await $fetch<PartyMember>(`/api/party/${props.entityId}/refresh`, { method: 'POST' }))
  }
  catch {
    snackbar.error(t('party.refreshFailed'))
  }
  finally {
    busy.value = false
  }
}

async function unlink() {
  busy.value = true
  try {
    setMember(await $fetch<PartyMember>(`/api/party/${props.entityId}`, { method: 'PATCH', body: { ddbLink: null } }))
  }
  finally {
    busy.value = false
  }
}

async function importFile(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (!file || !props.entityId) return
  try {
    const json = JSON.parse(await file.text())
    setMember(await $fetch<PartyMember>(`/api/party/${props.entityId}/import`, { method: 'POST', body: json }))
    snackbar.success(t('party.importDone'))
  }
  catch {
    snackbar.error(t('party.importFailed'))
  }
}
</script>

<style scoped>
.link-field {
  min-width: 240px;
}

.cursor-pointer {
  cursor: pointer;
}
</style>
