import { ElencaEventiFirRentriUseCase } from './elenca-eventi-fir-rentri.use-case'
import { EventiFirRentriInMemoria } from './eventi-fir-rentri.in-memoria'

describe('ElencaEventiFirRentriUseCase', () => {
  const evento = (tenantId: string, firId: string, operazione: string) => ({
    tenantId,
    firId,
    operazione,
    payload: null,
    transazioneId: null,
    esito: 'ACCETTATA' as const,
    dettaglioEnte: null,
    statoFormularioDopo: null,
    utenteId: null,
  })

  async function ambiente(firTenant = 't1') {
    const eventi = new EventiFirRentriInMemoria()
    await eventi.registra(evento('t1', 'f1', 'DatiQuantita'))
    await eventi.registra(evento('t1', 'f1', 'Trasporto'))
    await eventi.registra(evento('t1', 'f2', 'Reset'))
    await eventi.registra(evento('t2', 'f1', 'Reset'))
    const firRepo = { findById: jest.fn().mockResolvedValue({ id: 'f1', tenantId: firTenant }) }
    return new ElencaEventiFirRentriUseCase(firRepo as any, eventi)
  }

  it("elenca solo gli eventi di quel FIR e di quell'azienda, dal piu' recente", async () => {
    const r = await (await ambiente()).execute('f1', 't1')
    expect(r.map(e => e.operazione)).toEqual(['Trasporto', 'DatiQuantita'])
  })

  it("un FIR di un'altra azienda non si elenca", async () => {
    await expect((await ambiente('t2')).execute('f1', 't1')).rejects.toMatchObject({
      code: 'UNAUTHORIZED',
    })
  })

  it('FIR inesistente: 404', async () => {
    const eventi = new EventiFirRentriInMemoria()
    const uc = new ElencaEventiFirRentriUseCase({ findById: async () => null } as any, eventi)
    await expect(uc.execute('f9', 't1')).rejects.toMatchObject({ code: 'NOT_FOUND' })
  })
})
