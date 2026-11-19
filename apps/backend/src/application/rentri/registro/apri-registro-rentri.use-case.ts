/**
 * Apre un nuovo registro su RENTRI da WasteFlow (eREGI E2, T2).
 *
 * L'apertura (`POST /operatore/registri`) e' una scrittura NON idempotente: una seconda POST crea
 * un secondo registro sul portale. Per questo:
 * 1. la richiesta si PRENOTA sul registro locale (`rentri_apertura_richiesta_il`) sotto un lock
 *    advisory: due chiamate parallele non possono partire entrambe (la seconda trova la
 *    prenotazione e riceve 409);
 * 2. la POST non si ritenta mai su 5xx/timeout (lo garantisce il client): l'esito resta INCERTO e
 *    la prenotazione resta;
 * 3. un esito incerto si risolve solo per LETTURA, dopo `SOGLIA_STALLO_RENTRI_MS`: se fra i
 *    registri aperti della sede c'e' esattamente UN registro nuovo (non gia' collegato in azienda)
 *    con stessa descrizione e stesse attivita' si collega con audit, altrimenti l'utente e'
 *    mandato al portale. Mai una seconda POST automatica.
 * Solo ADMIN.
 */
import { Injectable } from '@nestjs/common'
import { Prisma } from '@prisma/client'
import { TenantContext } from '../../../core/context/tenant-context'
import { LoggerService } from '../../../core/logger/logger.service'
import { PrismaService } from '../../../infrastructure/persistence/prisma.service'
import {
  RentriAnagraficheClient,
  type RegistroAnagraficoModel,
} from '../../../infrastructure/rentri/rentri-anagrafiche.client'
import { TrasmissioneRentriIncertaError } from '../../../infrastructure/rentri/rentri-api.client'
import { SOGLIA_STALLO_RENTRI_MS } from '../sync-fir-to-rentri.use-case'
import {
  LUNGHEZZA_MASSIMA_DESCRIZIONE_REGISTRO_RENTRI,
  motivoAttivitaNonValide,
} from './attivita-registro-rentri'
import {
  leggiContestoRegistroRentri,
  registroRentriChiuso,
  richiediOperatore,
  type ContestoRegistroRentri,
} from './contesto-registro-rentri'
import {
  AperturaRegistroInCorsoError,
  AperturaRegistroNonRisoltaError,
  RegistroGiaCollegatoError,
  RichiestaTrasmissioneNonValidaError,
  richiediAmministratore,
} from './errori-azioni-rentri-registro'
import {
  ImpostazioniRentriRegistroService,
  type ImpostazioniRegistro,
} from './impostazioni-rentri-registro.service'

type Tx = Prisma.TransactionClient

export interface RichiestaAperturaRegistro {
  attivita: string[]
  attivitaRecSmalt: string[]
  /** Assente = la descrizione del registro locale (troncata a 250 caratteri). */
  descrizione?: string | null
}

export type EsitoApertura =
  | { esito: 'APERTO'; impostazioni: ImpostazioniRegistro }
  | { esito: 'COLLEGATO_DOPO_VERIFICA'; impostazioni: ImpostazioniRegistro }
  | { esito: 'INCERTO'; messaggio: string }

export const MESSAGGIO_APERTURA_INCERTA =
  "RENTRI non ha confermato l'apertura del registro: potrebbe essere stato aperto lo stesso. Non riprovare subito: tra qualche minuto WasteFlow lo cerca da solo, oppure collegalo a mano dall'elenco."

/** Margine sull'orario di creazione: i due orologi (nostro e di RENTRI) non coincidono. */
const MARGINE_DATA_CREAZIONE_MS = 10 * 60 * 1000
const PAGINE_MASSIME_ELENCO = 5
const DIMENSIONE_PAGINA_ELENCO = 100

@Injectable()
export class ApriRegistroRentriUseCase {
  constructor(
    private readonly prisma: PrismaService,
    private readonly client: RentriAnagraficheClient,
    private readonly impostazioni: ImpostazioniRentriRegistroService,
    private readonly logger: LoggerService
  ) {
    this.logger.setContext('ApriRegistroRentriUseCase')
  }

  private nelTenant<R>(tenantId: string, fn: (tx: Tx) => Promise<R>): Promise<R> {
    return TenantContext.run({ tenantId }, async () => await this.prisma.$transaction(fn))
  }

  /**
   * @throws RuoloNonAutorizzatoRentriError 403
   * @throws RichiestaTrasmissioneNonValidaError 400 attivita'/descrizione non valide
   * @throws RegistroGiaCollegatoError 409
   * @throws AperturaRegistroInCorsoError 409 prenotazione recente
   * @throws AperturaRegistroNonRisoltaError 409 dopo un esito incerto non si trova (o non e' univoco)
   *   il registro aperto
   * @throws RentriApiError rifiuto definitivo dell'ente (la prenotazione e' azzerata)
   */
  async esegui(
    tenantId: string,
    utenteId: string,
    ruolo: string,
    registroId: string,
    richiesta: RichiestaAperturaRegistro
  ): Promise<EsitoApertura> {
    richiediAmministratore(ruolo)
    const attivita = richiesta.attivita ?? []
    const attivitaRecSmalt = richiesta.attivitaRecSmalt ?? []
    const motivo = motivoAttivitaNonValide({ attivita, attivitaRecSmalt })
    if (motivo !== null) throw new RichiestaTrasmissioneNonValidaError(motivo)
    const descrizioneRichiesta = richiesta.descrizione?.trim()
    if (
      descrizioneRichiesta !== undefined &&
      descrizioneRichiesta.length > LUNGHEZZA_MASSIMA_DESCRIZIONE_REGISTRO_RENTRI
    ) {
      throw new RichiestaTrasmissioneNonValidaError(
        `La descrizione può avere al massimo ${LUNGHEZZA_MASSIMA_DESCRIZIONE_REGISTRO_RENTRI} caratteri.`
      )
    }

    // Fase 1: prenotazione sotto lock. Il lock vale fino al commit: la seconda richiesta attende
    // qui e poi trova la prenotazione gia' scritta.
    const fase = await this.nelTenant(tenantId, async tx => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'rentri-registro-apertura|' + registroId}))`
      const contesto = await leggiContestoRegistroRentri(tx, tenantId, registroId)
      if (contesto.identificativoRentri !== null) throw new RegistroGiaCollegatoError()
      if (contesto.rentriAperturaRichiestaIl !== null) {
        const eta = Date.now() - contesto.rentriAperturaRichiestaIl.getTime()
        if (eta < SOGLIA_STALLO_RENTRI_MS) throw new AperturaRegistroInCorsoError()
        return { tipo: 'RISOLVI' as const, contesto }
      }
      const descrizione = (descrizioneRichiesta || contesto.descrizione).slice(
        0,
        LUNGHEZZA_MASSIMA_DESCRIZIONE_REGISTRO_RENTRI
      )
      await tx.registroRifiuti.updateMany({
        where: { id: registroId, tenantId },
        data: {
          rentriAperturaRichiestaIl: new Date(),
          rentriAperturaDescrizione: descrizione,
          rentriAttivita: attivita,
          rentriAttivitaRecSmalt: attivitaRecSmalt,
        },
      })
      return { tipo: 'APRI' as const, contesto, descrizione }
    })

    if (fase.tipo === 'RISOLVI') {
      return await this.risolviEsitoIncerto(tenantId, utenteId, ruolo, fase.contesto)
    }

    // Fase 2: la POST, fuori da ogni transazione.
    let identificativo: string
    try {
      const esito = await this.client.apriRegistro(
        {
          numIscrSito: fase.contesto.numIscrSito,
          attivita,
          attivitaRecSmalt: attivitaRecSmalt.length > 0 ? attivitaRecSmalt : null,
          descrizione: fase.descrizione,
        },
        tenantId
      )
      identificativo = esito.identificativo
    } catch (errore) {
      if (errore instanceof TrasmissioneRentriIncertaError) {
        this.logger.warn('Apertura del registro su RENTRI: esito incerto, resta prenotata', {
          tenantId,
          registroId,
          causa: errore.causa,
        })
        return { esito: 'INCERTO', messaggio: MESSAGGIO_APERTURA_INCERTA }
      }
      // Rifiuto definitivo o errore prima dell'invio: nulla e' stato aperto, si puo' riprovare.
      await this.azzeraPrenotazione(tenantId, registroId)
      throw errore
    }

    return await this.collegaAperto(
      tenantId,
      utenteId,
      ruolo,
      registroId,
      identificativo,
      attivita,
      attivitaRecSmalt,
      'APERTURA'
    ).then(impostazioni => ({ esito: 'APERTO' as const, impostazioni }))
  }

  private async azzeraPrenotazione(tenantId: string, registroId: string): Promise<void> {
    await this.nelTenant(tenantId, async tx => {
      await tx.registroRifiuti.updateMany({
        where: { id: registroId, tenantId, identificativoRentri: null },
        data: { rentriAperturaRichiestaIl: null, rentriAperturaDescrizione: null },
      })
    })
  }

  private async collegaAperto(
    tenantId: string,
    utenteId: string,
    ruolo: string,
    registroId: string,
    identificativo: string,
    attivita: string[],
    attivitaRecSmalt: string[],
    origine: 'APERTURA' | 'APERTURA_RISOLTA'
  ): Promise<ImpostazioniRegistro> {
    try {
      return await this.impostazioni.imposta(tenantId, utenteId, ruolo, registroId, {
        identificativoRentri: identificativo,
        collegamento: { attivita, attivitaRecSmalt, sincronizzatoIl: new Date(), origine },
      })
    } catch (errore) {
      // Il registro esiste gia' su RENTRI ma non si e' potuto salvare: la prenotazione resta, cosi'
      // nessuno ne apre un secondo; l'utente lo collega a mano.
      this.logger.error(
        'Registro aperto su RENTRI ma non collegato',
        errore instanceof Error ? errore : new Error(String(errore)),
        { tenantId, registroId }
      )
      throw new AperturaRegistroNonRisoltaError(
        `Il registro è stato aperto su RENTRI (identificativo ${identificativo}) ma non è stato possibile collegarlo: usa «Collega» e scegli questo registro.`
      )
    }
  }

  /**
   * Cerca fra i registri della sede quello aperto dalla nostra POST (esito incerto).
   * Candidato = non chiuso, non gia' collegato in azienda, stessa descrizione e stesse attivita',
   * creato dopo la prenotazione (con margine).
   */
  private async risolviEsitoIncerto(
    tenantId: string,
    utenteId: string,
    ruolo: string,
    contesto: ContestoRegistroRentri
  ): Promise<EsitoApertura> {
    const numIscrOperatore = richiediOperatore(contesto)
    const registri = await this.elencaAperti(tenantId, numIscrOperatore, contesto.numIscrSito)
    const noti = await this.nelTenant(tenantId, async tx => {
      const righe = await tx.registroRifiuti.findMany({
        where: { tenantId, identificativoRentri: { not: null } },
        select: { identificativoRentri: true },
      })
      return new Set(righe.map(r => r.identificativoRentri))
    })
    const richiestaIl = contesto.rentriAperturaRichiestaIl?.getTime() ?? 0
    const attivitaAttese = [...contesto.rentriAttivita].sort().join('|')
    const candidati = registri.filter(r => {
      if (typeof r.identificativo !== 'string' || noti.has(r.identificativo)) return false
      if (registroRentriChiuso(r)) return false
      if ((r.descrizione ?? '').trim() !== (contesto.rentriAperturaDescrizione ?? '').trim()) {
        return false
      }
      if ([...(r.attivita ?? [])].sort().join('|') !== attivitaAttese) return false
      const creato = r.data_creazione ? Date.parse(r.data_creazione) : Number.NaN
      return Number.isFinite(creato) && creato >= richiestaIl - MARGINE_DATA_CREAZIONE_MS
    })

    if (candidati.length === 1 && typeof candidati[0].identificativo === 'string') {
      const impostazioni = await this.collegaAperto(
        tenantId,
        utenteId,
        ruolo,
        contesto.registroId,
        candidati[0].identificativo,
        contesto.rentriAttivita,
        contesto.rentriAttivitaRecSmalt,
        'APERTURA_RISOLTA'
      )
      return { esito: 'COLLEGATO_DOPO_VERIFICA', impostazioni }
    }
    if (candidati.length === 0) {
      await this.azzeraPrenotazione(tenantId, contesto.registroId)
      throw new AperturaRegistroNonRisoltaError(
        "Il registro non risulta aperto su RENTRI: puoi riprovare. Se lo vedi sul portale, collegalo dall'elenco."
      )
    }
    throw new AperturaRegistroNonRisoltaError(
      "Sul portale RENTRI ci sono più registri che potrebbero essere quello appena aperto: scegli quello giusto dall'elenco con «Collega»."
    )
  }

  private async elencaAperti(
    tenantId: string,
    numIscrOperatore: string,
    numIscrSito: string
  ): Promise<RegistroAnagraficoModel[]> {
    const tutti: RegistroAnagraficoModel[] = []
    for (let page = 1; page <= PAGINE_MASSIME_ELENCO; page++) {
      const pagina = await this.client.elencaRegistriSito(
        numIscrOperatore,
        numIscrSito,
        { chiuso: false, paging: { page, pageSize: DIMENSIONE_PAGINA_ELENCO } },
        tenantId
      )
      tutti.push(...pagina.risultati)
      if (page >= pagina.paging.pageCount) break
    }
    return tutti
  }
}
