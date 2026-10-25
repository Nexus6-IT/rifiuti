/**
 * RLS pezzo 3, Task 4: i percorsi reali dell'applicazione su un database con la RLS ATTIVA e
 * collegandosi come in produzione: `creaPrismaServiceApplicativo()` come `wasteflow_app`
 * (via `DATABASE_URL`) e `PrismaSistemaService` come `wasteflow_sistema` (via
 * `DATABASE_URL_SISTEMA`), entrambi dentro il `TenantContext` giusto. Mai mock del client Prisma.
 *
 * Il proprietario (`wasteflow`, ignora la RLS) prepara le aziende e legge cio' che e' stato
 * scritto per verificarlo; la pulizia toglie solo le righe create qui (mai TRUNCATE).
 *
 * Percorsi: registrazione movimento, salvataggio ed emissione FIR con firme e trasportatori,
 * allegati RENTRI (caricamento ed elenco), elenco anagrafiche, MUD (aggregazione e
 * presentazione), cambio azienda del consulente, validazione del token e login col client di
 * sistema (qui: JwtStrategy.validate piu' il lookup per keycloakId col client di sistema, non l'intero
 * AuthController). Piu' la lettura di `tenants` col client app (tabella esclusa dalla RLS di proposito).
 *
 * Finti, e solo questi, perche' sono servizi esterni e non Prisma: il client HTTP di RENTRI e
 * `GetAzioniDisponibiliUseCase` (chiamata verso l'ente), i dati di riferimento del MUD, Redis,
 * il logger.
 *
 * Eseguire con `npm run test:postgres`.
 */
import { randomUUID } from 'node:crypto'
import { PrismaClient } from '@prisma/client'
import { ConfigService } from '@nestjs/config'
import { urlComeRuolo } from '../database/client-come-ruolo'

const urlProprietario =
  process.env.DATABASE_URL ??
  'postgresql://wasteflow:wasteflow_ci@127.0.0.1:55432/wasteflow_ci?schema=public'
// I servizi dell'applicazione leggono queste due variabili, come in produzione.
process.env.DATABASE_URL = urlComeRuolo(
  'wasteflow_app',
  process.env.DB_APP_PASSWORD ?? 'wasteflow_app_dev',
  urlProprietario
)
process.env.DATABASE_URL_SISTEMA = urlComeRuolo(
  'wasteflow_sistema',
  process.env.DB_SISTEMA_PASSWORD ?? 'wasteflow_sistema_dev',
  urlProprietario
)

import { TenantContext } from '../../core/context/tenant-context'
import { PrismaService, creaPrismaServiceApplicativo } from './prisma.service'
import { PrismaSistemaService } from './prisma-sistema.service'
import { RegistraMovimentoUseCase } from '../../application/registro/use-cases/registra-movimento.use-case'
import { RegistraMovimentoCommand } from '../../application/registro/commands/registra-movimento.command'
import { FIRPrismaRepository } from './fir-prisma.repository'
import { FIR, FirmaDigitale } from '../../domain/fir/aggregates/fir.aggregate'
import { GestisciAllegatiFIRUseCase } from '../../application/rentri/gestisci-allegati-fir.use-case'
import { ProduttorePrismaRepository } from './produttore-prisma.repository'
import { Produttore } from '../../domain/registry/entities/produttore'
import { PartitaIVA } from '../../domain/registry/value-objects/partita-iva'
import { Indirizzo } from '../../domain/registry/value-objects/indirizzo'
import { MudAggregazioneService } from '../../application/mud/aggregazione/mud-aggregazione.service'
import { MudPresentazioneService } from '../../application/mud/mud-presentazione.service'
import { MudVersionRegistry } from '../../application/mud/export/mud-version.registry'
import { MembershipService } from '../../api/me/membership.service'
import { JwtStrategy } from '../../auth/strategies/jwt.strategy'

const logger = { setContext() {}, info() {}, warn() {}, error() {}, debug() {} } as never

describe('RLS: percorsi reali col ruolo applicativo (Postgres reale)', () => {
  const owner = new PrismaClient({ datasourceUrl: urlProprietario })
  let app: PrismaService
  let sistema: PrismaSistemaService

  const run = randomUUID().replace(/-/g, '')
  const sfx = Date.now().toString().slice(-8)
  const CER = '15 01 01'
  const tenantIds: string[] = []
  let studio = '' // azienda primaria del consulente
  let cliente = '' // cliente del consulente
  let estranea = ''
  let utenteStudio = ''
  let utenteCliente = ''
  let ruoloId = ''
  let contatore = 0
  let cerCreato = false

  const nelContesto = <T>(tenantId: string, fn: () => Promise<T>): Promise<T> =>
    TenantContext.run({ tenantId }, async () => await fn())

  async function creaAzienda(tag: string) {
    const t = await owner.tenant.create({
      data: {
        partitaIva: `P${tag}${sfx}`.slice(0, 11),
        ragioneSociale: `Percorsi ${tag} ${run}`,
        codiceFiscale: `PRC${tag}${sfx}`.slice(0, 16),
      },
    })
    tenantIds.push(t.id)
    return t.id
  }

  async function creaUtente(tenantId: string, nome: string) {
    return (
      await owner.user.create({
        data: {
          tenantId,
          keycloakId: `kc-percorsi-${nome}-${run}`,
          fiscalCode: `PRCTNT00A00A${String(100 + contatore++)}Z`,
          firstName: 'Prova',
          lastName: nome,
          email: `percorsi-${nome}-${run}@example.it`,
          role: 'ADMIN',
        },
      })
    ).id
  }

  const nuovoFir = (tenantId: string, creatoDaUserId: string, extra: object = {}) =>
    FIR.create({
      produttoreId: '11111111-1111-4111-8111-111111111111',
      rifiuto: { cerCode: '150101', quantita: 100 },
      trasportatoreId: '22222222-2222-4222-8222-222222222222',
      destinatarioId: '33333333-3333-4333-8333-333333333333',
      tenantId,
      creatoDaUserId,
      ...extra,
    } as never)

  const comandoMovimento = (tenantId: string) =>
    new RegistraMovimentoCommand(
      tenantId,
      undefined as unknown as string,
      'CARICO',
      new Date('2025-12-20'),
      new Date('2025-12-20'),
      'PRODUZIONE_INTERNA',
      CER,
      undefined,
      100,
      'KG',
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined
    )

  beforeAll(async () => {
    app = creaPrismaServiceApplicativo()
    await app.onModuleInit()
    sistema = new PrismaSistemaService()
    studio = await creaAzienda('S')
    cliente = await creaAzienda('C')
    estranea = await creaAzienda('E')
    utenteStudio = await creaUtente(studio, 'studio')
    utenteCliente = await creaUtente(cliente, 'cliente')
    ruoloId = (
      await owner.role.create({
        data: { tenantId: cliente, name: `CONS-${run}`, createdBy: utenteStudio },
      })
    ).id
    await owner.consultantTenantAssociation.create({
      data: {
        consultantUserId: utenteStudio,
        tenantId: cliente,
        roleId: ruoloId,
        addedBy: utenteStudio,
      },
    })
    cerCreato = (await owner.cERCode.count({ where: { code: CER } })) === 0
    await owner.cERCode.upsert({
      where: { code: CER },
      create: { code: CER, description: 'CER di test', category: '15', subcategory: '' },
      update: {},
    })
  })

  afterAll(async () => {
    if (tenantIds.length) {
      await owner.consultantTenantAssociation.deleteMany({ where: { tenantId: { in: tenantIds } } })
      await owner.role.deleteMany({ where: { tenantId: { in: tenantIds } } })
      await owner.wasteMovement.deleteMany({ where: { tenantId: { in: tenantIds } } })
      await owner.activityLog.deleteMany({ where: { tenantId: { in: tenantIds } } })
      await owner.mUDReport.deleteMany({ where: { tenantId: { in: tenantIds } } })
      await owner.produttore.deleteMany({ where: { tenantId: { in: tenantIds } } })
      await owner.fIR.deleteMany({ where: { tenantId: { in: tenantIds } } })
      await owner.user.deleteMany({ where: { tenantId: { in: tenantIds } } })
      await owner.tenant.deleteMany({ where: { id: { in: tenantIds } } })
    }
    if (cerCreato) await owner.cERCode.deleteMany({ where: { code: CER } })
    await Promise.all([owner.$disconnect(), app.onModuleDestroy(), sistema.onModuleDestroy()])
  })

  it('i servizi dell applicazione sono collegati coi ruoli giusti', async () => {
    const [a] = await app.$queryRaw<{ u: string }[]>`SELECT current_user::text AS u`
    const [s] = await sistema.$queryRaw<{ u: string }[]>`SELECT current_user::text AS u`
    expect(a.u).toBe('wasteflow_app')
    expect(s.u).toBe('wasteflow_sistema')
  })

  it('1. registrazione di un movimento (use case reale)', async () => {
    const useCase = new RegistraMovimentoUseCase(app, logger)
    const esito = await nelContesto(studio, () => useCase.execute(comandoMovimento(studio)))
    expect(esito.isSuccess ? 'ok' : esito.error).toBe('ok')
    expect(await owner.wasteMovement.count({ where: { tenantId: studio } })).toBe(1)
  })

  describe('2. FIR: salvataggio ed emissione con firme e trasportatori', () => {
    const firma = (): FirmaDigitale => ({
      firmatario: 'Mario Rossi',
      timestamp: new Date(),
      certificato: 'x',
      userId: utenteStudio,
    })

    it('save con trasportatori aggiuntivi, emissione con firma, rilettura', async () => {
      const repo = new FIRPrismaRepository(app, sistema)
      const fir = nuovoFir(studio, utenteStudio, {
        trasportatoriAggiuntivi: [
          { ordine: 1, tipoTratta: 'TERRESTRE', denominazione: 'Trasporti Uno', mezzo: 'AA111BB' },
        ],
      })
      await nelContesto(studio, () => repo.save(fir))
      const numero = await nelContesto(studio, () =>
        repo.emettiConNumerazione(fir, 2031, n => fir.emetti(n, firma()))
      )
      expect(numero).toMatch(/^FIR-2031-/)

      // Le figlie portano il tenant del padre (lo dice il proprietario, che vede tutto).
      const firme = await owner.fIRSignature.findMany({ where: { firId: fir.id } })
      const trasp = await owner.fIRTransporter.findMany({ where: { firId: fir.id } })
      expect(firme.map(f => f.tenantId)).toEqual([studio])
      expect(trasp.map(t => t.tenantId)).toEqual([studio])

      // Rilettura col client app: stesso contesto vede il FIR con firma e tratta, altro no.
      const letto = await nelContesto(studio, () => repo.findById(fir.id))
      expect(letto?.trasportatoriAggiuntivi).toHaveLength(1)
      expect(await nelContesto(estranea, () => repo.findById(fir.id))).toBeNull()
    })
  })

  describe('3. allegati RENTRI: caricamento ed elenco', () => {
    it('carica un allegato e lo elenca; un altra azienda non lo vede', async () => {
      const repo = new FIRPrismaRepository(app, sistema)
      const fir = nuovoFir(studio, utenteStudio)
      await nelContesto(studio, () => repo.save(fir))
      await nelContesto(studio, () =>
        app.fIR.update({ where: { id: fir.id }, data: { rentriNumeroFir: `ALL${sfx}XY` } })
      )

      const azioni = { execute: async () => ({ azioni: [{ operazione: 'Allegato' }] }) }
      const rentri = {
        caricaAllegato: async () => ({ errore: false, validazione: [], esito: { allegato_id: 7 } }),
      }
      const useCase = new GestisciAllegatiFIRUseCase(
        repo,
        app,
        azioni as never,
        rentri as never,
        logger
      )
      const pdf = Buffer.from('%PDF-1.4 prova').toString('base64')
      const riga = await nelContesto(studio, () =>
        useCase.caricaAllegato({
          firId: fir.id,
          tenantId: studio,
          userId: utenteStudio,
          nomeFile: 'prova.pdf',
          contentType: 'application/pdf',
          contenutoBase64: pdf,
        })
      )
      expect(riga.rentriAllegatoId).toBe(7)

      const elenco = await nelContesto(studio, () => useCase.elencaAllegati(fir.id, studio))
      expect(elenco.map(a => a.filename)).toEqual(['prova.pdf'])
      const proprietario = await owner.fIRAllegatoRentri.findMany({ where: { firId: fir.id } })
      expect(proprietario.map(a => a.tenantId)).toEqual([studio])
      // Da un'altra azienda il FIR non esiste (RLS) e l'elenco non si apre.
      await expect(
        nelContesto(estranea, () => useCase.elencaAllegati(fir.id, estranea))
      ).rejects.toMatchObject({ code: 'NOT_FOUND' })
    })
  })

  it('4. elenco delle anagrafiche: ogni azienda vede solo le proprie', async () => {
    const repo = new ProduttorePrismaRepository(app)
    const nuovo = (nome: string) =>
      Produttore.create({
        ragioneSociale: `${nome} ${run}`,
        partitaIVA: PartitaIVA.create('12345678903'),
        sedeLegale: Indirizzo.create({
          via: 'Via Roma',
          civico: '1',
          cap: '00100',
          citta: 'Roma',
          provincia: 'RM',
        }),
      })
    await nelContesto(studio, () => repo.save(nuovo('Produttore Studio')))
    await nelContesto(cliente, () => repo.save(nuovo('Produttore Cliente')))

    const dello = await nelContesto(studio, () => repo.findByTenantId(studio))
    expect(dello.map(p => p.ragioneSociale)).toEqual([`Produttore Studio ${run}`])
    // Anche chiedendo esplicitamente un'altra azienda dal contesto sbagliato: nulla.
    expect(await nelContesto(studio, () => repo.findByTenantId(cliente))).toEqual([])
  })

  describe('5. MUD', () => {
    it('aggregazione dei dati del report per un anno e presentazione', async () => {
      const aggregazione = new MudAggregazioneService(
        app,
        { getComuneByCode: async () => null } as never,
        logger
      )
      // Il movimento del caso 1 sta nel 2025 dello studio, uno del cliente non deve comparire.
      await nelContesto(cliente, () =>
        new RegistraMovimentoUseCase(app, logger).execute(comandoMovimento(cliente))
      )
      const aggregato = await nelContesto(studio, () => aggregazione.aggrega(studio, 2025))
      expect(JSON.stringify(aggregato)).toContain('150101')
      const totaleMovimenti = Object.values(
        (aggregato as unknown as { movimentiPerCer: Record<string, unknown[]> }).movimentiPerCer ??
          {}
      ).flat().length
      expect(totaleMovimenti).toBe(1)

      const service = new MudPresentazioneService(
        app,
        new MudVersionRegistry(),
        aggregazione as never,
        logger
      )
      await nelContesto(studio, () => service.segnaPresentato(studio, 2025, utenteStudio))
      expect(await owner.mUDReport.count({ where: { tenantId: studio, year: 2025 } })).toBe(1)
    })
  })

  describe('6. cambio azienda del consulente', () => {
    const membership = () =>
      new MembershipService(app, sistema, {
        generateTokenPair: (p: { tenantId: string }) => ({ accessToken: `t-${p.tenantId}` }),
      } as never)
    const utente = () => ({
      id: utenteStudio,
      email: 'x@example.it',
      tenantId: studio,
      role: 'ADMIN',
      permissions: [],
    })

    it('accesso verificato col client di sistema, poi i dati sono quelli dell azienda scelta', async () => {
      const m = membership()
      expect(await m.checkAccess(utenteStudio, cliente, studio)).toBe(true)
      expect(await m.checkAccess(utenteStudio, estranea, studio)).toBe(false)
      const esito = await m.switchTenant(utente() as never, cliente)
      expect(esito.tenantId).toBe(cliente)
      const elenco = await m.listTenants(utente() as never)
      expect(elenco.tenants.map(t => t.id).sort()).toEqual([studio, cliente].sort())

      // Dopo lo switch il contesto e' quello del cliente: vede i suoi movimenti, non quelli dello studio.
      const visti = await nelContesto(cliente, () =>
        app.wasteMovement.findMany({ select: { tenantId: true } })
      )
      expect(new Set(visti.map(v => v.tenantId))).toEqual(new Set([cliente]))
    })

    it('un azienda senza associazione non e raggiungibile', async () => {
      await expect(membership().switchTenant(utente() as never, estranea)).rejects.toThrow()
    })
  })

  describe('7. login e validazione del token tramite il client di sistema', () => {
    it('lookup utente per keycloakId col client di sistema; il client app senza contesto non lo trova', async () => {
      const kc = `kc-percorsi-studio-${run}`
      const trovato = await sistema.user.findUnique({ where: { keycloakId: kc } })
      expect(trovato?.id).toBe(utenteStudio)
      // Senza contesto il client app non solleva: la RLS filtra e il risultato e' null.
      expect(await app.user.findUnique({ where: { keycloakId: kc } })).toBeNull()
    })

    it('JwtStrategy.validate: utente dal client di sistema, permessi dal client app nel contesto', async () => {
      const redis = {
        isAccessTokenRevoked: async () => false,
        leggiEpocaSessione: async () => null,
      }
      const strategia = new JwtStrategy(
        { get: () => 'segreto-di-prova' } as unknown as ConfigService,
        app,
        sistema,
        redis as never
      )
      const req = { headers: {} } as never
      const utente = await strategia.validate(req, { sub: utenteCliente } as never)
      expect(utente.id).toBe(utenteCliente)
      expect(utente.tenantId).toBe(cliente)
      expect(utente.permissions).toEqual([])
    })
  })

  it('fail-closed: fuori dal TenantContext il client app non legge ne scrive dati di azienda', async () => {
    expect(await app.wasteMovement.findMany({ where: { tenantId: studio } })).toEqual([])
    expect(await sistema.wasteMovement.count({ where: { tenantId: studio } })).toBeGreaterThan(0)
    await expect(
      app.wasteMovement.create({
        data: {
          tenantId: studio,
          progressiveYear: 2025,
          progressiveNumber: 9999,
          type: 'CARICO',
          movementDate: new Date('2025-01-01'),
          registrationDate: new Date('2025-01-01'),
          causale: 'ALTRO_CARICO',
          cerCode: CER,
          quantity: 1,
          unit: 'KG',
        },
      })
    ).rejects.toThrow(/row-level security/)
  })

  it('lettura di tenants col client app senza filtro: la tabella e esclusa dalla RLS di proposito', async () => {
    const visti = await app.tenant.findMany({
      where: { id: { in: tenantIds } },
      select: { id: true },
    })
    // Documentato nel report: tutte le aziende restano leggibili dal ruolo app, anche senza contesto.
    expect(visti.map(t => t.id).sort()).toEqual([...tenantIds].sort())
  })
})
