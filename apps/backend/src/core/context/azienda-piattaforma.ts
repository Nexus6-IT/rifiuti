import type { Prisma } from '@prisma/client'

/**
 * Azienda tecnica "piattaforma" (migration 20261026110000_azienda_piattaforma).
 *
 * Riceve nell'audit le azioni del super admin compiute SENZA un'azienda selezionata
 * (le righe di `permission_audit_logs` sono per azienda, con catena di hash per azienda).
 * Non e' un cliente: non ha utenti, piano a pagamento, credenziali RENTRI ne' dati.
 *
 * Va esclusa da ogni elenco, conteggio, cron e cruscotto: usare `escludiPiattaforma` in ogni
 * lettura o iterazione di `tenants`. Le uniche letture che la vedono sono quelle dell'audit
 * del super admin, che la seleziona con `X-Tenant-ID`.
 */
export const AZIENDA_PIATTAFORMA_ID = '00000000-0000-4000-8000-000000000001'

/** Compone un `where` su `Tenant` con l'esclusione dell'azienda piattaforma (non muta l'input). */
export function escludiPiattaforma(where?: Prisma.TenantWhereInput): Prisma.TenantWhereInput {
  const filtro: Prisma.TenantWhereInput = { id: { not: AZIENDA_PIATTAFORMA_ID } }
  if (!where || Object.keys(where).length === 0) return filtro
  return { AND: [where, filtro] }
}

/** Toglie l'azienda piattaforma da un elenco di id. */
export function escludiPiattaformaDaId(ids: string[]): string[] {
  return ids.filter(id => id !== AZIENDA_PIATTAFORMA_ID)
}
