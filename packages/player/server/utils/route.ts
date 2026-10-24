import type Database from 'better-sqlite3'
import { getDb } from './db'
import { RouteError, type RouteRequest } from './characters'

/** One catch-all route per feature: parse the request, map RouteError to HTTP */
export function catchAllRoute(handler: (db: Database.Database, req: RouteRequest) => unknown) {
  return defineEventHandler(async (event) => {
    const method = event.method
    const body = ['POST', 'PATCH', 'PUT'].includes(method) ? ((await readBody(event)) ?? {}) : null
    try {
      return handler(getDb(), {
        method,
        segments: (getRouterParam(event, 'path') ?? '').split('/').filter(Boolean),
        body,
      })
    }
    catch (error) {
      if (error instanceof RouteError) throw createError({ statusCode: error.statusCode, message: error.message })
      throw error
    }
  })
}
