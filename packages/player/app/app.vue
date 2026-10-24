<template>
  <v-app>
    <v-navigation-drawer v-model="drawer" :rail="rail" permanent>
      <v-list nav density="comfortable">
        <v-list-item
          v-for="item in nav"
          :key="item.to"
          :to="item.to"
          :prepend-icon="item.icon"
          :title="item.title"
          exact
        />
      </v-list>
      <template #append>
        <v-list nav density="compact">
          <v-list-item
            :prepend-icon="rail ? 'mdi-chevron-right' : 'mdi-chevron-left'"
            :title="rail ? '' : 'Collapse'"
            @click="rail = !rail"
          />
        </v-list>
      </template>
    </v-navigation-drawer>

    <AppBar />

    <v-main class="main-no-scroll">
      <div class="content-scrollable">
        <v-container fluid>
          <NuxtPage />
        </v-container>
      </div>
    </v-main>
  </v-app>
</template>

<script setup lang="ts">
const drawer = ref(true)
const rail = ref(false)

const nav = [
  { to: '/', icon: 'mdi-view-dashboard-outline', title: 'Dashboard' },
  { to: '/notes', icon: 'mdi-notebook-outline', title: 'Notes' },
  { to: '/journal', icon: 'mdi-account-group-outline', title: 'NPCs & Places' },
  { to: '/characters', icon: 'mdi-account-multiple-outline', title: 'Characters' },
  { to: '/campaigns', icon: 'mdi-map-legend', title: 'Campaigns' },
]

const { load } = useCharacters()
onMounted(load)
</script>

<style>
/* Same scroll setup as DM Command Center: only the page content scrolls, below the app bar */
html {
  overflow: hidden !important;
}

.v-application {
  height: 100vh;
  overflow: hidden;
}

.main-no-scroll {
  position: relative;
  z-index: 1;
  overflow: hidden !important;
  /* 64px = AppBar height */
  height: calc(100vh - 64px);
}

.content-scrollable {
  height: 100%;
  overflow-y: auto;
  overflow-x: hidden;
}

/* Long words and names wrap instead of running out of their box */
body {
  overflow-wrap: break-word;
}
</style>
