// Suffisso del numero di fattura sul registro IVA (4.4a, spec §4.10 e S9). `numero_testo` del
// documento e' il numero piu' il suffisso del registro (`15/A`): il suffisso finisce nell'XML, quindi
// non si cambia piu' quando il registro ha gia' un definitivo nell'anno in corso.
import { ConflictException } from '@nestjs/common'
import { Prisma, PrismaClient } from '@prisma/client'
import { bloccaNumerazioni, oggiRoma } from './numerazione'

type Client = PrismaClient | Prisma.TransactionClient

/** 1-10 caratteri fra lettere, cifre, `/` e `-`: quelli che l'XSD accetta in `Numero`. */
export const SUFFISSO_REGEX = /^[A-Za-z0-9/-]{1,10}$/

export const MSG_SUFFISSO_NON_VALIDO =
  'Il suffisso del numero può avere da 1 a 10 caratteri: lettere, cifre, barra e trattino.'

/** `null` (nessun suffisso) e' valido; un testo deve rispettare `SUFFISSO_REGEX`. */
export function suffissoValido(s: string | null): boolean {
  return s === null || SUFFISSO_REGEX.test(s)
}

/** Anno della data italiana corrente (a cavallo di mezzanotte l'UTC darebbe quello sbagliato). */
export function annoCorrente(adesso: Date = new Date()): number {
  return Number(oggiRoma(adesso).slice(0, 4))
}

/**
 * Tra gli id dati, quelli che hanno un `DEFINITIVO` nell'anno. Una sola query, senza lock: serve
 * a mostrare `suffissoModificabile` in lista; la scrittura rilegge sotto lock.
 */
export async function registriConDefinitivoNellAnno(
  client: Client,
  tenantId: string,
  ids: readonly string[],
  anno: number
): Promise<Set<string>> {
  if (ids.length === 0) return new Set()
  const righe = await client.$queryRaw<{ id: string }[]>`
    SELECT DISTINCT registro_iva_id::text AS id FROM "documenti_fattura"
    WHERE tenant_id = ${tenantId}::uuid AND anno = ${anno}::int AND stato = 'DEFINITIVO'
      AND registro_iva_id = ANY(${[...ids]}::uuid[])`
  return new Set(righe.map(r => r.id))
}

/**
 * Prende il lock `FOR UPDATE` della numerazione della coppia (registro, anno corrente): lo stesso
 * di `riservaNumeri`, quindi una riserva aperta fa aspettare il cambio e chi numera dopo vede il
 * suffisso nuovo. Poi, SOTTO il lock, rifiuta con 409 `SUFFISSO_NON_MODIFICABILE` se il registro ha
 * un `DEFINITIVO` nell'anno. Va chiamata dentro la transazione che scrive il suffisso, PRIMA di
 * bloccare la riga del registro (ordine dei lock della spec §8: numerazioni prima).
 *
 * La riga della numerazione si crea se manca (`bloccaNumerazioni`): serve il lock anche quando
 * nessuno ha ancora numerato. Un registro senza riga e' invece "senza definitivi".
 */
export async function controllaSuffissoModificabile(
  tx: Prisma.TransactionClient,
  tenantId: string,
  registroIvaId: string,
  adesso: Date = new Date()
): Promise<void> {
  const anno = annoCorrente(adesso)
  await bloccaNumerazioni(tx, tenantId, [{ registroIvaId, anno }])
  const ha = await registriConDefinitivoNellAnno(tx, tenantId, [registroIvaId], anno)
  if (ha.size > 0) {
    throw new ConflictException({
      error: 'SUFFISSO_NON_MODIFICABILE',
      message: `Il registro ha già fatture definitive nel ${anno}: il suffisso non si cambia fino all'anno nuovo.`,
    })
  }
}
