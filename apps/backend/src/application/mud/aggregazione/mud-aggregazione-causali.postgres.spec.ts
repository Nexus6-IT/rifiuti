/**
 * Il MUD legge il catalogo delle causali (Fase 2 pezzo 5, Task 3) contro un Postgres reale,
 * collegato COME `wasteflow_app` (RLS ENABLE+FORCE) dentro il `TenantContext` dell'azienda.
 *
 * Il proprietario (`wasteflow`, superuser) prepara aziende, causali aziendali e movimenti; la
 * pulizia toglie solo le righe create qui.
 */
import { PrismaClient } from '@prisma/client'
import { randomUUID } from 'crypto'
import { urlComeRuolo } from '../../../infrastructure/database/client-come-ruolo'

const urlProprietario =
  process.env.DATABASE_URL ??
  'postgresql://wasteflow:wasteflow_ci@127.0.0.1:55432/wasteflow_ci?schema=public'
// I servizi dell'applicazione leggono DATABASE_URL, come in produzione.
process.env.DATABASE_URL = urlComeRuolo(
  'wasteflow_app',
  process.env.DB_APP_PASSWORD ?? 'wasteflow_app_dev',
  urlProprietario
)

import { TenantContext } from '../../../core/context/tenant-context'
import {
  PrismaService,
  creaPrismaServiceApplicativo,
} from '../../../infrastructure/persistence/prisma.service'
import { MudAggregazioneService } from './mud-aggregazione.service'
import { hashAggregato } from './mud-regole'

// ORACOLO: la vecchia implementazione, copiata VERBATIM da mud-regole.ts:28-57 di master
// 5b6f661. NON va modificata.
type Ruolo = 'PRODOTTO' | 'AVVIATO' | 'RICEVUTO_DA_TERZI' | 'ESCLUSO'
const RUOLO_CARICO: Record<string, Ruolo> = {
  PRODUZIONE_INTERNA: 'PRODOTTO',
  RECUPERO_PARZIALE: 'PRODOTTO',
  INGRESSO_ESTERNO: 'RICEVUTO_DA_TERZI',
}
const RUOLO_SCARICO: Record<string, Ruolo> = {
  CONFERIMENTO_TRASPORTATORE: 'AVVIATO',
  AVVIO_RECUPERO: 'AVVIATO',
  AVVIO_SMALTIMENTO: 'AVVIATO',
  CESSIONE: 'AVVIATO',
}
function vecchiaClassificazione(type: 'CARICO' | 'SCARICO', causale: string): Ruolo {
  const mappa = type === 'CARICO' ? RUOLO_CARICO : RUOLO_SCARICO
  return Object.prototype.hasOwnProperty.call(mappa, causale) ? mappa[causale] : 'ESCLUSO'
}
function vecchiaOperazione(causale: string): 'R' | 'D' | undefined {
  if (causale === 'AVVIO_RECUPERO') return 'R'
  if (causale === 'AVVIO_SMALTIMENTO') return 'D'
  return undefined
}
// FINE ORACOLO

type Verso = 'CARICO' | 'SCARICO'

describe('MudAggregazioneService con il catalogo — Postgres reale, ruolo wasteflow_app', () => {
  const owner = new PrismaClient({ datasourceUrl: urlProprietario })
  let app: PrismaService
  let service: MudAggregazioneService
  const tenantCreati: string[] = []
  let n = 0
  let numero = 0

  const nelTenant = <R>(tenantId: string, fn: () => Promise<R>) =>
    TenantContext.run({ tenantId }, async () => await fn())

  async function azienda(): Promise<{ tenantId: string; registroId: string }> {
    const suffisso = `${Date.now()}${++n}`.slice(-9)
    const t = await owner.tenant.create({
      data: { partitaIva: `MC${suffisso}`, ragioneSociale: 'MUD causali SRL', country: 'IT' },
    })
    tenantCreati.push(t.id)
    const r = await owner.registroRifiuti.create({
      data: { tenantId: t.id, descrizione: 'Registro cronologico' },
    })
    return { tenantId: t.id, registroId: r.id }
  }

  async function versione(
    tenantId: string,
    o: { codice: string; verso: Verso; ruolo: string; operazione?: string; dal: string }
  ): Promise<string> {
    const righe = await owner.$queryRawUnsafe<{ id: string }[]>(
      `INSERT INTO causali_registro_azienda
         (tenant_id, natura, codice, verso, descrizione, ruolo_mud, operazione, valida_dal,
          creato_da, updated_at)
       VALUES ($1::uuid, 'PROPRIA', $2, $3::waste_movement_type, 'Prova', $4::ruolo_mud_causale,
               $5, $6::date, $7::uuid, now())
       RETURNING id::text AS id`,
      tenantId,
      o.codice,
      o.verso,
      o.ruolo,
      o.operazione ?? null,
      o.dal,
      randomUUID()
    )
    return righe[0].id
  }

  async function movimento(
    a: { tenantId: string; registroId: string },
    m: {
      type: Verso
      causale: string
      causaleAziendaId?: string | null
      quantita: number
      quando: string
    }
  ): Promise<void> {
    await owner.$executeRawUnsafe(
      `INSERT INTO waste_movements
         (tenant_id, registro_id, type, movement_date, registration_date, causale,
          causale_azienda_id, cer_code, quantity, unit, progressive_year, progressive_number,
          updated_at)
       VALUES ($1::uuid, $2::uuid, $3::waste_movement_type, $4::timestamp, $4::timestamp, $5,
               $6::uuid, '20 03 01', $7, 'KG', 2025, $8, now())`,
      a.tenantId,
      a.registroId,
      m.type,
      m.quando,
      m.causale,
      m.causaleAziendaId ?? null,
      m.quantita,
      ++numero
    )
  }

  const aggrega = (tenantId: string, anno: number) =>
    nelTenant(tenantId, () => service.aggrega(tenantId, anno))

  beforeAll(async () => {
    expect(process.env.DATABASE_URL ?? '').toContain(':55432/')
    app = creaPrismaServiceApplicativo()
    await app.onModuleInit()
    const [a] = await app.$queryRaw<{ u: string }[]>`SELECT current_user AS u`
    expect(a.u).toBe('wasteflow_app')
    const logger: any = { setContext: jest.fn(), info: jest.fn(), warn: jest.fn() }
    service = new MudAggregazioneService(app, { findComuneByName: jest.fn() } as any, logger)
  })

  afterAll(async () => {
    await owner.wasteMovement.deleteMany({ where: { tenantId: { in: tenantCreati } } })
    await owner.causaleRegistroAzienda.deleteMany({ where: { tenantId: { in: tenantCreati } } })
    await owner.registroRifiuti.deleteMany({ where: { tenantId: { in: tenantCreati } } })
    await owner.tenant.deleteMany({ where: { id: { in: tenantCreati } } })
    await app.onModuleDestroy()
    await owner.$disconnect()
  })

  it('movimenti di sistema: stesso hashAggregato calcolato con la vecchia implementazione', async () => {
    const a = await azienda()
    const movimenti: Array<{ type: Verso; causale: string; quantita: number }> = [
      { type: 'CARICO', causale: 'PRODUZIONE_INTERNA', quantita: 100 },
      { type: 'CARICO', causale: 'RECUPERO_PARZIALE', quantita: 50 },
      { type: 'CARICO', causale: 'INGRESSO_ESTERNO', quantita: 20 },
      { type: 'CARICO', causale: 'ALTRO_CARICO', quantita: 7 },
      { type: 'CARICO', causale: 'RICLASSIFICAZIONE', quantita: 3 },
      { type: 'SCARICO', causale: 'AVVIO_RECUPERO', quantita: 30 },
      { type: 'SCARICO', causale: 'AVVIO_SMALTIMENTO', quantita: 40 },
      { type: 'SCARICO', causale: 'CONFERIMENTO_TRASPORTATORE', quantita: 10 },
      { type: 'SCARICO', causale: 'CESSIONE', quantita: 5 },
      { type: 'SCARICO', causale: 'ALTRO_SCARICO', quantita: 2 },
      { type: 'SCARICO', causale: 'RICLASSIFICAZIONE', quantita: 1 },
    ]
    let i = 0
    for (const m of movimenti) {
      await movimento(a, { ...m, quando: `2025-0${3 + (i++ % 3)}-10T08:00:00` })
    }

    const r = await aggrega(a.tenantId, 2025)

    // Quantità attese dall'oracolo: prodotto dai PRODOTTO, avviato R/D dalle operazioni.
    let prodotto = 0
    let recupero = 0
    let smaltimento = 0
    for (const m of movimenti) {
      const ruolo = vecchiaClassificazione(m.type, m.causale)
      if (ruolo === 'PRODOTTO') prodotto += m.quantita
      if (ruolo === 'AVVIATO') {
        // senza FIR né codice operazione e senza R/D dalla causale, il predefinito è D
        if (vecchiaOperazione(m.causale) === 'R') recupero += m.quantita
        else smaltimento += m.quantita
      }
    }
    expect(r.righe).toHaveLength(1)
    expect(r.righe[0]).toMatchObject({
      prodottoKg: prodotto,
      recuperoKg: recupero,
      smaltimentoKg: smaltimento,
    })
    const attese = [
      { ...r.righe[0], prodottoKg: prodotto, recuperoKg: recupero, smaltimentoKg: smaltimento },
    ]
    expect(hashAggregato(r.righe)).toBe(hashAggregato(attese))
    expect(prodotto).toBe(150)
    expect(recupero).toBe(30)
    expect(smaltimento).toBe(55)
  })

  it('una nuova versione della causale aziendale non cambia il MUD dell’anno prima', async () => {
    const a = await azienda()
    const v1 = await versione(a.tenantId, {
      codice: 'AZ_BIO',
      verso: 'CARICO',
      ruolo: 'PRODOTTO',
      dal: '2025-01-01',
    })
    await movimento(a, {
      type: 'CARICO',
      causale: 'AZ_BIO',
      causaleAziendaId: v1,
      quantita: 80,
      quando: '2025-04-10T08:00:00',
    })
    const prima = await aggrega(a.tenantId, 2025)
    expect(prima.righe[0].prodottoKg).toBe(80)

    // 2026: la versione 1 si chiude e una nuova versione cambia il ruolo in ESCLUSO.
    await owner.$executeRawUnsafe(
      `UPDATE causali_registro_azienda SET valida_al = '2025-12-31'::date WHERE id = $1::uuid`,
      v1
    )
    await versione(a.tenantId, {
      codice: 'AZ_BIO',
      verso: 'CARICO',
      ruolo: 'ESCLUSO',
      dal: '2026-01-01',
    })

    const dopo = await aggrega(a.tenantId, 2025)
    expect(hashAggregato(dopo.righe)).toBe(hashAggregato(prima.righe))
    expect(dopo.righe[0].prodottoKg).toBe(80)
    expect(dopo.controlli.map(c => c.codice)).not.toContain('CAUSALE_ESCLUSA')
  })

  it('il catalogo di un’altra azienda non influisce', async () => {
    const a = await azienda()
    const b = await azienda()
    await versione(b.tenantId, {
      codice: 'AZ_ALTRA',
      verso: 'CARICO',
      ruolo: 'PRODOTTO',
      dal: '2025-01-01',
    })
    await movimento(a, {
      type: 'CARICO',
      causale: 'PRODUZIONE_INTERNA',
      quantita: 11,
      quando: '2025-05-10T08:00:00',
    })
    const r = await aggrega(a.tenantId, 2025)
    expect(r.righe[0].prodottoKg).toBe(11)
  })
})
