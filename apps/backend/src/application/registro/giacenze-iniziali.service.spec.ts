import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common'
import { GiacenzeInizialiService, DatiGiacenzaIniziale } from './giacenze-iniziali.service'
import { RegistroDaIndicareError, RegistroNonTrovatoError } from './registri.service'
import { annoSolareItaliano, giornoItaliano } from '../../core/time/anno-italiano'

describe('GiacenzeInizialiService (rami di validazione e sequenza)', () => {
  const TENANT = '11111111-1111-4111-8111-111111111111'
  const USER = '22222222-2222-4222-8222-222222222222'
  const REGISTRO = '33333333-3333-4333-8333-333333333333'
  const ID = '44444444-4444-4444-8444-444444444444'
  const OGGI = giornoItaliano(new Date())
  const ANNO = annoSolareItaliano(new Date())

  let tx: any
  let prisma: any
  let registri: { preparaRegistri: jest.Mock; risolvi: jest.Mock }
  let service: GiacenzeInizialiService

  const riga = (extra: Record<string, unknown> = {}) => ({
    id: ID,
    tenantId: TENANT,
    registroId: REGISTRO,
    cerCode: '13 02 05*',
    statoFisico: null,
    quantita: '100',
    unita: 'KG',
    dataRiferimento: new Date('2026-01-01T00:00:00.000Z'),
    origini: [],
    provenienza: 'MANUALE',
    note: null,
    impostatoDa: USER,
    createdAt: new Date('2026-10-01T10:00:00.000Z'),
    updatedAt: new Date('2026-10-01T10:00:00.000Z'),
    ...extra,
  })

  const dati = (extra: Partial<DatiGiacenzaIniziale> = {}): DatiGiacenzaIniziale => ({
    cerCode: '130205',
    quantita: 100,
    unita: 'kg',
    dataRiferimento: OGGI,
    ...extra,
  })

  beforeEach(() => {
    tx = {
      $executeRaw: jest.fn().mockResolvedValue(0),
      $queryRaw: jest.fn().mockResolvedValue([]),
      giacenzaIniziale: {
        findMany: jest.fn().mockResolvedValue([]),
        findFirst: jest.fn().mockResolvedValue(riga()),
        create: jest.fn().mockImplementation(async (a: any) => riga(a.data)),
        update: jest.fn().mockImplementation(async (a: any) => riga(a.data)),
        delete: jest.fn().mockResolvedValue({}),
      },
      activityLog: { create: jest.fn().mockResolvedValue({}) },
    }
    prisma = {
      $transaction: jest.fn().mockImplementation(async (fn: (t: any) => Promise<any>) => fn(tx)),
      cERCode: {
        findMany: jest.fn().mockResolvedValue([{ code: '13 02 05*' }]),
        count: jest.fn().mockResolvedValue(1),
      },
      giacenzaIniziale: {
        findFirst: jest.fn().mockResolvedValue({ registroId: REGISTRO, cerCode: '13 02 05*' }),
      },
    }
    registri = {
      preparaRegistri: jest.fn().mockResolvedValue(undefined),
      risolvi: jest.fn().mockResolvedValue({ id: REGISTRO }),
    }
    service = new GiacenzeInizialiService(prisma, registri as any)
  })

  describe('crea: validazioni (nessuna transaction aperta)', () => {
    it.each([
      ['quantità zero', { quantita: 0 }],
      ['quantità negativa', { quantita: -1 }],
      ['quantità con 3 decimali', { quantita: 1.234 }],
      ['quantità oltre il massimo', { quantita: 100_000_000 }],
      ['quantità non numerica', { quantita: Number.NaN }],
      ['unità vuota', { unita: '  ' }],
      ['unità oltre 10 caratteri', { unita: 'ABCDEFGHIJK' }],
      ['stato fisico oltre 50 caratteri', { statoFisico: 'x'.repeat(51) }],
      ['note oltre 500 caratteri', { note: 'x'.repeat(501) }],
      ['data non ISO', { dataRiferimento: '27/10/2026' }],
      ['data con ora', { dataRiferimento: `${OGGI}T10:00:00Z` }],
      ['data inesistente', { dataRiferimento: '2026-02-31' }],
      ['data nel futuro', { dataRiferimento: `${ANNO + 1}-01-01` }],
    ])('%s: 400', async (_nome, extra) => {
      await expect(service.crea(TENANT, USER, dati(extra as any))).rejects.toBeInstanceOf(
        BadRequestException
      )
      expect(prisma.$transaction).not.toHaveBeenCalled()
    })

    it('CER vuoto o senza cifre: 400', async () => {
      await expect(service.crea(TENANT, USER, dati({ cerCode: ' ' }))).rejects.toThrow(
        'Indica il codice CER.'
      )
    })

    it('CER non nel catalogo: 400', async () => {
      prisma.cERCode.findMany.mockResolvedValue([])
      await expect(service.crea(TENANT, USER, dati({ cerCode: '99 99 99' }))).rejects.toThrow(
        'Codice CER non valido: 99 99 99'
      )
      expect(prisma.$transaction).not.toHaveBeenCalled()
    })

    it('la data di oggi è ammessa (giorno italiano)', async () => {
      await expect(
        service.crea(TENANT, USER, dati({ dataRiferimento: OGGI }))
      ).resolves.toBeDefined()
    })

    describe('origini', () => {
      it.each([
        ['anno prima del 1990', [{ anno: 1989, protocollo: 1 }]],
        ['anno oltre quello corrente', [{ anno: ANNO + 1, protocollo: 1 }]],
        ['anno non intero', [{ anno: 2020.5, protocollo: 1 }]],
        ['protocollo zero', [{ anno: 2020, protocollo: 0 }]],
        ['protocollo non intero', [{ anno: 2020, protocollo: 1.5 }]],
        ['quantità zero', [{ anno: 2020, protocollo: 1, quantita: 0 }]],
        ['quantità con 3 decimali', [{ anno: 2020, protocollo: 1, quantita: 1.005 }]],
        [
          'coppia duplicata',
          [
            { anno: 2020, protocollo: 1 },
            { anno: 2020, protocollo: 1 },
          ],
        ],
        [
          'somma oltre la quantità della giacenza',
          [
            { anno: 2020, protocollo: 1, quantita: 60 },
            { anno: 2020, protocollo: 2, quantita: 40.01 },
          ],
        ],
        [
          'più di 200 voci',
          Array.from({ length: 201 }, (_, i) => ({ anno: 2020, protocollo: i + 1 })),
        ],
      ])('%s: 400', async (_nome, origini) => {
        await expect(service.crea(TENANT, USER, dati({ origini }))).rejects.toBeInstanceOf(
          BadRequestException
        )
        expect(prisma.$transaction).not.toHaveBeenCalled()
      })

      it('somma pari alla quantità, o voci senza quantità: ammesse', async () => {
        await expect(
          service.crea(
            TENANT,
            USER,
            dati({
              origini: [
                { anno: 2020, protocollo: 1, quantita: 60 },
                { anno: 2021, protocollo: 1, quantita: 40 },
              ],
            })
          )
        ).resolves.toBeDefined()
        await expect(
          service.crea(
            TENANT,
            USER,
            dati({
              origini: [
                { anno: 2020, protocollo: 1, quantita: 500 },
                { anno: 2021, protocollo: 1 },
              ],
            })
          )
        ).resolves.toBeDefined()
      })
    })
  })

  describe('crea: sequenza G12', () => {
    it("prepara i registri fuori dalla transaction, poi risolve, blocca, controlla, inserisce, avvisa, registra l'audit", async () => {
      const ordine: string[] = []
      registri.preparaRegistri.mockImplementation(async () => void ordine.push('prepara'))
      prisma.$transaction.mockImplementation(async (fn: any) => {
        ordine.push('tx')
        return fn(tx)
      })
      registri.risolvi.mockImplementation(async () => {
        ordine.push('risolvi')
        return { id: REGISTRO }
      })
      tx.$executeRaw.mockImplementation(async () => void ordine.push('lock'))
      tx.giacenzaIniziale.findMany.mockImplementation(async () => {
        ordine.push('unicita')
        return []
      })
      tx.giacenzaIniziale.create.mockImplementation(async (a: any) => {
        ordine.push('insert')
        return riga(a.data)
      })
      tx.$queryRaw.mockImplementation(async () => {
        ordine.push('avviso')
        return []
      })
      tx.activityLog.create.mockImplementation(async () => void ordine.push('audit'))

      await service.crea(TENANT, USER, dati(), REGISTRO)
      expect(ordine).toEqual([
        'prepara',
        'tx',
        'risolvi',
        'lock',
        'unicita',
        'insert',
        'avviso',
        'audit',
      ])
    })

    it('salva il CER nella forma del catalogo, unità normalizzata, stato fisico in maiuscole, provenienza MANUALE', async () => {
      const r = await service.crea(
        TENANT,
        USER,
        dati({ cerCode: '13.02.05', unita: 'Tonnellate', statoFisico: ' liquido ', note: ' x ' })
      )
      expect(tx.giacenzaIniziale.create.mock.calls[0][0].data).toMatchObject({
        tenantId: TENANT,
        registroId: REGISTRO,
        cerCode: '13 02 05*',
        unita: 'T',
        statoFisico: 'LIQUIDO',
        provenienza: 'MANUALE',
        note: 'x',
        impostatoDa: USER,
      })
      expect(r.giacenza.dataRiferimento).toBe(OGGI)
    })

    it('stato fisico vuoto diventa NULL', async () => {
      await service.crea(TENANT, USER, dati({ statoFisico: '   ' }))
      expect(tx.giacenzaIniziale.create.mock.calls[0][0].data.statoFisico).toBeNull()
    })

    it('il lock usa la chiave giacenza|registro|CER senza asterisco', async () => {
      await service.crea(TENANT, USER, dati())
      const [, chiave] = tx.$executeRaw.mock.calls[0]
      expect(chiave).toBe(`giacenza|${REGISTRO}|13 02 05`)
    })

    it('G3: una apertura in t contro una in kg è un conflitto; in litri è ammessa', async () => {
      tx.giacenzaIniziale.findMany.mockResolvedValue([{ unita: 'T' }])
      await expect(service.crea(TENANT, USER, dati({ unita: 'kg' }))).rejects.toBeInstanceOf(
        ConflictException
      )
      expect(tx.giacenzaIniziale.create).not.toHaveBeenCalled()
      await expect(service.crea(TENANT, USER, dati({ unita: 'L' }))).resolves.toBeDefined()
    })

    it('G3: la ricerca dei duplicati copre il CER con e senza asterisco e lo stesso stato fisico', async () => {
      await service.crea(TENANT, USER, dati({ statoFisico: 'solido' }))
      expect(tx.giacenzaIniziale.findMany.mock.calls[0][0].where).toMatchObject({
        tenantId: TENANT,
        registroId: REGISTRO,
        cerCode: { in: ['13 02 05', '13 02 05*'] },
        statoFisico: 'SOLIDO',
      })
    })

    it("una violazione dell'indice unico è 409", async () => {
      tx.giacenzaIniziale.create.mockRejectedValue(
        Object.assign(new Error('unico'), { code: 'P2002' })
      )
      await expect(service.crea(TENANT, USER, dati())).rejects.toBeInstanceOf(ConflictException)
    })

    it('G8: avviso con numero/anno dei carichi "Altro carico" dello stesso CER', async () => {
      tx.$queryRaw.mockResolvedValue([
        { progressive_number: 3, progressive_year: 2026 },
        { progressive_number: 9, progressive_year: 2026 },
      ])
      const r = await service.crea(TENANT, USER, dati())
      expect(r.avvisi).toHaveLength(1)
      expect(r.avvisi[0]).toContain('«Altro carico»')
      expect(r.avvisi[0]).toContain('contata due volte')
      expect(r.avvisi[0]).toContain('3/2026, 9/2026')
    })

    it('nessun avviso senza ALTRO_CARICO', async () => {
      expect((await service.crea(TENANT, USER, dati())).avvisi).toEqual([])
    })

    it('audit nella stessa transaction, senza altri dati', async () => {
      await service.crea(TENANT, USER, dati())
      const d = tx.activityLog.create.mock.calls[0][0].data
      expect(d).toMatchObject({
        tenantId: TENANT,
        userId: USER,
        action: 'REGISTRO_GIACENZA_INIZIALE_CREATA',
      })
      expect(Object.keys(d.metadata).sort()).toEqual(
        ['cerCode', 'dataRiferimento', 'id', 'quantita', 'registroId', 'unita'].sort()
      )
    })

    it('registro non determinabile: 400; registro esplicito inesistente: 404', async () => {
      registri.risolvi.mockRejectedValue(new RegistroDaIndicareError())
      await expect(service.crea(TENANT, USER, dati())).rejects.toBeInstanceOf(BadRequestException)
      registri.risolvi.mockRejectedValue(new RegistroNonTrovatoError())
      await expect(service.crea(TENANT, USER, dati(), REGISTRO)).rejects.toBeInstanceOf(
        NotFoundException
      )
      await expect(service.crea(TENANT, USER, dati())).rejects.toBeInstanceOf(BadRequestException)
    })
  })

  describe('modifica', () => {
    const modifica = (extra: Record<string, unknown> = {}) => {
      const { cerCode: _c, ...resto } = dati()
      return service.modifica(TENANT, USER, ID, { ...resto, ...extra } as any)
    }

    it("riga inesistente o di un'altra azienda: 404 senza transaction", async () => {
      prisma.giacenzaIniziale.findFirst.mockResolvedValue(null)
      await expect(modifica()).rejects.toBeInstanceOf(NotFoundException)
      expect(prisma.$transaction).not.toHaveBeenCalled()
      expect(prisma.giacenzaIniziale.findFirst.mock.calls[0][0].where).toEqual({
        id: ID,
        tenantId: TENANT,
      })
    })

    it('sparita fra la prima lettura e il lock: 404', async () => {
      tx.giacenzaIniziale.findFirst.mockResolvedValue(null)
      await expect(modifica()).rejects.toBeInstanceOf(NotFoundException)
      expect(tx.giacenzaIniziale.update).not.toHaveBeenCalled()
    })

    it('usata da uno scarico successivo: 409 e nessuna scrittura', async () => {
      tx.$queryRaw.mockResolvedValue([{ trovato: 1 }])
      await expect(modifica()).rejects.toBeInstanceOf(ConflictException)
      expect(tx.giacenzaIniziale.update).not.toHaveBeenCalled()
      expect(tx.activityLog.create).not.toHaveBeenCalled()
    })

    it('ricontrolla G3 escludendo se stessa', async () => {
      tx.giacenzaIniziale.findMany.mockResolvedValue([{ unita: 'KG' }])
      await expect(modifica({ unita: 't' })).rejects.toBeInstanceOf(ConflictException)
      expect(tx.giacenzaIniziale.findMany.mock.calls[0][0].where.id).toEqual({ not: ID })
    })

    it('ricontrolla G2 e G6 sui valori nuovi', async () => {
      await expect(modifica({ dataRiferimento: `${ANNO + 1}-01-01` })).rejects.toBeInstanceOf(
        BadRequestException
      )
      await expect(
        modifica({ origini: [{ anno: 2020, protocollo: 1, quantita: 1000 }] })
      ).rejects.toBeInstanceOf(BadRequestException)
    })

    it('scrive tutto tranne CER e registro, con lock sul CER della riga e audit', async () => {
      await modifica({ quantita: 250.5, statoFisico: 'polvere' })
      const [, chiave] = tx.$executeRaw.mock.calls[0]
      expect(chiave).toBe(`giacenza|${REGISTRO}|13 02 05`)
      const data = tx.giacenzaIniziale.update.mock.calls[0][0].data
      expect(data).toMatchObject({ quantita: 250.5, statoFisico: 'POLVERE', unita: 'KG' })
      expect(data).not.toHaveProperty('cerCode')
      expect(data).not.toHaveProperty('registroId')
      expect(tx.activityLog.create.mock.calls[0][0].data.action).toBe(
        'REGISTRO_GIACENZA_INIZIALE_MODIFICATA'
      )
    })
  })

  describe('elimina', () => {
    it('inesistente: 404', async () => {
      prisma.giacenzaIniziale.findFirst.mockResolvedValue(null)
      await expect(service.elimina(TENANT, USER, ID)).rejects.toBeInstanceOf(NotFoundException)
    })

    it('usata: 409 e non cancella', async () => {
      tx.$queryRaw.mockResolvedValue([{ trovato: 1 }])
      await expect(service.elimina(TENANT, USER, ID)).rejects.toBeInstanceOf(ConflictException)
      expect(tx.giacenzaIniziale.delete).not.toHaveBeenCalled()
    })

    it('non usata: lock, cancellazione e audit', async () => {
      await service.elimina(TENANT, USER, ID)
      expect(tx.$executeRaw).toHaveBeenCalledTimes(1)
      expect(tx.giacenzaIniziale.delete).toHaveBeenCalledWith({
        where: { id_tenantId: { id: ID, tenantId: TENANT } },
      })
      expect(tx.activityLog.create.mock.calls[0][0].data.action).toBe(
        'REGISTRO_GIACENZA_INIZIALE_ELIMINATA'
      )
    })
  })

  describe('elenca', () => {
    it('registro non determinabile: elenco vuoto con registroId null, senza preparaRegistri', async () => {
      registri.risolvi.mockRejectedValue(new RegistroNonTrovatoError())
      await expect(service.elenca(TENANT)).resolves.toEqual({ registroId: null, voci: [] })
      expect(registri.preparaRegistri).not.toHaveBeenCalled()
    })

    it('registroId esplicito inesistente: 404', async () => {
      registri.risolvi.mockRejectedValue(new RegistroNonTrovatoError())
      await expect(service.elenca(TENANT, REGISTRO)).rejects.toBeInstanceOf(NotFoundException)
    })

    it('registro senza righe: nessuna query sugli scarichi', async () => {
      await expect(service.elenca(TENANT)).resolves.toEqual({ registroId: REGISTRO, voci: [] })
      expect(tx.$queryRaw).not.toHaveBeenCalled()
    })

    it('modificabile per riga con UNA sola query sugli scarichi del registro', async () => {
      tx.giacenzaIniziale.findMany.mockResolvedValue([
        riga({ id: 'a', cerCode: '13 02 05*' }),
        riga({ id: 'b', cerCode: '20 03 01' }),
        riga({ id: 'c', cerCode: '15 01 01' }),
      ])
      tx.$queryRaw.mockResolvedValue([
        // scarico dopo l'apertura: non modificabile
        { cifre: '130205', ultimo: new Date('2026-10-02T00:00:00.000Z') },
        // scarico prima dell'apertura: modificabile
        { cifre: '200301', ultimo: new Date('2026-09-30T00:00:00.000Z') },
      ])
      const r = await service.elenca(TENANT)
      expect(tx.$queryRaw).toHaveBeenCalledTimes(1)
      expect(r.voci.map(v => [v.id, v.modificabile])).toEqual([
        ['a', false],
        ['b', true],
        ['c', true],
      ])
      expect(r.voci[0].dataRiferimento).toBe('2026-01-01')
      expect(r.voci[0].quantita).toBe(100)
    })
  })
})
