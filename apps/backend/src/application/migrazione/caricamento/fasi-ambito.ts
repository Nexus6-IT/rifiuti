/**
 * Registro delle fasi di ogni ambito del pacchetto: per ciascuna, come si rivalida un record (il
 * pacchetto non e' fidato), come si scrive un blocco e quali collisioni controlla `--verifica`.
 * Oggi: ANAGRAFICHE/ditte. I pezzi I4-I7 aggiungono qui sedi, ruoli, FIR, registro e giacenze.
 */
import type { AmbitoPacchetto } from '../pacchetto/manifest-pacchetto'
import type { MappaImport } from '../pacchetto/mappa-import'
import { RecordDitta, validaRecordDitta } from '../pacchetto/record-ditta'
import { inserisciDitte } from './inserisci-ditte'
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

export const FASI_AMBITO: Readonly<Record<AmbitoPacchetto, ReadonlyArray<DefinizioneFase<any>>>> = {
  ANAGRAFICHE: [
    {
      nome: 'ditte',
      valida: (g, mappa) => validaRecordDitta(g, mappa.ditta),
      inserisciBlocco: inserisciDitte,
      collisioni: collisioniDitte,
    } satisfies DefinizioneFase<RecordDitta>,
  ],
  REGISTRO: [],
  GIACENZE: [],
  FIR: [],
}
