import { Prisma } from '@prisma/client'
import { AutomezziService } from './automezzi.service'
import {
  AutomezzoDuplicatoError,
  AutomezzoNonTrovatoError,
  DatiPesaNonValidiError,
  PesataNonTrovataError,
  RegolaPesataError,
  TrasportatoreNonTrovatoError,
} from './errori-pese'

const T = 'aaaaaaaa-0000-4000-8000-000000000001'
const U = 'bbbbbbbb-0000-4000-8000-000000000002'
const A = 'cccccccc-0000-4000-8000-000000000003'
const P = 'dddddddd-0000-4000-8000-000000000004'
const TR = 'eeeeeeee-0000-4000-8000-000000000005'

const riga = (extra: Record<string, unknown> = {}) => ({
  id: A,
  tenantId: T,
  targa: 'AB123CD',
  targaRimorchio: null,
  trasportatoreId: null,
  taraKg: null,
  taraOrigine: null,
  taraPesataId: null,
  taraAggiornataIl: null,
  ultimaPesataVuotoIl: null,
  note: null,
  attivo: true,
  ...extra,
})

describe('AutomezziService (Prisma finto)', () => {
  let tx: any
  let service: AutomezziService

  beforeEach(() => {
    tx = {
      $executeRaw: jest.fn().mockResolvedValue(1),
      automezzo: {
        findFirst: jest.fn().mockResolvedValue(null),
        findMany: jest.fn().mockResolvedValue([]),
        create: jest.fn(async ({ data }: any) => riga(data)),
        update: jest.fn(async ({ data }: any) => riga(data)),
      },
      trasportatore: { findFirst: jest.fn().mockResolvedValue({ id: TR }) },
      pesata: { findFirst: jest.fn() },
      activityLog: { create: jest.fn().mockResolvedValue({}) },
    }
    const prisma: any = { $transaction: (fn: any) => fn(tx), ...tx }
    service = new AutomezziService(prisma)
  })

  describe('crea', () => {
    it('normalizza targa e rimorchio prima di salvare', async () => {
      await service.crea(T, U, { targa: 'ab 123-cd', targaRimorchio: 'xy.99' })

      const data = tx.automezzo.create.mock.calls[0][0].data
      expect(data).toMatchObject({
        tenantId: T,
        targa: 'AB123CD',
        targaRimorchio: 'XY99',
        creatoDa: U,
      })
      expect(tx.activityLog.create).toHaveBeenCalledTimes(1)
    })

    it('targa non valida: 400 "Targa non valida."', async () => {
      await expect(service.crea(T, U, { targa: '!' })).rejects.toThrow(DatiPesaNonValidiError)
      await expect(service.crea(T, U, { targa: '!' })).rejects.toThrow('Targa non valida.')
      expect(tx.automezzo.create).not.toHaveBeenCalled()
    })

    it('targa del rimorchio non valida: 400', async () => {
      await expect(service.crea(T, U, { targa: 'AB123CD', targaRimorchio: '#' })).rejects.toThrow(
        'Targa del rimorchio non valida.'
      )
    })

    it('doppione: 409 "Esiste già un automezzo con queste targhe."', async () => {
      tx.automezzo.findFirst.mockResolvedValue(riga())

      await expect(service.crea(T, U, { targa: 'ab123cd' })).rejects.toThrow(
        AutomezzoDuplicatoError
      )
      await expect(service.crea(T, U, { targa: 'ab123cd' })).rejects.toThrow(
        'Esiste già un automezzo con queste targhe.'
      )
    })

    it("violazione dell'indice unico (P2002) tradotta in 409", async () => {
      tx.automezzo.create.mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError('x', { code: 'P2002', clientVersion: 'x' })
      )

      await expect(service.crea(T, U, { targa: 'AB123CD' })).rejects.toThrow(
        AutomezzoDuplicatoError
      )
    })

    it('prende il lock di transazione sulla coppia di targhe', async () => {
      await service.crea(T, U, { targa: 'AB123CD' })

      expect(tx.$executeRaw).toHaveBeenCalledTimes(1)
    })

    it("trasportatore letto nell'azienda corrente (filtro tenantId); assente: errore senza id", async () => {
      tx.trasportatore.findFirst.mockResolvedValue(null)

      const esito = service.crea(T, U, { targa: 'AB123CD', trasportatoreId: TR })

      await expect(esito).rejects.toThrow(TrasportatoreNonTrovatoError)
      await expect(esito).rejects.toThrow('Trasportatore non trovato.')
      expect(tx.trasportatore.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: TR, tenantId: T } })
      )
      expect(tx.automezzo.create).not.toHaveBeenCalled()
    })
  })

  describe('aggiorna', () => {
    it('automezzo assente: 404', async () => {
      await expect(service.aggiorna(T, U, A, { targa: 'AB123CD' })).rejects.toThrow(
        AutomezzoNonTrovatoError
      )
    })

    it('il doppione esclude se stesso e valida il trasportatore', async () => {
      tx.automezzo.findFirst
        .mockResolvedValueOnce(riga()) // lettura dell'automezzo
        .mockResolvedValueOnce(null) // nessun altro con le stesse targhe
      await service.aggiorna(T, U, A, { targa: 'ab123cd', trasportatoreId: TR })

      const doppione = tx.automezzo.findFirst.mock.calls[1][0].where
      expect(doppione).toMatchObject({ tenantId: T, targa: 'AB123CD', NOT: { id: A } })
      expect(tx.trasportatore.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: TR, tenantId: T } })
      )
    })
  })

  describe('impostaTara', () => {
    it('dichiarata: origine DICHIARATA, taraPesataId null, audit con la tara precedente', async () => {
      tx.automezzo.findFirst.mockResolvedValue(
        riga({ taraKg: new Prisma.Decimal('7000'), taraOrigine: 'PESATA' })
      )

      await service.impostaTara(T, U, A, { taraKg: 7350.5 })

      const data = tx.automezzo.update.mock.calls[0][0].data
      expect(data).toMatchObject({
        taraKg: 7350.5,
        taraOrigine: 'DICHIARATA',
        taraPesataId: null,
        ultimaPesataVuotoIl: null,
      })
      expect(data.taraAggiornataIl).toBeInstanceOf(Date)
      const audit = tx.activityLog.create.mock.calls[0][0].data
      expect(audit.action).toBe('PESA_TARA_IMPOSTATA')
      expect(audit.metadata).toMatchObject({
        precedente: 7000,
        nuova: 7350.5,
        origine: 'DICHIARATA',
      })
    })

    it.each([0, -5, NaN, 100_000_000, 10.123])('tara dichiarata %p: 400', async tara => {
      tx.automezzo.findFirst.mockResolvedValue(riga())

      await expect(service.impostaTara(T, U, A, { taraKg: tara })).rejects.toThrow(
        DatiPesaNonValidiError
      )
    })

    it('da pesata: copia il peso effettivo (ultima rettifica) e la data della pesata', async () => {
      const ora = new Date('2026-10-20T08:30:00Z')
      tx.automezzo.findFirst.mockResolvedValue(riga())
      tx.pesata.findFirst.mockResolvedValue({
        id: P,
        fonte: 'MANUALE',
        stabile: true,
        pesoKg: new Prisma.Decimal('7000'),
        oraRicezione: ora,
        automezzoId: A,
        accesso: { stato: 'CHIUSO' },
        ordine: 2,
        rettifiche: [
          { numero: 1, pesoNuovoKg: new Prisma.Decimal('7100') },
          { numero: 2, pesoNuovoKg: new Prisma.Decimal('7120.5') },
        ],
      })

      await service.impostaTara(T, U, A, { pesataId: P })

      const data = tx.automezzo.update.mock.calls[0][0].data
      expect(data).toMatchObject({
        taraKg: 7120.5,
        taraOrigine: 'PESATA',
        taraPesataId: P,
        taraAggiornataIl: ora,
        ultimaPesataVuotoIl: ora,
      })
      expect(tx.pesata.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: P, tenantId: T } })
      )
    })

    it('da pesata TARA_ANAGRAFICA: 422', async () => {
      tx.automezzo.findFirst.mockResolvedValue(riga())
      tx.pesata.findFirst.mockResolvedValue({
        id: P,
        fonte: 'TARA_ANAGRAFICA',
        stabile: true,
        pesoKg: new Prisma.Decimal('7000'),
        oraRicezione: new Date(),
        automezzoId: A,
        accesso: { stato: 'CHIUSO' },
        ordine: 2,
        rettifiche: [],
      })

      await expect(service.impostaTara(T, U, A, { pesataId: P })).rejects.toThrow(RegolaPesataError)
      expect(tx.automezzo.update).not.toHaveBeenCalled()
    })

    it('da pesata instabile: 422', async () => {
      tx.automezzo.findFirst.mockResolvedValue(riga())
      tx.pesata.findFirst.mockResolvedValue({
        id: P,
        fonte: 'MANUALE',
        stabile: false,
        pesoKg: new Prisma.Decimal('7000'),
        oraRicezione: new Date(),
        automezzoId: A,
        accesso: { stato: 'CHIUSO' },
        ordine: 2,
        rettifiche: [],
      })

      await expect(service.impostaTara(T, U, A, { pesataId: P })).rejects.toThrow(RegolaPesataError)
    })

    it('da pesata di un altro automezzo o di un accesso annullato: 422', async () => {
      tx.automezzo.findFirst.mockResolvedValue(riga())
      const base = {
        id: P,
        fonte: 'MANUALE',
        stabile: true,
        pesoKg: new Prisma.Decimal('7000'),
        oraRicezione: new Date(),
        ordine: 2,
        rettifiche: [],
      }
      tx.pesata.findFirst.mockResolvedValueOnce({
        ...base,
        automezzoId: 'ffffffff-0000-4000-8000-00000000000f',
        accesso: { stato: 'CHIUSO' },
      })
      await expect(service.impostaTara(T, U, A, { pesataId: P })).rejects.toThrow(RegolaPesataError)
      tx.pesata.findFirst.mockResolvedValueOnce({
        ...base,
        automezzoId: A,
        accesso: { stato: 'ANNULLATO' },
      })
      await expect(service.impostaTara(T, U, A, { pesataId: P })).rejects.toThrow(RegolaPesataError)
    })

    it('pesata assente (o di un altro tenant): 404', async () => {
      tx.automezzo.findFirst.mockResolvedValue(riga())
      tx.pesata.findFirst.mockResolvedValue(null)

      await expect(service.impostaTara(T, U, A, { pesataId: P })).rejects.toThrow(
        PesataNonTrovataError
      )
    })
  })

  describe('leggiPerAccesso', () => {
    it('assente: AutomezzoNonTrovatoError', async () => {
      await expect(service.leggiPerAccesso(tx, T, A)).rejects.toThrow(AutomezzoNonTrovatoError)
    })
  })
})
