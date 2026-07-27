import { ScaricaPdfFirUseCase } from './scarica-pdf-fir.use-case'
import { FIR } from '../../domain/fir/aggregates/fir.aggregate'

/**
 * Unitario di `ScaricaPdfFirUseCase` (R3 Task 7): tutte le dipendenze
 * mockate, nessuna rete reale (v. `rentri-pdf.oracolo.spec.ts` per il ciclo
 * completo contro la fake in-process).
 *
 * Punto di correttezza #1 del piano (autorizzazione, riga 1748 del
 * contratto): un FIR di un altro tenant deve rispondere con lo STESSO errore
 * ("non trovato") di un FIR davvero inesistente — mai un errore diverso che
 * confermerebbe l'esistenza dell'id a chi non ha diritto di vederlo.
 */
describe('ScaricaPdfFirUseCase', () => {
  function creaFIRLegato(tenantId: string, numeroFir = 'BCDFG000001BC'): FIR {
    const fir = FIR.create({
      produttoreId: 'produttore-test',
      trasportatoreId: 'trasportatore-test',
      destinatarioId: 'destinatario-test',
      tenantId,
      rifiuto: { cerCode: '150101', quantita: 100 },
    })
    fir.emetti('FIR-TEST-000001', {
      firmatario: 'Produttore di prova SRL',
      timestamp: new Date(),
      certificato: 'certificato-di-prova',
    })
    fir.markRENTRISynced(numeroFir)
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

  it('scarica il PDF quando il FIR è legato e appartiene al tenant chiamante', async () => {
    const tenantId = 'tenant-1'
    const fir = creaFIRLegato(tenantId, 'BCDFG000099BC')

    const firRepository = { findById: jest.fn().mockResolvedValue(fir) }
    const rentriApiClient = {
      scaricaPdf: jest.fn().mockResolvedValue({
        disponibile: true,
        nomeFile: 'FIR-BCDFG000099BC.pdf',
        mime: 'application/pdf',
        contenutoBase64: Buffer.from('%PDF-1.4 finto').toString('base64'),
      }),
    }

    const useCase = new ScaricaPdfFirUseCase(
      firRepository as any,
      rentriApiClient as any,
      creaLogger()
    )

    const risultato = await useCase.execute(fir.id, tenantId)

    expect(rentriApiClient.scaricaPdf).toHaveBeenCalledWith(tenantId, 'BCDFG000099BC')
    expect(risultato.disponibile).toBe(true)
    expect(risultato.nomeFile).toBe('FIR-BCDFG000099BC.pdf')
  })

  it('propaga disponibile:false senza contattare due volte l’ente quando l’ente risponde 204', async () => {
    const tenantId = 'tenant-1'
    const fir = creaFIRLegato(tenantId)

    const firRepository = { findById: jest.fn().mockResolvedValue(fir) }
    const rentriApiClient = {
      scaricaPdf: jest.fn().mockResolvedValue({ disponibile: false }),
    }

    const useCase = new ScaricaPdfFirUseCase(
      firRepository as any,
      rentriApiClient as any,
      creaLogger()
    )
    const risultato = await useCase.execute(fir.id, tenantId)

    expect(risultato).toEqual({ disponibile: false })
    expect(rentriApiClient.scaricaPdf).toHaveBeenCalledTimes(1)
  })

  it('rifiuta un FIR inesistente con NOT_FOUND', async () => {
    const firRepository = { findById: jest.fn().mockResolvedValue(null) }
    const rentriApiClient = { scaricaPdf: jest.fn() }

    const useCase = new ScaricaPdfFirUseCase(
      firRepository as any,
      rentriApiClient as any,
      creaLogger()
    )

    await expect(useCase.execute('fir-inesistente', 'tenant-1')).rejects.toMatchObject({
      code: 'NOT_FOUND',
    })
    expect(rentriApiClient.scaricaPdf).not.toHaveBeenCalled()
  })

  it(
    'rifiuta un FIR di un altro tenant con LO STESSO errore (NOT_FOUND) di un FIR inesistente ' +
      '— 404, non 403/401, per non rivelare a un altro tenant che l’id esiste (riga 1748 del contratto)',
    async () => {
      const fir = creaFIRLegato('tenant-proprietario')
      const firRepository = { findById: jest.fn().mockResolvedValue(fir) }
      const rentriApiClient = { scaricaPdf: jest.fn() }

      const useCase = new ScaricaPdfFirUseCase(
        firRepository as any,
        rentriApiClient as any,
        creaLogger()
      )

      await expect(useCase.execute(fir.id, 'tenant-estraneo')).rejects.toMatchObject({
        code: 'NOT_FOUND',
      })
      expect(rentriApiClient.scaricaPdf).not.toHaveBeenCalled()
    }
  )

  it('rifiuta un FIR non ancora legato a RENTRI senza contattare l’ente', async () => {
    const fir = FIR.create({
      produttoreId: 'produttore-test',
      trasportatoreId: 'trasportatore-test',
      destinatarioId: 'destinatario-test',
      tenantId: 'tenant-1',
      rifiuto: { cerCode: '150101', quantita: 100 },
    })

    const firRepository = { findById: jest.fn().mockResolvedValue(fir) }
    const rentriApiClient = { scaricaPdf: jest.fn() }

    const useCase = new ScaricaPdfFirUseCase(
      firRepository as any,
      rentriApiClient as any,
      creaLogger()
    )

    await expect(useCase.execute(fir.id, 'tenant-1')).rejects.toThrow(/FIR_NON_LEGATO_RENTRI/)
    expect(rentriApiClient.scaricaPdf).not.toHaveBeenCalled()
  })
})
