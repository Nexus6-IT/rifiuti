import type { PrismaClient } from '@prisma/client'
import type { StatoLegame } from '../domain/legami-movimento/codici'

/**
 * Fixture del database per i test dei legami movimento-cliente-prezzo (fase 4.3). Si usano col
 * client PROPRIETARIO (che aggira la RLS e inserisce i dati di partenza). Nessuna pulizia qui: le
 * tabelle hanno FK a cascata su `tenants`; chi cancella l'azienda di test per id deve togliere
 * prima i legami (le FK `NoAction` verso listino e codici IVA non lasciano cancellare alla cieca).
 */

export type VersoMovimentoDiTest = 'CARICO' | 'SCARICO'

export interface OpzioniMovimentoDiTest {
  /** Omessa: `INGRESSO_ESTERNO` (carico) / `AVVIO_RECUPERO` (scarico). */
  causale?: string
  /** Omesso: `20 03 01`. */
  cerCode?: string
  /** Stringa decimale; omessa: `100`. */
  quantity?: string
  /** Omessa: `KG`. */
  unit?: string
  /** `AAAA-MM-GG`; omessa: `2026-03-01`. */
  movementDate?: string
  /** SCARICO con FIR: il FIR deve esistere (FK). */
  firId?: string | null
  /** Omesso: `CARICO`. */
  type?: VersoMovimentoDiTest
}

/**
 * Crea (col client PROPRIETARIO) un movimento ORDINARIO nel registro dell'azienda (lo crea se non
 * c'e'), con il primo progressivo libero dell'anno. Il movimento e' la radice della sua catena.
 */
export async function creaMovimentoDiTest(
  owner: PrismaClient,
  tenantId: string,
  opz: OpzioniMovimentoDiTest = {}
): Promise<{ movimentoId: string; registroId: string; type: VersoMovimentoDiTest }> {
  const type = opz.type ?? 'CARICO'
  const registro =
    (await owner.registroRifiuti.findFirst({
      where: { tenantId },
      orderBy: { createdAt: 'asc' },
    })) ??
    (await owner.registroRifiuti.create({
      data: { tenantId, descrizione: 'Registro di prova per i legami' },
    }))
  const data = new Date(`${opz.movementDate ?? '2026-03-01'}T10:00:00Z`)
  const anno = data.getUTCFullYear()
  const ultimo = await owner.wasteMovement.aggregate({
    where: { registroId: registro.id, progressiveYear: anno },
    _max: { progressiveNumber: true },
  })
  const movimento = await owner.wasteMovement.create({
    data: {
      tenantId,
      registroId: registro.id,
      progressiveYear: anno,
      progressiveNumber: (ultimo._max.progressiveNumber ?? 0) + 1,
      type,
      movementDate: data,
      registrationDate: data,
      causale: opz.causale ?? (type === 'CARICO' ? 'INGRESSO_ESTERNO' : 'AVVIO_RECUPERO'),
      cerCode: opz.cerCode ?? '20 03 01',
      quantity: opz.quantity ?? '100',
      unit: opz.unit ?? 'KG',
      firId: opz.firId ?? null,
      tipoAnnotazione: 'ORDINARIA',
    },
  })
  return { movimentoId: movimento.id, registroId: registro.id, type }
}

export interface RigaLegameDiTest {
  rigaAddebitoId: string
  codiceIvaId: string
  /** Stringa decimale; omessa: la riga non ha quantita' (e nemmeno l'origine). */
  quantita?: string
  /** Omesso: `1` (riga a prezzo singolo). `null` = prezzo assente (solo prezzo speciale). */
  prezzo?: string | null
  prezzoManuale?: boolean
  prezzoSpeciale?: boolean
}

export interface OpzioniLegameDiTest {
  movimentoOriginaleId: string
  registroId: string
  verso: VersoMovimentoDiTest
  /** Omesso: `DA_COLLEGARE`. */
  stato?: StatoLegame
  clienteId?: string
  contrattoId?: string
  elencoId?: string
  /** `AAAA-MM-GG`; omessa: `2026-03-01`. */
  dataMovimento?: string
  righe?: RigaLegameDiTest[]
}

/**
 * Crea (col client PROPRIETARIO) la testata di un legame con le sue righe, rispettando i CHECK:
 * per `CONFERMATO` e i fatturati servono cliente, contratto ed elenco; per `PROPOSTO` anche; un
 * `ESCLUSO` riceve un motivo; un fatturato riceve `fatturato_il`. Le righe copiano da listino
 * tipo, unita', tipo di quantita' e dal codice IVA aliquota e natura. Il movimento vigente e'
 * la radice.
 */
export async function creaLegameDiTest(
  owner: PrismaClient,
  tenantId: string,
  opz: OpzioniLegameDiTest
): Promise<{ legameId: string; righeIds: string[] }> {
  const stato = opz.stato ?? 'DA_COLLEGARE'
  const fatturato = stato === 'FATTURATO' || stato === 'IMPORTATO_FATTURATO'
  const [legame] = await owner.$queryRawUnsafe<{ id: string }[]>(
    `INSERT INTO legami_movimento
       (tenant_id, registro_id, verso, movimento_originale_id, movimento_vigente_id, stato,
        data_movimento, cliente_id, contratto_id, elenco_id, motivo_esclusione, fatturato_il,
        updated_at)
     VALUES ($1::uuid, $2::uuid, $3::waste_movement_type, $4::uuid, $4::uuid,
        $5::stato_legame_movimento, $6::date, $7::uuid, $8::uuid, $9::uuid, $10, $11::timestamp, now())
     RETURNING id::text AS id`,
    tenantId,
    opz.registroId,
    opz.verso,
    opz.movimentoOriginaleId,
    stato,
    opz.dataMovimento ?? '2026-03-01',
    opz.clienteId ?? null,
    opz.contrattoId ?? null,
    opz.elencoId ?? null,
    stato === 'ESCLUSO' ? 'Escluso per il test' : null,
    fatturato ? new Date().toISOString() : null
  )
  const righeIds: string[] = []
  let ordine = 0
  for (const r of opz.righe ?? []) {
    ordine++
    const speciale = r.prezzoSpeciale ?? false
    const [riga] = await owner.$queryRawUnsafe<{ id: string }[]>(
      `INSERT INTO righe_legame_movimento
         (tenant_id, legame_id, elenco_id, riga_addebito_id, ordine, origine, tipo, descrizione,
          tipo_quantita, unita_misura, quantita, quantita_origine, prezzo_speciale, prezzo,
          prezzo_manuale, codice_iva_id, aliquota_iva, natura_iva, updated_at)
       SELECT $1::uuid, $2::uuid, ra.elenco_id, ra.id, $4::int, 'PRINCIPALE'::origine_riga_legame,
          ra.tipo, ra.descrizione, ra.tipo_quantita, ra.unita_misura, $5::numeric,
          CASE WHEN $5::numeric IS NULL THEN NULL ELSE 'DA_MOVIMENTO'::origine_quantita_legame END,
          $6::boolean, $7::numeric, $8::boolean, ci.id, ci.aliquota, ci.natura, now()
       FROM righe_addebito ra, codici_iva ci
       WHERE ra.id = $3::uuid AND ra.tenant_id = $1::uuid AND ci.id = $9::uuid AND ci.tenant_id = $1::uuid
       RETURNING id::text AS id`,
      tenantId,
      legame.id,
      r.rigaAddebitoId,
      ordine,
      r.quantita ?? null,
      speciale,
      speciale ? null : r.prezzo === undefined ? '1' : r.prezzo,
      r.prezzoManuale ?? false,
      r.codiceIvaId
    )
    righeIds.push(riga.id)
  }
  return { legameId: legame.id, righeIds }
}
