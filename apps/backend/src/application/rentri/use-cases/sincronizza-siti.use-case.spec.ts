import { BadRequestException } from '@nestjs/common'
import {
  SincronizzaSitiUseCase,
  MESSAGGIO_NUM_ISCR_OPERATORE_MANCANTE,
} from './sincronizza-siti.use-case'

/**
 * Caso che conta (v. piano R4 Task 3 + brief): un codice/unità locale
 * rimossa/non più restituita dall'ente non deve rompere ciò che già esiste;
 * qui il caso analogo è "l'operatore non ha ancora configurato numIscrOperatore"
 * — l'azione di allineamento non parte, ma la LETTURA della cache locale non
 * si blocca mai.
 */
describe('SincronizzaSitiUseCase', () => {
  let credentialService: any
  let client: any
  let unitaLocaleService: any
  let logger: any
  let useCase: SincronizzaSitiUseCase

  const TENANT_ID = 'tenant-1'
  const CACHE_ATTUALE = [{ id: 'ul-1', numIscrSito: 'MI00001234-001' }]

  beforeEach(() => {
    credentialService = {
      getForTenant: jest.fn(),
      getSitiSincronizzatiAl: jest.fn(),
      markSitiSincronizzati: jest.fn().mockResolvedValue(undefined),
    }
    client = {
      elencaSiti: jest.fn(),
    }
    unitaLocaleService = {
      listForTenant: jest.fn().mockResolvedValue(CACHE_ATTUALE),
      upsertFromRentri: jest.fn().mockResolvedValue(CACHE_ATTUALE),
    }
    logger = {
      setContext: jest.fn(),
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    }
    useCase = new SincronizzaSitiUseCase(credentialService, client, unitaLocaleService, logger)
  })

  describe('apertura pagina (forza assente) — mai fail-closed sulla sola lettura', () => {
    it('senza numIscrOperatore configurato: NON lancia, restituisce la cache locale', async () => {
      credentialService.getForTenant.mockResolvedValue({ numIscrOperatore: null })

      const risultato = await useCase.esegui(TENANT_ID)

      expect(risultato).toBe(CACHE_ATTUALE)
      expect(client.elencaSiti).not.toHaveBeenCalled()
      expect(unitaLocaleService.listForTenant).toHaveBeenCalledWith(TENANT_ID)
    })

    it('con numIscrOperatore configurato e cache MAI sincronizzata: allinea dall’ente', async () => {
      credentialService.getForTenant.mockResolvedValue({ numIscrOperatore: 'MI00001234' })
      credentialService.getSitiSincronizzatiAl.mockResolvedValue(null)
      client.elencaSiti.mockResolvedValue({
        risultati: [
          { num_iscr_sito: 'MI00001234-001', nome: 'Sede legale - Milano', stato: 'Attivo' },
        ],
        paging: { page: 1, pageSize: 100, pageCount: 1, totalRecordCount: 1 },
      })

      await useCase.esegui(TENANT_ID)

      expect(client.elencaSiti).toHaveBeenCalledWith('MI00001234', undefined, TENANT_ID)
      expect(unitaLocaleService.upsertFromRentri).toHaveBeenCalledWith(TENANT_ID, [
        { numIscrSito: 'MI00001234-001', denominazione: 'Sede legale - Milano', attiva: true },
      ])
      expect(credentialService.markSitiSincronizzati).toHaveBeenCalledWith(TENANT_ID)
    })

    it('con cache FRESCA (sincronizzata da meno di un’ora): NON richiama l’ente', async () => {
      credentialService.getForTenant.mockResolvedValue({ numIscrOperatore: 'MI00001234' })
      credentialService.getSitiSincronizzatiAl.mockResolvedValue(
        new Date(Date.now() - 5 * 60 * 1000)
      )

      const risultato = await useCase.esegui(TENANT_ID)

      expect(client.elencaSiti).not.toHaveBeenCalled()
      expect(risultato).toBe(CACHE_ATTUALE)
    })

    it('con cache SCADUTA (oltre un’ora): richiama l’ente', async () => {
      credentialService.getForTenant.mockResolvedValue({ numIscrOperatore: 'MI00001234' })
      credentialService.getSitiSincronizzatiAl.mockResolvedValue(
        new Date(Date.now() - 61 * 60 * 1000)
      )
      client.elencaSiti.mockResolvedValue({
        risultati: [],
        paging: { page: 1, pageSize: 100, pageCount: 1, totalRecordCount: 0 },
      })

      await useCase.esegui(TENANT_ID)

      expect(client.elencaSiti).toHaveBeenCalled()
    })

    it('se l’ente risponde con errore durante il refresh silenzioso: NON propaga, restituisce la cache', async () => {
      credentialService.getForTenant.mockResolvedValue({ numIscrOperatore: 'MI00001234' })
      credentialService.getSitiSincronizzatiAl.mockResolvedValue(null)
      client.elencaSiti.mockRejectedValue(new Error('RENTRI 429: tentativi esauriti'))

      const risultato = await useCase.esegui(TENANT_ID)

      expect(risultato).toBe(CACHE_ATTUALE)
      expect(logger.warn).toHaveBeenCalled()
      expect(credentialService.markSitiSincronizzati).not.toHaveBeenCalled()
    })

    it('filtra le righe senza num_iscr_sito valorizzato (non identificabili)', async () => {
      credentialService.getForTenant.mockResolvedValue({ numIscrOperatore: 'MI00001234' })
      credentialService.getSitiSincronizzatiAl.mockResolvedValue(null)
      client.elencaSiti.mockResolvedValue({
        risultati: [
          { num_iscr_sito: 'MI00001234-001', nome: 'Sede legale', stato: 'Attivo' },
          { num_iscr_sito: null, nome: 'Riga senza chiave', stato: 'Attivo' },
          { num_iscr_sito: '   ', nome: 'Riga vuota', stato: 'Attivo' },
        ],
        paging: { page: 1, pageSize: 100, pageCount: 1, totalRecordCount: 3 },
      })

      await useCase.esegui(TENANT_ID)

      expect(unitaLocaleService.upsertFromRentri).toHaveBeenCalledWith(TENANT_ID, [
        { numIscrSito: 'MI00001234-001', denominazione: 'Sede legale', attiva: true },
      ])
    })

    it('una sede con stato diverso da Attivo diventa attiva=false', async () => {
      credentialService.getForTenant.mockResolvedValue({ numIscrOperatore: 'MI00001234' })
      credentialService.getSitiSincronizzatiAl.mockResolvedValue(null)
      client.elencaSiti.mockResolvedValue({
        risultati: [{ num_iscr_sito: 'MI00001234-002', nome: 'Deposito', stato: 'Sospeso' }],
        paging: { page: 1, pageSize: 100, pageCount: 1, totalRecordCount: 1 },
      })

      await useCase.esegui(TENANT_ID)

      expect(unitaLocaleService.upsertFromRentri).toHaveBeenCalledWith(TENANT_ID, [
        { numIscrSito: 'MI00001234-002', denominazione: 'Deposito', attiva: false },
      ])
    })
  })

  describe('azione esplicita "Aggiorna dall’ente" (forza: true) — fail-closed', () => {
    it('senza numIscrOperatore configurato: lancia BadRequestException con messaggio azionabile, non chiama RENTRI', async () => {
      credentialService.getForTenant.mockResolvedValue({ numIscrOperatore: null })

      await expect(useCase.esegui(TENANT_ID, { forza: true })).rejects.toBeInstanceOf(
        BadRequestException
      )
      await expect(useCase.esegui(TENANT_ID, { forza: true })).rejects.toThrow(
        MESSAGGIO_NUM_ISCR_OPERATORE_MANCANTE
      )
      expect(client.elencaSiti).not.toHaveBeenCalled()
    })

    it('senza credenziale RENTRI del tutto: stesso fail-closed (non solo numIscrOperatore nullo)', async () => {
      credentialService.getForTenant.mockResolvedValue(null)

      await expect(useCase.esegui(TENANT_ID, { forza: true })).rejects.toBeInstanceOf(
        BadRequestException
      )
    })

    it('con numIscrOperatore configurato: ignora il TTL e richiama sempre l’ente', async () => {
      credentialService.getForTenant.mockResolvedValue({ numIscrOperatore: 'MI00001234' })
      client.elencaSiti.mockResolvedValue({
        risultati: [],
        paging: { page: 1, pageSize: 100, pageCount: 1, totalRecordCount: 0 },
      })

      await useCase.esegui(TENANT_ID, { forza: true })

      // Non ha nemmeno consultato la cache: forza bypassa il TTL a monte.
      expect(credentialService.getSitiSincronizzatiAl).not.toHaveBeenCalled()
      expect(client.elencaSiti).toHaveBeenCalledWith('MI00001234', undefined, TENANT_ID)
      expect(credentialService.markSitiSincronizzati).toHaveBeenCalledWith(TENANT_ID)
    })

    it('se l’ente fallisce: propaga l’errore (l’utente ha chiesto esplicitamente l’aggiornamento)', async () => {
      credentialService.getForTenant.mockResolvedValue({ numIscrOperatore: 'MI00001234' })
      client.elencaSiti.mockRejectedValue(new Error('RENTRI 403: operazione non consentita'))

      await expect(useCase.esegui(TENANT_ID, { forza: true })).rejects.toThrow(
        'RENTRI 403: operazione non consentita'
      )
      expect(credentialService.markSitiSincronizzati).not.toHaveBeenCalled()
    })
  })
})
