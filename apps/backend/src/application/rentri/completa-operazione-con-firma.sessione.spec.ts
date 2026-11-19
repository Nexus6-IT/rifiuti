import { CompletaOperazioneConFirmaUseCase } from './completa-operazione-con-firma.use-case'
import { SessioniFirmaRentriInMemoria } from './sessioni-firma-rentri.in-memoria'
import { FIR } from '../../domain/fir/aggregates/fir.aggregate'

/**
 * FIR in viaggio P1, T1-T2 — la firma remota e' RIPRENDIBILE: due invocazioni sullo stesso FIR e
 * stessa operazione fanno UNA sola `authorize` (una sola richiesta sul telefono), e una sessione
 * scaduta non ne apre una nuova senza richiesta esplicita.
 */
describe('CompletaOperazioneConFirmaUseCase — sessione di firma riprendibile', () => {
  const TENANT = 'tenant-sess-1'
  const NUMERO_FIR = 'BCDFGH00020ZH'
  const CERT = Buffer.from('cert').toString('base64')
  const DIGEST = Buffer.from('digest-originale').toString('base64')
  const TOKEN = 'token-originale'

  function creaFir(): FIR {
    const fir = FIR.create({
      produttoreId: 'p',
      trasportatoreId: 't',
      destinatarioId: 'd',
      tenantId: TENANT,
      rifiuto: { cerCode: '150101', quantita: 10 },
    })
    fir.emetti('FIR-SESS-000001', { firmatario: 'X', timestamp: new Date(), certificato: 'c' })
    fir.markRENTRISynced(NUMERO_FIR)
    return fir
  }

  const logger = (): any => ({
    setContext: jest.fn(),
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  })

  function ambiente(clientExtra: Record<string, unknown> = {}) {
    const fir = creaFir()
    const sessioni = new SessioniFirmaRentriInMemoria()
    const client: any = {
      leggiCertificatoFirmaRemota: jest.fn().mockResolvedValue(CERT),
      richiediHashPerFirma: jest.fn().mockResolvedValue({ digestToSign: DIGEST, token: TOKEN }),
      autorizzaFirmaRemota: jest.fn().mockResolvedValue({ handle: 'handle-1' }),
      verificaAutorizzazioneFirma: jest.fn().mockResolvedValue({ stato: 'IN_ATTESA' }),
      firmaHashRemoto: jest.fn().mockResolvedValue('firma'),
      inviaAcquisizioneFirma: jest.fn().mockResolvedValue({ errore: false, validazione: [] }),
      leggiStato: jest.fn().mockResolvedValue({ versione: 2, stato_formulario: 'InViaggio' }),
      ...clientExtra,
    }
    const firRepository = {
      findById: jest.fn().mockResolvedValue(fir),
      save: jest.fn().mockResolvedValue(undefined),
    }
    const rilascia = jest.fn().mockResolvedValue(undefined)
    const useCase = new CompletaOperazioneConFirmaUseCase(
      firRepository as any,
      { getCredentialsIdFirmaRemota: jest.fn().mockResolvedValue('CRED00001') } as any,
      client,
      { acquisisci: jest.fn().mockResolvedValue({ rilascia }) } as any,
      sessioni,
      logger()
    )
    return { useCase, client, sessioni, firRepository, fir }
  }

  const comando = {
    firId: 'fir-1',
    tenantId: TENANT,
    tipoOperazione: 'ACCETTAZIONE',
    intervalloPollingMs: 1,
    attesaMassimaMs: 10,
  }

  it('due invocazioni: UNA sola authorize e UN solo /hash; la seconda riprende lo stesso handle', async () => {
    const { useCase, client, sessioni } = ambiente()

    const prima = await useCase.execute({ ...comando, utenteId: 'utente-1' })
    expect(prima).toMatchObject({ esito: 'IN_ATTESA', handle: 'handle-1' })
    expect(sessioni.righe).toHaveLength(1)
    expect(sessioni.righe[0]).toMatchObject({
      stato: 'IN_ATTESA',
      handle: 'handle-1',
      tipoOperazione: 'ACCETTAZIONE',
      utenteId: 'utente-1',
    })

    // L'utente ha confermato sul telefono: il polling dello STESSO handle ora risponde 200.
    client.verificaAutorizzazioneFirma.mockResolvedValue({ stato: 'AUTORIZZATA', sad: 'sad-1' })
    const seconda = await useCase.execute(comando)

    expect(seconda).toEqual({ esito: 'COMPLETATA', statoFormulario: 'InViaggio' })
    expect(client.autorizzaFirmaRemota).toHaveBeenCalledTimes(1)
    expect(client.richiediHashPerFirma).toHaveBeenCalledTimes(1)
    expect(client.verificaAutorizzazioneFirma).toHaveBeenLastCalledWith(TENANT, 'handle-1')
    // La firma e l'acquisizione usano digest e token SALVATI nella sessione.
    expect(client.firmaHashRemoto).toHaveBeenCalledWith(TENANT, {
      credentialsId: 'CRED00001',
      sad: 'sad-1',
      digestToSign: DIGEST,
    })
    expect(client.inviaAcquisizioneFirma).toHaveBeenCalledWith(TENANT, NUMERO_FIR, {
      certificato: CERT,
      token: TOKEN,
      firma: 'firma',
    })
    expect(sessioni.righe[0].stato).toBe('COMPLETATA')
  })

  it('la sessione IN_ATTESA porta nell esito il sessioneId da riprendere', async () => {
    const { useCase, sessioni } = ambiente()
    const r = await useCase.execute(comando)
    expect(r).toMatchObject({ esito: 'IN_ATTESA', sessioneId: sessioni.righe[0].id })
  })

  it('con il sad gia nella risposta di authorize nessuna sessione viene salvata', async () => {
    const { useCase, sessioni } = ambiente({
      autorizzaFirmaRemota: jest.fn().mockResolvedValue({ handle: 'h', sad: 'sad-subito' }),
    })
    const r = await useCase.execute(comando)
    expect(r.esito).toBe('COMPLETATA')
    expect(sessioni.righe).toHaveLength(0)
  })

  it('T2: sessione scaduta per orologio → SCADUTA, nessuna chiamata all ente, nessuna nuova sessione', async () => {
    const { useCase, client, sessioni } = ambiente()
    await useCase.execute(comando)
    sessioni.righe[0].scadenza = new Date(Date.now() - 1000)
    client.autorizzaFirmaRemota.mockClear()
    client.richiediHashPerFirma.mockClear()
    client.verificaAutorizzazioneFirma.mockClear()

    const r = await useCase.execute(comando)

    expect(r).toMatchObject({
      esito: 'SCADUTA',
      handle: 'handle-1',
      rilevataDa: 'orologio-locale',
    })
    expect(sessioni.righe).toHaveLength(1)
    expect(sessioni.righe[0].stato).toBe('SCADUTA')
    expect(client.autorizzaFirmaRemota).not.toHaveBeenCalled()
    expect(client.richiediHashPerFirma).not.toHaveBeenCalled()
    expect(client.verificaAutorizzazioneFirma).not.toHaveBeenCalled()
  })

  it('T2: dopo la scadenza una nuova sessione parte solo su richiesta esplicita', async () => {
    const { useCase, client, sessioni } = ambiente()
    await useCase.execute(comando)
    sessioni.righe[0].scadenza = new Date(Date.now() - 1000)
    client.autorizzaFirmaRemota.mockResolvedValue({ handle: 'handle-2' })

    const r = await useCase.execute({ ...comando, nuovaSessione: true })

    expect(r).toMatchObject({ esito: 'IN_ATTESA', handle: 'handle-2' })
    expect(client.autorizzaFirmaRemota).toHaveBeenCalledTimes(2)
    expect(sessioni.righe.map(s => s.stato)).toEqual(['SCADUTA', 'IN_ATTESA'])
  })

  it('l ente dichiara morta l autorizzazione (400) durante la ripresa: sessione SCADUTA', async () => {
    const { useCase, client, sessioni } = ambiente()
    await useCase.execute(comando)
    client.verificaAutorizzazioneFirma.mockResolvedValue({
      stato: 'SCADUTA',
      dettaglioEnte: 'morta',
    })

    const r = await useCase.execute(comando)

    expect(r).toMatchObject({ esito: 'SCADUTA', rilevataDa: 'ente', dettaglioEnte: 'morta' })
    expect(sessioni.righe[0]).toMatchObject({ stato: 'SCADUTA', dettaglioEnte: 'morta' })
  })

  it('rifiuto (403): sessione RIFIUTATA', async () => {
    const { useCase, client, sessioni } = ambiente()
    await useCase.execute(comando)
    client.verificaAutorizzazioneFirma.mockResolvedValue({
      stato: 'RIFIUTATA',
      dettaglioEnte: 'no',
    })
    const r = await useCase.execute(comando)
    expect(r).toMatchObject({ esito: 'RIFIUTATA' })
    expect(sessioni.righe[0].stato).toBe('RIFIUTATA')
  })

  it('sessione aperta per un altra operazione: SESSIONE_FIRMA_IN_CORSO e nessuna chiamata all ente', async () => {
    const { useCase, client } = ambiente()
    await useCase.execute(comando)
    client.autorizzaFirmaRemota.mockClear()
    client.richiediHashPerFirma.mockClear()

    await expect(
      useCase.execute({ ...comando, tipoOperazione: 'ANNULLAMENTO' })
    ).rejects.toMatchObject({
      metadata: { rule: 'SESSIONE_FIRMA_IN_CORSO' },
    })
    expect(client.autorizzaFirmaRemota).not.toHaveBeenCalled()
    expect(client.richiediHashPerFirma).not.toHaveBeenCalled()
  })

  it('un errore dopo l autorizzazione (sign-hash) chiude la sessione ANNULLATA: il FIR non resta bloccato', async () => {
    const { useCase, client, sessioni, firRepository } = ambiente()
    await useCase.execute(comando)
    client.verificaAutorizzazioneFirma.mockResolvedValue({ stato: 'AUTORIZZATA', sad: 's' })
    client.firmaHashRemoto.mockRejectedValue(new Error('HSM giu'))

    await expect(useCase.execute(comando)).rejects.toThrow('HSM giu')

    expect(sessioni.righe[0].stato).toBe('ANNULLATA')
    expect(firRepository.save).not.toHaveBeenCalled()
  })

  it('acquisizione rifiutata dall ente: sessione RIFIUTATA e FIRMA_RENTRI_RIFIUTATA', async () => {
    const { useCase, client, sessioni } = ambiente()
    await useCase.execute(comando)
    client.verificaAutorizzazioneFirma.mockResolvedValue({ stato: 'AUTORIZZATA', sad: 's' })
    client.inviaAcquisizioneFirma.mockResolvedValue({ errore: true, validazione: ['x'] })

    await expect(useCase.execute(comando)).rejects.toMatchObject({
      metadata: { rule: 'FIRMA_RENTRI_RIFIUTATA' },
    })
    expect(sessioni.righe[0].stato).toBe('RIFIUTATA')
  })
})
