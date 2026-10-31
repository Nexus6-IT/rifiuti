/**
 * Impostazioni del registro per la trasmissione a RENTRI (F2-9, D13): identificativo del registro,
 * invio automatico e verifica di allineamento.
 *
 * - Solo ADMIN (ruolo effettivo nell'azienda selezionata) modifica; la lettura e' libera.
 * - Cambiare o togliere l'identificativo e' vietato se il registro ha annotazioni gia' partite
 *   verso RENTRI (`IN_INVIO`, `ATTESA_ESITO`, `INCERTA`, `TRASMESSA`) o dichiarate presenti
 *   (`GIA_SU_RENTRI`): finirebbero attribuite a un altro registro. Le sole `RIFIUTATA` non pesano.
 * - Attivare l'invio automatico imposta `invio_rentri_automatico_dal` a ORA (nessun invio
 *   retroattivo, D3); riattivarlo non sposta la data; spegnerlo la azzera.
 * - L'audit ha prima/dopo di identificativo e data, mai dati personali.
 */
import { Injectable } from '@nestjs/common'
import { Prisma, type StatoTrasmissioneRentri } from '@prisma/client'
import { LoggerService } from '../../../core/logger/logger.service'
import { TenantContext } from '../../../core/context/tenant-context'
import { PrismaService } from '../../../infrastructure/persistence/prisma.service'
import { RentriRegistriClient } from '../../../infrastructure/rentri/rentri-registri.client'
import { RegistroNonTrovatoError } from '../../registro/registri.service'
import {
  IdentificativoGiaUsatoError,
  IdentificativoRegistroNonValidoError,
  RichiestaTrasmissioneNonValidaError,
  TrasmissioneNonModificabileError,
  richiediAmministratore,
} from './errori-azioni-rentri-registro'

type Tx = Prisma.TransactionClient

const FORMATO_IDENTIFICATIVO_REGISTRO = /^R[0-9A-Z]{10}$/
const STATI_GIA_PARTITI: StatoTrasmissioneRentri[] = [
  'IN_INVIO',
  'ATTESA_ESITO',
  'INCERTA',
  'TRASMESSA',
  'GIA_SU_RENTRI',
]

export interface ImpostazioniRegistro {
  registroId: string
  descrizione: string
  identificativoRentri: string | null
  invioAutomatico: boolean
  invioAutomaticoDal: Date | null
  /** Conteggio delle righe di trasmissione per stato. */
  perStato: Partial<Record<StatoTrasmissioneRentri, number>>
  /** Movimenti del registro senza riga di trasmissione (mai trasmessi ne' accodati). */
  nonTrasmessi: number
  /** L'azienda ha una credenziale RENTRI configurata. */
  haCertificato: boolean
}

export interface Allineamento {
  locali: number
  /** `TRASMESSA` + `GIA_SU_RENTRI` dell'anno. */
  trasmessi: number
  /** Registrazioni dell'anno su RENTRI; `null` se RENTRI non ha risposto. */
  suRentri: number | null
}

@Injectable()
export class ImpostazioniRentriRegistroService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly client: RentriRegistriClient,
    private readonly logger: LoggerService
  ) {
    this.logger.setContext('ImpostazioniRentriRegistroService')
  }

  private nelTenant<R>(tenantId: string, fn: (tx: Tx) => Promise<R>): Promise<R> {
    return TenantContext.run({ tenantId }, async () => await this.prisma.$transaction(fn))
  }

  async leggi(tenantId: string): Promise<ImpostazioniRegistro[]> {
    return this.nelTenant(tenantId, async tx => {
      const registri = await tx.registroRifiuti.findMany({
        where: { tenantId },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        select: {
          id: true,
          descrizione: true,
          identificativoRentri: true,
          invioRentriAutomaticoDal: true,
        },
      })
      const gruppi = await tx.movimentoTrasmissioneRentri.groupBy({
        by: ['registroId', 'stato'],
        where: { tenantId },
        _count: { _all: true },
      })
      const nonTrasmessi = await tx.wasteMovement.groupBy({
        by: ['registroId'],
        where: { tenantId, trasmissioneRentri: null },
        _count: { _all: true },
      })
      const credenziale = await tx.rentriCredential.findFirst({
        where: { tenantId },
        select: { id: true },
      })
      return registri.map(r => {
        const perStato: Partial<Record<StatoTrasmissioneRentri, number>> = {}
        for (const g of gruppi.filter(x => x.registroId === r.id)) perStato[g.stato] = g._count._all
        return {
          registroId: r.id,
          descrizione: r.descrizione,
          identificativoRentri: r.identificativoRentri,
          invioAutomatico: r.invioRentriAutomaticoDal !== null,
          invioAutomaticoDal: r.invioRentriAutomaticoDal,
          perStato,
          nonTrasmessi: nonTrasmessi.find(x => x.registroId === r.id)?._count._all ?? 0,
          haCertificato: credenziale !== null,
        }
      })
    })
  }

  /**
   * @param dati `identificativoRentri`: assente = invariato, `null`/vuoto = toglie.
   *   `invioAutomatico`: assente = invariato.
   * @throws RuoloNonAutorizzatoRentriError (403) se il ruolo effettivo non e' ADMIN
   * @throws IdentificativoRegistroNonValidoError (400) formato errato o automatico senza identificativo
   * @throws TrasmissioneNonModificabileError (409) cambio con annotazioni gia' partite
   * @throws IdentificativoGiaUsatoError (409) identificativo di un altro registro dell'azienda
   */
  async imposta(
    tenantId: string,
    utenteId: string,
    ruolo: string,
    registroId: string,
    dati: { identificativoRentri?: string | null; invioAutomatico?: boolean }
  ): Promise<ImpostazioniRegistro> {
    richiediAmministratore(ruolo)

    let nuovoIdentificativo: string | null | undefined
    if (dati.identificativoRentri !== undefined) {
      const grezzo = (dati.identificativoRentri ?? '').trim().toUpperCase()
      if (grezzo === '') nuovoIdentificativo = null
      else if (!FORMATO_IDENTIFICATIVO_REGISTRO.test(grezzo)) {
        throw new IdentificativoRegistroNonValidoError(
          "L'identificativo del registro RENTRI e' la lettera R seguita da 10 lettere maiuscole o cifre."
        )
      } else nuovoIdentificativo = grezzo
    }

    try {
      await this.nelTenant(tenantId, async tx => {
        const registro = await tx.registroRifiuti.findFirst({
          where: { id: registroId, tenantId },
          select: { identificativoRentri: true, invioRentriAutomaticoDal: true },
        })
        if (!registro) throw new RegistroNonTrovatoError()

        const identificativoFinale =
          nuovoIdentificativo === undefined ? registro.identificativoRentri : nuovoIdentificativo
        const cambia = identificativoFinale !== registro.identificativoRentri

        if (cambia) {
          // Stessa chiave di `prenota` (bloccante qui): o la prenotazione di un lotto e' gia'
          // committata (e il conteggio la vede), o parte dopo e legge il nuovo identificativo.
          // Senza il lock un lotto potrebbe partire per il vecchio identificativo mentre cambia.
          await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'rentri-registro|' + registroId}))`
          const partite = await tx.movimentoTrasmissioneRentri.count({
            where: { tenantId, registroId, stato: { in: STATI_GIA_PARTITI } },
          })
          if (partite > 0) {
            throw new TrasmissioneNonModificabileError(
              'Il registro ha già annotazioni trasmesse con questo identificativo: non si può cambiare.'
            )
          }
          if (identificativoFinale !== null) {
            const altro = await tx.registroRifiuti.findFirst({
              where: {
                tenantId,
                identificativoRentri: identificativoFinale,
                id: { not: registroId },
              },
              select: { id: true },
            })
            if (altro) throw new IdentificativoGiaUsatoError()
          }
        }

        let dal = registro.invioRentriAutomaticoDal
        if (dati.invioAutomatico === true) {
          if (identificativoFinale === null) {
            throw new IdentificativoRegistroNonValidoError(
              "Per attivare l'invio automatico serve prima l'identificativo del registro RENTRI."
            )
          }
          if (dal === null) dal = new Date()
        } else if (dati.invioAutomatico === false) {
          dal = null
        } else if (identificativoFinale === null) {
          // Senza identificativo non c'e' nulla da inviare: l'automatico si spegne con lui.
          dal = null
        }

        await tx.registroRifiuti.updateMany({
          where: { id: registroId, tenantId },
          data: { identificativoRentri: identificativoFinale, invioRentriAutomaticoDal: dal },
        })
        await tx.activityLog.create({
          data: {
            tenantId,
            userId: utenteId,
            action: 'RENTRI_REGISTRO_IMPOSTAZIONI',
            description: 'Impostazioni di trasmissione a RENTRI del registro modificate',
            metadata: {
              registroId,
              prima: {
                identificativoRentri: registro.identificativoRentri,
                invioAutomaticoDal: registro.invioRentriAutomaticoDal,
              },
              dopo: { identificativoRentri: identificativoFinale, invioAutomaticoDal: dal },
            },
          },
        })
      })
    } catch (errore) {
      // Corsa fra due richieste con lo stesso identificativo: il vincolo univoco del database.
      if (errore instanceof Prisma.PrismaClientKnownRequestError && errore.code === 'P2002') {
        throw new IdentificativoGiaUsatoError()
      }
      throw errore
    }

    const lista = await this.leggi(tenantId)
    const registro = lista.find(r => r.registroId === registroId)
    if (!registro) throw new RegistroNonTrovatoError()
    return registro
  }

  /**
   * Confronto, a richiesta, fra le annotazioni locali dell'anno e quelle su RENTRI (una chiamata).
   * Se RENTRI non risponde `suRentri` e' `null`: le due cifre locali restano valide.
   * @throws IdentificativoRegistroNonValidoError se il registro non ha ancora l'identificativo
   */
  async allineamento(tenantId: string, registroId: string, anno: number): Promise<Allineamento> {
    if (!Number.isInteger(anno) || anno < 2000 || anno > 2100) {
      throw new RichiestaTrasmissioneNonValidaError('Anno non valido.')
    }
    const { identificativo, locali, trasmessi } = await this.nelTenant(tenantId, async tx => {
      const registro = await tx.registroRifiuti.findFirst({
        where: { id: registroId, tenantId },
        select: { identificativoRentri: true },
      })
      if (!registro) throw new RegistroNonTrovatoError()
      const [locali, trasmessi] = await Promise.all([
        tx.wasteMovement.count({ where: { tenantId, registroId, progressiveYear: anno } }),
        tx.movimentoTrasmissioneRentri.count({
          where: {
            tenantId,
            registroId,
            stato: { in: ['TRASMESSA', 'GIA_SU_RENTRI'] },
            movimento: { progressiveYear: anno },
          },
        }),
      ])
      return { identificativo: registro.identificativoRentri, locali, trasmessi }
    })
    if (!identificativo) {
      throw new IdentificativoRegistroNonValidoError(
        "Il registro non ha ancora l'identificativo RENTRI: impostarlo prima."
      )
    }
    let suRentri: number | null = null
    try {
      const quanti = await this.client.contaMovimenti(identificativo, { anno }, tenantId)
      suRentri = Number.isInteger(quanti) && quanti >= 0 ? quanti : null
    } catch (errore) {
      this.logger.warn("Conteggio su RENTRI non riuscito: l'allineamento resta parziale", {
        tipo: errore instanceof Error ? errore.name : 'sconosciuto',
      })
    }
    return { locali, trasmessi, suRentri }
  }
}
