import { Prisma } from '@prisma/client'
import { StrumentiPesaService } from './strumenti-pesa.service'
import {
  DatiPesaNonValidiError,
  StrumentoDuplicatoError,
  StrumentoNonTrovatoError,
} from './errori-pese'
import { RegistroNonTrovatoError } from '../registro/registri.service'

const T = 'aaaaaaaa-0000-4000-8000-000000000001'
const U = 'bbbbbbbb-0000-4000-8000-000000000002'
const S = 'cccccccc-0000-4000-8000-000000000003'
const R = 'dddddddd-0000-4000-8000-000000000004'

const riga = (extra: Record<string, unknown> = {}) => ({
  id: S,
  tenantId: T,
  registroId: null,
  descrizione: 'Pesa a ponte',
  costruttore: null,
  modello: null,
  matricola: null,
  portataMaxKg: new Prisma.Decimal('60000'),
  divisioneKg: new Prisma.Decimal('20'),
  dataUltimaVerificazione: new Date('2026-03-10T00:00:00Z'),
  attivo: true,
  ...extra,
})

describe('StrumentiPesaService (Prisma finto)', () => {
  let tx: any
  let service: StrumentiPesaService
  const dati = { descrizione: '  Pesa a ponte ', portataMaxKg: 60000, divisioneKg: 20 }

  beforeEach(() => {
    tx = {
      strumentoPesa: {
        findFirst: jest.fn().mockResolvedValue(null),
        findMany: jest.fn().mockResolvedValue([riga()]),
        create: jest.fn(async ({ data }: any) => riga(data)),
        update: jest.fn(async ({ data }: any) => riga(data)),
      },
      registroRifiuti: { findFirst: jest.fn().mockResolvedValue({ id: R }) },
      activityLog: { create: jest.fn().mockResolvedValue({}) },
    }
    service = new StrumentiPesaService({ $transaction: (fn: any) => fn(tx), ...tx } as any)
  })

  it('crea: descrizione ripulita, audit PESA_STRUMENTO_SALVATO', async () => {
    const v = await service.crea(T, U, dati)

    expect(tx.strumentoPesa.create.mock.calls[0][0].data).toMatchObject({
      tenantId: T,
      descrizione: 'Pesa a ponte',
      creatoDa: U,
    })
    expect(tx.activityLog.create.mock.calls[0][0].data.action).toBe('PESA_STRUMENTO_SALVATO')
    expect(v.portataMaxKg).toBe(60000)
  })

  it.each([0, -1, NaN])('portata %p: 400', async portata => {
    await expect(service.crea(T, U, { ...dati, portataMaxKg: portata })).rejects.toThrow(
      DatiPesaNonValidiError
    )
    expect(tx.strumentoPesa.create).not.toHaveBeenCalled()
  })

  it('divisione ≤ 0, descrizione vuota, data impossibile: 400 con tutti i messaggi', async () => {
    const esito = service.crea(T, U, {
      descrizione: '  ',
      divisioneKg: 0,
      dataUltimaVerificazione: '2026-02-31',
    })

    await expect(esito).rejects.toMatchObject({
      messaggi: expect.arrayContaining([
        'La descrizione è obbligatoria.',
        'La divisione deve essere maggiore di zero.',
        'La data dell’ultima verificazione non è valida.',
      ]),
    })
  })

  it('registro di un’altra azienda: RegistroNonTrovatoError', async () => {
    tx.registroRifiuti.findFirst.mockResolvedValue(null)

    await expect(service.crea(T, U, { ...dati, registroId: R })).rejects.toThrow(
      RegistroNonTrovatoError
    )
  })

  it('matricola già presente (P2002): 409', async () => {
    tx.strumentoPesa.create.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('x', { code: 'P2002', clientVersion: 'x' })
    )

    await expect(service.crea(T, U, { ...dati, matricola: 'M1' })).rejects.toThrow(
      StrumentoDuplicatoError
    )
  })

  it('aggiorna: strumento assente 404; presente salva e registra', async () => {
    await expect(service.aggiorna(T, U, S, dati)).rejects.toThrow(StrumentoNonTrovatoError)

    tx.strumentoPesa.findFirst.mockResolvedValue(riga())
    await service.aggiorna(T, U, S, { ...dati, attivo: false })
    expect(tx.strumentoPesa.update.mock.calls[0][0].data.attivo).toBe(false)
    expect(tx.activityLog.create).toHaveBeenCalledTimes(1)
  })

  it('elenca: viste con numeri e data ISO', async () => {
    const [v] = await service.elenca(T)

    expect(v).toMatchObject({
      portataMaxKg: 60000,
      divisioneKg: 20,
      dataUltimaVerificazione: '2026-03-10',
    })
  })

  it('leggiPerPesata: assente → StrumentoNonTrovatoError', async () => {
    await expect(service.leggiPerPesata(tx, T, S)).rejects.toThrow(StrumentoNonTrovatoError)
  })
})
