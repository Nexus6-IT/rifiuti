/**
 * Giacenze iniziali (Fase 2 pezzo 2, Task 1) contro un Postgres reale, collegato COME
 * `wasteflow_app` (RLS ENABLE+FORCE soggetta alle policy), dentro il `TenantContext` dell'azienda:
 * un test da superuser non vedrebbe i difetti della RLS.
 *
 * Il proprietario (`wasteflow`, superuser) prepara aziende, sedi e movimenti e legge cio' che e'
 * stato scritto; la pulizia toglie solo le righe create qui.
 */
import { PrismaClient } from '@prisma/client'
import { urlComeRuolo } from '../../infrastructure/database/client-come-ruolo'

const urlProprietario =
  process.env.DATABASE_URL ??
  'postgresql://wasteflow:wasteflow_ci@127.0.0.1:55432/wasteflow_ci?schema=public'
// I servizi dell'applicazione leggono DATABASE_URL, come in produzione.
process.env.DATABASE_URL = urlComeRuolo(
  'wasteflow_app',
  process.env.DB_APP_PASSWORD ?? 'wasteflow_app_dev',
  urlProprietario
)

import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common'
import { TenantContext } from '../../core/context/tenant-context'
import {
  PrismaService,
  creaPrismaServiceApplicativo,
} from '../../infrastructure/persistence/prisma.service'
import { RegistriService } from './registri.service'
import { GiacenzeInizialiService, DatiGiacenzaIniziale } from './giacenze-iniziali.service'
import { RegistraMovimentoUseCase } from './use-cases/registra-movimento.use-case'
import { RegistraMovimentoCommand } from './commands/registra-movimento.command'
import { giornoItaliano } from '../../core/time/anno-italiano'

const loggerStub = { setContext() {}, info() {}, warn() {}, error() {}, debug() {} }

describe('Giacenze iniziali — Postgres reale, ruolo wasteflow_app', () => {
  // Due CER di test: uno senza asterisco e uno con (il catalogo li ha entrambi nella forma indicata).
  const CER = '99 99 04'
  const CER_STELLA = '99 99 05*'
  const OGGI = giornoItaliano(new Date())
  const owner = new PrismaClient({ datasourceUrl: urlProprietario })
  let app: PrismaService
  let registri: RegistriService
  let servizio: GiacenzeInizialiService
  let useCase: RegistraMovimentoUseCase
  let userId: string
  const cerCreati: string[] = []
  const tenantCreati: string[] = []
  let n = 0

  const nelTenant = <R>(tenantId: string, fn: () => Promise<R>) =>
    TenantContext.run({ tenantId }, async () => await fn())

  async function azienda() {
    const suffisso = `${Date.now()}${++n}`.slice(-9)
    const t = await owner.tenant.create({
      data: { partitaIva: `GI${suffisso}`, ragioneSociale: 'Giacenze iniziali SRL', country: 'IT' },
    })
    tenantCreati.push(t.id)
    const viste = await nelTenant(t.id, () => registri.assicuraRegistri(t.id))
    return { tenantId: t.id, registroId: viste[0]?.id as string | undefined }
  }

  /** Azienda con un registro (senza sede). */
  async function aziendaConRegistro() {
    const a = await azienda()
    // senza sedi assicuraRegistri non crea nulla finche' non c'e' un movimento: lo creiamo via preparaRegistri
    await nelTenant(a.tenantId, () => registri.preparaRegistri(a.tenantId))
    const registro = await owner.registroRifiuti.findFirst({ where: { tenantId: a.tenantId } })
    return { tenantId: a.tenantId, registroId: registro!.id }
  }

  const dati = (extra: Partial<DatiGiacenzaIniziale> = {}): DatiGiacenzaIniziale => ({
    cerCode: CER,
    quantita: 100,
    unita: 'kg',
    dataRiferimento: '2026-01-01',
    ...extra,
  })

  const crea = (tenantId: string, d: DatiGiacenzaIniziale, registroId?: string) =>
    nelTenant(tenantId, () => servizio.crea(tenantId, userId, d, registroId))

  /** Movimento direttamente dal proprietario (nessuna giacenza da verificare). */
  async function movimentoDiretto(
    tenantId: string,
    registroId: string,
    opzioni: { type: 'CARICO' | 'SCARICO'; cer?: string; causale?: string; createdAt?: Date }
  ) {
    const numero = (await owner.wasteMovement.count({ where: { registroId } })) + 1
    return owner.wasteMovement.create({
      data: {
        tenantId,
        registroId,
        type: opzioni.type,
        movementDate: new Date(),
        registrationDate: new Date(),
        causale:
          opzioni.causale ??
          (opzioni.type === 'CARICO' ? 'ALTRO_CARICO' : 'CONFERIMENTO_TRASPORTATORE'),
        cerCode: opzioni.cer ?? CER,
        wasteDescription: 'Rifiuto di test',
        quantity: 10,
        unit: 'KG',
        progressiveYear: 2026,
        progressiveNumber: numero,
        ...(opzioni.createdAt ? { createdAt: opzioni.createdAt } : {}),
      } as never,
    })
  }

  /** Scarico di oggi registrato dal caso d'uso reale (controllo di giacenza compreso). */
  const scaricoReale = (tenantId: string, registroId: string, qty: number, cer = CER) => {
    const adesso = new Date()
    return nelTenant(tenantId, () =>
      useCase.execute(
        new RegistraMovimentoCommand(
          tenantId,
          undefined as unknown as string,
          'SCARICO',
          adesso,
          adesso,
          'CONFERIMENTO_TRASPORTATORE',
          cer,
          undefined,
          qty,
          'KG',
          undefined,
          undefined,
          undefined,
          undefined,
          undefined,
          undefined,
          undefined,
          registroId
        )
      )
    )
  }

  beforeAll(async () => {
    app = creaPrismaServiceApplicativo()
    await app.onModuleInit()
    registri = new RegistriService(app, loggerStub as never)
    servizio = new GiacenzeInizialiService(app, registri)
    useCase = new RegistraMovimentoUseCase(app, loggerStub as never, registri)
    const [a] = await app.$queryRaw<{ u: string }[]>`SELECT current_user AS u`
    expect(a.u).toBe('wasteflow_app')
    const tenantUtente = await owner.tenant.create({
      data: {
        partitaIva: `GU${Date.now()}`.slice(0, 11),
        ragioneSociale: 'Utente SRL',
        country: 'IT',
      },
    })
    tenantCreati.push(tenantUtente.id)
    userId = (
      await owner.user.create({
        data: {
          tenantId: tenantUtente.id,
          keycloakId: `keycloak-giacenze-iniziali-${Date.now()}`,
          fiscalCode: 'RSSMRA80A01H501U',
          firstName: 'Mario',
          lastName: 'Rossi',
          email: `giacenze-iniziali-${Date.now()}@example.com`,
          role: 'ADMIN',
        },
      })
    ).id
    for (const code of [CER, CER_STELLA]) {
      if ((await owner.cERCode.count({ where: { code } })) === 0) cerCreati.push(code)
      await owner.cERCode.upsert({
        where: { code },
        create: { code, description: 'CER di test', category: '99', subcategory: '' },
        update: {},
      })
    }
  })

  afterAll(async () => {
    await owner.activityLog.deleteMany({ where: { tenantId: { in: tenantCreati } } })
    await owner.giacenzaIniziale.deleteMany({ where: { tenantId: { in: tenantCreati } } })
    await owner.wasteMovement.deleteMany({ where: { tenantId: { in: tenantCreati } } })
    await owner.registroRifiuti.deleteMany({ where: { tenantId: { in: tenantCreati } } })
    if (userId) await owner.user.deleteMany({ where: { id: userId } })
    await owner.tenant.deleteMany({ where: { id: { in: tenantCreati } } })
    if (cerCreati.length > 0) await owner.cERCode.deleteMany({ where: { code: { in: cerCreati } } })
    await app.onModuleDestroy()
    await owner.$disconnect()
  })

  it('crea, elenca, modifica ed elimina; la data esce come YYYY-MM-DD e il CER nella forma del catalogo', async () => {
    const az = await aziendaConRegistro()
    const { giacenza, avvisi } = await crea(az.tenantId, dati({ cerCode: '999905' }), az.registroId)
    expect(avvisi).toEqual([])
    expect(giacenza).toMatchObject({
      registroId: az.registroId,
      cerCode: CER_STELLA,
      quantita: 100,
      unita: 'KG',
      dataRiferimento: '2026-01-01',
      provenienza: 'MANUALE',
      origini: [],
      impostatoDa: userId,
    })

    const elenco = await nelTenant(az.tenantId, () => servizio.elenca(az.tenantId))
    expect(elenco.registroId).toBe(az.registroId)
    expect(elenco.voci).toHaveLength(1)
    expect(elenco.voci[0]).toMatchObject({ id: giacenza.id, modificabile: true })

    const { giacenza: dopo } = await nelTenant(az.tenantId, () =>
      servizio.modifica(az.tenantId, userId, giacenza.id, {
        quantita: 250.5,
        unita: 't',
        statoFisico: 'liquido',
        dataRiferimento: '2026-02-03',
        origini: [{ anno: 2025, protocollo: 7, quantita: 100 }],
        note: 'inventario',
      })
    )
    expect(dopo).toMatchObject({
      cerCode: CER_STELLA,
      quantita: 250.5,
      unita: 'T',
      statoFisico: 'LIQUIDO',
      dataRiferimento: '2026-02-03',
      note: 'inventario',
      origini: [{ anno: 2025, protocollo: 7, quantita: 100 }],
    })

    await nelTenant(az.tenantId, () => servizio.elimina(az.tenantId, userId, giacenza.id))
    expect(await owner.giacenzaIniziale.count({ where: { tenantId: az.tenantId } })).toBe(0)

    const azioni = (
      await owner.activityLog.findMany({
        where: { tenantId: az.tenantId },
        orderBy: { createdAt: 'asc' },
        select: { action: true },
      })
    ).map(a => a.action)
    expect(azioni).toEqual([
      'REGISTRO_GIACENZA_INIZIALE_CREATA',
      'REGISTRO_GIACENZA_INIZIALE_MODIFICATA',
      'REGISTRO_GIACENZA_INIZIALE_ELIMINATA',
    ])
  })

  describe('unicita (G3)', () => {
    it('stesso CER con e senza asterisco: conflitto', async () => {
      const az = await aziendaConRegistro()
      await crea(az.tenantId, dati({ cerCode: '99 99 05' }), az.registroId)
      await expect(
        crea(az.tenantId, dati({ cerCode: '99 99 05*' }), az.registroId)
      ).rejects.toBeInstanceOf(ConflictException)
    })

    it('kg contro tonnellate: conflitto; kg contro litri: ammesso', async () => {
      const az = await aziendaConRegistro()
      await crea(az.tenantId, dati({ unita: 'kg' }), az.registroId)
      await expect(crea(az.tenantId, dati({ unita: 't' }), az.registroId)).rejects.toBeInstanceOf(
        ConflictException
      )
      await expect(crea(az.tenantId, dati({ unita: 'L' }), az.registroId)).resolves.toBeDefined()
    })

    it('stato fisico diverso: ammesso; stesso stato fisico NULL due volte: conflitto', async () => {
      const az = await aziendaConRegistro()
      await crea(az.tenantId, dati({ statoFisico: 'solido' }), az.registroId)
      await expect(
        crea(az.tenantId, dati({ statoFisico: 'liquido' }), az.registroId)
      ).resolves.toBeDefined()
      await crea(az.tenantId, dati({ cerCode: '99 99 05' }), az.registroId)
      await expect(
        crea(az.tenantId, dati({ cerCode: '99 99 05' }), az.registroId)
      ).rejects.toBeInstanceOf(ConflictException)
    })

    it("anche nel database: un insert diretto con stato fisico NULL duplicato e' respinto (NULLS NOT DISTINCT)", async () => {
      const az = await aziendaConRegistro()
      const base = {
        tenantId: az.tenantId,
        registroId: az.registroId,
        cerCode: CER,
        statoFisico: null,
        quantita: 5,
        unita: 'KG',
        dataRiferimento: new Date('2026-01-01T00:00:00.000Z'),
        impostatoDa: userId,
      }
      await owner.giacenzaIniziale.create({ data: base })
      await expect(owner.giacenzaIniziale.create({ data: base })).rejects.toMatchObject({
        code: 'P2002',
      })
    })

    it("anche nel database: quantita <= 0 e' respinta dal CHECK", async () => {
      const az = await aziendaConRegistro()
      await expect(
        owner.giacenzaIniziale.create({
          data: {
            tenantId: az.tenantId,
            registroId: az.registroId,
            cerCode: CER,
            quantita: 0,
            unita: 'KG',
            dataRiferimento: new Date('2026-01-01T00:00:00.000Z'),
            impostatoDa: userId,
          },
        })
      ).rejects.toThrow(/giacenze_iniziali_quantita_positiva/)
    })

    it("la modifica che porta kg in collisione con un'altra apertura e' un conflitto", async () => {
      const az = await aziendaConRegistro()
      await crea(az.tenantId, dati({ unita: 'kg' }), az.registroId)
      const { giacenza: litri } = await crea(az.tenantId, dati({ unita: 'L' }), az.registroId)
      await expect(
        nelTenant(az.tenantId, () =>
          servizio.modifica(az.tenantId, userId, litri.id, {
            quantita: 1,
            unita: 't',
            dataRiferimento: '2026-01-01',
          })
        )
      ).rejects.toBeInstanceOf(ConflictException)
    })
  })

  describe('uso da parte di uno scarico (G4)', () => {
    it("uno scarico registrato DOPO l'apertura la blocca (409); lo scarico precedente no", async () => {
      const az = await aziendaConRegistro()
      // scarico precedente all'apertura (inserito dal proprietario, senza controllo di giacenza)
      await movimentoDiretto(az.tenantId, az.registroId, {
        type: 'SCARICO',
        createdAt: new Date(Date.now() - 60_000),
      })
      const { giacenza } = await crea(az.tenantId, dati(), az.registroId)

      // lo scarico c'era gia': l'apertura resta modificabile
      const prima = await nelTenant(az.tenantId, () => servizio.elenca(az.tenantId))
      expect(prima.voci[0].modificabile).toBe(true)
      await expect(
        nelTenant(az.tenantId, () =>
          servizio.modifica(az.tenantId, userId, giacenza.id, {
            quantita: 120,
            unita: 'kg',
            dataRiferimento: '2026-01-01',
          })
        )
      ).resolves.toBeDefined()

      // scarico registrato dopo l'apertura dal caso d'uso reale: passa grazie all'apertura (120 kg)
      await new Promise(r => setTimeout(r, 20))
      const scarico = await scaricoReale(az.tenantId, az.registroId, 50)
      expect(scarico.isSuccess ? 'ok' : scarico.error).toBe('ok')

      const dopo = await nelTenant(az.tenantId, () => servizio.elenca(az.tenantId))
      expect(dopo.voci[0].modificabile).toBe(false)
      await expect(
        nelTenant(az.tenantId, () =>
          servizio.modifica(az.tenantId, userId, giacenza.id, {
            quantita: 130,
            unita: 'kg',
            dataRiferimento: '2026-01-01',
          })
        )
      ).rejects.toBeInstanceOf(ConflictException)
      await expect(
        nelTenant(az.tenantId, () => servizio.elimina(az.tenantId, userId, giacenza.id))
      ).rejects.toBeInstanceOf(ConflictException)
      expect(await owner.giacenzaIniziale.count({ where: { id: giacenza.id } })).toBe(1)
    })

    it("senza apertura lo scarico e' respinto, con l'apertura e' accettato fino alla quantita', oltre no", async () => {
      const az = await aziendaConRegistro()
      const senza = await scaricoReale(az.tenantId, az.registroId, 10)
      expect(senza.isFailure).toBe(true)
      expect(senza.error).toContain('Giacenza insufficiente')
      expect(senza.error).toContain('Registro → Giacenze iniziali')

      await crea(az.tenantId, dati({ quantita: 100 }), az.registroId)
      const entro = await scaricoReale(az.tenantId, az.registroId, 60)
      expect(entro.isSuccess ? 'ok' : entro.error).toBe('ok')
      const oltre = await scaricoReale(az.tenantId, az.registroId, 60)
      expect(oltre.isFailure).toBe(true)
      expect(oltre.error).toContain('Giacenza insufficiente')
    })

    it('uno scarico di un altro CER non la blocca', async () => {
      const az = await aziendaConRegistro()
      const { giacenza } = await crea(az.tenantId, dati(), az.registroId)
      await movimentoDiretto(az.tenantId, az.registroId, { type: 'SCARICO', cer: CER_STELLA })
      await expect(
        nelTenant(az.tenantId, () => servizio.elimina(az.tenantId, userId, giacenza.id))
      ).resolves.toBeUndefined()
    })
  })

  describe('avviso ALTRO_CARICO (G8)', () => {
    it("c'e' solo se il registro ha ALTRO_CARICO dello stesso CER", async () => {
      const az = await aziendaConRegistro()
      await movimentoDiretto(az.tenantId, az.registroId, { type: 'CARICO', cer: CER_STELLA })
      expect(
        (await crea(az.tenantId, dati({ cerCode: '99 99 04' }), az.registroId)).avvisi
      ).toEqual([])
      await movimentoDiretto(az.tenantId, az.registroId, { type: 'CARICO' })
      await movimentoDiretto(az.tenantId, az.registroId, {
        type: 'CARICO',
        causale: 'PRODUZIONE_INTERNA',
      })
      // PRODUZIONE_INTERNA sullo stesso CER: non e' un ALTRO_CARICO, non deve comparire
      await movimentoDiretto(az.tenantId, az.registroId, {
        type: 'CARICO',
        cer: CER_STELLA,
        causale: 'PRODUZIONE_INTERNA',
      })
      const altro = await aziendaConRegistro()
      const { avvisi } = await crea(az.tenantId, dati({ cerCode: '99 99 05' }), az.registroId)
      expect(avvisi).toHaveLength(1)
      expect(avvisi[0]).toContain('contata due volte')
      // solo il movimento 1 (ALTRO_CARICO su questo CER): 2 e' un altro CER, 3 e 4 sono produzione
      expect(avvisi[0]).toContain('(movimenti: 1/2026)')
      // l'altra azienda non ne sa nulla
      expect((await crea(altro.tenantId, dati(), altro.registroId)).avvisi).toEqual([])
    })
  })

  describe('isolamento fra aziende (RLS)', () => {
    it("l'altra azienda non vede, non modifica e non cancella; non puo' scrivere nel registro altrui", async () => {
      const a = await aziendaConRegistro()
      const b = await aziendaConRegistro()
      const { giacenza } = await crea(a.tenantId, dati(), a.registroId)

      const visteDaB = await nelTenant(b.tenantId, () => servizio.elenca(b.tenantId))
      expect(visteDaB.voci).toEqual([])
      await expect(
        nelTenant(b.tenantId, () =>
          servizio.modifica(b.tenantId, userId, giacenza.id, {
            quantita: 1,
            unita: 'kg',
            dataRiferimento: '2026-01-01',
          })
        )
      ).rejects.toBeInstanceOf(NotFoundException)
      await expect(
        nelTenant(b.tenantId, () => servizio.elimina(b.tenantId, userId, giacenza.id))
      ).rejects.toBeInstanceOf(NotFoundException)
      // il registro di A, indicato da B, e' "non trovato"
      await expect(crea(b.tenantId, dati(), a.registroId)).rejects.toBeInstanceOf(NotFoundException)
      expect(await owner.giacenzaIniziale.count({ where: { id: giacenza.id } })).toBe(1)

      // ruolo applicativo fuori da TenantContext: la RLS non fa vedere nulla (fail-closed)
      const senzaContesto =
        await app.$queryRaw`SELECT id FROM giacenze_iniziali WHERE id = ${giacenza.id}::uuid`
      expect(senzaContesto).toEqual([])
    })
  })

  it("la cancellazione del registro con un'apertura e' respinta dalla chiave esterna (RESTRICT)", async () => {
    const az = await aziendaConRegistro()
    await crea(az.tenantId, dati(), az.registroId)
    await expect(owner.registroRifiuti.delete({ where: { id: az.registroId } })).rejects.toThrow(
      /giacenze_iniziali_registro_id_tenant_id_fkey|Foreign key constraint/
    )
  })

  it("una apertura datata oggi e' ammessa, domani no (giorno italiano)", async () => {
    const az = await aziendaConRegistro()
    await expect(
      crea(az.tenantId, dati({ dataRiferimento: OGGI }), az.registroId)
    ).resolves.toBeDefined()
    const domani = new Date(`${OGGI}T00:00:00.000Z`)
    domani.setUTCDate(domani.getUTCDate() + 1)
    await expect(
      crea(
        az.tenantId,
        dati({ unita: 'L', dataRiferimento: domani.toISOString().slice(0, 10) }),
        az.registroId
      )
    ).rejects.toBeInstanceOf(BadRequestException)
  })

  it('il confronto con gli scarichi non dipende dal fuso della sessione', async () => {
    const az = await aziendaConRegistro()
    await movimentoDiretto(az.tenantId, az.registroId, {
      type: 'SCARICO',
      createdAt: new Date(Date.now() - 60_000),
    })
    const { giacenza } = await crea(az.tenantId, dati(), az.registroId)
    const riga = (await owner.giacenzaIniziale.findUnique({ where: { id: giacenza.id } }))!
    const fusi = ['UTC', 'Europe/Rome', 'Pacific/Auckland', 'America/Los_Angeles']
    const usata = (fuso: string) =>
      nelTenant(az.tenantId, () =>
        app.$transaction(async tx => {
          await tx.$executeRawUnsafe(`SET LOCAL TIME ZONE '${fuso}'`)
          try {
            await (servizio as any).controllaNonUsata(tx, az.tenantId, riga)
            return false
          } catch (e) {
            if (e instanceof ConflictException) return true
            throw e
          }
        })
      )
    // scarico precedente all'apertura: mai "usata", in qualunque fuso
    for (const fuso of fusi) expect(await usata(fuso)).toBe(false)
    await new Promise(r => setTimeout(r, 20))
    await movimentoDiretto(az.tenantId, az.registroId, { type: 'SCARICO' })
    for (const fuso of fusi) expect(await usata(fuso)).toBe(true)
  })
})
