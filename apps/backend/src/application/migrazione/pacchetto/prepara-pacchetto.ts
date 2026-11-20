/**
 * `migrazione:prepara`, parte pura: staging + mappa -> pacchetto. Niente Prisma ne' NestJS: gira sulla
 * workstation, sui dati del cliente, senza database.
 *
 * Fasi prodotte: ANAGRAFICHE/ditte (da CLIFOR, con dedup per P.IVA o CF e agganci della mappa) e, dal
 * pezzo I4, sedi, produttori, trasportatori, destinatari e automezzi (vedi `prepara-anagrafiche.ts`).
 * Le fasi vuote non vengono scritte (tranne `ditte`). Le altre fasi (FIR, registro, giacenze) si
 * aggiungono qui con i pezzi I5-I7: il formato non cambia.
 *
 * Scarti: tipati e contati per tabella e codice, mai con valori. Un duplicato e' SEGNALATO, mai fuso
 * in silenzio.
 */
import { StagingAperto } from '../staging/lettore-staging'
import { PacchettoError } from './errori-pacchetto'
import { ManifestPacchetto } from './manifest-pacchetto'
import { MappaImport } from './mappa-import'
import {
  CodiceAvvisoPrepara,
  CodiceScartoPrepara,
  preparaAnagrafiche,
  VoceConteggio,
} from './prepara-anagrafiche'
import { FaseDaScrivere, scriviPacchetto } from './scrittore-pacchetto'

export type { CodiceAvvisoPrepara, CodiceScartoPrepara }

export interface RapportoPrepara {
  readonly manifest: ManifestPacchetto
  readonly scarti: ReadonlyArray<VoceConteggio<CodiceScartoPrepara>>
  /** Scelte dedotte e note che non sono scarti: da controllare con l'operatore. */
  readonly avvisi: ReadonlyArray<VoceConteggio<CodiceAvvisoPrepara>>
  /** Ditte gia' presenti in WasteFlow (agganci della mappa): non vanno nel pacchetto. */
  readonly agganciate: number
  /** Righe scartate come duplicate, con quella tenuta: chiavi legacy, mai valori. `tabella` assente = CLIFOR. */
  readonly duplicati: ReadonlyArray<{ tabella?: string; scartata: string; tenuta: string }>
}

/**
 * @param cartellaPacchetto cartella finale, col nome dell'archivio (`.../WW00012026`)
 * @throws PacchettoError `MAPPA_DIVERSA` se ditta o anno della mappa non sono quelli dello staging
 */
export async function preparaPacchetto(
  staging: StagingAperto,
  mappa: MappaImport,
  cartellaPacchetto: string
): Promise<RapportoPrepara> {
  if (staging.manifest.ditta !== mappa.ditta || staging.manifest.anno !== mappa.anno) {
    throw new PacchettoError(
      'MAPPA_DIVERSA',
      'ditta o anno della mappa non coincidono con quelli dello staging'
    )
  }
  if (!staging.ha('CLIFOR'))
    throw new PacchettoError('FILE_ASSENTE', 'lo staging non contiene CLIFOR')
  const r = await preparaAnagrafiche(staging, mappa)
  const fasi: FaseDaScrivere[] = [
    { ambito: 'ANAGRAFICHE', fase: 'ditte', record: r.ditte },
    ...(
      [
        ['sedi', r.sedi],
        ['produttori', r.produttori],
        ['trasportatori', r.trasportatori],
        ['destinatari', r.destinatari],
        ['automezzi', r.automezzi],
      ] as const
    )
      .filter(([, record]) => record.length > 0)
      .map(([fase, record]) => ({ ambito: 'ANAGRAFICHE' as const, fase, record })),
  ]
  const manifest = await scriviPacchetto({
    cartella: cartellaPacchetto,
    archivio: staging.archivio,
    hashStaging: staging.hashManifest,
    mappa,
    fasi,
  })
  return {
    manifest,
    agganciate: r.agganciate,
    duplicati: r.duplicati,
    scarti: r.scarti,
    avvisi: r.avvisi,
  }
}
