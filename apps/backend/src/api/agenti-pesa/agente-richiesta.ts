import { createParamDecorator, type ExecutionContext } from '@nestjs/common'
import type { Request } from 'express'

/**
 * Agente di pesa che ha presentato il token, risolto da `AgentePesaGuard`.
 * Le rotte dell'agente NON hanno utente: `req.user` e `req.tenantId` restano intatti (vuoti).
 */
export interface AgenteCorrenteDati {
  id: string
  tenantId: string
}

export type RichiestaConAgente = Request & { agentePesa?: AgenteCorrenteDati }

/** Parametro `@AgenteCorrente()`: l'agente autenticato dal token; errore se il guard non e' passato. */
export const AgenteCorrente = createParamDecorator(
  (_dati: unknown, ctx: ExecutionContext): AgenteCorrenteDati => {
    const agente = ctx.switchToHttp().getRequest<RichiestaConAgente>().agentePesa
    if (!agente) throw new Error('AgenteCorrente: AgentePesaGuard non applicato alla rotta.')
    return agente
  }
)
