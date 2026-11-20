/**
 * `migrazione:prepara`, parte pura: staging + mappa -> pacchetto. Niente Prisma ne' NestJS: gira sulla
 * workstation, sui dati del cliente, senza database.
 *
 * Fasi prodotte: ANAGRAFICHE/ditte (da CLIFOR, con dedup per P.IVA o CF e agganci della mappa) e, dal
 * pezzo I4, sedi, produttori, trasportatori, destinatari e automezzi (vedi `prepara-anagrafiche.ts`).
 * Dal pezzo I5, ambito FIR: `fir` e `fir-digitali` (vedi `prepara-fir.ts`). Le fasi vuote non vengono
 * scritte (tranne `ditte`). Dal pezzo I6, ambito GIACENZE: `giacenze` (vedi `prepara-giacenze.ts`).
 * Il registro (I7) si aggiunge qui: il formato non cambia.
 *
 * Scarti: tipati e contati per tabella e codice, mai con valori. Un duplicato e' SEGNALATO, mai fuso
 * in silenzio.
 */
import { StagingAperto } from '../staging/lettore-staging'
import { PacchettoError } from './errori-pacchetto'
import { ManifestPacchetto } from './manifest-pacchetto'
import { MappaImport } from './mappa-import'
import { CodiceAvvisoFir, preparaFir } from './prepara-fir'
import { CodiceAvvisoGiacenze, preparaGiacenze } from './prepara-giacenze'
import type { DifferenzaGiascar } from '../../../domain/migrazione/winwaste/giacenze-taglio'
import {
  CodiceAvvisoPrepara,
  CodiceScartoPrepara,
  preparaAnagrafiche,
  VoceConteggio,
} from './prepara-anagrafiche'
import { FaseDaScrivere, scriviPacchetto } from './scrittore-pacchetto'

export type { CodiceAvvisoFir, CodiceAvvisoGiacenze, CodiceAvvisoPrepara, CodiceScartoPrepara }

export interface RapportoPrepara {
  readonly manifest: ManifestPacchetto
  readonly scarti: ReadonlyArray<VoceConteggio<CodiceScartoPrepara | string>>
  /** Scelte dedotte e note che non sono scarti: da controllare con l'operatore. */
  readonly avvisi: ReadonlyArray<
    VoceConteggio<CodiceAvvisoPrepara | CodiceAvvisoFir | CodiceAvvisoGiacenze>
  >
  /**
   * Carichi per cui `GIASCAR` non coincide col ricalcolo da `RELAZ` (>= 0,001 kg): `COD` del carico e
   * i due valori in kg. Vanno al cliente insieme al rapporto; mai corretti in silenzio.
   */
  readonly differenzeGiascar: readonly DifferenzaGiascar[]
  /**
   * FIR digitali: non copiati, da riacquisire da RENTRI (`migrazione:riacquisisci-fir`). Numero e
   * IDRENTRI sono identificativi dell'ente, non dati personali.
   */
  readonly firDigitali: ReadonlyArray<{ numero: string; idRentri: string | null }>
  /** FIR senza peso a destino: bloccanti per il caricamento (numero FIR e chiave CLIFOR, nessun dato personale). */
  readonly firSenzaPeso: ReadonlyArray<{ numero: string; produttoreKey: string | null }>
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
  const f = await preparaFir(staging, mappa, r)
  const g = await preparaGiacenze(staging, mappa)
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
    ...(
      [
        ['fir', f.fir],
        ['fir-digitali', f.firDigitali],
        ['fir-senza-peso', f.firSenzaPeso],
      ] as const
    )
      .filter(([, record]) => record.length > 0)
      .map(([fase, record]) => ({ ambito: 'FIR' as const, fase, record })),
    ...(g.giacenze.length > 0
      ? [{ ambito: 'GIACENZE' as const, fase: 'giacenze', record: g.giacenze }]
      : []),
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
    scarti: [...r.scarti, ...f.scarti, ...g.scarti],
    avvisi: [...r.avvisi, ...f.avvisi, ...g.avvisi],
    differenzeGiascar: g.differenzeGiascar,
    firDigitali: f.firDigitali.map(d => ({ numero: d.numeroFir, idRentri: d.idRentri })),
    firSenzaPeso: f.firSenzaPeso.map(d => ({
      numero: d.firNumber,
      produttoreKey: d.produttoreKey,
    })),
  }
}
