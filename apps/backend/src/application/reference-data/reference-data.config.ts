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
  /** File CSV bundled (in prisma/reference-data/) usato se `url` non e' configurato. */
  localFile: string | null
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
  const src = (key: string, localFile: string | null = null, sep = ';'): DatasetSource => ({
    url: config.get<string>(key) || null,
    localFile,
    separator: config.get<string>(`${key}_SEP`) || sep,
    hasHeader: config.get<string>(`${key}_HEADER`) !== 'false',
  })

  return {
    // ATECO/nazioni: nessun bundle (fonte ufficiale non stabile) → configurare via URL.
    ateco: src('REFDATA_ATECO_URL'),
    nazioni: src('REFDATA_NAZIONI_URL'),
    // Province/comuni: bundle CSV in repo (dati ISTAT) come fallback offline e deterministico.
    province: src('REFDATA_PROVINCE_URL', 'province.csv'),
    comuni: src('REFDATA_COMUNI_URL', 'comuni.csv'),
    seedOnBootIfEmpty: config.get<string>('REFDATA_SEED_ON_BOOT') !== 'false',
  }
}
