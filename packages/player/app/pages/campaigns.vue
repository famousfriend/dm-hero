<template>
  <div>
    <div class="d-flex align-center mb-4">
      <h1 class="text-h5">Campaigns</h1>
      <v-spacer />
      <v-btn color="primary" variant="flat" prepend-icon="mdi-plus" @click="edit(null)">New campaign</v-btn>
    </div>

    <v-alert v-if="loaded && !campaigns.length" type="info" variant="tonal">
      No campaigns yet. A campaign groups the characters you play with one DM.
    </v-alert>

    <v-list v-else lines="two" bg-color="transparent">
      <v-list-item v-for="campaign in campaigns" :key="campaign.id" :title="campaign.name" class="mb-2" border rounded>
        <template #subtitle>
          {{ campaign.dmName ? `DM: ${campaign.dmName}` : 'No DM name' }} · {{ countFor(campaign.id) }}
        </template>
        <template #append>
          <v-btn icon="mdi-pencil" variant="text" @click="edit(campaign)" />
          <v-btn icon="mdi-delete" variant="text" color="error" @click="toDelete = campaign" />
        </template>
      </v-list-item>
    </v-list>

    <v-dialog v-model="formOpen" max-width="440">
      <v-card :title="editing ? 'Edit campaign' : 'New campaign'">
        <v-card-text>
          <v-text-field v-model="name" label="Campaign name" autofocus />
          <v-text-field v-model="dmName" label="DM name (optional)" />
        </v-card-text>
        <v-card-actions>
          <v-spacer />
          <v-btn variant="text" @click="formOpen = false">Cancel</v-btn>
          <v-btn color="primary" variant="flat" :disabled="!name.trim()" @click="save">Save</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>

    <v-dialog :model-value="!!toDelete" max-width="420" @update:model-value="toDelete = null">
      <v-card title="Delete campaign?">
        <v-card-text>
          {{ toDelete?.name }} will be removed. Its characters stay, without a campaign.
        </v-card-text>
        <v-card-actions>
          <v-spacer />
          <v-btn variant="text" @click="toDelete = null">Cancel</v-btn>
          <v-btn color="error" variant="flat" @click="confirmDelete">Delete</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>
  </div>
</template>

<script setup lang="ts">
import type { PlayerCampaign } from '@dmcc/character-core'

const { campaigns, characters, loaded, createCampaign, updateCampaign, deleteCampaign } = useCharacters()

const formOpen = ref(false)
const editing = ref<PlayerCampaign | null>(null)
const toDelete = ref<PlayerCampaign | null>(null)
const name = ref('')
const dmName = ref('')

function countFor(id: number) {
  const n = characters.value.filter(c => c.campaignId === id).length
  return n === 1 ? '1 character' : `${n} characters`
}

function edit(campaign: PlayerCampaign | null) {
  editing.value = campaign
  name.value = campaign?.name ?? ''
  dmName.value = campaign?.dmName ?? ''
  formOpen.value = true
}

async function save() {
  if (editing.value) await updateCampaign(editing.value.id, name.value.trim(), dmName.value.trim())
  else await createCampaign(name.value.trim(), dmName.value.trim())
  formOpen.value = false
}

async function confirmDelete() {
  if (!toDelete.value) return
  await deleteCampaign(toDelete.value.id)
  toDelete.value = null
}
</script>
