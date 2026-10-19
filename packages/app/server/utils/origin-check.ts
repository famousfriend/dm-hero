// Cross-site request guard. The local API has no login, so any web page open in
// the DM's browser could otherwise submit a plain HTML form to it (e.g. create or
// delete records, restore a backup). Browsers always send Origin and
// Sec-Fetch-Site on such requests; the app itself, the MCP server and the
// Electron main process either send a matching Origin or none at all.

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS'])

export interface OriginCheckInput {
  method: string
  origin?: string | null
  secFetchSite?: string | null
  host?: string | null
  forwardedHost?: string | null
  allowedOrigins?: string[]
}

export function isCrossSiteWrite(req: OriginCheckInput): boolean {
  if (SAFE_METHODS.has(req.method.toUpperCase())) return false
  if (req.secFetchSite === 'cross-site') return true
  if (!req.origin) return false

  let originHost: string
  try {
    originHost = new URL(req.origin).host
  }
  catch {
    return true // "null" (sandboxed iframe, file://) or garbage
  }
  if (req.allowedOrigins?.includes(req.origin)) return false
  const hosts = [req.host, ...(req.forwardedHost?.split(',').map(h => h.trim()) ?? [])].filter(Boolean)
  return !hosts.includes(originHost)
}

export function getAllowedOrigins(): string[] {
  return (process.env.DM_HERO_ALLOWED_ORIGINS ?? '')
    .split(',')
    .map(o => o.trim())
    .filter(Boolean)
}
