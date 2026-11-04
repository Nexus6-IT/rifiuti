// Scrittura della proposta del legame (fase 4.3, spec §4.2-§4.3). E' l'UNICO punto del Task 15
// che scrive: una testata in `legami_movimento` e le sue righe in `righe_legame_movimento`. Mai una
// scrittura su `waste_movements` (lo verifica `guardia-registro.spec.ts`).
//
// Non prende lock: l'ordine (registro -> advisory della radice -> listino FOR SHARE) lo rispetta
// il chiamante (`PropostaLegameService.proponiEScrivi`). Nel registro gira dentro un SAVEPOINT
// (Task 20): qui gli errori escono tradotti, non decide il savepoint.
import { ConflictException } from '@nestjs/common'
import { Prisma } from '@prisma/client'
import { MSG_OPERAZIONE_CONCORRENTE } from '../clienti/anagrafica-versionata'
import type { StatoLegame } from '../../domain/legami-movimento/codici'
import type { PropostaVista } from './proposta-legame.service'

export interface ScritturaProposta {
  tenantId: string
  userId: string | null
  registroId: string
  verso: 'CARICO' | 'SCARICO'
  /** Radice della catena (la ORDINARIA). */
  movimentoOriginaleId: string
  movimentoVigenteId: string
  /** Giorno italiano del movimento vigente, `AAAA-MM-GG`. */
  dataMovimento: string
  proposta: PropostaVista
  /**
   * Registrazione con «Conferma legame»: una proposta completa nasce direttamente `CONFERMATO`
   * (`confermato_il`/`confermato_da`, righe congelate). Una proposta con motivi resta com'e'.
   */
  conferma?: boolean
}

/** L'aliquota e' sempre copiata dal listino: un `null` qui e' un errore di programma, non un dato. */
function aliquotaObbligatoria(a: string | null): string {
  if (a === null) throw new Error('scriviProposta: aliquota IVA mancante')
  return a
}

/** Violazione di chiave esterna (23503) vista da Prisma su una query grezza o tipizzata. */
export function eViolazioneFk(err: unknown): boolean {
  if (!(err instanceof Prisma.PrismaClientKnownRequestError)) return false
  const codiceDb = (err.meta as { code?: unknown } | undefined)?.code
  return err.code === 'P2003' || codiceDb === '23503'
}

/**
 * Scrive testata e righe della proposta e restituisce l'id del legame. Se la catena ha gia' un
 * legame (unico `(tenant_id, movimento_originale_id)`: retry, due richieste insieme) restituisce
 * quello esistente senza toccarlo e senza errore. Una chiave esterna che salta perche' cliente,
 * contratto, elenco o riga sono spariti fra la lettura e la scrittura (23503) e' un 409
 * `OPERAZIONE_CONCORRENTE`, non un 500 (nota m2 del Task 14).
 */
export async function scriviProposta(
  tx: Prisma.TransactionClient,
  c: ScritturaProposta
): Promise<{ legameId: string; stato: StatoLegame | null }> {
  const p = c.proposta
  if (!p.fatturabile || !p.attiva || p.stato === 'ESCLUSO') {
    throw new Error(
      'scriviProposta: la proposta virtuale ESCLUSO (non fatturabile o non attiva) non si scrive'
    )
  }
  // Un PROPOSTO e' per definizione completo e senza motivi: confermabile.
  const confermato = c.conferma === true && p.stato === 'PROPOSTO'
  const stato: StatoLegame = confermato ? 'CONFERMATO' : p.stato
  try {
    const inserito = await tx.$queryRaw<{ id: string }[]>`
      INSERT INTO legami_movimento
        (tenant_id, registro_id, verso, movimento_originale_id, movimento_vigente_id, stato,
         data_movimento, cliente_id, fonte_cliente, contratto_id, elenco_id, motivi, avvisi,
         creato_da, confermato_il, confermato_da, updated_at)
      VALUES
        (${c.tenantId}::uuid, ${c.registroId}::uuid, ${c.verso}::waste_movement_type,
         ${c.movimentoOriginaleId}::uuid, ${c.movimentoVigenteId}::uuid,
         ${stato}::stato_legame_movimento, ${c.dataMovimento}::date,
         ${p.cliente?.id ?? null}::uuid, ${p.cliente?.fonte ?? null}::fonte_cliente_legame,
         ${p.contratto?.id ?? null}::uuid, ${p.elenco?.id ?? null}::uuid,
         ${p.motivi}::text[], ${p.avvisi}::text[], ${c.userId}::uuid,
         ${confermato ? new Date() : null}::timestamptz, ${confermato ? c.userId : null}::uuid, now())
      ON CONFLICT (tenant_id, movimento_originale_id) DO NOTHING
      RETURNING id::text AS id`
    if (inserito.length === 0) {
      const esistente = await tx.$queryRaw<{ id: string }[]>`
        SELECT id::text AS id FROM legami_movimento
        WHERE tenant_id = ${c.tenantId}::uuid
          AND movimento_originale_id = ${c.movimentoOriginaleId}::uuid`
      if (esistente.length === 0) {
        throw new Error('scriviProposta: il legame della catena non si trova dopo il conflitto')
      }
      return { legameId: esistente[0].id, stato: null }
    }
    const legameId = inserito[0].id
    if (p.elenco && p.righe.length > 0) {
      const adesso = new Date()
      await tx.rigaLegameMovimento.createMany({
        data: p.righe.map(r => ({
          tenantId: c.tenantId,
          legameId,
          elencoId: p.elenco!.id,
          rigaAddebitoId: r.rigaAddebitoId,
          ordine: r.ordine,
          origine: r.origine,
          tipo: r.tipo,
          descrizione: r.descrizione,
          tipoQuantita: r.tipoQuantita as Prisma.RigaLegameMovimentoCreateManyInput['tipoQuantita'],
          unitaMisura: r.unitaMisura,
          quantita: r.quantita,
          quantitaOrigine: r.quantitaOrigine,
          prezzoSpeciale: r.prezzoSpeciale,
          prezzo: r.prezzo,
          sconto: r.sconto,
          prezzoManuale: r.prezzoManuale,
          codiceIvaId: r.codiceIvaId,
          aliquotaIva: aliquotaObbligatoria(r.aliquotaIva),
          naturaIva: r.naturaIva,
          congelataIl: confermato ? adesso : null,
        })),
      })
    }
    return { legameId, stato }
  } catch (err) {
    if (eViolazioneFk(err)) {
      throw new ConflictException({
        error: 'OPERAZIONE_CONCORRENTE',
        message: MSG_OPERAZIONE_CONCORRENTE,
      })
    }
    throw err
  }
}
