import type { NextFunction, Request, RequestHandler, Response } from 'express'
import { json } from 'express'

/**
 * Parser JSON con un limite proprio, da montare su UNA rotta prima del parser globale.
 *
 * Perche' un involucro e non `json(...)` diretto: all'avvio Nest controlla se nello stack di
 * express c'e' gia' un middleware di nome `jsonParser` e, se lo trova, NON registra il parser
 * globale. Un `app.use(percorso, json(...))` ha proprio quel nome, quindi spegneva il parser di
 * tutte le altre rotte: ogni body JSON arrivava vuoto (400 «email must be an email» sul login,
 * trovato dall'e2e dei ritiri). L'involucro e' anonimo: il parser globale resta registrato.
 */
export function jsonConLimite(limite: string): RequestHandler {
  const parser = json({ limit: limite })
  return (req: Request, res: Response, next: NextFunction) => parser(req, res, next)
}
