import { BadRequestException, ConflictException } from '@nestjs/common'
import { FIRControllerV2 } from './fir.controller.v2'
import { Result } from '../../core/application/result'
import { FIRResponseDto } from './dtos/fir-response.dto'
import { DomainException } from '../../domain/shared/domain-exception'

/**
 * FIR in viaggio P3, T1 — «Emetti» e «Presa in carico» propongono la firma di partenza su RENTRI.
 * Regola: se l'azione locale riesce e la firma RENTRI fallisce, l'azione locale NON si annulla.
 */
describe('FIRControllerV2 — firma di partenza su RENTRI', () => {
  const USER = { id: 'u1', email: 'u@example.com', tenantId: 'A', role: 'OPERATOR' } as any
  const firEmesso = { id: 'f1', tenantId: 'T1', stato: 'EMESSO' }
  const firRiletto = { id: 'f1', tenantId: 'T1', stato: 'IN_TRANSITO' }

  let emetti: { execute: jest.Mock }
  let presaInCarico: { execute: jest.Mock }
  let firmaPartenza: {
    dopoAzioneLocale: jest.Mock
    execute: jest.Mock
    tenantSeLegatoRentri: jest.Mock
    rileggiFir: jest.Mock
  }

  const controller = () =>
    new FIRControllerV2(
      {} as any,
      emetti as any,
      presaInCarico as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      firmaPartenza as any
    )

  beforeEach(() => {
    jest.spyOn(FIRResponseDto, 'fromDomain').mockImplementation((fir: any) => ({ ...fir }))
    emetti = { execute: jest.fn().mockResolvedValue(Result.ok(firEmesso)) }
    presaInCarico = { execute: jest.fn().mockResolvedValue(Result.ok(firEmesso)) }
    firmaPartenza = {
      dopoAzioneLocale: jest.fn().mockResolvedValue({ stato: 'NON_APPLICABILE' }),
      execute: jest.fn(),
      tenantSeLegatoRentri: jest.fn().mockResolvedValue(null),
      rileggiFir: jest.fn().mockResolvedValue(firRiletto),
    }
  })

  afterEach(() => jest.restoreAllMocks())

  describe('emetti', () => {
    it('senza richiesta della firma RENTRI: solo azione locale, nessuna chiamata all ente (non regressione)', async () => {
      const r = await controller().emetti('f1', {}, USER)

      expect(r).toEqual(expect.objectContaining({ id: 'f1', stato: 'EMESSO' }))
      expect(r).not.toHaveProperty('firmaRentri')
      expect(firmaPartenza.dopoAzioneLocale).not.toHaveBeenCalled()
    })

    it('firmaRentri su FIR non legato (flusso cartaceo): risposta identica, nessun campo in piu', async () => {
      const r = await controller().emetti('f1', { firmaRentri: true }, USER)

      expect(firmaPartenza.dopoAzioneLocale).toHaveBeenCalledWith({
        firId: 'f1',
        tenantId: 'T1',
        utenteId: 'u1',
      })
      expect(r).not.toHaveProperty('firmaRentri')
      expect(firmaPartenza.rileggiFir).not.toHaveBeenCalled()
    })

    it('azione locale riuscita e firma RENTRI riuscita: FIR riletto con lo stato di viaggio e esito COMPLETATA', async () => {
      firmaPartenza.dopoAzioneLocale.mockResolvedValue({
        stato: 'COMPLETATA',
        statoFormulario: 'InserimentoAccettazione',
      })

      const r = await controller().emetti('f1', { firmaRentri: true }, USER)

      expect(r).toMatchObject({ stato: 'IN_TRANSITO' })
      expect(r.firmaRentri).toEqual({
        stato: 'COMPLETATA',
        statoFormulario: 'InserimentoAccettazione',
      })
    })

    it('azione locale riuscita e firma RENTRI fallita: l emissione resta, risposta 200 con l avviso «firma RENTRI da completare»', async () => {
      const avviso = {
        stato: 'DA_COMPLETARE',
        avviso: 'Firma RENTRI da completare: la richiesta di firma non è andata a buon fine.',
      }
      firmaPartenza.dopoAzioneLocale.mockResolvedValue(avviso)

      const r = await controller().emetti('f1', { firmaRentri: true }, USER)

      expect(emetti.execute).toHaveBeenCalledTimes(1)
      expect(r).toMatchObject({ id: 'f1', stato: 'EMESSO' }) // l'emissione NON e annullata
      expect(r.firmaRentri).toEqual(avviso)
    })

    it('firma in attesa del telefono: esito IN_ATTESA con la sessione, FIR non riletto', async () => {
      const scadenza = new Date()
      firmaPartenza.dopoAzioneLocale.mockResolvedValue({
        stato: 'IN_ATTESA',
        sessioneId: 's1',
        scadenza,
      })

      const r = await controller().emetti('f1', { firmaRentri: true }, USER)

      expect(r.firmaRentri).toEqual({ stato: 'IN_ATTESA', sessioneId: 's1', scadenza })
    })

    it('emissione fallita: nessuna firma RENTRI proposta', async () => {
      emetti.execute.mockResolvedValue(
        Result.fail('Firma produttore non riuscita', 'FIRMA_NON_RIUSCITA')
      )

      await expect(controller().emetti('f1', { firmaRentri: true }, USER)).rejects.toBeInstanceOf(
        BadRequestException
      )

      expect(firmaPartenza.dopoAzioneLocale).not.toHaveBeenCalled()
    })

    it('anche se lo use case di firma sollevasse, l emissione non si perde', async () => {
      firmaPartenza.dopoAzioneLocale.mockRejectedValue(new Error('imprevisto'))

      const r = await controller().emetti('f1', { firmaRentri: true }, USER)

      expect(r).toMatchObject({ id: 'f1', stato: 'EMESSO' })
      expect(r.firmaRentri).toMatchObject({ stato: 'DA_COMPLETARE' })
    })
  })

  describe('presaInCarico', () => {
    it('FIR non legato (flusso cartaceo): presa in carico locale come prima, nessuna chiamata all ente (non regressione)', async () => {
      const r = await controller().presaInCarico('f1', {}, USER)

      expect(presaInCarico.execute).toHaveBeenCalledTimes(1)
      expect(firmaPartenza.execute).not.toHaveBeenCalled()
      expect(r).not.toHaveProperty('firmaRentri')
    })

    it('FIR legato: la presa in carico locale e vietata, l azione e la firma di partenza (trasportatore)', async () => {
      firmaPartenza.tenantSeLegatoRentri.mockResolvedValue('T1')
      firmaPartenza.execute.mockResolvedValue({
        operazione: 'AcquisizioneFirmaTrasportatore',
        firma: { esito: 'COMPLETATA', statoFormulario: 'InserimentoAccettazione' },
      })

      const r = await controller().presaInCarico('f1', {}, USER)

      expect(presaInCarico.execute).not.toHaveBeenCalled()
      expect(firmaPartenza.execute).toHaveBeenCalledWith({
        firId: 'f1',
        tenantId: 'T1',
        utenteId: 'u1',
      })
      expect(r).toMatchObject({ stato: 'IN_TRANSITO' })
      expect(r.firmaRentri).toEqual({
        stato: 'COMPLETATA',
        statoFormulario: 'InserimentoAccettazione',
      })
    })

    it('FIR legato e firma in attesa del telefono: esito IN_ATTESA', async () => {
      firmaPartenza.tenantSeLegatoRentri.mockResolvedValue('T1')
      const scadenza = new Date()
      firmaPartenza.execute.mockResolvedValue({
        operazione: 'AcquisizioneFirmaTrasportatore',
        firma: {
          esito: 'IN_ATTESA',
          handle: 'h',
          sessioneId: 's2',
          scadenzaAutorizzazione: scadenza,
        },
      })

      const r = await controller().presaInCarico('f1', {}, USER)

      expect(r.firmaRentri).toEqual({ stato: 'IN_ATTESA', sessioneId: 's2', scadenza })
    })

    it('FIR legato ma l ente non chiede la firma: 409 con codice stabile, nessuna presa in carico locale', async () => {
      firmaPartenza.tenantSeLegatoRentri.mockResolvedValue('T1')
      firmaPartenza.execute.mockRejectedValue(
        DomainException.businessRuleViolation('FIRMA_PARTENZA_NON_DISPONIBILE', 'Mancano i dati.')
      )

      const errore = await controller()
        .presaInCarico('f1', {}, USER)
        .catch(e => e)

      expect(errore).toBeInstanceOf(ConflictException)
      expect(errore.getResponse()).toMatchObject({
        codice: 'FIRMA_PARTENZA_NON_DISPONIBILE',
        message: 'Mancano i dati.',
      })
      expect(presaInCarico.execute).not.toHaveBeenCalled()
    })
  })
})
