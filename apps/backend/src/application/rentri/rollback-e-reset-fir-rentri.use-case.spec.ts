import { FIR } from '../../domain/fir/aggregates/fir.aggregate'
import { RollbackEResetFirRentriUseCase } from './rollback-e-reset-fir-rentri.use-case'
import { SessioniFirmaRentriInMemoria } from './sessioni-firma-rentri.in-memoria'

/**
 * FIR in viaggio P1, T3 — rollback e reset: guardia `/azioni`, esito dell'ente, stato RILETTO,
 * sessione chiusa solo a operazione riuscita.
 */
describe('RollbackEResetFirRentriUseCase', () => {
  const TENANT = 'tenant-rr-1'
  const NUMERO_FIR = 'BCDFGH00030ZH'

  function creaFir(): FIR {
    const fir = FIR.create({
      produttoreId: 'p',
      trasportatoreId: 't',
      destinatarioId: 'd',
      tenantId: TENANT,
      rifiuto: { cerCode: '150101', quantita: 10 },
    })
    fir.emetti('FIR-RR-000001', { firmatario: 'X', timestamp: new Date(), certificato: 'c' })
    fir.markRENTRISynced(NUMERO_FIR)
    return fir
  }

  async function ambiente(azioni: string[] = ['Reset', 'RollbackFirma']) {
    const fir = creaFir()
    const sessioni = new SessioniFirmaRentriInMemoria()
    const apply = jest.spyOn(fir, 'applyRentriStato')
    const firRepository = {
      findById: jest.fn().mockResolvedValue(fir),
      save: jest.fn().mockResolvedValue(undefined),
    }
    const getAzioni = {
      execute: jest.fn().mockResolvedValue({ azioni: azioni.map(operazione => ({ operazione })) }),
    }
    const client = {
      resetStato: jest.fn().mockResolvedValue({ errore: false, validazione: [] }),
      rollbackFirma: jest.fn().mockResolvedValue({ errore: false, validazione: [] }),
      leggiStato: jest.fn().mockResolvedValue({
        versione: 3,
        stato_formulario: 'FirmaProduttoreTrasportatoreIniziale',
      }),
    }
    const logger: any = {
      setContext: jest.fn(),
      info: jest.fn(),
      debug: jest.fn(),
      warn: jest.fn(),
    }
    const useCase = new RollbackEResetFirRentriUseCase(
      firRepository as any,
      getAzioni as any,
      client as any,
      sessioni,
      logger
    )
    const sessione = await sessioni.apri({
      tenantId: TENANT,
      firId: 'fir-1',
      tipoOperazione: 'ACCETTAZIONE',
      handle: 'h',
      tokenAcquisizione: 't',
      digestToSign: 'd',
      scadenza: new Date(Date.now() + 60_000),
    })
    return { useCase, client, firRepository, getAzioni, sessioni, sessione, apply }
  }

  const comando = (operazione: 'Reset' | 'RollbackFirma') => ({
    firId: 'fir-1',
    tenantId: TENANT,
    operazione,
    utenteId: 'u1',
  })

  it('Reset: chiama l ente, rilegge lo stato, lo applica e annulla la sessione aperta', async () => {
    const { useCase, client, firRepository, sessioni, sessione, apply } = await ambiente()

    const r = await useCase.execute(comando('Reset'))

    expect(r).toEqual({
      operazione: 'Reset',
      statoFormulario: 'FirmaProduttoreTrasportatoreIniziale',
      sessioneAnnullataId: sessione.id,
    })
    expect(client.resetStato).toHaveBeenCalledWith(TENANT, NUMERO_FIR)
    expect(client.rollbackFirma).not.toHaveBeenCalled()
    expect(apply).toHaveBeenCalledWith('FirmaProduttoreTrasportatoreIniziale', undefined)
    expect(firRepository.save).toHaveBeenCalledTimes(1)
    expect(sessioni.righe[0].stato).toBe('ANNULLATA')
  })

  it('RollbackFirma: usa rollback-firma e non reset', async () => {
    const { useCase, client } = await ambiente()
    const r = await useCase.execute(comando('RollbackFirma'))
    expect(r.operazione).toBe('RollbackFirma')
    expect(client.rollbackFirma).toHaveBeenCalledWith(TENANT, NUMERO_FIR)
    expect(client.resetStato).not.toHaveBeenCalled()
  })

  it('operazione assente da /azioni: 409 OPERAZIONE_NON_DISPONIBILE e NESSUNA chiamata all ente', async () => {
    const { useCase, client, firRepository, sessioni } = await ambiente(['Accettazione'])

    await expect(useCase.execute(comando('Reset'))).rejects.toMatchObject({
      metadata: { rule: 'OPERAZIONE_NON_DISPONIBILE' },
    })
    expect(client.resetStato).not.toHaveBeenCalled()
    expect(client.leggiStato).not.toHaveBeenCalled()
    expect(firRepository.save).not.toHaveBeenCalled()
    expect(sessioni.righe[0].stato).toBe('IN_ATTESA')
  })

  it('l ente rifiuta: errore leggibile, stato locale e sessione invariati', async () => {
    const { useCase, client, firRepository, sessioni, apply } = await ambiente()
    client.rollbackFirma.mockResolvedValue({ errore: true, validazione: ['troppo tardi'] })

    await expect(useCase.execute(comando('RollbackFirma'))).rejects.toMatchObject({
      metadata: { rule: 'ROLLBACK_FIRMA_RIFIUTATO' },
    })
    expect(client.leggiStato).not.toHaveBeenCalled()
    expect(apply).not.toHaveBeenCalled()
    expect(firRepository.save).not.toHaveBeenCalled()
    expect(sessioni.righe[0].stato).toBe('IN_ATTESA')
  })

  it('FIR di un altro tenant: UNAUTHORIZED prima di qualunque chiamata', async () => {
    const { useCase, getAzioni, client } = await ambiente()
    await expect(useCase.execute({ ...comando('Reset'), tenantId: 'altro' })).rejects.toMatchObject(
      {
        code: 'UNAUTHORIZED',
      }
    )
    expect(getAzioni.execute).not.toHaveBeenCalled()
    expect(client.resetStato).not.toHaveBeenCalled()
  })
})
