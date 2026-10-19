import { config, XSSPlugin } from 'md-editor-v3'

// Raw HTML inside markdown (session notes, entity documents, imported campaigns,
// AI imports) is filtered through md-editor's built-in XSS plugin (the `xss`
// whitelist: no scripts, no event handlers). Entity badges are added afterwards
// by each component's sanitize hook and are not affected.
export default defineNuxtPlugin(() => {
  config({
    markdownItPlugins(plugins) {
      return [...plugins, { type: 'xss', plugin: XSSPlugin, options: {} }]
    },
  })
})
