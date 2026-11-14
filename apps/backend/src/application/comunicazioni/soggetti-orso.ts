import type { ImpiantoNuovoOrso, SoggettoOrso } from '../../domain/comunicazioni/orso/aggregato'
import type { IndirizzoDati } from '../../domain/comunicazioni/orso/impianto-mesi'
import type { RisoluzioneIstat } from './anagrafica-comunicazioni.port'
import {
  chiaveControparte,
  type DettagliTracciato,
  type SedeDettaglio,
} from './lettore-dettagli-tracciato'

/**
 * Risoluzione dei soggetti di O.R.SO. modalità dettagliata (4.9e, C3, D12): dalla sede della ditta
 * collegata al FIR di ogni movimento si ricava `C` (comune), `I` (impianto dell'elenco ARPA) o
 * `Inew` (nuovo impianto, descritto per esteso). Sola lettura, nessuna query: i dati arrivano da
 * `leggiDettagliTracciato`; solo l'ISTAT di una sede passa da `risolviIstat` (una volta per sede).
 *
 * Tracciato ricavato dal decompilato di WinWaste (`RIEPILPERIOD:soggetto`), da confermare con un
 * file reale: i codici ARPA si inseriscono a mano nell'anagrafica della sede (Q4).
 */

export type CodiceErroreSoggetto =
  | 'ISTAT_SOGGETTO_NON_VALIDO'
  | 'CODICE_FISCALE_SOGGETTO_NON_VALIDO'

export interface ErroreSoggetto {
  codice: CodiceErroreSoggetto
  /** Sede e motivo, per il messaggio. */
  dettaglio: string
  movimentoIds: string[]
}

export interface MovimentoPerSoggetto {
  id: string
  tipo: 'CARICO' | 'SCARICO'
  firId: string | null
  /** Denominazione della controparte scritta nel registro (conta solo senza FIR). */
  controparte: string | null
  /** Indirizzo della controparte scritto nel registro (distingue le sedi di una stessa ditta). */
  indirizzoControparte: string | null
}

type DettagliPerSoggetti = Pick<
  DettagliTracciato,
  'fir' | 'sedi' | 'sedeLegalePerDitta' | 'destinatari' | 'produttori' | 'sediPerControparte'
>

export interface RisoluzioneSoggetti {
  /** Soggetto per id del movimento; assente = non identificato (lo segnala l'aggregatore). */
  soggetti: Map<string, SoggettoOrso>
  /** Sedi con dati non utilizzabili: bloccanti, con i movimenti coinvolti. */
  errori: ErroreSoggetto[]
}

export type RisolviIstatSede = (sedeDittaId: string) => Promise<RisoluzioneIstat>

const RE_ISTAT6 = /^[0-9]{6}$/
const RE_SOLO_CIFRE = /^[0-9]+$/
const RE_CODICE_ARPA = /^[0-9]{1,9}$/
const RE_CAP = /^[0-9]{1,5}$/
/** WinWaste (`createNodoImpianto`): civico troncato a 5 caratteri; l'XSD ne ammette 10. */
const MAX_CIVICO = 5
const MAX_RAGIONE_SOCIALE = 255
const MAX_NOME_VIA = 100

const MOTIVI_ISTAT: Record<string, string> = {
  COMUNE_NON_TROVATO: 'comune non trovato nell’elenco ISTAT',
  COMUNE_AMBIGUO: 'comune ambiguo nell’elenco ISTAT',
  COMUNE_O_PROVINCIA_MANCANTE: 'comune o provincia mancanti',
}

const compatta = (t: string | null | undefined) => (t ?? '').trim().replace(/\s+/g, ' ')

/**
 * Codice fiscale o partita IVA per `CodfisPIVA` (11-16 caratteri). Come WinWaste: un codice di sole
 * cifre si porta a 11 con zeri a sinistra; altrimenti serve un codice fiscale di 16 caratteri.
 * Il codice fiscale ha la precedenza sulla partita IVA.
 */
export function codfisPivaSoggetto(
  codiceFiscale: string | null | undefined,
  partitaIva: string | null | undefined
): string | null {
  for (const grezzo of [codiceFiscale, partitaIva]) {
    const c = compatta(grezzo).toUpperCase()
    if (c === '') continue
    if (RE_SOLO_CIFRE.test(c) && c.length <= 11) return c.padStart(11, '0')
    if (/^[A-Z0-9]{16}$/.test(c)) return c
  }
  return null
}

function indirizzo(sede: SedeDettaglio, istat6: string): IndirizzoDati {
  const nome = compatta(sede.via).slice(0, MAX_NOME_VIA).trim()
  const civico = compatta(sede.civico).slice(0, MAX_CIVICO).trim()
  const cap = compatta(sede.cap)
  return {
    ...(nome !== '' ? { nome } : {}),
    ...(civico !== '' ? { civico } : {}),
    // CAP a 5 cifre con zeri a sinistra (come WinWaste); se non è numerico non si scrive.
    ...(RE_CAP.test(cap) ? { cap: cap.padStart(5, '0') } : {}),
    provincia: istat6.slice(0, 3),
    comune: istat6.slice(3),
  }
}

const normalizza = (t: string | null | undefined) =>
  compatta(t)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9 ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

/**
 * Senza FIR il soggetto è la ditta indicata come controparte del movimento: la denominazione deve
 * coincidere con la ragione sociale di una ditta in anagrafica. Con più sedi decide l'indirizzo
 * (via e comune, poi il solo comune); anche con una sola ditta, se il movimento ha un indirizzo
 * il comune della sede deve comparire in esso; se non basta il movimento resta non identificato
 * (bloccante: va controllata la controparte).
 */
function sedeDaControparte(
  m: MovimentoPerSoggetto,
  dettagli: Pick<DettagliPerSoggetti, 'sediPerControparte'>
): SedeDettaglio | null {
  if (!m.controparte || compatta(m.controparte) === '') return null
  const candidate = dettagli.sediPerControparte.get(chiaveControparte(m.controparte)) ?? []
  const indirizzoMov = normalizza(m.indirizzoControparte)
  if (candidate.length === 1) {
    const unica = candidate[0]
    const comune = normalizza(unica.comune)
    // Con l'indirizzo scritto, il comune della sede deve comparire: altrimenti è un altro soggetto.
    return indirizzoMov === '' || comune === '' || ` ${indirizzoMov} `.includes(` ${comune} `)
      ? unica
      : null
  }
  if (candidate.length === 0 || indirizzoMov === '') return null
  const contiene = (c: string) => c !== '' && ` ${indirizzoMov} `.includes(` ${c} `)
  const perViaEComune = candidate.filter(
    c => contiene(normalizza(c.via)) && contiene(normalizza(c.comune))
  )
  if (perViaEComune.length === 1) return perViaEComune[0]
  if (perViaEComune.length > 1) return null
  const perComune = candidate.filter(c => contiene(normalizza(c.comune)))
  return perComune.length === 1 ? perComune[0] : null
}

/**
 * Sede che identifica il soggetto. Con il FIR: produttore per i carichi, destinatario per gli
 * scarichi; per i FIR creati prima del 31/10 (senza colonne di sede) si ripiega sul produttore o
 * sul destinatario di anagrafica. Senza FIR: la controparte del movimento.
 */
function sedeDelMovimento(
  m: MovimentoPerSoggetto,
  dettagli: DettagliPerSoggetti
): SedeDettaglio | null {
  if (!m.firId) return sedeDaControparte(m, dettagli)
  const fir = dettagli.fir.get(m.firId)
  if (!fir) return null
  const sedeId =
    m.tipo === 'CARICO'
      ? (fir.producerSedeId ??
        (fir.producerId ? dettagli.produttori.get(fir.producerId)?.sedeId : null))
      : (fir.receiverSedeId ??
        (fir.receiverId ? dettagli.destinatari.get(fir.receiverId)?.sedeId : null))
  return (sedeId ? dettagli.sedi.get(sedeId) : undefined) ?? null
}

export async function risolviSoggettiOrso(
  movimenti: readonly MovimentoPerSoggetto[],
  dettagli: DettagliPerSoggetti,
  risolviIstat: RisolviIstatSede
): Promise<RisoluzioneSoggetti> {
  const istatPerSede = new Map<string, Promise<RisoluzioneIstat>>()
  const istat = (sedeId: string) => {
    const gia = istatPerSede.get(sedeId)
    if (gia) return gia
    const nuovo = risolviIstat(sedeId)
    istatPerSede.set(sedeId, nuovo)
    return nuovo
  }

  const soggetti = new Map<string, SoggettoOrso>()
  const errori = new Map<string, ErroreSoggetto>()
  const errore = (codice: CodiceErroreSoggetto, dettaglio: string, movimentoId: string) => {
    const k = `${codice}|${dettaglio}`
    const e = errori.get(k) ?? { codice, dettaglio, movimentoIds: [] }
    e.movimentoIds.push(movimentoId)
    errori.set(k, e)
    return k
  }
  // Un soggetto per sede e verso: carichi e scarichi della stessa sede si calcolano una volta.
  const cache = new Map<string, SoggettoOrso | { errore: string }>()

  for (const m of movimenti) {
    const sede = sedeDelMovimento(m, dettagli)
    if (!sede) continue
    const nomeSede = `${sede.ditta.ragioneSociale} (${compatta(sede.comune) || 'comune mancante'})`
    const ana = sede.anagrafica
    // Il comune esiste solo fra i conferitori (`tTipoSoggettoOut` = I, Inew, Tot): in uscita un
    // comune diventa un nuovo impianto.
    const comeComune = ana?.eComune === true && m.tipo === 'CARICO'
    const chiaveCache = `${sede.id}|${comeComune ? 'C' : 'X'}`
    let s = cache.get(chiaveCache)

    if (s === undefined) {
      const ris = await istat(sede.id)
      const istat6 = ris.codice !== null && RE_ISTAT6.test(ris.codice) ? ris.codice : null
      const codiceOrso = ana?.codiceOrso?.trim() ?? ''
      if (comeComune) {
        s = istat6
          ? { tipo: 'C', istat: istat6, etichetta: `Comune di ${compatta(sede.comune)}` }
          : {
              errore: errore(
                'ISTAT_SOGGETTO_NON_VALIDO',
                `${nomeSede}: ${ris.codice === null ? MOTIVI_ISTAT[ris.motivo] : 'codice ISTAT non di 6 cifre'}`,
                m.id
              ),
            }
      } else if (RE_CODICE_ARPA.test(codiceOrso)) {
        s = { tipo: 'I', codice: codiceOrso, etichetta: `${nomeSede}, ARPA ${codiceOrso}` }
      } else {
        const codfis = codfisPivaSoggetto(sede.ditta.codiceFiscale, sede.ditta.partitaIva)
        if (!codfis) {
          s = {
            errore: errore(
              'CODICE_FISCALE_SOGGETTO_NON_VALIDO',
              `${nomeSede}: codice fiscale o partita IVA non di 11 o 16 caratteri`,
              m.id
            ),
          }
        } else if (!istat6) {
          s = {
            errore: errore(
              'ISTAT_SOGGETTO_NON_VALIDO',
              `${nomeSede}: ${ris.codice === null ? MOTIVI_ISTAT[ris.motivo] : 'codice ISTAT non di 6 cifre'}`,
              m.id
            ),
          }
        } else {
          const legale = dettagli.sedeLegalePerDitta.get(sede.dittaId)
          // La sede legale è facoltativa nell'XSD: senza ISTAT valido si omette.
          let indirizzoSL: IndirizzoDati | undefined
          if (legale) {
            const r = await istat(legale.id)
            if (r.codice !== null && RE_ISTAT6.test(r.codice))
              indirizzoSL = indirizzo(legale, r.codice)
          }
          const impianto: ImpiantoNuovoOrso = {
            ragioneSociale: compatta(sede.ditta.ragioneSociale)
              .slice(0, MAX_RAGIONE_SOCIALE)
              .trim(),
            codfisPiva: codfis,
            ...(indirizzoSL ? { indirizzoSL } : {}),
            indirizzoUL: indirizzo(sede, istat6),
          }
          s = { tipo: 'Inew', chiave: sede.id, impianto }
        }
      }
      cache.set(chiaveCache, s)
    } else if ('errore' in s) {
      // Stessa sede già in errore: il movimento va comunque nell'elenco di quell'errore.
      errori.get(s.errore)?.movimentoIds.push(m.id)
    }
    if (!('errore' in s)) soggetti.set(m.id, s)
  }

  return {
    soggetti,
    errori: [...errori.values()].map(e => ({
      ...e,
      movimentoIds: [...new Set(e.movimentoIds)].sort(),
    })),
  }
}
