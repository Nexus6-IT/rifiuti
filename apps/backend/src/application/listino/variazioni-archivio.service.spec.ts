import { BadRequestException, ConflictException } from '@nestjs/common'
import { Prisma } from '@prisma/client'
import { improntaVariazione } from '../../domain/listino/variazione-prezzi'
import { VariazioniArchivioService } from './variazioni-archivio.service'

const T = 'aaaaaaaa-0000-4000-8000-000000000001'
const U = 'bbbbbbbb-0000-4000-8000-000000000002'
const A1 = 'c1c1c1c1-0000-4000-8000-000000000001'
const A2 = 'c2c2c2c2-0000-4000-8000-000000000002'
const IVA_DA = 'd1d1d1d1-0000-4000-8000-000000000001'
const IVA_A = 'd2d2d2d2-0000-4000-8000-000000000002'

const dec = (v: string | null) => (v === null ? null : new Prisma.Decimal(v))

const addebito = (
  id: string,
  descrizione: string,
  prezzi: Record<number, string | null>,
  extra: Record<string, unknown> = {}
) => ({
  id,
  descrizione,
  versione: 1,
  codiceIvaId: IVA_DA,
  listini: [1, 2, 3, 4, 5, 6].map(numero => ({
    id: `${id}-p${numero}`,
    numero,
    prezzo: dec(prezzi[numero] ?? null),
  })),
  ...extra,
})

const MSG_TROPPE = 'La variazione tocca troppe righe: restringi i filtri.'

async function errore(p: Promise<unknown>): Promise<any> {
  try {
    await p
  } catch (e) {
    return e
  }
  throw new Error('attesa un’eccezione')
}

describe('VariazioniArchivioService (Prisma finto)', () => {
  let tx: any
  let prisma: any
  let service: VariazioniArchivioService
  let addebiti: any[]
  let iva: Array<{ id: string; attivo: boolean }>
  let testiSql: string[]
  let valoriSql: unknown[][]

  beforeEach(() => {
    addebiti = [
      addebito(A1, 'Trasporto', { 1: '10.00', 2: '0.0125', 4: '5' }),
      addebito(A2, 'Pesata', { 1: '2.50', 2: '0' }),
    ]
    iva = [{ id: IVA_A, attivo: true }]
    testiSql = []
    valoriSql = []
    tx = {
      addebito: { findMany: jest.fn(async () => addebiti) },
      codiceIva: {
        findMany: jest.fn(async () => [
          { id: IVA_DA, codice: '22' },
          { id: IVA_A, codice: '10' },
        ]),
      },
      $queryRaw: jest.fn(async (strings: TemplateStringsArray, ...valori: unknown[]) => {
        const s = strings.join('?')
        testiSql.push(s)
        valoriSql.push(valori)
        if (s.includes('"codici_iva"')) return iva
        return []
      }),
      $executeRaw: jest.fn(async (strings: TemplateStringsArray, ...valori: unknown[]) => {
        testiSql.push(strings.join('?'))
        valoriSql.push(valori)
        return 1
      }),
      activityLog: { create: jest.fn().mockResolvedValue({}) },
    }
    prisma = { $transaction: jest.fn(async (fn: any) => fn(tx)) }
    service = new VariazioniArchivioService(prisma)
  })

  const corpo = (extra: Record<string, unknown> = {}) =>
    ({
      tipo: 'AUMENTO_PERCENTUALE' as const,
      valore: '10',
      filtri: {},
      ...extra,
    }) as any

  describe('anteprima', () => {
    it('righe per (addebito, listino): prezzi > 0, zero e vuoti esclusi; forma di R4', async () => {
      const a = await service.anteprima(T, corpo())
      expect(a.righe).toEqual([
        { id: A1, descrizione: 'Trasporto', listino: 1, prima: '10.00', dopo: '11.00' },
        { id: A1, descrizione: 'Trasporto', listino: 2, prima: '0.0125', dopo: '0.0138' },
        { id: A1, descrizione: 'Trasporto', listino: 4, prima: '5.00', dopo: '5.50' },
        { id: A2, descrizione: 'Pesata', listino: 1, prima: '2.50', dopo: '2.75' },
      ])
      expect(a.totale).toBe(4)
      expect(a.errori).toEqual([])
      expect(a.impronta).toMatch(/^[0-9a-f]{64}$/)
    })

    it('filtro listini 2 e 4: solo quei listini', async () => {
      const a = await service.anteprima(T, corpo({ filtri: { listini: [4, 2, 2] } }))
      expect(a.righe.map(r => `${r.id}:${r.listino}`)).toEqual([`${A1}:2`, `${A1}:4`])
    })

    it('traduce i filtri in condizioni dell’archivio (categoria, tipi, addebiti) e isola l’azienda', async () => {
      await service.anteprima(
        T,
        corpo({
          filtri: { categorieIds: [IVA_A], tipi: ['V', 'F'], addebitiIds: [A1], listini: [2] },
        })
      )
      const where = tx.addebito.findMany.mock.calls[0][0].where
      expect(where).toMatchObject({
        tenantId: T,
        categoriaId: { in: [IVA_A] },
        tipo: { in: ['F', 'V'] },
        id: { in: [A1] },
        listini: { some: { numero: { in: [2] }, prezzo: { gt: 0 } } },
      })
    })

    it('importo: fino a 6 decimali; risultato negativo → errore per riga con il listino', async () => {
      const a = await service.anteprima(T, corpo({ tipo: 'DIMINUZIONE_IMPORTO', valore: '3' }))
      expect(a.errori).toEqual([
        {
          id: A1,
          descrizione: 'Trasporto',
          messaggio: 'Listino 2: Il nuovo prezzo sarebbe negativo.',
        },
        {
          id: A2,
          descrizione: 'Pesata',
          messaggio: 'Listino 1: Il nuovo prezzo sarebbe negativo.',
        },
      ])
      expect(a.righe.find(r => r.id === A1 && r.listino === 1)?.dopo).toBe('7.00')
    })

    it('l’impronta è stabile a parità di stato e cambia con la versione di un addebito', async () => {
      const a = await service.anteprima(T, corpo())
      expect((await service.anteprima(T, corpo())).impronta).toBe(a.impronta)
      addebiti[1].versione = 2
      expect((await service.anteprima(T, corpo())).impronta).not.toBe(a.impronta)
    })

    it('l’impronta dipende anche dai parametri della variazione', async () => {
      const a = await service.anteprima(T, corpo({ valore: '10' }))
      const b = await service.anteprima(T, corpo({ valore: '11' }))
      expect(a.impronta).not.toBe(b.impronta)
      expect(a.impronta).not.toBe(
        improntaVariazione([
          { id: A1, versione: 1 },
          { id: A2, versione: 1 },
        ])
      )
    })

    it('sostituzione IVA: una riga per addebito (listino 0), codici prima e dopo', async () => {
      const a = await service.anteprima(
        T,
        corpo({
          tipo: 'SOSTITUZIONE_IVA',
          valore: undefined,
          daCodiceIvaId: IVA_DA,
          aCodiceIvaId: IVA_A,
        })
      )
      expect(a.righe).toEqual([
        { id: A1, descrizione: 'Trasporto', listino: 0, prima: '22', dopo: '10' },
        { id: A2, descrizione: 'Pesata', listino: 0, prima: '22', dopo: '10' },
      ])
      expect(tx.addebito.findMany.mock.calls[0][0].where).toMatchObject({ codiceIvaId: IVA_DA })
    })

    it('IVA: i due codici obbligatori e diversi; il nuovo deve esistere ed essere attivo', async () => {
      const base = { tipo: 'SOSTITUZIONE_IVA', valore: undefined }
      let e = await errore(service.anteprima(T, corpo({ ...base, daCodiceIvaId: IVA_DA })))
      expect(e).toBeInstanceOf(BadRequestException)
      e = await errore(
        service.anteprima(T, corpo({ ...base, daCodiceIvaId: IVA_DA, aCodiceIvaId: IVA_DA }))
      )
      expect(e.getResponse().message).toContain('I due codici IVA devono essere diversi.')
      iva = [{ id: IVA_A, attivo: false }]
      e = await errore(
        service.anteprima(T, corpo({ ...base, daCodiceIvaId: IVA_DA, aCodiceIvaId: IVA_A }))
      )
      expect(e.getResponse().message).toContain('Il codice IVA scelto non esiste o è disattivato.')
    })

    it.each([
      [{ valore: undefined }, 'Indica il valore della variazione.'],
      [{ valore: 'abc' }, 'Il valore non è un numero.'],
      [{ valore: '0' }, 'Il valore deve essere maggiore di 0.'],
      [
        { tipo: 'AUMENTO_IMPORTO', valore: '1.1234567' },
        "L'importo può avere al massimo 6 decimali.",
      ],
      [{ tipo: 'BOH' }, 'Il tipo di variazione non è ammesso.'],
      [{ filtri: { tipi: ['ZZ'] } }, 'Il tipo di addebito non è ammesso.'],
      [{ filtri: { listini: [7] } }, 'I listini sono numerati da 1 a 6.'],
    ])('rifiuta %j con 400 e messaggio in italiano', async (extra, messaggio) => {
      const e = await errore(service.anteprima(T, corpo(extra)))
      expect(e).toBeInstanceOf(BadRequestException)
      expect(e.getResponse().message).toContain(messaggio)
      expect(tx.addebito.findMany).not.toHaveBeenCalled()
    })

    it(`oltre 10.000 righe → 400 "${MSG_TROPPE}"`, async () => {
      addebiti = Array.from({ length: 10001 }, (_, i) =>
        addebito(`00000000-0000-4000-8000-${String(i).padStart(12, '0')}`, 'X', { 1: '1' })
      )
      const e = await errore(service.anteprima(T, corpo()))
      expect(e).toBeInstanceOf(BadRequestException)
      expect(e.getResponse().message).toEqual([MSG_TROPPE])
    })

    it('non scrive niente', async () => {
      await service.anteprima(T, corpo())
      expect(tx.$executeRaw).not.toHaveBeenCalled()
      expect(tx.activityLog.create).not.toHaveBeenCalled()
    })
  })

  describe('applica', () => {
    const conImpronta = async (extra: Record<string, unknown> = {}) => {
      const c = corpo(extra)
      const { impronta } = await service.anteprima(T, c)
      return { ...c, impronta }
    }

    it('una transazione: blocca addebiti e prezzi in ordine stabile, scrive, versione + 1, un audit', async () => {
      const c = await conImpronta()
      testiSql.length = 0
      valoriSql.length = 0
      prisma.$transaction.mockClear()
      const r = await service.applica(T, U, c)
      expect(r).toEqual({ aggiornati: 4 })
      expect(prisma.$transaction).toHaveBeenCalledTimes(1)

      const lock = testiSql.filter(s => s.includes('FOR UPDATE'))
      expect(lock).toHaveLength(2)
      expect(lock[0]).toMatch(/FROM addebiti[\s\S]*ORDER BY id[\s\S]*FOR UPDATE/)
      expect(lock[1]).toMatch(
        /FROM prezzi_listino_addebito[\s\S]*ORDER BY addebito_id, numero[\s\S]*FOR UPDATE/
      )
      const indicePrezzi = testiSql.findIndex(s => /UPDATE prezzi_listino_addebito/.test(s))
      const indiceAddebiti = testiSql.findIndex(s => /UPDATE addebiti[\s\S]*versione \+ 1/.test(s))
      expect(indicePrezzi).toBeGreaterThan(-1)
      expect(indiceAddebiti).toBeGreaterThan(indicePrezzi)
      // gli id dei prezzi e i nuovi valori viaggiano come array paralleli
      expect(valoriSql[indicePrezzi]).toEqual(
        expect.arrayContaining([
          [`${A1}-p1`, `${A1}-p2`, `${A1}-p4`, `${A2}-p1`],
          ['11.00', '0.0138', '5.50', '2.75'],
        ])
      )
      expect(tx.activityLog.create).toHaveBeenCalledTimes(1)
      const audit = tx.activityLog.create.mock.calls[0][0].data
      expect(audit).toMatchObject({ tenantId: T, userId: U, action: 'PREZZI_ARCHIVIO_VARIATI' })
      expect(audit.metadata).toMatchObject({
        tipo: 'AUMENTO_PERCENTUALE',
        valore: '10',
        addebiti: 2,
        prezzi: 4,
      })
    })

    it('impronta diversa → 409 VARIAZIONE_SUPERATA e nessuna scrittura', async () => {
      const c = await conImpronta()
      addebiti[0].versione = 2
      const e = await errore(service.applica(T, U, c))
      expect(e).toBeInstanceOf(ConflictException)
      expect(e.getResponse()).toMatchObject({
        error: 'VARIAZIONE_SUPERATA',
        message: 'I prezzi sono cambiati dopo l’anteprima: rifai l’anteprima.',
      })
      expect(tx.$executeRaw).not.toHaveBeenCalled()
      expect(tx.activityLog.create).not.toHaveBeenCalled()
    })

    it('impronta calcolata con parametri diversi → 409', async () => {
      const c = await conImpronta()
      const e = await errore(service.applica(T, U, { ...c, valore: '20' }))
      expect(e).toBeInstanceOf(ConflictException)
    })

    it('un errore nell’anteprima (prezzo negativo) → 400 per tutta la variazione, niente scritto', async () => {
      const c = await conImpronta({ tipo: 'DIMINUZIONE_IMPORTO', valore: '3' })
      const e = await errore(service.applica(T, U, c))
      expect(e).toBeInstanceOf(BadRequestException)
      expect(e.getResponse().message).toContain(
        'Trasporto: Listino 2: Il nuovo prezzo sarebbe negativo.'
      )
      expect(tx.$executeRaw).not.toHaveBeenCalled()
    })

    it('sostituzione IVA: aggiorna codice IVA e versione degli addebiti, non i prezzi', async () => {
      const c = await conImpronta({
        tipo: 'SOSTITUZIONE_IVA',
        valore: undefined,
        daCodiceIvaId: IVA_DA,
        aCodiceIvaId: IVA_A,
      })
      testiSql.length = 0
      valoriSql.length = 0
      const r = await service.applica(T, U, c)
      expect(r).toEqual({ aggiornati: 2 })
      expect(testiSql.some(s => /UPDATE prezzi_listino_addebito/.test(s))).toBe(false)
      const i = testiSql.findIndex(s => /UPDATE addebiti[\s\S]*codice_iva_id/.test(s))
      expect(i).toBeGreaterThan(-1)
      expect(valoriSql[i]).toEqual(expect.arrayContaining([IVA_A, [A1, A2]]))
    })

    it('nessun addebito corrispondente: aggiornati 0, nessun lock né scrittura, audit con zeri', async () => {
      addebiti = []
      const c = await conImpronta()
      const r = await service.applica(T, U, c)
      expect(r).toEqual({ aggiornati: 0 })
      expect(testiSql.some(s => s.includes('FOR UPDATE'))).toBe(false)
      expect(tx.$executeRaw).not.toHaveBeenCalled()
    })

    it('l’audit non contiene descrizioni né note', async () => {
      const c = await conImpronta()
      await service.applica(T, U, c)
      const json = JSON.stringify(tx.activityLog.create.mock.calls[0][0].data)
      expect(json).not.toContain('Trasporto')
      expect(json).not.toContain('Pesata')
    })
  })
})
