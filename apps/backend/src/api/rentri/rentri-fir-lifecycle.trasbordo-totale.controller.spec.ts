import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common'
import { validate } from 'class-validator'
import { RentriFirLifecycleController } from './rentri-fir-lifecycle.controller'
import { TrasbordoTotaleFirRentriDto } from './dto/trasbordo-totale-fir-rentri.dto'
import { FirmaPartenzaFirRentriDto } from './dto/firma-partenza-fir-rentri.dto'
import { DomainException } from '../../domain/shared/domain-exception'

/**
 * FIR in viaggio P6 — rotte `POST rentri/fir/:id/trasbordo-totale` e `.../firma-trasbordo-totale`: ruolo
 * effettivo, azienda selezionata, utente, DTO e mappatura degli errori con `codice` stabile. L'esito incerto
 * ha il suo codice (409), non un 500 generico.
 */
describe('RentriFirLifecycleController — trasbordo totale', () => {
  const REQ = { user: { id: 'u1', role: 'ADMIN', tenantId: 'A' } }
  const ruolo = { ruoloEffettivo: jest.fn() }
  const trasbordo = { invia: jest.fn(), firma: jest.fn(), verifica: jest.fn() }
  let controller: RentriFirLifecycleController

  const dto = (extra: Record<string, unknown> = {}) =>
    Object.assign(new TrasbordoTotaleFirRentriDto(), {
      trasportatoreId: '11111111-1111-4111-8111-111111111111',
      conducenteNome: 'Luca',
      conducenteCognome: 'Bianchi',
      targaAutomezzo: 'FG456HI',
      dataOraInizioTrasporto: '2026-11-18T12:00:00Z',
      ...extra,
    })

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
      {} as any, // AnnotazioneRentriUseCase
      {} as any, // SostaTecnicaRentriUseCase
      trasbordo as any
    )
  })

  describe('POST :id/trasbordo-totale', () => {
    it('passa azienda selezionata, utente e tutti i dati allo use case', async () => {
      const esito = {
        operazione: 'TrasbordoTotale',
        statoFormulario: 'FirmaTrasbordoTotale',
        trattaLocaleCreata: true,
        firma: { esito: 'DA_FIRMARE_DAL_NUOVO_TRASPORTATORE', avviso: 'a' },
      }
      trasbordo.invia.mockResolvedValue(esito)

      const r = await controller.dichiaraTrasbordoTotale(
        'f',
        dto({
          targaRimorchio: 'AB123CD',
          percorso: 'A1',
          presaInCaricoRimorchioPrecedente: true,
          annotazioni: 'nota',
          correlationId: 'c1',
        }),
        'B',
        'u1',
        REQ
      )

      expect(r).toBe(esito)
      expect(trasbordo.invia).toHaveBeenCalledWith({
        firId: 'f',
        tenantId: 'B',
        trasportatoreId: '11111111-1111-4111-8111-111111111111',
        conducenteNome: 'Luca',
        conducenteCognome: 'Bianchi',
        targaAutomezzo: 'FG456HI',
        targaRimorchio: 'AB123CD',
        percorso: 'A1',
        dataOraInizioTrasporto: '2026-11-18T12:00:00Z',
        presaInCaricoRimorchioPrecedente: true,
        annotazioni: 'nota',
        utenteId: 'u1',
        correlationId: 'c1',
      })
    })

    it('consulente VIEWER nell azienda selezionata: 403 e nessun trasbordo', async () => {
      ruolo.ruoloEffettivo.mockResolvedValue('VIEWER')
      await expect(
        controller.dichiaraTrasbordoTotale('f', dto(), 'B', 'u1', REQ)
      ).rejects.toBeInstanceOf(ForbiddenException)
      expect(ruolo.ruoloEffettivo).toHaveBeenCalledWith(REQ.user, 'B')
      expect(trasbordo.invia).not.toHaveBeenCalled()
    })

    it.each([
      'OPERAZIONE_NON_DISPONIBILE',
      'TRASBORDO_TOTALE_SOGGETTO_NON_NEL_FIR',
      'TRASBORDO_TOTALE_DA_FIRMARE',
      'TRASBORDO_TOTALE_DI_ALTRO_SOGGETTO',
      'TRASBORDO_TOTALE_IN_VERIFICA',
      'TRASBORDO_TOTALE_ESITO_INCERTO',
      'SESSIONE_FIRMA_IN_CORSO',
    ])('%s: 409 con codice stabile e messaggio per l utente', async codice => {
      trasbordo.invia.mockRejectedValue(
        DomainException.businessRuleViolation(codice, 'Spiegazione per l utente.')
      )
      const errore = await controller
        .dichiaraTrasbordoTotale('f', dto(), 'B', 'u1', REQ)
        .catch(e => e)
      expect(errore).toBeInstanceOf(ConflictException)
      expect(errore.getResponse()).toEqual({
        statusCode: 409,
        codice,
        message: 'Spiegazione per l utente.',
      })
    })

    it.each(['TRASBORDO_TOTALE_NON_VALIDO', 'TRASBORDO_TOTALE_RENTRI_RIFIUTATO'])(
      '%s: 400 con codice stabile',
      async codice => {
        trasbordo.invia.mockRejectedValue(
          DomainException.businessRuleViolation(codice, 'Spiegazione.')
        )
        const errore = await controller
          .dichiaraTrasbordoTotale('f', dto(), 'B', 'u1', REQ)
          .catch(e => e)
        expect(errore).toBeInstanceOf(BadRequestException)
        expect(errore.getResponse()).toEqual({ statusCode: 400, codice, message: 'Spiegazione.' })
      }
    )

    it('FIR o trasportatore inesistente: 404', async () => {
      trasbordo.invia.mockRejectedValue(DomainException.notFound('Trasportatore', 't'))
      expect(
        await controller.dichiaraTrasbordoTotale('f', dto(), 'B', 'u1', REQ).catch(e => e)
      ).toBeInstanceOf(NotFoundException)
    })
  })

  describe('DTO', () => {
    it('accetta i dati minimi e i limiti del contratto', async () => {
      expect(await validate(dto())).toHaveLength(0)
      expect(
        await validate(
          dto({
            conducenteNome: 'x'.repeat(50),
            targaRimorchio: 'x'.repeat(10),
            percorso: 'x'.repeat(250),
            annotazioni: 'x'.repeat(10000),
          })
        )
      ).toHaveLength(0)
    })

    it('rifiuta trasportatore non UUID, conducente mancante o troppo lungo, targhe e percorso oltre il limite', async () => {
      expect(await validate(dto({ trasportatoreId: 'abc' }))).not.toHaveLength(0)
      expect(await validate(dto({ trasportatoreId: undefined }))).not.toHaveLength(0)
      expect(await validate(dto({ conducenteNome: '' }))).not.toHaveLength(0)
      expect(await validate(dto({ conducenteCognome: 'x'.repeat(51) }))).not.toHaveLength(0)
      expect(await validate(dto({ targaAutomezzo: 'x'.repeat(11) }))).not.toHaveLength(0)
      expect(await validate(dto({ targaRimorchio: 'x'.repeat(11) }))).not.toHaveLength(0)
      expect(await validate(dto({ percorso: 'x'.repeat(251) }))).not.toHaveLength(0)
      expect(await validate(dto({ annotazioni: 'x'.repeat(10001) }))).not.toHaveLength(0)
      expect(await validate(dto({ dataOraInizioTrasporto: undefined }))).not.toHaveLength(0)
      expect(await validate(dto({ presaInCaricoRimorchioPrecedente: 'si' }))).not.toHaveLength(0)
    })
  })

  describe('POST :id/trasbordo-totale/verifica', () => {
    it('ruolo effettivo nell azienda selezionata, poi solo la verifica con l ente', async () => {
      const esito = { operazione: 'TrasbordoTotale', esito: 'PRESENTE' }
      trasbordo.verifica.mockResolvedValue(esito)

      const r = await controller.verificaTrasbordoTotale(
        'f',
        { correlationId: 'c1' },
        'B',
        'u1',
        REQ
      )

      expect(r).toBe(esito)
      expect(ruolo.ruoloEffettivo).toHaveBeenCalledWith(REQ.user, 'B')
      expect(trasbordo.verifica).toHaveBeenCalledWith({
        firId: 'f',
        tenantId: 'B',
        utenteId: 'u1',
        correlationId: 'c1',
      })
      expect(trasbordo.invia).not.toHaveBeenCalled()
      expect(trasbordo.firma).not.toHaveBeenCalled()
    })

    it('VIEWER: 403 e nessuna verifica; IN_VERIFICA e SESSIONE_FIRMA_IN_CORSO: 409 con codice; FIR inesistente: 404', async () => {
      ruolo.ruoloEffettivo.mockResolvedValueOnce('VIEWER')
      await expect(
        controller.verificaTrasbordoTotale('f', {}, 'B', 'u1', REQ)
      ).rejects.toBeInstanceOf(ForbiddenException)
      expect(trasbordo.verifica).not.toHaveBeenCalled()

      for (const codice of ['TRASBORDO_TOTALE_IN_VERIFICA', 'SESSIONE_FIRMA_IN_CORSO']) {
        trasbordo.verifica.mockRejectedValue(DomainException.businessRuleViolation(codice, 'No.'))
        const errore = await controller
          .verificaTrasbordoTotale('f', {}, 'B', 'u1', REQ)
          .catch(e => e)
        expect(errore).toBeInstanceOf(ConflictException)
        expect(errore.getResponse()).toMatchObject({ codice })
      }

      trasbordo.verifica.mockRejectedValue(DomainException.notFound('FIR', 'f'))
      await expect(
        controller.verificaTrasbordoTotale('f', {}, 'B', 'u1', REQ)
      ).rejects.toBeInstanceOf(NotFoundException)
    })
  })

  describe('POST :id/firma-trasbordo-totale', () => {
    it('passa nuovaSessione e restituisce l esito della firma', async () => {
      const esito = { esito: 'IN_ATTESA', handle: 'h' }
      trasbordo.firma.mockResolvedValue(esito)
      const corpo = Object.assign(new FirmaPartenzaFirRentriDto(), {
        nuovaSessione: true,
        correlationId: 'c1',
      })

      const r = await controller.firmaTrasbordoTotale('f', corpo, 'B', 'u1', REQ)

      expect(r).toBe(esito)
      expect(trasbordo.firma).toHaveBeenCalledWith({
        firId: 'f',
        tenantId: 'B',
        utenteId: 'u1',
        nuovaSessione: true,
        correlationId: 'c1',
      })
    })

    it('VIEWER: 403; FIRMA_NON_TUA e FIRMA_..._NON_DISPONIBILE: 409 con codice', async () => {
      ruolo.ruoloEffettivo.mockResolvedValueOnce('VIEWER')
      await expect(controller.firmaTrasbordoTotale('f', {}, 'B', 'u1', REQ)).rejects.toBeInstanceOf(
        ForbiddenException
      )
      expect(trasbordo.firma).not.toHaveBeenCalled()

      for (const codice of [
        'TRASBORDO_TOTALE_FIRMA_NON_TUA',
        'FIRMA_TRASBORDO_TOTALE_NON_DISPONIBILE',
      ]) {
        trasbordo.firma.mockRejectedValue(DomainException.businessRuleViolation(codice, 'No.'))
        const errore = await controller.firmaTrasbordoTotale('f', {}, 'B', 'u1', REQ).catch(e => e)
        expect(errore).toBeInstanceOf(ConflictException)
        expect(errore.getResponse()).toMatchObject({ codice })
      }
    })

    it('firma rifiutata dall ente: 400 con il messaggio tradotto per il trasbordo totale', async () => {
      trasbordo.firma.mockRejectedValue(
        DomainException.businessRuleViolation(
          'FIRMA_RENTRI_RIFIUTATA',
          "L'ente ha rifiutato la firma del formulario 1: l'operazione TRASBORDO_TOTALE NON è stata completata."
        )
      )
      const errore = await controller.firmaTrasbordoTotale('f', {}, 'B', 'u1', REQ).catch(e => e)
      expect(errore).toBeInstanceOf(BadRequestException)
      expect(String(errore.message)).toContain('trasbordo totale')
    })
  })
})
