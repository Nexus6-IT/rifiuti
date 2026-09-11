import { ElencaBlocchiRentriUseCase } from './elenca-blocchi-rentri.use-case'
import { DomainException } from '../../../domain/shared/domain-exception'

describe('ElencaBlocchiRentriUseCase', () => {
  const TENANT = 'tenant-1'

  function build(overrides: {
    codiceFiscale?: string | null
    unitaLocali?: { numIscrSito: string; codiceBloccoPredefinito: string | null }[]
    blocchi?: unknown[]
  }) {
    const prisma = {
      tenant: {
        findUnique: jest.fn().mockResolvedValue({
          codiceFiscale:
            overrides.codiceFiscale === undefined ? 'RSSMRA80A01H501U' : overrides.codiceFiscale,
        }),
      },
    }
    const unitaLocaleService = {
      listForTenant: jest.fn().mockResolvedValue(overrides.unitaLocali ?? []),
    }
    const vidimazioneClient = {
      elencaBlocchi: jest.fn().mockResolvedValue({
        risultati: overrides.blocchi ?? [],
        paging: {
          page: 1,
          pageSize: 100,
          pageCount: 1,
          totalRecordCount: (overrides.blocchi ?? []).length,
        },
      }),
    }
    const useCase = new ElencaBlocchiRentriUseCase(
      prisma as any,
      unitaLocaleService as any,
      vidimazioneClient as any
    )
    return { useCase, prisma, unitaLocaleService, vidimazioneClient }
  }

  it('mappa i blocchi letti dall’ente e marca predefinito quello configurato per la sede', async () => {
    const { useCase, vidimazioneClient } = build({
      unitaLocali: [{ numIscrSito: 'OP1234ABC123456-RM1234', codiceBloccoPredefinito: 'BLK-A' }],
      blocchi: [
        {
          codice_blocco: 'BLK-A',
          descrizione: 'Blocco sede Roma',
          num_iscr_sito: 'OP1234ABC123456-RM1234',
          disattivo: false,
          numero_fir_vidimati: 12,
          data_ultimo_utilizzo: '2026-09-10T10:00:00Z',
        },
        {
          codice_blocco: 'BLK-B',
          descrizione: 'Blocco riserva',
          num_iscr_sito: 'OP1234ABC123456-RM1234',
          disattivo: true,
          numero_fir_vidimati: 0,
          data_ultimo_utilizzo: null,
        },
      ],
    })

    const risultato = await useCase.execute(TENANT)

    expect(vidimazioneClient.elencaBlocchi).toHaveBeenCalledWith(
      'RSSMRA80A01H501U',
      expect.objectContaining({ ancheDisattivi: true }),
      TENANT
    )
    expect(risultato.blocchi).toEqual([
      {
        codiceBlocco: 'BLK-A',
        descrizione: 'Blocco sede Roma',
        numIscrSito: 'OP1234ABC123456-RM1234',
        disattivo: false,
        numeroFirVidimati: 12,
        dataUltimoUtilizzo: '2026-09-10T10:00:00Z',
        predefinito: true,
      },
      {
        codiceBlocco: 'BLK-B',
        descrizione: 'Blocco riserva',
        numIscrSito: 'OP1234ABC123456-RM1234',
        disattivo: true,
        numeroFirVidimati: 0,
        dataUltimoUtilizzo: null,
        predefinito: false,
      },
    ])
  })

  it('fail-closed: senza codice fiscale del tenant non interroga l’ente', async () => {
    const { useCase, vidimazioneClient } = build({ codiceFiscale: null })

    await expect(useCase.execute(TENANT)).rejects.toThrow(DomainException)
    expect(vidimazioneClient.elencaBlocchi).not.toHaveBeenCalled()
  })
})
