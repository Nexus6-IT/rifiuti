import { FIR, TipoTratta } from '../../domain/fir/aggregates/fir.aggregate'
import {
  RentriApiError,
  RispostaRentriInattesaError,
} from '../../infrastructure/rentri/rentri-http-resilienza'
import { DatiViaggioFirInMemoria } from './dati-viaggio-fir.in-memoria'
import { EventiFirRentriInMemoria } from './eventi-fir-rentri.in-memoria'
import { InviaDatiViaggioFirRentriUseCase } from './invia-dati-viaggio-fir-rentri.use-case'

/**
 * FIR in viaggio P2, T3 — quantita' e dati di trasporto: precondizioni locali, guardia `/azioni`, esito
 * dell'ente, copia locale aggiornata SOLO dopo l'esito positivo, un evento per ogni invio.
 */
describe('InviaDatiViaggioFirRentriUseCase', () => {
  const TENANT = 'tenant-via-1'
  const FIR_ID = 'fir-via-1'
  const NUMERO_FIR = 'BCDFGH00040ZH'

  function creaFir(opzioni: { tratta?: TipoTratta; legato?: boolean } = {}): FIR {
    const fir = FIR.create({
      produttoreId: 'p',
      trasportatoreId: 't',
      destinatarioId: 'd',
      tenantId: TENANT,
      rifiuto: { cerCode: '150101', quantita: 10 },
      tipoTrattaPrincipale: opzioni.tratta ?? TipoTratta.TERRESTRE,
    })
    Object.assign(fir, { _id: FIR_ID })
    fir.emetti('FIR-VIA-000001', { firmatario: 'X', timestamp: new Date(), certificato: 'c' })
    if (opzioni.legato !== false) fir.markRENTRISynced(NUMERO_FIR)
    return fir
  }

  function ambiente(
    opzioni: {
      azioni?: string[]
      fir?: FIR
      esito?: Record<string, unknown>
      statoDopo?: string
    } = {}
  ) {
    const fir = opzioni.fir ?? creaFir()
    const dati = new DatiViaggioFirInMemoria()
    const eventi = new EventiFirRentriInMemoria()
    const sequenza: string[] = []
    const firRepository = {
      findById: jest.fn().mockResolvedValue(fir),
      save: jest.fn().mockImplementation(async () => {
        sequenza.push('save')
      }),
    }
    const getAzioni = {
      execute: jest.fn().mockResolvedValue({
        azioni: (opzioni.azioni ?? ['DatiQuantita', 'Trasporto']).map(operazione => ({
          operazione,
        })),
      }),
    }
    const esitoOk = { errore: false, validazione: [], transazioneId: 'tr-1' }
    const client = {
      inviaQuantita: jest.fn().mockResolvedValue(opzioni.esito ?? esitoOk),
      inviaTrasporto: jest.fn().mockResolvedValue(opzioni.esito ?? esitoOk),
      leggiStato: jest.fn().mockResolvedValue({
        versione: 2,
        stato_formulario: opzioni.statoDopo ?? 'FirmaProduttoreTrasportatoreIniziale',
      }),
    }
    const apply = jest.spyOn(fir, 'applyRentriStato')
    dati.righe.set(FIR_ID, {
      firId: FIR_ID,
      quantita: 10,
      unitaMisura: 'kg',
      numeroColli: null,
      verificatoInPartenza: null,
      rinfusa: null,
      dataTrasporto: new Date('2026-11-21T07:00:00Z'),
      targaAutomezzo: '',
      principale: {
        conducenteNome: null,
        conducenteCognome: null,
        targaRimorchio: null,
        percorso: null,
      },
      tratteAggiuntive: [],
    })
    const originale = dati.aggiornaQuantitaDopoEnte.bind(dati)
    dati.aggiornaQuantitaDopoEnte = async (...a) => {
      sequenza.push('aggiornaQuantitaDopoEnte')
      return originale(...a)
    }
    const originaleT = dati.aggiornaTrasportoDopoEnte.bind(dati)
    dati.aggiornaTrasportoDopoEnte = async (...a) => {
      sequenza.push('aggiornaTrasportoDopoEnte')
      return originaleT(...a)
    }
    const logger: any = {
      setContext: jest.fn(),
      info: jest.fn(),
      debug: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    }
    const useCase = new InviaDatiViaggioFirRentriUseCase(
      firRepository as any,
      getAzioni as any,
      client as any,
      dati,
      eventi,
      logger
    )
    return { useCase, fir, dati, eventi, firRepository, getAzioni, client, apply, sequenza }
  }

  const quantita = (extra: Record<string, unknown> = {}) => ({
    firId: FIR_ID,
    tenantId: TENANT,
    quantita: 1.5,
    unitaMisura: 't',
    numeroColli: 3,
    utenteId: 'u1',
    ...extra,
  })

  const trasporto = (extra: Record<string, unknown> = {}) => ({
    firId: FIR_ID,
    tenantId: TENANT,
    conducenteNome: 'Mario',
    conducenteCognome: 'Rossi',
    targaAutomezzo: 'ab123cd',
    utenteId: 'u1',
    ...extra,
  })

  describe('inviaQuantita', () => {
    it("invia la quantita' convertita, rilegge lo stato, aggiorna la copia locale DOPO il save e registra l'evento", async () => {
      const { useCase, client, apply, firRepository, dati, eventi, sequenza } = ambiente()

      const r = await useCase.inviaQuantita(quantita({ verificatoInPartenza: true }))

      expect(client.inviaQuantita).toHaveBeenCalledWith(TENANT, NUMERO_FIR, {
        quantita: { valore: 1500, unita_misura: 'kg' },
        numero_colli: '3',
        verificato_in_partenza: true,
      })
      expect(apply).toHaveBeenCalledWith('FirmaProduttoreTrasportatoreIniziale', undefined)
      expect(firRepository.save).toHaveBeenCalledTimes(1)
      // La copia locale si scrive dopo il save dell'aggregate: altrimenti il save (con la quantita' vecchia)
      // la riscriverebbe.
      expect(sequenza).toEqual(['save', 'aggiornaQuantitaDopoEnte'])
      expect(dati.righe.get(FIR_ID)).toMatchObject({
        quantita: 1.5,
        unitaMisura: 't',
        numeroColli: 3,
        rinfusa: false,
        verificatoInPartenza: true,
      })
      expect(r).toMatchObject({
        operazione: 'DatiQuantita',
        statoFormulario: 'FirmaProduttoreTrasportatoreIniziale',
      })
      expect(eventi.righe).toHaveLength(1)
      expect(eventi.righe[0]).toMatchObject({
        tenantId: TENANT,
        firId: FIR_ID,
        operazione: 'DatiQuantita',
        esito: 'ACCETTATA',
        transazioneId: 'tr-1',
        statoFormularioDopo: 'FirmaProduttoreTrasportatoreIniziale',
        utenteId: 'u1',
      })
      expect(eventi.righe[0].payload).toMatchObject({ numero_colli: '3' })
    })

    it("con DatiQuantitaUpdate (correzione) l'evento porta quel nome", async () => {
      const { useCase, eventi } = ambiente({ azioni: ['DatiQuantitaUpdate'] })
      await useCase.inviaQuantita(quantita())
      expect(eventi.righe[0].operazione).toBe('DatiQuantitaUpdate')
    })

    it('alla rinfusa i colli non partono e la copia locale li azzera', async () => {
      const { useCase, client, dati } = ambiente()
      await useCase.inviaQuantita(quantita({ rinfusa: true, numeroColli: undefined }))
      expect(client.inviaQuantita.mock.calls[0][2]).toEqual({
        quantita: { valore: 1500, unita_misura: 'kg' },
        rinfusa: true,
      })
      expect(dati.righe.get(FIR_ID)).toMatchObject({ rinfusa: true, numeroColli: null })
    })

    it("operazione assente da /azioni: 409 e NESSUNA chiamata all'ente, nessun evento", async () => {
      const { useCase, client, eventi, dati } = ambiente({ azioni: ['Annulla'] })
      await expect(useCase.inviaQuantita(quantita())).rejects.toMatchObject({
        metadata: { rule: 'OPERAZIONE_NON_DISPONIBILE' },
      })
      expect(client.inviaQuantita).not.toHaveBeenCalled()
      expect(eventi.righe).toHaveLength(0)
      expect(dati.scritture).toEqual([])
    })

    it("dati non validi (niente colli ne' rinfusa): errore prima di /azioni e dell'ente", async () => {
      const { useCase, client, getAzioni } = ambiente()
      await expect(
        useCase.inviaQuantita(quantita({ numeroColli: undefined }))
      ).rejects.toMatchObject({ metadata: { rule: 'DATI_VIAGGIO_NON_VALIDI' } })
      expect(getAzioni.execute).not.toHaveBeenCalled()
      expect(client.inviaQuantita).not.toHaveBeenCalled()
    })

    it("l'ente rifiuta (esito.errore): evento RIFIUTATA, errore leggibile, copia locale e stato INTATTI", async () => {
      const { useCase, eventi, dati, firRepository, client } = ambiente({
        esito: { errore: true, validazione: [{ campo: 'quantita' }], transazioneId: 'tr-9' },
      })
      await expect(useCase.inviaQuantita(quantita())).rejects.toMatchObject({
        metadata: { rule: 'QUANTITA_RENTRI_RIFIUTATA' },
      })
      expect(eventi.righe).toHaveLength(1)
      expect(eventi.righe[0]).toMatchObject({ esito: 'RIFIUTATA', transazioneId: 'tr-9' })
      expect(eventi.righe[0].dettaglioEnte).toContain('quantita')
      expect(dati.scritture).toEqual([])
      expect(firRepository.save).not.toHaveBeenCalled()
      expect(client.leggiStato).not.toHaveBeenCalled()
    })

    it("rifiuto HTTP dell'ente (RentriApiError non ritentabile): evento RIFIUTATA e nessuna scrittura locale", async () => {
      const { useCase, eventi, dati, client } = ambiente()
      client.inviaQuantita.mockRejectedValueOnce(
        new RentriApiError(400, 'Corpo non valido', 'numero_colli errato', false)
      )
      await expect(useCase.inviaQuantita(quantita())).rejects.toMatchObject({
        metadata: { rule: 'QUANTITA_RENTRI_RIFIUTATA' },
      })
      expect(eventi.righe[0]).toMatchObject({ esito: 'RIFIUTATA' })
      expect(eventi.righe[0].dettaglioEnte).toContain('numero_colli errato')
      expect(dati.scritture).toEqual([])
    })

    it("400 di validazione dell'ente (risposta inattesa non ritentabile): RIFIUTATA con il perche', non INCERTA", async () => {
      const { useCase, eventi, dati, client } = ambiente()
      client.inviaQuantita.mockRejectedValueOnce(
        new RispostaRentriInattesaError(
          '/formulari/BCDFGH00040ZH/quantita',
          400,
          'Corpo della richiesta non valido',
          "'numero_colli' non valido"
        )
      )
      await expect(useCase.inviaQuantita(quantita())).rejects.toMatchObject({
        metadata: { rule: 'QUANTITA_RENTRI_RIFIUTATA' },
      })
      expect(eventi.righe[0]).toMatchObject({ esito: 'RIFIUTATA' })
      expect(eventi.righe[0].dettaglioEnte).toContain("'numero_colli' non valido")
      expect(dati.scritture).toEqual([])
    })

    it('errore di rete o tentativi esauriti: evento INCERTA, errore originale propagato, nessuna scrittura locale', async () => {
      const { useCase, eventi, dati, client } = ambiente()
      const errore = new Error('timeout')
      client.inviaQuantita.mockRejectedValueOnce(errore)
      await expect(useCase.inviaQuantita(quantita())).rejects.toBe(errore)
      expect(eventi.righe[0]).toMatchObject({ esito: 'INCERTA' })
      expect(dati.scritture).toEqual([])
    })

    it("se la rilettura dello stato fallisce dopo l'esito positivo l'operazione resta riuscita", async () => {
      const { useCase, client, dati, eventi } = ambiente()
      client.leggiStato.mockRejectedValueOnce(new Error('ente irraggiungibile'))
      const r = await useCase.inviaQuantita(quantita())
      expect(r.statoFormulario).toBeNull()
      expect(dati.scritture).toEqual(['aggiornaQuantitaDopoEnte'])
      expect(eventi.righe[0]).toMatchObject({ esito: 'ACCETTATA', statoFormularioDopo: null })
    })

    it("un errore nello storico non maschera l'esito dell'operazione", async () => {
      const { useCase, eventi } = ambiente()
      eventi.registra = jest.fn().mockRejectedValue(new Error("db giu'"))
      await expect(useCase.inviaQuantita(quantita())).resolves.toMatchObject({
        operazione: 'DatiQuantita',
      })
    })

    it.each([['FIR di un altro tenant', { tenantId: 'altro' }, 'UNAUTHORIZED']])(
      '%s',
      async (_nome, extra, code) => {
        const { useCase, client } = ambiente()
        await expect(useCase.inviaQuantita(quantita(extra))).rejects.toMatchObject({ code })
        expect(client.inviaQuantita).not.toHaveBeenCalled()
      }
    )

    it('FIR non legato a RENTRI: errore, nessuna chiamata', async () => {
      const { useCase, client } = ambiente({ fir: creaFir({ legato: false }) })
      await expect(useCase.inviaQuantita(quantita())).rejects.toMatchObject({
        metadata: { rule: 'FIR_NON_LEGATO_RENTRI' },
      })
      expect(client.inviaQuantita).not.toHaveBeenCalled()
    })
  })

  describe('inviaTrasporto', () => {
    it("invia i dati terrestri, aggiorna la copia locale dopo il save, registra l'evento", async () => {
      const { useCase, client, dati, eventi, sequenza } = ambiente()

      const r = await useCase.inviaTrasporto(
        trasporto({
          targaRimorchio: 'xy987zw',
          percorso: 'A1',
          dataOraInizioTrasporto: new Date('2026-11-22T06:30:00Z'),
        })
      )

      expect(client.inviaTrasporto).toHaveBeenCalledWith(TENANT, NUMERO_FIR, {
        data_ora_inizio_trasporto: '2026-11-22T06:30:00.000Z',
        conducente: { nome: 'Mario', cognome: 'Rossi' },
        targa_automezzo: 'AB123CD',
        targa_rimorchio: 'XY987ZW',
        percorso: 'A1',
      })
      expect(sequenza).toEqual(['save', 'aggiornaTrasportoDopoEnte'])
      expect(dati.righe.get(FIR_ID)).toMatchObject({
        targaAutomezzo: 'AB123CD',
        principale: {
          conducenteNome: 'Mario',
          conducenteCognome: 'Rossi',
          targaRimorchio: 'XY987ZW',
          percorso: 'A1',
        },
      })
      expect(r.operazione).toBe('Trasporto')
      expect(eventi.righe[0]).toMatchObject({ operazione: 'Trasporto', esito: 'ACCETTATA' })
    })

    it('senza data indicata vale la data di trasporto del FIR', async () => {
      const { useCase, client } = ambiente()
      await useCase.inviaTrasporto(trasporto())
      expect(client.inviaTrasporto.mock.calls[0][2].data_ora_inizio_trasporto).toBe(
        '2026-11-21T07:00:00.000Z'
      )
    })

    it("con TrasportoUpdate (correzione) l'evento porta quel nome", async () => {
      const { useCase, eventi } = ambiente({ azioni: ['TrasportoUpdate'] })
      await useCase.inviaTrasporto(trasporto())
      expect(eventi.righe[0].operazione).toBe('TrasportoUpdate')
    })

    it('un FIR non terrestre non invia nulla (WasteFlow modella solo il terrestre)', async () => {
      const { useCase, client } = ambiente({ fir: creaFir({ tratta: TipoTratta.FERROVIARIA }) })
      await expect(useCase.inviaTrasporto(trasporto())).rejects.toMatchObject({
        metadata: { rule: 'TRASPORTO_NON_TERRESTRE' },
      })
      expect(client.inviaTrasporto).not.toHaveBeenCalled()
    })

    it('conducente mancante o targa oltre i 10 caratteri: errore locale, nessuna chiamata', async () => {
      const { useCase, client, getAzioni } = ambiente()
      await expect(
        useCase.inviaTrasporto(trasporto({ conducenteCognome: '' }))
      ).rejects.toMatchObject({ metadata: { rule: 'DATI_VIAGGIO_NON_VALIDI' } })
      await expect(
        useCase.inviaTrasporto(trasporto({ targaAutomezzo: 'ABCDEFGHIJK' }))
      ).rejects.toMatchObject({ metadata: { rule: 'DATI_VIAGGIO_NON_VALIDI' } })
      expect(getAzioni.execute).not.toHaveBeenCalled()
      expect(client.inviaTrasporto).not.toHaveBeenCalled()
    })

    it('operazione assente da /azioni: 409 senza chiamate', async () => {
      const { useCase, client } = ambiente({ azioni: ['DatiQuantita'] })
      await expect(useCase.inviaTrasporto(trasporto())).rejects.toMatchObject({
        metadata: { rule: 'OPERAZIONE_NON_DISPONIBILE' },
      })
      expect(client.inviaTrasporto).not.toHaveBeenCalled()
    })

    it("rifiuto dell'ente: evento RIFIUTATA, nessuna scrittura locale", async () => {
      const { useCase, eventi, dati } = ambiente({
        esito: { errore: true, validazione: [{ campo: 'conducente' }] },
      })
      await expect(useCase.inviaTrasporto(trasporto())).rejects.toMatchObject({
        metadata: { rule: 'TRASPORTO_RENTRI_RIFIUTATO' },
      })
      expect(eventi.righe[0]).toMatchObject({ esito: 'RIFIUTATA' })
      expect(dati.scritture).toEqual([])
    })
  })
})
