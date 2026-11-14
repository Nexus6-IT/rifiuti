import { RecordVersis } from '../../../../domain/migrazione/winwaste/record'
import { EsitoParser, parsaTabella, SorgenteRighe } from './scarti'

/**
 * Parser di `VERSIS` (riuso della vecchia tabella SISTRI per gli identificativi
 * RENTRI, `docs/rentri/03-aggancio-a-winwaste.md` §2.2). Prefissi: `XRENTRI:`
 * (id del registro o numero di iscrizione del sito), `XRENATS:`, `XRENOPW:`,
 * `HUBRW:`/`HUBRP:`/`HUBRD:`/`HUBWW` (hub: `C1` host, `C2` utente, `C3` password
 * cifrata, `C4` licenza), `FIRMARENTRI<CF>`.
 *
 * SICUREZZA: `C1..C5` NON vengono mai letti in nessuna riga: contengono
 * segreti. Sono `sensibili` tutte le righe tranne `XRENTRI/XRENATS/XRENOPW`.
 * Scarti: `COD_VUOTO`, `COD_DUPLICATO`.
 */
const RICHIESTE = ['COD']
/** Prefissi non sensibili (identificativi RENTRI pubblici). Tutto il resto e' sensibile. */
const NON_SENSIBILI: readonly string[] = ['XRENTRI', 'XRENATS', 'XRENOPW']
/** Prefissi sensibili noti: configurazione hub (HUBRW produzione RENTRI, HUBRP/HUBRD/HUBWW) e firma. */
const SENSIBILI_NOTI: readonly string[] = ['HUBRW', 'HUBRP', 'HUBRD', 'HUBWW', 'FIRMARENTRI']

/**
 * Prefisso del COD come insieme CHIUSO: mai testo preso dal valore (la chiave
 * `FIRMARENTRI<CF>` non ha separatore e un prefisso "per lettere" conterrebbe
 * parte del codice fiscale). Prefisso sconosciuto -> `(altro)`; COD che non
 * inizia per lettera -> stringa vuota.
 */
export function prefissoVersis(cod: string): string {
  if (!/^[A-Za-z]/.test(cod)) return ''
  const testa = cod.split(':')[0].toUpperCase()
  return [...NON_SENSIBILI, ...SENSIBILI_NOTI].find(k => testa.startsWith(k)) ?? '(altro)'
}

export async function parsaVersis(sorgente: SorgenteRighe): Promise<EsitoParser<RecordVersis>> {
  const viste = new Set<string>()
  return parsaTabella<RecordVersis>('VERSIS', sorgente, RICHIESTE, riga => {
    const t = (n: string): string => (riga.campi[n] ?? '').trim()
    const cod = t('COD')
    if (cod === '') {
      return { cod, scarto: { codice: 'COD_VUOTO', dettaglio: 'COD: obbligatorio' }, avvisi: [] }
    }
    if (viste.has(cod)) {
      return {
        cod,
        scarto: { codice: 'COD_DUPLICATO', dettaglio: 'COD gia presente nella tabella' },
        avvisi: [],
      }
    }
    viste.add(cod)
    const prefisso = prefissoVersis(cod)
    const sensibile = prefisso !== '' && !NON_SENSIBILI.includes(prefisso)
    // Una chiave sensibile puo' contenere un codice fiscale: si conserva solo il prefisso.
    const codNoto = sensibile ? prefisso : cod
    return {
      cod: codNoto,
      avvisi: [],
      record: {
        tabella: 'VERSIS',
        riga: riga.numeroRiga,
        cod: codNoto,
        prefisso,
        idsis: t('IDSIS'),
        versis: t('VERSIS'),
        vertot: t('VERTOT'),
        sensibile,
      },
    }
  })
}
