import { ConfigService } from '@nestjs/config'

/**
 * Configurazione delle sorgenti dati di riferimento (CSV ufficiali).
 *
 * Gli URL sono configurabili via env perché i file ISTAT/ATECO cambiano nel
 * tempo. Se un URL non è configurato il relativo dataset viene saltato dal
 * seeder (nessun errore). Le sorgenti ufficiali sono documentate nei default.
 *
 * Sorgenti ufficiali (da configurare in prod):
 *  - ISTAT Comuni: elenco comuni italiani (CSV `;`) — istat.it
 *  - ISTAT Province / Nazioni: codici statistici ISTAT
 *  - ATECO 2007 (agg. 2022): classificazione attività economiche ISTAT
 */
export interface DatasetSource {
  url: string | null
  separator: string
  hasHeader: boolean
}

export interface ReferenceDataConfig {
  ateco: DatasetSource
  nazioni: DatasetSource
  province: DatasetSource
  comuni: DatasetSource
  /** Esegui il seed all'avvio se le tabelle sono vuote. */
  seedOnBootIfEmpty: boolean
}

export const REFERENCE_DATA_CONFIG = Symbol('REFERENCE_DATA_CONFIG')

export function loadReferenceDataConfig(config: ConfigService): ReferenceDataConfig {
  const src = (key: string, sep = ';'): DatasetSource => ({
    url: config.get<string>(key) || null,
    separator: config.get<string>(`${key}_SEP`) || sep,
    hasHeader: config.get<string>(`${key}_HEADER`) !== 'false',
  })

  return {
    ateco: src('REFDATA_ATECO_URL'),
    nazioni: src('REFDATA_NAZIONI_URL'),
    province: src('REFDATA_PROVINCE_URL'),
    comuni: src('REFDATA_COMUNI_URL'),
    seedOnBootIfEmpty: config.get<string>('REFDATA_SEED_ON_BOOT') !== 'false',
  }
}
