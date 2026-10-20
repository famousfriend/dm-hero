import { defineAsyncComponent } from 'vue'

/*
 * md-editor-v3 (with CodeMirror) is big, so it is loaded the first time an
 * editor or a preview is shown instead of at startup. Raw HTML inside markdown
 * (session notes, entity documents, imported campaigns, AI imports) is filtered
 * through md-editor's built-in XSS plugin (the `xss` whitelist: no scripts, no
 * event handlers). It is configured here, before any editor or preview renders,
 * so every component must get md-editor through this file. Entity badges are
 * added afterwards by each component's sanitize hook and are not affected.
 */
let loading: Promise<typeof import('md-editor-v3')> | null = null

export function loadMdEditor() {
  loading ??= import('md-editor-v3').then((md) => {
    md.config({
      markdownItPlugins(plugins) {
        return [...plugins, { type: 'xss', plugin: md.XSSPlugin, options: {} }]
      },
    })
    return md
  })
  return loading
}

export const LazyMdEditor = defineAsyncComponent(() => loadMdEditor().then(md => md.MdEditor))
export const LazyMdPreview = defineAsyncComponent(() => loadMdEditor().then(md => md.MdPreview))
export const LazyNormalToolbar = defineAsyncComponent(() => loadMdEditor().then(md => md.NormalToolbar))
