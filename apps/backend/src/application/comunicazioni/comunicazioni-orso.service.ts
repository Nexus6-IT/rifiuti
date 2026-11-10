import { createHash } from 'node:crypto'
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common'
import { Prisma } from '@prisma/client'
import { PrismaService } from '../../infrastructure/persistence/prisma.service'
import { aggregaOrso } from '../../domain/comunicazioni/orso/aggrega-orso'
import {
  adattaMovimentiOrso,
  aggregatoInImpiantoMesi,
  movimentiConteggiati,
  movimentiSenzaDescrizione,
} from '../../domain/comunicazioni/orso/adatta-orso'
import type { AggregatoOrso, CodiceAvvisoOrso } from '../../domain/comunicazioni/orso/aggregato'
import type { ImpiantoMesiDati } from '../../domain/comunicazioni/orso/impianto-mesi'
import { registroTracciati } from '../../domain/comunicazioni/registro-tracciati'
import { caricaCatalogoCausali } from '../registro/causali/catalogo-causali.repository'
import { limitiAnnoMud } from '../mud/aggregazione/mud-regole'
import { leggiIntegrazioni } from '../mud/aggregazione/mud-integrazioni'
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
const AUTORE = 'WasteFlow'

export type CodiceAvvisoComunicazione =
  | CodiceAvvisoOrso
  | 'PROVINCIA_IMPIANTO_MANCANTE'
  | 'DESCRIZIONE_VUOTA'
  | 'DATI_NON_VALIDI'

export interface AvvisoComunicazione {
  codice: CodiceAvvisoComunicazione
  messaggio: string
  movimentoIds: string[]
}

export interface AnteprimaMeseOrso {
  mese: number
  ricevuti: Array<{
    cer: string
    descrizione: string
    operazioni: string[]
    totT: string
    extraT: string
    conFir: boolean
  }>
  prodotti: Array<{
    cer: string
    descrizione: string
    operazioni: string[]
    totT: string
    trattataInternamenteT: string
  }>
}

export interface ComunicazioneVista {
  id: string
  consorzio: string
  unitaLocaleId: string
  /** data `YYYY-MM-DD` */
  periodoDa: string
  periodoA: string
  tracciato: string
  versione: string
  stato: 'GENERATA' | 'INVIATA'
  hashDati: string
  nomeFile: string
  generataIl: string
  generataDa: string | null
  inviataIl?: string
  inviataDa?: string
  modificataDopoInvio: boolean
}

export interface AnteprimaOrso {
  unitaLocale: { id: string; nome: string; provincia: string | null }
  anno: number
  mesi: AnteprimaMeseOrso[]
  avvisi: AvvisoComunicazione[]
  bloccanti: boolean
  hashDati: string
  ultima?: ComunicazioneVista
}

export interface FileComunicazione {
  nomeFile: string
  contentType: string
  contenuto: string
}

const MESSAGGI: Record<CodiceAvvisoComunicazione, string> = {
  PROVINCIA_CONFERITORE_MANCANTE:
    'Provincia del conferitore non ricavabile dal FIR: il carico non si può classificare come regionale o extra-regionale.',
  QUANTITA_NON_CONVERTIBILE:
    'Quantità in un’unità non convertibile in kg (manca il peso specifico): il movimento non può entrare nel file.',
  OPERAZIONE_MANCANTE: 'Operazione di recupero o smaltimento non indicata sul movimento.',
  TRATTATO_INTERNAMENTE_DEFAULT:
    'Per i rifiuti prodotti la quantità trattata internamente è impostata a 0: il registro non la distingue.',
  PROVINCIA_IMPIANTO_MANCANTE:
    'La sede non ha la provincia: serve per distinguere i carichi regionali da quelli extra-regionali.',
  DESCRIZIONE_VUOTA:
    'Movimento senza descrizione del rifiuto: il tracciato richiede da 1 a 100 caratteri.',
  DATI_NON_VALIDI: 'I dati non rispettano il tracciato O.R.SO.',
}

const BLOCCANTI = new Set<CodiceAvvisoComunicazione>([
  'PROVINCIA_CONFERITORE_MANCANTE',
  'QUANTITA_NON_CONVERTIBILE',
  'PROVINCIA_IMPIANTO_MANCANTE',
  'DESCRIZIONE_VUOTA',
  'DATI_NON_VALIDI',
])

export function eBloccante(codice: CodiceAvvisoComunicazione): boolean {
  return BLOCCANTI.has(codice)
}

/** Hash dei dati che finiscono nel file: stessi dati, stesso hash (l'aggregatore ordina tutto). */
export function hashDatiOrso(dati: ImpiantoMesiDati): string {
  return createHash('sha256').update(JSON.stringify(dati)).digest('hex')
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
        trattataInternamenteT: p.trattatoInternamente,
      })),
    }
  })
}

/** Avvisi raggruppati per codice (uno per tipo, con tutti i movimenti coinvolti). */
export function raggruppaAvvisi(
  grezzi: ReadonlyArray<{ codice: CodiceAvvisoComunicazione; movimentoIds: string[] }>
): AvvisoComunicazione[] {
  const perCodice = new Map<CodiceAvvisoComunicazione, Set<string>>()
  for (const a of grezzi) {
    const ids = perCodice.get(a.codice) ?? new Set<string>()
    a.movimentoIds.forEach(id => ids.add(id))
    perCodice.set(a.codice, ids)
  }
  return [...perCodice.entries()]
    .map(([codice, ids]) => ({
      codice,
      messaggio: MESSAGGI[codice],
      movimentoIds: [...ids].sort(),
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
  letti: MovimentoLettoDb[]
  dati: ImpiantoMesiDati
  aggregato: AggregatoOrso
  avvisi: AvvisoComunicazione[]
  bloccanti: boolean
  hashDati: string
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
  nomeFile: true,
  generataIl: true,
  generataDa: true,
  inviataIl: true,
  inviataDa: true,
} as const

const giorno = (d: Date) => d.toISOString().slice(0, 10)

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
    generataDa: r.generataDa,
    ...(r.inviataIl ? { inviataIl: r.inviataIl.toISOString() } : {}),
    ...(r.inviataDa ? { inviataDa: r.inviataDa } : {}),
    modificataDopoInvio: stato === 'INVIATA' && hashAttuale !== null && hashAttuale !== r.hashDati,
  }
}

@Injectable()
export class ComunicazioniOrsoService {
  constructor(private readonly prisma: PrismaService) {}

  private async calcola(tenantId: string, unitaLocaleId: string, anno: number): Promise<Calcolo> {
    const unita = await this.prisma.rentriUnitaLocale.findFirst({
      where: { id: unitaLocaleId, tenantId },
      select: { id: true, denominazione: true, provincia: true, numIscrSito: true },
    })
    if (!unita) throw new NotFoundException('Sede non trovata')

    const { inizio, fine } = limitiAnnoMud(anno)
    const [catalogo, record] = await Promise.all([
      caricaCatalogoCausali(this.prisma, tenantId),
      this.prisma.mUDReport.findUnique({
        where: { tenantId_year: { tenantId, year: anno } },
        select: { reportData: true },
      }),
    ])
    const lettura = await leggiMovimentiOrso(this.prisma, {
      tenantId,
      unitaLocaleId,
      da: inizio,
      a: fine,
      catalogo,
      pesiSpecifici: leggiIntegrazioni(record?.reportData).pesiSpecifici,
    })

    const provincia = (lettura.provinciaImpianto ?? '').trim() || null
    const aggregato = aggregaOrso(adattaMovimentiOrso(lettura.movimenti), {
      anno,
      provinciaImpianto: provincia ?? '',
    })
    const dati = aggregatoInImpiantoMesi(aggregato, AUTORE)

    const grezzi: Array<{ codice: CodiceAvvisoComunicazione; movimentoIds: string[] }> =
      aggregato.avvisi.filter(
        a => provincia !== null || a.codice !== 'PROVINCIA_CONFERITORE_MANCANTE'
      )
    if (provincia === null) grezzi.push({ codice: 'PROVINCIA_IMPIANTO_MANCANTE', movimentoIds: [] })
    const senzaDescrizione = movimentiSenzaDescrizione(lettura.movimenti)
    if (senzaDescrizione.length > 0) {
      grezzi.push({ codice: 'DESCRIZIONE_VUOTA', movimentoIds: senzaDescrizione.map(m => m.id) })
    }
    const bloccantiTracciato = this.tracciato().validaDati(dati)
    const avvisi = raggruppaAvvisi(grezzi)
    // Errori del tracciato non già spiegati da un avviso: non si genera un file che l'XSD rifiuta.
    if (bloccantiTracciato.length > 0 && !avvisi.some(a => eBloccante(a.codice))) {
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
      letti: lettura.movimenti,
      dati,
      aggregato,
      avvisi,
      bloccanti: avvisi.some(a => eBloccante(a.codice)),
      hashDati: hashDatiOrso(dati),
    }
  }

  private tracciato() {
    return registroTracciati.get<ImpiantoMesiDati>(CONSORZIO_ORSO, `${TRACCIATO}-${VERSIONE}`)
  }

  private periodo(anno: number) {
    return { periodoDa: new Date(Date.UTC(anno, 0, 1)), periodoA: new Date(Date.UTC(anno, 11, 31)) }
  }

  async anteprima(
    tenantId: string,
    p: { unitaLocaleId: string; anno: number }
  ): Promise<AnteprimaOrso> {
    const c = await this.calcola(tenantId, p.unitaLocaleId, p.anno)
    const ultima = await this.prisma.comunicazioneConsorzio.findFirst({
      where: {
        tenantId,
        consorzio: CONSORZIO_ORSO,
        unitaLocaleId: p.unitaLocaleId,
        ...this.periodo(p.anno),
      },
      orderBy: [{ generataIl: 'desc' }, { id: 'desc' }],
      select: SELEZIONE_VISTA,
    })
    return {
      unitaLocale: { id: c.unita.id, nome: c.unita.nome, provincia: c.unita.provincia },
      anno: c.anno,
      mesi: anteprimaMesi(c.aggregato),
      avvisi: c.avvisi,
      bloccanti: c.bloccanti,
      hashDati: c.hashDati,
      ...(ultima ? { ultima: vista(ultima, c.hashDati) } : {}),
    }
  }

  /** Genera il file; idempotente: gli stessi dati restituiscono la comunicazione già generata. */
  async genera(
    tenantId: string,
    utenteId: string,
    p: { unitaLocaleId: string; anno: number }
  ): Promise<ComunicazioneVista> {
    const c = await this.calcola(tenantId, p.unitaLocaleId, p.anno)
    if (c.bloccanti) {
      throw new BadRequestException({
        code: 'COMUNICAZIONE_CON_BLOCCANTI',
        message: 'Ci sono avvisi bloccanti: correggi i dati prima di generare il file.',
        avvisi: c.avvisi.filter(a => eBloccante(a.codice)),
      })
    }
    const chiave = {
      tenantId,
      consorzio: CONSORZIO_ORSO,
      unitaLocaleId: p.unitaLocaleId,
      ...this.periodo(p.anno),
      tracciato: TRACCIATO,
      versione: VERSIONE,
      hashDati: c.hashDati,
    }
    const cerca = () =>
      this.prisma.comunicazioneConsorzio.findFirst({ where: chiave, select: SELEZIONE_VISTA })
    const esistente = await cerca()
    if (esistente) return vista(esistente, c.hashDati)

    const contenuto = this.tracciato().serializza(c.dati)
    const snapshot = movimentiConteggiati(c.letti).map(m => ({
      tenantId,
      movimentoId: m.id,
      registroId: m.registroId,
      movimentoTipo: m.tipo,
      quantitaKg: new Prisma.Decimal(m.kg ?? 0),
    }))
    const sede = c.unita.numIscrSito.replace(/[^A-Za-z0-9_-]/g, '_')
    try {
      const creata = await this.prisma.comunicazioneConsorzio.create({
        data: {
          ...chiave,
          nomeFile: `${CONSORZIO_ORSO}_${TRACCIATO}_${p.anno}_${sede}.${this.tracciato().estensione}`,
          contenuto,
          stato: 'GENERATA',
          generataDa: utenteId,
          movimenti: { createMany: { data: snapshot } },
        },
        select: SELEZIONE_VISTA,
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
    f: { unitaLocaleId?: string; anno?: number } = {}
  ): Promise<ComunicazioneVista[]> {
    const righe = await this.prisma.comunicazioneConsorzio.findMany({
      where: {
        tenantId,
        consorzio: CONSORZIO_ORSO,
        ...(f.unitaLocaleId ? { unitaLocaleId: f.unitaLocaleId } : {}),
        ...(f.anno !== undefined ? this.periodo(f.anno) : {}),
      },
      orderBy: [{ generataIl: 'desc' }, { id: 'desc' }],
      select: SELEZIONE_VISTA,
    })
    // L'hash attuale serve solo per le inviate, una volta per sede e anno.
    const attuali = new Map<string, string | null>()
    const out: ComunicazioneVista[] = []
    for (const r of righe) {
      let hash: string | null = null
      if (r.stato === 'INVIATA') {
        const anno = r.periodoDa.getUTCFullYear()
        const k = `${r.unitaLocaleId}|${anno}`
        if (!attuali.has(k)) {
          attuali.set(
            k,
            await this.calcola(tenantId, r.unitaLocaleId, anno).then(
              x => x.hashDati,
              () => null
            )
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
    if (!r) throw new NotFoundException('Comunicazione non trovata')
    return {
      nomeFile: r.nomeFile,
      contentType: registroTracciati.get(r.consorzio, `${r.tracciato}-${r.versione}`).contentType,
      contenuto: r.contenuto,
    }
  }

  /** Segna la comunicazione come inviata. Ripetuta non cambia chi e quando l'ha segnata. */
  async segnaInviata(tenantId: string, utenteId: string, id: string): Promise<ComunicazioneVista> {
    const r = await this.prisma.comunicazioneConsorzio.findFirst({
      where: { id, tenantId },
      select: SELEZIONE_VISTA,
    })
    if (!r) throw new NotFoundException('Comunicazione non trovata')
    let corrente = r
    if (r.stato !== 'INVIATA') {
      corrente = await this.prisma.comunicazioneConsorzio.update({
        where: { id: r.id },
        data: { stato: 'INVIATA', inviataIl: new Date(), inviataDa: utenteId },
        select: SELEZIONE_VISTA,
      })
    }
    const hash = await this.calcola(tenantId, r.unitaLocaleId, r.periodoDa.getUTCFullYear()).then(
      x => x.hashDati,
      () => null
    )
    return vista(corrente, hash)
  }
}
