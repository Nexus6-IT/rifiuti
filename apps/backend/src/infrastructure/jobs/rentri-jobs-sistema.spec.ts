/**
 * RLS pezzo 2b: i job RENTRI leggono l'elenco delle aziende dal client di sistema e
 * lavorano ogni azienda nel suo contesto (TenantContext).
 *
 * DI vera: i job non iniettano piu' PrismaService, la garanzia e' il costruttore. Il Proxy che
 * lancia a qualsiasi uso e' fornito come PrismaService solo per far fallire il test se un job
 * tornasse a dipenderne.
 */

import { Test } from '@nestjs/testing'
import { RentriCertificatoScadenzaJob } from './rentri-certificato-scadenza.job'
import { RentriRiconciliazioneJob } from './rentri-riconciliazione.job'
import { RentriRifornimentoScortaJob } from './rentri-rifornimento-scorta.job'
import { RentriTrasmissioniSospeseJob } from './rentri-trasmissioni-sospese.job'
import { PrismaService } from '../persistence/prisma.service'
import { PrismaSistemaService } from '../persistence/prisma-sistema.service'
import { MetricsService } from '../../core/metrics/metrics.service'
import { LoggerService } from '../../core/logger/logger.service'
import { RiconciliaStatoRentriUseCase } from '../../application/rentri/riconcilia-stato-rentri.use-case'
import { RentriCredentialResolver } from '../rentri/rentri-credential.resolver'
import { RentriUnitaLocaleService } from '../rentri/rentri-unita-locale.service'
import { RentriScortaRepository } from '../persistence/rentri-scorta.repository'
import { AvviaVidimazioneScortaUseCase } from '../../application/rentri/scorta/avvia-vidimazione-scorta.use-case'
import { ModuliAttiviService } from '../../application/admin/moduli-attivi.service'
import { TenantContext } from '../../core/context/tenant-context'

jest.mock('@sentry/node', () => ({ captureException: jest.fn() }))

const logger = {
  setContext: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
}

const applicativoVietato = new Proxy(
  {},
  {
    get: () => {
      throw new Error('client applicativo non ammesso per la scansione di tutte le aziende')
    },
  }
)

/** Moduli: tutte le aziende hanno `rentri` (il filtro e' coperto dai test unitari dei job). */
const tutteLeAziendeHannoRentri = {
  tenantConModulo: async (ids: readonly string[]) => new Set(ids),
}

const sede = {
  numIscrSito: 'OP1',
  codiceBloccoPredefinito: 'BLK-A',
  dimensioneScortaDesiderata: 10,
}

function sistemaConAziende() {
  return {
    tenant: { findMany: jest.fn().mockResolvedValue([{ id: 't1' }, { id: 't2' }]) },
    rentriCredential: { findMany: jest.fn().mockResolvedValue([]) },
  }
}

describe('RentriCertificatoScadenzaJob — client di sistema', () => {
  it('rentri-certificato-scadenza: elenco delle aziende dal client di sistema', async () => {
    const sistema = sistemaConAziende()
    const modulo = await Test.createTestingModule({
      providers: [
        RentriCertificatoScadenzaJob,
        { provide: PrismaService, useValue: applicativoVietato },
        { provide: PrismaSistemaService, useValue: sistema },
        { provide: MetricsService, useValue: { rentriCertificateExpiryDays: { set: jest.fn() } } },
        { provide: LoggerService, useValue: logger },
        { provide: ModuliAttiviService, useValue: tutteLeAziendeHannoRentri },
      ],
    }).compile()

    await modulo.get(RentriCertificatoScadenzaJob).controllaScadenze()

    expect(sistema.tenant.findMany).toHaveBeenCalledTimes(1)
    expect(sistema.rentriCredential.findMany).toHaveBeenCalledTimes(1)
  })
})

describe('RentriRiconciliazioneJob — client di sistema e contesto per azienda', () => {
  async function costruisci() {
    const sistema = sistemaConAziende()
    const resolver = { haCredenziale: jest.fn().mockResolvedValue(true) }
    const useCase = { execute: jest.fn().mockResolvedValue({ controllati: 0 }) }
    const modulo = await Test.createTestingModule({
      providers: [
        RentriRiconciliazioneJob,
        { provide: PrismaService, useValue: applicativoVietato },
        { provide: PrismaSistemaService, useValue: sistema },
        { provide: RiconciliaStatoRentriUseCase, useValue: useCase },
        { provide: RentriCredentialResolver, useValue: resolver },
        { provide: LoggerService, useValue: logger },
        { provide: ModuliAttiviService, useValue: tutteLeAziendeHannoRentri },
      ],
    }).compile()
    return { job: modulo.get(RentriRiconciliazioneJob), sistema, resolver }
  }

  it('rentri-riconciliazione: elenco delle aziende dal client di sistema', async () => {
    const { job, sistema } = await costruisci()

    await job.riconcilia()

    expect(sistema.tenant.findMany).toHaveBeenCalledTimes(1)
  })

  it('rentri-riconciliazione: lavoro di ogni azienda nel suo contesto', async () => {
    const { job, resolver } = await costruisci()
    const visti: Array<string | null> = []
    resolver.haCredenziale.mockImplementation(async () => {
      visti.push(TenantContext.getStoreTenantId())
      return true
    })

    await job.riconcilia()

    expect(visti).toEqual(['t1', 't2'])
  })
})

describe('RentriRifornimentoScortaJob — client di sistema e contesto per azienda', () => {
  async function costruisci() {
    const sistema = sistemaConAziende()
    const resolver = { haCredenziale: jest.fn().mockResolvedValue(true) }
    const unita = { listForTenant: jest.fn().mockResolvedValue([sede]) }
    const scorta = { contaTotaleDisponibili: jest.fn().mockResolvedValue(4) }
    const vidima = { execute: jest.fn().mockResolvedValue({}) }
    const modulo = await Test.createTestingModule({
      providers: [
        RentriRifornimentoScortaJob,
        { provide: PrismaService, useValue: applicativoVietato },
        { provide: PrismaSistemaService, useValue: sistema },
        { provide: RentriCredentialResolver, useValue: resolver },
        { provide: RentriUnitaLocaleService, useValue: unita },
        { provide: RentriScortaRepository, useValue: scorta },
        { provide: AvviaVidimazioneScortaUseCase, useValue: vidima },
        { provide: LoggerService, useValue: logger },
        { provide: ModuliAttiviService, useValue: tutteLeAziendeHannoRentri },
      ],
    }).compile()
    return {
      job: modulo.get(RentriRifornimentoScortaJob),
      sistema,
      resolver,
      unita,
      scorta,
      vidima,
    }
  }

  it('rentri-rifornimento-scorta: elenco delle aziende dal client di sistema', async () => {
    const { job, sistema } = await costruisci()

    await job.eseguiRifornimento()

    expect(sistema.tenant.findMany).toHaveBeenCalledTimes(1)
  })

  it('rentri-rifornimento-scorta: lavoro di ogni azienda nel suo contesto', async () => {
    const { job, resolver, unita, scorta, vidima } = await costruisci()
    const visti: Record<string, Array<string | null>> = {
      credenziale: [],
      sedi: [],
      scorta: [],
      vidima: [],
    }
    resolver.haCredenziale.mockImplementation(async () => {
      visti.credenziale.push(TenantContext.getStoreTenantId())
      return true
    })
    unita.listForTenant.mockImplementation(async () => {
      visti.sedi.push(TenantContext.getStoreTenantId())
      return [sede]
    })
    scorta.contaTotaleDisponibili.mockImplementation(async () => {
      visti.scorta.push(TenantContext.getStoreTenantId())
      return 4
    })
    vidima.execute.mockImplementation(async () => {
      visti.vidima.push(TenantContext.getStoreTenantId())
      return {}
    })

    await job.eseguiRifornimento()

    expect(visti).toEqual({
      credenziale: ['t1', 't2'],
      sedi: ['t1', 't2'],
      scorta: ['t1', 't2'],
      vidima: ['t1', 't2'],
    })
  })
})

describe('RentriTrasmissioniSospeseJob — contesto per azienda', () => {
  // L'elenco su tutte le aziende e' in FIRPrismaRepository.elencaTrasmissioniRentriSospese,
  // testato in fir-prisma.repository.spec.ts.
  it('rentri-trasmissioni-sospese: lavoro di ogni azienda nel suo contesto', async () => {
    const firRepo = {
      elencaTrasmissioniRentriSospese: jest.fn().mockResolvedValue([
        { firId: 'f1', tenantId: 't1' },
        { firId: 'f2', tenantId: 't2' },
      ]),
    }
    const queue = { addSyncJob: jest.fn().mockResolvedValue('id') }
    const visti: Array<string | null> = []
    const modalita = {
      getForTenant: jest.fn(async () => {
        visti.push(TenantContext.getStoreTenantId())
        return { modalitaLegame: 'AUTOMATICA', certificatoConfigurato: true }
      }),
    }
    const job = new RentriTrasmissioniSospeseJob(
      firRepo as never,
      queue as never,
      logger as never,
      modalita as never,
      { tenantConModulo: async (ids: readonly string[]) => new Set(ids) } as never,
      { tenant: { findMany: async () => [{ id: 't1' }, { id: 't2' }] } } as never
    )

    await job.riprendi()

    expect(visti).toEqual(['t1', 't2'])
  })
})
