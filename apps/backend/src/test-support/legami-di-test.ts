import type { PrismaClient } from '@prisma/client'
import type { StatoLegame } from '../domain/legami-movimento/codici'
import { creaDittaConRuolo, partitaIvaUnica } from './anagrafiche-di-test'
import { creaCodiciIvaEcodifiche, creaContrattoConElenco, creaRiga } from './listino-di-test'

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
  /** Versione della causale aziendale (obbligatoria per una causale `AZ_...`). */
  causaleAziendaId?: string | null
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
      causaleAziendaId: opz.causaleAziendaId ?? null,
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
    if (!riga)
      throw new Error(
        'creaLegameDiTest: la riga di listino o il codice IVA non esistono nel tenant indicato'
      )
    righeIds.push(riga.id)
  }
  return { legameId: legame.id, righeIds }
}

/**
 * Pulizia per id esatti delle aziende di test (col client PROPRIETARIO): toglie prima le righe e i
 * legami, perche' le FK `NoAction` verso listino, elenchi e codici IVA non lasciano cancellare
 * contratti e codici a un'azienda che ha legami. Si chiama prima delle altre cancellazioni.
 */
export async function pulisciLegamiDiTest(
  owner: PrismaClient,
  tenantIds: readonly string[]
): Promise<void> {
  if (tenantIds.length === 0) return
  const in_ = { in: [...tenantIds] }
  await owner.rigaLegameMovimento.deleteMany({ where: { tenantId: in_ } })
  await owner.legameMovimento.deleteMany({ where: { tenantId: in_ } })
  // Le catene di correzione hanno FK NoAction fra loro: si cancellano in un solo statement.
  await owner.wasteMovement.deleteMany({ where: { tenantId: in_ } })
}

export interface OpzioniFirDiTest {
  /** Riga di ruolo `Produttore` (non la ditta); omessa: il FIR non porta a nessun cliente. */
  producerId?: string | null
  producerSedeId?: string | null
  /** Omesso: `20 03 01`. */
  cerCode?: string
}

/** Crea (col client PROPRIETARIO) un FIR in bozza con i soli campi obbligatori. */
export async function creaFirDiTest(
  owner: PrismaClient,
  tenantId: string,
  utenteId: string,
  opz: OpzioniFirDiTest = {}
): Promise<{ id: string }> {
  return owner.fIR.create({
    data: {
      tenantId,
      producerUserId: utenteId,
      producerId: opz.producerId ?? null,
      producerSedeId: opz.producerSedeId ?? null,
      producerPartitaIva: partitaIvaUnica(),
      producerName: 'Produttore di prova',
      producerAddress: 'Via Prova 1, 20100 Milano MI',
      carrierPartitaIva: partitaIvaUnica(),
      carrierName: 'Trasportatore',
      carrierVehiclePlate: 'AB123CD',
      receiverPartitaIva: partitaIvaUnica(),
      receiverName: 'Destinatario',
      receiverAddress: 'Via Destinazione 1, 20100 Milano MI',
      cerCode: opz.cerCode ?? '20 03 01',
      wasteDescription: 'Rifiuto di prova',
      wasteCategory: 'Non pericoloso',
      quantity: 100,
      unit: 'KG',
      status: 'DRAFT',
      transportDate: new Date(),
    },
    select: { id: true },
  })
}

export interface OpzioniScenarioProposta {
  /** Azienda esistente; omessa: ne crea una (da cancellare a fine test per id). */
  tenantId?: string
  /** Omesso: `20 03 01`. */
  cerCode?: string
  /** Quante righe `V` (proposte dal CER) aggiungere all'elenco; omesso: 0. */
  righeV?: number
  /** Omesso: `2026-03-01`. */
  movementDate?: string
  /**
   * Chiamata SUBITO dopo la creazione dell'azienda, prima di ogni altra operazione che puo'
   * fallire: il test vi registra l'id per la pulizia (per id esatti).
   */
  onTenantCreato?: (tenantId: string) => void
}

export interface ScenarioProposta {
  tenantId: string
  utenteId: string
  ivaId: string
  /** Ditta del produttore del FIR e cliente censito sulla stessa ditta. */
  dittaId: string
  clienteId: string
  /** Sede della ditta, indicata sul FIR come sede del produttore. */
  sedeId: string
  contrattoId: string
  elencoId: string
  rigaCerId: string
  righeVIds: string[]
  firId: string
  movimentoId: string
  registroId: string
}

/**
 * Crea (col client PROPRIETARIO) lo scenario minimo per leggere i dati di una proposta: azienda,
 * utente, codice IVA, una ditta produttrice che e' anche cliente (con la sua sede), un contratto
 * attivo con un elenco e una riga `CER` per il CER dato, `righeV` righe `V` proposte dal CER, un
 * FIR dal produttore (con la sede) e un movimento ordinario legato al FIR.
 */
export async function creaScenarioProposta(
  owner: PrismaClient,
  opz: OpzioniScenarioProposta = {}
): Promise<ScenarioProposta> {
  const cerCode = opz.cerCode ?? '20 03 01'
  let tenantId = opz.tenantId
  if (!tenantId) {
    tenantId = (
      await owner.tenant.create({
        data: { partitaIva: partitaIvaUnica(), ragioneSociale: 'Proposta SRL', country: 'IT' },
      })
    ).id
    opz.onTenantCreato?.(tenantId)
  }
  const n = partitaIvaUnica()
  const utente = await owner.user.create({
    data: {
      tenantId,
      keycloakId: `kc-prop-${n}`,
      fiscalCode: `PRP${n}`.slice(0, 16),
      firstName: 'Prova',
      lastName: 'Proposta',
      email: `prop-${n}@example.test`,
      role: 'ADMIN',
    },
  })
  const listino = await creaCodiciIvaEcodifiche(owner, tenantId)
  const produttore = await creaDittaConRuolo(owner, tenantId, 'PRODUTTORE')
  const cliente = await owner.cliente.create({
    data: { tenantId, dittaId: produttore.dittaId, sedeId: produttore.sedeId },
  })
  const c = await creaContrattoConElenco(owner, tenantId, { clienteId: cliente.id })
  const rigaCer = await creaRiga(owner, tenantId, c.elencoId, {
    tipo: 'CER',
    cerCode,
    codiceIvaId: listino.iva22Id,
  })
  const righeVIds: string[] = []
  for (let i = 0; i < (opz.righeV ?? 0); i++) {
    const v = await creaRiga(owner, tenantId, c.elencoId, {
      tipo: 'V',
      codiceIvaId: listino.iva22Id,
      altro: { cerProposta: [cerCode.replace(/ /g, '')] },
    })
    righeVIds.push(v.id)
  }
  const fir = await creaFirDiTest(owner, tenantId, utente.id, {
    producerId: produttore.ruoloId,
    producerSedeId: produttore.sedeId,
    cerCode,
  })
  const m = await creaMovimentoDiTest(owner, tenantId, {
    cerCode,
    firId: fir.id,
    movementDate: opz.movementDate,
  })
  return {
    tenantId,
    utenteId: utente.id,
    ivaId: listino.iva22Id,
    dittaId: produttore.dittaId,
    clienteId: cliente.id,
    sedeId: produttore.sedeId,
    contrattoId: c.contrattoId,
    elencoId: c.elencoId,
    rigaCerId: rigaCer.id,
    righeVIds,
    firId: fir.id,
    movimentoId: m.movimentoId,
    registroId: m.registroId,
  }
}

/**
 * Pulizia unica delle aziende create dagli spec dei legami (col client PROPRIETARIO), SOLO per id
 * esatti e nell'ordine delle FK. Ogni passo ha il suo `lock_timeout` (una transazione appesa di
 * un altro processo non blocca la pulizia per sempre) e un suo `try`: un passo che fallisce non
 * ferma i successivi. Se alla fine restano aziende, i loro id esatti finiscono su `console.error`
 * (per poterle togliere a mano, per id).
 */
export async function pulisciTenantDiTest(
  owner: PrismaClient,
  tenantIds: readonly string[]
): Promise<void> {
  if (tenantIds.length === 0) return
  const ids = [...new Set(tenantIds)]
  const errori: string[] = []
  const passo = async (nome: string, tabella: string, colonna = 'tenant_id'): Promise<void> => {
    try {
      await owner.$transaction(
        async tx => {
          await tx.$executeRawUnsafe(`SET LOCAL lock_timeout = '20s'`)
          if (tabella === 'waste_movements') {
            // Le catene di correzione hanno FK NoAction fra loro: un solo statement.
            await tx.$executeRawUnsafe(
              `DELETE FROM waste_movements WHERE tenant_id = ANY($1::uuid[])`,
              ids
            )
            return
          }
          await tx.$executeRawUnsafe(
            `DELETE FROM ${tabella} WHERE ${colonna} = ANY($1::uuid[])`,
            ids
          )
        },
        { timeout: 120_000, maxWait: 30_000 }
      )
    } catch (e) {
      errori.push(`${nome}: ${e instanceof Error ? e.message.split('\n')[0] : String(e)}`)
    }
  }
  for (const [nome, tabella] of [
    ['audit', 'activity_logs'],
    ['righe legame', 'righe_legame_movimento'],
    ['legami', 'legami_movimento'],
    ['abbinamenti', 'abbinamenti_carico_scarico'],
    ['trasmissioni RENTRI', 'movimenti_trasmissione_rentri'],
    ['movimenti', 'waste_movements'],
    ['impostazioni', 'impostazioni_fatturazione'],
    ['righe listino', 'righe_addebito'],
    ['elenchi', 'elenchi_addebiti'],
    ['contratti', 'contratti_cliente'],
    ['addebiti', 'addebiti'],
    ['codifiche', 'codifiche_addebito'],
    ['codici IVA', 'codici_iva'],
    ['FIR', 'firs'],
    ['utenti', 'users'],
  ] as const) {
    await passo(nome, tabella)
  }
  await passo('aziende', 'tenants', 'id')
  const rimaste = await owner.tenant
    .findMany({ where: { id: { in: ids } }, select: { id: true } })
    .catch(() => [])
  if (rimaste.length > 0 || errori.length > 0) {
    console.error(
      `pulisciTenantDiTest: aziende rimaste (id esatti) ${JSON.stringify(rimaste.map(t => t.id))}; errori ${JSON.stringify(errori)}`
    )
  }
}
