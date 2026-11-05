import { Prisma, PrismaClient } from '@prisma/client'
import { creaCodiciIvaEcodifiche, creaContrattoConElenco, creaRiga } from './listino-di-test'
import { creaLegameDiTest, creaMovimentoDiTest } from './legami-di-test'

/**
 * Fixture del database per i test del pezzo 4.1: una riga minima per ciascuna delle sei tabelle
 * di fatturazione, nell'azienda indicata. Si usa col client PROPRIETARIO (che aggira la RLS).
 * Nessuna pulizia qui: le tabelle hanno FK a cascata su `tenants`, quindi basta cancellare
 * l'azienda di test per id.
 */
export interface TabelleFatturazioneDiTest {
  condizioneId: string
  contoId: string
  speseId: string
  bolloId: string
  registroId: string
  registroSplitId: string
  testoId: string
  categoriaId: string
  tipoId: string
  motivoId: string
}

export async function creaTabelleFatturazione(
  owner: PrismaClient,
  tenantId: string
): Promise<TabelleFatturazioneDiTest> {
  const condizione = await owner.condizionePagamento.create({
    data: {
      tenantId,
      codice: 'BB30',
      descrizione: 'Bonifico 30 giorni',
      modalita: 'MP05',
      giorniRate: [30],
    },
  })
  const conto = await owner.contoCorrente.create({
    data: {
      tenantId,
      codice: 'C1',
      descrizione: 'Conto principale',
      banca: 'Banca di prova',
      iban: 'IT60X0542811101000000123456',
    },
  })
  const spese = await owner.spesaAccessoria.create({
    data: {
      tenantId,
      tipo: 'INCASSO',
      codice: 'INC',
      descrizione: 'Spese di incasso',
      importo: '2.50',
    },
  })
  const bollo = await owner.spesaAccessoria.create({
    data: { tenantId, tipo: 'BOLLO', codice: 'BOL', descrizione: 'Bollo', importo: '2.00' },
  })
  const registro = await owner.registroIva.create({
    data: { tenantId, codice: '01', descrizione: 'Vendite' },
  })
  const registroSplit = await owner.registroIva.create({
    data: { tenantId, codice: '02', descrizione: 'Ricevute split payment', ricevuteSplit: true },
  })
  const testo = await owner.testoFatturazione.create({
    data: { tenantId, codice: 'T1', titolo: 'Testo di prova', righe: ['Prima riga'] },
  })
  const categoria = await owner.codificaContratto.create({
    data: { tenantId, genere: 'CATEGORIA', codice: '001', descrizione: 'Categoria di prova' },
  })
  const tipo = await owner.codificaContratto.create({
    data: { tenantId, genere: 'TIPO', codice: '001', descrizione: 'Tipo di prova' },
  })
  const motivo = await owner.codificaContratto.create({
    data: { tenantId, genere: 'MOTIVO_ANNULLO', codice: '001', descrizione: 'Motivo di prova' },
  })
  return {
    condizioneId: condizione.id,
    contoId: conto.id,
    speseId: spese.id,
    bolloId: bollo.id,
    registroId: registro.id,
    registroSplitId: registroSplit.id,
    testoId: testo.id,
    categoriaId: categoria.id,
    tipoId: tipo.id,
    motivoId: motivo.id,
  }
}

// ---------------------------------------------------------------------------------------------
// Fatturazione per periodo (fase 4.4a): scenario di legami confermati, documenti e cedente.
// Tutto si inserisce col client PROPRIETARIO, nel rispetto dei CHECK. La pulizia e'
// `pulisciTenantDiTest` (legami-di-test.ts), per id esatti.
// ---------------------------------------------------------------------------------------------

export interface OpzioniScenarioFatturazione {
  /** Quanti legami `CONFERMATO` creare (uno per movimento); omesso: 1. */
  legami?: number
  /** Quanti registri IVA creare (codici `01`, `02`, ...); omesso: 1. Il contratto usa il primo. */
  registri?: number
  /** Aggiunge all'elenco una riga `F` (addebito fisso) oltre alla riga `CER`. */
  conFissi?: boolean
  /** Rende speciale il prezzo della riga `CER` (`applica_a`); omesso: prezzo singolo. */
  prezzoSpeciale?: 'DOCUMENTO' | 'PERIODO'
  /** `AAAA-MM-GG` dei movimenti; omesso: `2026-03-01`. */
  dataMovimento?: string
  /** Valore di `impostazioni_fatturazione.definitive_attive`; omesso: `false` (come in produzione). */
  definitiveAttive?: boolean
}

export interface ScenarioFatturazione {
  contrattoId: string
  clienteId: string
  elencoId: string
  registroIvaId: string
  legamiIds: string[]
  rigaAddebitoIds: string[]
  codiceIvaId: string
}

/**
 * Crea, nell'azienda indicata (che esiste gia'), un cliente con un contratto attivo (registro IVA
 * impostato), un elenco con la riga `CER` (e, a richiesta, una riga `F`), i movimenti e un legame
 * `CONFERMATO` per ciascuno, con una riga di legame sulla riga `CER`. Scrive la riga di
 * `impostazioni_fatturazione` con `definitive_attive` (default `false`).
 */
export async function creaScenarioFatturazione(
  owner: PrismaClient,
  tenantId: string,
  opz: OpzioniScenarioFatturazione = {}
): Promise<ScenarioFatturazione> {
  const listino = await creaCodiciIvaEcodifiche(owner, tenantId)
  const registri: string[] = []
  for (let i = 1; i <= (opz.registri ?? 1); i++) {
    const r = await owner.registroIva.create({
      data: { tenantId, codice: String(i).padStart(2, '0'), descrizione: `Registro ${i}` },
    })
    registri.push(r.id)
  }
  const c = await creaContrattoConElenco(owner, tenantId)
  await owner.contrattoCliente.update({
    where: { id: c.contrattoId },
    data: { registroIvaId: registri[0] },
  })
  const rigaCer = await creaRiga(owner, tenantId, c.elencoId, {
    tipo: 'CER',
    codiceIvaId: listino.iva22Id,
    prezzo: opz.prezzoSpeciale ? null : '1',
    altro: opz.prezzoSpeciale ? { prezzoSpeciale: true, applicaA: opz.prezzoSpeciale } : {},
  })
  const rigaAddebitoIds = [rigaCer.id]
  if (opz.conFissi) {
    const fisso = await creaRiga(owner, tenantId, c.elencoId, {
      tipo: 'F',
      codiceIvaId: listino.iva22Id,
      prezzo: '10',
    })
    rigaAddebitoIds.push(fisso.id)
  }
  const legamiIds: string[] = []
  for (let i = 0; i < (opz.legami ?? 1); i++) {
    const m = await creaMovimentoDiTest(owner, tenantId, { movementDate: opz.dataMovimento })
    const l = await creaLegameDiTest(owner, tenantId, {
      movimentoOriginaleId: m.movimentoId,
      registroId: m.registroId,
      verso: m.type,
      stato: 'CONFERMATO',
      clienteId: c.clienteId,
      contrattoId: c.contrattoId,
      elencoId: c.elencoId,
      dataMovimento: opz.dataMovimento,
      righe: [
        {
          rigaAddebitoId: rigaCer.id,
          codiceIvaId: listino.iva22Id,
          quantita: '100',
          prezzo: opz.prezzoSpeciale ? null : '1',
          prezzoSpeciale: opz.prezzoSpeciale !== undefined,
        },
      ],
    })
    legamiIds.push(l.legameId)
  }
  await owner.$executeRawUnsafe(
    `INSERT INTO impostazioni_fatturazione (tenant_id, definitive_attive, updated_at)
     VALUES ($1::uuid, $2::boolean, now())
     ON CONFLICT (tenant_id) DO UPDATE SET definitive_attive = EXCLUDED.definitive_attive`,
    tenantId,
    opz.definitiveAttive ?? false
  )
  return {
    contrattoId: c.contrattoId,
    clienteId: c.clienteId,
    elencoId: c.elencoId,
    registroIvaId: registri[0],
    legamiIds,
    rigaAddebitoIds,
    codiceIvaId: listino.iva22Id,
  }
}

export interface OpzioniDocumentoDiTest {
  stato: 'BOZZA' | 'DEFINITIVO' | 'ANNULLATO'
  registroIvaId: string
  anno: number
  /**
   * Solo per i non in bozza; omesso: il primo numero libero della coppia (registro, anno). Non
   * tocca `numerazioni_fattura`: chi vuole la coerenza chiama prima `riservaNumeri` (Task 8).
   */
  numero?: number
  /** `AAAA-MM-GG`; omessa: il 15 marzo dell'anno. */
  dataDocumento?: string
  /** Legami `CONFERMATO` dello scenario: una riga `MOVIMENTO` per ciascuna delle loro righe. */
  legamiIds?: string[]
  elaborazioneId?: string
  /** Aggiunge una rata e un riepilogo IVA (le figlie si inseriscono prima della promozione). */
  conRateERiepilogo?: boolean
}

/**
 * Crea (col client PROPRIETARIO) la testata di un documento di test nello stato chiesto, con le
 * righe dei legami indicati. Un `DEFINITIVO` marca i legami `FATTURATO` col suo `documento_id`.
 * Senza legami usa un cliente e un contratto nuovi. Il documento e' un `TD01` senza errori,
 * totali coerenti con le righe (IVA al 22%).
 */
export async function creaDocumentoDiTest(
  owner: PrismaClient,
  tenantId: string,
  opz: OpzioniDocumentoDiTest
): Promise<{ documentoId: string }> {
  const legamiIds = opz.legamiIds ?? []
  let clienteId: string
  let contrattoId: string
  let elencoId: string | null = null
  if (legamiIds.length > 0) {
    const [l] = await owner.$queryRawUnsafe<
      { cliente_id: string; contratto_id: string; elenco_id: string }[]
    >(
      `SELECT cliente_id::text, contratto_id::text, elenco_id::text FROM legami_movimento
       WHERE id = $1::uuid AND tenant_id = $2::uuid`,
      legamiIds[0],
      tenantId
    )
    if (!l) throw new Error('creaDocumentoDiTest: legame non trovato nel tenant indicato')
    clienteId = l.cliente_id
    contrattoId = l.contratto_id
    elencoId = l.elenco_id
  } else {
    const c = await creaContrattoConElenco(owner, tenantId)
    clienteId = c.clienteId
    contrattoId = c.contrattoId
  }
  const righe = legamiIds.length
    ? await owner.$queryRawUnsafe<
        {
          legame_id: string
          riga_legame_id: string
          riga_addebito_id: string
          movimento_vigente_id: string
          data_movimento: string
          cer_code: string | null
          quantita: string | null
          prezzo: string | null
          unita_misura: string
          codice_iva_id: string
          aliquota_iva: string
          natura_iva: string | null
        }[]
      >(
        `SELECT l.id::text AS legame_id, r.id::text AS riga_legame_id, r.riga_addebito_id::text,
                l.movimento_vigente_id::text, l.data_movimento::text,
                NULL::text AS cer_code, r.quantita::text, r.prezzo::text, r.unita_misura,
                r.codice_iva_id::text, r.aliquota_iva::text, r.natura_iva
         FROM righe_legame_movimento r
         JOIN legami_movimento l ON l.id = r.legame_id AND l.tenant_id = r.tenant_id
         WHERE l.tenant_id = $1::uuid AND l.id = ANY($2::uuid[])
         ORDER BY l.id, r.ordine`,
        tenantId,
        legamiIds
      )
    : []
  const importi = righe.map(r =>
    new Prisma.Decimal(r.quantita ?? '1')
      .mul(r.prezzo ?? '0')
      .toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP)
  )
  const imponibile = importi.reduce((a, b) => a.add(b), new Prisma.Decimal(0))
  const iva = imponibile.mul(22).div(100).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP)
  const nonBozza = opz.stato !== 'BOZZA'
  let numero: number | null = null
  if (nonBozza) {
    if (opz.numero !== undefined) numero = opz.numero
    else {
      const [mx] = await owner.$queryRawUnsafe<{ n: number }[]>(
        `SELECT COALESCE(max(numero), 0)::int AS n FROM documenti_fattura
         WHERE tenant_id = $1::uuid AND registro_iva_id = $2::uuid AND anno = $3::int`,
        tenantId,
        opz.registroIvaId,
        opz.anno
      )
      numero = mx.n + 1
    }
  }
  const data = opz.dataDocumento ?? `${opz.anno}-03-15`
  const [doc] = await owner.$queryRawUnsafe<{ id: string }[]>(
    `INSERT INTO documenti_fattura
       (tenant_id, elaborazione_id, stato, tipo_documento, registro_iva_id, anno, numero,
        numero_testo, data_documento, cliente_id, cliente_fatturazione_id, contratto_id, elenco_id,
        periodo_dal, periodo_al, formato_trasmissione, esigibilita_iva, totale_imponibile,
        totale_iva, totale_documento, netto_a_pagare, fotografia, definito_il, annullato_il,
        motivo_annullo, updated_at)
     VALUES ($1::uuid, $2::uuid, COALESCE($3::stato_documento_fattura, 'BOZZA'), 'TD01', $4::uuid,
        $5::smallint, $6::int, $7::text, $8::date, $9::uuid, $9::uuid, $10::uuid, $11::uuid,
        make_date($5::int, 1, 1), make_date($5::int, 12, 31), 'FPR12', 'IMMEDIATA',
        $12::numeric, $13::numeric, $14::numeric, $14::numeric, '{}'::jsonb,
        NULL, NULL, NULL, now())
     RETURNING id::text AS id`,
    tenantId,
    opz.elaborazioneId ?? null,
    null,
    opz.registroIvaId,
    opz.anno,
    null,
    null,
    data,
    clienteId,
    contrattoId,
    elencoId,
    imponibile.toFixed(2),
    iva.toFixed(2),
    imponibile.add(iva).toFixed(2)
  )
  let linea = 0
  for (const [i, r] of righe.entries()) {
    linea++
    await owner.$executeRawUnsafe(
      `INSERT INTO righe_documento_fattura
         (tenant_id, documento_id, numero_linea, tipo_riga, legame_id, riga_legame_id,
          movimento_fatturato_id, riga_addebito_id, descrizione, data_movimento, cer_code,
          quantita, unita_misura, prezzo_unitario, importo_lordo, importo_sconto, prezzo_totale,
          codice_iva_id, aliquota_iva, natura_iva, updated_at)
       VALUES ($1::uuid, $2::uuid, $3::int, 'MOVIMENTO', $4::uuid, $5::uuid, $6::uuid, $7::uuid,
          'Riga di prova', $8::date, $9, $10::numeric, $11, $12::numeric, $13::numeric, 0,
          $13::numeric, $14::uuid, $15::numeric, $16, now())`,
      tenantId,
      doc.id,
      linea,
      r.legame_id,
      r.riga_legame_id,
      r.movimento_vigente_id,
      r.riga_addebito_id,
      r.data_movimento,
      r.cer_code,
      r.quantita,
      r.unita_misura,
      r.prezzo ?? '0',
      importi[i].toFixed(2),
      r.codice_iva_id,
      r.aliquota_iva,
      r.natura_iva
    )
  }
  if (opz.conRateERiepilogo) {
    await owner.$executeRawUnsafe(
      `INSERT INTO rate_documento_fattura
         (tenant_id, documento_id, ordine, modalita, data_scadenza, importo, updated_at)
       VALUES ($1::uuid, $2::uuid, 1, 'MP05', '2026-04-30', 10, now())`,
      tenantId,
      doc.id
    )
    await owner.$executeRawUnsafe(
      `INSERT INTO riepiloghi_iva_documento
         (tenant_id, documento_id, aliquota, imponibile, imposta, esigibilita, updated_at)
       VALUES ($1::uuid, $2::uuid, 22, 100, 22, 'IMMEDIATA', now())`,
      tenantId,
      doc.id
    )
  }
  // Promozione (I1: le figlie si inseriscono con la testata in BOZZA): numero e data una volta
  // sola, poi il trigger blocca tutto. Un ANNULLATO passa da DEFINITIVO, come nel flusso reale.
  if (nonBozza) {
    await owner.$executeRawUnsafe(
      `UPDATE documenti_fattura
         SET stato = 'DEFINITIVO', numero = $2::int, numero_testo = $3, definito_il = now(),
             updated_at = now()
       WHERE id = $1::uuid`,
      doc.id,
      numero,
      String(numero)
    )
  }
  if (opz.stato === 'ANNULLATO') {
    await owner.$executeRawUnsafe(
      `UPDATE documenti_fattura
         SET stato = 'ANNULLATO', motivo_annullo = 'Annullato per il test', annullato_il = now(),
             updated_at = now()
       WHERE id = $1::uuid`,
      doc.id
    )
  }
  if (opz.stato === 'DEFINITIVO' && legamiIds.length > 0) {
    await owner.$executeRawUnsafe(
      `UPDATE legami_movimento
         SET stato = 'FATTURATO', fatturato_il = now(), documento_id = $3::uuid,
             riferimento_fattura = $4, updated_at = now()
       WHERE tenant_id = $1::uuid AND id = ANY($2::uuid[])`,
      tenantId,
      legamiIds,
      doc.id,
      `${numero}`
    )
  }
  return { documentoId: doc.id }
}

/** Crea (col client PROPRIETARIO) la riga del cedente: regime `RF01`, REA `MI`, liquidazione `LN`. */
export async function creaCedenteDiTest(owner: PrismaClient, tenantId: string): Promise<void> {
  await owner.$executeRawUnsafe(
    `INSERT INTO cedente_fatturazione (tenant_id, regime_fiscale, rea_ufficio, stato_liquidazione, updated_at)
     VALUES ($1::uuid, 'RF01', 'MI', 'LN', now())`,
    tenantId
  )
}
