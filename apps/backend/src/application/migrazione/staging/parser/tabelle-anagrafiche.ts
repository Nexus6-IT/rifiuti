import { RecordTabellaEstesa } from '../../../../domain/migrazione/winwaste/record'
import { EsitoParser, parsaTabella, SorgenteRighe } from './scarti'

/**
 * Parser minimi delle tabelle del catalogo esteso (pezzo I1 dell'import WinWaste):
 * `CLIFOR`, `SEDI LEGALI`, `UNITA LOCALI`, `AUTORIZZAZIONI`, `AUTOMEZZI`, `AUTISTI`,
 * `MAGAZZINI RIFIUTI`, `NUMERAZIONI`, `RENrelazioniIniziali`, `RENesportazioni`,
 * `XRENTRIFORMULARI`, `XRENTRIFIRTRASMESSI`, `CONTRATTI`, `ELENCHIADDEB`, `ADDEBCON`,
 * `ADDEBITI`, `CONDIZIONI DI PAGAMENTO`. Colonne e chiavi: `docs/schema-db-winwaste.md` §2.2,
 * §2.4, §2.5 e §6 (catalogo del database modello).
 *
 * Non decodificano nulla: verificano la chiave logica e ripuliscono gli spazi. Molte di queste
 * tabelle NON hanno chiave primaria (`SEDI LEGALI`, `UNITA LOCALI`, `AUTORIZZAZIONI`, `AUTOMEZZI`,
 * `AUTISTI`): il database ammette duplicati, quindi la chiave si controlla qui e il duplicato si
 * scarta (mai fuso in silenzio, regola D8). Le trasformazioni vere sono nei pezzi I4-I12.
 *
 * Scarti (un solo scarto per riga, il primo trovato): `CHIAVE_VUOTA`, `CHIAVE_DUPLICATA`.
 * Nel rapporto compaiono solo codici di chiave e numeri di riga, mai valori: del codice fiscale
 * di `XRENTRIFORMULARI` si riporta solo il numero del FIR.
 *
 * `MUDAZ`/`MUDTERZI` stanno nel database MUD e hanno il loro parser nel pezzo I11.
 */
export interface ChiaveTabella {
  /** Colonne della chiave logica (devono essere nel manifest). */
  readonly chiave: readonly string[]
  /** Colonne che si possono riportare nel rapporto (codici, mai dati anagrafici). */
  readonly nelRapporto: readonly string[]
}

const PRECOD_COD: ChiaveTabella = { chiave: ['PRECOD', 'COD'], nelRapporto: ['PRECOD', 'COD'] }
const COD: ChiaveTabella = { chiave: ['COD'], nelRapporto: ['COD'] }

export const CHIAVI_TABELLE_ESTESE: Readonly<Record<string, ChiaveTabella>> = {
  CLIFOR: PRECOD_COD,
  'SEDI LEGALI': PRECOD_COD,
  'UNITA LOCALI': PRECOD_COD,
  AUTORIZZAZIONI: PRECOD_COD,
  AUTOMEZZI: PRECOD_COD,
  AUTISTI: PRECOD_COD,
  'MAGAZZINI RIFIUTI': PRECOD_COD,
  NUMERAZIONI: COD,
  RENrelazioniIniziali: { chiave: ['ID'], nelRapporto: ['ID'] },
  RENesportazioni: { chiave: ['ID'], nelRapporto: ['ID'] },
  XRENTRIFORMULARI: { chiave: ['CODICEFISCALE', 'NUMEROFIR'], nelRapporto: ['NUMEROFIR'] },
  XRENTRIFIRTRASMESSI: { chiave: ['IDRENTRI'], nelRapporto: ['IDRENTRI'] },
  CONTRATTI: PRECOD_COD,
  ELENCHIADDEB: PRECOD_COD,
  ADDEBCON: COD,
  ADDEBITI: COD,
  'CONDIZIONI DI PAGAMENTO': COD,
}

export async function parsaTabellaEstesa(
  tabella: string,
  sorgente: SorgenteRighe
): Promise<EsitoParser<RecordTabellaEstesa>> {
  const def = Object.prototype.hasOwnProperty.call(CHIAVI_TABELLE_ESTESE, tabella)
    ? CHIAVI_TABELLE_ESTESE[tabella]
    : undefined
  if (!def) throw new Error(`tabella non gestita dal parser esteso: ${tabella}`)
  const viste = new Map<string, number>()
  return parsaTabella<RecordTabellaEstesa>(tabella, sorgente, def.chiave, riga => {
    const t = (n: string): string => (riga.campi[n] ?? '').trim()
    const cod = def.nelRapporto.map(t).join('|')
    const vuote = def.chiave.filter(c => t(c) === '')
    if (vuote.length > 0) {
      return {
        cod,
        scarto: { codice: 'CHIAVE_VUOTA', dettaglio: `${vuote.join('+')}: obbligatorio` },
        avvisi: [],
      }
    }
    const chiave = def.chiave.map(t).join('|')
    // Confronto come sul server (collation CI) e con separatore che non puo' comparire nei valori.
    const chiaveUnica = def.chiave.map(c => t(c).toUpperCase()).join('\u0000')
    const prima = viste.get(chiaveUnica)
    if (prima !== undefined) {
      return {
        cod,
        scarto: {
          codice: 'CHIAVE_DUPLICATA',
          dettaglio: `${def.chiave.join('+')} gia presenti alla riga ${prima}`,
        },
        avvisi: [],
      }
    }
    viste.set(chiaveUnica, riga.numeroRiga)
    const campi: Record<string, string> = {}
    for (const [k, v] of Object.entries(riga.campi)) campi[k] = (v ?? '').trim()
    return { cod, avvisi: [], record: { tabella, riga: riga.numeroRiga, chiave, campi } }
  })
}
