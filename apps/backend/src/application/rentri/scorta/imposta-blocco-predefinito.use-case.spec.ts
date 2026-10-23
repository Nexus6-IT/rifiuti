import { NotFoundException } from '@nestjs/common'
import { ImpostaBloccoPredefinitoUseCase } from './imposta-blocco-predefinito.use-case'
import { DomainException } from '../../../domain/shared/domain-exception'

describe('ImpostaBloccoPredefinitoUseCase', () => {
  const TENANT = 'tenant-1'

  function build(overrides: {
    codiceFiscale?: string | null
    blocchi?: { codice_blocco: string; num_iscr_sito: string | null }[]
    setImpl?: jest.Mock
  }) {
    const prisma = {
      tenant: {
        findUnique: jest.fn().mockResolvedValue({
          codiceFiscale:
            overrides.codiceFiscale === undefined ? 'RSSMRA80A01H501U' : overrides.codiceFiscale,
        }),
      },
    }
    const vidimazioneClient = {
      elencaBlocchi: jest.fn().mockResolvedValue({
        risultati: overrides.blocchi ?? [],
        paging: { page: 1, pageSize: 100, pageCount: 1, totalRecordCount: 0 },
      }),
    }
    const unitaLocaleService = {
      impostaBloccoPredefinitoPerNumIscrSito:
        overrides.setImpl ?? jest.fn().mockResolvedValue({ numIscrSito: 'OP1234ABC123456-RM1234' }),
    }
    return {
      useCase: new ImpostaBloccoPredefinitoUseCase(
        prisma as any,
        vidimazioneClient as any,
        unitaLocaleService as any
      ),
      unitaLocaleService,
    }
  }

  it('risolve la sede dal blocco e la imposta come predefinito', async () => {
    const { useCase, unitaLocaleService } = build({
      blocchi: [{ codice_blocco: 'BLK-A', num_iscr_sito: 'OP1234ABC123456-RM1234' }],
    })

    const risultato = await useCase.execute(TENANT, 'BLK-A')

    expect(unitaLocaleService.impostaBloccoPredefinitoPerNumIscrSito).toHaveBeenCalledWith(
      TENANT,
      'OP1234ABC123456-RM1234',
      'BLK-A'
    )
    expect(risultato).toEqual({ codiceBlocco: 'BLK-A', numIscrSito: 'OP1234ABC123456-RM1234' })
  })

  it('blocco inesistente presso l’ente: 404, nessuna scrittura locale', async () => {
    const { useCase, unitaLocaleService } = build({ blocchi: [] })

    await expect(useCase.execute(TENANT, 'BLK-INESISTENTE')).rejects.toThrow(NotFoundException)
    expect(unitaLocaleService.impostaBloccoPredefinitoPerNumIscrSito).not.toHaveBeenCalled()
  })

  it('fail-closed: senza codice fiscale non interroga l’ente', async () => {
    const { useCase } = build({ codiceFiscale: null })

    await expect(useCase.execute(TENANT, 'BLK-A')).rejects.toThrow(DomainException)
  })
})
