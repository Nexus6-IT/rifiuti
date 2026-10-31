/**
 * Tabelle di fatturazione del cliente (Fase 4 pezzo 1, migration
 * `20261102200000_anagrafiche_fatturazione_cliente`) contro un Postgres reale, collegato COME
 * `wasteflow_app`, dentro il `TenantContext`: CHECK, unici, RLS e cascata sul tenant. Il
 * proprietario prepara i dati. Pulizia solo per id esatti creati (la cascata sul tenant svuota
 * le sei tabelle).
 */
import { PrismaClient } from '@prisma/client'
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

import { TenantContext } from '../../core/context/tenant-context'
import {
  PrismaService,
  creaPrismaServiceApplicativo,
} from '../../infrastructure/persistence/prisma.service'
import { partitaIvaValida } from '../../test-support/anagrafiche-di-test'

describe('Tabelle di fatturazione — Postgres reale, ruolo wasteflow_app', () => {
  const owner = new PrismaClient({ datasourceUrl: urlProprietario })
  let app: PrismaService
  const tenantCreati: string[] = []
  let n = 0

  const nel = <R>(tenantId: string, fn: () => Promise<R>) =>
    TenantContext.run({ tenantId }, async () => await fn())

  beforeAll(() => {
    expect(eDatabaseDiTestLocale(urlProprietario)).toBe(true)
    app = creaPrismaServiceApplicativo()
  })

  afterAll(async () => {
    if (tenantCreati.length > 0) {
      await owner.tenant.deleteMany({ where: { id: { in: tenantCreati } } })
    }
    await owner.$disconnect()
    await app?.$disconnect()
  })

  async function azienda(): Promise<string> {
    const t = await owner.tenant.create({
      data: {
        partitaIva: partitaIvaValida(Date.now() + ++n),
        ragioneSociale: 'Fatturazione schema SRL',
        country: 'IT',
      },
    })
    tenantCreati.push(t.id)
    return t.id
  }

  const esito = async (p: Promise<unknown>) => {
    try {
      await p
    } catch (e: any) {
      return { code: e.code as string | undefined, msg: String(e.message) }
    }
    return null
  }

  const condizione = (tenantId: string, extra: Record<string, unknown> = {}) => ({
    tenantId,
    codice: 'RB30',
    descrizione: 'Ricevuta bancaria 30 giorni',
    modalita: 'MP12',
    giorniRate: [30],
    fineMese: false,
    ...extra,
  })

  it('condizione con 9 rate respinta', async () => {
    const t = await azienda()
    const r = await esito(
      nel(t, () =>
        app.condizionePagamento.create({
          data: condizione(t, { giorniRate: [10, 20, 30, 40, 50, 60, 70, 80, 90] }),
        })
      )
    )
    expect(r?.msg).toContain('condizioni_pagamento_rate_ammesse')
  })

  it('due condizioni con lo stesso codice: P2002', async () => {
    const t = await azienda()
    await nel(t, () => app.condizionePagamento.create({ data: condizione(t) }))
    const r = await esito(nel(t, () => app.condizionePagamento.create({ data: condizione(t) })))
    expect(r?.code).toBe('P2002')
  })

  it('due conti con lo stesso IBAN: P2002 su conti_correnti_tenant_id_iban_key', async () => {
    const t = await azienda()
    const conto = (codice: string) => ({
      tenantId: t,
      codice,
      descrizione: 'Conto principale',
      banca: 'Banca di prova',
      iban: 'IT60X0542811101000000123456',
    })
    await nel(t, () => app.contoCorrente.create({ data: conto('C1') }))
    const r = await esito(nel(t, () => app.contoCorrente.create({ data: conto('C2') })))
    expect(r?.code).toBe('P2002')
    // I codici sono diversi: a respingere e' solo l'unico sull'IBAN. Prisma non riporta il nome
    // del vincolo nel messaggio, quindi se ne verifica l'esistenza nel catalogo.
    const indici = await owner.$queryRaw<Array<{ indexname: string }>>`
      SELECT indexname FROM pg_indexes
      WHERE tablename = 'conti_correnti' AND indexname = 'conti_correnti_tenant_id_iban_key'`
    expect(indici).toHaveLength(1)
  })

  it('stessa spesa con tipo diverso ammessa, stesso tipo e codice respinta', async () => {
    const t = await azienda()
    const spesa = (tipo: 'INCASSO' | 'BOLLO') => ({
      tenantId: t,
      tipo,
      codice: 'S1',
      descrizione: 'Spesa',
      importo: '2.00',
    })
    await nel(t, () => app.spesaAccessoria.create({ data: spesa('INCASSO') }))
    await nel(t, () => app.spesaAccessoria.create({ data: spesa('BOLLO') }))
    const r = await esito(nel(t, () => app.spesaAccessoria.create({ data: spesa('BOLLO') })))
    expect(r?.code).toBe('P2002')
  })

  it('importo negativo respinto', async () => {
    const t = await azienda()
    const r = await esito(
      nel(t, () =>
        app.spesaAccessoria.create({
          data: {
            tenantId: t,
            tipo: 'INCASSO',
            codice: 'S2',
            descrizione: 'Neg',
            importo: '-1.00',
          },
        })
      )
    )
    expect(r?.msg).toContain('spese_accessorie_importo_non_negativo')
  })

  it('registro con codice "1" respinto', async () => {
    const t = await azienda()
    const r = await esito(
      nel(t, () =>
        app.registroIva.create({ data: { tenantId: t, codice: '1', descrizione: 'Uno' } })
      )
    )
    expect(r?.msg).toContain('registri_iva_codice_due_cifre')
    await nel(t, () =>
      app.registroIva.create({ data: { tenantId: t, codice: '01', descrizione: 'Uno' } })
    )
  })

  it('testo con 17 righe respinto', async () => {
    const t = await azienda()
    const testo = (righe: string[]) => ({ tenantId: t, codice: 'T1', titolo: 'Testo', righe })
    const r = await esito(
      nel(t, () =>
        app.testoFatturazione.create({
          data: testo(Array.from({ length: 17 }, (_, i) => `riga ${i}`)),
        })
      )
    )
    expect(r?.msg).toContain('testi_fatturazione_righe_ammesse')
    await nel(t, () => app.testoFatturazione.create({ data: testo(['una riga']) }))
  })

  it('codifica: stesso codice in generi diversi ammesso', async () => {
    const t = await azienda()
    const cod = (genere: 'CATEGORIA' | 'TIPO' | 'MOTIVO_ANNULLO') => ({
      tenantId: t,
      genere,
      codice: '001',
      descrizione: 'Prima',
    })
    await nel(t, () => app.codificaContratto.create({ data: cod('CATEGORIA') }))
    await nel(t, () => app.codificaContratto.create({ data: cod('TIPO') }))
    const r = await esito(nel(t, () => app.codificaContratto.create({ data: cod('TIPO') })))
    expect(r?.code).toBe('P2002')
  })

  async function popola(t: string) {
    await owner.condizionePagamento.create({ data: condizione(t) })
    await owner.contoCorrente.create({
      data: {
        tenantId: t,
        codice: 'C1',
        descrizione: 'C',
        banca: 'B',
        iban: 'IT60X0542811101000000123456',
      },
    })
    await owner.spesaAccessoria.create({
      data: { tenantId: t, tipo: 'BOLLO', codice: 'B1', descrizione: 'Bollo', importo: '2.00' },
    })
    await owner.registroIva.create({ data: { tenantId: t, codice: '01', descrizione: 'Vendite' } })
    await owner.testoFatturazione.create({
      data: { tenantId: t, codice: 'T1', titolo: 'T', righe: ['a'] },
    })
    await owner.codificaContratto.create({
      data: { tenantId: t, genere: 'CATEGORIA', codice: '001', descrizione: 'Cat' },
    })
  }

  it('nel contesto di B le sei tabelle di A sono vuote e un insert con tenant di A è respinto', async () => {
    const a = await azienda()
    const b = await azienda()
    await popola(a)
    const conteggi = await nel(b, async () => [
      await app.condizionePagamento.count(),
      await app.contoCorrente.count(),
      await app.spesaAccessoria.count(),
      await app.registroIva.count(),
      await app.testoFatturazione.count(),
      await app.codificaContratto.count(),
    ])
    expect(conteggi).toEqual([0, 0, 0, 0, 0, 0])
    const r = await esito(
      nel(b, () =>
        app.registroIva.create({ data: { tenantId: a, codice: '02', descrizione: 'X' } })
      )
    )
    expect(r).not.toBeNull()
    expect(r?.msg).toMatch(/row-level security|Unique|violates/i)
  })

  it('cancellare il tenant cancella le sei tabelle', async () => {
    const t = await azienda()
    await popola(t)
    await owner.tenant.deleteMany({ where: { id: { in: [t] } } })
    tenantCreati.splice(tenantCreati.indexOf(t), 1)
    const where = { tenantId: { in: [t] } }
    expect(
      await Promise.all([
        owner.condizionePagamento.count({ where }),
        owner.contoCorrente.count({ where }),
        owner.spesaAccessoria.count({ where }),
        owner.registroIva.count({ where }),
        owner.testoFatturazione.count({ where }),
        owner.codificaContratto.count({ where }),
      ])
    ).toEqual([0, 0, 0, 0, 0, 0])
  })
})
