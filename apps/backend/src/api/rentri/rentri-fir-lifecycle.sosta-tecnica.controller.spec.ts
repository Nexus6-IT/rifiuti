import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common'
import { validate } from 'class-validator'
import { RentriFirLifecycleController } from './rentri-fir-lifecycle.controller'
import { SostaTecnicaFirRentriDto } from './dto/sosta-tecnica-fir-rentri.dto'
import { FirmaPartenzaFirRentriDto } from './dto/firma-partenza-fir-rentri.dto'
import { DomainException } from '../../domain/shared/domain-exception'

/**
 * FIR in viaggio P5 — rotte `POST rentri/fir/:id/sosta-tecnica` e `.../firma-sosta-tecnica`: ruolo effettivo,
 * azienda selezionata, utente, DTO (luogo 1..1000, due date) e mappatura degli errori con `codice` stabile.
 */
describe('RentriFirLifecycleController — sosta tecnica', () => {
  const REQ = { user: { id: 'u1', role: 'ADMIN', tenantId: 'A' } }
  const ruolo = { ruoloEffettivo: jest.fn() }
  const sosta = { invia: jest.fn(), firma: jest.fn() }
  let controller: RentriFirLifecycleController

  const dto = (extra: Record<string, unknown> = {}) =>
    Object.assign(new SostaTecnicaFirRentriDto(), {
      luogoStazionamento: 'Area di servizio A1',
      dataOraSospensione: '2026-11-18T10:00:00Z',
      dataOraRipresa: '2026-11-18T12:00:00Z',
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
      sosta as any,
      {} as any // TrasbordoTotaleRentriUseCase
    )
  })

  describe('POST :id/sosta-tecnica', () => {
    it('passa azienda selezionata, utente, luogo, date e correlationId allo use case', async () => {
      const esito = {
        operazione: 'SostaTecnica',
        statoFormulario: 'FirmaSostaTecnica',
        firma: { esito: 'COMPLETATA', statoFormulario: 'InserimentoAccettazione' },
      }
      sosta.invia.mockResolvedValue(esito)

      const r = await controller.dichiaraSostaTecnica(
        'f',
        dto({ correlationId: 'c1' }),
        'B',
        'u1',
        REQ
      )

      expect(r).toBe(esito)
      expect(sosta.invia).toHaveBeenCalledWith({
        firId: 'f',
        tenantId: 'B',
        luogoStazionamento: 'Area di servizio A1',
        dataOraSospensione: '2026-11-18T10:00:00Z',
        dataOraRipresa: '2026-11-18T12:00:00Z',
        utenteId: 'u1',
        correlationId: 'c1',
      })
    })

    it('consulente VIEWER nell azienda selezionata: 403 e nessuna sosta', async () => {
      ruolo.ruoloEffettivo.mockResolvedValue('VIEWER')

      await expect(
        controller.dichiaraSostaTecnica('f', dto(), 'B', 'u1', REQ)
      ).rejects.toBeInstanceOf(ForbiddenException)

      expect(ruolo.ruoloEffettivo).toHaveBeenCalledWith(REQ.user, 'B')
      expect(sosta.invia).not.toHaveBeenCalled()
    })

    it.each([
      'OPERAZIONE_NON_DISPONIBILE',
      'SOSTA_TECNICA_SOGGETTO_NON_NEL_FIR',
      'SOSTA_TECNICA_DA_FIRMARE',
      'SOSTA_TECNICA_DI_ALTRO_SOGGETTO',
      'SOSTA_TECNICA_IN_VERIFICA',
      'SESSIONE_FIRMA_IN_CORSO',
    ])('%s: 409 con codice stabile e messaggio per l utente', async codice => {
      sosta.invia.mockRejectedValue(
        DomainException.businessRuleViolation(codice, 'Spiegazione per l utente.')
      )

      const errore = await controller.dichiaraSostaTecnica('f', dto(), 'B', 'u1', REQ).catch(e => e)

      expect(errore).toBeInstanceOf(ConflictException)
      expect(errore.getResponse()).toEqual({
        statusCode: 409,
        codice,
        message: 'Spiegazione per l utente.',
      })
    })

    it.each(['SOSTA_TECNICA_NON_VALIDA', 'SOSTA_TECNICA_RENTRI_RIFIUTATA'])(
      '%s: 400 con codice stabile',
      async codice => {
        sosta.invia.mockRejectedValue(DomainException.businessRuleViolation(codice, 'Spiegazione.'))

        const errore = await controller
          .dichiaraSostaTecnica('f', dto(), 'B', 'u1', REQ)
          .catch(e => e)

        expect(errore).toBeInstanceOf(BadRequestException)
        expect(errore.getResponse()).toEqual({ statusCode: 400, codice, message: 'Spiegazione.' })
      }
    )

    it('FIR inesistente: 404', async () => {
      sosta.invia.mockRejectedValue(DomainException.notFound('FIR', 'f'))
      expect(
        await controller.dichiaraSostaTecnica('f', dto(), 'B', 'u1', REQ).catch(e => e)
      ).toBeInstanceOf(NotFoundException)
    })
  })

  describe('DTO', () => {
    it('accetta luogo da 1 a 1000 caratteri con le due date', async () => {
      expect(await validate(dto())).toHaveLength(0)
      expect(await validate(dto({ luogoStazionamento: 'x'.repeat(1000) }))).toHaveLength(0)
    })

    it('rifiuta luogo vuoto, mancante o di 1001 caratteri, e date mancanti o non testuali', async () => {
      expect(await validate(dto({ luogoStazionamento: '' }))).not.toHaveLength(0)
      expect(await validate(dto({ luogoStazionamento: undefined }))).not.toHaveLength(0)
      const troppo = await validate(dto({ luogoStazionamento: 'x'.repeat(1001) }))
      expect(troppo).not.toHaveLength(0)
      expect(JSON.stringify(troppo)).toContain('1000')
      expect(await validate(dto({ dataOraSospensione: undefined }))).not.toHaveLength(0)
      expect(await validate(dto({ dataOraRipresa: 42 }))).not.toHaveLength(0)
    })
  })

  describe('POST :id/firma-sosta-tecnica', () => {
    it('passa nuovaSessione e restituisce l esito della firma', async () => {
      const esito = { esito: 'IN_ATTESA', handle: 'h' }
      sosta.firma.mockResolvedValue(esito)
      const corpo = Object.assign(new FirmaPartenzaFirRentriDto(), {
        nuovaSessione: true,
        correlationId: 'c1',
      })

      const r = await controller.firmaSostaTecnica('f', corpo, 'B', 'u1', REQ)

      expect(r).toBe(esito)
      expect(sosta.firma).toHaveBeenCalledWith({
        firId: 'f',
        tenantId: 'B',
        utenteId: 'u1',
        nuovaSessione: true,
        correlationId: 'c1',
      })
    })

    it('VIEWER: 403; FIRMA_SOSTA_TECNICA_NON_DISPONIBILE: 409 con codice', async () => {
      ruolo.ruoloEffettivo.mockResolvedValueOnce('VIEWER')
      await expect(controller.firmaSostaTecnica('f', {}, 'B', 'u1', REQ)).rejects.toBeInstanceOf(
        ForbiddenException
      )
      expect(sosta.firma).not.toHaveBeenCalled()

      sosta.firma.mockRejectedValue(
        DomainException.businessRuleViolation(
          'FIRMA_SOSTA_TECNICA_NON_DISPONIBILE',
          'Nessuna sosta.'
        )
      )
      const errore = await controller.firmaSostaTecnica('f', {}, 'B', 'u1', REQ).catch(e => e)
      expect(errore).toBeInstanceOf(ConflictException)
      expect(errore.getResponse()).toMatchObject({ codice: 'FIRMA_SOSTA_TECNICA_NON_DISPONIBILE' })
    })

    it('firma rifiutata dall ente: 400 con il messaggio tradotto per la sosta tecnica', async () => {
      sosta.firma.mockRejectedValue(
        DomainException.businessRuleViolation(
          'FIRMA_RENTRI_RIFIUTATA',
          "L'ente ha rifiutato la firma del formulario 1: l'operazione SOSTA_TECNICA NON è stata completata."
        )
      )
      const errore = await controller.firmaSostaTecnica('f', {}, 'B', 'u1', REQ).catch(e => e)
      expect(errore).toBeInstanceOf(BadRequestException)
      expect(String(errore.message)).toContain('sosta tecnica')
    })
  })
})
