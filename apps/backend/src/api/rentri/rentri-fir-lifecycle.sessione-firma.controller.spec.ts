import { ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common'
import { RentriFirLifecycleController } from './rentri-fir-lifecycle.controller'
import { DomainException } from '../../domain/shared/domain-exception'

/**
 * FIR in viaggio P1, T4 — rotte `firme/in-attesa`, `firme/:sessioneId/riprendi`, `rollback-firma`,
 * `reset`: ruoli (scritture solo ADMIN/OPERATOR effettivi, e il controller esclude VIEWER a livello
 * di classe), mappatura 409 con `codice`, passaggio di utente e azienda selezionata.
 */
describe('RentriFirLifecycleController — sessione di firma, rollback, reset', () => {
  const REQ = { user: { id: 'u1', role: 'ADMIN', tenantId: 'A' } }
  const ruolo = { ruoloEffettivo: jest.fn() }
  const rollbackReset = { execute: jest.fn() }
  const sessione = { inAttesa: jest.fn(), riprendi: jest.fn() }
  let controller: RentriFirLifecycleController

  beforeEach(() => {
    jest.resetAllMocks()
    ruolo.ruoloEffettivo.mockResolvedValue('ADMIN')
    controller = new RentriFirLifecycleController(
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      { setContext: jest.fn(), debug: jest.fn(), error: jest.fn() } as any,
      ruolo as any,
      rollbackReset as any,
      sessione as any,
      {} as any, // InviaDatiViaggioFirRentriUseCase
      {} as any, // ElencaEventiFirRentriUseCase
      {} as any // TrovaUltimoTrasportoAutomezzoUseCase
    )
  })

  it('la classe resta riservata a SUPER_ADMIN/ADMIN/OPERATOR (nessun VIEWER)', () => {
    expect(Reflect.getMetadata('roles', RentriFirLifecycleController)).toEqual([
      'SUPER_ADMIN',
      'ADMIN',
      'OPERATOR',
    ])
  })

  it('firma in attesa: incapsula la sessione (o null) senza chiamare l ente', async () => {
    sessione.inAttesa.mockResolvedValue(null)
    expect(await controller.firmaInAttesa('f', 'B')).toEqual({ sessione: null })
    expect(sessione.inAttesa).toHaveBeenCalledWith('f', 'B')
  })

  it('riprendi: passa azienda selezionata, utente e nuovaSessione allo use case', async () => {
    sessione.riprendi.mockResolvedValue({ esito: 'IN_ATTESA' })
    await controller.riprendiFirma('f', 's1', { nuovaSessione: true }, 'B', 'u1', REQ)
    expect(sessione.riprendi).toHaveBeenCalledWith({
      firId: 'f',
      tenantId: 'B',
      sessioneId: 's1',
      utenteId: 'u1',
      nuovaSessione: true,
      correlationId: undefined,
    })
  })

  it('reset e rollback-firma passano l operazione giusta', async () => {
    rollbackReset.execute.mockResolvedValue({})
    await controller.reset('f', {}, 'B', 'u1', REQ)
    await controller.rollbackFirma('f', {}, 'B', 'u1', REQ)
    expect(rollbackReset.execute.mock.calls.map(c => c[0].operazione)).toEqual([
      'Reset',
      'RollbackFirma',
    ])
    expect(rollbackReset.execute.mock.calls[0][0]).toMatchObject({ tenantId: 'B', utenteId: 'u1' })
  })

  const scritture: Array<[string, () => Promise<unknown>, jest.Mock]> = [
    ['riprendi', () => controller.riprendiFirma('f', 's', {}, 'B', 'u1', REQ), sessione.riprendi],
    ['reset', () => controller.reset('f', {}, 'B', 'u1', REQ), rollbackReset.execute],
    [
      'rollback-firma',
      () => controller.rollbackFirma('f', {}, 'B', 'u1', REQ),
      rollbackReset.execute,
    ],
  ]

  it.each(scritture)(
    '%s: consulente VIEWER nell azienda selezionata → 403, nessuna scrittura',
    async (_n, chiama, uc) => {
      ruolo.ruoloEffettivo.mockResolvedValue('VIEWER')
      await expect(chiama()).rejects.toBeInstanceOf(ForbiddenException)
      expect(ruolo.ruoloEffettivo).toHaveBeenCalledWith(REQ.user, 'B')
      expect(uc).not.toHaveBeenCalled()
    }
  )

  it('OPERAZIONE_NON_DISPONIBILE → 409 con codice stabile e messaggio per l utente', async () => {
    rollbackReset.execute.mockRejectedValue(
      DomainException.businessRuleViolation('OPERAZIONE_NON_DISPONIBILE', 'Troppo tardi.')
    )
    const errore = await controller.reset('f', {}, 'B', 'u1', REQ).catch(e => e)
    expect(errore).toBeInstanceOf(ConflictException)
    expect(errore.getResponse()).toEqual({
      statusCode: 409,
      codice: 'OPERAZIONE_NON_DISPONIBILE',
      message: 'Troppo tardi.',
    })
  })

  it('SESSIONE_FIRMA_IN_CORSO → 409; sessione inesistente → 404', async () => {
    sessione.riprendi.mockRejectedValueOnce(
      DomainException.businessRuleViolation('SESSIONE_FIRMA_IN_CORSO', 'Firma in corso.')
    )
    await expect(controller.riprendiFirma('f', 's', {}, 'B', 'u1', REQ)).rejects.toBeInstanceOf(
      ConflictException
    )
    sessione.riprendi.mockRejectedValueOnce(DomainException.notFound('Sessione di firma', 's'))
    await expect(controller.riprendiFirma('f', 's', {}, 'B', 'u1', REQ)).rejects.toBeInstanceOf(
      NotFoundException
    )
  })
})
