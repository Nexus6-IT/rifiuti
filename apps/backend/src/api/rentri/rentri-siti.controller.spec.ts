import { RentriSitiController } from './rentri-siti.controller'
import { SincronizzaSitiUseCase } from '../../application/rentri/use-cases/sincronizza-siti.use-case'
import { CurrentUserPayload } from '../../auth/decorators/current-user.decorator'

const user: CurrentUserPayload = {
  id: 'user-1',
  email: 'admin@example.com',
  tenantId: 'tenant-1',
  role: 'admin',
  permissions: [],
}

// richiesta senza switch di azienda: l'azienda selezionata coincide con quella del token
const req = { tenantId: user.tenantId, user }

const items = [
  {
    id: 'ul-1',
    numIscrSito: 'MI00001234-001',
    denominazione: 'Sede legale - Milano',
    principale: true,
    attiva: true,
    // Aggiunti dal lavoro R6 sulla scorta di numeri vidimati: il modello
    // Prisma li dichiara, quindi il finto deve averli o non compila.
    // Nulli: questa sede non ha un blocco predefinito ne una soglia di scorta.
    codiceBloccoPredefinito: null,
    dimensioneScortaDesiderata: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  },
]

describe('RentriSitiController', () => {
  let controller: RentriSitiController
  let useCase: jest.Mocked<SincronizzaSitiUseCase>

  beforeEach(() => {
    useCase = {
      esegui: jest.fn(),
    } as unknown as jest.Mocked<SincronizzaSitiUseCase>

    controller = new RentriSitiController(useCase)
  })

  describe('GET /rentri/siti', () => {
    it('legge dalla cache locale (forza assente/false)', async () => {
      useCase.esegui.mockResolvedValue(items)

      const res = await controller.list(req)

      expect(res).toEqual({ items })
      expect(useCase.esegui).toHaveBeenCalledWith('tenant-1')
    })
  })

  describe('POST /rentri/siti/aggiorna', () => {
    it('forza la rilettura dall’ente', async () => {
      useCase.esegui.mockResolvedValue(items)

      const res = await controller.aggiorna(req)

      expect(res).toEqual({ items })
      expect(useCase.esegui).toHaveBeenCalledWith('tenant-1', { forza: true })
    })

    it('propaga l’errore fail-closed del use case (numIscrOperatore mancante)', async () => {
      const errore = new Error('numIscrOperatore mancante')
      useCase.esegui.mockRejectedValue(errore)

      await expect(controller.aggiorna(req)).rejects.toThrow('numIscrOperatore mancante')
    })
  })
})
