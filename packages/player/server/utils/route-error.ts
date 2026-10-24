export class RouteError extends Error {
  constructor(public statusCode: number, message: string) {
    super(message)
  }
}

export interface RouteRequest {
  method: string
  /** Path below /api/<feature>, split on "/" */
  segments: string[]
  query?: Record<string, unknown>
  body: Record<string, unknown> | null
}
