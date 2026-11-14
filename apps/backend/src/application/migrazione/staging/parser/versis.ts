import { RecordVersis } from '../../../../domain/migrazione/winwaste/record'
import { EsitoParser, parsaTabella, SorgenteRighe } from './scarti'

/**
 * Parser di `VERSIS` (riuso della vecchia tabella SISTRI per gli identificativi
 * RENTRI, `docs/rentri/03-aggancio-a-winwaste.md` §2.2). Prefissi: `XRENTRI:`
 * (id del registro o numero di iscrizione del sito), `XRENATS:`, `XRENOPW:`,
 * `HUBRW:` (hub: `C1` host, `C2` utente, `C3` password cifrata, `C4` licenza),
 * `FIRMARENTRI`.
 *
 * SICUREZZA: `C1..C5` NON vengono mai letti in nessuna riga: contengono
 * segreti. Le righe `HUBRW:*` e `FIRMARENTRI*` sono marcate `sensibile`.
 * Scarti: `COD_VUOTO`, `COD_DUPLICATO`.
 */
const RICHIESTE = ['COD']
const SENSIBILI = new Set(['HUBRW', 'FIRMARENTRI'])

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
    const prefisso = /^[A-Za-z]+/.exec(cod)?.[0] ?? ''
    return {
      cod,
      avvisi: [],
      record: {
        tabella: 'VERSIS',
        riga: riga.numeroRiga,
        cod,
        prefisso,
        idsis: t('IDSIS'),
        versis: t('VERSIS'),
        vertot: t('VERTOT'),
        sensibile: SENSIBILI.has(prefisso.toUpperCase()),
      },
    }
  })
}
