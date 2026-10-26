import 'reflect-metadata'
import { ROUTE_ARGS_METADATA } from '@nestjs/common/constants'
import type { ExecutionContext } from '@nestjs/common'

/**
 * Risolve i parametri CUSTOM (createParamDecorator) di un handler, come farebbe Nest,
 * partendo da una richiesta finta. Restituisce un array indicizzato per posizione del
 * parametro (i parametri non custom, es. @Param/@Body, restano undefined).
 * Serve a provare che il controller riceve l'azienda che il decoratore risolve.
 */
export function argomentiCustom(
  controller: new (...args: any[]) => unknown,
  metodo: string,
  request: unknown
): unknown[] {
  const meta = Reflect.getMetadata(ROUTE_ARGS_METADATA, controller, metodo) ?? {}
  const ctx = { switchToHttp: () => ({ getRequest: () => request }) } as unknown as ExecutionContext
  const out: unknown[] = []
  for (const m of Object.values<any>(meta)) {
    if (typeof m.factory === 'function') out[m.index] = m.factory(m.data, ctx)
  }
  return out
}
