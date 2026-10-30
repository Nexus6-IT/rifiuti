import { Injectable } from '@nestjs/common'
import { WHERE_VIGENTE } from '../../../domain/waste-movement/vigenza'
import type { Prisma } from '@prisma/client'
import { PrismaService } from '../../../infrastructure/database/prisma.service'
import { LoggerService } from '../../../core/logger/logger.service'
import { ReferenceDataService, normalizeAteco } from '../../reference-data/reference-data.service'
import { giornoItaliano } from '../../../core/time/anno-italiano'
import { cerCanonico, chiaveConfrontoCer } from '../../../domain/waste-movement/cer-registro'
import {
  convertiInKg,
  normalizzaUnitaRegistro,
} from '../../../domain/waste-movement/unita-misura-registro'
import { collegabilitaFir, etichettaFir, STATI_FIR_EMESSI } from '../../../domain/fir/stati-fir'
import { stessiDatiRicopia } from '../../registro/ricopia-fir'
import { leggiApertureRegistro, apertureInKg } from '../../registro/aperture-registro'
import type { MudAllegatoDR, MudAllegatoTE, MudRifiutoLine } from '../export/mud-export.types'
import {
  classificaMovimento,
  limitiAnnoMud,
  operazioneDelMovimento,
  statoFisicoMud,
  type StatoFisicoRegistro,
} from './mud-regole'
import { caricaCatalogoCausali } from '../../registro/causali/catalogo-causali.repository'
import type { CatalogoCausali } from '../../../domain/waste-movement/catalogo-causali'
import { etichetteRegistri, sediDeiRegistri } from './mud-registri'
import { controlliMud, type MudEsitoControllo, type RifMovimento } from './mud-controlli'
import {
  giacenzeDelleDichiarazioni,
  type EsitoGiacenze,
  type RicevutoDaTerzi,
  type SaldoRegistro,
} from './mud-giacenze'
import {
  CHIAVE_AZIENDA,
  anagraficaDichiarazione,
  attribuisciSedi,
  codiceUnitaLocale,
  creaContestoSedi,
  dichiarazionePerAllegati,
  provinceDiverse,
  type ContestoSedi,
  type MudDichiarazione,
  type MudUnitaLocaleAnagrafica,
} from './mud-dichiarazioni'
import {
  chiaveDestinatario,
  destinatarioDelMovimento,
  chiavePesoSpecifico,
  leggiIntegrazioni,
  pesoSpecificoPlausibile,
  type IntegrazioniMud,
} from './mud-integrazioni'

export interface MudAggregato {
  anno: number
  /** cerCode a 6 cifre (chiaveConfrontoCer), una riga per CER con almeno un movimento conteggiato */
  righe: MudRifiutoLine[]
  /** movimenti conteggiati (prodotto + avviato) per CER */
  movimentiPerCer: Record<string, number>
  /**
   * CER (chiave a 6 cifre) con almeno un movimento conteggiato pericoloso, solo per mostrarli
   * con l'asterisco: fuori dalle righe, quindi il file telematico e hashAggregato non cambiano
   */
  pericolosiPerCer: Record<string, true>
  /** dati del dichiarante risolti una sola volta, riusati dall'export */
  dichiarante: { atecoNormalizzato: string | null; comuneCode: string | null }
  /** aggregazione + dichiarante + profilo */
  controlli: MudEsitoControllo[]
  /** azienda segnata come non tenuta al MUD (A-W-10): il file si genera comunque, con un avviso */
  mudNonDovuto: boolean
  /** integrazioni dell'anno lette per questa aggregazione: la traccia dell'export registra queste */
  integrazioni: IntegrazioniMud
  /** 1 = calcolo storico (un solo gruppo), 2 = una dichiarazione per unità locale (D10) */
  versioneCalcolo: 1 | 2
  /**
   * Dichiarazioni in ordine di codice (D15). Versione 1: una sola voce "fusa" (codice 1,
   * anagrafica null). `righe`, `movimentiPerCer` e `pericolosiPerCer` ne sono la somma.
   */
  dichiarazioni: MudDichiarazione[]
}

export interface OpzioniAggregazione {
  /** predefinita 2; la 1 resta per lo storico delle presentazioni (D10) */
  versioneCalcolo?: 1 | 2
}

interface Movimento {
  registroId: string
  progressiveNumber: number
  progressiveYear: number
  type: string
  causale: string
  causaleAziendaId: string | null
  cerCode: string
  quantity: Prisma.Decimal | number | string
  unit: string | null
  operationCode: string | null
  firId: string | null
  firIdRicopia: string | null
  ricopiaChiave: string
  counterpartName: string | null
  wastePhysicalState: string | null
  movementDate: Date
}

interface FirCollegato {
  id: string
  firNumber: string | null
  rentriNumeroFir: string | null
  status: string
  rentriStatoFormulario: string | null
  wasteOperationType: string | null
  wasteOperationCode: string | null
  receiverId: string | null
  receiverName: string | null
  receiverPartitaIva: string | null
  carrierId: string | null
  carrierName: string | null
  carrierPartitaIva: string | null
}

interface DestinatarioInfo {
  ragioneSociale: string
  partitaIVA: string
  via: string
  civico: string
  cap: string
  istatProvincia?: string
  istatComune?: string
}

interface TrasportatoreInfo {
  ragioneSociale: string
  partitaIVA: string
}

/** Anagrafiche e integrazioni da cui si completano DR e TE. */
interface FontiSoggetti {
  destinatari: Map<string, DestinatarioInfo>
  trasportatori: Map<string, TrasportatoreInfo>
  integrazioni: IntegrazioniMud
  /** Un solo registro nell'azienda: vale ancora la chiave vecchia `anno/numero` delle integrazioni */
  unSoloRegistro: boolean
}

interface VoceTe {
  te: MudAllegatoTE
  /** etichetta del FIR da cui viene, per il messaggio del CF mancante */
  fir: string
}

interface VoceDr {
  dr: MudAllegatoDR
  /** per il messaggio del CF mancante: `FIR <etichetta>` o `dal registro` */
  origine: string
  conFir: boolean
}

interface RigaInCorso {
  prodottoKg: number
  recuperoKg: number
  smaltimentoKg: number
  /** stati fisici (non nulli) dei movimenti inclusi */
  stati: Set<StatoFisicoRegistro>
  /** almeno un movimento incluso porta l'asterisco: serve solo a mostrare il CER */
  pericoloso: boolean
  dr: Map<string, VoceDr>
  te: Map<string, VoceTe>
}

interface GruppoUnita {
  cer6: string
  unita: string
  kgPerUnita?: number
  movimenti: RifMovimento[]
}

/** Tutto ciò che `caricaContesto` legge una volta per aggregazione. */
interface ContestoAggregazione {
  tenantId: string
  anno: number
  inizio: Date
  fine: Date
  catalogo: CatalogoCausali
  movimenti: Movimento[]
  precedenti: Movimento[]
  firCollegati: FirCollegato[]
  firPerId: Map<string, FirCollegato>
  firAnno: Array<{ id: string; firNumber: string | null; rentriNumeroFir: string | null }>
  scarichiDeiFirAnno: Array<{ firId: string | null }>
  tenant: {
    city: string | null
    province: string | null
    numeroAddetti: number | null
    atecoCode: string | null
    mudNonDovuto: boolean
    mudNonDovutoMotivo: string | null
  } | null
  comuneCode: string | null
  atecoNormalizzato: string | null
  /** versione 1: unità locali attive (PIU_UNITA_LOCALI); versione 2: vuoto */
  unitaLocali: Array<{ denominazione: string; numIscrSito: string; principale: boolean }>
  /** versione 2: tutte le unità locali dell'azienda (anche cessate, D3) e i loro registri */
  sedi: ContestoSedi | null
  /** versione 2: autorizzazioni dell'impianto registrate (D7) */
  autorizzazioni: number
  integrazioni: IntegrazioniMud
  fonti: FontiSoggetti
  rif: (m: Movimento) => RifMovimento
  etichettaPerId: (firId: string) => string
}

/** Esito del passo 0: i doppi identici, calcolati su tutti i movimenti. */
interface EsitoDoppi {
  doppi: Set<Movimento>
  doppiDi: Map<Movimento, Movimento[]>
  doppiAnnoPrecedente: Map<Movimento, Movimento>
  scaricatiAnchePrima: Map<Movimento, Movimento[]>
}

/** Strutture condivise fra i gruppi (D14), lette dalla coda globale dei controlli. */
interface Condivisi {
  segnalati: Set<string>
  trasportatoriSegnalati: Set<string>
  inclusi: Set<Movimento>
  avviatiPerFir: Map<string, Movimento[]>
}

interface EsitoGruppo {
  righeFinali: MudRifiutoLine[]
  movimentiPerCer: Record<string, number>
  pericolosiPerCer: Record<string, true>
  ricevuti: RifMovimento[]
}

const SELECT_MOVIMENTO = {
  registroId: true,
  progressiveNumber: true,
  progressiveYear: true,
  type: true,
  causale: true,
  causaleAziendaId: true,
  cerCode: true,
  quantity: true,
  unit: true,
  operationCode: true,
  firId: true,
  firIdRicopia: true,
  ricopiaChiave: true,
  counterpartName: true,
  wastePhysicalState: true,
  movementDate: true,
} as const

/** Controlli sui soggetti, deduplicati su tutto il file: la correzione vale per tutte le sedi (D14) */
const CODICI_SOGGETTI = new Set<string>([
  'DESTINATARIO_SENZA_CF',
  'DESTINATARIO_SENZA_ISTAT',
  'DESTINATARIO_ESTERO',
  'TRASPORTATORE_SENZA_CF',
])

// Confronto dei doppi storici senza la data (Decisione 20).
const EPOCA = new Date(0)
const ORIGINE_REGISTRO = 'dal registro'
const arrotonda3 = (n: number): number => Math.round(n * 1000) / 1000

/** CF o partita IVA per la fusione dei DR: maiuscolo, senza spazi né prefisso IT. */
function cfConfronto(cf: string): string {
  const pulito = cf.replace(/\s+/g, '').toUpperCase()
  return pulito.startsWith('IT') ? pulito.slice(2) : pulito
}

/**
 * Il MUD dal registro di carico e scarico: righe per CER (prodotto, recupero,
 * smaltimento, DR e TE dai FIR collegabili o dal registro) e l'elenco dei controlli.
 * Export, riepilogo, PDF e presentazione partono tutti da qui.
 */
@Injectable()
export class MudAggregazioneService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly referenceData: ReferenceDataService,
    private readonly logger: LoggerService
  ) {
    this.logger.setContext(MudAggregazioneService.name)
  }

  async aggrega(
    tenantId: string,
    anno: number,
    opzioni: OpzioniAggregazione = {}
  ): Promise<MudAggregato> {
    const versioneCalcolo = opzioni.versioneCalcolo ?? 2
    const contesto = await this.caricaContesto(tenantId, anno, versioneCalcolo)
    const {
      fine,
      movimenti,
      firAnno,
      scarichiDeiFirAnno,
      tenant,
      comuneCode,
      atecoNormalizzato,
      unitaLocali,
      integrazioni,
      rif,
      etichettaPerId,
    } = contesto

    const controlli: MudEsitoControllo[] = []
    const doppi = this.individuaDoppi(contesto)

    // Strutture condivise fra i gruppi (D14): riempite da ogni gruppo, lette nella coda globale.
    const condivisi: Condivisi = {
      segnalati: new Set(),
      trasportatoriSegnalati: new Set(),
      inclusi: new Set(),
      avviatiPerFir: new Map(),
    }
    const ricevuti: RifMovimento[] = []
    let dichiarazioni: MudDichiarazione[]
    if (versioneCalcolo === 1) {
      // Calcolo storico: un solo gruppo con tutti i movimenti, una dichiarazione "fusa".
      const gruppo = this.aggregaGruppo(movimenti, contesto, doppi, condivisi, controlli)
      ricevuti.push(...gruppo.ricevuti)
      dichiarazioni = [
        {
          codice: codiceUnitaLocale(1),
          progressivo: 1,
          unitaLocale: { id: null, denominazione: 'Azienda', numIscrSito: null, principale: false },
          anagrafica: null,
          numeroAddetti: contesto.tenant?.numeroAddetti ?? 0,
          comuneCode: contesto.comuneCode,
          conAutorizzazioni: true,
          conAllegatiAzienda: true,
          righe: gruppo.righeFinali,
          movimentiPerCer: gruppo.movimentiPerCer,
          pericolosiPerCer: gruppo.pericolosiPerCer,
        },
      ]
    } else {
      dichiarazioni = await this.dichiarazioniPerSede(
        contesto,
        doppi,
        condivisi,
        controlli,
        ricevuti
      )
    }
    // Versione 2: le giacenze al 31/12 entrano nelle righe delle dichiarazioni (D8). Nuove righe,
    // mai quelle dell'aggregato modificate; le righe senza giacenza restano identiche.
    const saldiPerRegistro = await this.saldiAl31DicembrePerRegistro(tenantId, fine, anno)
    let giacenze: EsitoGiacenze | null = null
    if (versioneCalcolo === 2) {
      const ricevutiDaTerzi = saldiPerRegistro.some(s => s.kg > 0)
        ? await this.caricoRicevutoDaTerzi(tenantId, fine, contesto.catalogo)
        : []
      giacenze = giacenzeDelleDichiarazioni(
        saldiPerRegistro,
        contesto.sedi as ContestoSedi,
        dichiarazioni,
        ricevutiDaTerzi,
        integrazioni
      )
      for (const d of dichiarazioni) {
        d.righe = giacenze.righe.get(d.unitaLocale.id ?? CHIAVE_AZIENDA) ?? d.righe
      }
    }
    const righeFinali = dichiarazioni.flatMap(d => d.righe)
    const movimentiPerCer: Record<string, number> = {}
    const pericolosiPerCer: Record<string, true> = {}
    for (const d of dichiarazioni) {
      for (const [cer, n] of Object.entries(d.movimentiPerCer)) {
        movimentiPerCer[cer] = (movimentiPerCer[cer] ?? 0) + n
      }
      Object.assign(pericolosiPerCer, d.pericolosiPerCer)
    }
    const { inclusi, avviatiPerFir } = condivisi
    const { doppiDi, doppiAnnoPrecedente, scaricatiAnchePrima } = doppi

    // Un avviso per ogni originale, con i soli suoi doppi (preflight A11).
    for (const [originale, suoiDoppi] of doppiDi) {
      const esito = controlliMud.firDoppioIdentico(etichettaPerId(originale.firId as string), [
        rif(originale),
        ...suoiDoppi.map(rif),
      ])
      // L'originale è incluso solo se l'aggregazione l'ha davvero contato.
      if (!inclusi.has(originale) && esito.movimenti) {
        esito.movimenti[0] = { ...esito.movimenti[0], incluso: false }
      }
      controlli.push(esito)
    }

    for (const [m, precedente] of doppiAnnoPrecedente) {
      controlli.push(
        controlliMud.firDoppioAnnoPrecedente(
          etichettaPerId(m.firId as string),
          rif(precedente),
          rif(m)
        )
      )
    }
    for (const [m, giaContati] of scaricatiAnchePrima) {
      // Solo se il movimento è davvero nel MUD: escluso per altri motivi, non è dichiarato due volte.
      if (!inclusi.has(m)) continue
      controlli.push(
        controlliMud.firScaricatoAncheAnnoPrecedente(
          etichettaPerId(m.firId as string),
          giaContati.map(rif),
          rif(m)
        )
      )
    }

    for (const [firId, ms] of avviatiPerFir) {
      if (ms.length > 1) {
        controlli.push(controlliMud.firScaricatoPiuVolte(etichettaPerId(firId), ms.map(rif)))
      }
    }

    if (giacenze) {
      controlli.push(...this.controlliGiacenze(anno, giacenze, dichiarazioni.length > 1))
    } else {
      // Versione 1: le giacenze non si scrivono, restano solo nell'avviso di oggi
      const saldi = this.sommaSaldiPerCer(saldiPerRegistro)
      if (saldi.length > 0) controlli.push(controlliMud.giacenzeNonCalcolate(anno, saldi))
    }

    if (movimenti.length === 0) {
      controlli.push(
        firAnno.length > 0
          ? controlliMud.registroVuotoConFir(anno, firAnno.map(etichettaFir))
          : controlliMud.nessunMovimento(anno)
      )
    } else {
      if (righeFinali.length === 0) {
        controlli.push(controlliMud.nessunRifiutoDichiarabile(anno, movimenti.length))
      }
      const scaricati = new Set(scarichiDeiFirAnno.map(s => s.firId))
      const nonRegistrati = firAnno.filter(f => !scaricati.has(f.id))
      if (nonRegistrati.length > 0) {
        controlli.push(controlliMud.firNonRegistrato(anno, nonRegistrati.map(etichettaFir)))
      }
    }

    if (ricevuti.length > 0) controlli.push(controlliMud.profiloNonSupportato(anno, ricevuti))
    if (versioneCalcolo === 1 && unitaLocali.length > 1) {
      controlli.push(controlliMud.piuUnitaLocali(unitaLocali))
    }

    if (!comuneCode) {
      controlli.push(controlliMud.dichiaranteSenzaComuneIstat(tenant?.city, tenant?.province))
    }
    if (!atecoNormalizzato) {
      controlli.push(controlliMud.dichiaranteSenzaAteco())
    } else if (!/^\d{6}$/.test(atecoNormalizzato)) {
      controlli.push(controlliMud.dichiaranteAtecoNonValido(tenant?.atecoCode ?? ''))
    }

    const mudNonDovuto = tenant?.mudNonDovuto === true
    if (mudNonDovuto) controlli.push(controlliMud.mudNonDovuto(tenant?.mudNonDovutoMotivo ?? '-'))

    this.logger.info(
      `MUD aggregato: tenant ${tenantId}, anno ${anno}, ${movimenti.length} movimenti, ${righeFinali.length} righe, ${controlli.length} controlli`
    )
    return {
      anno,
      righe: righeFinali,
      movimentiPerCer,
      pericolosiPerCer,
      controlli,
      dichiarante: { atecoNormalizzato, comuneCode },
      mudNonDovuto,
      integrazioni,
      versioneCalcolo,
      dichiarazioni,
    }
  }

  /**
   * Versione 2 (D1-D7): un gruppo per dichiarazione, in ordine di codice, con le strutture
   * condivise (D14). Aggiunge ai controlli quelli delle sedi e restituisce le dichiarazioni
   * con almeno una riga (D3).
   */
  private async dichiarazioniPerSede(
    contesto: ContestoAggregazione,
    doppi: EsitoDoppi,
    condivisi: Condivisi,
    controlli: MudEsitoControllo[],
    ricevuti: RifMovimento[]
  ): Promise<MudDichiarazione[]> {
    const { anno, catalogo, movimenti, tenant, autorizzazioni, rif } = contesto
    const sedi = contesto.sedi as ContestoSedi
    if ([...sedi.progressivi.values()].some(p => p.ripiego)) {
      this.logger.warn(
        'MUD: unità locale senza progressivo MUD, codice di ripiego assegnato in ordine di creazione'
      )
    }

    const attribuzione = attribuisciSedi(movimenti, sedi)
    const esiti = attribuzione.gruppi.map(g => {
      const locali: MudEsitoControllo[] = []
      const esito = this.aggregaGruppo(g.movimenti, contesto, doppi, condivisi, locali)
      ricevuti.push(...esito.ricevuti)
      return { g, esito, locali }
    })
    const pacchetti = esiti.filter(e => e.esito.righeFinali.length > 0)
    const piuDichiarazioni = pacchetti.length > 1

    // Controlli nati dentro un gruppo: con la sede solo se le dichiarazioni sono più d'una e mai
    // quelli sui soggetti, deduplicati su tutto il file (D14).
    for (const { g, locali } of esiti) {
      const sede = g.unitaLocale?.denominazione ?? 'Azienda'
      for (const c of locali) {
        controlli.push(piuDichiarazioni && !CODICI_SOGGETTI.has(c.codice) ? { ...c, sede } : c)
      }
    }

    // D2: registri senza sede
    const principale = sedi.unitaLocali.find(u => u.principale)
    const senzaSede = attribuzione.senzaSede.filter(m => condivisi.inclusi.has(m))
    if (principale && senzaSede.length > 0) {
      controlli.push(controlliMud.movimentiSenzaSede(anno, senzaSede.map(rif), principale))
    }
    const senzaPrincipale = attribuzione.senzaPrincipale.filter(m => {
      if (doppi.doppi.has(m)) return false
      const ruolo = classificaMovimento(catalogo, m)
      return ruolo === 'PRODOTTO' || ruolo === 'AVVIATO'
    })
    if (senzaPrincipale.length > 0) {
      controlli.push(
        controlliMud.sedePrincipaleMancante(anno, senzaPrincipale.length, sedi.unitaLocali.length)
      )
    }

    // D5: anagrafica e comune ISTAT di ogni dichiarazione (un lookup per coppia distinta)
    const comuni = new Map<string, string | null>()
    const comuneDellaSede = async (comune: string, provincia: string): Promise<string | null> => {
      const chiave = `${comune}|${provincia}`
      if (!comuni.has(chiave)) {
        const trovato = await this.referenceData.findComuneByName(comune, provincia)
        comuni.set(chiave, /^\d{6}$/.test(trovato?.code ?? '') ? (trovato?.code ?? null) : null)
      }
      return comuni.get(chiave) ?? null
    }

    const dichiarazioni: MudDichiarazione[] = []
    const perProvincia: Array<{
      denominazione: string
      comuneCode: string | null
      sigla: string | null
    }> = []
    for (const { g, esito } of pacchetti) {
      const ul = g.unitaLocale
      const nome = ul?.denominazione ?? 'Azienda'
      const ana = anagraficaDichiarazione(ul, !piuDichiarazioni, tenant ?? {})
      let comuneCode = contesto.comuneCode
      if (ul && ana.anagrafica) {
        comuneCode = await comuneDellaSede(ul.comune?.trim() ?? '', ul.provincia?.trim() ?? '')
        if (!comuneCode) {
          controlli.push(controlliMud.unitaLocaleSenzaComuneIstat(ul, ul.comune, ul.provincia))
        }
      }
      if (ul && ana.campiMancanti.length > 0) {
        controlli.push(controlliMud.unitaLocaleSenzaIndirizzo(ul, ana.campiMancanti))
      }
      if (ul && ana.principaleConIndirizzoAzienda) {
        controlli.push(controlliMud.principaleConIndirizzoAzienda(ul))
      }
      if (ul && ana.addettiMancanti) controlli.push(controlliMud.unitaLocaleSenzaAddetti(ul))
      perProvincia.push({
        denominazione: nome,
        comuneCode,
        sigla: ul && ana.anagrafica ? ul.provincia : (tenant?.province ?? null),
      })
      dichiarazioni.push({
        codice: g.codice,
        progressivo: g.progressivo,
        unitaLocale: ul
          ? {
              id: ul.id,
              denominazione: ul.denominazione,
              numIscrSito: ul.numIscrSito,
              principale: ul.principale,
            }
          : { id: null, denominazione: nome, numIscrSito: null, principale: false },
        // con l'addetto risolto: 0 quando manca e le dichiarazioni sono più d'una (D5)
        anagrafica: ana.anagrafica ? { ...ana.anagrafica, numeroAddetti: ana.numeroAddetti } : null,
        numeroAddetti: ana.numeroAddetti,
        comuneCode,
        conAutorizzazioni: false,
        conAllegatiAzienda: false,
        righe: esito.righeFinali,
        movimentiPerCer: esito.movimentiPerCer,
        pericolosiPerCer: esito.pericolosiPerCer,
      })
    }

    // D6: province diverse (le dichiarazioni sono già in ordine di codice)
    const voci = provinceDiverse(perProvincia)
    if (voci.length > 0) controlli.push(controlliMud.unitaLocaliProvinceDiverse(voci))

    // D7: AU alla principale (o alla prima per codice), AR e INT nel primo pacchetto
    if (dichiarazioni.length > 0) {
      const { au, arEInt } = dichiarazionePerAllegati(
        dichiarazioni.map(d => ({
          codice: d.codice,
          principale: d.unitaLocale.principale,
          dichiarazione: d,
        }))
      )
      if (au) au.dichiarazione.conAutorizzazioni = true
      if (arEInt) arEInt.dichiarazione.conAllegatiAzienda = true
      if (au && dichiarazioni.length > 1 && autorizzazioni > 0) {
        controlli.push(
          controlliMud.autorizzazioniSullaPrincipale(
            dichiarazioni.length,
            autorizzazioni,
            au.dichiarazione.unitaLocale,
            au.dichiarazione.unitaLocale.principale
          )
        )
      }
    }
    return dichiarazioni
  }

  /** Tutte le letture dell'aggregazione, nell'ordine di sempre (D17: nessuna logica di calcolo). */
  private async caricaContesto(
    tenantId: string,
    anno: number,
    versione: 1 | 2
  ): Promise<ContestoAggregazione> {
    const { inizio, fine } = limitiAnnoMud(anno)
    // Una lettura sola del catalogo per aggregazione; ogni movimento conta con la versione
    // della causale che porta (`causaleAziendaId`), non con quella di oggi.
    const catalogo = await caricaCatalogoCausali(this.prisma, tenantId)

    // Il servizio usa il client Prisma senza estensione RLS: ogni query porta il tenantId.
    const movimenti: Movimento[] = await this.prisma.wasteMovement.findMany({
      where: { tenantId, movementDate: { gte: inizio, lt: fine }, ...WHERE_VIGENTE },
      select: SELECT_MOVIMENTO,
      orderBy: [{ movementDate: 'asc' }, { progressiveNumber: 'asc' }],
    })

    const firIds = [...new Set(movimenti.map(m => m.firId).filter((id): id is string => !!id))]
    // Gli stessi FIR negli anni precedenti (A-C-05): un doppio registrato a cavallo d'anno
    // finirebbe in due MUD. Solo i FIR che compaiono nell'anno, quindi una query limitata.
    const precedenti: Movimento[] =
      firIds.length > 0
        ? await this.prisma.wasteMovement.findMany({
            where: {
              tenantId,
              firId: { in: firIds },
              movementDate: { lt: inizio },
              ...WHERE_VIGENTE,
            },
            select: SELECT_MOVIMENTO,
            // più anni: a parità di data e numero decide l'anno del progressivo
            orderBy: [
              { movementDate: 'asc' },
              { progressiveYear: 'asc' },
              { progressiveNumber: 'asc' },
            ],
          })
        : []
    const firCollegati: FirCollegato[] =
      firIds.length > 0
        ? await this.prisma.fIR.findMany({
            where: { tenantId, id: { in: firIds } },
            select: {
              id: true,
              firNumber: true,
              rentriNumeroFir: true,
              status: true,
              rentriStatoFormulario: true,
              wasteOperationType: true,
              wasteOperationCode: true,
              receiverId: true,
              receiverName: true,
              receiverPartitaIva: true,
              carrierId: true,
              carrierName: true,
              carrierPartitaIva: true,
            },
          })
        : []
    const firPerId = new Map(firCollegati.map(f => [f.id, f]))

    // FIR emessi e non annullati con trasporto nell'anno: la data di trasporto vale solo
    // se la presa in carico è avvenuta qui, cioè se c'è la firma del trasportatore.
    const firAnno = await this.prisma.fIR.findMany({
      where: {
        tenantId,
        status: { in: [...STATI_FIR_EMESSI] },
        signatures: { some: { role: 'TRASPORTATORE' } },
        transportDate: { gte: inizio, lt: fine },
        OR: [{ rentriStatoFormulario: null }, { rentriStatoFormulario: { not: 'Annullato' } }],
      },
      select: { id: true, firNumber: true, rentriNumeroFir: true },
    })
    const idsFirAnno = firAnno.map(f => f.id)
    // Scarichi che citano i FIR dell'anno, registrati in qualunque anno.
    const scarichiDeiFirAnno: Array<{ firId: string | null }> =
      idsFirAnno.length > 0
        ? await this.prisma.wasteMovement.findMany({
            where: { tenantId, type: 'SCARICO', firId: { in: idsFirAnno }, ...WHERE_VIGENTE },
            select: { firId: true },
          })
        : []

    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: {
        city: true,
        province: true,
        numeroAddetti: true,
        atecoCode: true,
        mudNonDovuto: true,
        mudNonDovutoMotivo: true,
      },
    })
    // Il comune si cerca solo con città e provincia: senza provincia la ricerca sarebbe ambigua.
    // Si cerca con i valori senza spazi attorno: la ricerca confronta solo in maiuscolo.
    const citta = tenant?.city?.trim() ?? ''
    const provincia = tenant?.province?.trim() ?? ''
    const comuneDichiarante =
      citta && provincia ? await this.referenceData.findComuneByName(citta, provincia) : undefined
    const codiceComune = comuneDichiarante?.code ?? ''
    const comuneCode = /^\d{6}$/.test(codiceComune) ? codiceComune : null
    const atecoNormalizzato = tenant?.atecoCode?.trim() ? normalizeAteco(tenant.atecoCode) : null

    // Versione 1: le unità locali attive, solo per PIU_UNITA_LOCALI. Versione 2: tutte, anche
    // le cessate (D3: un registro legato a una sede cessata resta sulla sua dichiarazione),
    // con i campi dell'anagrafica (D5) e il progressivo (D4); query separata dalla 1.
    const unitaLocali =
      versione === 1
        ? await this.prisma.rentriUnitaLocale.findMany({
            where: { tenantId, attiva: true },
            select: { denominazione: true, numIscrSito: true, principale: true },
            orderBy: [{ principale: 'desc' }, { denominazione: 'asc' }],
          })
        : []
    let sedi: ContestoSedi | null = null
    let autorizzazioni = 0
    if (versione === 2) {
      const tutte: MudUnitaLocaleAnagrafica[] = await this.prisma.rentriUnitaLocale.findMany({
        where: { tenantId },
        select: {
          id: true,
          denominazione: true,
          numIscrSito: true,
          principale: true,
          createdAt: true,
          indirizzo: true,
          civico: true,
          cap: true,
          comune: true,
          provincia: true,
          numeroAddetti: true,
          progressivoMud: true,
        },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      })
      sedi = creaContestoSedi(tutte, await sediDeiRegistri(this.prisma, tenantId))
      autorizzazioni = await this.prisma.autorizzazioneImpianto.count({ where: { tenantId } })
    }

    const record = await this.prisma.mUDReport.findUnique({
      where: { tenantId_year: { tenantId, year: anno } },
      select: { reportData: true },
    })
    const integrazioni = leggiIntegrazioni(record?.reportData)

    const registri = await etichetteRegistri(this.prisma, tenantId)
    const fonti: FontiSoggetti = {
      destinatari: await this.caricaDestinatari(
        tenantId,
        firCollegati.map(f => f.receiverId)
      ),
      trasportatori: await this.caricaTrasportatori(tenantId, firCollegati),
      integrazioni,
      unSoloRegistro: registri.size === 0,
    }

    // Descrizione della causale (D13): solo se il catalogo ne ha una diversa dal codice.
    const descrizioneCausale = (m: Movimento): string | undefined => {
      if (m.type !== 'CARICO' && m.type !== 'SCARICO') return undefined
      const d = catalogo.descrizione(
        m.type,
        m.causale,
        giornoItaliano(m.movementDate),
        m.causaleAziendaId
      )
      return d !== m.causale ? d : undefined
    }
    const rif = (m: Movimento): RifMovimento => ({
      registroId: m.registroId,
      registro: registri.get(m.registroId),
      progressiveNumber: m.progressiveNumber,
      progressiveYear: m.progressiveYear,
      cerCode: cerCanonico(m.cerCode),
      causale: m.causale,
      causaleDescrizione: descrizioneCausale(m),
      quantity: Number(m.quantity),
      unit: m.unit ?? '',
      movementDate: m.movementDate,
    })
    const etichettaPerId = (firId: string): string =>
      etichettaFir(firPerId.get(firId) ?? { id: firId, firNumber: null })

    return {
      tenantId,
      anno,
      inizio,
      fine,
      catalogo,
      movimenti,
      precedenti,
      firCollegati,
      firPerId,
      firAnno,
      scarichiDeiFirAnno,
      tenant,
      comuneCode,
      atecoNormalizzato,
      unitaLocali,
      sedi,
      autorizzazioni,
      integrazioni,
      fonti,
      rif,
      etichettaPerId,
    }
  }

  /**
   * Passo 0: i doppi identici (Decisione 20, C-W-03, A-C-03). Calcolato su tutti i movimenti,
   * prima dei gruppi, così un doppio si riconosce anche fra sedi diverse.
   */
  private individuaDoppi(contesto: ContestoAggregazione): EsitoDoppi {
    const { catalogo, movimenti, precedenti } = contesto

    // Passo 0: doppi identici dello stesso FIR, tipo, chiave di ricopia e ruolo (Decisione 20,
    // C-W-03, A-C-03): due quote con chiavi diverse sono movimenti distinti anche se uguali, e
    // uno scarico con una causale esclusa non nasconde il conferimento dello stesso FIR. Un
    // doppio si confronta con i movimenti già contati del gruppo, mai con quelli scartati.
    const gruppoDoppi = (m: Movimento): string | undefined => {
      if (!m.firId) return undefined
      const ruolo = classificaMovimento(catalogo, m)
      if (ruolo !== 'PRODOTTO' && ruolo !== 'AVVIATO') return undefined
      return `${m.firId}|${m.type}|${m.ricopiaChiave ?? ''}|${ruolo}`
    }
    const stessoMovimento = (c: Movimento, m: Movimento): boolean =>
      stessiDatiRicopia(c, m) ||
      // Registrati prima del piano C: la ricopia prendeva la data di oggi.
      (c.firIdRicopia === null &&
        m.firIdRicopia === null &&
        stessiDatiRicopia({ ...c, movementDate: EPOCA }, { ...m, movementDate: EPOCA }))
    const contatiPerGruppo = new Map<string, Movimento[]>()

    // Prima gli anni precedenti, con la stessa regola: restano i movimenti contati allora.
    const precedentiContati = new Set<Movimento>()
    for (const p of precedenti) {
      const gruppo = gruppoDoppi(p)
      if (!gruppo) continue
      const contati = contatiPerGruppo.get(gruppo) ?? []
      if (contati.some(c => stessoMovimento(c, p))) continue
      contatiPerGruppo.set(gruppo, [...contati, p])
      precedentiContati.add(p)
    }

    const doppiDi = new Map<Movimento, Movimento[]>()
    const doppi = new Set<Movimento>()
    const doppiAnnoPrecedente = new Map<Movimento, Movimento>()
    const scaricatiAnchePrima = new Map<Movimento, Movimento[]>()
    for (const m of movimenti) {
      const gruppo = gruppoDoppi(m)
      if (!gruppo) continue
      const contati = contatiPerGruppo.get(gruppo) ?? []
      const originale = contati.find(c => stessoMovimento(c, m))
      if (originale && precedentiContati.has(originale)) {
        doppi.add(m)
        doppiAnnoPrecedente.set(m, originale)
      } else if (originale) {
        doppi.add(m)
        doppiDi.set(originale, [...(doppiDi.get(originale) ?? []), m])
      } else {
        const giaContati = contati.filter(c => precedentiContati.has(c))
        if (giaContati.length > 0) scaricatiAnchePrima.set(m, giaContati)
        contatiPerGruppo.set(gruppo, [...contati, m])
      }
    }

    return { doppi, doppiDi, doppiAnnoPrecedente, scaricatiAnchePrima }
  }

  /**
   * Passi 1-6 su un gruppo di movimenti e righe finali. Riempie le strutture condivise e i
   * controlli; restituisce righe, conteggi e i movimenti ricevuti da terzi del gruppo.
   */
  private aggregaGruppo(
    movimenti: Movimento[],
    contesto: ContestoAggregazione,
    { doppi }: EsitoDoppi,
    condivisi: Condivisi,
    controlli: MudEsitoControllo[]
  ): EsitoGruppo {
    const { anno, catalogo, firPerId, integrazioni, fonti, rif } = contesto
    const { inclusi, avviatiPerFir } = condivisi

    const righe = new Map<string, RigaInCorso>()
    const riga = (cer6: string): RigaInCorso => {
      let r = righe.get(cer6)
      if (!r) {
        r = {
          prodottoKg: 0,
          recuperoKg: 0,
          smaltimentoKg: 0,
          stati: new Set(),
          pericoloso: false,
          dr: new Map(),
          te: new Map(),
        }
        righe.set(cer6, r)
      }
      return r
    }
    const movimentiPerCer: Record<string, number> = {}
    const pericolosiPerCer: Record<string, true> = {}
    const ricevuti: RifMovimento[] = []
    const nonConvertiti = new Map<string, GruppoUnita>()
    const convertiti = new Map<string, GruppoUnita>()

    for (const m of movimenti) {
      if (doppi.has(m)) continue
      const r = rif(m)

      // 1. Classificazione
      const ruolo = classificaMovimento(catalogo, m)
      if (ruolo === 'ESCLUSO') {
        controlli.push(controlliMud.causaleEsclusa(r))
        continue
      }
      if (ruolo === 'RICEVUTO_DA_TERZI') {
        ricevuti.push(r)
        continue
      }

      // 2. Collegabilità del FIR, prima dell'unità (Decisione 23)
      let fir: FirCollegato | undefined
      if (ruolo === 'AVVIATO' && m.firId) {
        fir = firPerId.get(m.firId)
        if (!fir) {
          controlli.push(controlliMud.firNonTrovato(r))
        } else {
          const c = collegabilitaFir(fir)
          if (!c.collegabile) {
            controlli.push(
              c.motivo === 'ANNULLATO'
                ? controlliMud.firAnnullato(r, etichettaFir(fir))
                : controlliMud.firInBozza(r, etichettaFir(fir))
            )
            continue
          }
        }
      }

      // 3. Unità di misura
      const cer6 = chiaveConfrontoCer(m.cerCode)
      const u = normalizzaUnitaRegistro(m.unit)
      const quantita = Number(m.quantity)
      let kg: number
      if (!u.massa) {
        const chiave = chiavePesoSpecifico(cer6, m.unit ?? '')
        const peso = integrazioni.pesiSpecifici[chiave]
        const destinazione = peso ? convertiti : nonConvertiti
        const gruppo = destinazione.get(chiave) ?? {
          cer6,
          unita: u.unita,
          kgPerUnita: peso?.kgPerUnita,
          movimenti: [],
        }
        gruppo.movimenti.push(r)
        destinazione.set(chiave, gruppo)
        if (!peso) continue
        kg = arrotonda3(quantita * peso.kgPerUnita)
      } else {
        kg = convertiInKg(quantita, m.unit) as number
        if (u.vuota) controlli.push(controlliMud.unitaVuotaComeKg(r))
      }

      const acc = riga(cer6)
      if (m.cerCode.includes('*')) {
        acc.pericoloso = true
        pericolosiPerCer[cer6] = true
      }
      movimentiPerCer[cer6] = (movimentiPerCer[cer6] ?? 0) + 1
      inclusi.add(m)
      const stato = statoFisicoMud(m.wastePhysicalState)
      if (stato) acc.stati.add(stato)

      // 4. Prodotto
      if (ruolo === 'PRODOTTO') {
        acc.prodottoKg += kg
        continue
      }

      // 5. Avviato a terzi (il FIR, se c'è, è collegabile)
      if (!m.firId) controlli.push(controlliMud.scaricoSenzaFir(r))
      else avviatiPerFir.set(m.firId, [...(avviatiPerFir.get(m.firId) ?? []), m])

      const operazione = this.recuperoOSmaltimento(catalogo, m, r, fir, controlli)
      if (operazione === 'R') acc.recuperoKg += kg
      else acc.smaltimentoKg += kg

      this.aggiungiDestinatario(acc, m, r, fir, kg, anno, fonti, controlli)

      if (fir?.rentriStatoFormulario === 'RespintoAccettatoParzialmente') {
        controlli.push(controlliMud.esitoFirRespinto(r, etichettaFir(fir)))
      }
    }

    // 6. Dopo il ciclo
    for (const g of nonConvertiti.values()) {
      controlli.push(controlliMud.unitaNonDiMassa(anno, g.cer6, g.unita, g.movimenti))
    }
    for (const g of convertiti.values()) {
      const kgPerUnita = g.kgPerUnita as number
      controlli.push(
        controlliMud.convertitoConPesoSpecifico(
          g.cer6,
          g.unita,
          kgPerUnita,
          g.movimenti,
          !pesoSpecificoPlausibile(g.unita, kgPerUnita)
        )
      )
    }

    const righeFinali = this.completaRighe(righe, integrazioni, anno, controlli, condivisi)
    return { righeFinali, movimentiPerCer, pericolosiPerCer, ricevuti }
  }

  /**
   * Saldo di ogni registro a fine anno (carichi meno scarichi di tutti gli anni fino al 31/12
   * italiano), per CER, in kg. Le giacenze iniziali del registro con `data_riferimento` fino al
   * 31/12 contano come carichi (non sono movimenti: non entrano in nessuna riga
   * prodotto/ricevuto). Solo le unità di massa: i movimenti in litri, mc o altro non hanno un
   * peso senza peso specifico e non entrano nel saldo (le unità vuote valgono kg, come nel resto
   * del MUD). Nessun filtro di positività: lo applica il chiamante dopo aver sommato i registri
   * (versione 1: tutti, A-W-06; versione 2: quelli della stessa dichiarazione, D8).
   */
  private async saldiAl31DicembrePerRegistro(
    tenantId: string,
    fine: Date,
    anno: number
  ): Promise<SaldoRegistro[]> {
    const gruppi = await this.prisma.wasteMovement.groupBy({
      by: ['registroId', 'cerCode', 'type', 'unit'],
      where: { tenantId, movementDate: { lt: fine }, ...WHERE_VIGENTE },
      _sum: { quantity: true },
    })
    // chiave = registro e cifre del CER; l'asterisco dei pericolosi vince su qualunque formato
    const perRegistroECer = new Map<
      string,
      { registroId: string; cer6: string; kg: number; pericoloso: boolean; codice: string }
    >()
    const somma = (registroId: string, codice: string, kg: number): void => {
      const cer6 = chiaveConfrontoCer(codice)
      const chiave = `${registroId}|${cer6}`
      const prec = perRegistroECer.get(chiave) ?? {
        registroId,
        cer6,
        kg: 0,
        pericoloso: false,
        codice,
      }
      perRegistroECer.set(chiave, {
        ...prec,
        kg: prec.kg + kg,
        pericoloso: prec.pericoloso || codice.includes('*'),
      })
    }
    for (const g of gruppi) {
      const kg = convertiInKg(Number(g._sum.quantity ?? 0), g.unit)
      if (kg === null) continue
      somma(g.registroId, g.cerCode, (g.type === 'CARICO' ? 1 : -1) * kg)
    }
    // `data_riferimento` è già il giorno italiano: si confronta col 31/12 come giorno, non con `fine`.
    const aperture = await leggiApertureRegistro(this.prisma, tenantId, {
      finoAl: `${anno}-12-31`,
    })
    for (const ap of aperture) {
      const kg = apertureInKg(ap)
      if (kg === null) continue
      somma(ap.registroId, ap.cerCode, kg)
    }
    return [...perRegistroECer.values()]
      .sort((a, b) =>
        a.registroId !== b.registroId
          ? a.registroId < b.registroId
            ? -1
            : 1
          : a.cer6 < b.cer6
            ? -1
            : a.cer6 > b.cer6
              ? 1
              : 0
      )
      .map(v => ({
        registroId: v.registroId,
        cerCode6: cerCanonico(v.pericoloso && !v.codice.includes('*') ? `${v.cer6}*` : v.codice),
        kg: v.kg,
        pericoloso: v.pericoloso,
      }))
  }

  /**
   * Versione 1: i saldi di tutti i registri sommati per CER, solo quelli sopra mezzo grammo,
   * ordinati per CER e arrotondati al grammo (A-W-06): l'elenco di sempre.
   */
  private sommaSaldiPerCer(saldi: SaldoRegistro[]): Array<{ cerCode6: string; kg: number }> {
    const perCer = new Map<string, { kg: number; pericoloso: boolean; codice: string }>()
    for (const s of saldi) {
      const cer6 = chiaveConfrontoCer(s.cerCode6)
      const prec = perCer.get(cer6) ?? { kg: 0, pericoloso: false, codice: s.cerCode6 }
      perCer.set(cer6, {
        kg: prec.kg + s.kg,
        pericoloso: prec.pericoloso || s.pericoloso,
        codice: prec.codice,
      })
    }
    return [...perCer.entries()]
      .filter(([, v]) => v.kg > 0.0005)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([cer6, v]) => ({
        cerCode6: cerCanonico(v.pericoloso && !v.codice.includes('*') ? `${cer6}*` : v.codice),
        kg: arrotonda3(v.kg),
      }))
  }

  /**
   * CER che ogni registro ha ricevuto da terzi fino al 31/12 (D8): una giacenza che include un
   * rifiuto ricevuto da terzi non si attribuisce al solo produttore. Un gruppo per
   * (registro, CER, causale, versione aziendale) con la prima e l'ultima data, classificato alle
   * due date: basta una a dare RICEVUTO_DA_TERZI.
   * Limite dichiarato: una versione aziendale della causale valida solo fra `_min` e `_max` con un
   * ruolo diverso non viene vista. È un caso raro: la versione si sceglie con `causaleAziendaId`,
   * che fa parte del `by`, quindi la data conta solo per le causali di sistema, che non hanno
   * versioni.
   */
  private async caricoRicevutoDaTerzi(
    tenantId: string,
    fine: Date,
    catalogo: CatalogoCausali
  ): Promise<RicevutoDaTerzi[]> {
    const gruppi = await this.prisma.wasteMovement.groupBy({
      by: ['registroId', 'cerCode', 'causale', 'causaleAziendaId'],
      where: { tenantId, type: 'CARICO', movementDate: { lt: fine }, ...WHERE_VIGENTE },
      _min: { movementDate: true },
      _max: { movementDate: true },
    })
    const trovati = new Map<string, RicevutoDaTerzi>()
    for (const g of gruppi) {
      const date = [g._min?.movementDate, g._max?.movementDate].filter(
        (d): d is Date => d instanceof Date
      )
      const ricevuto = date.some(
        d =>
          classificaMovimento(catalogo, {
            type: 'CARICO',
            causale: g.causale,
            causaleAziendaId: g.causaleAziendaId,
            movementDate: d,
          }) === 'RICEVUTO_DA_TERZI'
      )
      if (ricevuto) {
        trovati.set(`${g.registroId}|${chiaveConfrontoCer(g.cerCode)}`, {
          registroId: g.registroId,
          cerCode: g.cerCode,
        })
      }
    }
    return [...trovati.values()]
  }

  /** Avvisi delle giacenze (D8, D9, D16): uno per dichiarazione con voci non scritte, uno per ripartizione. */
  private controlliGiacenze(
    anno: number,
    giacenze: EsitoGiacenze,
    conSede: boolean
  ): MudEsitoControllo[] {
    const esiti: MudEsitoControllo[] = []
    const nomeSede = (u: { denominazione: string } | null): string => u?.denominazione ?? 'Azienda'
    // la sede compare solo con più dichiarazioni nel file (D14)
    const conLaSede = (c: MudEsitoControllo, u: { denominazione: string } | null) =>
      conSede ? { ...c, sede: nomeSede(u) } : c
    for (const n of giacenze.nonDichiarate) {
      esiti.push(conLaSede(controlliMud.giacenzeNonDichiarate(anno, n.voci), n.unitaLocale))
    }
    for (const r of giacenze.ripartizioni) {
      const dati = {
        cerCode: r.cerCode,
        cer6: r.cer6,
        unitaLocaleId: r.unitaLocale?.id ?? null,
        sede: nomeSede(r.unitaLocale),
        kg: r.kg,
      }
      esiti.push(
        conLaSede(
          r.tipo === 'RIPARTITA'
            ? controlliMud.giacenzaRipartita(anno, {
                ...dati,
                recuperoKg: r.recuperoKg,
                smaltimentoKg: r.smaltimentoKg,
              })
            : controlliMud.giacenzaDestinazioneNonIndicata(anno, dati),
          r.unitaLocale
        )
      )
    }
    return esiti
  }

  /** Recupero o smaltimento di uno scarico, nell'ordine della Decisione 5. */
  private recuperoOSmaltimento(
    catalogo: CatalogoCausali,
    m: Movimento,
    r: RifMovimento,
    fir: FirCollegato | undefined,
    controlli: MudEsitoControllo[]
  ): 'R' | 'D' {
    const { operazione, origine } = operazioneDelMovimento(catalogo, m, fir)
    if (origine === 'TIPO_FIR' && fir) {
      controlli.push(controlliMud.operazioneDedottaDalFir(r, etichettaFir(fir), operazione))
    } else if (origine === 'NON_INDICATA') {
      controlli.push(controlliMud.operazioneNonIndicata(r))
    }
    return operazione
  }

  /** DR e TE di uno scarico conteggiato: dal FIR collegabile, altrimenti dal registro. */
  private aggiungiDestinatario(
    acc: RigaInCorso,
    m: Movimento,
    r: RifMovimento,
    fir: FirCollegato | undefined,
    kg: number,
    anno: number,
    { destinatari, trasportatori, integrazioni, unSoloRegistro }: FontiSoggetti,
    controlli: MudEsitoControllo[]
  ): void {
    const nomeFir = fir?.receiverName?.trim()
    const chiaveFir = fir
      ? fir.receiverId || fir.receiverPartitaIva || (nomeFir ? `nome:${nomeFir.toUpperCase()}` : '')
      : ''

    if (fir && chiaveFir) {
      const info = fir.receiverId ? destinatari.get(fir.receiverId) : undefined
      const esistente = acc.dr.get(chiaveFir)
      if (esistente) {
        esistente.dr.quantitaKg += kg
      } else {
        acc.dr.set(chiaveFir, {
          dr: {
            codiceFiscale: info?.partitaIVA || fir.receiverPartitaIva || '',
            ragioneSociale: info?.ragioneSociale || nomeFir || '',
            istatProvincia: info?.istatProvincia,
            istatComune: info?.istatComune,
            indirizzo: info?.via,
            civico: info?.civico,
            cap: info?.cap,
            quantitaKg: kg,
          },
          origine: `FIR ${etichettaFir(fir)}`,
          conFir: true,
        })
      }
    } else {
      // Senza FIR, o con un FIR che non indica il destinatario: quello del registro, e in
      // mancanza quello del movimento nelle integrazioni (A-W-07, A-C-04).
      const nome = m.counterpartName?.trim()
      const integrato = nome ? undefined : destinatarioDelMovimento(integrazioni, m, unSoloRegistro)
      if (integrato) {
        // Chiave per CF: in completaRighe si fonde con gli altri DR dello stesso CF.
        const chiave = `cf:${cfConfronto(integrato.codiceFiscale)}`
        const esistente = acc.dr.get(chiave)
        if (esistente) {
          esistente.dr.quantitaKg += kg
        } else {
          acc.dr.set(chiave, {
            dr: {
              codiceFiscale: integrato.codiceFiscale,
              ragioneSociale: integrato.ragioneSociale,
              quantitaKg: kg,
            },
            origine: ORIGINE_REGISTRO,
            conFir: false,
          })
        }
      } else if (!nome) {
        controlli.push(controlliMud.destinatarioNonIndicato(r, anno))
      } else {
        const chiave = `nome:${nome.toUpperCase()}`
        const esistente = acc.dr.get(chiave)
        if (esistente) {
          esistente.dr.quantitaKg += kg
        } else {
          acc.dr.set(chiave, {
            dr: { codiceFiscale: '', ragioneSociale: nome, quantitaKg: kg },
            origine: ORIGINE_REGISTRO,
            conFir: false,
          })
        }
      }
    }

    if (fir) {
      // TE dal FIR (A-W-08). Nello schema i campi del trasportatore sono NOT NULL: "manca"
      // vuol dire stringa vuota. Il CF mancante si cerca in anagrafica, poi nelle integrazioni.
      const etichetta = etichettaFir(fir)
      const pivaFir = fir.carrierPartitaIva?.trim() ?? ''
      const nomeTrasportatore = fir.carrierName?.trim() ?? ''
      const info = fir.carrierId ? trasportatori.get(fir.carrierId) : undefined
      // Piano R, Minor 8: un trasportatore senza nome né partita IVA, sul FIR o in anagrafica
      // (id che non si risolve), non è identificato. Non si emette un TE con un nome
      // segnaposto, che diventerebbe la chiave di un'integrazione legata all'etichetta del FIR.
      const identificato =
        pivaFir || nomeTrasportatore || info?.ragioneSociale?.trim() || info?.partitaIVA?.trim()
      if (!identificato) {
        controlli.push(controlliMud.trasportatoreNonIndicato(r, etichetta))
      } else {
        // Il segnaposto resta solo con la partita IVA nota: non chiede nessuna integrazione.
        const ragioneSociale =
          nomeTrasportatore || info?.ragioneSociale?.trim() || `trasportatore del FIR ${etichetta}`
        // Preflight F24: con il solo nome, un modulo per ragione sociale normalizzata.
        const chiaveTe = fir.carrierId || pivaFir || `nome:${chiaveDestinatario(ragioneSociale)}`
        if (!acc.te.has(chiaveTe)) {
          acc.te.set(chiaveTe, {
            te: { codiceFiscale: pivaFir || info?.partitaIVA?.trim() || '', ragioneSociale },
            fir: etichetta,
          })
        }
      }
    }
  }

  /**
   * Righe finali, ordinate per CER: CF dei DR e dei TE dalle integrazioni, fusione dei DR con
   * lo stesso CF (rilievo G3-D-08) e un solo TE per CF, controlli sui DR senza CF o senza ISTAT
   * e sui TE senza CF, quantità al grammo.
   */
  private completaRighe(
    righe: Map<string, RigaInCorso>,
    integrazioni: IntegrazioniMud,
    anno: number,
    controlli: MudEsitoControllo[],
    condivisi: Condivisi
  ): MudRifiutoLine[] {
    // Lo stesso destinatario sotto più CER dà un solo controllo.
    const { segnalati } = condivisi
    const segnalaUnaVolta = (esito: MudEsitoControllo) => {
      if (segnalati.has(esito.messaggio)) return
      segnalati.add(esito.messaggio)
      controlli.push(esito)
    }
    // Il messaggio del TE cita il FIR, quindi non basta deduplicarlo per testo (preflight F24):
    // un solo controllo per ragione sociale normalizzata, come la riga delle integrazioni.

    return [...righe.keys()].sort().map(cer6 => {
      const acc = righe.get(cer6) as RigaInCorso

      const voci: VoceDr[] = [...acc.dr.values()].map(v => ({ ...v, dr: { ...v.dr } }))
      for (const v of voci) {
        if (v.dr.codiceFiscale.trim()) continue
        const integrato = integrazioni.destinatari[chiaveDestinatario(v.dr.ragioneSociale)]
        if (integrato?.nazione) {
          // Destinatario estero (A-W-05): nazione al posto del CF, con un avviso
          v.dr.nazione = integrato.nazione
          segnalaUnaVolta(controlliMud.destinatarioEstero(v.dr.ragioneSociale, integrato.nazione))
        } else if (integrato) {
          v.dr.codiceFiscale = integrato.codiceFiscale
        } else {
          segnalaUnaVolta(controlliMud.destinatarioSenzaCf(v.dr.ragioneSociale, v.origine, anno))
        }
      }

      // Stesso CF: un solo DR, quantità sommate, anagrafica del primo con FIR (o del primo).
      const gruppi = new Map<string, VoceDr[]>()
      const ordine: Array<VoceDr | string> = []
      for (const v of voci) {
        const cf = cfConfronto(v.dr.codiceFiscale)
        if (!cf) {
          ordine.push(v)
        } else if (gruppi.has(cf)) {
          gruppi.get(cf)!.push(v)
        } else {
          gruppi.set(cf, [v])
          ordine.push(cf)
        }
      }
      const dr: MudAllegatoDR[] = ordine.map(voce => {
        if (typeof voce !== 'string') return voce.dr
        const gruppo = gruppi.get(voce)!
        const rappresentante = gruppo.find(g => g.conFir) ?? gruppo[0]
        return {
          ...rappresentante.dr,
          quantitaKg: gruppo.reduce((s, g) => s + g.dr.quantitaKg, 0),
        }
      })

      for (const d of dr) {
        d.quantitaKg = arrotonda3(d.quantitaKg)
        // un destinatario estero non ha il comune ISTAT
        if (!d.istatComune && !d.nazione)
          segnalaUnaVolta(controlliMud.destinatarioSenzaIstat(d.ragioneSociale))
      }

      const stati = [...acc.stati]
      if (stati.length > 1 || stati[0] === 'NON_RICONOSCIUTO') {
        controlli.push(
          controlliMud.statoFisicoNonUnivoco(acc.pericoloso ? `${cer6}*` : cer6, stati)
        )
      }

      return {
        cerCode: cer6,
        ...(stati.length === 1 && stati[0] !== 'NON_RICONOSCIUTO' ? { statoFisico: stati[0] } : {}),
        prodottoKg: arrotonda3(acc.prodottoKg),
        recuperoKg: arrotonda3(acc.recuperoKg),
        smaltimentoKg: arrotonda3(acc.smaltimentoKg),
        dr,
        te: this.completaTe(acc, integrazioni, anno, condivisi, controlli),
      }
    })
  }

  /** TE di una riga: CF dalle integrazioni, un solo modulo per CF, controllo sul CF mancante. */
  private completaTe(
    acc: RigaInCorso,
    integrazioni: IntegrazioniMud,
    anno: number,
    { trasportatoriSegnalati: segnalati }: Condivisi,
    controlli: MudEsitoControllo[]
  ): MudAllegatoTE[] {
    const te: MudAllegatoTE[] = []
    const cfVisti = new Set<string>()
    for (const v of acc.te.values()) {
      const t = { ...v.te }
      const chiave = chiaveDestinatario(t.ragioneSociale)
      if (!t.codiceFiscale.trim()) {
        const integrato = integrazioni.trasportatori[chiave]
        if (integrato) {
          t.codiceFiscale = integrato.codiceFiscale
        } else if (!segnalati.has(chiave)) {
          segnalati.add(chiave)
          controlli.push(controlliMud.trasportatoreSenzaCf(t.ragioneSociale, v.fir, anno))
        }
      }
      const cf = cfConfronto(t.codiceFiscale)
      if (cf && cfVisti.has(cf)) continue
      if (cf) cfVisti.add(cf)
      te.push(t)
    }
    return te
  }

  /**
   * CF e ragione sociale dei trasportatori in anagrafica, solo per i FIR che non li
   * riportano (preflight F24): il dato che l'applicazione ha già non si chiede all'utente.
   */
  private async caricaTrasportatori(
    tenantId: string,
    firCollegati: FirCollegato[]
  ): Promise<Map<string, TrasportatoreInfo>> {
    const ids = Array.from(
      new Set(
        firCollegati
          .filter(f => !f.carrierPartitaIva?.trim() || !f.carrierName?.trim())
          .map(f => f.carrierId)
          .filter((id): id is string => !!id)
      )
    )
    const info = new Map<string, TrasportatoreInfo>()
    if (ids.length === 0) return info
    // Client senza estensione RLS: il perimetro dell'azienda sta nella query.
    const trasportatori = await this.prisma.trasportatore.findMany({
      where: { id: { in: ids }, tenantId },
      select: { id: true, ragioneSociale: true, partitaIVA: true },
    })
    for (const t of trasportatori) {
      info.set(t.id, { ragioneSociale: t.ragioneSociale, partitaIVA: t.partitaIVA })
    }
    return info
  }

  /**
   * Anagrafica e codice ISTAT (provincia 3 + comune 3) dei destinatari dei FIR,
   * con il comune risolto dalle tabelle di riferimento condivise.
   */
  private async caricaDestinatari(
    tenantId: string,
    receiverIds: Array<string | null>
  ): Promise<Map<string, DestinatarioInfo>> {
    const ids = Array.from(new Set(receiverIds.filter((id): id is string => !!id)))
    const info = new Map<string, DestinatarioInfo>()
    if (ids.length === 0) return info

    // Il `tenantId` è obbligatorio anche se gli id arrivano dai FIR del tenant:
    // questo service usa il client Prisma senza estensione RLS, quindi il
    // perimetro dell'azienda esiste solo se sta scritto nella query.
    const destinatari = await this.prisma.destinatario.findMany({
      where: { id: { in: ids }, tenantId },
    })

    // Un solo lookup per coppia (comune, provincia) distinta.
    const comuni = new Map<
      string,
      Awaited<ReturnType<typeof this.referenceData.findComuneByName>>
    >()
    for (const d of destinatari) {
      const chiave = `${d.comune}|${d.provincia}`
      if (!comuni.has(chiave)) {
        comuni.set(chiave, await this.referenceData.findComuneByName(d.comune, d.provincia))
      }
    }

    for (const d of destinatari) {
      const comune = comuni.get(`${d.comune}|${d.provincia}`)
      info.set(d.id, {
        ragioneSociale: d.ragioneSociale,
        partitaIVA: d.partitaIVA,
        via: d.via,
        civico: d.civico,
        cap: d.cap,
        // Codice ISTAT 6 cifre = provincia(3) + comune(3).
        istatProvincia: comune?.code?.slice(0, 3),
        istatComune: comune?.code?.slice(3, 6),
      })
    }
    return info
  }
}
