/**
 * Validazione di un'esportazione del registro verso RENTRI (eREGI E6, T2): `POST .../valida` e
 * lettura dell'esito. Non scrive nulla sul registro di RENTRI (la validazione e' sola verifica).
 *
 * REGOLA CHIAVE: un errore TECNICO (rete, 5xx, timeout, esito illeggibile, certificato mancante) non
 * e' mai un rifiuto. `RIFIUTATA` solo se RENTRI ha risposto con un esito decodificato che contiene
 * almeno un errore; altrimenti `VALIDAZIONE_NON_DISPONIBILE` (riprovabile) o, se RENTRI sta ancora
 * elaborando, `IN_VALIDAZIONE`. Una transazione gia' avviata si rilegge senza rimandare il file.
 * Salvati solo `{ codice, tipo, campo }` dei messaggi: mai il contenuto del registro.
 */
import { Injectable } from '@nestjs/common'
import type { Prisma, StatoEsportazioneRegistroRentri } from '@prisma/client'
import { gunzipSync } from 'zlib'
import { TenantContext } from '../../../core/context/tenant-context'
import { LoggerService } from '../../../core/logger/logger.service'
import { PrismaService } from '../../../infrastructure/persistence/prisma.service'
import { TransazioneRentriNonTrovataError } from '../../../infrastructure/rentri/rentri-api.client'
import {
  EsitoRentriNonDisponibileError,
  RentriRegistriClient,
  type EsitoMovimentiRentri,
} from '../../../infrastructure/rentri/rentri-registri.client'
import { inviiRegistroAttivi } from './invii-registro-attivi'
import {
  EsportazioneNonRivalidabileError,
  EsportazioneNonTrovataError,
} from './errori-esportazioni-registro-rentri'

type Tx = Prisma.TransactionClient

/** Stati in cui manca ancora un esito definitivo: gli unici da cui si (ri)valida. */
const STATI_SENZA_ESITO: StatoEsportazioneRegistroRentri[] = [
  'GENERATA',
  'IN_VALIDAZIONE',
  'VALIDAZIONE_NON_DISPONIBILE',
]

/** Tentativi di lettura dell'esito per chiamata (il resto lo fa `rivalida`). */
const TENTATIVI_ESITO = 10
const MAX_MESSAGGI_SALVATI = 100

export interface MessaggioSalvato {
  codice: string | null
  tipo: 'Errore' | 'Avvertimento'
  campo: string | null
}

export interface EsitoValidazioneEsportazione {
  id: string
  stato: StatoEsportazioneRegistroRentri
  messaggi: MessaggioSalvato[]
}

/** Nome del file come WinWaste: `REN{id}_{da:000000}_{a:000000}_{yyyyMMdd}.SignedR.xml`. */
export function nomeFileEsportazione(
  identificativo: string,
  progressivoDa: number,
  progressivoA: number,
  dataCreazione: Date
): string {
  const giorno = dataCreazione.toISOString().slice(0, 10).replace(/-/g, '')
  const sei = (n: number) => String(n).padStart(6, '0')
  return `REN${identificativo}_${sei(progressivoDa)}_${sei(progressivoA)}_${giorno}.SignedR.xml`
}

/** Messaggi dell'esito ridotti ai tre campi senza valori. */
export function messaggiSalvabili(esito: EsitoMovimentiRentri): MessaggioSalvato[] {
  return esito.validazione.slice(0, MAX_MESSAGGI_SALVATI).map(m => ({
    codice: m.codice,
    tipo: m.tipo,
    campo: m.campo,
  }))
}

/** Stato definitivo dall'esito decodificato di RENTRI. */
export function statoDaEsito(esito: EsitoMovimentiRentri): StatoEsportazioneRegistroRentri {
  if (esito.errore || esito.validazione.some(m => m.tipo === 'Errore')) return 'RIFIUTATA'
  if (esito.validazione.length > 0) return 'VALIDATA_CON_AVVISI'
  return 'VALIDATA'
}

@Injectable()
export class ValidaEsportazioneRegistroRentriUseCase {
  constructor(
    private readonly prisma: PrismaService,
    private readonly client: RentriRegistriClient,
    private readonly logger: LoggerService
  ) {
    this.logger.setContext('ValidaEsportazioneRegistroRentriUseCase')
  }

  private nelTenant<R>(tenantId: string, fn: (tx: Tx) => Promise<R>): Promise<R> {
    return TenantContext.run({ tenantId }, async () => await this.prisma.$transaction(fn))
  }

  /** Ripetibile dall'utente: solo se manca l'esito (altrimenti {@link EsportazioneNonRivalidabileError}). */
  async rivalida(tenantId: string, esportazioneId: string): Promise<EsitoValidazioneEsportazione> {
    const riga = await this.leggi(tenantId, esportazioneId)
    if (!STATI_SENZA_ESITO.includes(riga.stato)) throw new EsportazioneNonRivalidabileError()
    return this.valida(tenantId, esportazioneId)
  }

  /**
   * Avvia (o riprende) la validazione. Non lancia per errori tecnici di RENTRI: li registra come
   * stato. Se l'esito e' gia' definitivo lo restituisce senza richiamare RENTRI. Con gli invii
   * sospesi (interruttore di emergenza) non parte la POST /valida e lo stato resta com'e', ma la
   * lettura dell'esito di una transazione gia' avviata continua (solo GET, come in F2-9).
   */
  async valida(tenantId: string, esportazioneId: string): Promise<EsitoValidazioneEsportazione> {
    const riga = await this.leggi(tenantId, esportazioneId)
    if (!STATI_SENZA_ESITO.includes(riga.stato)) {
      return { id: riga.id, stato: riga.stato, messaggi: riga.messaggi }
    }

    let transazioneId = riga.transazioneValidazioneId
    if (transazioneId === null) {
      // Interruttore spento: nessuna POST. Con una transazione gia' salvata si legge l'esito.
      if (!inviiRegistroAttivi()) return { id: riga.id, stato: riga.stato, messaggi: riga.messaggi }
      transazioneId = await this.avvia(tenantId, riga)
      if (transazioneId === null) {
        return this.registra(tenantId, riga.id, 'VALIDAZIONE_NON_DISPONIBILE', [], null)
      }
    }

    let esito: EsitoMovimentiRentri
    try {
      esito = await this.client.attendiEsitoMovimenti(transazioneId, tenantId, {
        maxTentativi: TENTATIVI_ESITO,
      })
    } catch (errore) {
      if (errore instanceof TransazioneRentriNonTrovataError) {
        // RENTRI non conosce la transazione: si azzera, la prossima validazione rimanda il file.
        return this.registra(tenantId, riga.id, 'VALIDAZIONE_NON_DISPONIBILE', [], null)
      }
      if (errore instanceof EsitoRentriNonDisponibileError) {
        return this.registra(tenantId, riga.id, 'IN_VALIDAZIONE', [], transazioneId)
      }
      this.logger.warn('Lettura dell esito della validazione non riuscita', {
        tipo: errore instanceof Error ? errore.name : 'sconosciuto',
      })
      return this.registra(tenantId, riga.id, 'VALIDAZIONE_NON_DISPONIBILE', [], transazioneId)
    }
    return this.registra(
      tenantId,
      riga.id,
      statoDaEsito(esito),
      messaggiSalvabili(esito),
      transazioneId
    )
  }

  private async leggi(tenantId: string, esportazioneId: string) {
    const riga = await this.nelTenant(tenantId, tx =>
      tx.esportazioneRegistroRentri.findFirst({
        where: { id: esportazioneId, tenantId },
        select: {
          id: true,
          stato: true,
          messaggi: true,
          transazioneValidazioneId: true,
          anno: true,
          progressivoDa: true,
          progressivoA: true,
          dataCreazione: true,
          xml: true,
          registro: { select: { identificativoRentri: true } },
        },
      })
    )
    if (!riga) throw new EsportazioneNonTrovataError()
    return {
      ...riga,
      messaggi: Array.isArray(riga.messaggi)
        ? (riga.messaggi as unknown as MessaggioSalvato[])
        : [],
    }
  }

  /** POST /valida: `transazione_id`, oppure `null` se RENTRI non l'ha accettata (errore tecnico). */
  private async avvia(
    tenantId: string,
    riga: Awaited<ReturnType<ValidaEsportazioneRegistroRentriUseCase['leggi']>>
  ): Promise<string | null> {
    const identificativo = riga.registro.identificativoRentri
    if (identificativo === null) return null
    try {
      const xml = gunzipSync(Buffer.from(riga.xml))
      const { transazioneId } = await this.client.validaRegistro(
        identificativo,
        {
          fileContentBase64: xml.toString('base64'),
          nomeFile: nomeFileEsportazione(
            identificativo,
            riga.progressivoDa,
            riga.progressivoA,
            riga.dataCreazione
          ),
          mime: 'application/xml',
        },
        undefined,
        tenantId
      )
      if (typeof transazioneId !== 'string' || transazioneId.trim() === '') return null
      // Subito salvata: se la lettura dell'esito si interrompe, non si rimanda il file.
      await this.registra(tenantId, riga.id, 'IN_VALIDAZIONE', [], transazioneId)
      return transazioneId
    } catch (errore) {
      this.logger.warn('Avvio della validazione verso RENTRI non riuscito', {
        tipo: errore instanceof Error ? errore.name : 'sconosciuto',
      })
      return null
    }
  }

  private async registra(
    tenantId: string,
    id: string,
    stato: StatoEsportazioneRegistroRentri,
    messaggi: MessaggioSalvato[],
    transazioneId: string | null
  ): Promise<EsitoValidazioneEsportazione> {
    const definitivo = ['VALIDATA', 'VALIDATA_CON_AVVISI', 'RIFIUTATA'].includes(stato)
    // Solo da uno stato senza esito: un esito definitivo gia' scritto da altri non si sovrascrive.
    await this.nelTenant(tenantId, tx =>
      tx.esportazioneRegistroRentri.updateMany({
        where: { id, tenantId, stato: { in: STATI_SENZA_ESITO } },
        data: {
          stato,
          transazioneValidazioneId: transazioneId,
          ...(definitivo ? { messaggi: messaggi as unknown as Prisma.InputJsonValue } : {}),
        },
      })
    )
    const attuale = await this.leggi(tenantId, id)
    return { id, stato: attuale.stato, messaggi: attuale.messaggi }
  }
}
