import { ChiaveLegacyError } from './errori'

/**
 * Chiavi legacy dei record importati da WinWaste. UNICO punto che le costruisce.
 *
 * Forma (piano Fase 3, D1; rapporto 04 §4.4; `docs/schema-db-winwaste.md` §2):
 * - movimenti e FIR: `ditta|anno|TABELLA|COD` (un database per anno, quindi `COD` identity non e'
 *   unico fra anni; la ditta e' di 4 cifre, il nome del database e' `WW<ditta 4><anno 4>`);
 * - ditta anagrafica: `ditta|FISC|<partita IVA o codice fiscale>`;
 * - soggetto (CLIFOR, ruoli produttore/trasportatore/destinatario): `ditta|<PRECOD>|<COD>` con
 *   PRECOD `C`/`F` (varchar(1)) e COD varchar(6);
 * - sede (UNITA LOCALI, senza PK): `ditta|<PRECOD>|<COD>|<UL>` con UL varchar(4).
 */

/** Pattern esportato: lo riusano il CHECK della migration e i test. */
export const CHIAVE_LEGACY_PATTERN = '^[0-9]{4}\\|[^|]+(\\|[^|]+)+$'
export const LUNGHEZZA_MASSIMA_CHIAVE_LEGACY = 200

export const TABELLE_CON_CHIAVE_ANNUALE = ['MOVIMENTI', 'FORMULARI'] as const
export type TabellaChiaveAnnuale = (typeof TABELLE_CON_CHIAVE_ANNUALE)[number]

const INT_MAX = 2147483647

function verificaDitta(ditta: string): void {
  if (!/^[0-9]{4}$/.test(ditta)) {
    throw new ChiaveLegacyError('DITTA_NON_VALIDA', "la ditta WinWaste e' di 4 cifre")
  }
}

function componente(valore: string, max: number, nome: string): void {
  if (
    valore.length === 0 ||
    valore.length > max ||
    valore.includes('|') ||
    // eslint-disable-next-line no-control-regex
    /[\u0000-\u001f]/.test(valore) ||
    valore !== valore.trim()
  ) {
    throw new ChiaveLegacyError(
      'COMPONENTE_NON_VALIDO',
      `${nome}: da 1 a ${max} caratteri, senza «|», spazi ai bordi o caratteri di controllo`
    )
  }
}

export function chiaveRecordAnnuale(
  ditta: string,
  anno: number,
  tabella: TabellaChiaveAnnuale,
  cod: number
): string {
  verificaDitta(ditta)
  if (!Number.isInteger(anno) || anno < 1990 || anno > 2100) {
    throw new ChiaveLegacyError('ANNO_NON_VALIDO', 'anno fuori da 1990-2100')
  }
  if (!(TABELLE_CON_CHIAVE_ANNUALE as readonly string[]).includes(tabella)) {
    throw new ChiaveLegacyError('TABELLA_NON_AMMESSA', String(tabella))
  }
  if (!Number.isInteger(cod) || cod < 1 || cod > INT_MAX) {
    throw new ChiaveLegacyError('COD_NON_VALIDO', 'COD intero positivo (int di SQL Server)')
  }
  return `${ditta}|${anno}|${tabella}|${cod}`
}

/** Alias leggibile per i record del registro e dei FIR (`MOVIMENTI`, `FORMULARI`). */
export function chiaveMovimento(
  ditta: string,
  anno: number,
  tabella: TabellaChiaveAnnuale,
  cod: number
): string {
  return chiaveRecordAnnuale(ditta, anno, tabella, cod)
}

export function chiaveDitta(ditta: string, partitaIvaOCodiceFiscale: string): string {
  verificaDitta(ditta)
  const v = partitaIvaOCodiceFiscale
  if (v.length === 0 || v.length > 16 || !/^[A-Za-z0-9]+$/.test(v)) {
    throw new ChiaveLegacyError(
      'FISCALE_NON_VALIDO',
      'partita IVA o codice fiscale: 1-16 caratteri alfanumerici, senza spazi'
    )
  }
  return `${ditta}|FISC|${v.toUpperCase()}`
}

function precod(valore: string): void {
  if (valore !== 'C' && valore !== 'F') {
    throw new ChiaveLegacyError('PRECOD_NON_VALIDO', 'PRECOD di CLIFOR: C o F')
  }
}

export function chiaveSoggetto(ditta: string, prec: string, cod: string): string {
  verificaDitta(ditta)
  precod(prec)
  componente(cod, 6, 'COD soggetto')
  return `${ditta}|${prec}|${cod}`
}

export function chiaveSede(ditta: string, prec: string, cod: string, ul: string): string {
  verificaDitta(ditta)
  precod(prec)
  componente(cod, 6, 'COD soggetto')
  componente(ul, 4, "COD unita' locale")
  return `${ditta}|${prec}|${cod}|${ul}`
}

/**
 * Automezzo (`AUTOMEZZI`, senza PK): `ditta|MEZ|<PRECOD>|<COD>`, con PRECOD = soggetto.unita'
 * proprietario (fino a 11 caratteri) e COD = codice del mezzo (4). «MEZ» non puo' essere un anno ne'
 * un PRECOD di CLIFOR (C/F), quindi la famiglia di chiavi non collide con le altre.
 */
export function chiaveAutomezzo(ditta: string, precod: string, cod: string): string {
  verificaDitta(ditta)
  componente(precod, 11, 'PRECOD automezzo')
  componente(cod, 4, 'COD automezzo')
  return `${ditta}|MEZ|${precod}|${cod}`
}

/**
 * Soggetto WinWaste della RIGA (C o F) per la chiave di una sede. UNICA regola, usata da `prepara`
 * (ANAGRAFICHE: sedi) e da chi deve riagganciare un riferimento `soggetto.unita'` a una sede
 * (FIR, registro): se divergessero, un PROD/SMAL punterebbe alla sede sbagliata senza errori.
 *  1. il PRECOD a 7 caratteri (`C000005`, `F000005`) porta gia' il C/F;
 *  2. altrimenti l'unico PRECOD di CLIFOR con quel COD;
 *  3. altrimenti (C e F con lo stesso COD, stessa ditta) il PRECOD della riga tenuta.
 */
export function precDellaRiga(
  precodDelRiferimento: 'C' | 'F' | undefined,
  precPerCod: ReadonlySet<string> | undefined,
  precTenuto: string
): string {
  if (precodDelRiferimento !== undefined) return precodDelRiferimento
  if (precPerCod !== undefined && precPerCod.size === 1) return [...precPerCod][0]
  return precTenuto
}

/** Chiave della sede (`chiaveSede`) di un riferimento `soggetto.unita'`, con la regola di `precDellaRiga`. */
export function chiaveSedeDaSoggettoUnita(
  ditta: string,
  riferimento: { readonly soggetto: string; readonly precod?: 'C' | 'F' },
  ul: string,
  contesto: { readonly precPerCod: ReadonlySet<string> | undefined; readonly precTenuto: string }
): string {
  return chiaveSede(
    ditta,
    precDellaRiga(riferimento.precod, contesto.precPerCod, contesto.precTenuto),
    riferimento.soggetto,
    ul
  )
}

/**
 * Giacenza iniziale al taglio (I6): una per famiglia, `ditta|anno|GIACENZE|<registroId>|<cer 6 cifre>|<stato fisico>`.
 * Il registro e' quello di WasteFlow (piu' magazzini WinWaste possono confluire nello stesso registro,
 * e la famiglia e' unica per registro). Il CER e' sempre di sole cifre (l'asterisco lo decide il
 * catalogo al caricamento). Stato fisico assente = `-`. «GIACENZE» non e' un anno ne' C/F/MEZ.
 */
export function chiaveGiacenza(
  ditta: string,
  anno: number,
  registroId: string,
  cerCifre: string,
  statoFisico: string | null
): string {
  verificaDitta(ditta)
  if (!Number.isInteger(anno) || anno < 1990 || anno > 2100) {
    throw new ChiaveLegacyError('ANNO_NON_VALIDO', 'anno fuori da 1990-2100')
  }
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(registroId)) {
    throw new ChiaveLegacyError('COMPONENTE_NON_VALIDO', 'registro: atteso un UUID')
  }
  if (!/^[0-9]{6}$/.test(cerCifre)) {
    throw new ChiaveLegacyError('COMPONENTE_NON_VALIDO', 'CER: attese 6 cifre')
  }
  if (statoFisico !== null) componente(statoFisico, 50, 'stato fisico')
  return `${ditta}|${anno}|GIACENZE|${registroId.toLowerCase()}|${cerCifre}|${statoFisico ?? '-'}`
}
