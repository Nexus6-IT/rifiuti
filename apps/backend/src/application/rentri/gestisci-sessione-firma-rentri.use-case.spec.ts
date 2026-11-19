import { FIR } from '../../domain/fir/aggregates/fir.aggregate'
import { GestisciSessioneFirmaRentriUseCase } from './gestisci-sessione-firma-rentri.use-case'
import { SessioniFirmaRentriInMemoria } from './sessioni-firma-rentri.in-memoria'

describe('GestisciSessioneFirmaRentriUseCase', () => {
  const TENANT = 'tenant-gs-1'

  async function ambiente() {
    const fir = FIR.create({
      produttoreId: 'p',
      trasportatoreId: 't',
      destinatarioId: 'd',
      tenantId: TENANT,
      rifiuto: { cerCode: '150101', quantita: 10 },
    })
    const sessioni = new SessioniFirmaRentriInMemoria()
    const completa = { execute: jest.fn().mockResolvedValue({ esito: 'IN_ATTESA' }) }
    const logger: any = { setContext: jest.fn(), info: jest.fn(), debug: jest.fn() }
    const useCase = new GestisciSessioneFirmaRentriUseCase(
      { findById: jest.fn().mockResolvedValue(fir) } as any,
      sessioni,
      completa as any,
      logger
    )
    const sessione = await sessioni.apri({
      tenantId: TENANT,
      firId: 'fir-1',
      tipoOperazione: 'ANNULLAMENTO',
      handle: 'h',
      tokenAcquisizione: 'SEGRETO',
      digestToSign: 'd',
      scadenza: new Date(Date.now() + 60_000),
    })
    return { useCase, sessioni, completa, sessione }
  }

  it('inAttesa espone id, operazione e scadenza, MAI token, digest o handle', async () => {
    const { useCase, sessione } = await ambiente()
    const v = await useCase.inAttesa('fir-1', TENANT)
    expect(v).toEqual({
      id: sessione.id,
      tipoOperazione: 'ANNULLAMENTO',
      scadenza: sessione.scadenza,
      scaduta: false,
    })
    expect(JSON.stringify(v)).not.toContain('SEGRETO')
  })

  it('inAttesa segnala scaduta=true se il limite e passato, e null senza sessione', async () => {
    const { useCase, sessioni } = await ambiente()
    sessioni.righe[0].scadenza = new Date(Date.now() - 1)
    expect((await useCase.inAttesa('fir-1', TENANT))?.scaduta).toBe(true)
    sessioni.righe[0].stato = 'COMPLETATA'
    expect(await useCase.inAttesa('fir-1', TENANT)).toBeNull()
  })

  it('riprendi su sessione aperta delega a Completa con l operazione della sessione', async () => {
    const { useCase, completa, sessione } = await ambiente()
    await useCase.riprendi({
      firId: 'fir-1',
      tenantId: TENANT,
      sessioneId: sessione.id,
      utenteId: 'u',
    })
    expect(completa.execute).toHaveBeenCalledWith(
      expect.objectContaining({
        tipoOperazione: 'ANNULLAMENTO',
        firId: 'fir-1',
        nuovaSessione: undefined,
      })
    )
  })

  it('sessione SCADUTA: restituisce l esito senza chiamare l ente, tranne con nuovaSessione', async () => {
    const { useCase, completa, sessione, sessioni } = await ambiente()
    await sessioni.chiudi(TENANT, sessione.id, 'SCADUTA')
    const r = await useCase.riprendi({ firId: 'fir-1', tenantId: TENANT, sessioneId: sessione.id })
    expect(r).toMatchObject({ esito: 'SCADUTA', sessioneId: sessione.id })
    expect(completa.execute).not.toHaveBeenCalled()

    await useCase.riprendi({
      firId: 'fir-1',
      tenantId: TENANT,
      sessioneId: sessione.id,
      nuovaSessione: true,
    })
    expect(completa.execute).toHaveBeenCalledWith(expect.objectContaining({ nuovaSessione: true }))
  })

  it('sessione COMPLETATA/ANNULLATA: SESSIONE_FIRMA_NON_ATTIVA; altro FIR o altro tenant: not found', async () => {
    const { useCase, sessione, sessioni } = await ambiente()
    await sessioni.chiudi(TENANT, sessione.id, 'ANNULLATA')
    await expect(
      useCase.riprendi({ firId: 'fir-1', tenantId: TENANT, sessioneId: sessione.id })
    ).rejects.toMatchObject({ metadata: { rule: 'SESSIONE_FIRMA_NON_ATTIVA' } })
    await expect(
      useCase.riprendi({ firId: 'fir-2', tenantId: TENANT, sessioneId: sessione.id })
    ).rejects.toMatchObject({ code: 'NOT_FOUND' })
  })
})
