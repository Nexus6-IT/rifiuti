import { Injectable } from '@nestjs/common'
import { giornoItaliano } from '../../core/time/anno-italiano'
import { validaDatiTracciato, type DatiCobat } from '../../domain/comunicazioni/dati-tracciato'
import type { ConfigurazioneCobat } from '../../domain/comunicazioni/configurazione-sede'
import { NOME_FILE_COBAT, VERSIONE_COBAT } from '../../domain/comunicazioni/cobat/costanti'
import {
  causaCobat,
  quantitaCobat,
  soggettoCodazi,
  tipoMovimentoCobat,
  type ParteCobat,
} from '../../domain/comunicazioni/cobat/derivazioni'
import {
  assegnaProgressiviCobat,
  progressivoCobat,
} from '../../domain/comunicazioni/cobat/progressivo'
import type {
  BloccoSedeLegaleCobat,
  BloccoUnitaLocaleCobat,
  DatiFileCobat,
  RecordCobat,
} from '../../domain/comunicazioni/cobat/record-cobat'
import { erroriRecordCobat } from '../../domain/comunicazioni/cobat/serializza-cobat'
import { PrismaService } from '../../infrastructure/persistence/prisma.service'
import type {
  ContestoPreparazione,
  PreparatoreTracciato,
  PreparazioneTracciato,
  RichiestaComunicazione,
} from './comunicazioni-tracciato.port'
import type { FirDettaglio, SedeDettaglio } from './lettore-dettagli-tracciato'
import type { MovimentoOrso } from './lettore-movimenti-orso'
import {
  CatalogoIstat,
  aggregaSegnalazioni,
  eNoi,
  ordinaMovimenti,
  progressivoDaNumero,
  sedeLegaleDi,
  soloCifre,
  targaCompatta,
  type SegnalazioneMovimento,
} from './tracciato-comune'

const DIFFERENZE = [
  'Blocco trasportatore: cognome e nome del legale rappresentante invece della descrizione e dell’ISTAT dell’unita` locale (difetto di WinWaste in ComuCou:2388-2389, non replicato).',
  'Progressivo (progdta): numero progressivo del movimento nel registro, non la formula `base + movimenti.cod` di WinWaste (definita solo fino al 2025 e non unica oltre 100 000 movimenti).',
  'codazi: precedenza esplicita destinatario > trasportatore > produttore (in WinWaste «vince l’ultimo» per ordine di valutazione, stesso risultato salvo un soggetto successivo senza codice fiscale ma con partita IVA: li la partita IVA vince su un codice fiscale precedente, in WinWaste no).',
  'Un carattere non rappresentabile in Windows-1252 e` un errore bloccante con movimento e campo (WinWaste non controlla).',
  'Nessun file se un solo movimento ha un errore bloccante, come in WinWaste.',
]

const INFERENZE = [
  'CODIFICA_COBAT = windows-1252; CRLF solo nella coda; nessun separatore fra record.',
  'NOME_FILE_COBAT = Movcob.txt.',
  'Coda per record: 185 spazi + campagna (2) + descrizione (30) + CRLF (anni > 2009).',
  'progressivoCobat(): numero progressivo del movimento nel registro (1..n nell’ordine del file se piu` registri o anni).',
  'tipmov e causa tradotti dalle OPER di WinWaste in ruoli del registro (movimenti.md §2.4); trattamento interno (5) e trasporto conto terzi (1) solo per forzatura.',
  'Lettere di regione (REGIONE_LETTERA) dalla tabella PROVINCE.REG di WinWaste.',
  'quam3/quaton: 7 decimali, punto decimale, giustificati a destra su 14.',
  'Blocco della sede legale dell’azienda: indirizzo dell’unita` locale (la sede legale non e` registrata).',
  'Campagna: dai dati del movimento o predefinita della sede (00 senza descrizione).',
  'Targa del rimorchio, autista e intermediario: non esistono nel registro, scritti come spazi.',
]

type Parte =
  | { tipo: 'NOI' }
  | { tipo: 'SEDE'; sede: SedeDettaglio; cf: string; piva: string }
  | { tipo: 'NON_RISOLTA' }

/**
 * Preparatore COBAT (4.9d, B5). Un record (1409 + coda 219) per movimento marcato COBAT in cui
 * almeno una parte e` un soggetto esterno. Ogni errore del tracciato diventa un avviso BLOCCANTE per
 * movimento con il punto di correzione (D14).
 */
@Injectable()
export class PreparatoreCobat implements PreparatoreTracciato<DatiFileCobat, ConfigurazioneCobat> {
  readonly consorzio = 'COBAT'
  readonly versione = VERSIONE_COBAT
  readonly selezione = { tipo: 'MARCATI', consorzio: 'COBAT' } as const
  readonly configurazione = 'COBAT' as const
  readonly datiTracciato = 'COBAT' as const
  readonly differenzeDaWinWaste = DIFFERENZE
  readonly inferenze = INFERENZE

  constructor(private readonly prisma: PrismaService) {}

  nomeTracciato(): string {
    return 'Movcob'
  }

  /** Il periodo COBAT e` libero entro un anno. */
  validaRichiesta(r: RichiestaComunicazione): string[] {
    const giorni = (Date.parse(`${r.a}T00:00:00Z`) - Date.parse(`${r.da}T00:00:00Z`)) / 86_400_000
    return giorni > 365 ? ['Il periodo COBAT non puo` superare un anno.'] : []
  }

  nomeFile(): string {
    return NOME_FILE_COBAT
  }

  contaRecord(dati: DatiFileCobat): number {
    return dati.record.length
  }

  async prepara(
    ctx: ContestoPreparazione<ConfigurazioneCobat>
  ): Promise<PreparazioneTracciato<DatiFileCobat>> {
    const segn: SegnalazioneMovimento[] = []
    const movimenti = ordinaMovimenti(ctx.movimenti)
    const { azienda, unita, dettagli } = ctx
    const config = ctx.configurazione

    const sedi = [...dettagli.sedi.values()]
    const istat = await CatalogoIstat.carica(this.prisma, [
      ...sedi.map(s => ({
        comune: s.comune,
        provincia: s.provincia,
        codiceIstatForzato: s.anagrafica?.codiceIstatComune ?? null,
      })),
      { comune: unita.comune ?? '', provincia: unita.provincia ?? '' },
    ])

    // ---- parti di ogni movimento ----
    const parteDaSede = (
      sedeId: string | null | undefined,
      cf: string | null | undefined,
      piva: string | null | undefined
    ): Parte => {
      if (eNoi(azienda, cf, piva)) return { tipo: 'NOI' }
      const sede = sedeId ? dettagli.sedi.get(sedeId) : undefined
      return sede
        ? {
            tipo: 'SEDE',
            sede,
            cf: (cf?.trim() || sede.ditta.codiceFiscale || '').trim(),
            piva: (sede.ditta.partitaIva ?? piva ?? '').trim(),
          }
        : { tipo: 'NON_RISOLTA' }
    }
    const produttoreDi = (m: MovimentoOrso, fir?: FirDettaglio): Parte =>
      fir
        ? parteDaSede(fir.producerSedeId, fir.producerCodiceFiscale, fir.producerPartitaIva)
        : m.tipo === 'SCARICO' || m.ruolo === 'PRODOTTO'
          ? { tipo: 'NOI' }
          : { tipo: 'NON_RISOLTA' }
    const destinatarioDi = (m: MovimentoOrso, fir?: FirDettaglio): Parte =>
      fir
        ? parteDaSede(fir.receiverSedeId, fir.receiverCodiceFiscale, fir.receiverPartitaIva)
        : m.tipo === 'CARICO'
          ? { tipo: 'NOI' }
          : { tipo: 'NON_RISOLTA' }
    const trasportatoreDi = (fir?: FirDettaglio): Parte | null => {
      if (!fir) return null
      const cf = fir.carrierCodiceFiscale ?? fir.trasportatore1?.codiceFiscale
      const piva = fir.carrierPartitaIva || fir.trasportatore1?.partitaIva
      if (!cf?.trim() && !piva?.trim() && !fir.carrierName.trim()) return null
      if (eNoi(azienda, cf, piva)) return { tipo: 'NOI' }
      const t = fir.carrierId ? dettagli.trasportatori.get(fir.carrierId) : undefined
      const sedeId =
        t?.sedeId ?? (t?.dittaId ? dettagli.sedeLegalePerDitta.get(t.dittaId)?.id : null)
      return parteDaSede(sedeId, cf, piva)
    }

    interface Voce {
      m: MovimentoOrso
      fir?: FirDettaglio
      produttore: Parte
      destinatario: Parte
      trasportatore: Parte | null
      dati: DatiCobat
    }
    const voci: Voce[] = []
    for (const m of movimenti) {
      const fir = m.firId ? dettagli.fir.get(m.firId) : undefined
      const produttore = produttoreDi(m, fir)
      const destinatario = destinatarioDi(m, fir)
      const trasportatore = trasportatoreDi(fir)
      // Tutte le parti siamo noi: non e` un movimento per il COBAT (filtro di WinWaste).
      const parti = [produttore, destinatario, ...(trasportatore ? [trasportatore] : [])]
      if (parti.every(p => p.tipo === 'NOI')) {
        segn.push({
          codice: 'MOVIMENTO_INTERNO_ESCLUSO',
          messaggio:
            'Movimento escluso dal file: tutte le parti (produttore, trasportatore, destinatario) sono l’azienda stessa.',
          bloccante: false,
          movimento: m,
        })
        continue
      }
      let dati: DatiCobat = {}
      const grezzo = dettagli.datiTracciato.get(m.radiceId)
      if (grezzo !== undefined && grezzo !== null) {
        const esito = validaDatiTracciato('COBAT', grezzo)
        if (esito.ok) dati = esito.valore
        else {
          segn.push({
            codice: 'DATI_TRACCIATO_NON_VALIDI',
            messaggio: `I dati COBAT del movimento non sono validi: ${esito.errori.join('; ')}.`,
            bloccante: true,
            movimento: m,
            correzione: { tipo: 'MOVIMENTO' },
          })
        }
      }
      voci.push({ m, fir, produttore, destinatario, trasportatore, dati })
    }

    // ---- progressivi (D9) ----
    const numeri = voci.map(v => ({ v, ...progressivoDaNumero(v.m.numero) }))
    let progressivi: string[]
    try {
      progressivi = assegnaProgressiviCobat(
        numeri.map(x => ({ registroId: x.v.m.registroId, progressivoRegistro: x.n, anno: x.anno }))
      )
    } catch {
      progressivi = numeri.map(() => '000000')
      for (const x of numeri) {
        try {
          progressivoCobat(x.n, x.anno)
        } catch (e) {
          segn.push({
            codice: 'PROGRESSIVO_NON_VALIDO',
            messaggio: (e as Error).message,
            bloccante: true,
            movimento: x.v.m,
          })
        }
      }
    }

    // ---- blocchi anagrafici ----
    const bloccoNoiLegale = (): BloccoSedeLegaleCobat | null => {
      const r = istat.risolvi({ comune: unita.comune ?? '', provincia: unita.provincia ?? '' })
      return r
        ? {
            descrizione: azienda.ragioneSociale,
            codreg: r.regioneLettera,
            via: unita.indirizzo ?? '',
            cap: unita.cap ?? '',
            codcom: r.istat6,
            localita: unita.comune ?? '',
            telefono: '',
            fax: '',
            codiceFiscale: (azienda.codiceFiscale ?? azienda.partitaIva).trim(),
            civico: unita.civico ?? '',
            legaleRappresentanteCognome: azienda.legaleRappresentanteCognome ?? '',
            legaleRappresentanteNome: azienda.legaleRappresentanteNome ?? '',
            comune: 'N',
            partitaIva: azienda.partitaIva,
          }
        : null
    }
    const bloccoNoiUnita = (): BloccoUnitaLocaleCobat | null => {
      const r = istat.risolvi({ comune: unita.comune ?? '', provincia: unita.provincia ?? '' })
      return r
        ? {
            codreg: r.regioneLettera,
            via: unita.indirizzo ?? '',
            cap: unita.cap ?? '',
            codcom: r.istat6,
            localita: unita.comune ?? '',
            telefono: '',
            fax: '',
            codiceAttivita: soloCifre(azienda.atecoCode).slice(0, 6),
            civico: unita.civico ?? '',
          }
        : null
    }
    const bloccoSedeLegale = (
      p: Extract<Parte, { tipo: 'SEDE' }>
    ): BloccoSedeLegaleCobat | null => {
      const legale = sedeLegaleDi(p.sede, dettagli.sedeLegalePerDitta)
      const r = istat.risolvi({
        comune: legale.comune,
        provincia: legale.provincia,
        codiceIstatForzato: legale.anagrafica?.codiceIstatComune ?? null,
      })
      return r
        ? {
            descrizione: legale.ditta.ragioneSociale,
            codreg: r.regioneLettera,
            via: legale.via,
            cap: legale.cap,
            codcom: r.istat6,
            localita: legale.comune,
            telefono: legale.telefono ?? '',
            fax: '',
            codiceFiscale: p.cf || legale.ditta.partitaIva || '',
            civico: legale.civico,
            legaleRappresentanteCognome: legale.anagrafica?.legaleRappresentanteCognome ?? '',
            legaleRappresentanteNome: legale.anagrafica?.legaleRappresentanteNome ?? '',
            comune: legale.anagrafica?.eComune || p.sede.anagrafica?.eComune ? 'S' : 'N',
            partitaIva: p.piva,
          }
        : null
    }
    const bloccoSedeUnita = (
      p: Extract<Parte, { tipo: 'SEDE' }>
    ): BloccoUnitaLocaleCobat | null => {
      const s = p.sede
      const r = istat.risolvi({
        comune: s.comune,
        provincia: s.provincia,
        codiceIstatForzato: s.anagrafica?.codiceIstatComune ?? null,
      })
      return r
        ? {
            codreg: r.regioneLettera,
            via: s.via,
            cap: s.cap,
            codcom: r.istat6,
            localita: s.comune,
            telefono: s.telefono ?? '',
            fax: '',
            codiceAttivita: soloCifre(s.anagrafica?.codiceAteco).slice(0, 6),
            civico: s.civico,
          }
        : null
    }

    const record: RecordCobat[] = []
    const inFile: MovimentoOrso[] = []
    voci.forEach((v, i) => {
      const { m, fir, dati } = v
      const nuove: SegnalazioneMovimento[] = []
      const bloc = (
        codice: string,
        messaggio: string,
        correzione: SegnalazioneMovimento['correzione'] = { tipo: 'MOVIMENTO' }
      ) => nuove.push({ codice, messaggio, bloccante: true, movimento: m, correzione })
      const info = (codice: string, messaggio: string) =>
        nuove.push({ codice, messaggio, bloccante: false, movimento: m })

      const blocchi = (
        p: Parte,
        etichetta: string,
        conUnita: boolean
      ): {
        sedeLegale: BloccoSedeLegaleCobat
        unitaLocale: BloccoUnitaLocaleCobat
      } | null => {
        if (p.tipo === 'NON_RISOLTA') {
          bloc(
            'SOGGETTO_NON_IDENTIFICATO',
            `${etichetta} non identificato: servono il FIR e la sede del soggetto in anagrafica.`
          )
          return null
        }
        const sl = p.tipo === 'NOI' ? bloccoNoiLegale() : bloccoSedeLegale(p)
        const ul = !conUnita
          ? ({} as BloccoUnitaLocaleCobat)
          : p.tipo === 'NOI'
            ? bloccoNoiUnita()
            : bloccoSedeUnita(p)
        if (!sl || !ul) {
          bloc(
            'ISTAT_NON_TROVATO',
            `Codice ISTAT del comune o regione non trovati per ${etichetta}.`,
            p.tipo === 'SEDE'
              ? { tipo: 'ANAGRAFICA_SEDE', sedeDittaId: p.sede.id }
              : { tipo: 'CONFIGURAZIONE_SEDE' }
          )
          return null
        }
        if (p.tipo === 'SEDE' && conUnita && ul.codiceAttivita === '') {
          info(
            'CODICE_ATTIVITA_ASSENTE',
            'Codice attivita` (ATECO) della sede della controparte non indicato.'
          )
        }
        return { sedeLegale: sl, unitaLocale: ul }
      }

      const bProduttore = blocchi(v.produttore, 'il produttore', true)
      const bSmaltitore = blocchi(v.destinatario, 'il destinatario', true)
      const bTrasportatore = v.trasportatore
        ? blocchi(v.trasportatore, 'il trasportatore', false)
        : null

      const esterno = (p: Parte | null): boolean => p !== null && p.tipo === 'SEDE'
      const ptc = (p: Parte | null): ParteCobat => ({
        codiceFiscale: p?.tipo === 'SEDE' ? p.cf : null,
        partitaIva: p?.tipo === 'SEDE' ? p.piva : null,
        esterno: esterno(p),
      })
      const codazi = soggettoCodazi({
        produttore: ptc(v.produttore),
        trasportatore: ptc(v.trasportatore),
        destinatario: ptc(v.destinatario),
      })
      if (!codazi) {
        bloc(
          'CODAZI_MANCANTE',
          'Nessun soggetto esterno con codice fiscale o partita IVA (codazi).'
        )
      }

      const tipoMovimento = tipoMovimentoCobat({
        verso: m.tipo,
        ruolo: m.ruolo,
        trasportatoreEsterno: esterno(v.trasportatore),
        forzatura: dati.tipoMovimento,
      })
      if (tipoMovimento === null) {
        bloc(
          'TIPO_MOVIMENTO_NON_DETERMINABILE',
          'Tipo di movimento COBAT non determinabile dal ruolo del movimento: indicarlo sul movimento.'
        )
      }
      const causa = causaCobat({
        verso: m.tipo,
        ruolo: m.ruolo,
        operationCode: m.operationCode,
        operazione: m.operazione,
        forzatura: dati.causa,
      })
      if (causa === null) {
        info(
          'CAUSA_NON_DETERMINATA',
          'Causale COBAT non determinabile dall’operazione: scritta come spazio.'
        )
      }
      const q = quantitaCobat(m.kg, m.quantita, m.unita)
      if (q === null)
        bloc('QUANTITA_NON_VALIDA', 'Peso non disponibile (unita` non convertibile in kg).')

      const cer = soloCifre(m.cer)
      const pgf: string = dati.pgf ?? config.pgfPerCer[cer] ?? ''
      if (pgf === '')
        info('PGF_NON_INDICATO', 'PGF/tipologia non indicato (A-E): campo lasciato vuoto.')
      const campagna = dati.campagna ?? config.campagnaPredefinita
      info(
        'CAMPI_NON_DISPONIBILI',
        'Targa del rimorchio, autista e intermediario non esistono nel registro: scritti come spazi.'
      )

      const rec: RecordCobat = {
        riferimento: m.numero,
        movimentoId: m.id,
        dataRegistrazione: giornoItaliano(m.movementDate),
        progressivo: progressivi[i],
        codazi: codazi?.codice ?? '',
        tipoMovimento,
        targa: targaCompatta(fir?.carrierVehiclePlate ?? fir?.trasportatore1?.mezzo),
        rimorchio: '',
        bolla: fir?.firNumero ?? m.firNumero ?? '',
        dataFormulario: fir ? giornoItaliano(fir.transportDate) : '',
        causa,
        autista: '',
        dataConferimento: fir?.actualArrivalDate
          ? giornoItaliano(fir.actualArrivalDate)
          : giornoItaliano(m.movementDate),
        cer,
        pgf,
        quam3: q?.quam3 ?? 0,
        quaton: q?.quaton ?? 0,
        produttore: bProduttore,
        trasportatore: bTrasportatore ? { sedeLegale: bTrasportatore.sedeLegale } : null,
        smaltitore: bSmaltitore,
        intermediario: null,
        campagnaCodice: campagna.codice,
        campagnaDescrizione: campagna.descrizione,
      }
      if (!nuove.some(n => n.bloccante)) {
        const parteDi: Record<string, Parte | null> = {
          produttore: v.produttore,
          trasportatore: v.trasportatore,
          smaltitore: v.destinatario,
        }
        for (const errore of erroriRecordCobat(rec)) {
          let correzione: SegnalazioneMovimento['correzione'] = { tipo: 'MOVIMENTO' }
          if (errore.origine === 'CAMPAGNA') {
            // Campagna del movimento: si corregge li'; altrimenti e' quella predefinita della sede.
            if (dati.campagna === undefined) correzione = { tipo: 'CONFIGURAZIONE_SEDE' }
          } else if (errore.origine === 'ANAGRAFICA') {
            const parte = errore.blocco ? parteDi[errore.blocco] : null
            if (parte?.tipo === 'SEDE') {
              correzione = { tipo: 'ANAGRAFICA_SEDE', sedeDittaId: parte.sede.id }
            } else if (parte?.tipo === 'NOI') {
              correzione = { tipo: 'CONFIGURAZIONE_SEDE' }
            }
          }
          nuove.push({
            codice: errore.carattere ? 'CARATTERI_NON_RAPPRESENTABILI' : 'RECORD_NON_VALIDO',
            messaggio: errore.messaggio,
            bloccante: true,
            movimento: m,
            correzione,
            ...(errore.campo ? { campo: errore.campo } : {}),
          })
        }
      }
      segn.push(...nuove)
      record.push(rec)
      inFile.push(m)
    })

    return { dati: { record }, avvisi: aggregaSegnalazioni(segn), movimentiInFile: inFile }
  }
}
