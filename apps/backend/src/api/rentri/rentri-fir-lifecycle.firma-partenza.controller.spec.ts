import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common'
import { RentriFirLifecycleController } from './rentri-fir-lifecycle.controller'
import { FirmaPartenzaFirRentriDto } from './dto/firma-partenza-fir-rentri.dto'
import { DomainException } from '../../domain/shared/domain-exception'

/**
 * FIR in viaggio P3, T2 — rotta `POST rentri/fir/:id/firma-partenza`: ruolo effettivo, azienda selezionata,
 * utente, mappatura degli errori con `codice` stabile.
 */
describe('RentriFirLifecycleController — firma di partenza', () => {
  const REQ = { user: { id: 'u1', role: 'ADMIN', tenantId: 'A' } }
  const ruolo = { ruoloEffettivo: jest.fn() }
  const firmaPartenza = { execute: jest.fn() }
  let controller: RentriFirLifecycleController

  beforeEach(() => {
    jest.resetAllMocks()
    ruolo.ruoloEffettivo.mockResolvedValue('OPERATOR')
    controller = new RentriFirLifecycleController(
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      { setContext: jest.fn(), debug: jest.fn(), error: jest.fn() } as any,
      ruolo as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      firmaPartenza as any,
      {} as any,
      {} as any,
      {} as any
    )
  })

  it('passa azienda selezionata, utente e nuovaSessione allo use case e restituisce l esito', async () => {
    const esito = {
      operazione: 'AcquisizioneFirmaProduttoreTrasportatore',
      firma: { esito: 'COMPLETATA', statoFormulario: 'InserimentoAccettazione' },
    }
    firmaPartenza.execute.mockResolvedValue(esito)
    const dto = Object.assign(new FirmaPartenzaFirRentriDto(), {
      nuovaSessione: true,
      correlationId: 'c1',
    })

    const r = await controller.firmaPartenza('f', dto, 'B', 'u1', REQ)

    expect(r).toBe(esito)
    expect(firmaPartenza.execute).toHaveBeenCalledWith({
      firId: 'f',
      tenantId: 'B',
      utenteId: 'u1',
      nuovaSessione: true,
      correlationId: 'c1',
    })
  })

  it('consulente VIEWER nell azienda selezionata: 403 e nessuna firma', async () => {
    ruolo.ruoloEffettivo.mockResolvedValue('VIEWER')

    await expect(controller.firmaPartenza('f', {}, 'B', 'u1', REQ)).rejects.toBeInstanceOf(
      ForbiddenException
    )

    expect(ruolo.ruoloEffettivo).toHaveBeenCalledWith(REQ.user, 'B')
    expect(firmaPartenza.execute).not.toHaveBeenCalled()
  })

  it.each([
    'FIRMA_PARTENZA_NON_DISPONIBILE',
    'SESSIONE_FIRMA_IN_CORSO',
    'SESSIONE_FIRMA_NON_ATTIVA',
  ])('%s: 409 con codice stabile', async codice => {
    firmaPartenza.execute.mockRejectedValue(
      DomainException.businessRuleViolation(codice, 'Spiegazione per l utente.')
    )

    const errore = await controller.firmaPartenza('f', {}, 'B', 'u1', REQ).catch(e => e)

    expect(errore).toBeInstanceOf(ConflictException)
    expect(errore.getResponse()).toEqual({
      statusCode: 409,
      codice,
      message: 'Spiegazione per l utente.',
    })
  })

  it('FIR inesistente: 404; FIR non legato: 400', async () => {
    firmaPartenza.execute.mockRejectedValueOnce(DomainException.notFound('FIR', 'f'))
    expect(await controller.firmaPartenza('f', {}, 'B', 'u1', REQ).catch(e => e)).toBeInstanceOf(
      NotFoundException
    )

    firmaPartenza.execute.mockRejectedValueOnce(
      DomainException.businessRuleViolation('FIR_NON_LEGATO_RENTRI', 'non legato')
    )
    expect(await controller.firmaPartenza('f', {}, 'B', 'u1', REQ).catch(e => e)).toBeInstanceOf(
      BadRequestException
    )
  })

  it('firma rifiutata dall ente: 400 con il messaggio tradotto, senza il prefisso tecnico', async () => {
    firmaPartenza.execute.mockRejectedValue(
      DomainException.businessRuleViolation('FIRMA_RENTRI_RIFIUTATA', 'rifiutata')
    )

    const errore = await controller.firmaPartenza('f', {}, 'B', 'u1', REQ).catch(e => e)

    expect(errore).toBeInstanceOf(BadRequestException)
    expect(String(errore.message)).not.toMatch(/Business rule violated/)
  })
})
