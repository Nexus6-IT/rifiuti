import { Injectable, Logger } from '@nestjs/common'
import { Prisma } from '@prisma/client'
import { chiavePubblicaDaBase64 } from '../../../domain/pese/agenti/credenziali-agente'
import {
  leggiPayloadLettura,
  type PayloadLettura,
} from '../../../domain/pese/agenti/payload-lettura'
import {
  MESSAGGI_RIFIUTO,
  avvisiLettura,
  valutaLettura,
  type CodiceRifiuto,
} from '../../../domain/pese/agenti/regole-lettura'
import { PrismaService } from '../../../infrastructure/persistence/prisma.service'
import { AgentePesaNonTrovatoError, LottoOltreTempoError } from '../errori-pese'
import { nelContestoTenant } from '../nel-contesto-tenant'

export interface ElementoLettura {
  /** byte esatti firmati, base64 standard */
  payload: string
  /** firma Ed25519 di 64 byte, base64 standard */
  firma: string
}

export type EsitoElemento =
  | {
      chiaveIdempotenza: string | null
      esito: 'ACCETTATA' | 'GIA_RICEVUTA'
      letturaId: string
      avvisi?: string[]
    }
  | {
      chiaveIdempotenza: string | null
      esito: 'RIFIUTATA'
      codice: CodiceRifiuto
      messaggio: string
      /** solo con `SEQUENZA_GIA_USATA`: ultima sequenza nota al server, da cui l'agente riparte */
      ultimaSequenza?: number
    }

/** Tempo massimo per un lotto: oltre, si interrompe con 503 (mai `RIFIUTATA` per un timeout). */
export const MS_MASSIMI_LOTTO = 10_000
/** Al piu' un audit di firma non valida ogni 10 minuti per agente (il resto va nel log). */
export const MS_TRA_AUDIT_FIRMA = 10 * 60_000

const rifiutata = (
  chiaveIdempotenza: string | null,
  codice: CodiceRifiuto,
  messaggio = MESSAGGI_RIFIUTO[codice]
): EsitoElemento => ({ chiaveIdempotenza, esito: 'RIFIUTATA', codice, messaggio })

/**
 * Ultima sequenza nota per un agente: il massimo fra il valore registrato (battiti e letture) e le
 * letture presenti; 0 se non ce ne sono. Serve all'agente per riallinearsi (review B4-B7, I2).
 */
export async function ultimaSequenzaNota(
  db: Pick<Prisma.TransactionClient, 'agentePesa' | 'letturaPesa'>,
  agente: { id: string; tenantId: string }
): Promise<number> {
  const [riga, max] = await Promise.all([
    db.agentePesa.findFirst({
      where: { id: agente.id, tenantId: agente.tenantId },
      select: { ultimaSequenza: true },
    }),
    db.letturaPesa.aggregate({
      where: { agenteId: agente.id, tenantId: agente.tenantId },
      _max: { sequenza: true },
    }),
  ])
  return Number(
    [riga?.ultimaSequenza ?? BigInt(0), max._max.sequenza ?? BigInt(0)].reduce((a, b) =>
      a > b ? a : b
    )
  )
}

const eUnico = (err: unknown): boolean =>
  err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002'

/**
 * Ingresso delle letture firmate (D7, D8). Per elemento: firma con la chiave dell'agente (letta una
 * volta per lotto, nel contesto dell'azienda del token) -> payload -> regole -> idempotenza -> INSERT
 * in una transazione PROPRIA (un rifiuto non annulla gli altri). L'azienda e' sempre quella del
 * token; lo strumento del payload si cerca SOLO li' (RLS) e deve essere assegnato all'agente.
 */
@Injectable()
export class IngressoLettureService {
  private readonly logger = new Logger(IngressoLettureService.name)
  private readonly ultimoAuditFirma = new Map<string, number>()
  /** Orologio sostituibile nelle prove (limite di tempo del lotto e finestra dell'audit). */
  orologio: () => number = () => Date.now()

  constructor(private readonly prisma: PrismaService) {}

  async riceviLotto(
    agente: { id: string; tenantId: string },
    elementi: readonly ElementoLettura[],
    ricezione: Date
  ): Promise<EsitoElemento[]> {
    const inizio = this.orologio()
    return nelContestoTenant(agente.tenantId, async () => {
      const contesto = await this.leggiContesto(agente)
      const chiave = chiavePubblicaDaBase64(contesto.chiavePubblica)
      if (!chiave) throw new AgentePesaNonTrovatoError()
      const esiti: EsitoElemento[] = []
      for (const el of elementi) {
        if (this.orologio() - inizio > MS_MASSIMI_LOTTO) throw new LottoOltreTempoError()
        esiti.push(await this.elemento(agente, chiave, contesto.simulazioneAmmessa, el, ricezione))
      }
      return esiti
    })
  }

  private async leggiContesto(agente: { id: string; tenantId: string }) {
    const [riga, azienda] = await Promise.all([
      this.prisma.agentePesa.findFirst({
        where: { id: agente.id, tenantId: agente.tenantId, stato: 'ATTIVO' },
        select: { chiavePubblica: true },
      }),
      this.prisma.tenant.findUnique({
        where: { id: agente.tenantId },
        select: { peseSimulazioneAmmessa: true },
      }),
    ])
    if (!riga?.chiavePubblica || !azienda) throw new AgentePesaNonTrovatoError()
    return {
      chiavePubblica: riga.chiavePubblica,
      simulazioneAmmessa: azienda.peseSimulazioneAmmessa,
    }
  }

  private async elemento(
    agente: { id: string; tenantId: string },
    chiave: ReturnType<typeof chiavePubblicaDaBase64> & object,
    simulazioneAmmessa: boolean,
    el: ElementoLettura,
    ricezione: Date
  ): Promise<EsitoElemento> {
    const letto = leggiPayloadLettura(el.payload, el.firma, chiave)
    if (!letto.ok) {
      if (letto.codice === 'FIRMA_NON_VALIDA') await this.firmaNonValida(agente)
      return rifiutata(null, letto.codice)
    }
    const p = letto.payload
    // I byte conservati sono quelli verificati (nessuna ricodifica): la firma si riverifica sempre.
    const testo = letto.bytes.toString('utf8')

    const rapido = await this.giaRicevuta(agente, p, testo)
    if (rapido) return rapido

    try {
      return await this.prisma.$transaction(async tx => {
        const strumento = await tx.strumentoPesa.findFirst({
          where: { id: p.strumentoId, tenantId: agente.tenantId },
          select: { id: true, agenteId: true, attivo: true, portataMaxKg: true },
        })
        const v = valutaLettura(p, {
          agenteId: agente.id,
          strumento: strumento && {
            id: strumento.id,
            agenteId: strumento.agenteId,
            attivo: strumento.attivo,
            portataMaxKg: strumento.portataMaxKg === null ? null : Number(strumento.portataMaxKg),
          },
          simulazioneAmmessa,
          ricezione,
        })
        if (v.esito === 'RIFIUTATA') return rifiutata(p.chiaveIdempotenza, v.codice, v.messaggio)

        // L'alibi di una pesata MANUALE dello stesso strumento non e' visto dall'unico delle letture:
        // lo si controlla qui, cosi' non entra una lettura che poi non si potrebbe usare.
        if (p.alibiId) {
          const usato = await tx.pesata.findFirst({
            where: { tenantId: agente.tenantId, strumentoId: p.strumentoId, alibiId: p.alibiId },
            select: { id: true },
          })
          if (usato) return rifiutata(p.chiaveIdempotenza, 'ALIBI_GIA_USATO')
        }

        const riga = await tx.letturaPesa.create({
          data: {
            tenantId: agente.tenantId,
            agenteId: agente.id,
            strumentoId: p.strumentoId,
            chiaveIdempotenza: p.chiaveIdempotenza,
            sequenza: BigInt(p.sequenza),
            pesoKg: p.pesoKg,
            stabile: p.stabile,
            alibiId: p.alibiId,
            oraStrumento: p.oraStrumento,
            oraAgente: p.oraAgente,
            oraRicezione: ricezione,
            driver: p.driver,
            simulata: p.simulata,
            payload: testo,
            firma: el.firma,
          },
          select: { id: true },
        })
        // La sequenza non regredisce (lotti paralleli o ritrasmessi fuori ordine).
        await tx.agentePesa.updateMany({
          where: {
            id: agente.id,
            tenantId: agente.tenantId,
            OR: [{ ultimaSequenza: null }, { ultimaSequenza: { lt: BigInt(p.sequenza) } }],
          },
          data: { ultimaSequenza: BigInt(p.sequenza) },
        })
        const avvisi = avvisiLettura({
          oraAgente: p.oraAgente,
          oraStrumento: p.oraStrumento,
          oraRicezione: ricezione,
          simulata: p.simulata,
        })
        return {
          chiaveIdempotenza: p.chiaveIdempotenza,
          esito: 'ACCETTATA' as const,
          letturaId: riga.id,
          ...(avvisi.length ? { avvisi } : {}),
        }
      })
    } catch (err) {
      if (!eUnico(err)) throw err
      // Prisma non dice QUALE unico e' stato violato (`meta.target` nullo con le transazioni
      // interattive): lo si ricava rileggendo, fuori dalla transazione fallita.
      const gia = await this.giaRicevuta(agente, p, testo)
      if (gia) return gia
      if (p.alibiId) {
        const alibi = await this.prisma.letturaPesa.findFirst({
          where: { strumentoId: p.strumentoId, alibiId: p.alibiId },
          select: { id: true },
        })
        if (alibi) return rifiutata(p.chiaveIdempotenza, 'ALIBI_GIA_USATO')
      }
      // Stessa sequenza, chiave e contenuto diversi (la stessa lettura sarebbe GIA_RICEVUTA, sopra):
      // l'agente ha perso il contatore. Codice proprio, con l'ultima sequenza nota, cosi' il client
      // si riallinea e ri-numera la lettura invece di scartarla. La lettura NON e' accettata.
      return {
        chiaveIdempotenza: p.chiaveIdempotenza,
        esito: 'RIFIUTATA',
        codice: 'SEQUENZA_GIA_USATA',
        messaggio: MESSAGGI_RIFIUTO.SEQUENZA_GIA_USATA,
        ultimaSequenza: await ultimaSequenzaNota(this.prisma, agente),
      }
    }
  }

  /** Stessa chiave: stesso payload = `GIA_RICEVUTA`, payload diverso = `CHIAVE_RIUSATA`. */
  private async giaRicevuta(
    agente: { id: string; tenantId: string },
    p: PayloadLettura,
    testo: string
  ): Promise<EsitoElemento | null> {
    const esistente = await this.prisma.letturaPesa.findUnique({
      where: {
        agenteId_chiaveIdempotenza: { agenteId: agente.id, chiaveIdempotenza: p.chiaveIdempotenza },
      },
      select: { id: true, payload: true },
    })
    if (!esistente) return null
    if (esistente.payload === testo) {
      return {
        chiaveIdempotenza: p.chiaveIdempotenza,
        esito: 'GIA_RICEVUTA',
        letturaId: esistente.id,
      }
    }
    return rifiutata(p.chiaveIdempotenza, 'CHIAVE_RIUSATA')
  }

  /** Audit al piu' una volta ogni 10 minuti per agente; sempre nel log (senza byte della lettura). */
  private async firmaNonValida(agente: { id: string; tenantId: string }): Promise<void> {
    this.logger.warn(`Firma non valida: agente=${agente.id}, azienda=${agente.tenantId}`)
    const ora = this.orologio()
    const ultimo = this.ultimoAuditFirma.get(agente.id)
    if (ultimo !== undefined && ora - ultimo < MS_TRA_AUDIT_FIRMA) return
    this.ultimoAuditFirma.set(agente.id, ora)
    await this.prisma.activityLog.create({
      data: {
        tenantId: agente.tenantId,
        userId: null,
        action: 'PESA_AGENTE_FIRMA_NON_VALIDA',
        description: 'Lettura con firma non valida ricevuta da un agente di pesa',
        metadata: { agenteId: agente.id } as Prisma.InputJsonValue,
      },
    })
  }
}
