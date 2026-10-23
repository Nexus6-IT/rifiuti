import {
  ATTESA_CONFERMA_FIRMA_PREDEFINITA_S,
  CompletaOperazioneConFirmaUseCase,
} from './completa-operazione-con-firma.use-case'
import { FIR } from '../../domain/fir/aggregates/fir.aggregate'
import { DomainException } from '../../domain/shared/domain-exception'
import { descrizioneAutorizzazioneFirma } from './descrizione-autorizzazione-firma'

/**
 * R3 Task 3 — `CompletaOperazioneConFirmaUseCase`, rami fail-closed.
 *
 * La proprietà che questa suite protegge, ripetuta in OGNI test negativo:
 * **nessun ramo diverso dal successo deve chiamare `applyRentriStato` o
 * `save`**. Uno stato scritto senza conferma dell'ente è la corruzione
 * silenziosa che l'intera architettura R3 esiste per impedire — un FIR che
 * dice «Accettato» perché il codice l'ha dedotto, mentre presso l'ente
 * l'operazione non è mai stata completata.
 *
 * La verifica è esplicita e non implicita: si spia `applyRentriStato`
 * sull'aggregate reale (non un mock) e `save` sul repository.
 */
describe('CompletaOperazioneConFirmaUseCase', () => {
  const TENANT_ID = 'tenant-firma-1'
  const NUMERO_FIR = 'BCDFGH00010ZH'
  const CREDENTIALS_ID = 'CRED00001' // 9 caratteri, come vuole il contratto
  const CERTIFICATO = Buffer.from('certificato-di-prova').toString('base64')
  const DIGEST = Buffer.from('digest-di-prova').toString('base64')
  const TOKEN = 'token-hash-123'
  const FIRMA = Buffer.from('firma-di-prova').toString('base64')

  function creaFIRLegato(tenantId = TENANT_ID): FIR {
    const fir = FIR.create({
      produttoreId: 'produttore-firma',
      trasportatoreId: 'trasportatore-firma',
      destinatarioId: 'destinatario-firma',
      tenantId,
      rifiuto: { cerCode: '150101', quantita: 10 },
    })
    fir.emetti('FIR-FIRMA-000001', {
      firmatario: 'Produttore di prova SRL',
      timestamp: new Date(),
      certificato: 'certificato-di-prova',
    })
    fir.markRENTRISynced(NUMERO_FIR)
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

  /** Rate limiter finto: registra acquisizioni e rilasci per verificarne la parità. */
  function creaRateLimiter() {
    const rilascia = jest.fn().mockResolvedValue(undefined)
    const acquisisci = jest.fn().mockResolvedValue({ rilascia })
    return { acquisisci, rilascia, servizio: { acquisisci } as any }
  }

  /** Client con il percorso felice già impostato: ogni test ne rompe UN pezzo. */
  function creaClient(overrides: Record<string, unknown> = {}) {
    return {
      leggiCertificatoFirmaRemota: jest.fn().mockResolvedValue(CERTIFICATO),
      richiediHashPerFirma: jest.fn().mockResolvedValue({ digestToSign: DIGEST, token: TOKEN }),
      autorizzaFirmaRemota: jest
        .fn()
        .mockResolvedValue({ handle: 'handle-1', expiresIn: 120 }),
      verificaAutorizzazioneFirma: jest
        .fn()
        .mockResolvedValue({ stato: 'AUTORIZZATA', sad: 'sad-check-1' }),
      firmaHashRemoto: jest.fn().mockResolvedValue(FIRMA),
      inviaAcquisizioneFirma: jest.fn().mockResolvedValue({ errore: false, validazione: [] }),
      leggiStato: jest.fn().mockResolvedValue({ versione: 2, stato_formulario: 'Accettato' }),
      ...overrides,
    } as any
  }

  function creaAmbiente(opzioni: {
    fir?: FIR | null
    credentialsId?: string | null
    client?: any
  }) {
    const fir = opzioni.fir === undefined ? creaFIRLegato() : opzioni.fir
    const applyRentriStato = fir ? jest.spyOn(fir, 'applyRentriStato') : jest.fn()
    const firRepository = {
      findById: jest.fn().mockResolvedValue(fir),
      save: jest.fn().mockResolvedValue(undefined),
    }
    const credentialService = {
      getCredentialsIdFirmaRemota: jest
        .fn()
        .mockResolvedValue(
          opzioni.credentialsId === undefined ? CREDENTIALS_ID : opzioni.credentialsId
        ),
    }
    const client = opzioni.client ?? creaClient()
    const rateLimiter = creaRateLimiter()

    const useCase = new CompletaOperazioneConFirmaUseCase(
      firRepository as any,
      credentialService as any,
      client,
      rateLimiter.servizio,
      creaLogger()
    )

    return { useCase, fir, firRepository, credentialService, client, rateLimiter, applyRentriStato }
  }

  const comando = {
    firId: 'fir-1',
    tenantId: TENANT_ID,
    tipoOperazione: 'ACCETTAZIONE',
    // Intervallo e attesa ridotti al minimo: questa suite verifica la LOGICA
    // dei rami, non i tempi reali di attesa di una persona.
    intervalloPollingMs: 1,
    attesaMassimaMs: 20,
  }

  it('successo: firma completata, stato applicato con il valore LETTO dall’ente (non dedotto)', async () => {
    const { useCase, firRepository, client, applyRentriStato, rateLimiter } = creaAmbiente({})

    const risultato = await useCase.execute(comando)

    expect(risultato).toEqual({ esito: 'COMPLETATA', statoFormulario: 'Accettato' })

    // Lo stato applicato è quello di `leggiStato`, non un valore assunto dal
    // tipo di operazione: è precisamente la garanzia richiesta dal piano.
    expect(client.leggiStato).toHaveBeenCalledWith(TENANT_ID, NUMERO_FIR)
    expect(applyRentriStato).toHaveBeenCalledWith('Accettato', undefined)
    expect(firRepository.save).toHaveBeenCalledTimes(1)

    // La sequenza è quella prevista, e `/acquisizione-firma` riceve il token
    // di `/hash` e lo STESSO certificato usato per chiederlo.
    expect(client.inviaAcquisizioneFirma).toHaveBeenCalledWith(TENANT_ID, NUMERO_FIR, {
      certificato: CERTIFICATO,
      token: TOKEN,
      firma: FIRMA,
    })

    // Ogni interrogazione acquisisce e rilascia capacità: nessuno slot
    // trattenuto per la durata dell'attesa dell'utente.
    expect(rateLimiter.acquisisci).toHaveBeenCalledTimes(1)
    expect(rateLimiter.rilascia).toHaveBeenCalledTimes(1)
  })

  it('lo stato finale non è mai dedotto: se l’ente dice Annullato, si applica Annullato', async () => {
    const client = creaClient({
      leggiStato: jest.fn().mockResolvedValue({ versione: 3, stato_formulario: 'Annullato' }),
    })
    const { useCase, applyRentriStato } = creaAmbiente({ client })

    const risultato = await useCase.execute(comando)

    expect(risultato).toEqual({ esito: 'COMPLETATA', statoFormulario: 'Annullato' })
    expect(applyRentriStato).toHaveBeenCalledWith('Annullato', undefined)
  })

  it('fail-closed: credenziale di firma remota non configurata → errore leggibile PRIMA di contattare l’ente', async () => {
    const { useCase, client, firRepository, applyRentriStato } = creaAmbiente({
      credentialsId: null,
    })

    await expect(useCase.execute(comando)).rejects.toThrow(DomainException)
    await expect(useCase.execute(comando)).rejects.toThrow(/firma remota/i)

    // Nessuna chiamata all'ente: il controllo è davvero precedente.
    expect(client.leggiCertificatoFirmaRemota).not.toHaveBeenCalled()
    expect(client.autorizzaFirmaRemota).not.toHaveBeenCalled()
    expect(applyRentriStato).not.toHaveBeenCalled()
    expect(firRepository.save).not.toHaveBeenCalled()
  })

  it('fail-closed: FIR non legato a RENTRI → nessuna chiamata, nessuna scrittura', async () => {
    const fir = FIR.create({
      produttoreId: 'p',
      trasportatoreId: 't',
      destinatarioId: 'd',
      tenantId: TENANT_ID,
      rifiuto: { cerCode: '150101', quantita: 10 },
    })
    const { useCase, client, firRepository } = creaAmbiente({ fir })

    await expect(useCase.execute(comando)).rejects.toThrow(/non è ancora legato/i)
    expect(client.leggiCertificatoFirmaRemota).not.toHaveBeenCalled()
    expect(firRepository.save).not.toHaveBeenCalled()
  })

  it('fail-closed: FIR di un altro tenant → UNAUTHORIZED, nessuna scrittura', async () => {
    const { useCase, client, firRepository } = creaAmbiente({
      fir: creaFIRLegato('tenant-diverso'),
    })

    await expect(useCase.execute(comando)).rejects.toThrow(/Unauthorized/i)
    expect(client.leggiCertificatoFirmaRemota).not.toHaveBeenCalled()
    expect(firRepository.save).not.toHaveBeenCalled()
  })

  it('fail-closed: autorizzazione rifiutata dall’ente → propaga, nessuna scrittura di stato', async () => {
    const client = creaClient({
      autorizzaFirmaRemota: jest.fn().mockRejectedValue(new Error('RENTRI HTTP 403')),
    })
    const { useCase, firRepository, applyRentriStato } = creaAmbiente({ client })

    await expect(useCase.execute(comando)).rejects.toThrow(/403/)

    expect(client.firmaHashRemoto).not.toHaveBeenCalled()
    expect(client.inviaAcquisizioneFirma).not.toHaveBeenCalled()
    expect(applyRentriStato).not.toHaveBeenCalled()
    expect(firRepository.save).not.toHaveBeenCalled()
  })

  it('esito SCADUTA: expires_in trascorso senza conferma → esito tipizzato, nessuna firma, nessuna scrittura', async () => {
    const client = creaClient({
      // Scadenza dell'ente già trascorsa al primo controllo (expires_in
      // minimo): il ramo «scaduta» vince su quello «ancora in attesa».
      autorizzaFirmaRemota: jest
        .fn()
        .mockResolvedValue({ handle: 'handle-scaduto', expiresIn: 0.001 }),
      verificaAutorizzazioneFirma: jest.fn().mockResolvedValue({ stato: 'IN_ATTESA' }),
    })
    const { useCase, firRepository, applyRentriStato } = creaAmbiente({ client })

    const risultato = await useCase.execute(comando)

    // `rilevataDa` distingue questa scadenza (inferita dal NOSTRO orologio)
    // da quella dichiarata dall'ente col 410 — v. il test successivo.
    expect(risultato).toEqual({
      esito: 'SCADUTA',
      handle: 'handle-scaduto',
      rilevataDa: 'orologio-locale',
    })
    expect(client.firmaHashRemoto).not.toHaveBeenCalled()
    expect(client.inviaAcquisizioneFirma).not.toHaveBeenCalled()
    expect(applyRentriStato).not.toHaveBeenCalled()
    expect(firRepository.save).not.toHaveBeenCalled()
  })

  it('esito SCADUTA rilevata dall’ENTE (410): esce subito, senza attendere il nostro expires_in', async () => {
    // È il caso che l'errore generico mascherava: l'ente considera morta
    // l'autorizzazione PRIMA che scada il nostro orologio locale. Deve
    // produrre un esito tipizzato, non un'eccezione indistinguibile da un
    // guasto di rete.
    const verifica = jest.fn().mockResolvedValue({ stato: 'SCADUTA' })
    const client = creaClient({
      // `expires_in` lunghissimo: se il codice si affidasse solo al proprio
      // orologio, resterebbe in attesa fino al tetto di invocazione e
      // l'esito riporterebbe `orologio-locale`.
      autorizzaFirmaRemota: jest
        .fn()
        .mockResolvedValue({ handle: 'handle-410', expiresIn: 3600 }),
      verificaAutorizzazioneFirma: verifica,
    })
    const { useCase, firRepository, applyRentriStato } = creaAmbiente({ client })

    const risultato = await useCase.execute(comando)

    expect(risultato).toEqual({ esito: 'SCADUTA', handle: 'handle-410', rilevataDa: 'ente' })
    // Una sola interrogazione: la parola dell'ente chiude il ciclo subito,
    // invece di continuare a interrogare un'autorizzazione morta.
    expect(verifica).toHaveBeenCalledTimes(1)
    expect(client.firmaHashRemoto).not.toHaveBeenCalled()
    expect(applyRentriStato).not.toHaveBeenCalled()
    expect(firRepository.save).not.toHaveBeenCalled()
  })

  it('esito RIFIUTATA (400): l’utente ha rifiutato sul dispositivo → tipizzato e distinto da SCADUTA', async () => {
    const verifica = jest.fn().mockResolvedValue({ stato: 'RIFIUTATA' })
    const client = creaClient({
      autorizzaFirmaRemota: jest
        .fn()
        .mockResolvedValue({ handle: 'handle-rifiuto', expiresIn: 3600 }),
      verificaAutorizzazioneFirma: verifica,
    })
    const { useCase, firRepository, applyRentriStato } = creaAmbiente({ client })

    const risultato = await useCase.execute(comando)

    // Un rifiuto NON è una scadenza: riproporre la stessa operazione
    // significherebbe insistere su una decisione esplicita dell'utente.
    expect(risultato).toEqual({ esito: 'RIFIUTATA', handle: 'handle-rifiuto' })
    expect(verifica).toHaveBeenCalledTimes(1)
    expect(client.firmaHashRemoto).not.toHaveBeenCalled()
    expect(applyRentriStato).not.toHaveBeenCalled()
    expect(firRepository.save).not.toHaveBeenCalled()
  })

  it('esito IN_ATTESA: utente non ancora confermato ma autorizzazione ancora valida → NON è un errore', async () => {
    const client = creaClient({
      autorizzaFirmaRemota: jest
        .fn()
        .mockResolvedValue({ handle: 'handle-attesa', expiresIn: 600 }),
      verificaAutorizzazioneFirma: jest.fn().mockResolvedValue({ stato: 'IN_ATTESA' }),
    })
    const { useCase, firRepository, applyRentriStato } = creaAmbiente({ client })

    const risultato = await useCase.execute(comando)

    expect(risultato.esito).toBe('IN_ATTESA')
    if (risultato.esito === 'IN_ATTESA') {
      expect(risultato.handle).toBe('handle-attesa')
      // La scadenza comunicata al chiamante è quella dell'ENTE, non il tetto
      // di questa invocazione: è ciò che l'utente deve sapere per decidere
      // se fare ancora in tempo a confermare.
      expect(risultato.scadenzaAutorizzazione.getTime()).toBeGreaterThan(Date.now() + 500 * 1000)
    }

    expect(client.firmaHashRemoto).not.toHaveBeenCalled()
    expect(applyRentriStato).not.toHaveBeenCalled()
    expect(firRepository.save).not.toHaveBeenCalled()
  })

  it('polling: più tentativi 202 seguiti da 200 → completa, e rilascia la capacità ad ogni giro', async () => {
    const verifica = jest
      .fn()
      .mockResolvedValueOnce({ stato: 'IN_ATTESA' })
      .mockResolvedValueOnce({ stato: 'IN_ATTESA' })
      .mockResolvedValue({ stato: 'AUTORIZZATA', sad: 'sad-check-1' })
    const client = creaClient({ verificaAutorizzazioneFirma: verifica })
    const { useCase, rateLimiter } = creaAmbiente({ client })

    const risultato = await useCase.execute({ ...comando, attesaMassimaMs: 5000 })

    expect(risultato.esito).toBe('COMPLETATA')
    expect(verifica).toHaveBeenCalledTimes(3)
    // Parità fra acquisizioni e rilasci: un rilascio mancato lascerebbe uno
    // slot di concorrenza occupato fino alla potatura per età.
    expect(rateLimiter.acquisisci).toHaveBeenCalledTimes(3)
    expect(rateLimiter.rilascia).toHaveBeenCalledTimes(3)
  })

  it('la capacità viene rilasciata anche se l’interrogazione fallisce (finally)', async () => {
    const client = creaClient({
      verificaAutorizzazioneFirma: jest.fn().mockRejectedValue(new Error('RENTRI HTTP 429')),
    })
    const { useCase, rateLimiter, firRepository } = creaAmbiente({ client })

    await expect(useCase.execute(comando)).rejects.toThrow(/429/)

    expect(rateLimiter.acquisisci).toHaveBeenCalledTimes(1)
    expect(rateLimiter.rilascia).toHaveBeenCalledTimes(1)
    expect(firRepository.save).not.toHaveBeenCalled()
  })

  it('fail-closed: sign-hash fallito → propaga, nessuna acquisizione-firma, nessuna scrittura', async () => {
    const client = creaClient({
      firmaHashRemoto: jest.fn().mockRejectedValue(new Error('RENTRI HTTP 500')),
    })
    const { useCase, firRepository, applyRentriStato } = creaAmbiente({ client })

    await expect(useCase.execute(comando)).rejects.toThrow(/500/)

    expect(client.inviaAcquisizioneFirma).not.toHaveBeenCalled()
    expect(applyRentriStato).not.toHaveBeenCalled()
    expect(firRepository.save).not.toHaveBeenCalled()
  })

  it('fail-closed: /acquisizione-firma con esito.errore true → errore leggibile, NESSUNO stato applicato', async () => {
    const client = creaClient({
      inviaAcquisizioneFirma: jest.fn().mockResolvedValue({
        errore: true,
        validazione: [{ tipo: 'Errore', codice_messaggio: 'FIR-042' }],
      }),
    })
    const { useCase, firRepository, applyRentriStato } = creaAmbiente({ client })

    await expect(useCase.execute(comando)).rejects.toThrow(DomainException)
    await expect(useCase.execute(comando)).rejects.toThrow(/rifiutato la firma/i)

    // Il punto decisivo: l'ente ha rifiutato, quindi lo stato NON si legge
    // nemmeno e nulla viene scritto.
    expect(client.leggiStato).not.toHaveBeenCalled()
    expect(applyRentriStato).not.toHaveBeenCalled()
    expect(firRepository.save).not.toHaveBeenCalled()
  })

  it('la verifica locale fallita logga un warning ma NON blocca un esito confermato dall’ente', async () => {
    // Il certificato è finto e la firma non gli corrisponde: `verificaFirmaLocale`
    // restituisce false. L'operazione deve comunque completarsi, perché
    // l'autorità sull'esito è l'ente (v. il commento di quella funzione).
    const { useCase, firRepository } = creaAmbiente({})

    const risultato = await useCase.execute(comando)

    expect(risultato.esito).toBe('COMPLETATA')
    expect(firRepository.save).toHaveBeenCalledTimes(1)
  })

  it('la descrizione mostrata all’utente sul dispositivo cita numero FIR e operazione, in italiano', async () => {
    const { useCase, client } = creaAmbiente({})

    await useCase.execute({ ...comando, tipoOperazione: 'ANNULLAMENTO' })

    const richiesta = client.autorizzaFirmaRemota.mock.calls[0][1]
    expect(richiesta.credentialsId).toBe(CREDENTIALS_ID)
    expect(richiesta.digestToSign).toBe(DIGEST)
    expect(richiesta.description).toBe(descrizioneAutorizzazioneFirma(NUMERO_FIR, 'ANNULLAMENTO'))
    expect(richiesta.description).toContain(NUMERO_FIR)
    expect(richiesta.description).toContain('ANNULLAMENTO')
  })

  it('il SAD di sign-hash è quello di authorize-check', async () => {
    const { useCase, client } = creaAmbiente({})

    const risultato = await useCase.execute(comando)

    expect(risultato.esito).toBe('COMPLETATA')
    expect(client.firmaHashRemoto).toHaveBeenCalledWith(TENANT_ID, {
      credentialsId: CREDENTIALS_ID,
      sad: 'sad-check-1',
      digestToSign: DIGEST,
    })
  })

  it('authorize con sad immediato: firma senza polling', async () => {
    const client = creaClient({
      autorizzaFirmaRemota: jest
        .fn()
        .mockResolvedValue({ handle: 'handle-1', sad: 'sad-immediato', expiresIn: 60 }),
    })
    const { useCase, rateLimiter } = creaAmbiente({ client })

    const risultato = await useCase.execute(comando)

    expect(risultato.esito).toBe('COMPLETATA')
    expect(client.verificaAutorizzazioneFirma).not.toHaveBeenCalled()
    expect(rateLimiter.acquisisci).not.toHaveBeenCalled()
    expect(client.firmaHashRemoto).toHaveBeenCalledWith(TENANT_ID, {
      credentialsId: CREDENTIALS_ID,
      sad: 'sad-immediato',
      digestToSign: DIGEST,
    })
  })

  it('senza expires_in il limite di attesa è 120 secondi', async () => {
    expect(ATTESA_CONFERMA_FIRMA_PREDEFINITA_S).toBe(120)

    // Orologio pilotato: ogni interrogazione fa avanzare il tempo di 60 s.
    // Alla seconda il limite di 120 s è raggiunto → SCADUTA (orologio locale);
    // alla prima no, quindi il ciclo non esce prima del dovuto.
    let adesso = 1_700_000_000_000
    const dateNow = jest.spyOn(Date, 'now').mockImplementation(() => adesso)
    try {
      const verifica = jest.fn().mockImplementation(async () => {
        adesso += 60_000
        return { stato: 'IN_ATTESA' }
      })
      const client = creaClient({
        autorizzaFirmaRemota: jest.fn().mockResolvedValue({ handle: 'handle-senza-scadenza' }),
        verificaAutorizzazioneFirma: verifica,
      })
      const { useCase } = creaAmbiente({ client })

      const risultato = await useCase.execute({ ...comando, attesaMassimaMs: 1_000_000_000 })

      expect(risultato).toEqual({
        esito: 'SCADUTA',
        handle: 'handle-senza-scadenza',
        rilevataDa: 'orologio-locale',
      })
      expect(verifica).toHaveBeenCalledTimes(2)
    } finally {
      dateNow.mockRestore()
    }
  })
})
