/**
 * Registro delle fasi di ogni ambito del pacchetto: per ciascuna, come si rivalida un record (il
 * pacchetto non e' fidato), come si scrive un blocco e quali collisioni controlla `--verifica`.
 * Oggi: ANAGRAFICHE (ditte, sedi, produttori, trasportatori, destinatari, automezzi), FIR (I5: `fir`) e
 * GIACENZE (I6: `giacenze`). Il pezzo I7 aggiunge qui il registro. L'ORDINE delle fasi e' quello dell'elenco: le parti
 * si legano per chiave legacy, quindi ditte -> sedi -> ruoli -> automezzi.
 */
import type { AmbitoPacchetto } from '../pacchetto/manifest-pacchetto'
import type { MappaImport } from '../pacchetto/mappa-import'
import {
  RecordAutomezzo,
  RecordDestinatario,
  RecordProduttore,
  RecordSede,
  RecordTrasportatore,
  validaRecordAutomezzo,
  validaRecordDestinatario,
  validaRecordProduttore,
  validaRecordSede,
  validaRecordTrasportatore,
} from '../pacchetto/record-anagrafiche'
import { RecordDitta, validaRecordDitta } from '../pacchetto/record-ditta'
import { RecordFir, validaRecordFir } from '../pacchetto/record-fir'
import { RecordGiacenza, validaRecordGiacenza } from '../pacchetto/record-giacenze'
import {
  inserisciAutomezzi,
  inserisciDestinatari,
  inserisciProduttori,
  inserisciSedi,
  inserisciTrasportatori,
} from './inserisci-anagrafiche'
import { inserisciDitte } from './inserisci-ditte'
import { inserisciFir } from './inserisci-fir'
import { cerDelCatalogo, famiglieOccupate, inserisciGiacenze } from './inserisci-giacenze'
import type { InserisciBlocco, Tx } from './tipi'

export interface Collisione {
  readonly codice: string
  readonly conteggio: number
}

export interface DefinizioneFase<R = unknown> {
  readonly nome: string
  readonly valida: (grezzo: unknown, mappa: MappaImport) => R
  readonly inserisciBlocco: InserisciBlocco<R>
  /**
   * Solo LETTURE nella transazione `tx` (read-only, nel contesto dell'azienda): collisioni che
   * farebbero fallire il caricamento. Restituisce solo conteggi.
   */
  readonly collisioni: (
    tx: Tx,
    tenantId: string,
    righe: readonly R[]
  ) => Promise<{ collisioni: Collisione[]; giaCaricate: number }>
}

/** Righe del pacchetto che condividono P.IVA o codice fiscale con un'altra riga (violerebbero gli unici). */
function duplicatiNelPacchetto(righe: readonly RecordDitta[]): number {
  const piva = new Set<string>()
  const cf = new Set<string>()
  const chiavi = new Set<string>()
  let doppie = 0
  for (const r of righe) {
    const dup =
      chiavi.has(r.legacyKey) ||
      (r.partitaIva !== null && piva.has(r.partitaIva)) ||
      (r.codiceFiscale !== null && cf.has(r.codiceFiscale))
    if (dup) doppie++
    chiavi.add(r.legacyKey)
    if (r.partitaIva !== null) piva.add(r.partitaIva)
    if (r.codiceFiscale !== null) cf.add(r.codiceFiscale)
  }
  return doppie
}

async function collisioniDitte(tx: Tx, tenantId: string, righe: readonly RecordDitta[]) {
  const chiavi = righe.map(r => r.legacyKey)
  const piva = righe.map(r => r.partitaIva).filter((v): v is string => v !== null)
  const cf = righe.map(r => r.codiceFiscale).filter((v): v is string => v !== null)
  const [carico] = await tx.$queryRaw<Array<{ n: bigint }>>`
    SELECT count(*)::bigint AS n FROM "ditte"
    WHERE "tenant_id" = ${tenantId}::uuid AND "import_source" = 'WINWASTE' AND "legacy_key" = ANY(${chiavi}::text[])`
  const [p] = await tx.$queryRaw<Array<{ n: bigint }>>`
    SELECT count(*)::bigint AS n FROM "ditte"
    WHERE "tenant_id" = ${tenantId}::uuid AND "partita_iva" = ANY(${piva}::text[])
      AND ("import_source" IS DISTINCT FROM 'WINWASTE' OR "legacy_key" <> ALL(${chiavi}::text[]))`
  const [c] = await tx.$queryRaw<Array<{ n: bigint }>>`
    SELECT count(*)::bigint AS n FROM "ditte"
    WHERE "tenant_id" = ${tenantId}::uuid AND "codice_fiscale" = ANY(${cf}::text[])
      AND ("import_source" IS DISTINCT FROM 'WINWASTE' OR "legacy_key" <> ALL(${chiavi}::text[]))`
  const out: Collisione[] = []
  const doppie = duplicatiNelPacchetto(righe)
  if (doppie > 0) out.push({ codice: 'DUPLICATO_NEL_PACCHETTO', conteggio: doppie })
  if (Number(p.n) > 0)
    out.push({ codice: 'PARTITA_IVA_GIA_PRESENTE_NON_AGGANCIATA', conteggio: Number(p.n) })
  if (Number(c.n) > 0)
    out.push({ codice: 'CODICE_FISCALE_GIA_PRESENTE_NON_AGGANCIATO', conteggio: Number(c.n) })
  return { collisioni: out, giaCaricate: Number(carico.n) }
}

/** Righe che usano la stessa chiave legacy piu' volte (violerebbero l'unico parziale). */
function chiaviRipetute(chiavi: readonly string[]): number {
  return chiavi.length - new Set(chiavi).size
}

type TabellaConProvenienza =
  | 'sedi_ditte'
  | 'produttori'
  | 'trasportatori'
  | 'destinatari'
  | 'automezzi'

/** Quante delle chiavi sono gia' nel database come importate (la riesecuzione le salta). */
async function giaCaricate(
  tx: Tx,
  tabella: TabellaConProvenienza,
  tenantId: string,
  chiavi: string[]
): Promise<number> {
  // Una query per tabella (nomi fissi, SQL parametrizzato).
  const [r] =
    tabella === 'sedi_ditte'
      ? await tx.$queryRaw<Array<{ n: bigint }>>`
          SELECT count(*)::bigint AS n FROM "sedi_ditte" WHERE "tenant_id" = ${tenantId}::uuid
            AND "import_source" = 'WINWASTE' AND "legacy_key" = ANY(${chiavi}::text[])`
      : tabella === 'produttori'
        ? await tx.$queryRaw<Array<{ n: bigint }>>`
          SELECT count(*)::bigint AS n FROM "produttori" WHERE "tenant_id" = ${tenantId}::uuid
            AND "import_source" = 'WINWASTE' AND "legacy_key" = ANY(${chiavi}::text[])`
        : tabella === 'trasportatori'
          ? await tx.$queryRaw<Array<{ n: bigint }>>`
          SELECT count(*)::bigint AS n FROM "trasportatori" WHERE "tenant_id" = ${tenantId}::uuid
            AND "import_source" = 'WINWASTE' AND "legacy_key" = ANY(${chiavi}::text[])`
          : tabella === 'destinatari'
            ? await tx.$queryRaw<Array<{ n: bigint }>>`
          SELECT count(*)::bigint AS n FROM "destinatari" WHERE "tenant_id" = ${tenantId}::uuid
            AND "import_source" = 'WINWASTE' AND "legacy_key" = ANY(${chiavi}::text[])`
            : await tx.$queryRaw<Array<{ n: bigint }>>`
          SELECT count(*)::bigint AS n FROM "automezzi" WHERE "tenant_id" = ${tenantId}::uuid
            AND "import_source" = 'WINWASTE' AND "legacy_key" = ANY(${chiavi}::text[])`
  return Number(r.n)
}

function collisioniPerChiavi(tabella: TabellaConProvenienza) {
  return async (tx: Tx, tenantId: string, righe: ReadonlyArray<{ legacyKey: string }>) => {
    const chiavi = righe.map(r => r.legacyKey)
    const out: Collisione[] = []
    const doppie = chiaviRipetute(chiavi)
    if (doppie > 0) out.push({ codice: 'DUPLICATO_NEL_PACCHETTO', conteggio: doppie })
    return { collisioni: out, giaCaricate: await giaCaricate(tx, tabella, tenantId, chiavi) }
  }
}

/** Una targa gia' in azienda (non importata da questo pacchetto) violerebbe l'unico `automezzi_targhe_uniche`. */
async function collisioniAutomezzi(tx: Tx, tenantId: string, righe: readonly RecordAutomezzo[]) {
  const base = await collisioniPerChiavi('automezzi')(tx, tenantId, righe)
  const targhe = righe.map(r => r.targa)
  const chiavi = righe.map(r => r.legacyKey)
  const [occupate] = await tx.$queryRaw<Array<{ n: bigint }>>`
    SELECT count(*)::bigint AS n FROM "automezzi"
    WHERE "tenant_id" = ${tenantId}::uuid AND "targa" = ANY(${targhe}::text[])
      AND COALESCE("targa_rimorchio", '') = ''
      AND ("import_source" IS DISTINCT FROM 'WINWASTE' OR "legacy_key" <> ALL(${chiavi}::text[]))`
  const out = [...base.collisioni]
  if (new Set(targhe).size !== targhe.length)
    out.push({
      codice: 'TARGA_RIPETUTA_NEL_PACCHETTO',
      conteggio: targhe.length - new Set(targhe).size,
    })
  if (Number(occupate.n) > 0)
    out.push({ codice: 'TARGA_GIA_PRESENTE_NON_IMPORTATA', conteggio: Number(occupate.n) })
  return { collisioni: out, giaCaricate: base.giaCaricate }
}

/**
 * Collisioni dei FIR. `firNumber` e' quello di WinWaste e non si rinomina MAI: un numero gia' in
 * azienda (non importato da questo pacchetto) o ripetuto nel pacchetto e' BLOCCANTE. I riferimenti a
 * ditte e sedi devono gia' essere nel database (ANAGRAFICHE caricate prima, o ditta agganciata).
 */
async function collisioniFir(tx: Tx, tenantId: string, righe: readonly RecordFir[]) {
  const chiavi = righe.map(r => r.legacyKey)
  const numeri = righe.map(r => r.firNumber)
  const out: Collisione[] = []
  const doppie = chiaviRipetute(chiavi)
  if (doppie > 0) out.push({ codice: 'DUPLICATO_NEL_PACCHETTO', conteggio: doppie })
  const ripetuti = chiaviRipetute(numeri)
  if (ripetuti > 0) out.push({ codice: 'FIR_NUMBER_DUPLICATO_NEL_PACCHETTO', conteggio: ripetuti })
  const [carico] = await tx.$queryRaw<Array<{ n: bigint }>>`
    SELECT count(*)::bigint AS n FROM "firs"
    WHERE "tenant_id" = ${tenantId}::uuid AND "import_source" = 'WINWASTE'
      AND "legacy_key" = ANY(${chiavi}::text[])`
  const [occupati] = await tx.$queryRaw<Array<{ n: bigint }>>`
    SELECT count(*)::bigint AS n FROM "firs"
    WHERE "tenant_id" = ${tenantId}::uuid AND "fir_number" = ANY(${numeri}::text[])
      AND ("import_source" IS DISTINCT FROM 'WINWASTE' OR "legacy_key" <> ALL(${chiavi}::text[]))`
  if (Number(occupati.n) > 0)
    out.push({ codice: 'FIR_NUMBER_GIA_PRESENTE', conteggio: Number(occupati.n) })

  const parti = righe.flatMap(r => [r.produttore, r.trasportatore, r.destinatario])
  const dittaKeys = new Set<string>()
  const sedi = new Set<string>()
  for (const p of parti) {
    if (p === null || p.tipo !== 'ditta') continue
    if (p.dittaId === null) dittaKeys.add(p.dittaKey)
    if (p.sedeKey !== null) sedi.add(p.sedeKey)
  }
  if (dittaKeys.size > 0) {
    const [d] = await tx.$queryRaw<Array<{ n: bigint }>>`
      SELECT count(*)::bigint AS n FROM "ditte"
      WHERE "tenant_id" = ${tenantId}::uuid AND "import_source" = 'WINWASTE'
        AND "legacy_key" = ANY(${[...dittaKeys]}::text[])`
    const mancanti = dittaKeys.size - Number(d.n)
    if (mancanti > 0) out.push({ codice: 'RIFERIMENTO_DITTA_NON_CARICATO', conteggio: mancanti })
  }
  if (sedi.size > 0) {
    const [d] = await tx.$queryRaw<Array<{ n: bigint }>>`
      SELECT count(DISTINCT "legacy_key")::bigint AS n FROM "sedi_ditte"
      WHERE "tenant_id" = ${tenantId}::uuid AND "import_source" = 'WINWASTE'
        AND "legacy_key" = ANY(${[...sedi]}::text[])`
    const mancanti = sedi.size - Number(d.n)
    if (mancanti > 0) out.push({ codice: 'RIFERIMENTO_SEDE_NON_CARICATO', conteggio: mancanti })
  }
  return { collisioni: out, giaCaricate: Number(carico.n) }
}

/**
 * Collisioni delle giacenze iniziali. Una famiglia (registro, CER, stato fisico, unita' kg/t) gia' in
 * azienda con un'altra provenienza (tipicamente MANUALE) e' BLOCCANTE: non si sovrascrive ne' si somma.
 * Un CER fuori catalogo e' bloccante. Nessun valore nei codici: solo conteggi.
 */
async function collisioniGiacenze(tx: Tx, tenantId: string, righe: readonly RecordGiacenza[]) {
  const chiavi = righe.map(r => r.legacyKey)
  const out: Collisione[] = []
  const doppie = chiaviRipetute(chiavi)
  if (doppie > 0) out.push({ codice: 'DUPLICATO_NEL_PACCHETTO', conteggio: doppie })
  const famiglie = righe.map(
    r => `${r.registroId}|${r.cerCode.replace(/\D/g, '')}|${r.statoFisico ?? ''}`
  )
  const ripetute = chiaviRipetute(famiglie)
  if (ripetute > 0) out.push({ codice: 'FAMIGLIA_RIPETUTA_NEL_PACCHETTO', conteggio: ripetute })
  const [carico] = await tx.$queryRaw<Array<{ n: bigint }>>`
    SELECT count(*)::bigint AS n FROM "giacenze_iniziali"
    WHERE "tenant_id" = ${tenantId}::uuid AND "import_source" = 'WINWASTE'
      AND "legacy_key" = ANY(${chiavi}::text[])`
  let fuoriCatalogo = 0
  for (const cer of new Set(righe.map(r => r.cerCode))) {
    if ((await cerDelCatalogo(tx, cer)) === null) fuoriCatalogo++
  }
  if (fuoriCatalogo > 0) out.push({ codice: 'CER_NON_IN_CATALOGO', conteggio: fuoriCatalogo })
  const occupate = await famiglieOccupate(tx, tenantId, righe)
  if (occupate > 0) out.push({ codice: 'GIACENZA_GIA_PRESENTE_NON_IMPORTATA', conteggio: occupate })
  return { collisioni: out, giaCaricate: Number(carico.n) }
}

/**
 * Fasi che il pacchetto puo' contenere ma che NON si caricano nel database. `fir-digitali` e' solo
 * l'elenco dei FIR da riacquisire da RENTRI (`migrazione:riacquisisci-fir`): i FIR digitali non si
 * copiano (Q5 del 14/11).
 */
/** Elenco dei FIR in viaggio senza peso a destino: BLOCCANTE (mai caricato). */
export const FASE_FIR_SENZA_PESO = 'fir-senza-peso'

export const FASI_SOLO_ELENCO: Readonly<Record<AmbitoPacchetto, readonly string[]>> = {
  ANAGRAFICHE: [],
  REGISTRO: [],
  GIACENZE: [],
  FIR: ['fir-digitali', FASE_FIR_SENZA_PESO],
}

export const FASI_AMBITO: Readonly<Record<AmbitoPacchetto, ReadonlyArray<DefinizioneFase<any>>>> = {
  ANAGRAFICHE: [
    {
      nome: 'ditte',
      valida: (g, mappa) => validaRecordDitta(g, mappa.ditta),
      inserisciBlocco: inserisciDitte,
      collisioni: collisioniDitte,
    } satisfies DefinizioneFase<RecordDitta>,
    {
      nome: 'sedi',
      valida: (g, mappa) => validaRecordSede(g, mappa),
      inserisciBlocco: inserisciSedi,
      collisioni: collisioniPerChiavi('sedi_ditte'),
    } satisfies DefinizioneFase<RecordSede>,
    {
      nome: 'produttori',
      valida: (g, mappa) => validaRecordProduttore(g, mappa),
      inserisciBlocco: inserisciProduttori,
      collisioni: collisioniPerChiavi('produttori'),
    } satisfies DefinizioneFase<RecordProduttore>,
    {
      nome: 'trasportatori',
      valida: (g, mappa) => validaRecordTrasportatore(g, mappa),
      inserisciBlocco: inserisciTrasportatori,
      collisioni: collisioniPerChiavi('trasportatori'),
    } satisfies DefinizioneFase<RecordTrasportatore>,
    {
      nome: 'destinatari',
      valida: (g, mappa) => validaRecordDestinatario(g, mappa),
      inserisciBlocco: inserisciDestinatari,
      collisioni: collisioniPerChiavi('destinatari'),
    } satisfies DefinizioneFase<RecordDestinatario>,
    {
      nome: 'automezzi',
      valida: (g, mappa) => validaRecordAutomezzo(g, mappa),
      inserisciBlocco: inserisciAutomezzi,
      collisioni: collisioniAutomezzi,
    } satisfies DefinizioneFase<RecordAutomezzo>,
  ],
  REGISTRO: [],
  GIACENZE: [
    {
      nome: 'giacenze',
      valida: (g, mappa) => validaRecordGiacenza(g, mappa),
      inserisciBlocco: inserisciGiacenze,
      collisioni: collisioniGiacenze,
    } satisfies DefinizioneFase<RecordGiacenza>,
  ],
  FIR: [
    {
      nome: 'fir',
      valida: (g, mappa) => validaRecordFir(g, mappa),
      inserisciBlocco: inserisciFir,
      collisioni: collisioniFir,
    } satisfies DefinizioneFase<RecordFir>,
  ],
}
