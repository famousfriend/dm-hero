import { nameFromSlug } from '~~/types/codex'
import { escapeHtml } from './escapeHtml'

// Same shape as codexTokenRegex() in types/codex.ts, but matched against rendered
// HTML, where an apostrophe may arrive escaped (&#39;) or curled (’).
const HTML_TOKEN_REGEX = /\{\{codex:([a-z]+):((?:[a-z0-9 /(),.\-']|&#39;|&#x27;|’)+)\|([a-z0-9]+)\}\}/g

const KIND_STYLE: Record<string, { color: string, icon: string }> = {
  spell: { color: '#6A4FB6', icon: 'mdi-auto-fix' },
  monster: { color: '#A63D40', icon: 'mdi-paw' },
  condition: { color: '#B26A00', icon: 'mdi-alert-circle-outline' },
}
const DEFAULT_STYLE = { color: '#5C6B7A', icon: 'mdi-book-open-page-variant' }

/**
 * Turns {{codex:kind:slug|source}} tokens in rendered markdown HTML into clickable
 * chips (handled globally by CodexSidebar). Call from a component's md-editor
 * `sanitize` hook after entity badges are rendered.
 *
 * @param resolveName optional lookup for the entry's real name; falls back to the slug
 */
export function renderCodexChips(html: string, resolveName?: (uid: string) => string | undefined): string {
  // Tokens inside attribute values (e.g. heading ids) are removed, not rendered,
  // so a chip never ends up inside an attribute.
  const result = html.replace(/(=")([^"]*)(")/g, (match, open: string, value: string, close: string) =>
    value.includes('{{codex:') ? open + value.replace(HTML_TOKEN_REGEX, '').replace(/--+/g, '-') + close : match,
  )

  return result.replace(HTML_TOKEN_REGEX, (_match, kind: string, rawSlug: string, source: string) => {
    const slug = rawSlug.replace(/&#39;|&#x27;|’/g, '\'')
    const uid = `${kind}:${slug}|${source}`
    const style = KIND_STYLE[kind] || DEFAULT_STYLE
    const name = escapeHtml(resolveName?.(uid) || nameFromSlug(slug))
    return `<span class="codex-chip" data-uid="${escapeHtml(uid)}" title="${escapeHtml(`${kind} · ${source.toUpperCase()}`)}" style="background-color: ${style.color}; color: white; padding: 2px 8px; border-radius: 12px; font-size: 0.875rem; display: inline-flex; align-items: center; gap: 4px; cursor: pointer;"><i class="mdi ${style.icon}"></i>${name}</span>`
  })
}
