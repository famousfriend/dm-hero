import { getAllowedOrigins, isCrossSiteWrite } from '../utils/origin-check'

export default defineEventHandler((event) => {
  // The TaleSpire panel calls from TaleSpire's own browser; it is checked by its key instead
  if (event.path.startsWith('/talespire-api/')) return
  const headers = event.node.req.headers
  const blocked = isCrossSiteWrite({
    method: event.method,
    origin: headers.origin,
    secFetchSite: headers['sec-fetch-site'] as string | undefined,
    host: headers.host,
    forwardedHost: headers['x-forwarded-host'] as string | undefined,
    allowedOrigins: getAllowedOrigins(),
  })
  if (blocked) {
    throw createError({ statusCode: 403, message: 'Cross-site request blocked' })
  }
})
