import { timingSafeEqual } from 'crypto'
import type { NextFunction, Request, Response } from 'express'

/**
 * Protezione di GET /metrics (fuori dal prefisso api/v1, quindi fuori da ogni guard).
 *
 * - METRICS_TOKEN impostato: serve `Authorization: Bearer <token>`, altrimenti 401.
 * - METRICS_TOKEN assente e METRICS_REQUIRE_TOKEN=true (server infra-prod): l'endpoint
 *   risponde 404, cosi' una configurazione dimenticata non lo espone mai.
 * - Entrambe assenti: comportamento storico (nessun controllo; sul VPS Contabo lo isola
 *   nginx, che inoltra solo /api/).
 */
export function proteggiMetriche(env: NodeJS.ProcessEnv = process.env) {
  const token = (env.METRICS_TOKEN ?? '').trim()
  const obbligatorio = (env.METRICS_REQUIRE_TOKEN ?? '').trim().toLowerCase() === 'true'
  const atteso = Buffer.from(token)

  return (req: Request, res: Response, next: NextFunction): void => {
    if (token === '') {
      if (!obbligatorio) return next()
      res.status(404).end()
      return
    }
    const m = /^Bearer (.+)$/.exec(req.headers.authorization ?? '')
    const dato = Buffer.from(m ? m[1] : '')
    if (dato.length === atteso.length && timingSafeEqual(dato, atteso)) return next()
    res.status(401).set('WWW-Authenticate', 'Bearer').end()
  }
}
