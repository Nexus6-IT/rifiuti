import { decodificaOper } from '../../../../domain/migrazione/winwaste/oper'
import { RecordCausaleRifiuti } from '../../../../domain/migrazione/winwaste/record'
import { EsitoParser, parsaTabella, SorgenteRighe } from './scarti'

/**
 * Parser di `[CAUSALI RIFIUTI]` (`docs/movimenti.md` §2.3, schema reale in
 * `docs/schema-db-winwaste.md` §6: 20 colonne). `OPER` di un movimento =
 * `TIP` + `OPE` della causale (§2.4).
 * Scarti: `COD_VUOTO`, `COD_DUPLICATO`, `OPER_SCONOSCIUTO`.
 */
const RICHIESTE = ['COD', 'DES', 'TIP', 'OPE']

export async function parsaCausaliRifiuti(
  sorgente: SorgenteRighe
): Promise<EsitoParser<RecordCausaleRifiuti>> {
  const viste = new Set<string>()
  return parsaTabella<RecordCausaleRifiuti>('CAUSALI RIFIUTI', sorgente, RICHIESTE, riga => {
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
    const oper = decodificaOper(t('TIP') + t('OPE'))
    if (!oper.ok) {
      return {
        cod,
        scarto: { codice: oper.codice, dettaglio: `TIP+OPE: ${oper.dettaglio}` },
        avvisi: [],
      }
    }
    return {
      cod,
      avvisi: [],
      record: {
        tabella: 'CAUSALI RIFIUTI',
        riga: riga.numeroRiga,
        cod,
        descrizione: t('DES'),
        tip: t('TIP'),
        ope: t('OPE'),
        oper: oper.valore,
        flag: { cura: t('CURA'), reg: t('REG'), mud: t('MUD'), fatt: t('FATT'), cost: t('COST') },
        posiz: riga.campi['POSIZ'] ?? '',
        avanz: riga.campi['AVANZ'] ?? '',
      },
    }
  })
}
