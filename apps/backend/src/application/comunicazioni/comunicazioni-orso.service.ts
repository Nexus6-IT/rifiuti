import { createHash } from 'node:crypto'
import { Inject, Injectable, Optional } from '@nestjs/common'
import { Prisma } from '@prisma/client'
import { giornoItaliano } from '../../core/time/anno-italiano'
import { PrismaService } from '../../infrastructure/persistence/prisma.service'
import { aggregaOrso } from '../../domain/comunicazioni/orso/aggrega-orso'
import { aggregaOrsoDettagliata } from '../../domain/comunicazioni/orso/aggrega-orso-dettagliata'
import {
  adattaMovimentiOrso,
  aggregatoDettagliatoInImpiantoMesi,
  aggregatoInImpiantoMesi,
  movimentiConteggiati,
  movimentiSenzaDescrizione,
} from '../../domain/comunicazioni/orso/adatta-orso'
import type {
  AggregatoOrso,
  AggregatoOrsoDettagliato,
  CodiceAvvisoOrso,
} from '../../domain/comunicazioni/orso/aggregato'
import type { ImpiantoMesiDati } from '../../domain/comunicazioni/orso/impianto-mesi'
import { registroTracciati } from '../../domain/comunicazioni/registro-tracciati'
import { caricaCatalogoCausali } from '../registro/causali/catalogo-causali.repository'
import { limitiAnnoMud } from '../mud/aggregazione/mud-regole'
import { leggiIntegrazioni } from '../mud/aggregazione/mud-integrazioni'
import {
  ComunicazioneConBloccantiError,
  ComunicazioneNonTrovataError,
  type AnteprimaOrso,
  type AvvisoOrso as AvvisoComunicazione,
  type MovimentoAvviso,
  type ComunicazioneVista,
  type ComunicazioniOrsoPort,
  type FileComunicazione,
  type MeseOrso as AnteprimaMeseOrso,
  type ModalitaOrso,
} from './comunicazioni-orso.port'
import {
  ANAGRAFICA_COMUNICAZIONI_SERVICE,
  type AnagraficaComunicazioniPort,
} from './anagrafica-comunicazioni.port'
import { AnagraficaComunicazioniService } from './anagrafica-comunicazioni.service'
import {
  CONFIGURAZIONE_COMUNICAZIONI_SERVICE,
  type ConfigurazioneComunicazioniPort,
} from './configurazione-comunicazioni.port'
import { ConfigurazioneComunicazioniService } from './configurazione-comunicazioni.service'
import { leggiDettagliTracciato } from './lettore-dettagli-tracciato'
import { risolviSoggettiOrso, type CodiceErroreSoggetto } from './soggetti-orso'
import {
  leggiMovimentiOrso,
  type MovimentoOrso as MovimentoLettoDb,
} from './lettore-movimenti-orso'

/**
 * Comunicazione O.R.SO. (Lombardia, scheda impianti, modalità normale): anteprima, generazione
 * del file XML, segnatura «inviata» e rilevamento di modifiche successive all'invio (4.9a, T4).
 * Contratto API: `brief-ondata-2.md`, sezione 4.9a. Il file si genera per sede e per anno solare.
 */

export const CONSORZIO_ORSO = 'ORSO'
const TRACCIATO = 'ImpiantoMesi'
const VERSIONE = '1'
/** Versione della modalità dettagliata (4.9e): hash, idempotenza e storico restano separati. */
export const VERSIONE_DETTAGLIATA = '1-dettagliata'

const versioneDi = (m: ModalitaOrso) => (m === 'DETTAGLIATA' ? VERSIONE_DETTAGLIATA : VERSIONE)
const modalitaDiVersione = (versione: string): ModalitaOrso =>
  versione === VERSIONE_DETTAGLIATA ? 'DETTAGLIATA' : 'NORMALE'
const AUTORE = 'WasteFlow'

/**
 * Con quali pesi specifici si convertono in kg le quantità non di massa nel calcolo delle giacenze.
 * Si salva con la comunicazione e il confronto «modificata dopo l'invio» la ricalcola con lo stesso
 * metodo con cui è stata generata: cambiare il metodo non tocca quindi le comunicazioni già fatte.
 * - `ANNO_COMUNICAZIONE`: tutti i movimenti coi pesi dell'anno della comunicazione (metodo storico,
 *   default delle righe esistenti al momento della migration);
 * - `PESI_PER_ANNO`: ogni movimento coi pesi del proprio anno solare (comunicazioni nuove).
 */
export type MetodoPesi = 'ANNO_COMUNICAZIONE' | 'PESI_PER_ANNO'
export const METODO_PESI_CORRENTE: MetodoPesi = 'PESI_PER_ANNO'

export type CodiceAvvisoComunicazione =
  | CodiceAvvisoOrso
  | 'PROVINCIA_IMPIANTO_MANCANTE'
  | 'DESCRIZIONE_VUOTA'
  | 'PROVINCIA_DA_INDIRIZZO'
  | 'DATI_NON_VALIDI'
  | CodiceErroreSoggetto

const MESSAGGI: Record<CodiceAvvisoComunicazione, string> = {
  PROVINCIA_CONFERITORE_MANCANTE:
    'Provincia del conferitore non ricavabile dal FIR: il carico non si può classificare come provinciale o extra-provinciale.',
  QUANTITA_NON_CONVERTIBILE:
    'Quantità in un’unità non convertibile in kg (manca il peso specifico): il movimento non può entrare nel file.',
  OPERAZIONE_MANCANTE: 'Operazione di recupero o smaltimento non indicata sul movimento.',
  GIACENZA_NEGATIVA:
    'Giacenza a fine mese negativa per un CER (più scarichi che carichi nel registro): nel file è indicata come 0, controlla i movimenti.',
  PROVINCIA_DA_INDIRIZZO:
    'Provincia del conferitore ricavata dall’indirizzo della controparte (nessun FIR collegato): verifica che sia corretta.',
  PROVINCIA_IMPIANTO_MANCANTE:
    'La sede non ha la provincia: serve per distinguere i carichi provinciali da quelli extra-provinciali.',
  DESCRIZIONE_VUOTA:
    'Movimento senza descrizione del rifiuto: il tracciato richiede da 1 a 100 caratteri.',
  DATI_NON_VALIDI: 'I dati non rispettano il tracciato O.R.SO.',
  SOGGETTO_NON_IDENTIFICATO:
    'Conferitore o destinatario non identificabile: in modalità dettagliata ogni movimento deve avere il suo soggetto. Con il FIR lo si ricava dalla sede della ditta indicata sul formulario; senza FIR dalla controparte del movimento, la cui denominazione deve coincidere con la ragione sociale di una ditta in anagrafica (con l’indirizzo, se la ditta ha più sedi; se il movimento ha un indirizzo, il comune della sede deve comparire in esso). Controlla la controparte: potrebbe essere un soggetto omonimo di un altro comune. Correggi la controparte nel movimento del registro o la ditta in anagrafica.',
  ISTAT_SOGGETTO_NON_VALIDO:
    'Il codice ISTAT del comune della sede del soggetto non è utilizzabile: correggilo nell’anagrafica della sede della ditta.',
  CODICE_FISCALE_SOGGETTO_NON_VALIDO:
    'Il soggetto non ha un codice fiscale o una partita IVA di 11 o 16 caratteri: correggilo nell’anagrafica della ditta.',
}

const BLOCCANTI = new Set<CodiceAvvisoComunicazione>([
  'PROVINCIA_CONFERITORE_MANCANTE',
  'QUANTITA_NON_CONVERTIBILE',
  'PROVINCIA_IMPIANTO_MANCANTE',
  'DESCRIZIONE_VUOTA',
  'DATI_NON_VALIDI',
  'SOGGETTO_NON_IDENTIFICATO',
  'ISTAT_SOGGETTO_NON_VALIDO',
  'CODICE_FISCALE_SOGGETTO_NON_VALIDO',
])

export function eBloccante(codice: CodiceAvvisoComunicazione): boolean {
  return BLOCCANTI.has(codice)
}

/** Ultimo mese da dichiarare: 12 per gli anni passati, il mese corrente nell'anno in corso, 0 nel futuro. */
export function ultimoMeseDichiarabile(anno: number, adesso: Date = new Date()): number {
  const oggi = giornoItaliano(adesso)
  const annoCorrente = Number(oggi.slice(0, 4))
  if (anno < annoCorrente) return 12
  if (anno > annoCorrente) return 0
  return Number(oggi.slice(5, 7))
}

/**
 * Hash dei dati che finiscono nel file: stessi dati, stesso hash (l'aggregatore ordina tutto).
 * I mesi senza nodi non entrano: nell'anno in corso il numero di mesi dichiarati cresce da solo
 * col calendario e non deve far risultare «modificata dopo l'invio» una comunicazione intatta.
 */
export function hashDatiOrso(dati: ImpiantoMesiDati): string {
  const coperti = {
    ...dati,
    anni: dati.anni.map(a => ({
      ...a,
      mesi: a.mesi.filter(m => m.ricevuti.length > 0 || m.prodotti.length > 0),
    })),
  }
  return createHash('sha256').update(JSON.stringify(coperti)).digest('hex')
}

/** Anteprima mese per mese (12 mesi, anche vuoti) dall'aggregato. */
export function anteprimaMesi(a: AggregatoOrso): AnteprimaMeseOrso[] {
  return Array.from({ length: 12 }, (_, i) => {
    const m = a.mesi.find(x => x.mese === i + 1)
    return {
      mese: i + 1,
      ricevuti: (m?.ricevuti ?? []).map(r => ({
        cer: r.cer,
        descrizione: r.descrizione,
        operazioni: r.operazioni,
        totT: r.totale,
        extraT: r.extra,
        conFir: r.f === 1,
      })),
      prodotti: (m?.prodotti ?? []).map(p => ({
        cer: p.cer,
        descrizione: p.descrizione,
        operazioni: [],
        totT: p.totale,
        giacenzaFineMeseT: p.giacenzaFineMese,
      })),
    }
  })
}

/** Anteprima mese per mese in modalità dettagliata: stesse righe, con il soggetto di ogni quota. */
export function anteprimaMesiDettagliata(a: AggregatoOrsoDettagliato): AnteprimaMeseOrso[] {
  return Array.from({ length: 12 }, (_, i) => {
    const m = a.mesi.find(x => x.mese === i + 1)
    return {
      mese: i + 1,
      ricevuti: (m?.ricevuti ?? []).map(r => ({
        cer: r.cer,
        descrizione: r.descrizione,
        operazioni: r.operazioni,
        totT: r.totale,
        // Nessun «Extra» in modalità dettagliata: il dettaglio per soggetto lo sostituisce.
        extraT: '0',
        conFir: r.ingressi.some(x => x.f === 1),
        soggetti: r.ingressi.map(x => ({
          ts: x.ts,
          s: x.s,
          etichetta: x.etichetta,
          qT: x.totale,
          conFir: x.f === 1,
        })),
      })),
      prodotti: (m?.prodotti ?? []).map(p => ({
        cer: p.cer,
        descrizione: p.descrizione,
        operazioni: [],
        totT: p.totale,
        giacenzaFineMeseT: p.giacenzaFineMese,
        soggetti: p.uscite.map(x => ({ ts: x.ts, s: x.s, etichetta: x.etichetta, qT: x.totale })),
      })),
    }
  })
}

/** Avvisi raggruppati per codice (uno per tipo, con tutti i movimenti coinvolti). */
export function raggruppaAvvisi(
  grezzi: ReadonlyArray<{
    codice: CodiceAvvisoComunicazione
    movimentoIds: string[]
    /** Sede o soggetto coinvolto: si accoda al messaggio (modalità dettagliata). */
    dettaglio?: string
  }>,
  dettagli: ReadonlyMap<string, MovimentoAvviso> = new Map()
): AvvisoComunicazione[] {
  const perCodice = new Map<CodiceAvvisoComunicazione, Set<string>>()
  const dettaglioPerCodice = new Map<CodiceAvvisoComunicazione, string[]>()
  for (const a of grezzi) {
    const ids = perCodice.get(a.codice) ?? new Set<string>()
    a.movimentoIds.forEach(id => ids.add(id))
    perCodice.set(a.codice, ids)
    if (a.dettaglio) {
      const d = dettaglioPerCodice.get(a.codice) ?? []
      if (!d.includes(a.dettaglio)) d.push(a.dettaglio)
      dettaglioPerCodice.set(a.codice, d)
    }
  }
  const coda = (codice: CodiceAvvisoComunicazione): string => {
    const d = dettaglioPerCodice.get(codice) ?? []
    if (d.length === 0) return ''
    return ` ${d.slice(0, 5).join('; ')}${d.length > 5 ? `; altri ${d.length - 5}` : ''}.`
  }
  return [...perCodice.entries()]
    .map(([codice, ids]) => ({
      codice,
      messaggio: `${MESSAGGI[codice]}${coda(codice)}`,
      movimentoIds: [...ids].sort(),
      movimenti: [...ids]
        .sort()
        .map(id => dettagli.get(id))
        .filter((d): d is MovimentoAvviso => d !== undefined),
    }))
    .sort(
      (x, y) =>
        Number(eBloccante(y.codice)) - Number(eBloccante(x.codice)) ||
        x.codice.localeCompare(y.codice)
    )
}

interface Calcolo {
  unita: { id: string; nome: string; provincia: string | null; numIscrSito: string }
  anno: number
  modalita: ModalitaOrso
  letti: MovimentoLettoDb[]
  dati: ImpiantoMesiDati
  /** Anteprima mese per mese, già nella forma dell'API. */
  mesi: AnteprimaMeseOrso[]
  nuoviImpianti: number
  avvisi: AvvisoComunicazione[]
  bloccanti: boolean
  hashDati: string
  metodoPesi: MetodoPesi
}

type RigaComunicazione = Prisma.ComunicazioneConsorzioGetPayload<{
  select: {
    id: true
    consorzio: true
    unitaLocaleId: true
    periodoDa: true
    periodoA: true
    tracciato: true
    versione: true
    stato: true
    hashDati: true
    metodoPesi: true
    nomeFile: true
    generataIl: true
    generataDa: true
    inviataIl: true
    inviataDa: true
  }
}>

const SELEZIONE_VISTA = {
  id: true,
  consorzio: true,
  unitaLocaleId: true,
  periodoDa: true,
  periodoA: true,
  tracciato: true,
  versione: true,
  stato: true,
  hashDati: true,
  metodoPesi: true,
  nomeFile: true,
  generataIl: true,
  generataDa: true,
  inviataIl: true,
  inviataDa: true,
} as const

const LIMITE_ELENCO = 200

const giorno = (d: Date) => d.toISOString().slice(0, 10)

function nota(modalita: ModalitaOrso): string {
  return registroTracciati.get('ORSO', `${TRACCIATO}-${versioneDi(modalita)}`).notaAffidabilita
}

function vista(r: RigaComunicazione, hashAttuale: string | null): ComunicazioneVista {
  const stato = r.stato === 'INVIATA' ? 'INVIATA' : 'GENERATA'
  return {
    id: r.id,
    consorzio: r.consorzio,
    unitaLocaleId: r.unitaLocaleId,
    periodoDa: giorno(r.periodoDa),
    periodoA: giorno(r.periodoA),
    tracciato: r.tracciato,
    versione: r.versione,
    stato,
    hashDati: r.hashDati,
    nomeFile: r.nomeFile,
    generataIl: r.generataIl.toISOString(),
    generataDa: r.generataDa ?? '',
    ...(r.inviataIl ? { inviataIl: r.inviataIl.toISOString() } : {}),
    ...(r.inviataDa ? { inviataDa: r.inviataDa } : {}),
    modificataDopoInvio: stato === 'INVIATA' && hashAttuale !== null && hashAttuale !== r.hashDati,
    affidabilita: 'UFFICIALE',
    notaAffidabilita: nota(modalitaDiVersione(r.versione)),
  }
}

@Injectable()
export class ComunicazioniOrsoService implements ComunicazioniOrsoPort {
  private readonly configurazione: ConfigurazioneComunicazioniPort
  private readonly anagrafica: AnagraficaComunicazioniPort

  constructor(
    private readonly prisma: PrismaService,
    @Optional()
    @Inject(CONFIGURAZIONE_COMUNICAZIONI_SERVICE)
    configurazione?: ConfigurazioneComunicazioniPort,
    @Optional()
    @Inject(ANAGRAFICA_COMUNICAZIONI_SERVICE)
    anagrafica?: AnagraficaComunicazioniPort
  ) {
    this.configurazione = configurazione ?? new ConfigurazioneComunicazioniService(prisma)
    this.anagrafica = anagrafica ?? new AnagraficaComunicazioniService(prisma)
  }

  /** Modalità della sede (configurazione D4): normale se non c'è una configurazione salvata. */
  private async modalitaDellaSede(tenantId: string, unitaLocaleId: string): Promise<ModalitaOrso> {
    const c = await this.configurazione.leggi(tenantId, unitaLocaleId, 'ORSO')
    return c.dati.modalita
  }

  private async calcola(
    tenantId: string,
    unitaLocaleId: string,
    anno: number,
    modalitaForzata?: ModalitaOrso,
    metodoPesi: MetodoPesi = METODO_PESI_CORRENTE
  ): Promise<Calcolo> {
    const unita = await this.prisma.rentriUnitaLocale.findFirst({
      where: { id: unitaLocaleId, tenantId },
      select: { id: true, denominazione: true, provincia: true, numIscrSito: true },
    })
    if (!unita) throw new ComunicazioneNonTrovataError()
    // Le comunicazioni già generate si ricalcolano nella loro modalità, non in quella di adesso:
    // passare da normale a dettagliata non le tocca.
    const modalita = modalitaForzata ?? (await this.modalitaDellaSede(tenantId, unitaLocaleId))

    const { inizio, fine } = limitiAnnoMud(anno)
    const [catalogo, report] = await Promise.all([
      caricaCatalogoCausali(this.prisma, tenantId),
      // `MUDReport` è unico per (azienda, anno). Col metodo storico basta quello dell'anno; col
      // metodo per anno servono anche i precedenti, da cui vengono le giacenze di apertura.
      this.prisma.mUDReport.findMany({
        where: { tenantId, year: metodoPesi === 'PESI_PER_ANNO' ? { lte: anno } : anno },
        select: { year: true, reportData: true },
      }),
    ])
    const pesiDi = (y: number) =>
      leggiIntegrazioni(report.find(r => r.year === y)?.reportData).pesiSpecifici
    // Un anno senza report non compare: per quei movimenti vale il ripiego sui pesi dell'anno.
    const pesiSpecificiPerAnno =
      metodoPesi === 'PESI_PER_ANNO'
        ? Object.fromEntries(report.map(r => [r.year, pesiDi(r.year)]))
        : undefined
    const lettura = await leggiMovimentiOrso(this.prisma, {
      tenantId,
      unitaLocaleId,
      da: inizio,
      a: fine,
      catalogo,
      pesiSpecifici: pesiDi(anno),
      ...(pesiSpecificiPerAnno ? { pesiSpecificiPerAnno } : {}),
      anno,
    })

    const provincia = (lettura.provinciaImpianto ?? '').trim() || null
    // Anno in corso: si dichiarano i mesi fino a quello corrente; gli anni passati per intero.
    const ultimoMese = ultimoMeseDichiarabile(anno)
    const giacenze = lettura.giacenze.filter(g => g.mese <= ultimoMese)
    const adattati = adattaMovimentiOrso(lettura.movimenti)

    let dati: ImpiantoMesiDati
    let mesi: AnteprimaMeseOrso[]
    let nuoviImpianti = 0
    let avvisiAggregatore: ReadonlyArray<{
      codice: CodiceAvvisoComunicazione
      movimentoIds: string[]
      dettaglio?: string
    }>
    if (modalita === 'DETTAGLIATA') {
      // Soggetti dal FIR di ogni movimento conteggiato (query fisse, un ISTAT per sede).
      const conteggiati = movimentiConteggiati(lettura.movimenti).filter(
        m => Number(giornoItaliano(m.movementDate).slice(5, 7)) <= ultimoMese
      )
      const dett = await leggiDettagliTracciato(this.prisma, {
        tenantId,
        movimenti: conteggiati,
        // Senza FIR il soggetto è la controparte scritta nel registro (f=0).
        controparti: conteggiati.flatMap(m => (!m.firId && m.controparte ? [m.controparte] : [])),
      })
      const ris = await risolviSoggettiOrso(
        conteggiati.map(m => ({
          id: m.id,
          tipo: m.tipo,
          firId: m.firId,
          controparte: m.controparte,
          indirizzoControparte: m.indirizzoControparte,
        })),
        dett,
        sedeId => this.anagrafica.risolviIstat(tenantId, sedeId)
      )
      const aggregato = aggregaOrsoDettagliata(
        adattati.map(m => ({ ...m, soggetto: ris.soggetti.get(m.id) ?? null })),
        { anno, provinciaImpianto: provincia ?? '', giacenze, ultimoMese }
      )
      dati = aggregatoDettagliatoInImpiantoMesi(aggregato, AUTORE, ultimoMese)
      mesi = anteprimaMesiDettagliata(aggregato)
      nuoviImpianti = aggregato.nuoviImpianti.length
      // Un movimento già spiegato da un errore sulla sede (ISTAT, codice fiscale) non si ripete
      // come «soggetto non identificato».
      const spiegati = new Set(ris.errori.flatMap(e => e.movimentoIds))
      avvisiAggregatore = [
        ...aggregato.avvisi
          .map(a => ({
            codice: a.codice as CodiceAvvisoComunicazione,
            movimentoIds:
              a.codice === 'SOGGETTO_NON_IDENTIFICATO'
                ? a.movimentoIds.filter(id => !spiegati.has(id))
                : a.movimentoIds,
          }))
          .filter(a => a.codice !== 'SOGGETTO_NON_IDENTIFICATO' || a.movimentoIds.length > 0),
        ...ris.errori.map(e => ({
          codice: e.codice,
          movimentoIds: e.movimentoIds,
          dettaglio: e.dettaglio,
        })),
      ]
    } else {
      const aggregato = aggregaOrso(adattati, {
        anno,
        provinciaImpianto: provincia ?? '',
        giacenze,
      })
      dati = aggregatoInImpiantoMesi(aggregato, AUTORE, ultimoMese)
      mesi = anteprimaMesi(aggregato)
      avvisiAggregatore = aggregato.avvisi.filter(
        a => provincia !== null || a.codice !== 'PROVINCIA_CONFERITORE_MANCANTE'
      )
    }

    const grezzi: Array<{
      codice: CodiceAvvisoComunicazione
      movimentoIds: string[]
      dettaglio?: string
    }> = [...avvisiAggregatore]
    // La provincia serve solo per distinguere i carichi extra-provinciali (modalità normale).
    if (modalita === 'NORMALE') {
      if (provincia === null) {
        grezzi.push({ codice: 'PROVINCIA_IMPIANTO_MANCANTE', movimentoIds: [] })
      }
      const daIndirizzo = movimentiConteggiati(lettura.movimenti).filter(
        m => m.provinciaDaIndirizzo
      )
      if (daIndirizzo.length > 0) {
        grezzi.push({ codice: 'PROVINCIA_DA_INDIRIZZO', movimentoIds: daIndirizzo.map(m => m.id) })
      }
    }
    const senzaDescrizione = movimentiSenzaDescrizione(lettura.movimenti)
    if (senzaDescrizione.length > 0) {
      grezzi.push({ codice: 'DESCRIZIONE_VUOTA', movimentoIds: senzaDescrizione.map(m => m.id) })
    }
    const bloccantiTracciato = this.tracciato(modalita).validaDati(dati)
    const dettagli = new Map(
      lettura.movimenti.map(m => [
        m.id,
        {
          id: m.id,
          data: giornoItaliano(m.movementDate),
          numero: m.numero,
          cer: m.cer,
        },
      ])
    )
    const avvisi = raggruppaAvvisi(grezzi, dettagli)
    // Errori del tracciato non già spiegati da un avviso: non si genera un file che l'XSD rifiuta.
    if (
      bloccantiTracciato.length > 0 &&
      !avvisi.some(a => eBloccante(a.codice as CodiceAvvisoComunicazione))
    ) {
      avvisi.unshift({
        codice: 'DATI_NON_VALIDI',
        messaggio: `${MESSAGGI.DATI_NON_VALIDI} ${bloccantiTracciato.slice(0, 5).join('; ')}`,
        movimentoIds: [],
      })
    }

    return {
      unita: {
        id: unita.id,
        nome: unita.denominazione,
        provincia,
        numIscrSito: unita.numIscrSito,
      },
      anno,
      modalita,
      letti: lettura.movimenti,
      dati,
      mesi,
      nuoviImpianti,
      avvisi,
      bloccanti: avvisi.some(a => eBloccante(a.codice as CodiceAvvisoComunicazione)),
      hashDati: hashDatiOrso(dati),
      metodoPesi,
    }
  }

  /**
   * Hash attuale dei dati con la modalità (dalla versione salvata) e il metodo pesi (dalla colonna)
   * con cui la comunicazione è stata generata (null se il calcolo non riesce). Riusa il calcolo già
   * fatto se coincidono entrambi.
   */
  private async hashPerMetodo(
    tenantId: string,
    unitaLocaleId: string,
    anno: number,
    metodoPesi: string,
    versione: string,
    gia?: Calcolo
  ): Promise<string | null> {
    const metodo: MetodoPesi =
      metodoPesi === 'PESI_PER_ANNO' ? 'PESI_PER_ANNO' : 'ANNO_COMUNICAZIONE'
    const modalita = modalitaDiVersione(versione)
    if (gia && gia.metodoPesi === metodo && gia.modalita === modalita) return gia.hashDati
    return this.calcola(tenantId, unitaLocaleId, anno, modalita, metodo).then(
      x => x.hashDati,
      () => null
    )
  }

  private tracciato(modalita: ModalitaOrso = 'NORMALE') {
    return registroTracciati.get<ImpiantoMesiDati>(
      CONSORZIO_ORSO,
      `${TRACCIATO}-${versioneDi(modalita)}`
    )
  }

  private periodo(anno: number) {
    return { periodoDa: new Date(Date.UTC(anno, 0, 1)), periodoA: new Date(Date.UTC(anno, 11, 31)) }
  }

  async anteprima(tenantId: string, unitaLocaleId: string, anno: number): Promise<AnteprimaOrso> {
    const p = { unitaLocaleId, anno }
    const c = await this.calcola(tenantId, p.unitaLocaleId, p.anno)
    const ultima = await this.prisma.comunicazioneConsorzio.findFirst({
      where: {
        tenantId,
        consorzio: CONSORZIO_ORSO,
        unitaLocaleId: p.unitaLocaleId,
        ...this.periodo(p.anno),
        // Solo la modalità di adesso: le comunicazioni dell'altra restano nello storico.
        versione: versioneDi(c.modalita),
      },
      orderBy: [{ generataIl: 'desc' }, { id: 'desc' }],
      select: SELEZIONE_VISTA,
    })
    const t = this.tracciato(c.modalita)
    return {
      modalita: c.modalita,
      ...(c.modalita === 'DETTAGLIATA' ? { nuoviImpianti: c.nuoviImpianti } : {}),
      affidabilita: t.affidabilita,
      notaAffidabilita: t.notaAffidabilita,
      unitaLocale: { id: c.unita.id, nome: c.unita.nome, provincia: c.unita.provincia },
      anno: c.anno,
      mesi: c.mesi,
      avvisi: c.avvisi,
      bloccanti: c.bloccanti,
      hashDati: c.hashDati,
      ...(ultima
        ? {
            ultima: vista(
              ultima,
              ultima.stato === 'INVIATA'
                ? await this.hashPerMetodo(
                    tenantId,
                    ultima.unitaLocaleId,
                    p.anno,
                    ultima.metodoPesi,
                    ultima.versione,
                    c
                  )
                : c.hashDati
            ),
          }
        : {}),
    }
  }

  /** Genera il file; idempotente: gli stessi dati restituiscono la comunicazione già generata. */
  async genera(
    tenantId: string,
    utenteId: string,
    unitaLocaleId: string,
    anno: number
  ): Promise<ComunicazioneVista> {
    const p = { unitaLocaleId, anno }
    const c = await this.calcola(tenantId, p.unitaLocaleId, p.anno)
    if (c.bloccanti) {
      throw new ComunicazioneConBloccantiError(
        c.avvisi.filter(a => eBloccante(a.codice as CodiceAvvisoComunicazione))
      )
    }
    const chiave = {
      tenantId,
      consorzio: CONSORZIO_ORSO,
      unitaLocaleId: p.unitaLocaleId,
      ...this.periodo(p.anno),
      tracciato: TRACCIATO,
      versione: versioneDi(c.modalita),
      hashDati: c.hashDati,
    }
    // Il metodo non fa parte della chiave: stessi dati, stessa comunicazione, qualunque metodo.
    const cerca = () =>
      this.prisma.comunicazioneConsorzio.findFirst({ where: chiave, select: SELEZIONE_VISTA })
    const esistente = await cerca()
    if (esistente) return vista(esistente, c.hashDati)

    const contenuto = this.tracciato(c.modalita).serializza(c.dati)
    const snapshot = movimentiConteggiati(c.letti).map(m => ({
      tenantId,
      movimentoId: m.id,
      registroId: m.registroId,
      movimentoTipo: m.tipo,
      quantitaKg: new Prisma.Decimal(m.kg ?? 0),
    }))
    const sede = c.unita.numIscrSito.replace(/[^A-Za-z0-9_-]/g, '_')
    try {
      const creata = await this.prisma.$transaction(async tx => {
        const riga = await tx.comunicazioneConsorzio.create({
          data: {
            ...chiave,
            nomeFile: `${CONSORZIO_ORSO}_${TRACCIATO}_${p.anno}_${sede}${c.modalita === 'DETTAGLIATA' ? '_dettagliata' : ''}.${this.tracciato(c.modalita).estensione}`,
            contenuto,
            stato: 'GENERATA',
            metodoPesi: c.metodoPesi,
            generataDa: utenteId,
          },
          select: SELEZIONE_VISTA,
        })
        await tx.comunicazioneConsorzioMovimento.createMany({
          data: snapshot.map(m => ({ ...m, comunicazioneId: riga.id })),
        })
        return riga
      })
      return vista(creata, c.hashDati)
    } catch (e) {
      // Due richieste uguali insieme: vince la prima, l'altra restituisce la sua riga.
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        const gia = await cerca()
        if (gia) return vista(gia, c.hashDati)
      }
      throw e
    }
  }

  async elenca(
    tenantId: string,
    f: { consorzio?: string; unitaLocaleId?: string; anno?: number } = {}
  ): Promise<ComunicazioneVista[]> {
    const righe = await this.prisma.comunicazioneConsorzio.findMany({
      where: {
        tenantId,
        consorzio: f.consorzio ?? CONSORZIO_ORSO,
        ...(f.unitaLocaleId ? { unitaLocaleId: f.unitaLocaleId } : {}),
        ...(f.anno !== undefined ? this.periodo(f.anno) : {}),
      },
      orderBy: [{ generataIl: 'desc' }, { id: 'desc' }],
      take: LIMITE_ELENCO,
      select: SELEZIONE_VISTA,
    })
    // L'hash attuale serve solo per le inviate e solo con sede e anno nel filtro: senza, il
    // ricalcolo di un anno intero per ogni sede-anno inviato sarebbe troppo oneroso.
    const calcolaHash = f.unitaLocaleId !== undefined && f.anno !== undefined
    // Una volta per sede e anno.
    const attuali = new Map<string, string | null>()
    const out: ComunicazioneVista[] = []
    for (const r of righe) {
      let hash: string | null = null
      if (r.stato === 'INVIATA' && calcolaHash) {
        const anno = r.periodoDa.getUTCFullYear()
        const k = `${r.unitaLocaleId}|${anno}|${r.versione}|${r.metodoPesi}`
        if (!attuali.has(k)) {
          attuali.set(
            k,
            await this.hashPerMetodo(tenantId, r.unitaLocaleId, anno, r.metodoPesi, r.versione)
          )
        }
        hash = attuali.get(k) ?? null
      }
      out.push(vista(r, hash))
    }
    return out
  }

  async file(tenantId: string, id: string): Promise<FileComunicazione> {
    const r = await this.prisma.comunicazioneConsorzio.findFirst({
      where: { id, tenantId },
      select: { nomeFile: true, contenuto: true, consorzio: true, tracciato: true, versione: true },
    })
    if (!r) throw new ComunicazioneNonTrovataError()
    return {
      nomeFile: r.nomeFile,
      xml: r.contenuto,
    }
  }

  /** Segna la comunicazione come inviata. Ripetuta non cambia chi e quando l'ha segnata. */
  async segnaInviata(tenantId: string, utenteId: string, id: string): Promise<ComunicazioneVista> {
    const r = await this.prisma.comunicazioneConsorzio.findFirst({
      where: { id, tenantId },
      select: SELEZIONE_VISTA,
    })
    if (!r) throw new ComunicazioneNonTrovataError()
    // Atomica: solo la richiesta che trova la comunicazione ancora GENERATA la segna; le altre
    // non cambiano chi e quando l'ha segnata.
    await this.prisma.comunicazioneConsorzio.updateMany({
      where: { id, tenantId, stato: 'GENERATA' },
      data: { stato: 'INVIATA', inviataIl: new Date(), inviataDa: utenteId },
    })
    const corrente = await this.prisma.comunicazioneConsorzio.findFirst({
      where: { id, tenantId },
      select: SELEZIONE_VISTA,
    })
    if (!corrente) throw new ComunicazioneNonTrovataError()
    const hash = await this.hashPerMetodo(
      tenantId,
      r.unitaLocaleId,
      r.periodoDa.getUTCFullYear(),
      r.metodoPesi,
      r.versione
    )
    return vista(corrente, hash)
  }
}
