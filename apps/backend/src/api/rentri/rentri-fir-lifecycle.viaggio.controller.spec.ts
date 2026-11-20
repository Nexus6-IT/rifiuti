import { BadRequestException, ConflictException, ForbiddenException } from '@nestjs/common'
import { validate } from 'class-validator'
import { plainToInstance } from 'class-transformer'
import { RentriFirLifecycleController } from './rentri-fir-lifecycle.controller'
import { InviaQuantitaFirRentriDto } from './dto/invia-quantita-fir-rentri.dto'
import { InviaTrasportoFirRentriDto } from './dto/invia-trasporto-fir-rentri.dto'
import { DomainException } from '../../domain/shared/domain-exception'

/**
 * FIR in viaggio P2, T4 — rotte `quantita`, `trasporto`, `eventi`: ruolo effettivo, passaggio di utente e
 * azienda selezionata, mappatura degli errori (400 con `codice`, 409), validazione dei DTO.
 */
describe('RentriFirLifecycleController — quantita, trasporto, eventi', () => {
  const REQ = { user: { id: 'u1', role: 'ADMIN', tenantId: 'A' } }
  const ruolo = { ruoloEffettivo: jest.fn() }
  const viaggio = { inviaQuantita: jest.fn(), inviaTrasporto: jest.fn() }
  const eventi = { execute: jest.fn() }
  const ultimo = { execute: jest.fn() }
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
      viaggio as any,
      eventi as any,
      ultimo as any,
      {} as any, // FirmaPartenzaRentriUseCase
      {} as any, // AnnotazioneRentriUseCase
      {} as any // SostaTecnicaRentriUseCase
    )
  })

  it('quantita: passa azienda selezionata, utente e campi allo use case', async () => {
    viaggio.inviaQuantita.mockResolvedValue({ operazione: 'DatiQuantita', statoFormulario: 'X' })
    const dto = Object.assign(new InviaQuantitaFirRentriDto(), {
      quantita: 12.5,
      unitaMisura: 'kg',
      numeroColli: 2,
      verificatoInPartenza: true,
    })
    const r = await controller.inviaQuantita('f1', dto, 'B', 'u1', REQ)
    expect(r.operazione).toBe('DatiQuantita')
    expect(viaggio.inviaQuantita).toHaveBeenCalledWith(
      expect.objectContaining({
        firId: 'f1',
        tenantId: 'B',
        utenteId: 'u1',
        quantita: 12.5,
        unitaMisura: 'kg',
        numeroColli: 2,
        verificatoInPartenza: true,
      })
    )
    expect(ruolo.ruoloEffettivo).toHaveBeenCalledWith(REQ.user, 'B')
  })

  it('trasporto: la data ISO diventa Date, senza data resta undefined', async () => {
    viaggio.inviaTrasporto.mockResolvedValue({ operazione: 'Trasporto', statoFormulario: null })
    const base = { conducenteNome: 'Mario', conducenteCognome: 'Rossi', targaAutomezzo: 'AB123CD' }
    await controller.inviaTrasporto(
      'f1',
      Object.assign(new InviaTrasportoFirRentriDto(), {
        ...base,
        dataOraInizioTrasporto: '2026-11-21T07:00:00Z',
      }),
      'B',
      'u1',
      REQ
    )
    await controller.inviaTrasporto(
      'f1',
      Object.assign(new InviaTrasportoFirRentriDto(), base),
      'B',
      'u1',
      REQ
    )
    expect(viaggio.inviaTrasporto.mock.calls[0][0].dataOraInizioTrasporto).toEqual(
      new Date('2026-11-21T07:00:00Z')
    )
    expect(viaggio.inviaTrasporto.mock.calls[1][0].dataOraInizioTrasporto).toBeUndefined()
  })

  it.each([
    ['quantita', () => controller.inviaQuantita('f', {} as any, 'B', 'u1', REQ), 'inviaQuantita'],
    [
      'trasporto',
      () => controller.inviaTrasporto('f', {} as any, 'B', 'u1', REQ),
      'inviaTrasporto',
    ],
  ])(
    "%s: consulente VIEWER nell'azienda selezionata -> 403, nessuna scrittura",
    async (_n, chiama, metodo) => {
      ruolo.ruoloEffettivo.mockResolvedValue('VIEWER')
      await expect(chiama()).rejects.toBeInstanceOf(ForbiddenException)
      expect((viaggio as any)[metodo]).not.toHaveBeenCalled()
    }
  )

  it('OPERAZIONE_NON_DISPONIBILE -> 409 con codice stabile', async () => {
    viaggio.inviaQuantita.mockRejectedValue(
      DomainException.businessRuleViolation('OPERAZIONE_NON_DISPONIBILE', 'Non ora.')
    )
    const errore = await controller.inviaQuantita('f', {} as any, 'B', 'u1', REQ).catch(e => e)
    expect(errore).toBeInstanceOf(ConflictException)
    expect(errore.getResponse()).toMatchObject({ codice: 'OPERAZIONE_NON_DISPONIBILE' })
  })

  it.each([
    'DATI_VIAGGIO_NON_VALIDI',
    'TRASPORTO_NON_TERRESTRE',
    'QUANTITA_RENTRI_RIFIUTATA',
    'TRASPORTO_RENTRI_RIFIUTATO',
  ])("%s -> 400 con codice e messaggio per l'utente, senza prefisso tecnico", async rule => {
    viaggio.inviaTrasporto.mockRejectedValue(
      DomainException.businessRuleViolation(rule, 'Controlla la targa.')
    )
    const errore = await controller.inviaTrasporto('f', {} as any, 'B', 'u1', REQ).catch(e => e)
    expect(errore).toBeInstanceOf(BadRequestException)
    expect(errore.getResponse()).toEqual({
      statusCode: 400,
      codice: rule,
      message: 'Controlla la targa.',
    })
  })

  it('eventi: lettura per azienda selezionata, anche senza controllo del ruolo di scrittura', async () => {
    eventi.execute.mockResolvedValue([{ id: 'e1' }])
    const r = await controller.elencaEventi('f1', 'B')
    expect(r).toEqual({ eventi: [{ id: 'e1' }] })
    expect(eventi.execute).toHaveBeenCalledWith('f1', 'B')
    expect(ruolo.ruoloEffettivo).not.toHaveBeenCalled()
  })

  it("ultimo-trasporto: cerca per targa nell'azienda selezionata", async () => {
    ultimo.execute.mockResolvedValue({ conducenteNome: 'Mario' })
    const r = await controller.ultimoTrasporto('ab123cd', 'B')
    expect(r).toEqual({ trasporto: { conducenteNome: 'Mario' } })
    expect(ultimo.execute).toHaveBeenCalledWith('B', 'ab123cd')
    ultimo.execute.mockClear()
    await controller.ultimoTrasporto(undefined as any, 'B')
    expect(ultimo.execute).toHaveBeenCalledWith('B', '')
  })

  describe('validazione dei DTO', () => {
    const errori = async (cls: any, dati: object) =>
      (await validate(plainToInstance(cls, dati))).map(e => e.property).sort()

    it("quantita: positiva, max 2 decimali, unita' del dominio", async () => {
      expect(await errori(InviaQuantitaFirRentriDto, { quantita: 10, unitaMisura: 'kg' })).toEqual(
        []
      )
      expect(await errori(InviaQuantitaFirRentriDto, { quantita: 0, unitaMisura: 'kg' })).toEqual([
        'quantita',
      ])
      expect(
        await errori(InviaQuantitaFirRentriDto, { quantita: 1.234, unitaMisura: 'kg' })
      ).toEqual(['quantita'])
      expect(
        await errori(InviaQuantitaFirRentriDto, { quantita: 5, unitaMisura: 'barili' })
      ).toEqual(['unitaMisura'])
      expect(
        await errori(InviaQuantitaFirRentriDto, { quantita: 5, unitaMisura: 'kg', numeroColli: 0 })
      ).toEqual(['numeroColli'])
    })

    it('trasporto: conducente obbligatorio, targa e rimorchio max 10, percorso max 250', async () => {
      const ok = { conducenteNome: 'Mario', conducenteCognome: 'Rossi', targaAutomezzo: 'AB123CD' }
      expect(await errori(InviaTrasportoFirRentriDto, ok)).toEqual([])
      expect(await errori(InviaTrasportoFirRentriDto, { ...ok, conducenteNome: '' })).toEqual([
        'conducenteNome',
      ])
      expect(
        await errori(InviaTrasportoFirRentriDto, { ...ok, conducenteCognome: undefined })
      ).toEqual(['conducenteCognome'])
      expect(
        await errori(InviaTrasportoFirRentriDto, { ...ok, targaAutomezzo: 'ABCDEFGHIJK' })
      ).toEqual(['targaAutomezzo'])
      expect(
        await errori(InviaTrasportoFirRentriDto, { ...ok, targaRimorchio: 'ABCDEFGHIJK' })
      ).toEqual(['targaRimorchio'])
      expect(
        await errori(InviaTrasportoFirRentriDto, { ...ok, percorso: 'p'.repeat(251) })
      ).toEqual(['percorso'])
      expect(
        await errori(InviaTrasportoFirRentriDto, { ...ok, dataOraInizioTrasporto: 'ieri' })
      ).toEqual(['dataOraInizioTrasporto'])
    })
  })
})
