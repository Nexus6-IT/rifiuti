/**
 * Rapporto di destinazione (I8 T1): query aggregate per lotto sul lato WasteFlow, con la stessa forma del
 * rapporto sorgente. Solo letture, col client applicativo dentro `TenantContext.run` (RLS): il tenant
 * delle query e' quello del contesto, e ogni query filtra anche per `tenant_id`. Nessun valore
 * personale: conteggi, totali, identificativi tecnici. kg e m3 non si sommano mai.
 */
import { Prisma } from '@prisma/client'
import {
  GiacenzaDestinazione,
  LottoDestinazione,
  MAX_BUCHI,
  RapportoDestinazione,
  RegistroNumerazione,
  TotaleDestinazione,
} from '../../../domain/migrazione/riconciliazione/tipi'

type Tx = Prisma.TransactionClient

export class LottiNonTrovatiError extends Error {
  constructor(
    readonly mancanti: readonly string[],
    readonly ambiguita: boolean = false
  ) {
    super(
      ambiguita
        ? 'i lotti indicati appartengono a un altro archivio'
        : `lotti inesistenti per l'azienda: ${mancanti.join(', ')}`
    )
    this.name = 'LottiNonTrovatiError'
  }
}

const numero = (v: unknown): number => {
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}

function conteggio(json: Prisma.JsonValue, chiave: string): number {
  return json !== null && typeof json === 'object' && !Array.isArray(json)
    ? numero((json as Record<string, unknown>)[chiave])
    : 0
}

export async function leggiDestinazione(
  tx: Tx,
  tenantId: string,
  lottiIds: readonly string[]
): Promise<RapportoDestinazione> {
  const ids = [...new Set(lottiIds)]
  const lottiDb = await tx.lottoImport.findMany({
    where: { tenantId, id: { in: ids } },
    select: { id: true, ambito: true, archivio: true, stato: true, conteggi: true },
    orderBy: [{ archivio: 'asc' }, { ambito: 'asc' }, { id: 'asc' }],
  })
  const trovati = new Set(lottiDb.map(l => l.id))
  const mancanti = ids.filter(i => !trovati.has(i))
  if (mancanti.length > 0) throw new LottiNonTrovatiError(mancanti)

  const lotti: LottoDestinazione[] = lottiDb.map(l => ({
    id: l.id,
    ambito: l.ambito,
    archivio: l.archivio,
    stato: l.stato,
    inserite: conteggio(l.conteggi, 'inserite'),
    lette: conteggio(l.conteggi, 'lette'),
    saltate: conteggio(l.conteggi, 'saltate'),
  }))
  const dove = { tenantId, lottoImportId: { in: ids } }

  const [
    ditte,
    sedi,
    produttori,
    trasportatori,
    destinatari,
    automezzi,
    movimenti,
    giacenzeRighe,
    fir,
  ] = await Promise.all([
    tx.ditta.count({ where: dove }),
    tx.sedeDitta.count({ where: dove }),
    tx.produttore.count({ where: dove }),
    tx.trasportatore.count({ where: dove }),
    tx.destinatario.count({ where: dove }),
    tx.automezzo.count({ where: dove }),
    tx.wasteMovement.count({ where: dove }),
    tx.giacenzaIniziale.findMany({
      where: dove,
      select: { registroId: true, cerCode: true, statoFisico: true, quantita: true, unita: true },
    }),
    tx.fIR.count({ where: dove }),
  ])

  const giacenze: GiacenzaDestinazione[] = giacenzeRighe.map(g => {
    const q = Number(g.quantita)
    const u = g.unita.trim().toUpperCase()
    return {
      registroId: g.registroId,
      cer: g.cerCode,
      statoFisico: g.statoFisico ?? '',
      // Le aperture sono sempre in kg; una tonnellata si converte (stessa famiglia del servizio manuale).
      kg: u === 'T' ? Math.round(q * 1000 * 1000) / 1000 : q,
    }
  })

  const perVerso = await tx.wasteMovement.groupBy({
    by: ['type'],
    where: dove,
    _count: { _all: true },
  })
  const movimentiPerVerso = { CARICO: 0, SCARICO: 0 }
  for (const g of perVerso) movimentiPerVerso[g.type] = g._count._all

  const totali = (
    await tx.$queryRaw<
      Array<{
        anno: number
        cer: string
        verso: 'CARICO' | 'SCARICO'
        n: bigint
        kg: unknown
        m3: unknown
      }>
    >`
    SELECT EXTRACT(YEAR FROM (movement_date AT TIME ZONE 'Europe/Rome'))::int AS anno,
           cer_code AS cer, type::text AS verso, count(*) AS n,
           COALESCE(sum(CASE UPPER(TRIM(unit)) WHEN 'KG' THEN quantity WHEN 'T' THEN quantity * 1000 END), 0) AS kg,
           COALESCE(sum(CASE UPPER(TRIM(unit)) WHEN 'M3' THEN quantity END), 0) AS m3
    FROM waste_movements
    WHERE tenant_id = ${tenantId}::uuid AND lotto_import_id = ANY(${ids}::uuid[])
    GROUP BY 1, 2, 3
    ORDER BY 1, 2, 3`
  ).map<TotaleDestinazione>(r => ({
    anno: r.anno,
    cer: r.cer,
    verso: r.verso,
    movimenti: Number(r.n),
    kg: numero(r.kg),
    m3: numero(r.m3),
  }))

  const gruppi = await tx.$queryRaw<
    Array<{ registro_id: string; anno: number; n: bigint; primo: number; ultimo: number }>
  >`
    SELECT registro_id, progressive_year AS anno, count(*) AS n,
           min(progressive_number) AS primo, max(progressive_number) AS ultimo
    FROM waste_movements
    WHERE tenant_id = ${tenantId}::uuid AND lotto_import_id = ANY(${ids}::uuid[])
    GROUP BY registro_id, progressive_year
    ORDER BY registro_id, progressive_year`
  const salti = await tx.$queryRaw<
    Array<{ registro_id: string; anno: number; da: number; a: number }>
  >`
    SELECT registro_id, anno, n + 1 AS da, nx - 1 AS a FROM (
      SELECT registro_id, progressive_year AS anno, progressive_number AS n,
             lead(progressive_number) OVER (
               PARTITION BY registro_id, progressive_year ORDER BY progressive_number) AS nx
      FROM waste_movements
      WHERE tenant_id = ${tenantId}::uuid AND lotto_import_id = ANY(${ids}::uuid[])
    ) s WHERE nx - n > 1
    ORDER BY registro_id, anno, n`
  const numerazione: RegistroNumerazione[] = gruppi.map(g => {
    const buchi: number[] = []
    let totali = 0
    for (const s of salti) {
      if (s.registro_id !== g.registro_id || s.anno !== g.anno) continue
      for (let k = s.da; k <= s.a; k++) {
        totali++
        if (buchi.length < MAX_BUCHI) buchi.push(k)
      }
    }
    return {
      registroId: g.registro_id,
      anno: g.anno,
      conteggio: Number(g.n),
      primo: g.primo,
      ultimo: g.ultimo,
      buchi,
      buchiTotali: totali,
    }
  })
  const [{ collisioni }] = await tx.$queryRaw<Array<{ collisioni: bigint }>>`
    SELECT count(*) AS collisioni FROM (
      SELECT 1 FROM waste_movements
      WHERE tenant_id = ${tenantId}::uuid AND lotto_import_id = ANY(${ids}::uuid[])
      GROUP BY registro_id, progressive_year, progressive_number HAVING count(*) > 1
    ) d`

  const [rentri] = await tx.$queryRaw<
    Array<{ movimenti: bigint; da_riconciliare: bigint; non_bloccati: bigint; con_id: bigint }>
  >`
    SELECT count(*) AS movimenti,
           count(*) FILTER (WHERE t.stato = 'DA_RICONCILIARE') AS da_riconciliare,
           count(*) FILTER (WHERE t.id IS NULL OR t.stato <> 'DA_RICONCILIARE'
                              OR t.origine <> 'IMPORTAZIONE' OR NOT t.bloccato_invio) AS non_bloccati,
           count(*) FILTER (WHERE t.stato = 'DA_RICONCILIARE' AND t.identificativo_rentri IS NOT NULL) AS con_id
    FROM waste_movements m
    LEFT JOIN movimenti_trasmissione_rentri t ON t.movimento_id = m.id AND t.tenant_id = m.tenant_id
    WHERE m.tenant_id = ${tenantId}::uuid AND m.lotto_import_id = ANY(${ids}::uuid[])`
  const identificativi = (
    await tx.$queryRaw<Array<{ identificativo: string; registro_rentri: string | null }>>`
      SELECT t.identificativo_rentri AS identificativo, r.identificativo_rentri AS registro_rentri
      FROM waste_movements m
      JOIN movimenti_trasmissione_rentri t ON t.movimento_id = m.id AND t.tenant_id = m.tenant_id
      JOIN registri_rifiuti r ON r.id = m.registro_id AND r.tenant_id = m.tenant_id
      WHERE m.tenant_id = ${tenantId}::uuid AND m.lotto_import_id = ANY(${ids}::uuid[])
        AND t.stato = 'DA_RICONCILIARE' AND t.identificativo_rentri IS NOT NULL
      ORDER BY t.identificativo_rentri`
  ).map(r => ({ identificativo: r.identificativo, registroRentri: r.registro_rentri }))

  return {
    lotti,
    righePerTabella: {
      Ditta: ditte,
      SedeDitta: sedi,
      Produttore: produttori,
      Trasportatore: trasportatori,
      Destinatario: destinatari,
      Automezzo: automezzi,
      WasteMovement: movimenti,
      GiacenzaIniziale: giacenzeRighe.length,
      FIR: fir,
    },
    movimentiPerVerso,
    totali,
    numerazione,
    collisioniNumerazione: Number(collisioni),
    firImportati: fir,
    giacenze,
    rentri: {
      movimenti: Number(rentri.movimenti),
      daRiconciliare: Number(rentri.da_riconciliare),
      nonBloccati: Number(rentri.non_bloccati),
      conIdentificativo: Number(rentri.con_id),
      identificativi,
    },
  }
}
