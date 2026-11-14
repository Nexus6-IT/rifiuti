import type { AffidabilitaTracciato } from './tracciato-comunicazione'

/**
 * Manifest di una comunicazione a tracciato (D8, piano 4.9c-f): testo UTF-8 che accompagna il file,
 * perche' nel file non si puo' scrivere nulla di estraneo (un commento romperebbe un tracciato a
 * larghezza fissa). Dice che cosa e' il file, quanto ci si puo' fidare e che cosa e' stato assunto.
 * Funzione pura: stessi dati, stesso testo.
 */

export interface AvvisoManifest {
  codice: string
  messaggio: string
  /** Movimenti coinvolti, nella forma «giorno numero CER». */
  movimenti: string[]
}

export interface DatiManifest {
  consorzio: string
  tracciato: string
  versione: string
  affidabilita: AffidabilitaTracciato
  notaAffidabilita: string
  codifica: string
  nomeFile: string
  hashDati: string
  /** `AAAA-MM-GG`. */
  periodoDa: string
  periodoA: string
  sede: string
  /** `null` se i dati sono cambiati dopo la generazione e il numero non descrive piu' il file. */
  numeroRecord: number | null
  /** Istante ISO di generazione. */
  generataIl: string
  stato: 'GENERATA' | 'INVIATA'
  inviataIl?: string
  modificataDopoInvio: boolean
  /** Avvisi non bloccanti (i bloccanti impediscono di generare il file). */
  avvisi: AvvisoManifest[]
  /** Cose che WinWaste fa e WasteFlow ha scelto di non copiare. */
  differenzeDaWinWaste: string[]
  /** Valori assunti senza una specifica o un file reale: ognuno e' una costante da ri-verificare. */
  inferenze: string[]
}

const RIGA = '-'.repeat(72)

function elenco(titolo: string, voci: readonly string[], vuoto: string): string[] {
  return ['', titolo, ...(voci.length === 0 ? [`  ${vuoto}`] : voci.map(v => `  - ${v}`))]
}

export function costruisciManifest(d: DatiManifest): string {
  const ricavato = d.affidabilita === 'RICAVATO_WINWASTE'
  const righe: string[] = [
    `MANIFEST COMUNICAZIONE ${d.consorzio}`,
    RIGA,
    ...(ricavato
      ? [
          'ATTENZIONE: tracciato ricavato da WinWaste, da confermare con un file reale.',
          'Non esiste una specifica ufficiale verificata: prima di caricare il file sul portale',
          'controlla che il consorzio lo accetti.',
          '',
        ]
      : []),
    `File:             ${d.nomeFile}`,
    `Consorzio:        ${d.consorzio}`,
    `Tracciato:        ${d.tracciato}`,
    `Versione:         ${d.versione}`,
    `Affidabilita':    ${d.affidabilita}`,
    `Nota:             ${d.notaAffidabilita}`,
    `Codifica:         ${d.codifica}`,
    `Sede:             ${d.sede}`,
    `Periodo:          dal ${d.periodoDa} al ${d.periodoA}`,
    `Record nel file:  ${d.numeroRecord ?? 'non disponibile (dati cambiati dopo la generazione)'}`,
    `Hash dei dati:    ${d.hashDati}`,
    `Generato il:      ${d.generataIl}`,
    d.stato === 'INVIATA'
      ? `Stato:            INVIATA il ${d.inviataIl ?? '?'}${
          ricavato
            ? ' (conferma esplicita «Ho verificato che il consorzio accetta questo file» data al momento della segnatura)'
            : ''
        }`
      : 'Stato:            GENERATA (non ancora segnata come inviata)',
    ...(d.modificataDopoInvio
      ? [
          'ATTENZIONE: i dati sono cambiati dopo l’invio; il file inviato non e’ piu’ quello attuale.',
        ]
      : []),
    ...elenco(
      'Avvisi non bloccanti:',
      d.avvisi.map(
        a =>
          `${a.codice}: ${a.messaggio}${a.movimenti.length > 0 ? ` [${a.movimenti.join('; ')}]` : ''}`
      ),
      'nessuno'
    ),
    ...elenco('Differenze volute rispetto a WinWaste:', d.differenzeDaWinWaste, 'nessuna'),
    ...elenco('Inferenze usate (da ri-verificare con un file reale):', d.inferenze, 'nessuna'),
    '',
  ]
  return righe.join('\n')
}
