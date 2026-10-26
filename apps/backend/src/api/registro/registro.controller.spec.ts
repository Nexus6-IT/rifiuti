import { BadRequestException, ForbiddenException } from '@nestjs/common'
import { RegistroController } from './registro.controller'
import { Result } from '../../core/application/result'
import { RegistroDaIndicareError } from '../../application/registro/registri.service'
import type { CurrentUserPayload } from '../../auth/decorators/current-user.decorator'

/** Risoluzione del ruolo effettivo finta: restituisce sempre il ruolo indicato. */
const ruoli = (ruolo: string) => ({ ruoloEffettivo: jest.fn().mockResolvedValue(ruolo) }) as any

describe('RegistroController.registra — data di registrazione', () => {
  const utente: CurrentUserPayload = {
    id: 'user-1',
    email: 'operatore@example.com',
    tenantId: 'tenant-1',
    role: 'OPERATOR',
    permissions: [],
  }
  const dtoMinimo = {
    type: 'CARICO',
    movementDate: '2026-03-11',
    causale: 'PRODUZIONE_INTERNA',
    cerCode: '20 03 01',
    quantity: 100,
  }

  let useCase: { execute: jest.Mock }
  let controller: RegistroController

  beforeEach(() => {
    useCase = { execute: jest.fn() }
    controller = new RegistroController(
      useCase as any,
      {} as any,
      {} as any,
      ruoli('OPERATOR'),
      {} as any
    )
  })

  afterEach(() => {
    jest.useRealTimers()
  })

  it("ignora la data di registrazione del client e usa l'istante di adesso", async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-03-10T23:30:00Z')) // 00:30 dell'11/03 a Roma
    useCase.execute.mockResolvedValue(Result.ok({ id: 'm1' }))

    await controller.registra(
      { ...dtoMinimo, movementDate: '2026-03-11', registrationDate: '2025-01-01' } as any,
      { user: utente }
    )

    const comando = useCase.execute.mock.calls[0][0]
    expect(comando.registrationDate).toEqual(new Date('2026-03-10T23:30:00.000Z'))
    expect(comando.movementDate).toEqual(new Date('2026-03-11'))
  })

  it("senza data di registrazione nel corpo usa comunque l'istante di adesso", async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-03-12T08:15:00Z'))
    useCase.execute.mockResolvedValue(Result.ok({ id: 'm1' }))

    await controller.registra({ ...dtoMinimo } as any, { user: utente })

    expect(useCase.execute.mock.calls[0][0].registrationDate).toEqual(
      new Date('2026-03-12T08:15:00.000Z')
    )
  })

  it('un fallimento dello use case diventa 400 con il suo messaggio', async () => {
    useCase.execute.mockResolvedValue(Result.fail('Giacenza insufficiente'))

    await expect(controller.registra({ ...dtoMinimo } as any, { user: utente })).rejects.toThrow(
      new BadRequestException('Giacenza insufficiente')
    )
  })
})

describe('RegistroController.registra e lista — azienda selezionata e ruolo effettivo (F28)', () => {
  const dto = {
    type: 'CARICO',
    movementDate: '2026-03-11',
    causale: 'PRODUZIONE_INTERNA',
    cerCode: '20 03 01',
    quantity: 100,
  }
  // switch di azienda: il token resta sul tenant A, l'azienda selezionata è B
  const richiesta = (role: string) => ({
    tenantId: 'B',
    user: { id: 'user-1', tenantId: 'A', role },
  })

  let useCase: { execute: jest.Mock }
  let lista: { execute: jest.Mock }

  beforeEach(() => {
    useCase = { execute: jest.fn().mockResolvedValue(Result.ok({ id: 'm1' })) }
    lista = { execute: jest.fn().mockResolvedValue(Result.ok({ items: [] })) }
  })

  it("registra usa l'azienda selezionata, non il tenant del token", async () => {
    const membership = ruoli('OPERATOR')
    const controller = new RegistroController(
      useCase as any,
      lista as any,
      {} as any,
      membership,
      {} as any
    )

    await controller.registra(dto as any, richiesta('OPERATOR'))

    expect(useCase.execute.mock.calls[0][0].tenantId).toBe('B')
    expect(useCase.execute.mock.calls[0][0].userId).toBe('user-1')
    expect(membership.ruoloEffettivo).toHaveBeenCalledWith(richiesta('OPERATOR').user, 'B')
  })

  it("lista usa l'azienda selezionata", async () => {
    const controller = new RegistroController(
      useCase as any,
      lista as any,
      {} as any,
      ruoli('VIEWER'),
      {} as any
    )

    await controller.lista({ page: 1, limit: 20 } as any, richiesta('VIEWER'))

    expect(lista.execute.mock.calls[0][0].tenantId).toBe('B')
  })

  it("un VIEWER nell'azienda selezionata non registra (403) anche se è OPERATOR globale", async () => {
    const controller = new RegistroController(
      useCase as any,
      lista as any,
      {} as any,
      ruoli('VIEWER'),
      {} as any
    )

    const errore = await controller.registra(dto as any, richiesta('OPERATOR')).catch(e => e)

    expect(errore).toBeInstanceOf(ForbiddenException)
    expect(errore.getResponse()).toEqual({
      message: "Solo un amministratore o un operatore dell'azienda può registrare movimenti.",
      error: 'REGISTRO_RISERVATO_OPERATORI',
    })
    expect(useCase.execute).not.toHaveBeenCalled()
  })

  it("un OPERATOR nell'azienda selezionata registra anche se è VIEWER globale", async () => {
    const controller = new RegistroController(
      useCase as any,
      lista as any,
      {} as any,
      ruoli('OPERATOR'),
      {} as any
    )

    await expect(controller.registra(dto as any, richiesta('VIEWER'))).resolves.toEqual({
      id: 'm1',
    })
    expect(useCase.execute).toHaveBeenCalledTimes(1)
  })

  it('senza azienda determinabile non registra né elenca (403)', async () => {
    const controller = new RegistroController(
      useCase as any,
      lista as any,
      {} as any,
      ruoli('SUPER_ADMIN'),
      {} as any
    )
    const senzaAzienda = { user: { id: 'u', role: 'SUPER_ADMIN' } }

    await expect(controller.registra(dto as any, senzaAzienda)).rejects.toBeInstanceOf(
      ForbiddenException
    )
    await expect(controller.lista({} as any, senzaAzienda)).rejects.toBeInstanceOf(
      ForbiddenException
    )
    expect(useCase.execute).not.toHaveBeenCalled()
    expect(lista.execute).not.toHaveBeenCalled()
  })
})

describe('RegistroController — progressivo iniziale', () => {
  let servizio: { leggi: jest.Mock; imposta: jest.Mock }

  const richiesta = (role: string, tenantSelezionato?: string) => ({
    tenantId: tenantSelezionato,
    user: { id: 'user-1', tenantId: 'tenant-token', role },
  })
  const crea = (ruoloEffettivo: string, membership = ruoli(ruoloEffettivo)) =>
    new RegistroController({} as any, {} as any, servizio as any, membership, {} as any)

  beforeEach(() => {
    servizio = {
      leggi: jest.fn().mockResolvedValue({
        anno: 2026,
        primoProgressivo: null,
        impostatoIl: null,
        haMovimenti: false,
      }),
      imposta: jest.fn().mockResolvedValue({ anno: 2026, primoProgressivo: 812 }),
    }
  })

  it("legge sull'azienda selezionata, non su quella del token", async () => {
    await crea('ADMIN').leggiProgressivoIniziale(2026, richiesta('ADMIN', 'tenant-scelto'))
    expect(servizio.leggi).toHaveBeenCalledWith('tenant-scelto', 2026, undefined)
  })

  it("puoImpostare segue il ruolo effettivo nell'azienda selezionata, non quello del token", async () => {
    for (const [ruoloEffettivo, ruoloToken, atteso] of [
      ['ADMIN', 'VIEWER', true],
      ['SUPER_ADMIN', 'SUPER_ADMIN', true],
      ['OPERATOR', 'ADMIN', false],
      ['VIEWER', 'ADMIN', false],
    ] as const) {
      const membership = ruoli(ruoloEffettivo)
      const stato = await crea(ruoloEffettivo, membership).leggiProgressivoIniziale(
        2026,
        richiesta(ruoloToken, 't1')
      )
      expect({ ruoloEffettivo, puoImpostare: stato.puoImpostare }).toEqual({
        ruoloEffettivo,
        puoImpostare: atteso,
      })
      expect(membership.ruoloEffettivo).toHaveBeenCalledWith(richiesta(ruoloToken, 't1').user, 't1')
      expect(stato.haMovimenti).toBe(false)
    }
  })

  it('puoRegistrare dice al frontend se mostrare la registrazione, col ruolo effettivo', async () => {
    for (const [ruoloEffettivo, ruoloToken, atteso] of [
      ['OPERATOR', 'VIEWER', true],
      ['ADMIN', 'ADMIN', true],
      ['SUPER_ADMIN', 'SUPER_ADMIN', true],
      ['VIEWER', 'OPERATOR', false],
    ] as const) {
      const stato = await crea(ruoloEffettivo).leggiProgressivoIniziale(
        2026,
        richiesta(ruoloToken, 't1')
      )
      expect({ ruoloEffettivo, puoRegistrare: stato.puoRegistrare }).toEqual({
        ruoloEffettivo,
        puoRegistrare: atteso,
      })
    }
  })

  it("imposta sull'azienda selezionata con l'utente della richiesta", async () => {
    await expect(
      crea('ADMIN').impostaProgressivoIniziale(
        2026,
        { primoProgressivo: 812, motivo: 'Migrazione da WinWaste' },
        richiesta('VIEWER', 'tenant-scelto')
      )
    ).resolves.toEqual({ anno: 2026, primoProgressivo: 812 })
    expect(servizio.imposta).toHaveBeenCalledWith(
      'tenant-scelto',
      2026,
      812,
      'Migrazione da WinWaste',
      'user-1',
      undefined
    )
  })

  it('il PUT del progressivo iniziale richiede un amministratore effettivo', async () => {
    for (const ruoloEffettivo of ['OPERATOR', 'VIEWER']) {
      const errore = await crea(ruoloEffettivo)
        .impostaProgressivoIniziale(
          2026,
          { primoProgressivo: 812, motivo: 'Migrazione' },
          // ADMIN del proprio studio, ma non nell'azienda selezionata
          richiesta('ADMIN', 'tenant-cliente')
        )
        .catch(e => e)
      expect(errore).toBeInstanceOf(ForbiddenException)
      expect(errore.getResponse()).toEqual({
        message:
          "Solo un amministratore dell'azienda può impostare il progressivo iniziale del registro.",
        error: 'REGISTRO_PROGRESSIVO_RISERVATO_AMMINISTRATORI',
      })
    }
    expect(servizio.imposta).not.toHaveBeenCalled()
  })

  it('senza azienda determinabile rifiuta con 403', async () => {
    await expect(
      crea('SUPER_ADMIN').impostaProgressivoIniziale(
        2026,
        { primoProgressivo: 812, motivo: 'Migrazione' },
        { user: { id: 'u', role: 'SUPER_ADMIN' } }
      )
    ).rejects.toBeInstanceOf(ForbiddenException)
    expect(servizio.imposta).not.toHaveBeenCalled()
  })
})

describe('RegistroController — registri (Fase 2 pezzo 1)', () => {
  const dto = {
    type: 'CARICO',
    movementDate: '2026-03-11',
    causale: 'PRODUZIONE_INTERNA',
    cerCode: '20 03 01',
    quantity: 100,
  }
  const richiesta = { tenantId: 'B', user: { id: 'user-1', tenantId: 'A', role: 'OPERATOR' } }
  const REGISTRO = {
    id: 'r1',
    unitaLocaleId: 'ul-1',
    numIscrSito: 'OP1234ABC123456-RM1234',
    denominazione: 'Sede',
    codice: 'CARICO_SCARICO',
    attivo: true,
    principale: true,
  }

  let useCase: { execute: jest.Mock }
  let lista: { execute: jest.Mock }
  let progressivo: { leggi: jest.Mock; imposta: jest.Mock }
  let registri: { elenca: jest.Mock; assicuraRegistri: jest.Mock }
  const crea = (ruolo: string) =>
    new RegistroController(
      useCase as any,
      lista as any,
      progressivo as any,
      ruoli(ruolo),
      registri as any
    )

  beforeEach(() => {
    useCase = { execute: jest.fn().mockResolvedValue(Result.ok({ id: 'm1' })) }
    lista = { execute: jest.fn().mockResolvedValue(Result.ok({ items: [] })) }
    progressivo = {
      leggi: jest.fn().mockResolvedValue({ anno: 2026 }),
      imposta: jest.fn().mockResolvedValue({ anno: 2026, primoProgressivo: 5, registroId: 'r1' }),
    }
    registri = {
      elenca: jest.fn().mockResolvedValue([REGISTRO]),
      assicuraRegistri: jest.fn().mockResolvedValue([REGISTRO]),
    }
  })

  it('registro controller: POST senza registroId lo passa undefined al comando; con registroId lo passa', async () => {
    await crea('OPERATOR').registra(dto as any, richiesta)
    expect(useCase.execute.mock.calls[0][0].registroId).toBeUndefined()

    await crea('OPERATOR').registra(
      { ...dto, registroId: '11111111-1111-4111-8111-111111111111' } as any,
      richiesta
    )
    expect(useCase.execute.mock.calls[1][0].registroId).toBe('11111111-1111-4111-8111-111111111111')
  })

  it('registro controller: GET lista passa il filtro registroId alla query', async () => {
    await crea('VIEWER').lista(
      { registroId: '11111111-1111-4111-8111-111111111111' } as any,
      richiesta
    )
    expect(lista.execute.mock.calls[0][0].filters.registroId).toBe(
      '11111111-1111-4111-8111-111111111111'
    )
  })

  it("registro controller: GET registri restituisce i registri dell'azienda selezionata e non scrive", async () => {
    const risultato = await crea('VIEWER').elencaRegistri(richiesta)

    expect(risultato).toEqual([REGISTRO])
    expect(registri.elenca).toHaveBeenCalledWith('B')
    expect(registri.assicuraRegistri).not.toHaveBeenCalled()
  })

  it('registro controller: POST registri/assicura è negato a un ruolo di sola lettura', async () => {
    const errore = await crea('VIEWER')
      .assicuraRegistri(richiesta)
      .catch(e => e)

    expect(errore).toBeInstanceOf(ForbiddenException)
    expect(errore.getResponse()).toMatchObject({ error: 'REGISTRO_RISERVATO_OPERATORI' })
    expect(registri.assicuraRegistri).not.toHaveBeenCalled()
  })

  it("registro controller: POST registri/assicura per un operatore lavora sull'azienda selezionata", async () => {
    const risultato = await crea('OPERATOR').assicuraRegistri(richiesta)

    expect(risultato).toEqual([REGISTRO])
    expect(registri.assicuraRegistri).toHaveBeenCalledWith('B')
  })

  it('registro controller: un errore di dominio dei registri diventa 400 col suo messaggio', async () => {
    registri.assicuraRegistri.mockRejectedValue(new RegistroDaIndicareError())

    await expect(crea('OPERATOR').assicuraRegistri(richiesta)).rejects.toThrow(
      new BadRequestException(new RegistroDaIndicareError().message)
    )
  })

  it('registro controller: il progressivo iniziale legge e imposta sul registro indicato', async () => {
    const registroId = '11111111-1111-4111-8111-111111111111'
    await crea('ADMIN').leggiProgressivoIniziale(2026, richiesta, { registroId })
    expect(progressivo.leggi).toHaveBeenCalledWith('B', 2026, registroId)

    await crea('ADMIN').impostaProgressivoIniziale(
      2026,
      { primoProgressivo: 5, motivo: 'migrazione' },
      richiesta,
      { registroId }
    )
    expect(progressivo.imposta).toHaveBeenCalledWith(
      'B',
      2026,
      5,
      'migrazione',
      'user-1',
      registroId
    )
  })
})
