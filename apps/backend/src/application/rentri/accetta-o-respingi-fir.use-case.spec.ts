import { AccettaORespingiFIRUseCase } from './accetta-o-respingi-fir.use-case'
import { FIR } from '../../domain/fir/aggregates/fir.aggregate'

/**
 * Unitario di `AccettaORespingiFIRUseCase` (R3 Task 4): tutte le dipendenze
 * mockate, nessuna rete/DB reali (v. `rentri-accettazione.oracolo.spec.ts`
 * per il ciclo completo contro la fake in-process).
 *
 * Il punto di correttezza #1 del piano: i tre scenari A/P/R verificano
 * l'ARGOMENTO REALE passato al mock di `inviaAccettazione`, non un valore
 * intermedio nello use case — è il punto in cui un bug manderebbe
 * un'accettazione quando l'utente intendeva respingere.
 */
describe('AccettaORespingiFIRUseCase', () => {
  function creaFIRLegato(tenantId: string, numeroFir = 'BCDFG000001BC'): FIR {
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

  function creaDipendenze(
    fir: FIR,
    opzioni?: {
      azioni?: { operazione: string; verbo: string }[]
      esitoAccettazione?: { errore: boolean; validazione: unknown[] }
      esitoFirma?: any
    }
  ) {
    const firRepository = {
      findById: jest.fn().mockResolvedValue(fir),
      save: jest.fn().mockResolvedValue(undefined),
    }

    const getAzioniDisponibiliUseCase = {
      execute: jest.fn().mockResolvedValue({
        stato: 'InserimentoAccettazione',
        versione: 1,
        azioni: opzioni?.azioni ?? [
          { operazione: 'Accettazione', verbo: 'Accetta o respingi il carico' },
        ],
      }),
    }

    const rentriApiClient = {
      inviaAccettazione: jest
        .fn()
        .mockResolvedValue(opzioni?.esitoAccettazione ?? { errore: false, validazione: [] }),
    }

    const completaOperazioneConFirmaUseCase = {
      execute: jest
        .fn()
        .mockResolvedValue(
          opzioni?.esitoFirma ?? { esito: 'COMPLETATA', statoFormulario: 'FirmaAccettazione' }
        ),
    }

    return {
      firRepository,
      getAzioniDisponibiliUseCase,
      rentriApiClient,
      completaOperazioneConFirmaUseCase,
    }
  }

  function creaUseCase(dipendenze: ReturnType<typeof creaDipendenze>): AccettaORespingiFIRUseCase {
    return new AccettaORespingiFIRUseCase(
      dipendenze.firRepository as any,
      dipendenze.getAzioniDisponibiliUseCase as any,
      dipendenze.rentriApiClient as any,
      dipendenze.completaOperazioneConFirmaUseCase as any,
      creaLogger()
    )
  }

  describe('i tre scenari A/P/R passano ESATTAMENTE il tipo scelto al client', () => {
    it("tipoAccettazione: 'A' — chiama inviaAccettazione con tipoAccettazione 'A'", async () => {
      const tenantId = 'tenant-1'
      const fir = creaFIRLegato(tenantId)
      const dipendenze = creaDipendenze(fir)
      const useCase = creaUseCase(dipendenze)

      await useCase.execute({
        firId: fir.id,
        tenantId,
        tipoAccettazione: 'A',
        quantitaAccettataKg: 100,
      })

      expect(dipendenze.rentriApiClient.inviaAccettazione).toHaveBeenCalledWith(
        tenantId,
        'BCDFG000001BC',
        expect.objectContaining({ tipoAccettazione: 'A', quantitaAccettataKg: 100 })
      )
    })

    it("tipoAccettazione: 'P' — chiama inviaAccettazione con tipoAccettazione 'P', causale e motivo", async () => {
      const tenantId = 'tenant-2'
      const fir = creaFIRLegato(tenantId)
      const dipendenze = creaDipendenze(fir)
      const useCase = creaUseCase(dipendenze)

      await useCase.execute({
        firId: fir.id,
        tenantId,
        tipoAccettazione: 'P',
        quantitaAccettataKg: 50,
        causaleRespingimento: 'NC',
        motivoRespingimento: 'Quantità parzialmente non conforme.',
      })

      expect(dipendenze.rentriApiClient.inviaAccettazione).toHaveBeenCalledWith(
        tenantId,
        'BCDFG000001BC',
        expect.objectContaining({
          tipoAccettazione: 'P',
          quantitaAccettataKg: 50,
          causaleRespingimento: 'NC',
          motivoRespingimento: 'Quantità parzialmente non conforme.',
        })
      )
    })

    it("tipoAccettazione: 'R' — chiama inviaAccettazione con tipoAccettazione 'R', causale e motivo, SENZA quantità", async () => {
      const tenantId = 'tenant-3'
      const fir = creaFIRLegato(tenantId)
      const dipendenze = creaDipendenze(fir)
      const useCase = creaUseCase(dipendenze)

      await useCase.execute({
        firId: fir.id,
        tenantId,
        tipoAccettazione: 'R',
        causaleRespingimento: 'IR',
        motivoRespingimento: 'Il carico è irricevibile.',
      })

      expect(dipendenze.rentriApiClient.inviaAccettazione).toHaveBeenCalledWith(
        tenantId,
        'BCDFG000001BC',
        expect.objectContaining({
          tipoAccettazione: 'R',
          causaleRespingimento: 'IR',
          motivoRespingimento: 'Il carico è irricevibile.',
          quantitaAccettataKg: undefined,
        })
      )
    })
  })

  it('usa dataOraArrivo di default (ISO 8601 corrente) se non indicato', async () => {
    const tenantId = 'tenant-data-default'
    const fir = creaFIRLegato(tenantId)
    const dipendenze = creaDipendenze(fir)
    const useCase = creaUseCase(dipendenze)

    await useCase.execute({
      firId: fir.id,
      tenantId,
      tipoAccettazione: 'A',
      quantitaAccettataKg: 10,
    })

    const argomento = dipendenze.rentriApiClient.inviaAccettazione.mock.calls[0][2]
    expect(typeof argomento.dataOraArrivo).toBe('string')
    expect(() => new Date(argomento.dataOraArrivo).toISOString()).not.toThrow()
  })

  it('rifiuta con NOT_FOUND se il FIR non esiste', async () => {
    const dipendenze = creaDipendenze(creaFIRLegato('tenant-x'))
    dipendenze.firRepository.findById.mockResolvedValue(null)
    const useCase = creaUseCase(dipendenze)

    await expect(
      useCase.execute({
        firId: 'fir-inesistente',
        tenantId: 'tenant-x',
        tipoAccettazione: 'A',
        quantitaAccettataKg: 1,
      })
    ).rejects.toMatchObject({ code: 'NOT_FOUND' })
    expect(dipendenze.getAzioniDisponibiliUseCase.execute).not.toHaveBeenCalled()
    expect(dipendenze.rentriApiClient.inviaAccettazione).not.toHaveBeenCalled()
  })

  it('rifiuta con UNAUTHORIZED se il FIR appartiene a un altro tenant', async () => {
    const fir = creaFIRLegato('tenant-proprietario')
    const dipendenze = creaDipendenze(fir)
    const useCase = creaUseCase(dipendenze)

    await expect(
      useCase.execute({
        firId: fir.id,
        tenantId: 'tenant-intruso',
        tipoAccettazione: 'A',
        quantitaAccettataKg: 1,
      })
    ).rejects.toMatchObject({ code: 'UNAUTHORIZED' })
    expect(dipendenze.getAzioniDisponibiliUseCase.execute).not.toHaveBeenCalled()
    expect(dipendenze.rentriApiClient.inviaAccettazione).not.toHaveBeenCalled()
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
    const dipendenze = creaDipendenze(fir)
    const useCase = creaUseCase(dipendenze)

    await expect(
      useCase.execute({ firId: fir.id, tenantId, tipoAccettazione: 'A', quantitaAccettataKg: 10 })
    ).rejects.toMatchObject({ code: 'BUSINESS_RULE_VIOLATION' })
    expect(dipendenze.getAzioniDisponibiliUseCase.execute).not.toHaveBeenCalled()
    expect(dipendenze.rentriApiClient.inviaAccettazione).not.toHaveBeenCalled()
  })

  describe('validazione locale dei campi condizionali (PRIMA di /azioni e dell’ente)', () => {
    it("quantità mancante per 'A' → QUANTITA_ACCETTATA_MANCANTE, nessuna chiamata a /azioni né all'ente", async () => {
      const tenantId = 'tenant-quantita-a'
      const fir = creaFIRLegato(tenantId)
      const dipendenze = creaDipendenze(fir)
      const useCase = creaUseCase(dipendenze)

      await expect(
        useCase.execute({ firId: fir.id, tenantId, tipoAccettazione: 'A' })
      ).rejects.toMatchObject({
        code: 'BUSINESS_RULE_VIOLATION',
        message: expect.stringContaining('QUANTITA_ACCETTATA_MANCANTE'),
      })
      expect(dipendenze.getAzioniDisponibiliUseCase.execute).not.toHaveBeenCalled()
      expect(dipendenze.rentriApiClient.inviaAccettazione).not.toHaveBeenCalled()
    })

    it("quantità mancante per 'P' → QUANTITA_ACCETTATA_MANCANTE", async () => {
      const tenantId = 'tenant-quantita-p'
      const fir = creaFIRLegato(tenantId)
      const dipendenze = creaDipendenze(fir)
      const useCase = creaUseCase(dipendenze)

      await expect(
        useCase.execute({
          firId: fir.id,
          tenantId,
          tipoAccettazione: 'P',
          causaleRespingimento: 'NC',
          motivoRespingimento: 'motivo',
        })
      ).rejects.toMatchObject({
        code: 'BUSINESS_RULE_VIOLATION',
        message: expect.stringContaining('QUANTITA_ACCETTATA_MANCANTE'),
      })
      expect(dipendenze.rentriApiClient.inviaAccettazione).not.toHaveBeenCalled()
    })

    it("motivazione mancante per 'P' → MOTIVAZIONE_RESPINGIMENTO_MANCANTE, nessuna chiamata a /azioni né all'ente", async () => {
      const tenantId = 'tenant-motivo-p'
      const fir = creaFIRLegato(tenantId)
      const dipendenze = creaDipendenze(fir)
      const useCase = creaUseCase(dipendenze)

      await expect(
        useCase.execute({
          firId: fir.id,
          tenantId,
          tipoAccettazione: 'P',
          quantitaAccettataKg: 50,
          causaleRespingimento: 'NC',
          // motivoRespingimento assente
        })
      ).rejects.toMatchObject({
        code: 'BUSINESS_RULE_VIOLATION',
        message: expect.stringContaining('MOTIVAZIONE_RESPINGIMENTO_MANCANTE'),
      })
      expect(dipendenze.getAzioniDisponibiliUseCase.execute).not.toHaveBeenCalled()
      expect(dipendenze.rentriApiClient.inviaAccettazione).not.toHaveBeenCalled()
    })

    it("causale mancante per 'R' → MOTIVAZIONE_RESPINGIMENTO_MANCANTE, nessuna chiamata a /azioni né all'ente", async () => {
      const tenantId = 'tenant-causale-r'
      const fir = creaFIRLegato(tenantId)
      const dipendenze = creaDipendenze(fir)
      const useCase = creaUseCase(dipendenze)

      await expect(
        useCase.execute({
          firId: fir.id,
          tenantId,
          tipoAccettazione: 'R',
          motivoRespingimento: 'motivo presente ma senza causale',
        })
      ).rejects.toMatchObject({
        code: 'BUSINESS_RULE_VIOLATION',
        message: expect.stringContaining('MOTIVAZIONE_RESPINGIMENTO_MANCANTE'),
      })
      expect(dipendenze.getAzioniDisponibiliUseCase.execute).not.toHaveBeenCalled()
      expect(dipendenze.rentriApiClient.inviaAccettazione).not.toHaveBeenCalled()
    })

    it("motivazione vuota (stringa di soli spazi) per 'R' è trattata come mancante", async () => {
      const tenantId = 'tenant-motivo-vuoto'
      const fir = creaFIRLegato(tenantId)
      const dipendenze = creaDipendenze(fir)
      const useCase = creaUseCase(dipendenze)

      await expect(
        useCase.execute({
          firId: fir.id,
          tenantId,
          tipoAccettazione: 'R',
          causaleRespingimento: 'A',
          motivoRespingimento: '   ',
        })
      ).rejects.toMatchObject({ code: 'BUSINESS_RULE_VIOLATION' })
      expect(dipendenze.rentriApiClient.inviaAccettazione).not.toHaveBeenCalled()
    })
  })

  it('precondizione da /azioni fallita (Accettazione non disponibile) → nessuna chiamata a inviaAccettazione', async () => {
    const tenantId = 'tenant-azioni-fallite'
    const fir = creaFIRLegato(tenantId)
    const dipendenze = creaDipendenze(fir, {
      azioni: [{ operazione: 'Annulla', verbo: 'Annulla il formulario' }],
    })
    const useCase = creaUseCase(dipendenze)

    await expect(
      useCase.execute({ firId: fir.id, tenantId, tipoAccettazione: 'A', quantitaAccettataKg: 10 })
    ).rejects.toMatchObject({ code: 'BUSINESS_RULE_VIOLATION' })

    expect(dipendenze.getAzioniDisponibiliUseCase.execute).toHaveBeenCalledWith(
      fir.id,
      tenantId,
      undefined
    )
    expect(dipendenze.rentriApiClient.inviaAccettazione).not.toHaveBeenCalled()
    expect(dipendenze.completaOperazioneConFirmaUseCase.execute).not.toHaveBeenCalled()
  })

  it('esito.errore da inviaAccettazione → errore di dominio leggibile, nessuna chiamata a CompletaOperazioneConFirmaUseCase', async () => {
    const tenantId = 'tenant-rifiuto-ente'
    const fir = creaFIRLegato(tenantId)
    const dipendenze = creaDipendenze(fir, {
      esitoAccettazione: {
        errore: true,
        validazione: [{ tipo: 'Errore', codice_messaggio: 'FIR-1' }],
      },
    })
    const useCase = creaUseCase(dipendenze)

    await expect(
      useCase.execute({ firId: fir.id, tenantId, tipoAccettazione: 'A', quantitaAccettataKg: 10 })
    ).rejects.toMatchObject({ code: 'BUSINESS_RULE_VIOLATION' })

    expect(dipendenze.completaOperazioneConFirmaUseCase.execute).not.toHaveBeenCalled()
  })

  describe('collegamento con CompletaOperazioneConFirmaUseCase', () => {
    it('chiama con tipoOperazione ACCETTAZIONE e propaga l’esito COMPLETATA senza alterazioni', async () => {
      const tenantId = 'tenant-firma-completata'
      const fir = creaFIRLegato(tenantId)
      const dipendenze = creaDipendenze(fir, {
        esitoFirma: { esito: 'COMPLETATA', statoFormulario: 'Accettato' },
      })
      const useCase = creaUseCase(dipendenze)

      const risultato = await useCase.execute({
        firId: fir.id,
        tenantId,
        tipoAccettazione: 'A',
        quantitaAccettataKg: 10,
        correlationId: 'corr-1',
      })

      expect(dipendenze.completaOperazioneConFirmaUseCase.execute).toHaveBeenCalledWith({
        firId: fir.id,
        tenantId,
        tipoOperazione: 'ACCETTAZIONE',
        correlationId: 'corr-1',
      })
      expect(risultato).toEqual({
        tipoAccettazione: 'A',
        esitoFirma: { esito: 'COMPLETATA', statoFormulario: 'Accettato' },
      })
    })

    it('propaga l’esito IN_ATTESA senza alterazioni', async () => {
      const tenantId = 'tenant-firma-in-attesa'
      const fir = creaFIRLegato(tenantId)
      const esitoFirma = {
        esito: 'IN_ATTESA',
        handle: 'handle-1',
        scadenzaAutorizzazione: new Date('2026-01-01T00:00:00.000Z'),
      }
      const dipendenze = creaDipendenze(fir, { esitoFirma })
      const useCase = creaUseCase(dipendenze)

      const risultato = await useCase.execute({
        firId: fir.id,
        tenantId,
        tipoAccettazione: 'R',
        causaleRespingimento: 'A',
        motivoRespingimento: 'motivo',
      })

      expect(risultato.esitoFirma).toBe(esitoFirma)
    })
  })
})
