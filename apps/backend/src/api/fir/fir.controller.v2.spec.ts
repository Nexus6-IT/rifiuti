import { BadRequestException, ForbiddenException, ValidationPipe } from '@nestjs/common'
import { ConfermaConsegnaFIRDto, FIRControllerV2 } from './fir.controller.v2'
import { ROLES_KEY } from '../../auth/decorators/roles.decorator'
import { Result } from '../../core/application/result'
import { FIRResponseDto } from './dtos/fir-response.dto'
import { FirNonModificabileError } from '../../core/domain/errors'

/** Risoluzione del ruolo effettivo finta: restituisce sempre il ruolo indicato. */
const ruoli = (ruolo: string) => ({ ruoloEffettivo: jest.fn().mockResolvedValue(ruolo) }) as any

/**
 * I FIR seguono l'azienda selezionata come il registro (I1 della revisione finale): il
 * picker FIR del registro chiama `GET /fir`, e un FIR creato con un cliente selezionato
 * deve finire nel cliente, non nello studio del consulente.
 *
 * Il controller riceveva già l'azienda attiva dal `CurrentUser` di `auth/decorators`: i test
 * sono una guardia contro regressioni, non la prova di un difetto.
 */
describe('FIRControllerV2 — azienda selezionata e ruolo effettivo', () => {
  // switch di azienda: il token resta sul tenant A (studio), l'azienda selezionata è B
  const richiesta = (role: string, tenantId: string | undefined = 'B') => ({
    tenantId,
    user: { id: 'user-1', email: 'c@example.com', tenantId: 'A', role },
  })
  const dtoCrea = {
    produttoreId: 'p1',
    rifiuto: { cerCode: '20 03 01', quantita: 100, unitaMisura: 'KG', statoFisico: 'Solido' },
    trasportatoreId: 't1',
    destinatarioId: 'd1',
    provenienza: 'SPECIALE',
    tipoTrattaPrincipale: 'TERRESTRE',
  }

  let crea: { execute: jest.Mock }
  let lista: { execute: jest.Mock }
  let dettaglio: { execute: jest.Mock }
  let modifica: { execute: jest.Mock }
  let enforcement: { assertNotSuspended: jest.Mock; assertFirLimitNotReached: jest.Mock }

  const controller = (membership = ruoli('OPERATOR')) =>
    new FIRControllerV2(
      crea as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      dettaglio as any,
      lista as any,
      enforcement as any,
      membership,
      modifica as any,
      {} as any
    )

  beforeEach(() => {
    jest.spyOn(FIRResponseDto, 'fromDomain').mockImplementation((fir: any) => fir)
    crea = { execute: jest.fn().mockResolvedValue(Result.ok({ id: 'f1' })) }
    lista = {
      execute: jest
        .fn()
        .mockResolvedValue(Result.ok({ items: [], total: 0, page: 1, limit: 10, totalPages: 0 })),
    }
    modifica = { execute: jest.fn().mockResolvedValue(Result.ok({ id: 'f1' })) }
    dettaglio = { execute: jest.fn().mockResolvedValue(Result.ok({ id: 'f1' })) }
    enforcement = {
      assertNotSuspended: jest.fn().mockResolvedValue(undefined),
      assertFirLimitNotReached: jest.fn().mockResolvedValue(undefined),
    }
  })

  afterEach(() => jest.restoreAllMocks())

  it("la lista legge i FIR dell'azienda selezionata, non del tenant del token", async () => {
    await controller(ruoli('VIEWER')).list({} as any, richiesta('VIEWER') as any)

    expect(lista.execute.mock.calls[0][0].tenantId).toBe('B')
    expect(lista.execute.mock.calls[0][0].userId).toBe('user-1')
  })

  it("il dettaglio cerca il FIR nell'azienda selezionata", async () => {
    await controller(ruoli('VIEWER')).getById('f1', richiesta('VIEWER') as any)

    expect(dettaglio.execute.mock.calls[0][0].tenantId).toBe('B')
    expect(dettaglio.execute.mock.calls[0][0].firId).toBe('f1')
  })

  it("la creazione scrive nell'azienda selezionata e vi controlla abbonamento e limite", async () => {
    const membership = ruoli('OPERATOR')

    await controller(membership).create(dtoCrea as any, richiesta('ADMIN') as any)

    expect(crea.execute.mock.calls[0][0].tenantId).toBe('B')
    expect(crea.execute.mock.calls[0][0].userId).toBe('user-1')
    expect(enforcement.assertNotSuspended).toHaveBeenCalledWith('B')
    expect(enforcement.assertFirLimitNotReached).toHaveBeenCalledWith('B')
    expect(membership.ruoloEffettivo).toHaveBeenCalledWith(richiesta('ADMIN').user, 'B')
  })

  it("un consulente in sola consultazione nell'azienda selezionata non crea FIR (403)", async () => {
    const errore = await controller(ruoli('VIEWER'))
      .create(dtoCrea as any, richiesta('ADMIN') as any)
      .catch(e => e)

    expect(errore).toBeInstanceOf(ForbiddenException)
    expect(errore.getResponse()).toEqual({
      message: "Solo un amministratore o un operatore dell'azienda può creare o modificare FIR.",
      error: 'FIR_RISERVATO_OPERATORI',
    })
    expect(crea.execute).not.toHaveBeenCalled()
  })

  it("un OPERATOR nell'azienda selezionata crea anche se è VIEWER nel tenant del token", async () => {
    await expect(
      controller(ruoli('OPERATOR')).create(dtoCrea as any, richiesta('VIEWER') as any)
    ).resolves.toEqual({ id: 'f1' })
  })

  it('la creazione non dipende più da @Roles, che vede solo il ruolo del token', () => {
    expect(Reflect.getMetadata(ROLES_KEY, FIRControllerV2.prototype.create)).toBeUndefined()
  })

  const dtoModifica = { ...dtoCrea, versione: 3 }

  it("la modifica opera nell'azienda selezionata con l'utente del token e controlla la sospensione", async () => {
    const membership = ruoli('OPERATOR')

    await controller(membership).modifica('f1', dtoModifica as any, richiesta('ADMIN') as any)

    const comando = modifica.execute.mock.calls[0][0]
    expect(comando).toMatchObject({ firId: 'f1', tenantId: 'B', userId: 'user-1', versione: 3 })
    expect(enforcement.assertNotSuspended).toHaveBeenCalledWith('B')
    expect(enforcement.assertFirLimitNotReached).not.toHaveBeenCalled()
    expect(membership.ruoloEffettivo).toHaveBeenCalledWith(richiesta('ADMIN').user, 'B')
  })

  it("la modifica con ruolo VIEWER nell'azienda selezionata e' 403 anche se il token dice ADMIN", async () => {
    const errore = await controller(ruoli('VIEWER'))
      .modifica('f1', dtoModifica as any, richiesta('ADMIN') as any)
      .catch(e => e)

    expect(errore).toBeInstanceOf(ForbiddenException)
    expect(errore.getResponse().error).toBe('FIR_RISERVATO_OPERATORI')
    expect(modifica.execute).not.toHaveBeenCalled()
  })

  it('la modifica con azienda sospesa non arriva al caso d uso', async () => {
    enforcement.assertNotSuspended.mockRejectedValue(new Error('sospesa'))

    await expect(
      controller().modifica('f1', dtoModifica as any, richiesta('ADMIN') as any)
    ).rejects.toThrow('sospesa')
    expect(modifica.execute).not.toHaveBeenCalled()
  })

  it('Result.fail della modifica diventa 400; gli errori di dominio passano invariati', async () => {
    modifica.execute.mockResolvedValueOnce(Result.fail('CER non valido'))
    await expect(
      controller().modifica('f1', dtoModifica as any, richiesta('ADMIN') as any)
    ).rejects.toBeInstanceOf(BadRequestException)

    const dominio = new FirNonModificabileError('FIRMATO')
    modifica.execute.mockRejectedValueOnce(dominio)
    await expect(
      controller().modifica('f1', dtoModifica as any, richiesta('ADMIN') as any)
    ).rejects.toBe(dominio)
  })

  it("un utente sulla propria azienda primaria resta com'era", async () => {
    const primaria = richiesta('OPERATOR', 'A')

    await controller(ruoli('OPERATOR')).create(dtoCrea as any, primaria as any)
    await controller(ruoli('OPERATOR')).list({} as any, primaria as any)

    expect(crea.execute.mock.calls[0][0].tenantId).toBe('A')
    expect(lista.execute.mock.calls[0][0].tenantId).toBe('A')
  })

  it('senza azienda determinabile non elenca, non legge e non crea (403)', async () => {
    const senzaAzienda = { user: { id: 'u', role: 'SUPER_ADMIN' } } as any
    const c = controller(ruoli('SUPER_ADMIN'))

    await expect(c.list({} as any, senzaAzienda)).rejects.toBeInstanceOf(ForbiddenException)
    await expect(c.getById('f1', senzaAzienda)).rejects.toBeInstanceOf(ForbiddenException)
    await expect(c.create(dtoCrea as any, senzaAzienda)).rejects.toBeInstanceOf(ForbiddenException)
    expect(lista.execute).not.toHaveBeenCalled()
    expect(dettaglio.execute).not.toHaveBeenCalled()
    expect(crea.execute).not.toHaveBeenCalled()
  })
})

/**
 * F2-7: il peso verificato a destino non ha più tolleranza, ma il DTO deve rispettare la colonna
 * `effective_weight Decimal(10,2)`. Test con la pipe vera, come in main.ts.
 */
describe('ConfermaConsegnaFIRDto — validazione con la pipe vera', () => {
  const pipe = new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true })
  const valida = (body: unknown) =>
    pipe.transform(body, { type: 'body', metatype: ConfermaConsegnaFIRDto })

  it.each([0.01, 1, 150.5, 99999999.99])('accetta %s', async pesoEffettivo => {
    await expect(valida({ pesoEffettivo })).resolves.toMatchObject({ pesoEffettivo })
  })

  it('rifiuta 3 decimali', async () => {
    await expect(valida({ pesoEffettivo: 10.123 })).rejects.toBeInstanceOf(BadRequestException)
  })

  it('rifiuta un valore oltre il massimo della colonna', async () => {
    await expect(valida({ pesoEffettivo: 100000000 })).rejects.toBeInstanceOf(BadRequestException)
  })

  it.each([0, -1, '12', null])('rifiuta %p', async pesoEffettivo => {
    await expect(valida({ pesoEffettivo })).rejects.toBeInstanceOf(BadRequestException)
  })
})
