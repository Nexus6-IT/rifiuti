/**
 * Chiude un registro su RENTRI da WasteFlow (eREGI E3, T1). IRREVERSIBILE: dopo la chiusura RENTRI
 * non accetta piu' trasmissioni. Solo ADMIN, mai da un job.
 *
 * Sequenza (la DELETE e' una scrittura non ritentabile):
 * 1. conferma: l'utente digita l'identificativo del registro;
 * 2. sotto il lock di `prenota` (`rentri-registro|<id>`): guardie sulle righe (in volo, incerte o
 *    da trasmettere -> 409 con i conteggi) e PRENOTAZIONE della chiusura
 *    (`rentri_chiusura_richiesta_il`): da qui nessun lotto parte piu' verso il registro;
 * 3. DELETE fuori da ogni transazione, mai ritentata. Esito incerto -> rilettura del dettaglio
 *    (`data_chiusura`): chiuso = confermato, ancora aperto = prenotazione annullata, rilettura
 *    fallita = la prenotazione resta (invii fermi) e la richiesta si ripete in sicurezza;
 * 4. conferma: `rentri_chiuso_il`, invio automatico spento, audit prima/dopo.
 * Ripresa (prenotazione gia' presente, un tentativo precedente e' rimasto incerto): prima si
 * rilegge il dettaglio su RENTRI, poi si decide:
 * - CHIUSO -> conferma, senza guardia e senza DELETE (le annotazioni nate durante la prenotazione
 *   non potevano partire e restano nel registro locale);
 * - APERTO -> la DELETE precedente non ha avuto effetto: si rifa' la guardia di ingresso sotto lo
 *   stesso lock; se blocca si annulla la prenotazione (409 con i conteggi), altrimenti si rifa'
 *   la DELETE con la stessa gestione degli errori della prima;
 * - lettura fallita -> INCERTO, nessuna DELETE, la prenotazione resta.
 */
import { Injectable } from '@nestjs/common'
import type { Prisma, StatoTrasmissioneRentri } from '@prisma/client'
import { TenantContext } from '../../../core/context/tenant-context'
import { LoggerService } from '../../../core/logger/logger.service'
import { PrismaService } from '../../../infrastructure/persistence/prisma.service'
import {
  RentriAnagraficheClient,
  type RegistroAnagraficoModel,
} from '../../../infrastructure/rentri/rentri-anagrafiche.client'
import { TrasmissioneRentriIncertaError } from '../../../infrastructure/rentri/rentri-api.client'
import { RentriApiError } from '../../../infrastructure/rentri/rentri-http-resilienza'
import { leggiContestoRegistroRentri, registroRentriChiuso } from './contesto-registro-rentri'
import { contaDaTrasmettereRegistro } from './scadenza-trasmissione-rentri'
import {
  ChiusuraRegistroNonConfermataError,
  ChiusuraRegistroNonPossibileError,
  RegistroNonCollegatoRentriError,
  RegistroRentriChiusoError,
  RegistroRentriNonTrovatoError,
  RichiestaTrasmissioneNonValidaError,
  richiediAmministratore,
} from './errori-azioni-rentri-registro'
import {
  ImpostazioniRentriRegistroService,
  type ImpostazioniRegistro,
} from './impostazioni-rentri-registro.service'

type Tx = Prisma.TransactionClient

export type EsitoChiusura =
  | { esito: 'CHIUSO'; impostazioni: ImpostazioniRegistro }
  | { esito: 'INCERTO'; messaggio: string }

export const MESSAGGIO_CHIUSURA_INCERTA =
  'RENTRI non ha confermato la chiusura e non è stato possibile verificarla: gli invii verso questo registro sono fermi. Tra qualche minuto ripeti «Chiudi»: WasteFlow controlla prima lo stato su RENTRI.'

/** Ripresa di una chiusura prenotata senza poter leggere lo stato su RENTRI: nessuna DELETE. */
export const MESSAGGIO_RIPRESA_NON_VERIFICATA =
  'Non è stato possibile leggere lo stato del registro su RENTRI: la chiusura resta in sospeso e gli invii verso questo registro restano fermi. Ripeti «Chiudi» tra qualche minuto.'

/** Stati che impediscono la chiusura (annotazioni in volo, incerte o ancora da trasmettere). */
const STATI_IN_VOLO: StatoTrasmissioneRentri[] = ['IN_INVIO', 'ATTESA_ESITO']

const ETICHETTE: Record<string, string> = {
  IN_INVIO: 'in invio',
  ATTESA_ESITO: "in attesa dell'esito",
  INCERTA: 'incerte da verificare',
  DA_TRASMETTERE: 'da trasmettere',
  RIFIUTATA: 'rifiutate da RENTRI',
  NON_TRASMISSIBILE: 'non trasmissibili',
  SENZA_RIGA: 'registrate e non ancora in coda',
}

type MotivoAnnullamento = 'RIFIUTATA' | 'NON_CHIUSO' | 'GUARDIA'

function erroreGuardia(conteggi: Record<string, number>): ChiusuraRegistroNonPossibileError {
  const elenco = Object.entries(conteggi)
    .map(([stato, n]) => `${n} ${ETICHETTE[stato] ?? stato}`)
    .join(', ')
  return new ChiusuraRegistroNonPossibileError(
    `Non si può chiudere il registro: ci sono annotazioni ${elenco}. Trasmettile o toglile dalla coda e riprova.`,
    conteggi
  )
}

@Injectable()
export class ChiudiRegistroRentriUseCase {
  constructor(
    private readonly prisma: PrismaService,
    private readonly client: RentriAnagraficheClient,
    private readonly impostazioni: ImpostazioniRentriRegistroService,
    private readonly logger: LoggerService
  ) {
    this.logger.setContext('ChiudiRegistroRentriUseCase')
  }

  private nelTenant<R>(tenantId: string, fn: (tx: Tx) => Promise<R>): Promise<R> {
    return TenantContext.run({ tenantId }, async () => await this.prisma.$transaction(fn))
  }

  /**
   * @throws RuoloNonAutorizzatoRentriError 403
   * @throws RichiestaTrasmissioneNonValidaError 400 la conferma non e' l'identificativo del registro
   * @throws RegistroNonCollegatoRentriError / RegistroRentriChiusoError 409
   * @throws ChiusuraRegistroNonPossibileError 409 righe in volo, incerte o da trasmettere
   * @throws ChiusuraRegistroNonConfermataError 409 RENTRI non l'ha chiuso (prenotazione annullata)
   * @throws RentriApiError rifiuto definitivo dell'ente (prenotazione annullata)
   */
  async esegui(
    tenantId: string,
    utenteId: string,
    ruolo: string,
    registroId: string,
    conferma: string
  ): Promise<EsitoChiusura> {
    richiediAmministratore(ruolo)

    // Fase 1: guardie + prenotazione sotto il lock dei lotti.
    const fase = await this.nelTenant(tenantId, async tx => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'rentri-registro|' + registroId}))`
      const contesto = await leggiContestoRegistroRentri(tx, tenantId, registroId)
      const identificativo = contesto.identificativoRentri
      if (identificativo === null) throw new RegistroNonCollegatoRentriError()
      if ((conferma ?? '').trim().toUpperCase() !== identificativo) {
        throw new RichiestaTrasmissioneNonValidaError(
          'Per chiudere il registro digita il suo identificativo RENTRI (la lettera R seguita da 10 caratteri).'
        )
      }
      if (contesto.rentriChiusoIl !== null) throw new RegistroRentriChiusoError()

      // Ripresa di una chiusura gia' prenotata: la guardia si decide DOPO aver letto RENTRI (fase 2).
      const registro = await tx.registroRifiuti.findFirst({
        where: { id: registroId, tenantId },
        select: { rentriChiusuraRichiestaIl: true },
      })
      const ripresa = registro?.rentriChiusuraRichiestaIl != null
      if (!ripresa) {
        const conteggi = await this.guardia(tx, tenantId, registroId)
        if (conteggi !== null) throw erroreGuardia(conteggi)
        await tx.registroRifiuti.updateMany({
          where: { id: registroId, tenantId },
          data: { rentriChiusuraRichiestaIl: new Date() },
        })
        await tx.activityLog.create({
          data: {
            tenantId,
            userId: utenteId,
            action: 'RENTRI_REGISTRO_CHIUSURA_AVVIATA',
            description: 'Chiusura del registro su RENTRI avviata: invii fermati',
            metadata: { registroId },
          },
        })
      }
      return { identificativo, ripresa }
    })

    // Fase 2: sul portale, fuori da ogni transazione.
    let chiuso: RegistroAnagraficoModel | null = null
    if (fase.ripresa) {
      // Un tentativo precedente era rimasto incerto: si guarda prima di qualsiasi DELETE.
      const letto = await this.leggiSeRiesce(fase.identificativo, tenantId)
      if (letto === null) {
        this.logger.warn('Ripresa chiusura: dettaglio RENTRI non leggibile, nessuna DELETE', {
          tenantId,
          registroId,
        })
        return { esito: 'INCERTO', messaggio: MESSAGGIO_RIPRESA_NON_VERIFICATA }
      }
      if (registroRentriChiuso(letto)) chiuso = letto
      else await this.ripetiGuardia(tenantId, utenteId, registroId, fase.identificativo)
    }
    if (chiuso === null) {
      try {
        await this.client.chiudiRegistro(fase.identificativo, tenantId)
        chiuso = { data_chiusura: new Date().toISOString() }
      } catch (errore) {
        const risolto = await this.dopoErroreDelete(
          tenantId,
          utenteId,
          registroId,
          fase.identificativo,
          errore
        )
        if (risolto === 'INCERTO') {
          return { esito: 'INCERTO', messaggio: MESSAGGIO_CHIUSURA_INCERTA }
        }
        chiuso = risolto
      }
    }

    await this.conferma(tenantId, utenteId, registroId, fase.identificativo, chiuso)
    this.logger.info('Registro chiuso su RENTRI', { tenantId, registroId })
    const lista = await this.impostazioni.leggi(tenantId)
    const impostazioni = lista.find(r => r.registroId === registroId)
    if (!impostazioni) throw new RegistroRentriNonTrovatoError()
    return { esito: 'CHIUSO', impostazioni }
  }

  /**
   * Guardia di ingresso, con le stesse regole del termine mensile (E0): in volo, incerte, da
   * trasmettere, rifiutate, non trasmissibili e le annotazioni che l'invio automatico adottera'
   * (SENZA_RIGA). Va chiamata sotto il lock `rentri-registro|<id>`.
   * @returns i conteggi per stato se qualcosa blocca, altrimenti `null`
   */
  private async guardia(
    tx: Tx,
    tenantId: string,
    registroId: string
  ): Promise<Record<string, number> | null> {
    const conteggi: Record<string, number> = await contaDaTrasmettereRegistro(
      tx,
      tenantId,
      registroId
    )
    const inVolo = await tx.movimentoTrasmissioneRentri.groupBy({
      by: ['stato'],
      where: { tenantId, registroId, stato: { in: STATI_IN_VOLO } },
      _count: { _all: true },
    })
    for (const g of inVolo) conteggi[g.stato] = g._count._all
    return Object.keys(conteggi).length > 0 ? conteggi : null
  }

  /**
   * Ripresa con RENTRI che dice APERTO: la DELETE precedente non ha avuto effetto, quindi prima di
   * rifarla si ripete la guardia di ingresso sotto lo stesso lock. Se blocca, la prenotazione si
   * annulla nella stessa transazione (gli invii ripartono) e si risponde 409 con i conteggi.
   * @throws ChiusuraRegistroNonPossibileError 409 la guardia blocca (prenotazione annullata)
   * @throws ChiusuraRegistroNonConfermataError 409 la prenotazione non c'e' piu' o il collegamento e' cambiato
   * @throws RegistroRentriChiusoError 409 il registro e' stato confermato chiuso nel frattempo
   */
  private async ripetiGuardia(
    tenantId: string,
    utenteId: string,
    registroId: string,
    identificativo: string
  ): Promise<void> {
    const bloccata = await this.nelTenant(tenantId, async tx => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'rentri-registro|' + registroId}))`
      const r = await tx.registroRifiuti.findFirst({
        where: { id: registroId, tenantId },
        select: {
          identificativoRentri: true,
          rentriChiusoIl: true,
          rentriChiusuraRichiestaIl: true,
        },
      })
      if (!r) throw new RegistroRentriNonTrovatoError()
      if (r.rentriChiusoIl !== null) throw new RegistroRentriChiusoError()
      // Un'altra richiesta ha annullato la prenotazione o cambiato il collegamento mentre si leggeva
      // RENTRI: non si chiude nulla alla cieca.
      if (r.rentriChiusuraRichiestaIl === null || r.identificativoRentri !== identificativo) {
        throw new ChiusuraRegistroNonConfermataError()
      }
      const conteggi = await this.guardia(tx, tenantId, registroId)
      if (conteggi !== null) {
        await this.annullaInTx(tx, tenantId, utenteId, registroId, 'GUARDIA', conteggi)
        return conteggi
      }
      await tx.activityLog.create({
        data: {
          tenantId,
          userId: utenteId,
          action: 'RENTRI_REGISTRO_CHIUSURA_RIPETUTA',
          description:
            'Chiusura del registro su RENTRI ripetuta: il tentativo precedente non aveva avuto effetto',
          metadata: { registroId },
        },
      })
      return null
    })
    if (bloccata !== null) throw erroreGuardia(bloccata)
  }

  /**
   * La DELETE e' fallita. Un errore sollevato PRIMA dell'invio (certificato, identificativo) non ha
   * toccato RENTRI: si annulla la prenotazione e si rilancia. Per ogni errore dell'ente, anche un
   * 4xx (per esempio «gia' chiuso» perche' la chiusura era riuscita o e' avvenuta dal portale), si
   * rilegge SEMPRE il dettaglio prima di annullare: un registro chiuso non deve riattivare gli invii.
   * @returns il dettaglio chiuso, oppure `INCERTO` se non si e' potuto sapere
   */
  private async dopoErroreDelete(
    tenantId: string,
    utenteId: string,
    registroId: string,
    identificativo: string,
    errore: unknown
  ): Promise<RegistroAnagraficoModel | 'INCERTO'> {
    const dellEnte =
      errore instanceof TrasmissioneRentriIncertaError || errore instanceof RentriApiError
    if (!dellEnte) {
      await this.annullaPrenotazione(tenantId, utenteId, registroId, 'RIFIUTATA')
      throw errore
    }
    this.logger.warn('Chiusura del registro su RENTRI non riuscita: rilettura del dettaglio', {
      tenantId,
      registroId,
    })
    const letto = await this.leggiSeRiesce(identificativo, tenantId)
    if (letto === null) return 'INCERTO'
    if (registroRentriChiuso(letto)) return letto
    const incerto =
      errore instanceof TrasmissioneRentriIncertaError ||
      (errore instanceof RentriApiError && (errore.retryable || errore.status >= 500))
    if (incerto) {
      await this.annullaPrenotazione(tenantId, utenteId, registroId, 'NON_CHIUSO')
      throw new ChiusuraRegistroNonConfermataError()
    }
    // Rifiuto definitivo e registro davvero aperto: nulla e' cambiato.
    await this.annullaPrenotazione(tenantId, utenteId, registroId, 'RIFIUTATA')
    throw errore
  }

  private async leggiSeRiesce(
    identificativo: string,
    tenantId: string
  ): Promise<RegistroAnagraficoModel | null> {
    try {
      return await this.client.dettaglioRegistro(identificativo, tenantId)
    } catch {
      return null
    }
  }

  private async annullaPrenotazione(
    tenantId: string,
    utenteId: string,
    registroId: string,
    motivo: MotivoAnnullamento
  ): Promise<void> {
    await this.nelTenant(tenantId, tx =>
      this.annullaInTx(tx, tenantId, utenteId, registroId, motivo)
    )
  }

  private async annullaInTx(
    tx: Tx,
    tenantId: string,
    utenteId: string,
    registroId: string,
    motivo: MotivoAnnullamento,
    conteggi?: Record<string, number>
  ): Promise<void> {
    const r = await tx.registroRifiuti.updateMany({
      where: {
        id: registroId,
        tenantId,
        rentriChiusoIl: null,
        rentriChiusuraRichiestaIl: { not: null },
      },
      data: { rentriChiusuraRichiestaIl: null },
    })
    if (r.count > 0) {
      await tx.activityLog.create({
        data: {
          tenantId,
          userId: utenteId,
          action: 'RENTRI_REGISTRO_CHIUSURA_ANNULLATA',
          description: 'Chiusura del registro su RENTRI non avvenuta: invii di nuovo attivi',
          metadata: { registroId, motivo, ...(conteggi ? { conteggi } : {}) },
        },
      })
    }
  }

  private async conferma(
    tenantId: string,
    utenteId: string,
    registroId: string,
    identificativo: string,
    dettaglio: RegistroAnagraficoModel
  ): Promise<void> {
    const quando =
      typeof dettaglio.data_chiusura === 'string' &&
      !Number.isNaN(Date.parse(dettaglio.data_chiusura))
        ? new Date(dettaglio.data_chiusura)
        : new Date()
    await this.nelTenant(tenantId, async tx => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'rentri-registro|' + registroId}))`
      const prima = await tx.registroRifiuti.findFirst({
        where: { id: registroId, tenantId },
        select: {
          invioRentriAutomaticoDal: true,
          rentriChiusoIl: true,
          identificativoRentri: true,
        },
      })
      // RENTRI ha chiuso QUESTO identificativo: lo si segna chiuso a prescindere dalla prenotazione,
      // che una richiesta concorrente puo' aver annullato (M9). Se nel frattempo un admin ha cambiato
      // o tolto l'identificativo, il registro locale non va segnato chiuso (M1).
      const r = await tx.registroRifiuti.updateMany({
        where: {
          id: registroId,
          tenantId,
          identificativoRentri: identificativo,
          rentriChiusoIl: null,
        },
        data: {
          rentriChiusoIl: quando,
          rentriChiusuraRichiestaIl: null,
          invioRentriAutomaticoDal: null,
          rentriSincronizzatoIl: new Date(),
        },
      })
      // Gia' confermato da un'altra richiesta (DELETE doppia): idempotente, nessun audit in piu'.
      if (
        r.count === 0 &&
        prima?.rentriChiusoIl != null &&
        prima.identificativoRentri === identificativo
      ) {
        return
      }
      await tx.activityLog.create({
        data: {
          tenantId,
          userId: utenteId,
          action: 'RENTRI_REGISTRO_CHIUSO',
          description:
            r.count > 0
              ? 'Registro chiuso su RENTRI da WasteFlow'
              : 'Registro chiuso su RENTRI, ma il collegamento locale era cambiato: registro locale non toccato',
          metadata: {
            registroId,
            ...(r.count === 0 ? { collegamentoCambiato: true } : {}),
            prima: {
              rentriChiusoIl: prima?.rentriChiusoIl ?? null,
              invioAutomaticoDal: prima?.invioRentriAutomaticoDal ?? null,
            },
            dopo: { rentriChiusoIl: quando, invioAutomaticoDal: null },
          },
        },
      })
    })
  }
}
