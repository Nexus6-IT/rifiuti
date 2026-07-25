import { FastifyReply } from 'fastify'

/**
 * `ProblemDetails` come definito dal contratto ufficiale
 * (`docs/contracts/rentri/formulari.yaml`, componente `ProblemDetails`,
 * righe 9999-10018): `type`/`title`/`status`/`detail`/`instance`, servito
 * come `application/problem+json` su ogni risposta di errore documentata.
 * La fake precedente rispondeva `{titolo, dettaglio}` in `application/json`,
 * chiavi italiane che non esistono in alcuno schema del contratto.
 */
export interface ProblemDetails {
  type?: string | null
  title?: string | null
  status?: number | null
  detail?: string | null
  instance?: string | null
}

export async function inviaProblemDetails(
  risposta: FastifyReply,
  status: number,
  problema: Omit<ProblemDetails, 'status'>
): Promise<void> {
  const corpo: ProblemDetails = { status, ...problema }
  await risposta.status(status).type('application/problem+json').send(corpo)
}
