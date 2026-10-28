import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common'
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
      {} as any,
      {} as any,
      {} as any,
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
      {} as any,
      {} as any,
      {} as any,
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
      {} as any,
      {} as any,
      {} as any,
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
      {} as any,
      {} as any,
      {} as any,
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
      {} as any,
      {} as any,
      {} as any,
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
      {} as any,
      {} as any,
      {} as any,
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
    new RegistroController(
      {} as any,
      {} as any,
      servizio as any,
      membership,
      {} as any,
      {} as any,
      {} as any,
      {} as any
    )

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
      registri as any,
      {} as any,
      {} as any,
      {} as any
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

describe('RegistroController — giacenze iniziali (Fase 2 pezzo 2)', () => {
  const ID = '0b9f6c5e-3c1a-4a6e-9d63-6e8f1c7a1111'
  const VISTA = { id: ID, dataRiferimento: '2026-01-01' }
  // switch di azienda: il token è dello studio A, l'azienda selezionata è B
  const richiesta = (role = 'ADMIN') => ({
    tenantId: 'B',
    user: { id: 'user-1', tenantId: 'A', role },
  })
  const dtoCrea = {
    cerCode: '15 01 10*',
    quantita: 100,
    unita: 'KG',
    dataRiferimento: '2026-01-01',
  }

  let servizio: {
    elenca: jest.Mock
    crea: jest.Mock
    modifica: jest.Mock
    elimina: jest.Mock
  }
  const crea = (ruoloEffettivo: string, membership = ruoli(ruoloEffettivo)) =>
    new RegistroController(
      {} as any,
      {} as any,
      {} as any,
      membership,
      {} as any,
      servizio as any,
      {} as any,
      {} as any
    )

  beforeEach(() => {
    servizio = {
      elenca: jest.fn().mockResolvedValue({ registroId: 'r1', voci: [VISTA] }),
      crea: jest.fn().mockResolvedValue({ giacenza: VISTA, avvisi: [] }),
      modifica: jest.fn().mockResolvedValue({ giacenza: VISTA }),
      elimina: jest.fn().mockResolvedValue(undefined),
    }
  })

  it("GET legge sull'azienda selezionata e passa il registroId", async () => {
    const esito = await crea('VIEWER').elencaGiacenzeIniziali(richiesta('ADMIN'), {
      registroId: 'r1',
    })
    expect(servizio.elenca).toHaveBeenCalledWith('B', 'r1')
    expect(esito).toEqual({ registroId: 'r1', puoImpostare: false, voci: [VISTA] })
  })

  it('GET: puoImpostare segue il ruolo EFFETTIVO, non quello del token', async () => {
    for (const [effettivo, token, atteso] of [
      ['ADMIN', 'VIEWER', true],
      ['SUPER_ADMIN', 'OPERATOR', true],
      ['OPERATOR', 'ADMIN', false],
      ['VIEWER', 'ADMIN', false],
    ] as const) {
      const membership = ruoli(effettivo)
      const esito = await crea(effettivo, membership).elencaGiacenzeIniziali(richiesta(token))
      expect({ effettivo, puoImpostare: esito.puoImpostare }).toEqual({
        effettivo,
        puoImpostare: atteso,
      })
      expect(membership.ruoloEffettivo).toHaveBeenCalledWith(richiesta(token).user, 'B')
    }
  })

  it('GET: senza azienda determinabile rifiuta con 403', async () => {
    await expect(
      crea('ADMIN').elencaGiacenzeIniziali({ user: { id: 'u', role: 'ADMIN' } })
    ).rejects.toBeInstanceOf(ForbiddenException)
    expect(servizio.elenca).not.toHaveBeenCalled()
  })

  it("POST crea nell'azienda selezionata con l'utente e il registroId della query", async () => {
    const esito = await crea('ADMIN').creaGiacenzaIniziale(dtoCrea as any, richiesta('VIEWER'), {
      registroId: 'r1',
    })
    expect(servizio.crea).toHaveBeenCalledWith('B', 'user-1', dtoCrea, 'r1')
    expect(esito).toEqual({ giacenza: VISTA, avvisi: [] })
  })

  it("PUT e DELETE lavorano sull'azienda selezionata con l'id", async () => {
    const dtoModifica = { quantita: 5, unita: 'KG', dataRiferimento: '2026-01-01' }
    await crea('ADMIN').modificaGiacenzaIniziale(ID, dtoModifica as any, richiesta('VIEWER'))
    expect(servizio.modifica).toHaveBeenCalledWith('B', 'user-1', ID, dtoModifica)
    await crea('ADMIN').eliminaGiacenzaIniziale(ID, richiesta('VIEWER'))
    expect(servizio.elimina).toHaveBeenCalledWith('B', 'user-1', ID)
  })

  it('OPERATOR e VIEWER effettivi non scrivono (403) anche se ADMIN a casa, e il servizio non è chiamato', async () => {
    for (const ruoloEffettivo of ['OPERATOR', 'VIEWER']) {
      const c = crea(ruoloEffettivo)
      // ADMIN nel proprio studio (token), ma non nell'azienda selezionata
      const req = richiesta('ADMIN')
      const chiamate = [
        () => c.creaGiacenzaIniziale(dtoCrea as any, req),
        () => c.modificaGiacenzaIniziale(ID, dtoCrea as any, req),
        () => c.eliminaGiacenzaIniziale(ID, req),
      ]
      for (const chiama of chiamate) {
        const errore = await chiama().catch(e => e)
        expect(errore).toBeInstanceOf(ForbiddenException)
        expect(errore.getResponse()).toEqual({
          message:
            "Solo un amministratore dell'azienda può gestire le giacenze iniziali del registro.",
          error: 'REGISTRO_GIACENZA_INIZIALE_RISERVATA_AMMINISTRATORI',
        })
      }
    }
    expect(servizio.crea).not.toHaveBeenCalled()
    expect(servizio.modifica).not.toHaveBeenCalled()
    expect(servizio.elimina).not.toHaveBeenCalled()
  })

  it('senza azienda determinabile le scritture rifiutano con 403', async () => {
    const req = { user: { id: 'u', role: 'SUPER_ADMIN' } }
    const c = crea('SUPER_ADMIN')
    await expect(c.creaGiacenzaIniziale(dtoCrea as any, req)).rejects.toBeInstanceOf(
      ForbiddenException
    )
    await expect(c.eliminaGiacenzaIniziale(ID, req)).rejects.toBeInstanceOf(ForbiddenException)
    expect(servizio.crea).not.toHaveBeenCalled()
  })

  it('404 e 409 del servizio arrivano invariati al client', async () => {
    const c = crea('ADMIN')
    servizio.crea.mockRejectedValue(new NotFoundException('Registro non trovato.'))
    await expect(c.creaGiacenzaIniziale(dtoCrea as any, richiesta())).rejects.toBeInstanceOf(
      NotFoundException
    )
    servizio.modifica.mockRejectedValue(new ConflictException('usata'))
    await expect(
      c.modificaGiacenzaIniziale(ID, dtoCrea as any, richiesta())
    ).rejects.toBeInstanceOf(ConflictException)
    servizio.elimina.mockRejectedValue(new ConflictException('usata'))
    await expect(c.eliminaGiacenzaIniziale(ID, richiesta())).rejects.toBeInstanceOf(
      ConflictException
    )
    servizio.elenca.mockRejectedValue(new NotFoundException('Registro non trovato.'))
    await expect(
      c.elencaGiacenzeIniziali(richiesta(), { registroId: 'r-x' })
    ).rejects.toBeInstanceOf(NotFoundException)
  })
})

describe('RegistroController — correzioni e verifica catena (Fase 2 pezzo 3)', () => {
  const richiesta = { tenantId: 'azienda-1', user: { id: 'user-1', tenantId: 'tenant-token' } }
  let correggi: { rettifica: jest.Mock; annulla: jest.Mock }
  let verifica: { verifica: jest.Mock }
  let registri: { risolviInLettura: jest.Mock }

  const crea = (ruolo: string) =>
    new RegistroController(
      {} as any,
      {} as any,
      {} as any,
      ruoli(ruolo),
      registri as any,
      {} as any,
      correggi as any,
      verifica as any
    )

  beforeEach(() => {
    correggi = {
      rettifica: jest.fn().mockResolvedValue({ movimento: {}, avvisi: [] }),
      annulla: jest.fn().mockResolvedValue({ movimento: {}, avvisi: [] }),
    }
    verifica = {
      verifica: jest
        .fn()
        .mockResolvedValue({ verificate: 0, nonVerificabili: [], primoErrore: null }),
    }
    registri = { risolviInLettura: jest.fn().mockResolvedValue({ id: 'reg-1' }) }
  })

  const dto = {
    movementDate: '2026-03-11',
    causale: 'PRODUZIONE_INTERNA',
    cerCode: '20 03 01',
    quantity: 5,
    motivo: 'm',
    confermaAnnoPresentato: false,
  }

  it('rettifica: unità di default KG, data come Date, motivo e conferma fuori dai dati', async () => {
    await crea('OPERATOR').rettifica('mov-1', dto as any, richiesta)
    expect(correggi.rettifica).toHaveBeenCalledWith({
      tenantId: 'azienda-1',
      userId: 'user-1',
      movimentoId: 'mov-1',
      motivo: 'm',
      confermaAnnoPresentato: false,
      dati: {
        movementDate: new Date('2026-03-11'),
        causale: 'PRODUZIONE_INTERNA',
        cerCode: '20 03 01',
        quantity: 5,
        unit: 'KG',
      },
    })
  })

  it('rettifica: un unit esplicito è mantenuto', async () => {
    await crea('ADMIN').rettifica('mov-1', { ...dto, unit: 'T' } as any, richiesta)
    expect(correggi.rettifica.mock.calls[0][0].dati.unit).toBe('T')
  })

  it('VIEWER e CONSULTANT: 403 prima del caso d uso, su rettifica e annullamento', async () => {
    for (const ruolo of ['VIEWER', 'CONSULTANT']) {
      const c = crea(ruolo)
      await expect(c.rettifica('m', dto as any, richiesta)).rejects.toBeInstanceOf(
        ForbiddenException
      )
      await expect(c.annulla('m', { motivo: 'x' } as any, richiesta)).rejects.toBeInstanceOf(
        ForbiddenException
      )
    }
    expect(correggi.rettifica).not.toHaveBeenCalled()
    expect(correggi.annulla).not.toHaveBeenCalled()
  })

  it('senza azienda determinabile le correzioni rifiutano con 403', async () => {
    const senza = { user: { id: 'u', role: 'ADMIN' } }
    await expect(crea('ADMIN').annulla('m', { motivo: 'x' } as any, senza)).rejects.toBeInstanceOf(
      ForbiddenException
    )
    expect(correggi.annulla).not.toHaveBeenCalled()
  })

  it('le eccezioni del caso d uso passano invariate', async () => {
    const errore = new ConflictException({ error: 'REGISTRO_ANNO_MUD_PRESENTATO', message: 'x' })
    correggi.annulla.mockRejectedValue(errore)
    await expect(crea('ADMIN').annulla('m', { motivo: 'x' } as any, richiesta)).rejects.toBe(errore)
  })

  it('verifica-catena: solo SUPER_ADMIN e ADMIN', async () => {
    for (const ruolo of ['SUPER_ADMIN', 'ADMIN']) {
      await expect(
        crea(ruolo).verificaCatenaRegistro({ anno: 2026 } as any, richiesta)
      ).resolves.toMatchObject({ registroId: 'reg-1', anno: 2026, verificate: 0 })
    }
    for (const ruolo of ['OPERATOR', 'VIEWER', 'CONSULTANT']) {
      await expect(
        crea(ruolo).verificaCatenaRegistro({ anno: 2026 } as any, richiesta)
      ).rejects.toBeInstanceOf(ForbiddenException)
    }
    expect(verifica.verifica).toHaveBeenCalledTimes(2)
  })

  it('verifica-catena: errori di dominio del registro, 404 solo se il registroId era esplicito', async () => {
    const { RegistroNonTrovatoError } = jest.requireActual(
      '../../application/registro/registri.service'
    )
    registri.risolviInLettura.mockRejectedValue(new RegistroNonTrovatoError())
    await expect(
      crea('ADMIN').verificaCatenaRegistro({ anno: 2026, registroId: 'r' } as any, richiesta)
    ).rejects.toBeInstanceOf(NotFoundException)
    await expect(
      crea('ADMIN').verificaCatenaRegistro({ anno: 2026 } as any, richiesta)
    ).rejects.toBeInstanceOf(BadRequestException)
    registri.risolviInLettura.mockRejectedValue(new Error('guasto'))
    await expect(
      crea('ADMIN').verificaCatenaRegistro({ anno: 2026 } as any, richiesta)
    ).rejects.toThrow('guasto')
  })
})
