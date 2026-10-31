/**
 * Lettore delle annotazioni per RENTRI (Fase 2 pezzo 9, Task 6) contro un Postgres reale, COME
 * `wasteflow_app` (RLS) dentro il `TenantContext` e in una transazione. Il proprietario prepara
 * aziende, anagrafiche, FIR e movimenti; la pulizia toglie solo gli id creati qui.
 */
import { PrismaClient } from '@prisma/client'
import { urlComeRuolo } from '../../../infrastructure/database/client-come-ruolo'

const urlProprietario =
  process.env.DATABASE_URL ??
  'postgresql://wasteflow:wasteflow_ci@127.0.0.1:55438/wasteflow_ci?schema=public'
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
import { creaDittaConRuolo, partitaIvaValida } from '../../../test-support/anagrafiche-di-test'
import { LettoreAnnotazioniRentri } from './lettore-annotazioni-rentri'
import { traduciAnnotazione } from './mappa-registrazione-rentri'

describe('LettoreAnnotazioniRentri — Postgres reale, ruolo wasteflow_app', () => {
  const owner = new PrismaClient({ datasourceUrl: urlProprietario })
  let app: PrismaService
  const tenantCreati: string[] = []
  const logger: any = {
    setContext: jest.fn(),
    warn: jest.fn(),
    info: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  }
  let comuneCreato = false
  let n = 0
  let progressivo = 0

  const nelTenant = <R>(tenantId: string, fn: () => Promise<R>) =>
    TenantContext.run({ tenantId }, async () => await fn())

  const leggi = (tenantId: string, registroId: string, ids: string[]) =>
    nelTenant(tenantId, () =>
      app.$transaction(tx =>
        new LettoreAnnotazioniRentri(logger).leggi(tx, tenantId, registroId, ids)
      )
    )

  async function scenario() {
    const t = await owner.tenant.create({
      data: {
        partitaIva: partitaIvaValida(Date.now() + ++n),
        ragioneSociale: 'Lettore RENTRI SRL',
        country: 'IT',
      },
    })
    tenantCreati.push(t.id)
    const sede = await owner.rentriUnitaLocale.create({
      data: {
        tenantId: t.id,
        numIscrSito: `OP0001LR${String(++n).padStart(6, '0')}-MI0001`,
        denominazione: 'Sede',
        principale: true,
      },
    })
    const registro = await owner.registroRifiuti.create({
      data: { tenantId: t.id, unitaLocaleId: sede.id, descrizione: 'Registro di prova' },
    })
    const user = await owner.user.create({
      data: {
        tenantId: t.id,
        keycloakId: `keycloak-lr-${Date.now()}-${++n}`,
        fiscalCode: 'RSSMRA80A01H501U',
        firstName: 'Mario',
        lastName: 'Rossi',
        email: `lr-${Date.now()}-${n}@example.com`,
        role: 'OPERATOR',
      },
    })
    const produttore = await creaDittaConRuolo(owner, t.id, 'PRODUTTORE')
    const trasportatore = await creaDittaConRuolo(owner, t.id, 'TRASPORTATORE', {
      numeroDocumento: 'MI/123456',
    })
    const destinatario = await creaDittaConRuolo(owner, t.id, 'DESTINATARIO', {
      numeroDocumento: 'AUT-1',
    })
    const fir = await owner.fIR.create({
      data: {
        tenantId: t.id,
        producerUserId: user.id,
        producerId: produttore.ruoloId,
        carrierId: trasportatore.ruoloId,
        receiverId: destinatario.ruoloId,
        producerPartitaIva: '00000000000',
        producerName: 'Snapshot produttore',
        producerAddress: 'Via Roma 1',
        carrierPartitaIva: '00000000001',
        carrierName: 'Snapshot trasportatore',
        carrierVehiclePlate: 'AB123CD',
        receiverPartitaIva: '00000000002',
        receiverName: 'Snapshot destinatario',
        receiverAddress: 'Via Roma 2',
        cerCode: '15 01 01',
        wasteDescription: 'Imballaggi di carta',
        wasteCategory: 'Non pericoloso',
        quantity: 60,
        transportDate: new Date('2026-03-05T08:00:00Z'),
        actualArrivalDate: new Date('2026-03-05T12:00:00Z'),
        effectiveWeight: 59.5,
        provenienza: 'SPECIALE',
        firNumber: `FIR/LR/${n}`,
      },
    })
    const base = {
      tenantId: t.id,
      registroId: registro.id,
      progressiveYear: 2026,
      cerCode: '15 01 01',
      unit: 'KG',
      wastePhysicalState: 'Solido',
    }
    const carico = await owner.wasteMovement.create({
      data: {
        ...base,
        progressiveNumber: ++progressivo,
        type: 'CARICO',
        movementDate: new Date('2026-03-01T10:00:00Z'),
        registrationDate: new Date('2026-03-01T10:00:00Z'),
        causale: 'PRODUZIONE_INTERNA',
        quantity: 100,
      },
    })
    const scarico = await owner.wasteMovement.create({
      data: {
        ...base,
        progressiveNumber: ++progressivo,
        type: 'SCARICO',
        movementDate: new Date('2026-03-05T10:00:00Z'),
        registrationDate: new Date('2026-03-05T10:00:00Z'),
        causale: 'CONFERIMENTO_TRASPORTATORE',
        quantity: 60,
        firId: fir.id,
      },
    })
    const rettifica = await owner.wasteMovement.create({
      data: {
        ...base,
        progressiveNumber: ++progressivo,
        type: 'SCARICO',
        movementDate: new Date('2026-03-05T10:00:00Z'),
        registrationDate: new Date('2026-03-06T10:00:00Z'),
        causale: 'CONFERIMENTO_TRASPORTATORE',
        quantity: 50,
        firId: fir.id,
        tipoAnnotazione: 'RETTIFICA',
        movimentoRettificatoId: scarico.id,
        movimentoOriginaleId: scarico.id,
        motivoAnnotazione: 'quantita corretta',
      },
    })
    return { tenantId: t.id, registroId: registro.id, carico, scarico, rettifica }
  }

  beforeAll(async () => {
    app = creaPrismaServiceApplicativo()
    await app.onModuleInit()
    if (!(await owner.istatComune.findUnique({ where: { code: '058091' } }))) {
      await owner.istatComune.create({
        data: { code: '058091', name: 'Roma', provinciaSigla: 'RM' },
      })
      comuneCreato = true
    }
  })

  afterAll(async () => {
    if (tenantCreati.length > 0) {
      const filtro = { tenantId: { in: tenantCreati } }
      // Le catene si cancellano in un solo statement (chiavi esterne NO ACTION).
      await owner.wasteMovement.deleteMany({ where: filtro })
      await owner.fIR.deleteMany({ where: filtro })
      await owner.user.deleteMany({ where: filtro })
      await owner.registroRifiuti.deleteMany({ where: filtro })
      await owner.rentriUnitaLocale.deleteMany({ where: filtro })
      await owner.tenant.deleteMany({ where: { id: { in: tenantCreati } } })
    }
    if (comuneCreato) await owner.istatComune.deleteMany({ where: { code: '058091' } })
    await app.onModuleDestroy()
    await owner.$disconnect()
  })

  it("tre annotazioni, tutte traducibili; riferimenti sulla rettifica e non sull'originale", async () => {
    const s = await scenario()
    const ids = [s.carico.id, s.scarico.id, s.rettifica.id]
    const annotazioni = await leggi(s.tenantId, s.registroId, ids)
    expect(annotazioni.map(a => a.movimentoId)).toEqual(ids)

    for (const a of annotazioni) {
      const esito = traduciAnnotazione(a)
      if (!esito.ok) throw new Error(`non traducibile: ${esito.motivi.join(' | ')}`)
    }
    const [carico, scarico, rettifica] = annotazioni
    expect(carico.codiceRentri).toBe('DT')
    expect(scarico.codiceRentri).toBe('aT')
    expect(scarico.riferimentiCarico).toEqual([])
    expect(rettifica.tipoAnnotazione).toBe('RETTIFICA')
    expect(rettifica.predecessore).toEqual(scarico.numero)
    expect(rettifica.riferimentiCarico).toEqual([carico.numero])
    expect(rettifica.fir?.destinatario?.numeroAutorizzazione).toBe('AUT-1')
    expect(rettifica.fir?.trasportatore?.numeroIscrizioneAlbo).toBe('MI/123456')
    expect(rettifica.fir?.pesoVerificatoDestinoKg).toBe(59.5)
    expect(rettifica.fir?.provenienza).toBe('S')
    expect(rettifica.fir?.produttore?.indirizzo?.citta.comune_id).toBe('058091')
  })

  it('con il contesto di B e i parametri di A la RLS nasconde tutto: errore, non dati', async () => {
    const a = await scenario()
    const b = await scenario()
    // Prova che la RLS e' attiva: B non vede nemmeno le righe di A con una query diretta.
    const viste = await nelTenant(b.tenantId, () =>
      app.$transaction(tx => tx.wasteMovement.findMany({ where: { registroId: a.registroId } }))
    )
    expect(viste).toEqual([])
    // Il lettore, chiesto con i parametri di A nel contesto di B, non restituisce dati di A.
    await expect(leggi(b.tenantId, a.registroId, [a.carico.id])).rejects.toThrow(
      /errore di programmazione/
    )
  })
})
