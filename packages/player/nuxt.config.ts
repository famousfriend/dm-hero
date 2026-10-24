import vuetify from 'vite-plugin-vuetify'
import pkg from './package.json'

// DM Command Center - Player Companion. Same stack as the DM app (packages/app),
// its own database and data folder. API routes: one catch-all per feature
// (see server/api/*/[...path].ts) so the route count stays small.
export default defineNuxtConfig({
  modules: ['@nuxt/eslint'],
  ssr: false,
  devtools: { enabled: false },

  app: {
    head: {
      title: 'Player Companion',
      link: [{ rel: 'icon', type: 'image/png', href: '/favicon.png' }],
    },
  },

  css: [
    // MUST be first so the layer order is established before vuetify ships its layers
    '@/assets/css/layer-order.css',
    'vuetify/styles',
    '@mdi/font/css/materialdesignicons.css',
  ],

  runtimeConfig: {
    public: {
      appVersion: pkg.version,
    },
  },

  build: {
    transpile: ['vuetify'],
  },
  compatibilityDate: '2025-07-15',

  nitro: {
    // Keep native bindings out of the bundle
    rollupConfig: {
      external: ['better-sqlite3'],
    },
  },

  vite: {
    ssr: {
      noExternal: ['vuetify'],
    },
  },
  hooks: {
    'vite:extendConfig': (config) => {
      // Only the Vuetify components the templates use end up in the bundle
      config.plugins?.push(vuetify({ autoImport: true }))
    },
  },

  eslint: {
    config: {
      stylistic: {
        indent: 2,
        quotes: 'single',
        semi: false,
      },
    },
  },
})
