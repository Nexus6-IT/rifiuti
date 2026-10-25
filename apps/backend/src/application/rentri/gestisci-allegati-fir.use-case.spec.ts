import { GestisciAllegatiFIRUseCase } from './gestisci-allegati-fir.use-case'
import { RENTRIApiClient } from '../../infrastructure/rentri/rentri-api.client'
import { FIR } from '../../domain/fir/aggregates/fir.aggregate'

/**
 * Unitario di `GestisciAllegatiFIRUseCase` (R3 Task 6): tutte le dipendenze
 * mockate, nessuna rete/DB reali (v. `rentri-allegati.oracolo.spec.ts` per il
 * ciclo completo contro la fake in-process).
 *
 * Il punto di correttezza #1 del piano: un allegato oltre 1 MB NON deve mai
 * generare una chiamata verso l'ente — RENTRI conta le richieste non valide
 * contro il chiamante fino al "ban" (423). I test verificano l'ASSENZA della
 * chiamata (`.not.toHaveBeenCalled()`), non solo che l'operazione fallisca.
 */
describe('GestisciAllegatiFIRUseCase', () => {
  const CF_TENANT = 'RSSMRA80A01H501U'

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
      esitoCarica?: { errore: boolean; validazione: unknown[]; esito?: unknown }
      esitoElimina?: { errore: boolean; validazione: unknown[] }
      righeEsistenti?: any[]
      codiceFiscaleTenant?: string | null
    }
  ) {
    const firRepository = {
      findById: jest.fn().mockResolvedValue(fir),
      save: jest.fn().mockResolvedValue(undefined),
    }

    const getAzioniDisponibiliUseCase = {
      execute: jest.fn().mockResolvedValue({
        stato: 'InserimentoQuantita',
        versione: 1,
        azioni: opzioni?.azioni ?? [{ operazione: 'Allegato', verbo: 'Aggiungi un allegato' }],
      }),
    }

    const rentriApiClient = {
      caricaAllegato: jest.fn().mockResolvedValue(
        opzioni?.esitoCarica ?? {
          errore: false,
          validazione: [],
          esito: { allegato_id: 42 },
        }
      ),
      eliminaAllegato: jest
        .fn()
        .mockResolvedValue(opzioni?.esitoElimina ?? { errore: false, validazione: [] }),
    }

    const rigaCreata = {
      id: 'allegato-locale-1',
      firId: fir.id,
      rentriAllegatoId: 42,
      filename: 'analisi.pdf',
      mimeType: 'application/pdf',
      sizeBytes: 100,
      caricatoDa: 'utente-1',
      caricatoAlle: new Date('2026-07-27T10:00:00Z'),
    }

    const righe = opzioni?.righeEsistenti ?? [rigaCreata]
    const codiceFiscaleTenant =
      opzioni?.codiceFiscaleTenant === undefined ? CF_TENANT : opzioni.codiceFiscaleTenant

    const prisma = {
      tenant: {
        findUnique: jest
          .fn()
          .mockResolvedValue(
            codiceFiscaleTenant === null
              ? { codiceFiscale: null }
              : { codiceFiscale: codiceFiscaleTenant }
          ),
      },
      fIRAllegatoRentri: {
        create: jest.fn().mockResolvedValue(rigaCreata),
        findMany: jest.fn().mockResolvedValue(righe),
        findFirst: jest
          .fn()
          .mockImplementation(({ where }: any) =>
            Promise.resolve(righe.find(r => r.id === where.id && r.firId === where.firId) ?? null)
          ),
        delete: jest.fn().mockResolvedValue(righe[0]),
      },
    }

    return { firRepository, prisma, getAzioniDisponibiliUseCase, rentriApiClient, rigaCreata }
  }

  const BASE64_100_BYTE = Buffer.alloc(100, 'A').toString('base64')

  describe('caricaAllegato', () => {
    it('carica con successo: chiama /azioni, POST /allegato (con identificativo_soggetto dal CF del tenant) e registra la riga locale SOLO dopo la conferma', async () => {
      const fir = creaFIRLegato('tenant-1')
      const { firRepository, prisma, getAzioniDisponibiliUseCase, rentriApiClient } =
        creaDipendenze(fir)

      const useCase = new GestisciAllegatiFIRUseCase(
        firRepository as any,
        prisma as any,
        getAzioniDisponibiliUseCase as any,
        rentriApiClient as any,
        creaLogger()
      )

      const risultato = await useCase.caricaAllegato({
        firId: fir.id,
        tenantId: 'tenant-1',
        userId: 'utente-1',
        nomeFile: 'analisi.pdf',
        contentType: 'application/pdf',
        contenutoBase64: BASE64_100_BYTE,
      })

      expect(getAzioniDisponibiliUseCase.execute).toHaveBeenCalledWith(
        fir.id,
        'tenant-1',
        undefined
      )
      expect(prisma.tenant.findUnique).toHaveBeenCalledWith({
        where: { id: 'tenant-1' },
        select: { codiceFiscale: true },
      })
      expect(rentriApiClient.caricaAllegato).toHaveBeenCalledWith('tenant-1', fir.rentriNumeroFir, {
        contentType: 'application/pdf',
        nomeFile: 'analisi.pdf',
        contenutoBase64: BASE64_100_BYTE,
        identificativoSoggetto: CF_TENANT,
      })
      expect(prisma.fIRAllegatoRentri.create).toHaveBeenCalledWith({
        data: {
          firId: fir.id,
          tenantId: 'tenant-1',
          rentriAllegatoId: 42,
          filename: 'analisi.pdf',
          mimeType: 'application/pdf',
          sizeBytes: 100,
          caricatoDa: 'utente-1',
        },
      })
      expect(risultato.rentriAllegatoId).toBe(42)
    })

    it("un allegato oltre 1 MB NON genera ALCUNA chiamata verso l'ente (né /azioni né /allegato)", async () => {
      const fir = creaFIRLegato('tenant-1')
      const { firRepository, prisma, getAzioniDisponibiliUseCase, rentriApiClient } =
        creaDipendenze(fir)

      const useCase = new GestisciAllegatiFIRUseCase(
        firRepository as any,
        prisma as any,
        getAzioniDisponibiliUseCase as any,
        rentriApiClient as any,
        creaLogger()
      )

      const contenutoTroppoGrande = Buffer.alloc(RENTRIApiClient.LIMITE_ALLEGATO_BYTES + 1, 'A')

      await expect(
        useCase.caricaAllegato({
          firId: fir.id,
          tenantId: 'tenant-1',
          userId: 'utente-1',
          nomeFile: 'troppo-grande.pdf',
          contentType: 'application/pdf',
          contenutoBase64: contenutoTroppoGrande.toString('base64'),
        })
      ).rejects.toThrow(/ALLEGATO_TROPPO_GRANDE|supera 1 MB/)

      // L'ASSENZA della chiamata, non solo l'errore: RENTRI conta le
      // richieste non valide contro il chiamante fino al "ban" (423).
      expect(getAzioniDisponibiliUseCase.execute).not.toHaveBeenCalled()
      expect(prisma.tenant.findUnique).not.toHaveBeenCalled()
      expect(rentriApiClient.caricaAllegato).not.toHaveBeenCalled()
      expect(prisma.fIRAllegatoRentri.create).not.toHaveBeenCalled()
    })

    it("un formato diverso da application/pdf NON genera alcuna chiamata verso l'ente", async () => {
      const fir = creaFIRLegato('tenant-1')
      const { firRepository, prisma, getAzioniDisponibiliUseCase, rentriApiClient } =
        creaDipendenze(fir)

      const useCase = new GestisciAllegatiFIRUseCase(
        firRepository as any,
        prisma as any,
        getAzioniDisponibiliUseCase as any,
        rentriApiClient as any,
        creaLogger()
      )

      await expect(
        useCase.caricaAllegato({
          firId: fir.id,
          tenantId: 'tenant-1',
          userId: 'utente-1',
          nomeFile: 'foto.png',
          contentType: 'image/png',
          contenutoBase64: BASE64_100_BYTE,
        })
      ).rejects.toThrow(/FORMATO_ALLEGATO_NON_AMMESSO|non è ammesso/)

      expect(getAzioniDisponibiliUseCase.execute).not.toHaveBeenCalled()
      expect(rentriApiClient.caricaAllegato).not.toHaveBeenCalled()
      expect(prisma.fIRAllegatoRentri.create).not.toHaveBeenCalled()
    })

    it("rifiuta se 'Allegato' non compare in /azioni, senza chiamare caricaAllegato", async () => {
      const fir = creaFIRLegato('tenant-1')
      const { firRepository, prisma, getAzioniDisponibiliUseCase, rentriApiClient } =
        creaDipendenze(fir, { azioni: [{ operazione: 'Annulla', verbo: 'Annulla il formulario' }] })

      const useCase = new GestisciAllegatiFIRUseCase(
        firRepository as any,
        prisma as any,
        getAzioniDisponibiliUseCase as any,
        rentriApiClient as any,
        creaLogger()
      )

      await expect(
        useCase.caricaAllegato({
          firId: fir.id,
          tenantId: 'tenant-1',
          userId: 'utente-1',
          nomeFile: 'analisi.pdf',
          contentType: 'application/pdf',
          contenutoBase64: BASE64_100_BYTE,
        })
      ).rejects.toThrow(/ALLEGATO_NON_DISPONIBILE/)

      expect(rentriApiClient.caricaAllegato).not.toHaveBeenCalled()
      expect(prisma.fIRAllegatoRentri.create).not.toHaveBeenCalled()
    })

    it('rifiuta se il codice fiscale del tenant non è configurato, senza chiamare caricaAllegato', async () => {
      const fir = creaFIRLegato('tenant-1')
      const { firRepository, prisma, getAzioniDisponibiliUseCase, rentriApiClient } =
        creaDipendenze(fir, { codiceFiscaleTenant: null })

      const useCase = new GestisciAllegatiFIRUseCase(
        firRepository as any,
        prisma as any,
        getAzioniDisponibiliUseCase as any,
        rentriApiClient as any,
        creaLogger()
      )

      await expect(
        useCase.caricaAllegato({
          firId: fir.id,
          tenantId: 'tenant-1',
          userId: 'utente-1',
          nomeFile: 'analisi.pdf',
          contentType: 'application/pdf',
          contenutoBase64: BASE64_100_BYTE,
        })
      ).rejects.toThrow(/CF_TENANT_MANCANTE/)

      expect(rentriApiClient.caricaAllegato).not.toHaveBeenCalled()
      expect(prisma.fIRAllegatoRentri.create).not.toHaveBeenCalled()
    })

    it("se l'ente rifiuta (esito.errore), nessuna riga locale viene creata", async () => {
      const fir = creaFIRLegato('tenant-1')
      const { firRepository, prisma, getAzioniDisponibiliUseCase, rentriApiClient } =
        creaDipendenze(fir, {
          esitoCarica: { errore: true, validazione: [{ messaggio: 'nome_file non valido' }] },
        })

      const useCase = new GestisciAllegatiFIRUseCase(
        firRepository as any,
        prisma as any,
        getAzioniDisponibiliUseCase as any,
        rentriApiClient as any,
        creaLogger()
      )

      await expect(
        useCase.caricaAllegato({
          firId: fir.id,
          tenantId: 'tenant-1',
          userId: 'utente-1',
          nomeFile: 'analisi.pdf',
          contentType: 'application/pdf',
          contenutoBase64: BASE64_100_BYTE,
        })
      ).rejects.toThrow(/ALLEGATO_RENTRI_RIFIUTATO/)

      expect(prisma.fIRAllegatoRentri.create).not.toHaveBeenCalled()
    })

    it("se l'ente conferma ma non restituisce allegato_id, nessuna riga locale viene creata", async () => {
      const fir = creaFIRLegato('tenant-1')
      const { firRepository, prisma, getAzioniDisponibiliUseCase, rentriApiClient } =
        creaDipendenze(fir, {
          esitoCarica: { errore: false, validazione: [], esito: {} },
        })

      const useCase = new GestisciAllegatiFIRUseCase(
        firRepository as any,
        prisma as any,
        getAzioniDisponibiliUseCase as any,
        rentriApiClient as any,
        creaLogger()
      )

      await expect(
        useCase.caricaAllegato({
          firId: fir.id,
          tenantId: 'tenant-1',
          userId: 'utente-1',
          nomeFile: 'analisi.pdf',
          contentType: 'application/pdf',
          contenutoBase64: BASE64_100_BYTE,
        })
      ).rejects.toMatchObject({ code: 'ALLEGATO_ID_MANCANTE' })

      expect(prisma.fIRAllegatoRentri.create).not.toHaveBeenCalled()
    })
  })

  describe('eliminaAllegato', () => {
    it("elimina con successo: chiama DELETE sull'ente e SOLO dopo cancella la riga locale", async () => {
      const fir = creaFIRLegato('tenant-1')
      const { firRepository, prisma, getAzioniDisponibiliUseCase, rentriApiClient, rigaCreata } =
        creaDipendenze(fir)

      const useCase = new GestisciAllegatiFIRUseCase(
        firRepository as any,
        prisma as any,
        getAzioniDisponibiliUseCase as any,
        rentriApiClient as any,
        creaLogger()
      )

      await useCase.eliminaAllegato({
        firId: fir.id,
        tenantId: 'tenant-1',
        allegatoLocaleId: rigaCreata.id,
      })

      expect(rentriApiClient.eliminaAllegato).toHaveBeenCalledWith(
        'tenant-1',
        fir.rentriNumeroFir,
        42
      )
      expect(prisma.fIRAllegatoRentri.delete).toHaveBeenCalledWith({
        where: { id: rigaCreata.id },
      })
    })

    it("se l'ente rifiuta l'eliminazione, la riga locale NON viene toccata", async () => {
      const fir = creaFIRLegato('tenant-1')
      const { firRepository, prisma, getAzioniDisponibiliUseCase, rentriApiClient, rigaCreata } =
        creaDipendenze(fir, {
          esitoElimina: { errore: true, validazione: [{ messaggio: 'stato non ammesso' }] },
        })

      const useCase = new GestisciAllegatiFIRUseCase(
        firRepository as any,
        prisma as any,
        getAzioniDisponibiliUseCase as any,
        rentriApiClient as any,
        creaLogger()
      )

      await expect(
        useCase.eliminaAllegato({
          firId: fir.id,
          tenantId: 'tenant-1',
          allegatoLocaleId: rigaCreata.id,
        })
      ).rejects.toThrow(/ALLEGATO_RENTRI_ELIMINAZIONE_RIFIUTATA/)

      expect(prisma.fIRAllegatoRentri.delete).not.toHaveBeenCalled()
    })

    it('se la cancellazione locale fallisce dopo il successo sulla ente, il disallineamento viene dichiarato (non inghiottito)', async () => {
      const fir = creaFIRLegato('tenant-1')
      const { firRepository, prisma, getAzioniDisponibiliUseCase, rentriApiClient, rigaCreata } =
        creaDipendenze(fir)
      prisma.fIRAllegatoRentri.delete.mockRejectedValue(new Error('DB down'))

      const useCase = new GestisciAllegatiFIRUseCase(
        firRepository as any,
        prisma as any,
        getAzioniDisponibiliUseCase as any,
        rentriApiClient as any,
        creaLogger()
      )

      await expect(
        useCase.eliminaAllegato({
          firId: fir.id,
          tenantId: 'tenant-1',
          allegatoLocaleId: rigaCreata.id,
        })
      ).rejects.toMatchObject({ code: 'ALLEGATO_DISALLINEAMENTO_POST_ELIMINAZIONE' })

      // La chiamata all'ente è comunque avvenuta ed è andata a buon fine:
      // l'eccezione lo dichiara esplicitamente nel messaggio.
      expect(rentriApiClient.eliminaAllegato).toHaveBeenCalledTimes(1)
    })

    it('rifiuta se la riga locale non esiste per questo FIR', async () => {
      const fir = creaFIRLegato('tenant-1')
      const { firRepository, prisma, getAzioniDisponibiliUseCase, rentriApiClient } =
        creaDipendenze(fir, { righeEsistenti: [] })

      const useCase = new GestisciAllegatiFIRUseCase(
        firRepository as any,
        prisma as any,
        getAzioniDisponibiliUseCase as any,
        rentriApiClient as any,
        creaLogger()
      )

      await expect(
        useCase.eliminaAllegato({
          firId: fir.id,
          tenantId: 'tenant-1',
          allegatoLocaleId: 'inesistente',
        })
      ).rejects.toThrow(/not found/i)

      expect(rentriApiClient.eliminaAllegato).not.toHaveBeenCalled()
    })
  })

  describe('elencaAllegati', () => {
    it('legge solo dalla tabella locale, mai da RENTRI', async () => {
      const fir = creaFIRLegato('tenant-1')
      const { firRepository, prisma, getAzioniDisponibiliUseCase, rentriApiClient } =
        creaDipendenze(fir)

      const useCase = new GestisciAllegatiFIRUseCase(
        firRepository as any,
        prisma as any,
        getAzioniDisponibiliUseCase as any,
        rentriApiClient as any,
        creaLogger()
      )

      const risultato = await useCase.elencaAllegati(fir.id, 'tenant-1')

      expect(risultato).toHaveLength(1)
      expect(risultato[0].rentriAllegatoId).toBe(42)
      expect(getAzioniDisponibiliUseCase.execute).not.toHaveBeenCalled()
      expect(rentriApiClient.caricaAllegato).not.toHaveBeenCalled()
    })
  })
})
