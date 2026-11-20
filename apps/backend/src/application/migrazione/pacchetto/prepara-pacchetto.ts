/**
 * `migrazione:prepara`, parte pura: staging + mappa -> pacchetto. Niente Prisma ne' NestJS: gira sulla
 * workstation, sui dati del cliente, senza database.
 *
 * Fasi prodotte oggi: ANAGRAFICHE/ditte (da CLIFOR, con dedup per P.IVA o CF e agganci della mappa).
 * Le altre fasi (sedi, ruoli, FIR, registro, giacenze) si aggiungono qui con i pezzi I4-I7: il
 * formato non cambia.
 *
 * Scarti: tipati e contati per tabella e codice, mai con valori. Un duplicato e' SEGNALATO (scarto
 * `DITTA_DUPLICATA`), mai fuso in silenzio.
 */
import { chiaveDitta } from '../../../domain/migrazione/chiavi-legacy'
import { ElementoLettura, StagingAperto } from '../staging/lettore-staging'
import { PacchettoError } from './errori-pacchetto'
import { ManifestPacchetto } from './manifest-pacchetto'
import { MappaImport, partitaIvaItalianaValida } from './mappa-import'
import { codiceFiscaleFormaValida, RecordDitta } from './record-ditta'
import { scriviPacchetto } from './scrittore-pacchetto'

export type CodiceScartoPrepara =
  | 'RIGA_ILLEGGIBILE'
  | 'FISCALE_ASSENTE'
  | 'PARTITA_IVA_NON_VALIDA'
  | 'CODICE_FISCALE_NON_VALIDO'
  | 'RAGIONE_SOCIALE_ASSENTE'
  | 'DITTA_DUPLICATA'

export interface RapportoPrepara {
  readonly manifest: ManifestPacchetto
  readonly scarti: ReadonlyArray<{
    tabella: string
    codice: CodiceScartoPrepara
    conteggio: number
  }>
  /** Ditte gia' presenti in WasteFlow (agganci della mappa): non vanno nel pacchetto. */
  readonly agganciate: number
  /** Righe CLIFOR scartate come duplicate, con quella tenuta: chiavi `ditta|PRECOD|COD`, mai valori. */
  readonly duplicati: ReadonlyArray<{ scartata: string; tenuta: string }>
}

function ragioneSociale(c: Readonly<Record<string, string | null>>): string {
  return [c.DES, c.EST]
    .map(v => (v ?? '').trim())
    .filter(v => v.length > 0)
    .join(' ')
    .slice(0, 255)
}

async function* ditte(
  staging: StagingAperto,
  mappa: MappaImport,
  conta: (codice: CodiceScartoPrepara) => void,
  agganciata: () => void,
  duplicata: (scartata: string, tenuta: string) => void
): AsyncGenerator<RecordDitta> {
  // Un soggetto puo' comparire piu' volte (cliente e fornitore) con P.IVA e/o CF diversi: la ditta
  // e' la stessa se coincide UNA delle due identita' fiscali.
  // Un solo spazio per P.IVA e CF: un'identita' fiscale usata come P.IVA in una riga e come CF
  // (numerico, 11 cifre) in un'altra e' la stessa ditta. Valore = chiave CLIFOR della riga tenuta.
  const viste = new Map<string, string>()
  const agganci = new Set(mappa.agganci.map(a => a.partitaIva))
  for await (const el of staging.leggi('CLIFOR') as AsyncGenerator<ElementoLettura>) {
    if (el.tipo === 'scarto') {
      conta('RIGA_ILLEGGIBILE')
      continue
    }
    const c = el.riga.campi
    const piva = (c.PIVA ?? '').trim()
    const cf = (c.CODFIS ?? '').trim().toUpperCase()
    const rs = ragioneSociale(c)
    if (rs === '') {
      conta('RAGIONE_SOCIALE_ASSENTE')
      continue
    }
    if (piva === '' && cf === '') {
      conta('FISCALE_ASSENTE')
      continue
    }
    if (piva !== '' && !partitaIvaItalianaValida(piva)) {
      conta('PARTITA_IVA_NON_VALIDA')
      continue
    }
    if (cf !== '' && !codiceFiscaleFormaValida(cf)) {
      conta('CODICE_FISCALE_NON_VALIDO')
      continue
    }
    const fiscale = piva !== '' ? piva : cf
    const chiave = chiaveDitta(mappa.ditta, fiscale)
    const chiaveRiga = `${mappa.ditta}|${(c.PRECOD ?? '').trim()}|${(c.COD ?? '').trim()}`
    const tenuta =
      (piva !== '' ? viste.get(piva) : undefined) ?? (cf !== '' ? viste.get(cf) : undefined)
    if (tenuta !== undefined) {
      conta('DITTA_DUPLICATA')
      duplicata(chiaveRiga, tenuta)
      continue
    }
    if (piva !== '') viste.set(piva, chiaveRiga)
    if (cf !== '') viste.set(cf, chiaveRiga)
    if (piva !== '' && agganci.has(piva)) {
      agganciata()
      continue
    }
    yield {
      legacyKey: chiave,
      ragioneSociale: rs,
      partitaIva: piva || null,
      codiceFiscale: cf || null,
    }
  }
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
  const conteggi = new Map<CodiceScartoPrepara, number>()
  let agganciate = 0
  const duplicati: Array<{ scartata: string; tenuta: string }> = []
  const manifest = await scriviPacchetto({
    cartella: cartellaPacchetto,
    archivio: staging.archivio,
    hashStaging: staging.hashManifest,
    mappa,
    fasi: [
      {
        ambito: 'ANAGRAFICHE',
        fase: 'ditte',
        record: ditte(
          staging,
          mappa,
          codice => conteggi.set(codice, (conteggi.get(codice) ?? 0) + 1),
          () => agganciate++,
          (scartata, tenuta) => duplicati.push({ scartata, tenuta })
        ),
      },
    ],
  })
  return {
    manifest,
    agganciate,
    duplicati,
    scarti: [...conteggi.entries()].map(([codice, conteggio]) => ({
      tabella: 'CLIFOR',
      codice,
      conteggio,
    })),
  }
}
