import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common'
import { validate } from 'class-validator'
import { RentriFirLifecycleController } from './rentri-fir-lifecycle.controller'
import { AnnotazioneFirRentriDto } from './dto/annotazione-fir-rentri.dto'
import { FirmaPartenzaFirRentriDto } from './dto/firma-partenza-fir-rentri.dto'
import { DomainException } from '../../domain/shared/domain-exception'

/**
 * FIR in viaggio P4, T2 — rotte `POST rentri/fir/:id/annotazione` e `.../firma-annotazione`: ruolo effettivo,
 * azienda selezionata, utente, DTO (1..10.000 caratteri) e mappatura degli errori con `codice` stabile.
 */
describe('RentriFirLifecycleController — annotazione', () => {
  const REQ = { user: { id: 'u1', role: 'ADMIN', tenantId: 'A' } }
  const ruolo = { ruoloEffettivo: jest.fn() }
  const annotazione = { invia: jest.fn(), firma: jest.fn() }
  let controller: RentriFirLifecycleController

  const dto = (testo: string, extra: Record<string, unknown> = {}) =>
    Object.assign(new AnnotazioneFirRentriDto(), { testo, ...extra })

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
      {} as any,
      annotazione as any
    )
  })

  describe('POST :id/annotazione', () => {
    it('passa azienda selezionata, utente, testo e correlationId allo use case', async () => {
      const esito = {
        operazione: 'Annotazione',
        statoFormulario: 'FirmaAnnotazione',
        firma: { esito: 'COMPLETATA', statoFormulario: 'InserimentoAccettazione' },
      }
      annotazione.invia.mockResolvedValue(esito)

      const r = await controller.aggiungiAnnotazione(
        'f',
        dto('Testo', { correlationId: 'c1' }),
        'B',
        'u1',
        REQ
      )

      expect(r).toBe(esito)
      expect(annotazione.invia).toHaveBeenCalledWith({
        firId: 'f',
        tenantId: 'B',
        testo: 'Testo',
        utenteId: 'u1',
        correlationId: 'c1',
      })
    })

    it('consulente VIEWER nell azienda selezionata: 403 e nessuna annotazione', async () => {
      ruolo.ruoloEffettivo.mockResolvedValue('VIEWER')

      await expect(
        controller.aggiungiAnnotazione('f', dto('x'), 'B', 'u1', REQ)
      ).rejects.toBeInstanceOf(ForbiddenException)

      expect(ruolo.ruoloEffettivo).toHaveBeenCalledWith(REQ.user, 'B')
      expect(annotazione.invia).not.toHaveBeenCalled()
    })

    it.each([
      'OPERAZIONE_NON_DISPONIBILE',
      'ANNOTAZIONE_SOGGETTO_NON_NEL_FIR',
      'ANNOTAZIONE_DA_FIRMARE',
      'SESSIONE_FIRMA_IN_CORSO',
      'ANNOTAZIONE_IN_VERIFICA',
      'ANNOTAZIONE_DI_ALTRO_SOGGETTO',
    ])('%s: 409 con codice stabile e messaggio per l utente', async codice => {
      annotazione.invia.mockRejectedValue(
        DomainException.businessRuleViolation(codice, 'Spiegazione per l utente.')
      )

      const errore = await controller
        .aggiungiAnnotazione('f', dto('x'), 'B', 'u1', REQ)
        .catch(e => e)

      expect(errore).toBeInstanceOf(ConflictException)
      expect(errore.getResponse()).toEqual({
        statusCode: 409,
        codice,
        message: 'Spiegazione per l utente.',
      })
    })

    it.each(['ANNOTAZIONE_NON_VALIDA', 'ANNOTAZIONE_RENTRI_RIFIUTATA'])(
      '%s: 400 con codice stabile',
      async codice => {
        annotazione.invia.mockRejectedValue(
          DomainException.businessRuleViolation(codice, 'Spiegazione.')
        )

        const errore = await controller
          .aggiungiAnnotazione('f', dto('x'), 'B', 'u1', REQ)
          .catch(e => e)

        expect(errore).toBeInstanceOf(BadRequestException)
        expect(errore.getResponse()).toEqual({ statusCode: 400, codice, message: 'Spiegazione.' })
      }
    )

    it('FIR inesistente: 404', async () => {
      annotazione.invia.mockRejectedValue(DomainException.notFound('FIR', 'f'))
      expect(
        await controller.aggiungiAnnotazione('f', dto('x'), 'B', 'u1', REQ).catch(e => e)
      ).toBeInstanceOf(NotFoundException)
    })
  })

  describe('DTO', () => {
    it('accetta 1 e 10.000 caratteri, rifiuta vuoto, mancante e 10.001', async () => {
      expect(await validate(dto('x'))).toHaveLength(0)
      expect(await validate(dto('x'.repeat(10000)))).toHaveLength(0)
      expect(await validate(dto(''))).not.toHaveLength(0)
      expect(await validate(new AnnotazioneFirRentriDto())).not.toHaveLength(0)
      const troppo = await validate(dto('x'.repeat(10001)))
      expect(troppo).not.toHaveLength(0)
      expect(JSON.stringify(troppo)).toContain('10000')
    })
  })

  describe('POST :id/firma-annotazione', () => {
    it('passa nuovaSessione e restituisce l esito della firma', async () => {
      const esito = { esito: 'IN_ATTESA', handle: 'h' }
      annotazione.firma.mockResolvedValue(esito)
      const corpo = Object.assign(new FirmaPartenzaFirRentriDto(), {
        nuovaSessione: true,
        correlationId: 'c1',
      })

      const r = await controller.firmaAnnotazione('f', corpo, 'B', 'u1', REQ)

      expect(r).toBe(esito)
      expect(annotazione.firma).toHaveBeenCalledWith({
        firId: 'f',
        tenantId: 'B',
        utenteId: 'u1',
        nuovaSessione: true,
        correlationId: 'c1',
      })
    })

    it('VIEWER: 403; FIRMA_ANNOTAZIONE_NON_DISPONIBILE: 409 con codice', async () => {
      ruolo.ruoloEffettivo.mockResolvedValueOnce('VIEWER')
      await expect(controller.firmaAnnotazione('f', {}, 'B', 'u1', REQ)).rejects.toBeInstanceOf(
        ForbiddenException
      )
      expect(annotazione.firma).not.toHaveBeenCalled()

      annotazione.firma.mockRejectedValue(
        DomainException.businessRuleViolation(
          'FIRMA_ANNOTAZIONE_NON_DISPONIBILE',
          'Nessuna annotazione.'
        )
      )
      const errore = await controller.firmaAnnotazione('f', {}, 'B', 'u1', REQ).catch(e => e)
      expect(errore).toBeInstanceOf(ConflictException)
      expect(errore.getResponse()).toMatchObject({ codice: 'FIRMA_ANNOTAZIONE_NON_DISPONIBILE' })
    })

    it('firma rifiutata dall ente: 400 con il messaggio tradotto per l annotazione', async () => {
      annotazione.firma.mockRejectedValue(
        DomainException.businessRuleViolation(
          'FIRMA_RENTRI_RIFIUTATA',
          "L'ente ha rifiutato la firma del formulario 1: l'operazione ANNOTAZIONE NON è stata completata."
        )
      )
      const errore = await controller.firmaAnnotazione('f', {}, 'B', 'u1', REQ).catch(e => e)
      expect(errore).toBeInstanceOf(BadRequestException)
      expect(String(errore.message)).toContain("firma dell'annotazione")
    })
  })
})
