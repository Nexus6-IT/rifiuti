/**
 * Regressione dei piani dell'export (fase 4.4b2, Task 24, giro 3) contro un Postgres reale,
 * COME `wasteflow_app`. In CI il database e' nuovo e le statistiche sono assenti o vecchie
 * subito dopo gli insert: il planner stima tabelle vuote e sceglie nested loop. Qui le
 * statistiche si rendono volutamente vecchie (autovacuum spento sulle tabelle del volume,
 * `pg_statistic` svuotata e `reltuples` a zero), poi l'export gira 6 volte di fila col piano
 * custom e una volta col piano generico forzato. Mai il testo dell'EXPLAIN (modello
 * `piani-query.postgres.spec.ts`). Pulizia per id esatti.
 *
 * SOGLIE RELATIVE (seguito 4.8b, test instabile in CI). Una soglia assoluta in millisecondi
 * misurava la velocita' del runner, non il piano: in CI (runner lento) superava 30 s due volte
 * su tre anche col piano buono, e in locale NON rilevava il difetto (nested loop con
 * `enable_nestloop` non spento: 18 s, sotto la soglia). Ora ogni misura con statistiche vecchie
 * e' confrontata con la stessa operazione, nello stesso processo e sullo stesso database, con
 * statistiche fresche (ANALYZE): se il runner e' lento lo sono entrambe, se il planner sceglie un
 * piano patologico solo la prima esplode (in locale 55x). Limite: RAPPORTO_MAX volte la misura
 * fresca piu' MARGINE_MS di rumore.
 */
import { randomUUID } from 'node:crypto'
import { Prisma, PrismaClient } from '@prisma/client'
import { urlComeRuolo } from '../../infrastructure/database/client-come-ruolo'
import { eDatabaseDiTestLocale } from '../../test-support/database-di-test'

const urlProprietario =
  process.env.DATABASE_URL ??
  'postgresql://wasteflow:wasteflow_ci@127.0.0.1:55438/wasteflow_ci?schema=public'
process.env.DATABASE_URL = urlComeRuolo(
  'wasteflow_app',
  process.env.DB_APP_PASSWORD ?? 'wasteflow_app_dev',
  urlProprietario
)
process.env.DATABASE_URL += `&application_name=fatt-t24c-${process.pid}&connection_limit=10`

import { TenantContext } from '../../core/context/tenant-context'
import {
  PrismaService,
  creaPrismaServiceApplicativo,
} from '../../infrastructure/persistence/prisma.service'
import { partitaIvaUnica } from '../../test-support/anagrafiche-di-test'
import { creaScenarioFatturazione } from '../../test-support/fatturazione-di-test'
import { pulisciTenantDiTest } from '../../test-support/legami-di-test'
import { assicuraCatalogoCer } from '../../test-support/listino-di-test'
import { DocumentiFatturaService } from './documenti-fattura.service'
import { XmlDocumentoService } from './xml-documento.service'
import { MappatureService } from './adattatori/mappature.service'
import { RegistroAdattatori } from './adattatori/registro-adattatori'
import { ExportService, TETTO_DOCUMENTI_CSV } from './export.service'

const TABELLE = [
  'documenti_fattura',
  'righe_documento_fattura',
  'riepiloghi_iva_documento',
  'rate_documento_fattura',
]
const ESECUZIONI = 6
/** Quante volte una misura con statistiche vecchie puo' costare quella con statistiche fresche. */
const RAPPORTO_MAX = 10
/** Rumore ammesso (GC, I/O del runner) oltre il rapporto. */
const MARGINE_MS = 1_500
/**
 * dettagliInTx con statistiche del tutto assenti costa per natura ~13x quello con statistiche
 * fresche (misurato: 3,2 s contro 0,25 s, anche col piano buono: ~0,5 s per blocco da 100):
 * limite piu' largo, che un vero nested loop sulla lista da 5000 supera di molto (>100x).
 */
const RAPPORTO_MAX_DETTAGLI = 40
/** Tentativi per ogni campione con statistiche vecchie sopra il limite (vedi `confrontaConFresche`). */
const TENTATIVI = 3
const limiteMs = (frescoMs: number, rapporto = RAPPORTO_MAX) => rapporto * frescoMs + MARGINE_MS

describe('ExportService — piani con statistiche vecchie', () => {
  const owner = new PrismaClient({ datasourceUrl: urlProprietario })
  let app: PrismaService
  let servizio: ExportService
  const tenantCreati: string[] = []
  const cerCreati: string[] = []
  let tenantId = ''
  let utenteId = ''
  let documentoIds: string[] = []

  const nel = <R>(fn: () => Promise<R>) => TenantContext.run({ tenantId }, async () => await fn())
  const crea = (db: PrismaService) =>
    new ExportService(
      db,
      new DocumentiFatturaService(db),
      new XmlDocumentoService(db, new DocumentiFatturaService(db)),
      new RegistroAdattatori([]),
      new MappatureService(db, new RegistroAdattatori([]))
    )
  const esporta = (
    s: ExportService,
    selezione: Parameters<ExportService['esporta']>[2]['selezione']
  ) => nel(() => s.esporta(tenantId, utenteId, { formato: 'CSV', selezione }))

  async function rendiVecchieLeStatistiche() {
    await owner.$executeRawUnsafe(
      `DELETE FROM pg_statistic WHERE starelid IN (${TABELLE.map(t => `'${t}'::regclass`).join(',')})`
    )
    await owner.$executeRawUnsafe(
      `UPDATE pg_class SET reltuples = 0, relpages = 0 WHERE oid IN (${TABELLE.map(t => `'${t}'::regclass`).join(',')})`
    )
  }

  beforeAll(async () => {
    expect(eDatabaseDiTestLocale(urlProprietario)).toBe(true)
    app = creaPrismaServiceApplicativo()
    servizio = crea(app)
    cerCreati.push(...(await assicuraCatalogoCer(owner, ['20 03 01'])))
    for (const t of TABELLE)
      await owner.$executeRawUnsafe(`ALTER TABLE ${t} SET (autovacuum_enabled = false)`)
    const t = await owner.tenant.create({
      data: { partitaIva: partitaIvaUnica(), ragioneSociale: 'Piani Export SRL', country: 'IT' },
    })
    tenantCreati.push(t.id)
    tenantId = t.id
    const sc = await creaScenarioFatturazione(owner, tenantId, { legami: 1, registri: 1 })
    utenteId = (
      await owner.user.create({
        data: {
          tenantId,
          keycloakId: `keycloak-pia-${randomUUID()}`,
          fiscalCode: 'RSSMRA80A01H501U',
          firstName: 'Mario',
          lastName: 'Rossi',
          email: `pia-${randomUUID()}@example.com`,
          role: 'ADMIN',
        },
      })
    ).id
    const [reg] = await owner.registroIva.findMany({ where: { tenantId } })
    await owner.$executeRawUnsafe(
      `INSERT INTO documenti_fattura
         (tenant_id, stato, tipo_documento, registro_iva_id, anno, data_documento, cliente_id,
          cliente_fatturazione_id, contratto_id, periodo_dal, periodo_al, formato_trasmissione,
          esigibilita_iva, totale_imponibile, totale_iva, totale_documento, netto_a_pagare,
          fotografia, updated_at)
       SELECT $1::uuid, 'BOZZA', 'TD01', $2::uuid, 2026, DATE '2026-01-01' + (g % 300), $3::uuid,
              $3::uuid, $4::uuid, DATE '2026-01-01', DATE '2026-12-31', 'FPR12', 'IMMEDIATA',
              300, 66, 366, 366,
              jsonb_build_object('cessionario', jsonb_build_object('partitaIva', '01234567890')),
              now()
       FROM generate_series(1, $5::int) g`,
      tenantId,
      reg.id,
      sc.clienteId,
      sc.contrattoId,
      TETTO_DOCUMENTI_CSV
    )
    await owner.$executeRawUnsafe(
      `INSERT INTO righe_documento_fattura
         (tenant_id, documento_id, numero_linea, tipo_riga, descrizione, quantita, unita_misura,
          prezzo_unitario, importo_lordo, importo_sconto, prezzo_totale, codice_iva_id,
          aliquota_iva, updated_at)
       SELECT d.tenant_id, d.id, l, 'FISSO', 'Canone ' || l, 1, 'N', 100, 100, 0, 100, $2::uuid, 22, now()
       FROM documenti_fattura d CROSS JOIN generate_series(1, 3) l WHERE d.tenant_id = $1::uuid`,
      tenantId,
      sc.codiceIvaId
    )
    await owner.$executeRawUnsafe(
      `INSERT INTO riepiloghi_iva_documento (tenant_id, documento_id, aliquota, imponibile, imposta, esigibilita, updated_at)
       SELECT tenant_id, id, 22, 300, 66, 'IMMEDIATA', now() FROM documenti_fattura WHERE tenant_id = $1::uuid`,
      tenantId
    )
    await owner.$executeRawUnsafe(
      `INSERT INTO rate_documento_fattura (tenant_id, documento_id, ordine, modalita, data_scadenza, importo, updated_at)
       SELECT tenant_id, id, 1, 'MP05', DATE '2026-04-30', 366, now() FROM documenti_fattura WHERE tenant_id = $1::uuid`,
      tenantId
    )
    await owner.$executeRawUnsafe(
      `UPDATE documenti_fattura d
          SET stato = 'DEFINITIVO', numero = x.rn, numero_testo = x.rn::text, definito_il = now(), updated_at = now()
         FROM (SELECT id, row_number() OVER (ORDER BY id)::int AS rn FROM documenti_fattura WHERE tenant_id = $1::uuid) x
        WHERE d.id = x.id AND d.tenant_id = $1::uuid`,
      tenantId
    )
    documentoIds = (
      await owner.$queryRawUnsafe<{ id: string }[]>(
        `SELECT id::text FROM documenti_fattura WHERE tenant_id = $1::uuid`,
        tenantId
      )
    ).map(r => r.id)
  }, 300_000)

  afterAll(async () => {
    await owner
      .$executeRawUnsafe(`ALTER ROLE wasteflow_app RESET plan_cache_mode`)
      .catch(() => undefined)
    for (const t of TABELLE) {
      await owner
        .$executeRawUnsafe(`ALTER TABLE ${t} RESET (autovacuum_enabled)`)
        .catch(() => undefined)
    }
    await pulisciTenantDiTest(owner, tenantCreati)
    // Statistiche rifatte: le suite successive non devono partire con pg_statistic vuota.
    for (const t of TABELLE) {
      await owner.$executeRawUnsafe(`ANALYZE ${t}`).catch(() => undefined)
    }
    if (cerCreati.length > 0) await owner.cERCode.deleteMany({ where: { code: { in: cerCreati } } })
    await owner.$disconnect()
    await app?.$disconnect()
  }, 120_000)

  /** Statistiche fresche per davvero: ANALYZE ripristina `pg_statistic` e `reltuples`. */
  async function rendiFresche() {
    for (const t of TABELLE) await owner.$executeRawUnsafe(`ANALYZE ${t}`)
  }

  /**
   * Esegue `fn` ESECUZIONI volte con statistiche fresche (riferimento) e poi altrettante con
   * statistiche vecchie, e verifica che la peggiore delle seconde stia nel limite relativo
   * (ogni campione lento viene rimisurato, vedi sotto: una pausa del runner non e' un piano).
   * Il peggiore, non il totale: il piano generico scatta alla sesta esecuzione e un solo giro
   * patologico verrebbe diluito dagli altri cinque.
   */
  async function confrontaConFresche(
    nome: string,
    fn: () => Promise<void>,
    ripetizioni = ESECUZIONI,
    rapporto = RAPPORTO_MAX
  ) {
    const misuraUna = async (prima: () => Promise<void>) => {
      await prima()
      const t0 = Date.now()
      await fn()
      return Date.now() - t0
    }
    const fresche: number[] = []
    for (let i = 0; i < ripetizioni; i++) fresche.push(await misuraUna(rendiFresche))
    const frescoMs = Math.max(...fresche)
    const limite = limiteMs(frescoMs, rapporto)

    // Un piano patologico e' sistematico: le statistiche vengono svuotate prima di OGNI
    // misura, quindi e' lento a ogni tentativo. Una pausa del runner condiviso colpisce invece
    // un solo tentativo (caso reale: un campione da 21 s su fresche da 0,8 s, job 12651). Per
    // questo ogni campione sopra il limite viene rimisurato fino a TENTATIVI volte e conta il
    // migliore: il test resta rosso solo se TUTTI i tentativi sono lenti.
    const vecchie: number[] = []
    const scartati: number[] = []
    for (let i = 0; i < ripetizioni; i++) {
      let migliore = Number.POSITIVE_INFINITY
      for (let tentativo = 0; tentativo < TENTATIVI && migliore >= limite; tentativo++) {
        const ms = await misuraUna(rendiVecchieLeStatistiche)
        if (ms >= limite && tentativo < TENTATIVI - 1) scartati.push(ms)
        migliore = Math.min(migliore, ms)
      }
      vecchie.push(migliore)
    }
    const peggioreMs = Math.max(...vecchie)
    // eslint-disable-next-line no-console
    console.log(
      `[T24c] ${nome} fresche ms: ${fresche.join(', ')} | vecchie ms: ${vecchie.join(', ')}` +
        `${scartati.length ? ` (rimisurati dopo: ${scartati.join(', ')})` : ''} | limite ${limite}`
    )
    expect(peggioreMs).toBeLessThan(limiteMs(frescoMs, rapporto))
  }

  const esportaOk =
    (s: ExportService, selezione: Parameters<ExportService['esporta']>[2]['selezione']) =>
    async () => {
      const r = await esporta(s, selezione)
      expect(r.contenuto.length).toBeGreaterThan(1000)
    }

  it(`piano custom, statistiche vecchie, filtro per anno, ${ESECUZIONI} volte: mai oltre ${RAPPORTO_MAX}x le statistiche fresche`, async () => {
    await confrontaConFresche('custom anno', esportaOk(servizio, { anno: 2026 }))
  }, 400_000)

  it(`piano custom, statistiche vecchie, 5000 documentoIds, ${ESECUZIONI} volte: mai oltre ${RAPPORTO_MAX}x le statistiche fresche`, async () => {
    await confrontaConFresche('custom documentoIds', esportaOk(servizio, { documentoIds }))
  }, 400_000)

  it(`force_generic_plan, statistiche vecchie: filtro per anno e 5000 documentoIds mai oltre ${RAPPORTO_MAX}x le statistiche fresche`, async () => {
    await owner.$executeRawUnsafe(
      `ALTER ROLE wasteflow_app SET plan_cache_mode = force_generic_plan`
    )
    const generico = creaPrismaServiceApplicativo()
    try {
      const s = crea(generico)
      await confrontaConFresche('generico anno', esportaOk(s, { anno: 2026 }), 2)
      await confrontaConFresche('generico documentoIds', esportaOk(s, { documentoIds }), 2)
    } finally {
      await owner.$executeRawUnsafe(`ALTER ROLE wasteflow_app RESET plan_cache_mode`)
      await generico.$disconnect()
    }
  }, 400_000)

  // -------------------------------------------------------------------------------------------
  // dettagliInTx da solo, nelle due forme della lista (`= ANY` fino a 100 id, `IN (SELECT unnest)`
  // dentro `conJoinLineari` oltre). Seguito 4.4b2 m4: il test dell'export passa da qui solo in modo
  // indiretto; qui si misura la funzione con statistiche vecchie, piano custom e piano generico.
  // Con statistiche del tutto assenti un blocco da 100 costa ~0,5 s (50 blocchi = 25 s): per questo
  // gli export leggono in un solo passaggio e lo zip (500 documenti) usa al piu' 5 blocchi.
  // -------------------------------------------------------------------------------------------
  async function dettagliA(
    db: PrismaService,
    ids: string[],
    dimensioneBlocco: number
  ): Promise<number> {
    const s = crea(db)
    let letti = 0
    await nel(() =>
      db.$transaction(
        async tx => {
          for (let da = 0; da < ids.length; da += dimensioneBlocco) {
            const dettagli = await s['documenti'].dettagliInTx(
              tx,
              tenantId,
              ids.slice(da, da + dimensioneBlocco)
            )
            letti += dettagli.length
          }
        },
        { timeout: 120_000, isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead }
      )
    )
    return letti
  }

  const zipPiuLista = (db: PrismaService) => async () => {
    expect(await dettagliA(db, documentoIds.slice(0, 500), 100)).toBe(500)
    expect(await dettagliA(db, documentoIds, documentoIds.length)).toBe(documentoIds.length)
  }

  it(`dettagliInTx, statistiche vecchie, piano custom: 5 blocchi da 100 id (lo zip da 500) e una lista da 5000 mai oltre ${RAPPORTO_MAX_DETTAGLI}x le statistiche fresche`, async () => {
    await confrontaConFresche('dettagli custom', zipPiuLista(app), 3, RAPPORTO_MAX_DETTAGLI)
  }, 400_000)

  it(`dettagliInTx, statistiche vecchie, force_generic_plan: 5 blocchi da 100 id (lo zip da 500) e una lista da 5000 mai oltre ${RAPPORTO_MAX_DETTAGLI}x le statistiche fresche`, async () => {
    await owner.$executeRawUnsafe(
      `ALTER ROLE wasteflow_app SET plan_cache_mode = force_generic_plan`
    )
    const generico = creaPrismaServiceApplicativo()
    try {
      await confrontaConFresche(
        'dettagli generico',
        zipPiuLista(generico),
        3,
        RAPPORTO_MAX_DETTAGLI
      )
    } finally {
      await owner.$executeRawUnsafe(`ALTER ROLE wasteflow_app RESET plan_cache_mode`)
      await generico.$disconnect()
    }
  }, 400_000)
})
