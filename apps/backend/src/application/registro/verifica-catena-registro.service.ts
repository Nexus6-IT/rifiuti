import { Injectable } from '@nestjs/common'
import { PrismaService } from '../../infrastructure/persistence/prisma.service'
import { WasteMovement, hashAnnotazioneV2 } from '../../domain/waste-movement/waste-movement.entity'

export type MotivoErroreCatena = 'HASH_DIVERSO' | 'VERSIONE_SCONOSCIUTA' | 'BUCO'

export interface EsitoVerificaCatena {
  /** Annotazioni il cui hash e' stato ricalcolato e coincide, prima dell'eventuale errore. */
  verificate: number
  /** Righe con `entry_hash` vuoto (storico): non e' un'alterazione, non interrompono la catena. */
  nonVerificabili: Array<{ numero: number; motivo: 'HASH_ASSENTE' }>
  /** Il primo problema trovato (la verifica si ferma li'); null se la catena e' integra. */
  primoErrore: { numero: number; motivo: MotivoErroreCatena } | null
}

/**
 * Verifica dell'integrita' del registro di un anno (R8): ricalcola l'hash di ogni annotazione
 * in ordine di progressivo e controlla che non manchino numeri.
 *
 * - v1 (righe storiche): hash sui campi della riga, con la quantita' nel formato di allora
 *   (`Number(decimal).toString()`); non e' concatenata.
 * - v2: concatenata, usa come `hashPrecedente` l'`entry_hash` SALVATO della riga che la precede
 *   (anche `''`), quindi una riga alterata si vede sul proprio numero e non a cascata.
 * - `entry_hash = ''` non e' verificabile: si segnala e si prosegue.
 *
 * Solo lettura, nessun lock: una registrazione concorrente al piu' non e' ancora vista.
 */
@Injectable()
export class VerificaCatenaRegistroService {
  constructor(private readonly prisma: PrismaService) {}

  async verifica(tenantId: string, registroId: string, anno: number): Promise<EsitoVerificaCatena> {
    const [righe, iniziale] = await Promise.all([
      this.prisma.wasteMovement.findMany({
        where: { tenantId, registroId, progressiveYear: anno },
        orderBy: { progressiveNumber: 'asc' },
      }),
      this.prisma.registroProgressivoIniziale.findUnique({
        where: { registroId_anno: { registroId, anno } },
        select: { primoProgressivo: true },
      }),
    ])

    const esito: EsitoVerificaCatena = { verificate: 0, nonVerificabili: [], primoErrore: null }
    if (righe.length === 0) return esito

    let atteso = iniziale?.primoProgressivo ?? righe[0].progressiveNumber
    let hashPrecedente = ''
    for (const r of righe) {
      if (r.progressiveNumber !== atteso) {
        esito.primoErrore = { numero: atteso, motivo: 'BUCO' }
        return esito
      }
      atteso = r.progressiveNumber + 1

      if (r.entryHash === '') {
        esito.nonVerificabili.push({ numero: r.progressiveNumber, motivo: 'HASH_ASSENTE' })
      } else {
        let ricalcolato: string
        if (r.hashVersione === 1) {
          ricalcolato = WasteMovement.computeHash({
            tenantId: r.tenantId,
            progressiveYear: r.progressiveYear,
            progressiveNumber: r.progressiveNumber,
            type: r.type,
            cerCode: r.cerCode,
            quantity: Number(r.quantity),
            movementDate: r.movementDate,
            causale: r.causale as never,
          })
        } else if (r.hashVersione === 2) {
          ricalcolato = hashAnnotazioneV2({
            hashPrecedente,
            registroId: r.registroId,
            anno: r.progressiveYear,
            numero: r.progressiveNumber,
            tipoAnnotazione: r.tipoAnnotazione,
            movimentoRettificatoId: r.movimentoRettificatoId,
            type: r.type,
            cerCode: r.cerCode,
            quantita: r.quantity,
            unit: r.unit,
            movementDate: r.movementDate,
            causale: r.causale,
          })
        } else {
          esito.primoErrore = { numero: r.progressiveNumber, motivo: 'VERSIONE_SCONOSCIUTA' }
          return esito
        }
        if (ricalcolato !== r.entryHash) {
          esito.primoErrore = { numero: r.progressiveNumber, motivo: 'HASH_DIVERSO' }
          return esito
        }
        esito.verificate++
      }
      hashPrecedente = r.entryHash
    }
    return esito
  }
}
