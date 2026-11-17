import { giornoItaliano } from '../../core/time/anno-italiano'
import { cercaCampiNonRappresentabili } from '../../domain/comunicazioni/fisso/codifica-cp1252'
import type { ConfigurazioneOrr } from '../../domain/comunicazioni/configurazione-sede'
import { validaDatiTracciato } from '../../domain/comunicazioni/dati-tracciato'
import {
  attivitaDelMovimento,
  siglaInCampania,
  tipoDetentore,
  tipoImpiantoDestinatario,
  trasportoDaComunicare,
} from '../../domain/comunicazioni/orr/attivita'
import { ATTIVITA_ORR, type AttivitaOrr } from '../../domain/comunicazioni/orr/costanti'
import { codiceUnitaLocaleOrr } from '../../domain/comunicazioni/orr/nome-file'
import type {
  DatiFileOrr,
  DestinatarioOrr,
  DetentoreOrr,
  RecordOrr,
  SoggettoOrr,
  TrasportatoreOrr,
} from '../../domain/comunicazioni/orr/record-orr'
import type { MovimentoAvviso } from './comunicazioni-orso.port'
import type {
  AvvisoTracciato,
  ContestoPreparazione,
  CorrezioneAvviso,
  PreparazioneTracciato,
} from './comunicazioni-tracciato.port'
import type { FirDettaglio, SedeDettaglio } from './lettore-dettagli-tracciato'
import type { MovimentoOrso } from './lettore-movimenti-orso'

/**
 * Costruzione pura del file O.R.R. (4.9f D3): dai movimenti, dai dettagli e dalla configurazione
 * ai record da 718 caratteri e agli avvisi. Nessun accesso al database: i dati che il contesto non
 * porta (indirizzo dell'azienda, autorizzazione dell'impianto, ISTAT dei comuni) arrivano in `extra`.
 * Un avviso bloccante impedisce il file (D14); ogni avviso porta il link alla correzione.
 */

export interface IndirizzoPropriaOrr {
  indirizzo: string | null
  civico: string | null
  cap: string | null
  comune: string | null
  provincia: string | null
}

export interface ExtraPreparazioneOrr {
  /** Sede legale dell'azienda (dati del `Tenant`). */
  sedeLegalePropria: IndirizzoPropriaOrr
  /** Autorizzazione dell'impianto scelta dalla configurazione (o proposta se unica), `AAAA-MM-GG`. */
  autorizzazionePropria: { estremi: string; data: string | null } | null
  /** Piu' autorizzazioni e nessuna scelta: la proposta automatica non e' possibile. */
  autorizzazioneAmbigua: boolean
  /** ISTAT a 6 cifre dei comuni risolti per nome e provincia, per chiave `chiaveComune`. */
  istatPerComune: ReadonlyMap<string, string>
}

export const chiaveComune = (nome: string, sigla: string): string =>
  `${nome.trim().toLowerCase()}|${sigla.trim().toUpperCase()}`

const RE_ATECO_6 = /^[0-9]{6}$/
const RE_ATECO_PUNTI = /^[0-9]{2}\.[0-9]{2}\.[0-9]{2}$/

/** ATECO nel formato `NN.NN.NN`; `null` se non riconoscibile. */
export function formattaAtecoOrr(codice: string | null | undefined): string | null {
  const c = (codice ?? '').trim()
  if (RE_ATECO_PUNTI.test(c)) return c
  if (RE_ATECO_6.test(c)) return `${c.slice(0, 2)}.${c.slice(2, 4)}.${c.slice(4, 6)}`
  return null
}

const unisci = (a: string | null | undefined, b: string | null | undefined): string =>
  [a, b]
    .map(x => (x ?? '').trim())
    .filter(x => x !== '')
    .join(', ')

const normCf = (v: string | null | undefined): string => (v ?? '').trim().toUpperCase()

/** Raccoglie gli avvisi raggruppati per codice e messaggio, con i movimenti coinvolti. */
class Raccolta {
  private readonly voci = new Map<
    string,
    {
      codice: string
      messaggio: string
      bloccante: boolean
      correzione?: CorrezioneAvviso
      movimenti: Map<string, MovimentoAvviso>
    }
  >()

  aggiungi(
    codice: string,
    messaggio: string,
    bloccante: boolean,
    movimento?: MovimentoOrso,
    correzione?: CorrezioneAvviso
  ): void {
    const k = `${codice}\u0000${messaggio}`
    const v = this.voci.get(k) ?? {
      codice,
      messaggio,
      bloccante,
      correzione,
      movimenti: new Map<string, MovimentoAvviso>(),
    }
    if (movimento) {
      v.movimenti.set(movimento.id, {
        id: movimento.id,
        data: giornoItaliano(movimento.movementDate),
        numero: movimento.numero,
        cer: movimento.cer,
      })
    }
    this.voci.set(k, v)
  }

  elenco(): AvvisoTracciato[] {
    return [...this.voci.values()]
      .map(v => ({
        codice: v.codice,
        messaggio: v.messaggio,
        bloccante: v.bloccante,
        movimentoIds: [...v.movimenti.keys()].sort(),
        movimenti: [...v.movimenti.values()].sort((a, b) => a.id.localeCompare(b.id)),
        ...(v.correzione ? { correzione: v.correzione } : {}),
      }))
      .sort(
        (x, y) =>
          Number(y.bloccante) - Number(x.bloccante) ||
          x.codice.localeCompare(y.codice) ||
          x.messaggio.localeCompare(y.messaggio)
      )
  }
}

interface Parte<S> {
  soggetto: S
  /** Sede di anagrafica da correggere, se la parte e' una sede di terzi. */
  sedeDittaId?: string
  istatUnitaLocale: string | null
}

function chiaveDati(movimento: MovimentoOrso) {
  return movimento.radiceId
}

export function costruisciFileOrr(
  ctx: ContestoPreparazione<ConfigurazioneOrr>,
  extra: ExtraPreparazioneOrr
): PreparazioneTracciato<DatiFileOrr> {
  const richiesta = ctx.parametri.attivita as AttivitaOrr
  if (!ATTIVITA_ORR.includes(richiesta)) throw new RangeError(`attività non valida: ${richiesta}`)
  const cfg = ctx.configurazione
  const raccolta = new Raccolta()
  const correzioneConfig: CorrezioneAvviso = { tipo: 'CONFIGURAZIONE_SEDE' }

  if (!siglaInCampania(ctx.unita.provincia)) {
    raccolta.aggiungi(
      'SEDE_NON_IN_CAMPANIA',
      'La sede non è in Campania (AV, BN, CE, NA, SA): la comunicazione O.R.R. riguarda solo le sedi campane. Controlla la provincia della sede.',
      true,
      undefined,
      correzioneConfig
    )
  }
  if (codiceUnitaLocaleOrr(ctx.unita.progressivoMud) === null) {
    raccolta.aggiungi(
      'CODICE_SEDE_MANCANTE',
      'Manca il progressivo MUD della sede (da 0 a 9999): serve al nome del file.',
      true,
      undefined,
      correzioneConfig
    )
  }

  const sede = (id: string | null | undefined): SedeDettaglio | undefined =>
    id ? ctx.dettagli.sedi.get(id) : undefined
  const sedeLegale = (s: SedeDettaglio): SedeDettaglio =>
    ctx.dettagli.sedeLegalePerDitta.get(s.dittaId) ?? s
  const istatDi = (s: SedeDettaglio): string | null =>
    s.anagrafica?.codiceIstatComune ??
    extra.istatPerComune.get(chiaveComune(s.comune, s.provincia)) ??
    null

  const noiCf = [normCf(ctx.azienda.partitaIva), normCf(ctx.azienda.codiceFiscale)].filter(
    x => x !== ''
  )
  const siamoTrasportatore = (fir: FirDettaglio | undefined): boolean => {
    if (!fir) return false
    const candidati = [
      fir.carrierCodiceFiscale,
      fir.carrierPartitaIva,
      fir.trasportatore1?.codiceFiscale,
      fir.trasportatore1?.partitaIva,
    ]
      .map(normCf)
      .filter(x => x !== '')
    return candidati.some(c => noiCf.includes(c))
  }

  // --- Soggetti propri ---------------------------------------------------------------------
  const propria = (m: MovimentoOrso | undefined): Parte<SoggettoOrr> => {
    const ctrl = (cond: boolean, msg: string) => {
      if (!cond) raccolta.aggiungi('DATI_SEDE_PROPRIA', msg, true, m, correzioneConfig)
    }
    const sl = extra.sedeLegalePropria
    const slCap = (sl.cap ?? '').trim()
    const slIstat =
      sl.comune && sl.provincia
        ? extra.istatPerComune.get(chiaveComune(sl.comune, sl.provincia))
        : undefined
    const ul = ctx.unita
    const ulIstat =
      ul.comune && ul.provincia
        ? extra.istatPerComune.get(chiaveComune(ul.comune, ul.provincia))
        : undefined
    const codice = ctx.azienda.partitaIva?.trim() || ctx.azienda.codiceFiscale?.trim() || ''
    ctrl(codice !== '', 'Manca la partita IVA o il codice fiscale dell’azienda.')
    ctrl(
      unisci(sl.indirizzo, sl.civico) !== '',
      'Manca l’indirizzo della sede legale dell’azienda.'
    )
    ctrl(/^[0-9]{5}$/.test(slCap), 'Il CAP della sede legale dell’azienda non è valido (5 cifre).')
    ctrl(!!slIstat, 'Non si trova il codice ISTAT del comune della sede legale dell’azienda.')
    ctrl(unisci(ul.indirizzo, ul.civico) !== '', 'Manca l’indirizzo della sede (unità locale).')
    ctrl(
      /^[0-9]{5}$/.test((ul.cap ?? '').trim()),
      'Il CAP della sede (unità locale) non è valido (5 cifre).'
    )
    ctrl(!!ulIstat, 'Non si trova il codice ISTAT del comune della sede (unità locale).')
    return {
      soggetto: {
        ragioneSociale: ctx.azienda.ragioneSociale,
        codice,
        indirizzoSedeLegale: unisci(sl.indirizzo, sl.civico),
        capSedeLegale: slCap,
        istatSedeLegale: slIstat ?? '',
        indirizzoUnitaLocale: unisci(ul.indirizzo, ul.civico),
        capUnitaLocale: (ul.cap ?? '').trim(),
        istatUnitaLocale: ulIstat ?? '',
      },
      istatUnitaLocale: ulIstat ?? null,
    }
  }

  // --- Soggetti di terzi (sede ditta) ------------------------------------------------------
  const daSede = (s: SedeDettaglio, ruolo: string, m: MovimentoOrso): Parte<SoggettoOrr> => {
    const corr: CorrezioneAvviso = { tipo: 'ANAGRAFICA_SEDE', sedeDittaId: s.id }
    const legale = sedeLegale(s)
    const nome = s.ditta.ragioneSociale
    const ctrl = (cond: boolean, msg: string) => {
      if (!cond)
        raccolta.aggiungi('DATI_SEDE_CONTROPARTE', `${ruolo} «${nome}»: ${msg}`, true, m, corr)
    }
    const codice = s.ditta.partitaIva?.trim() || s.ditta.codiceFiscale?.trim() || ''
    const istatSl = istatDi(legale)
    const istatUl = istatDi(s)
    ctrl(codice !== '', 'manca la partita IVA o il codice fiscale.')
    ctrl(unisci(legale.via, legale.civico) !== '', 'manca l’indirizzo della sede legale.')
    ctrl(/^[0-9]{5}$/.test(legale.cap.trim()), 'il CAP della sede legale non è valido (5 cifre).')
    ctrl(
      !!istatSl,
      'non si trova il codice ISTAT del comune della sede legale (indicalo nell’anagrafica).'
    )
    ctrl(unisci(s.via, s.civico) !== '', 'manca l’indirizzo dell’unità locale.')
    ctrl(/^[0-9]{5}$/.test(s.cap.trim()), 'il CAP dell’unità locale non è valido (5 cifre).')
    ctrl(
      !!istatUl,
      'non si trova il codice ISTAT del comune dell’unità locale (indicalo nell’anagrafica).'
    )
    return {
      soggetto: {
        ragioneSociale: nome,
        codice,
        indirizzoSedeLegale: unisci(legale.via, legale.civico),
        capSedeLegale: legale.cap.trim(),
        istatSedeLegale: istatSl ?? '',
        indirizzoUnitaLocale: unisci(s.via, s.civico),
        capUnitaLocale: s.cap.trim(),
        istatUnitaLocale: istatUl ?? '',
      },
      sedeDittaId: s.id,
      istatUnitaLocale: istatUl,
    }
  }

  // --- Selezione dei movimenti -------------------------------------------------------------
  const ordinati = [...ctx.movimenti].sort(
    (a, b) =>
      a.movementDate.getTime() - b.movementDate.getTime() ||
      a.numero.localeCompare(b.numero, 'it', { numeric: true }) ||
      a.id.localeCompare(b.id)
  )
  const record: RecordOrr[] = []
  const inFile: MovimentoOrso[] = []
  let esclusi = 0
  let tipoImpiantoMancante = false

  for (const m of ordinati) {
    // Causale non rilevante per il MUD (ruolo ESCLUSO): fuori da ogni file, come in WinWaste.
    if (m.ruolo === 'ESCLUSO') continue
    const fir = m.firId ? ctx.dettagli.fir.get(m.firId) : undefined
    const jsonDati = ctx.dettagli.datiTracciato.get(chiaveDati(m))
    let datiOrr: {
      attivita?: 'FRA' | 'ROT' | 'AUT'
      formulario?: { numero: string; data: string }
    } = {}
    if (jsonDati !== undefined && jsonDati !== null) {
      const esito = validaDatiTracciato('ORR', jsonDati)
      if (esito.ok) datiOrr = esito.valore
      else
        raccolta.aggiungi(
          'DATI_ORR_NON_VALIDI',
          `I dati O.R.R. del movimento non sono validi: ${esito.errori.slice(0, 3).join('; ')}`,
          true,
          m,
          { tipo: 'MOVIMENTO' }
        )
    }

    // Sedi di terzi coinvolte (per l'esclusione `esclusa_orr` e per le parti).
    const sedeProduttore = sede(fir?.producerSedeId)
    const noiRicevitori = m.tipo === 'CARICO' && m.ruolo === 'RICEVUTO_DA_TERZI'
    const sedeDestinatario = noiRicevitori ? undefined : sede(fir?.receiverSedeId)
    const trasportatoreRiga = fir?.carrierId
      ? ctx.dettagli.trasportatori.get(fir.carrierId)
      : undefined
    const sedeTrasportatore = sede(trasportatoreRiga?.sedeId)
    if (
      sedeProduttore?.anagrafica?.esclusaOrr ||
      sedeDestinatario?.anagrafica?.esclusaOrr ||
      sedeTrasportatore?.anagrafica?.esclusaOrr
    ) {
      esclusi += 1
      continue
    }

    const attivita = attivitaDelMovimento(
      { tipo: m.tipo, ruolo: m.ruolo, operazione: m.operazione },
      cfg.tipoImpianto,
      siamoTrasportatore(fir),
      datiOrr
    )
    if (noiRicevitori && !datiOrr.attivita && !cfg.tipoImpianto) tipoImpiantoMancante = true
    if (!attivita.includes(richiesta)) continue

    // Parte «noi» o terza per produttore e destinatario.
    const produttoreNoi = !sedeProduttore && (m.tipo === 'SCARICO' || m.ruolo === 'PRODOTTO')
    const produttore: Parte<SoggettoOrr> | null = sedeProduttore
      ? daSede(sedeProduttore, 'Produttore', m)
      : produttoreNoi
        ? propria(m)
        : null
    if (!produttore) {
      raccolta.aggiungi(
        'PRODUTTORE_NON_IDENTIFICATO',
        'Manca il produttore: il movimento non ha un FIR con la sede del produttore. Il detentore privato non si deduce, va gestito a parte.',
        true,
        m,
        { tipo: 'MOVIMENTO' }
      )
    }
    let destinatario: Parte<SoggettoOrr> | null = null
    let autorizzazione: { numero: string; data: string | null } | null = null
    if (noiRicevitori) {
      destinatario = propria(m)
      if (extra.autorizzazionePropria) {
        autorizzazione = {
          numero: extra.autorizzazionePropria.estremi,
          data: extra.autorizzazionePropria.data,
        }
      } else {
        raccolta.aggiungi(
          'AUTORIZZAZIONE_IMPIANTO_MANCANTE',
          extra.autorizzazioneAmbigua
            ? 'Ci sono più autorizzazioni dell’impianto: scegli quella della sede nella configurazione O.R.R.'
            : 'Manca l’autorizzazione dell’impianto: sceglila nella configurazione O.R.R. della sede.',
          true,
          m,
          correzioneConfig
        )
      }
    } else if (sedeDestinatario) {
      destinatario = daSede(sedeDestinatario, 'Destinatario', m)
      const riga = fir?.receiverId ? ctx.dettagli.destinatari.get(fir.receiverId) : undefined
      const numero = riga?.numeroAutorizzazione?.trim() ?? ''
      autorizzazione = {
        numero,
        data: sedeDestinatario.anagrafica?.autorizzazioneData
          ? sedeDestinatario.anagrafica.autorizzazioneData.toISOString().slice(0, 10)
          : null,
      }
      const corr: CorrezioneAvviso = { tipo: 'ANAGRAFICA_SEDE', sedeDittaId: sedeDestinatario.id }
      if (numero === '')
        raccolta.aggiungi(
          'AUTORIZZAZIONE_DESTINATARIO',
          `Destinatario «${sedeDestinatario.ditta.ragioneSociale}»: manca il numero dell’autorizzazione (anagrafica del destinatario).`,
          true,
          m,
          corr
        )
      if (!autorizzazione.data)
        raccolta.aggiungi(
          'AUTORIZZAZIONE_DESTINATARIO',
          `Destinatario «${sedeDestinatario.ditta.ragioneSociale}»: manca la data dell’autorizzazione.`,
          true,
          m,
          corr
        )
    } else {
      raccolta.aggiungi(
        'DESTINATARIO_NON_IDENTIFICATO',
        'Manca il destinatario: il movimento non ha un FIR con la sede del destinatario.',
        true,
        m,
        { tipo: 'MOVIMENTO' }
      )
    }

    // Regola del file T: almeno una delle due parti in Campania; se l'ISTAT di una parte non
    // si conosce e l'altra non e' campana non si decide a vuoto, il movimento resta e l'errore emerge.
    if (richiesta === 'TRA' && produttore && destinatario) {
      const ip = produttore.istatUnitaLocale
      const id = destinatario.istatUnitaLocale
      const indeterminato = ip === null || id === null
      if (!trasportoDaComunicare(ip, id) && !indeterminato) continue
    }

    // Trasportatore.
    let trasportatore: TrasportatoreOrr | null = null
    const haTrasportatore =
      !!fir &&
      (!!fir.carrierId ||
        normCf(fir.carrierCodiceFiscale) !== '' ||
        normCf(fir.carrierPartitaIva) !== '')
    if (haTrasportatore) {
      if (!sedeTrasportatore) {
        raccolta.aggiungi(
          'TRASPORTATORE_NON_IN_ANAGRAFICA',
          `Trasportatore «${fir?.carrierName ?? ''}»: non è collegato a una sede in anagrafica (quando il trasportatore sei tu, l'azienda va censita fra i trasportatori, con l'Albo nell'anagrafica della sede).`,
          true,
          m,
          { tipo: 'MOVIMENTO' }
        )
      } else {
        const p = daSede(sedeTrasportatore, 'Trasportatore', m)
        const corr: CorrezioneAvviso = {
          tipo: 'ANAGRAFICA_SEDE',
          sedeDittaId: sedeTrasportatore.id,
        }
        const nome = sedeTrasportatore.ditta.ragioneSociale
        const numero =
          trasportatoreRiga?.numeroIscrizione?.trim() ||
          fir?.trasportatore1?.numeroIscrizioneAlbo?.trim() ||
          ''
        const data = sedeTrasportatore.anagrafica?.alboDataIscrizione
          ? sedeTrasportatore.anagrafica.alboDataIscrizione.toISOString().slice(0, 10)
          : null
        const classi = sedeTrasportatore.anagrafica?.alboClassi?.trim() ?? ''
        if (numero === '')
          raccolta.aggiungi(
            'ALBO_TRASPORTATORE',
            `Trasportatore «${nome}»: manca il numero di iscrizione all’Albo.`,
            true,
            m,
            corr
          )
        if (!data)
          raccolta.aggiungi(
            'ALBO_TRASPORTATORE',
            `Trasportatore «${nome}»: manca la data di iscrizione all’Albo.`,
            true,
            m,
            corr
          )
        if (classi === '')
          raccolta.aggiungi(
            'ALBO_TRASPORTATORE',
            `Trasportatore «${nome}»: mancano le classi di iscrizione all’Albo.`,
            true,
            m,
            corr
          )
        trasportatore = { ...p.soggetto, alboData: data, alboNumero: numero, alboClassi: classi }
      }
    }

    // Formulario, quantita', operazione.
    // Il primo numero non vuoto: una stringa vuota sul FIR non deve nascondere quello dei dati O.R.R.
    const numeroFormulario =
      [fir?.firNumero, m.firNumero, datiOrr.formulario?.numero]
        .map(n => (n ?? '').trim())
        .find(n => n !== '') ?? ''
    if (numeroFormulario.trim() === '') {
      raccolta.aggiungi(
        'MANCA_FORMULARIO',
        'Manca il numero del formulario: indicalo nei dati O.R.R. del movimento (pulsante «Dati O.R.R.» accanto all’avviso).',
        true,
        m,
        { tipo: 'MOVIMENTO' }
      )
    }
    if (m.kg === null) {
      raccolta.aggiungi(
        'QUANTITA_NON_CONVERTIBILE',
        'La quantità non è convertibile in kg (unità di misura senza peso specifico).',
        true,
        m,
        { tipo: 'MOVIMENTO' }
      )
    }

    // Detentore (c): ATECO e tipo.
    let detentore: DetentoreOrr | null = null
    if (produttore) {
      let ateco: string | null
      if (produttoreNoi) ateco = formattaAtecoOrr(ctx.azienda.atecoCode)
      else ateco = formattaAtecoOrr(sedeProduttore?.anagrafica?.codiceAteco)
      if (ateco === null && cfg.atecoProduttoreMancanteComeZero) ateco = '00'
      if (ateco === null) {
        raccolta.aggiungi(
          'ATECO_PRODUTTORE',
          produttoreNoi
            ? 'Manca il codice ATECO dell’azienda (formato NN.NN.NN).'
            : `Produttore «${sedeProduttore?.ditta.ragioneSociale ?? ''}»: manca il codice ATECO (formato NN.NN.NN) oppure attiva «ATECO mancante come 00» nella configurazione.`,
          true,
          m,
          produttoreNoi
            ? correzioneConfig
            : { tipo: 'ANAGRAFICA_SEDE', sedeDittaId: sedeProduttore?.id ?? '' }
        )
      }
      detentore = {
        ...produttore.soggetto,
        ateco: ateco ?? '',
        // INFERENZA (WinWaste, 14/11): `STO` solo se il produttore e' un nostro impianto di stoccaggio.
        tipo: tipoDetentore(produttoreNoi ? cfg.tipoImpianto : undefined),
      }
    }

    if (destinatario && autorizzazione && produttore) {
      const dest: DestinatarioOrr = {
        ...destinatario.soggetto,
        autorizzazioneData: autorizzazione.data,
        autorizzazioneNumero: autorizzazione.numero,
        tipoImpianto: tipoImpiantoDestinatario(
          richiesta,
          cfg.tipoImpianto,
          m.operationCode ?? fir?.wasteOperationCode ?? null,
          m.operazione,
          datiOrr.attivita
        ),
      }
      const g = giornoItaliano(m.movementDate)
      const rec: RecordOrr = {
        movimento: m.numero,
        movimentoId: m.id,
        anno: Number(g.slice(0, 4)),
        mese: Number(g.slice(5, 7)),
        formulario: numeroFormulario,
        dataFormulario: fir
          ? giornoItaliano(fir.transportDate)
          : (datiOrr.formulario?.data ?? null),
        tipoDichiarante: richiesta,
        cer: m.cer,
        quantitaKg: m.kg ?? 0,
        destinazione: (m.operationCode ?? fir?.wasteOperationCode ?? '').trim().slice(0, 3),
        detentore,
        trasportatore,
        destinatario: dest,
      }
      // Il file e' in Windows-1252: un carattere che non si rappresenta si segnala qui, sul
      // movimento e col punto di correzione, prima che la validazione generica lo anonimizzi.
      for (const c of cercaCampiNonRappresentabili(rec)) {
        raccolta.aggiungi(
          'CARATTERI_NON_RAPPRESENTABILI',
          `Il campo «${c.campo}» contiene caratteri non rappresentabili in Windows-1252: ${c.caratteri.join(' ')}. Correggili prima di generare il file.`,
          true,
          m,
          { tipo: 'MOVIMENTO' }
        )
      }
      record.push(rec)
      inFile.push(m)
    }
  }

  if (richiesta === 'AUT') {
    // Fuori ambito (D13): i dati di pedana (`calcolapedan`) non esistono in WasteFlow.
    for (const m of inFile) {
      raccolta.aggiungi(
        'AUTODEMOLITORE_NON_SUPPORTATO',
        'Autodemolitore (AUT): i dati di pedana non sono gestiti, il file non si può generare. Fuori ambito di questa versione.',
        true,
        m,
        { tipo: 'MOVIMENTO' }
      )
    }
  }
  if (tipoImpiantoMancante && richiesta !== 'TRA') {
    raccolta.aggiungi(
      'TIPO_IMPIANTO_MANCANTE',
      'Manca il tipo impianto della sede (STO, SMA, REC, R/S, AUT, ROT, FRA) nella configurazione O.R.R.: senza non si sa in quale file mettere i rifiuti ricevuti da terzi.',
      true,
      undefined,
      correzioneConfig
    )
  }
  if (esclusi > 0) {
    raccolta.aggiungi(
      'MOVIMENTI_ESCLUSI_ORR',
      `${esclusi} movimenti non sono inclusi perché una controparte è marcata «esclusa dalla comunicazione O.R.R.».`,
      false
    )
  }
  if (record.length === 0) {
    raccolta.aggiungi(
      'NESSUN_DATO',
      'Non ci sono dati da comunicare per questa attività nel periodo.',
      false
    )
  }

  return {
    dati: { attivita: richiesta, record },
    avvisi: raccolta.elenco(),
    movimentiInFile: inFile,
  }
}
