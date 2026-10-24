import { createVuetify } from 'vuetify'
import { MIDNIGHT_TAVERN } from '@dmcc/character-core'

export default defineNuxtPlugin((nuxtApp) => {
  const vuetify = createVuetify({
    theme: {
      defaultTheme: 'dark',
      themes: {
        dark: { dark: true, colors: { ...MIDNIGHT_TAVERN } },
      },
    },
    // Same breakpoints and flat look as DM Command Center
    display: {
      thresholds: { xs: 0, sm: 600, md: 960, lg: 1280, xl: 1920, xxl: 2560 },
    },
    defaults: {
      global: { elevation: 0 },
      VCard: { elevation: 0 },
      VBtn: { elevation: 0 },
      VAppBar: { elevation: 0 },
      VNavigationDrawer: { elevation: 0 },
    },
  })
  nuxtApp.vueApp.use(vuetify)
})
