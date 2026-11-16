/**
 * Fase 3 (3.1), Task 7: nessuna trasmissione a RENTRI dei FIR importati (D4, Q5). Prove unitarie con
 * repository e client finti (la parte con Postgres e HTTP e' in `non-trasmissione-fir-importati.postgres.spec.ts`):
 * il client RENTRI non riceve mai una chiamata di scrittura per un FIR bloccato.
 */
import { FIR } from '../../domain/fir/aggregates/fir.aggregate'
import { UnitaMisura } from '../../domain/fir/value-objects/quantita'
import { FirBloccatoAllInvioError } from '../../domain/fir/guardia-invio-rentri'
import { FIRResponseDto } from '../../api/fir/dtos/fir-response.dto'
import { costruttorePayloadFinto } from './mappatura/aiuti-test'
import { SyncFIRToRENTRIUseCase } from './sync-fir-to-rentri.use-case'
import { TrasmettiFIRSecondoModalitaUseCase } from './trasmetti-fir-secondo-modalita.use-case'
import { TriggerBatchSyncUseCase } from './trigger-batch-sync.use-case'
import { AcquisisciFormularioRENTRIUseCase } from './acquisisci-formulario-rentri.use-case'
import { AccettaORespingiFIRUseCase } from './accetta-o-respingi-fir.use-case'
import { AnnullaFIRRentriUseCase } from './annulla-fir-rentri.use-case'
import { CompletaOperazioneConFirmaUseCase } from './completa-operazione-con-firma.use-case'
import { GestisciAllegatiFIRUseCase } from './gestisci-allegati-fir.use-case'
import { RilasciaFormularioRENTRIUseCase } from './rilascia-formulario-rentri.use-case'

const TENANT = 'tenant-1'
const MOTIVO = 'Importato: invio a RENTRI bloccato fino alla riconciliazione'

function firEmesso(opzioni: { bloccato?: boolean; sync?: 'PENDING' | 'SYNCING' } = {}): FIR {
  const fir = FIR.create({
    produttoreId: 'produttore-1',
    tenantId: TENANT,
    rifiuto: { cerCode: '13 02 05*', quantita: 120, unitaMisura: UnitaMisura.KG },
    trasportatoreId: 'trasportatore-1',
    destinatarioId: 'destinatario-1',
  })
  fir.emetti('FIR-2026-000001', {
    firmatario: 'Mario Rossi',
    timestamp: new Date(),
    certificato: 'firma',
    userId: 'user-1',
    documentHash: 'h1',
    certificateHash: 'h2',
  } as any)
  if (opzioni.sync === 'SYNCING') fir.avviaTentativoRentri(new Date(Date.now() - 3_600_000))
  if (opzioni.bloccato) {
    Object.assign(fir, { _bloccatoInvio: true, _motivoBloccoInvio: MOTIVO })
  }
  return fir
}

const logger = () => ({
  setContext: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
})

describe('SyncFIRToRENTRIUseCase: FIR importato bloccato', () => {
  function costruisci(fir: FIR) {
    const repo = {
      findById: jest.fn().mockResolvedValue(fir),
      save: jest.fn(),
      prenotaTrasmissioneRentri: jest.fn().mockResolvedValue(true),
    }
    const client = { creaFormulario: jest.fn(), attendiEsito: jest.fn() }
    const costruisciPayload = { costruisci: jest.fn() }
    const syncLog = { createPending: jest.fn(), save: jest.fn() }
    const useCase = new SyncFIRToRENTRIUseCase(
      repo as any,
      client as any,
      syncLog as any,
      { publish: jest.fn() } as any,
      logger() as any,
      costruisciPayload as any
    )
    return { useCase, repo, client, costruisciPayload, syncLog }
  }

  it.each(['PENDING', 'SYNCING'] as const)(
    'FIR bloccato in %s: FirBloccatoAllInvioError prima di costruire il corpo, zero chiamate al client',
    async stato => {
      const { useCase, repo, client, costruisciPayload, syncLog } = costruisci(
        firEmesso({ bloccato: true, sync: stato === 'SYNCING' ? 'SYNCING' : undefined })
      )

      await expect(useCase.execute('fir-1', TENANT)).rejects.toBeInstanceOf(
        FirBloccatoAllInvioError
      )

      expect(costruisciPayload.costruisci).not.toHaveBeenCalled()
      expect(repo.prenotaTrasmissioneRentri).not.toHaveBeenCalled()
      expect(client.creaFormulario).not.toHaveBeenCalled()
      expect(client.attendiEsito).not.toHaveBeenCalled()
      expect(syncLog.createPending).not.toHaveBeenCalled()
      expect(repo.save).not.toHaveBeenCalled()
    }
  )

  it('prova di controllo: lo stesso FIR non bloccato supera la guardia e arriva alla prenotazione', async () => {
    const fir = firEmesso()
    const repo = {
      findById: jest.fn().mockResolvedValue(fir),
      save: jest.fn(),
      prenotaTrasmissioneRentri: jest.fn().mockResolvedValue(false),
    }
    const useCase = new SyncFIRToRENTRIUseCase(
      repo as any,
      { creaFormulario: jest.fn() } as any,
      { createPending: jest.fn(), save: jest.fn() } as any,
      { publish: jest.fn() } as any,
      logger() as any,
      costruttorePayloadFinto()
    )
    const esito = await useCase.execute('fir-1', TENANT)
    expect(esito.giaInCorso).toBe(true)
    expect(repo.prenotaTrasmissioneRentri).toHaveBeenCalled()
  })
})

describe('(d, FIR) TrasmettiFIRSecondoModalitaUseCase: nessun addSyncJob per un importato', () => {
  function costruisci(fir: FIR | null, modalita: 'AUTOMATICA' | 'IBRIDA') {
    const coda = { addSyncJob: jest.fn().mockResolvedValue('job-1') }
    const repo = { findById: jest.fn().mockResolvedValue(fir), save: jest.fn() }
    const useCase = new TrasmettiFIRSecondoModalitaUseCase(
      {
        getForTenant: jest
          .fn()
          .mockResolvedValue({ modalitaLegame: modalita, certificatoConfigurato: true }),
      } as any,
      coda as any,
      repo as any,
      logger() as any,
      { moduliAttivi: jest.fn().mockResolvedValue(['fir', 'rentri']) } as any
    )
    return { useCase, coda, repo }
  }

  it.each(['AUTOMATICA', 'IBRIDA'] as const)('%s: FIR importato, nessun job accodato', async m => {
    const { useCase, coda } = costruisci(firEmesso({ bloccato: true }), m)
    const esito = await useCase.eseguiSeAutomatica({ firId: 'fir-1', tenantId: TENANT })
    expect(esito).toEqual({ avviata: false, motivo: 'BLOCCATO_ALL_INVIO' })
    expect(coda.addSyncJob).not.toHaveBeenCalled()
  })

  it.each(['AUTOMATICA', 'IBRIDA'] as const)(
    '%s: prova di controllo, il FIR normale si accoda',
    async m => {
      const { useCase, coda } = costruisci(firEmesso(), m)
      const esito = await useCase.eseguiSeAutomatica({ firId: 'fir-1', tenantId: TENANT })
      expect(esito.avviata).toBe(true)
      expect(coda.addSyncJob).toHaveBeenCalledTimes(1)
    }
  )
})

describe('(d, FIR) TriggerBatchSyncUseCase: un importato fra tre', () => {
  it('due accodati, uno saltato con motivo', async () => {
    const normali = [firEmesso(), firEmesso()]
    const importato = firEmesso({ bloccato: true })
    const firs = [normali[0], importato, normali[1]]
    const coda = { addBatchJob: jest.fn().mockResolvedValue('batch-1') }
    const useCase = new TriggerBatchSyncUseCase(
      { findByIds: jest.fn().mockResolvedValue(firs) } as any,
      coda as any,
      logger() as any
    )

    const esito = await useCase.execute({ firIds: firs.map(f => f.id), tenantId: TENANT })

    expect(esito.queuedCount).toBe(2)
    expect(esito.skippedCount).toBe(1)
    expect(esito.skippedReasons).toEqual([
      expect.objectContaining({
        firId: importato.id,
        reason: expect.stringContaining('importato'),
      }),
    ])
    const accodati = coda.addBatchJob.mock.calls[0][0].firIds
    expect(accodati).toEqual([normali[0].id, normali[1].id])
    expect(accodati).not.toContain(importato.id)
  })
})

describe('Q5: acquisisci-formulario-rentri', () => {
  const input = (scelta: any) => ({
    tenantId: TENANT,
    userId: 'user-1',
    userRole: 'OPERATOR',
    numeroFir: 'RENTRI-000999',
    numIscrSito: 'OP1234ABC123456-RM1234',
    visibilitaGiaAcquisita: false,
    scelta,
    correlationId: 'corr-1',
  })
  function costruisci(opzioni: { firTarget?: FIR; nuovo?: FIR }) {
    const repo = {
      findByRentriNumeroFir: jest.fn().mockResolvedValue(null),
      findById: jest.fn().mockResolvedValue(opzioni.firTarget ?? null),
      save: jest.fn().mockResolvedValue(undefined),
    }
    const client = {
      acquisisciVisibilita: jest.fn().mockResolvedValue(undefined),
      leggiFormulario: jest.fn().mockResolvedValue({ stato_formulario: 'EMESSO' }),
    }
    const port = { creaDaDettaglio: jest.fn().mockResolvedValue(opzioni.nuovo) }
    const useCase = new AcquisisciFormularioRENTRIUseCase(
      repo as any,
      client as any,
      { activityLog: { create: jest.fn() } } as any,
      port as any,
      logger() as any
    )
    return { useCase, repo, client }
  }

  it("un FIR riacquisito da RENTRI (scelta NUOVO) nasce legato e NON e' bloccato: non e' un import da WinWaste", async () => {
    const nuovo = firEmesso()
    const { useCase, repo, client } = costruisci({ nuovo })
    const esito = await useCase.execute(input({ tipo: 'NUOVO' }) as any)

    expect(client.acquisisciVisibilita).toHaveBeenCalledTimes(1)
    expect(repo.save).toHaveBeenCalledWith(nuovo)
    expect(esito.firId).toBe(nuovo.id)
    expect(nuovo.rentriNumeroFir).toBe('RENTRI-000999')
    expect(nuovo.bloccatoInvio).toBe(false)
    expect(nuovo.motivoBloccoInvio).toBeNull()
  })

  it('collegare un FIR importato (COLLEGA_ESISTENTE su un bloccato): rifiutato prima di scrivere su RENTRI', async () => {
    const target = firEmesso({ bloccato: true })
    const { useCase, repo, client } = costruisci({ firTarget: target })
    await expect(
      useCase.execute(input({ tipo: 'COLLEGA_ESISTENTE', firId: target.id }) as any)
    ).rejects.toBeInstanceOf(FirBloccatoAllInvioError)
    expect(client.acquisisciVisibilita).not.toHaveBeenCalled()
    expect(repo.save).not.toHaveBeenCalled()
  })
})

describe('FIRResponseDto espone il blocco', () => {
  it('bloccatoInvio, motivoBloccoInvio e canSyncToRENTRI falso', () => {
    const dto = FIRResponseDto.fromDomain(firEmesso({ bloccato: true }))
    expect(dto.bloccatoInvio).toBe(true)
    expect(dto.motivoBloccoInvio).toBe(MOTIVO)
    expect(dto.canSyncToRENTRI).toBe(false)
  })
  it("un FIR normale non e' bloccato", () => {
    const dto = FIRResponseDto.fromDomain(firEmesso())
    expect(dto.bloccatoInvio).toBe(false)
    expect(dto.motivoBloccoInvio).toBeNull()
  })
})

describe('Altri punti di scrittura: nessuna chiamata al client per un FIR bloccato', () => {
  const bloccato = () => firEmesso({ bloccato: true })
  const conLegame = () => {
    const fir = bloccato()
    Object.assign(fir, { _rentriNumeroFir: 'RENTRI-1' })
    return fir
  }
  const client = () => ({
    inviaAccettazione: jest.fn(),
    annullaFormulario: jest.fn(),
    inviaNoteAnnullamento: jest.fn(),
    richiediHashPerFirma: jest.fn(),
    caricaAllegato: jest.fn(),
    eliminaAllegato: jest.fn(),
    rilasciaVisibilita: jest.fn(),
    leggiAzioniDisponibili: jest.fn(),
  })
  const repo = (fir: FIR) => ({ findById: jest.fn().mockResolvedValue(fir), save: jest.fn() })
  const nessunaScrittura = (c: ReturnType<typeof client>) => {
    for (const [nome, fn] of Object.entries(c)) {
      expect({ nome, chiamate: fn.mock.calls.length }).toEqual({ nome, chiamate: 0 })
    }
  }

  it('accetta-o-respingi', async () => {
    const c = client()
    const uc = new AccettaORespingiFIRUseCase(
      repo(conLegame()) as any,
      { verifica: jest.fn() } as any,
      c as any,
      {} as any,
      logger() as any
    )
    await expect(
      uc.execute({ firId: 'f', tenantId: TENANT, tipoAccettazione: 'ACCETTAZIONE' } as any)
    ).rejects.toBeInstanceOf(FirBloccatoAllInvioError)
    nessunaScrittura(c)
  })

  it('annulla-fir-rentri', async () => {
    const c = client()
    const uc = new AnnullaFIRRentriUseCase(
      repo(conLegame()) as any,
      { verifica: jest.fn() } as any,
      c as any,
      {} as any,
      logger() as any
    )
    await expect(
      uc.execute({ firId: 'f', tenantId: TENANT, motivo: 'errore' } as any)
    ).rejects.toBeInstanceOf(FirBloccatoAllInvioError)
    nessunaScrittura(c)
  })

  it('completa-operazione-con-firma', async () => {
    const c = client()
    const uc = new CompletaOperazioneConFirmaUseCase(
      repo(conLegame()) as any,
      {} as any,
      c as any,
      {} as any,
      logger() as any
    )
    await expect(
      uc.execute({ firId: 'f', tenantId: TENANT, tipoOperazione: 'ANNULLA' } as any)
    ).rejects.toBeInstanceOf(FirBloccatoAllInvioError)
    nessunaScrittura(c)
  })

  it('gestisci-allegati: carica ed elimina', async () => {
    const c = client()
    const uc = new GestisciAllegatiFIRUseCase(
      repo(conLegame()) as any,
      {} as any,
      { verifica: jest.fn() } as any,
      c as any,
      logger() as any
    )
    await expect(
      uc.caricaAllegato({ firId: 'f', tenantId: TENANT, nomeFile: 'a.pdf' } as any)
    ).rejects.toBeInstanceOf(FirBloccatoAllInvioError)
    await expect(
      uc.eliminaAllegato({ firId: 'f', tenantId: TENANT, allegatoLocaleId: 'a' } as any)
    ).rejects.toBeInstanceOf(FirBloccatoAllInvioError)
    nessunaScrittura(c)
  })

  it('rilascia-formulario-rentri', async () => {
    const c = client()
    const uc = new RilasciaFormularioRENTRIUseCase(
      repo(conLegame()) as any,
      c as any,
      {} as any,
      logger() as any
    )
    await expect(
      uc.execute({ firId: 'f', tenantId: TENANT, userId: 'u', userRole: 'ADMIN' } as any)
    ).rejects.toBeInstanceOf(FirBloccatoAllInvioError)
    nessunaScrittura(c)
  })
})
