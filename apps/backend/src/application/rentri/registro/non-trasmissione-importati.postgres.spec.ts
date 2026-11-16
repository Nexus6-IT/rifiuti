/**
 * Fase 3 (3.1), Task 6, test (a) e (d, movimenti): adozione e coda del registro non toccano mai i
 * movimenti importati ne' le correzioni di un importato non riconciliato. Postgres reale COME
 * `wasteflow_app` (RLS); il proprietario prepara i dati (anche i movimenti importati con la riga di
 * blocco) e legge cosa e' successo. Il client RENTRI e' finto e conta le POST: la garanzia e' che
 * nessuna POST contenga un importato.
 */
import { PrismaClient } from '@prisma/client'
import { urlComeRuolo } from '../../../infrastructure/database/client-come-ruolo'

const urlProprietario =
  process.env.DATABASE_URL ??
  'postgresql://wasteflow:wasteflow_ci@127.0.0.1:55447/wasteflow_ci?schema=public'
process.env.DATABASE_URL = urlComeRuolo(
  'wasteflow_app',
  process.env.DB_APP_PASSWORD ?? 'wasteflow_app_dev',
  urlProprietario
)

import { randomUUID } from 'crypto'
import { RentriRegistroTrasmissioneJob } from '../../../infrastructure/jobs/rentri-registro-trasmissione.job'
import {
  PrismaService,
  creaPrismaServiceApplicativo,
} from '../../../infrastructure/persistence/prisma.service'
import { partitaIvaUnica } from '../../../test-support/anagrafiche-di-test'
import {
  creaMovimentoImportato,
  lottoDiProva,
  type AziendaPerImportati,
} from '../../../test-support/migrazione/movimento-importato'
import { ModuliAttiviService } from '../../admin/moduli-attivi.service'
import { ContrattoGruppoService } from '../../billing/contratto-gruppo.service'
import { AccodaTrasmissioneRentriUseCase } from './accoda-trasmissione-rentri.use-case'
import { TrasmissioneNonModificabileError } from './errori-azioni-rentri-registro'
import { LettoreAnnotazioniRentri } from './lettore-annotazioni-rentri'
import { TrasmettiLottoRegistroUseCase } from './trasmetti-lotto-registro.use-case'
import { TrasmissioniRegistroRepository } from './trasmissioni-registro.repository'

describe('Fase 3 (3.1): adozione e coda del registro saltano gli importati — Postgres reale', () => {
  const owner = new PrismaClient({ datasourceUrl: urlProprietario })
  let app: PrismaService
  const logger: any = {
    setContext: jest.fn(),
    warn: jest.fn(),
    info: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  }
  const tenantCreati: string[] = []
  let n = 0
  let progressivo = 0
  let utenteId = ''

  interface Az extends AziendaPerImportati {
    unitaLocaleId: string
  }

  async function azienda(): Promise<Az> {
    const t = await owner.tenant.create({
      data: {
        partitaIva: partitaIvaUnica(),
        ragioneSociale: 'Import coda SRL',
        country: 'IT',
        subscriptionTier: 'ENTERPRISE',
      },
    })
    tenantCreati.push(t.id)
    const u = await owner.user.create({
      data: {
        tenantId: t.id,
        keycloakId: `kc-impcoda-${t.id}`,
        fiscalCode: `IMPC${++n}${Date.now()}`.slice(0, 16),
        firstName: 'Prova',
        lastName: 'Coda',
        email: `impcoda-${t.id}@example.test`,
        role: 'ADMIN',
      },
    })
    utenteId = u.id
    const sede = await owner.rentriUnitaLocale.create({
      data: {
        tenantId: t.id,
        numIscrSito: `OP0001IM${String(++n).padStart(6, '0')}-MI0001`,
        denominazione: 'Sede',
        principale: true,
      },
    })
    const registro = await owner.registroRifiuti.create({
      data: {
        tenantId: t.id,
        unitaLocaleId: sede.id,
        descrizione: 'Registro importati',
        identificativoRentri: 'RABCDE12345',
        // Invio automatico attivo "da ieri": i movimenti creati ora sono tutti oltre la data.
        invioRentriAutomaticoDal: new Date(Date.now() - 24 * 3600_000),
      },
    })
    const lottoId = await lottoDiProva(owner, t.id)
    return { tenantId: t.id, registroId: registro.id, unitaLocaleId: sede.id, lottoId }
  }

  async function normale(az: Az, extra: Record<string, unknown> = {}) {
    return owner.wasteMovement.create({
      data: {
        tenantId: az.tenantId,
        registroId: az.registroId,
        progressiveYear: 2026,
        progressiveNumber: ++progressivo,
        cerCode: '15 01 01',
        unit: 'KG',
        wastePhysicalState: 'Solido',
        type: 'CARICO',
        movementDate: new Date('2026-03-01T10:00:00Z'),
        registrationDate: new Date('2026-03-01T10:00:00Z'),
        causale: 'PRODUZIONE_INTERNA',
        quantity: 100,
        ...extra,
      } as never,
    })
  }

  /** Correzione ordinaria (NON importata) di `predecessore`, con la catena di provenienza. */
  async function correzione(az: Az, predecessore: { id: string }, radiceId: string) {
    return normale(az, {
      tipoAnnotazione: 'RETTIFICA',
      movimentoRettificatoId: predecessore.id,
      movimentoOriginaleId: radiceId,
      motivoAnnotazione: 'Rettifica di prova',
    })
  }

  const rigaDi = (movimentoId: string) =>
    owner.movimentoTrasmissioneRentri.findUnique({ where: { movimentoId } })

  /** Client RENTRI finto: conta le POST e ricorda i progressivi inviati. */
  function clientFinto() {
    const progressiviInviati: number[] = []
    const posts = jest.fn(async (_id: string, movimenti: Array<{ progressivo: number }>) => {
      progressiviInviati.push(...movimenti.map(m => m.progressivo))
      return { transazioneId: randomUUID(), movimenti }
    })
    const client: any = {
      inviaMovimenti: posts,
      attendiEsitoMovimenti: async () => ({
        errore: false,
        validazione: [],
        numeroRegistrazioni: progressiviInviati.map(p => ({
          anno: 2026,
          progressivo: p,
          identificativo: `M${String(p).padStart(19, '0')}`,
        })),
      }),
    }
    return { client, posts, progressiviInviati }
  }

  const traduttore = (a: { numero: { anno: number; progressivo: number } }) => ({
    ok: true as const,
    corpo: { anno: a.numero.anno, progressivo: a.numero.progressivo },
  })

  beforeAll(async () => {
    app = creaPrismaServiceApplicativo()
    await app.onModuleInit()
  })

  afterAll(async () => {
    if (tenantCreati.length > 0) {
      await owner.tenant.deleteMany({ where: { id: { in: tenantCreati } } })
    }
    await app.onModuleDestroy()
    await owner.$disconnect()
  })

  it("(a) adottaAutomatiche adotta solo il movimento normale; prenota e il lotto non inviano mai l'importato", async () => {
    const az = await azienda()
    const imp = await creaMovimentoImportato(owner, az)
    const norm = await normale(az)
    const repo = new TrasmissioniRegistroRepository(app, logger)

    const adottate = await repo.adottaAutomatiche(az.tenantId, 100)
    expect(adottate).toBe(1)
    expect((await rigaDi(norm.id))?.origine).toBe('AUTOMATICA')
    const rImp = await rigaDi(imp.movimentoId)
    expect(rImp?.stato).toBe('DA_RICONCILIARE')
    expect(rImp?.origine).toBe('IMPORTAZIONE')

    const { client, posts, progressiviInviati } = clientFinto()
    const trasmetti = new TrasmettiLottoRegistroUseCase(
      repo,
      new LettoreAnnotazioniRentri(logger),
      client,
      logger,
      traduttore as never
    )
    const esito = await trasmetti.trasmettiRegistro(az.tenantId, az.registroId)
    expect(esito.esito).not.toBe('SOSPESO')
    expect(posts).toHaveBeenCalledTimes(1)
    expect(progressiviInviati).toEqual([norm.progressiveNumber])
    // zero chiamate col numero dell'importato
    const impMov = await owner.wasteMovement.findUniqueOrThrow({ where: { id: imp.movimentoId } })
    expect(progressiviInviati).not.toContain(impMov.progressiveNumber)
    // adottare di nuovo non cambia nulla
    expect(await repo.adottaAutomatiche(az.tenantId, 100)).toBe(0)
    expect((await rigaDi(imp.movimentoId))?.stato).toBe('DA_RICONCILIARE')
  })

  it("(d, movimenti) giro completo del job con invio automatico: l'importato resta DA_RICONCILIARE, nessuna POST lo contiene", async () => {
    const az = await azienda()
    const imp = await creaMovimentoImportato(owner, az)
    const norm = await normale(az)
    const repo = new TrasmissioniRegistroRepository(app, logger)
    const { client, posts, progressiviInviati } = clientFinto()
    const trasmetti = new TrasmettiLottoRegistroUseCase(
      repo,
      new LettoreAnnotazioniRentri(logger),
      client,
      logger,
      traduttore as never
    )
    const job = new RentriRegistroTrasmissioneJob(
      { tenant: { findMany: async () => [{ id: az.tenantId }] } } as any,
      app,
      { haCredenziale: async () => true } as any,
      repo,
      trasmetti,
      logger,
      new ModuliAttiviService(new ContrattoGruppoService(app))
    )

    await job.eseguiTrasmissione()
    await job.eseguiTrasmissione()

    expect(logger.error).not.toHaveBeenCalled()
    expect(posts).toHaveBeenCalledTimes(1)
    expect(progressiviInviati).toEqual([norm.progressiveNumber])
    const r = await rigaDi(imp.movimentoId)
    expect(r?.stato).toBe('DA_RICONCILIARE')
    expect(r?.tentativi).toBe(0)
    expect(r?.transazioneId).toBeNull()
  })

  describe('correzione di un importato non riconciliato', () => {
    it("adottaAutomatiche e adottaCorrezioni non adottano ne' la correzione ne' la correzione della correzione", async () => {
      const az = await azienda()
      const imp = await creaMovimentoImportato(owner, az)
      const c1 = await correzione(az, { id: imp.movimentoId }, imp.movimentoId)
      const c2 = await correzione(az, c1, imp.movimentoId)
      const repo = new TrasmissioniRegistroRepository(app, logger)

      expect(await repo.adottaAutomatiche(az.tenantId, 100)).toBe(0)
      expect(await repo.adottaCorrezioni(az.tenantId, 100)).toBe(0)
      expect(await rigaDi(c1.id)).toBeNull()
      expect(await rigaDi(c2.id)).toBeNull()
      expect((await rigaDi(imp.movimentoId))?.stato).toBe('DA_RICONCILIARE')
    })

    it("prova di controllo: la stessa correzione di un movimento normale si adotta (la guardia non e' troppo larga)", async () => {
      const az = await azienda()
      const base = await normale(az)
      const c1 = await correzione(az, base, base.id)
      const repo = new TrasmissioniRegistroRepository(app, logger)
      expect(await repo.adottaAutomatiche(az.tenantId, 100)).toBe(2)
      expect((await rigaDi(c1.id))?.stato).toBe('DA_TRASMETTERE')
    })

    it('accoda: la correzione e quella della correzione sono saltate con motivo, nessuna riga creata', async () => {
      const az = await azienda()
      const imp = await creaMovimentoImportato(owner, az)
      const c1 = await correzione(az, { id: imp.movimentoId }, imp.movimentoId)
      const c2 = await correzione(az, c1, imp.movimentoId)
      const accoda = new AccodaTrasmissioneRentriUseCase(app, logger)

      const esito = await accoda.accoda(az.tenantId, utenteId, az.registroId, [c1.id, c2.id])
      expect(esito.accodate).toBe(0)
      expect(esito.riaccodate).toBe(0)
      expect(esito.saltate).toBe(2)
      expect(esito.motiviSaltate).toEqual({ PREDECESSORE_DA_RICONCILIARE: 2 })
      expect(await rigaDi(c1.id)).toBeNull()
      expect(await rigaDi(c2.id)).toBeNull()
    })

    it("accodaStorico: le correzioni dell'importato non si accodano, gli altri movimenti dell'anno si", async () => {
      const az = await azienda()
      const imp = await creaMovimentoImportato(owner, az)
      const c1 = await correzione(az, { id: imp.movimentoId }, imp.movimentoId)
      const c2 = await correzione(az, c1, imp.movimentoId)
      const altro = await normale(az)
      const accoda = new AccodaTrasmissioneRentriUseCase(app, logger)

      const esito = await accoda.accodaStorico(az.tenantId, utenteId, az.registroId, 2026, true)
      expect(esito.accodate).toBe(1)
      expect(await rigaDi(c1.id)).toBeNull()
      expect(await rigaDi(c2.id)).toBeNull()
      expect((await rigaDi(altro.id))?.origine).toBe('MANUALE')
      expect((await rigaDi(imp.movimentoId))?.stato).toBe('DA_RICONCILIARE')
    })
  })

  describe('azioni dirette sul movimento importato', () => {
    it('accoda diretto: saltato per stato DA_RICONCILIARE, la riga non cambia', async () => {
      const az = await azienda()
      const imp = await creaMovimentoImportato(owner, az)
      const accoda = new AccodaTrasmissioneRentriUseCase(app, logger)
      const esito = await accoda.accoda(az.tenantId, utenteId, az.registroId, [imp.movimentoId])
      expect(esito.accodate + esito.riaccodate).toBe(0)
      expect(esito.saltate).toBe(1)
      expect(esito.saltatePerStato).toEqual({ DA_RICONCILIARE: 1 })
      expect((await rigaDi(imp.movimentoId))?.stato).toBe('DA_RICONCILIARE')
    })

    it('dichiaraGiaSuRentri su un intervallo che lo contiene: lui saltato e contato, gli altri dichiarati', async () => {
      const az = await azienda()
      const imp = await creaMovimentoImportato(owner, az, { progressiveNumber: ++progressivo })
      const normali = [await normale(az), await normale(az)]
      const impMov = await owner.wasteMovement.findUniqueOrThrow({ where: { id: imp.movimentoId } })
      const numeri = [impMov.progressiveNumber, ...normali.map(m => m.progressiveNumber)]
      const accoda = new AccodaTrasmissioneRentriUseCase(app, logger)

      const esito = await accoda.dichiaraGiaSuRentri(
        az.tenantId,
        utenteId,
        'ADMIN',
        az.registroId,
        2026,
        Math.min(...numeri),
        Math.max(...numeri),
        'Gia trasmessi da un altro programma'
      )
      expect(esito.dichiarate).toBe(2)
      expect(esito.saltatePerStato.DA_RICONCILIARE).toBe(1)
      expect((await rigaDi(imp.movimentoId))?.stato).toBe('DA_RICONCILIARE')
      for (const m of normali) expect((await rigaDi(m.id))?.stato).toBe('GIA_SU_RENTRI')
    })

    it('escludiDaInvioAutomatico e togliDallaCoda: 409 come per gli stati non modificabili', async () => {
      const az = await azienda()
      const imp = await creaMovimentoImportato(owner, az)
      const accoda = new AccodaTrasmissioneRentriUseCase(app, logger)
      await expect(
        accoda.escludiDaInvioAutomatico(az.tenantId, utenteId, 'ADMIN', imp.movimentoId, 'motivo')
      ).rejects.toThrow(/importato.*riconcili/i)
      await expect(
        accoda.togliDallaCoda(az.tenantId, utenteId, imp.movimentoId)
      ).rejects.toBeInstanceOf(TrasmissioneNonModificabileError)
      const r = await rigaDi(imp.movimentoId)
      expect(r?.stato).toBe('DA_RICONCILIARE')
      expect(r?.esclusoIl).toBeNull()
    })

    it('escludiDaInvioAutomatico sulla correzione di un importato: 409 e nessuna riga creata (Q4)', async () => {
      const az = await azienda()
      const imp = await creaMovimentoImportato(owner, az)
      const c1 = await correzione(az, { id: imp.movimentoId }, imp.movimentoId)
      const accoda = new AccodaTrasmissioneRentriUseCase(app, logger)
      const p = accoda.escludiDaInvioAutomatico(az.tenantId, utenteId, 'ADMIN', c1.id, 'motivo')
      await expect(p).rejects.toBeInstanceOf(TrasmissioneNonModificabileError)
      await expect(p).rejects.toThrow(/correzione di un movimento importato/i)
      expect(await rigaDi(c1.id)).toBeNull()
    })
  })
})
