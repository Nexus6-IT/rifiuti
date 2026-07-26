import { GetAzioniDisponibiliUseCase } from './get-azioni-disponibili.use-case'
import { FIR } from '../../domain/fir/aggregates/fir.aggregate'

/**
 * Unitario di `GetAzioniDisponibiliUseCase` (R3 Task 2): client e
 * repository mockati, nessuna rete/DB reali (v. `rentri-azioni.oracolo.spec.ts`
 * per il ciclo contro la fake in-process).
 */
describe('GetAzioniDisponibiliUseCase', () => {
  function creaFIRLegato(tenantId: string): FIR {
    const fir = FIR.create({
      produttoreId: 'produttore-test',
      trasportatoreId: 'trasportatore-test',
      destinatarioId: 'destinatario-test',
      tenantId,
      rifiuto: {
        cerCode: '150101',
        quantita: 100,
      },
    })

    fir.emetti('FIR-TEST-000001', {
      firmatario: 'Produttore di prova SRL',
      timestamp: new Date(),
      certificato: 'certificato-di-prova',
    })
    fir.markRENTRISynced('BCDFG000001BC')

    return fir
  }

  function creaLogger(): any {
    return {
      setContext: jest.fn(),
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    }
  }

  it('legge le azioni disponibili, riconcilia lo stato via applyRentriStato, salva e traduce ogni operazione', async () => {
    const tenantId = 'tenant-azioni-1'
    const fir = creaFIRLegato(tenantId)

    const firRepository = {
      findById: jest.fn().mockResolvedValue(fir),
      save: jest.fn().mockResolvedValue(undefined),
    }
    const prisma: any = {
      tenant: {
        findUnique: jest.fn().mockResolvedValue({ codiceFiscale: 'RSSMRA80A01H501U' }),
      },
    }
    const rentriApiClient: any = {
      leggiAzioniDisponibili: jest.fn().mockResolvedValue({
        versione: 3,
        stato: 'InserimentoAccettazione',
        azioni: ['Accettazione', 'Annulla'],
      }),
    }

    const applySpy = jest.spyOn(fir, 'applyRentriStato')

    const useCase = new GetAzioniDisponibiliUseCase(
      prisma,
      firRepository as any,
      rentriApiClient,
      creaLogger()
    )

    const risultato = await useCase.execute(fir.id, tenantId, 'correlazione-test')

    expect(rentriApiClient.leggiAzioniDisponibili).toHaveBeenCalledWith(
      tenantId,
      'BCDFG000001BC',
      'RSSMRA80A01H501U'
    )
    expect(applySpy).toHaveBeenCalledWith('InserimentoAccettazione', 'correlazione-test')
    expect(firRepository.save).toHaveBeenCalledWith(fir)

    expect(risultato.stato).toBe('InserimentoAccettazione')
    expect(risultato.versione).toBe(3)
    expect(risultato.azioni).toEqual([
      { operazione: 'Accettazione', verbo: 'Accetta o respingi il carico' },
      { operazione: 'Annulla', verbo: 'Annulla il formulario' },
    ])
  })

  it('traduce una lista vuota di azioni senza errori (formulario in stato terminale)', async () => {
    const tenantId = 'tenant-azioni-2'
    const fir = creaFIRLegato(tenantId)

    const firRepository = {
      findById: jest.fn().mockResolvedValue(fir),
      save: jest.fn().mockResolvedValue(undefined),
    }
    const prisma: any = {
      tenant: { findUnique: jest.fn().mockResolvedValue({ codiceFiscale: 'RSSMRA80A01H501U' }) },
    }
    const rentriApiClient: any = {
      leggiAzioniDisponibili: jest
        .fn()
        .mockResolvedValue({ versione: 4, stato: 'Accettato', azioni: null }),
    }

    const useCase = new GetAzioniDisponibiliUseCase(
      prisma,
      firRepository as any,
      rentriApiClient,
      creaLogger()
    )

    const risultato = await useCase.execute(fir.id, tenantId)

    expect(risultato.azioni).toEqual([])
  })

  it('rifiuta con NOT_FOUND se il FIR non esiste', async () => {
    const firRepository = { findById: jest.fn().mockResolvedValue(null), save: jest.fn() }
    const prisma: any = { tenant: { findUnique: jest.fn() } }
    const rentriApiClient: any = { leggiAzioniDisponibili: jest.fn() }

    const useCase = new GetAzioniDisponibiliUseCase(
      prisma,
      firRepository as any,
      rentriApiClient,
      creaLogger()
    )

    await expect(useCase.execute('fir-inesistente', 'tenant-x')).rejects.toMatchObject({
      code: 'NOT_FOUND',
    })
    expect(rentriApiClient.leggiAzioniDisponibili).not.toHaveBeenCalled()
  })

  it('rifiuta con UNAUTHORIZED se il FIR appartiene a un altro tenant', async () => {
    const fir = creaFIRLegato('tenant-proprietario')
    const firRepository = { findById: jest.fn().mockResolvedValue(fir), save: jest.fn() }
    const prisma: any = { tenant: { findUnique: jest.fn() } }
    const rentriApiClient: any = { leggiAzioniDisponibili: jest.fn() }

    const useCase = new GetAzioniDisponibiliUseCase(
      prisma,
      firRepository as any,
      rentriApiClient,
      creaLogger()
    )

    await expect(useCase.execute(fir.id, 'tenant-intruso')).rejects.toMatchObject({
      code: 'UNAUTHORIZED',
    })
    expect(rentriApiClient.leggiAzioniDisponibili).not.toHaveBeenCalled()
  })

  it('rifiuta con un errore di dominio leggibile se il FIR non è legato a RENTRI, senza contattare l’ente', async () => {
    const tenantId = 'tenant-non-legato'
    const fir = FIR.create({
      produttoreId: 'p',
      trasportatoreId: 't',
      destinatarioId: 'd',
      tenantId,
      rifiuto: { cerCode: '150101', quantita: 10 },
    })
    // Nessuna emissione/markRENTRISynced: rentriNumeroFir resta null.

    const firRepository = { findById: jest.fn().mockResolvedValue(fir), save: jest.fn() }
    const prisma: any = { tenant: { findUnique: jest.fn() } }
    const rentriApiClient: any = { leggiAzioniDisponibili: jest.fn() }

    const useCase = new GetAzioniDisponibiliUseCase(
      prisma,
      firRepository as any,
      rentriApiClient,
      creaLogger()
    )

    await expect(useCase.execute(fir.id, tenantId)).rejects.toMatchObject({
      code: 'BUSINESS_RULE_VIOLATION',
    })
    expect(rentriApiClient.leggiAzioniDisponibili).not.toHaveBeenCalled()
    expect(firRepository.save).not.toHaveBeenCalled()
  })

  it('rifiuta se il codice fiscale del tenant non è configurato, senza contattare l’ente', async () => {
    const tenantId = 'tenant-senza-cf'
    const fir = creaFIRLegato(tenantId)

    const firRepository = { findById: jest.fn().mockResolvedValue(fir), save: jest.fn() }
    const prisma: any = {
      tenant: { findUnique: jest.fn().mockResolvedValue({ codiceFiscale: null }) },
    }
    const rentriApiClient: any = { leggiAzioniDisponibili: jest.fn() }

    const useCase = new GetAzioniDisponibiliUseCase(
      prisma,
      firRepository as any,
      rentriApiClient,
      creaLogger()
    )

    await expect(useCase.execute(fir.id, tenantId)).rejects.toMatchObject({
      code: 'BUSINESS_RULE_VIOLATION',
    })
    expect(rentriApiClient.leggiAzioniDisponibili).not.toHaveBeenCalled()
  })

  it('non salva né riconcilia nulla se il client RENTRI rifiuta la chiamata (difesa in profondità)', async () => {
    const tenantId = 'tenant-guasto'
    const fir = creaFIRLegato(tenantId)
    const statoPrimaDelTentativo = fir.rentriStatoFormulario

    const firRepository = { findById: jest.fn().mockResolvedValue(fir), save: jest.fn() }
    const prisma: any = {
      tenant: { findUnique: jest.fn().mockResolvedValue({ codiceFiscale: 'RSSMRA80A01H501U' }) },
    }
    const rentriApiClient: any = {
      leggiAzioniDisponibili: jest.fn().mockRejectedValue(new Error('Risposta inattesa: HTTP 400')),
    }

    const useCase = new GetAzioniDisponibiliUseCase(
      prisma,
      firRepository as any,
      rentriApiClient,
      creaLogger()
    )

    await expect(useCase.execute(fir.id, tenantId)).rejects.toThrow('HTTP 400')

    expect(firRepository.save).not.toHaveBeenCalled()
    expect(fir.rentriStatoFormulario).toBe(statoPrimaDelTentativo)
  })
})
