import { AnnullaFIRRentriUseCase } from './annulla-fir-rentri.use-case'
import { FIR } from '../../domain/fir/aggregates/fir.aggregate'

/**
 * Unitario di `AnnullaFIRRentriUseCase` (R3 Task 5): tutte le dipendenze
 * mockate, nessuna rete/DB reali (v. `rentri-annullamento.oracolo.spec.ts`
 * per il ciclo completo contro la fake in-process).
 *
 * Il punto di correttezza #1 del piano: a differenza dell'accettazione (Task
 * 4, un'unica scrittura), qui ci sono DUE precondizioni da `/azioni` e DUE
 * scritture — il FIR deve essere RICARICATO fra la prima e la seconda (v.
 * commento di classe dello use case): un mock che restituisse SEMPRE la
 * stessa istanza da `findById` nasconderebbe un bug in cui la nota viene
 * scritta sull'istanza obsoleta.
 */
describe('AnnullaFIRRentriUseCase', () => {
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
      azioniIniziali?: { operazione: string; verbo: string }[]
      azioniPostAnnullamento?: { operazione: string; verbo: string }[]
      esitoAnnullaFir?: { errore: boolean; validazione: unknown[] }
      esitoFirma?: any
      esitoNote?: { errore: boolean; validazione: unknown[] }
      firRicaricato?: FIR
    }
  ) {
    const firRicaricato = opzioni?.firRicaricato ?? fir

    const firRepository = {
      findById: jest.fn().mockResolvedValueOnce(fir).mockResolvedValue(firRicaricato),
      save: jest.fn().mockResolvedValue(undefined),
    }

    const getAzioniDisponibiliUseCase = {
      execute: jest
        .fn()
        .mockResolvedValueOnce({
          stato: 'InserimentoQuantita',
          versione: 1,
          azioni: opzioni?.azioniIniziali ?? [
            { operazione: 'Annulla', verbo: 'Annulla il formulario' },
          ],
        })
        .mockResolvedValue({
          stato: 'Annullato',
          versione: 2,
          azioni: opzioni?.azioniPostAnnullamento ?? [
            { operazione: 'NoteAnnullamento', verbo: "Inserisci le note dell'annullamento" },
          ],
        }),
    }

    const rentriApiClient = {
      annullaFormulario: jest
        .fn()
        .mockResolvedValue(opzioni?.esitoAnnullaFir ?? { errore: false, validazione: [] }),
      inviaNoteAnnullamento: jest
        .fn()
        .mockResolvedValue(opzioni?.esitoNote ?? { errore: false, validazione: [] }),
    }

    const completaOperazioneConFirmaUseCase = {
      execute: jest
        .fn()
        .mockResolvedValue(
          opzioni?.esitoFirma ?? { esito: 'COMPLETATA', statoFormulario: 'Annullato' }
        ),
    }

    return {
      firRepository,
      getAzioniDisponibiliUseCase,
      rentriApiClient,
      completaOperazioneConFirmaUseCase,
    }
  }

  function creaUseCase(dipendenze: ReturnType<typeof creaDipendenze>): AnnullaFIRRentriUseCase {
    return new AnnullaFIRRentriUseCase(
      dipendenze.firRepository as any,
      dipendenze.getAzioniDisponibiliUseCase as any,
      dipendenze.rentriApiClient as any,
      dipendenze.completaOperazioneConFirmaUseCase as any,
      creaLogger()
    )
  }

  it('rifiuta con NOT_FOUND se il FIR non esiste', async () => {
    const dipendenze = creaDipendenze(creaFIRLegato('tenant-x'))
    dipendenze.firRepository.findById.mockReset()
    dipendenze.firRepository.findById.mockResolvedValue(null)
    const useCase = creaUseCase(dipendenze)

    await expect(
      useCase.execute({ firId: 'fir-inesistente', tenantId: 'tenant-x', motivo: 'motivo' })
    ).rejects.toMatchObject({ code: 'NOT_FOUND' })
    expect(dipendenze.getAzioniDisponibiliUseCase.execute).not.toHaveBeenCalled()
    expect(dipendenze.rentriApiClient.annullaFormulario).not.toHaveBeenCalled()
  })

  it('rifiuta con UNAUTHORIZED se il FIR appartiene a un altro tenant', async () => {
    const fir = creaFIRLegato('tenant-proprietario')
    const dipendenze = creaDipendenze(fir)
    const useCase = creaUseCase(dipendenze)

    await expect(
      useCase.execute({ firId: fir.id, tenantId: 'tenant-intruso', motivo: 'motivo' })
    ).rejects.toMatchObject({ code: 'UNAUTHORIZED' })
    expect(dipendenze.getAzioniDisponibiliUseCase.execute).not.toHaveBeenCalled()
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
      useCase.execute({ firId: fir.id, tenantId, motivo: 'motivo' })
    ).rejects.toMatchObject({ code: 'BUSINESS_RULE_VIOLATION' })
    expect(dipendenze.getAzioniDisponibiliUseCase.execute).not.toHaveBeenCalled()
  })

  describe('validazione locale del motivo (PRIMA di /azioni e dell’ente)', () => {
    it('motivo mancante → MOTIVO_ANNULLAMENTO_MANCANTE, nessuna chiamata a /azioni né all’ente', async () => {
      const tenantId = 'tenant-motivo-mancante'
      const fir = creaFIRLegato(tenantId)
      const dipendenze = creaDipendenze(fir)
      const useCase = creaUseCase(dipendenze)

      await expect(
        useCase.execute({ firId: fir.id, tenantId, motivo: '   ' })
      ).rejects.toMatchObject({
        code: 'BUSINESS_RULE_VIOLATION',
        message: expect.stringContaining('MOTIVO_ANNULLAMENTO_MANCANTE'),
      })
      expect(dipendenze.getAzioniDisponibiliUseCase.execute).not.toHaveBeenCalled()
      expect(dipendenze.rentriApiClient.annullaFormulario).not.toHaveBeenCalled()
    })

    it('motivo troppo lungo (>1024) → MOTIVO_ANNULLAMENTO_TROPPO_LUNGO, nessuna chiamata a /azioni né all’ente', async () => {
      const tenantId = 'tenant-motivo-lungo'
      const fir = creaFIRLegato(tenantId)
      const dipendenze = creaDipendenze(fir)
      const useCase = creaUseCase(dipendenze)

      await expect(
        useCase.execute({ firId: fir.id, tenantId, motivo: 'x'.repeat(1025) })
      ).rejects.toMatchObject({
        code: 'BUSINESS_RULE_VIOLATION',
        message: expect.stringContaining('MOTIVO_ANNULLAMENTO_TROPPO_LUNGO'),
      })
      expect(dipendenze.getAzioniDisponibiliUseCase.execute).not.toHaveBeenCalled()
      expect(dipendenze.rentriApiClient.annullaFormulario).not.toHaveBeenCalled()
    })
  })

  it('precondizione iniziale da /azioni fallita (Annulla non disponibile) → nessuna chiamata a annullaFormulario', async () => {
    const tenantId = 'tenant-azioni-fallite'
    const fir = creaFIRLegato(tenantId)
    const dipendenze = creaDipendenze(fir, {
      azioniIniziali: [{ operazione: 'Accettazione', verbo: 'Accetta o respingi il carico' }],
    })
    const useCase = creaUseCase(dipendenze)

    await expect(
      useCase.execute({ firId: fir.id, tenantId, motivo: 'motivo' })
    ).rejects.toMatchObject({ code: 'BUSINESS_RULE_VIOLATION' })

    expect(dipendenze.rentriApiClient.annullaFormulario).not.toHaveBeenCalled()
    expect(dipendenze.completaOperazioneConFirmaUseCase.execute).not.toHaveBeenCalled()
  })

  it('esito.errore da annullaFormulario → errore di dominio leggibile, nessuna chiamata a CompletaOperazioneConFirmaUseCase', async () => {
    const tenantId = 'tenant-rifiuto-ente'
    const fir = creaFIRLegato(tenantId)
    const dipendenze = creaDipendenze(fir, {
      esitoAnnullaFir: {
        errore: true,
        validazione: [{ tipo: 'Errore', codice_messaggio: 'FIR-998' }],
      },
    })
    const useCase = creaUseCase(dipendenze)

    await expect(
      useCase.execute({ firId: fir.id, tenantId, motivo: 'motivo' })
    ).rejects.toMatchObject({ code: 'BUSINESS_RULE_VIOLATION' })

    expect(dipendenze.completaOperazioneConFirmaUseCase.execute).not.toHaveBeenCalled()
    expect(dipendenze.rentriApiClient.inviaNoteAnnullamento).not.toHaveBeenCalled()
  })

  describe('esito di CompletaOperazioneConFirmaUseCase non COMPLETATA', () => {
    it('IN_ATTESA → propagato con noteInviate: false, nessuna chiamata a inviaNoteAnnullamento', async () => {
      const tenantId = 'tenant-in-attesa'
      const fir = creaFIRLegato(tenantId)
      const esitoFirma = {
        esito: 'IN_ATTESA',
        handle: 'handle-1',
        scadenzaAutorizzazione: new Date('2026-01-01T00:00:00.000Z'),
      }
      const dipendenze = creaDipendenze(fir, { esitoFirma })
      const useCase = creaUseCase(dipendenze)

      const risultato = await useCase.execute({ firId: fir.id, tenantId, motivo: 'motivo' })

      expect(risultato).toEqual({ esitoFirma, noteInviate: false })
      expect(dipendenze.rentriApiClient.inviaNoteAnnullamento).not.toHaveBeenCalled()
      // Nessuna seconda lettura di /azioni: solo la precondizione iniziale.
      expect(dipendenze.getAzioniDisponibiliUseCase.execute).toHaveBeenCalledTimes(1)
    })

    it('SCADUTA → propagato con noteInviate: false', async () => {
      const tenantId = 'tenant-scaduta'
      const fir = creaFIRLegato(tenantId)
      const esitoFirma = { esito: 'SCADUTA', handle: 'handle-2', rilevataDa: 'ente' }
      const dipendenze = creaDipendenze(fir, { esitoFirma })
      const useCase = creaUseCase(dipendenze)

      const risultato = await useCase.execute({ firId: fir.id, tenantId, motivo: 'motivo' })

      expect(risultato).toEqual({ esitoFirma, noteInviate: false })
      expect(dipendenze.rentriApiClient.inviaNoteAnnullamento).not.toHaveBeenCalled()
    })

    it('RIFIUTATA → propagato con noteInviate: false', async () => {
      const tenantId = 'tenant-rifiutata'
      const fir = creaFIRLegato(tenantId)
      const esitoFirma = { esito: 'RIFIUTATA', handle: 'handle-3' }
      const dipendenze = creaDipendenze(fir, { esitoFirma })
      const useCase = creaUseCase(dipendenze)

      const risultato = await useCase.execute({ firId: fir.id, tenantId, motivo: 'motivo' })

      expect(risultato).toEqual({ esitoFirma, noteInviate: false })
      expect(dipendenze.rentriApiClient.inviaNoteAnnullamento).not.toHaveBeenCalled()
    })
  })

  it('COMPLETATA ma statoFormulario diverso da Annullato → lancia, nessuna chiamata a /azioni (seconda) né a inviaNoteAnnullamento', async () => {
    const tenantId = 'tenant-stato-inatteso'
    const fir = creaFIRLegato(tenantId)
    const dipendenze = creaDipendenze(fir, {
      esitoFirma: { esito: 'COMPLETATA', statoFormulario: 'Accettato' },
    })
    const useCase = creaUseCase(dipendenze)

    await expect(
      useCase.execute({ firId: fir.id, tenantId, motivo: 'motivo' })
    ).rejects.toMatchObject({
      code: 'BUSINESS_RULE_VIOLATION',
      message: expect.stringContaining('ANNULLAMENTO_STATO_INATTESO'),
    })

    expect(dipendenze.getAzioniDisponibiliUseCase.execute).toHaveBeenCalledTimes(1)
    expect(dipendenze.rentriApiClient.inviaNoteAnnullamento).not.toHaveBeenCalled()
  })

  it('precondizione da /azioni (seconda, post-firma) fallita → nessuna chiamata a inviaNoteAnnullamento', async () => {
    const tenantId = 'tenant-note-non-disponibili'
    const fir = creaFIRLegato(tenantId)
    const dipendenze = creaDipendenze(fir, {
      azioniPostAnnullamento: [],
    })
    const useCase = creaUseCase(dipendenze)

    await expect(
      useCase.execute({ firId: fir.id, tenantId, motivo: 'motivo' })
    ).rejects.toMatchObject({
      code: 'BUSINESS_RULE_VIOLATION',
      message: expect.stringContaining('NOTE_ANNULLAMENTO_NON_DISPONIBILI'),
    })

    expect(dipendenze.rentriApiClient.inviaNoteAnnullamento).not.toHaveBeenCalled()
  })

  it('esito.errore da inviaNoteAnnullamento → lancia, nessuna chiamata a save con la nota', async () => {
    const tenantId = 'tenant-note-rifiutate'
    const fir = creaFIRLegato(tenantId)
    const dipendenze = creaDipendenze(fir, {
      esitoNote: { errore: true, validazione: [{ tipo: 'Errore', codice_messaggio: 'FIR-997' }] },
    })
    const spyRegistra = jest.spyOn(fir, 'registraNoteAnnullamentoRentri')
    const useCase = creaUseCase(dipendenze)

    await expect(
      useCase.execute({ firId: fir.id, tenantId, motivo: 'motivo' })
    ).rejects.toMatchObject({
      code: 'BUSINESS_RULE_VIOLATION',
      message: expect.stringContaining('NOTE_ANNULLAMENTO_RENTRI_RIFIUTATE'),
    })

    expect(spyRegistra).not.toHaveBeenCalled()
    expect(dipendenze.firRepository.save).not.toHaveBeenCalled()
  })

  it('percorso completo: inviaNoteAnnullamento chiamato con il motivo esatto, registraNoteAnnullamentoRentri chiamato sul FIR RICARICATO, risultato con noteInviate: true', async () => {
    const tenantId = 'tenant-percorso-completo'
    const fir = creaFIRLegato(tenantId)
    // Istanza DIVERSA restituita dalla seconda findById: verifica che la
    // nota sia registrata su questa, non sull'istanza del punto 1. Riflette
    // lo stato REALE dopo la firma remota (ANNULLATO), come lo restituirebbe
    // il repository dopo che CompletaOperazioneConFirmaUseCase l'ha salvato.
    const firRicaricato = creaFIRLegato(tenantId, fir.rentriNumeroFir!)
    firRicaricato.applyRentriStato('Annullato')
    const dipendenze = creaDipendenze(fir, { firRicaricato })
    const spyRegistraOriginale = jest.spyOn(fir, 'registraNoteAnnullamentoRentri')
    const spyRegistraRicaricato = jest.spyOn(firRicaricato, 'registraNoteAnnullamentoRentri')
    const useCase = creaUseCase(dipendenze)

    const motivo = 'errore di pesatura alla partenza, testo esatto'

    const risultato = await useCase.execute({ firId: fir.id, tenantId, motivo })

    expect(dipendenze.rentriApiClient.inviaNoteAnnullamento).toHaveBeenCalledWith(
      tenantId,
      fir.rentriNumeroFir,
      motivo
    )
    expect(spyRegistraOriginale).not.toHaveBeenCalled()
    expect(spyRegistraRicaricato).toHaveBeenCalledWith(motivo)
    expect(dipendenze.firRepository.save).toHaveBeenCalledWith(firRicaricato)
    expect(risultato).toEqual({
      esitoFirma: { esito: 'COMPLETATA', statoFormulario: 'Annullato' },
      noteInviate: true,
    })
  })
})
