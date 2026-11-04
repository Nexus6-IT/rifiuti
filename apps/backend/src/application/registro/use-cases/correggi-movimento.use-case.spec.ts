import {
  BadRequestException,
  ConflictException,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common'
import { Prisma } from '@prisma/client'
import { CorreggiMovimentoUseCase } from './correggi-movimento.use-case'
import * as giacenzaModulo from '../giacenza-disponibile'
import { righeCausaliSistema } from '../causali/catalogo-causali.fixture'
import { INDICAZIONE_FIR_ANNULLATO } from '../../../core/domain/errors'

import { riallineaLegameDopoCorrezione } from '../../legami-movimento/legami-correzioni'

import {
  fotografiaScarico,
  riallineaDopoCorrezioneScarico,
  verificaCorrezioneCarico,
} from '../../abbinamenti/abbinamenti-correzioni'

jest.mock('../../legami-movimento/legami-correzioni')
jest.mock('../../abbinamenti/abbinamenti-correzioni')
const verificaMock = verificaCorrezioneCarico as jest.MockedFunction<
  typeof verificaCorrezioneCarico
>
const fotoMock = fotografiaScarico as jest.MockedFunction<typeof fotografiaScarico>
const riallineaMock = riallineaDopoCorrezioneScarico as jest.MockedFunction<
  typeof riallineaDopoCorrezioneScarico
>
const legameMock = riallineaLegameDopoCorrezione as jest.MockedFunction<
  typeof riallineaLegameDopoCorrezione
>
const STATO_PRIMA = {
  giorno: '2026-03-01',
  chiaveCer: '999907',
  famiglia: 'KG',
  quantita: 100,
  classeAttesa: null,
}

const logger = { setContext: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() }

const TENANT = 't-1'
const REG = '00000000-0000-4000-8000-0000000000aa'

function riga(over: Record<string, unknown> = {}) {
  return {
    id: 'o-1',
    tenantId: TENANT,
    registroId: REG,
    progressiveNumber: 5,
    progressiveYear: 2026,
    type: 'CARICO',
    movementDate: new Date('2026-03-01T00:00:00Z'),
    registrationDate: new Date('2026-03-01T00:00:00Z'),
    causale: 'PRODUZIONE_INTERNA',
    cerCode: '99 99 07',
    wasteDescription: null,
    quantity: new Prisma.Decimal('100'),
    unit: 'KG',
    wastePhysicalState: null,
    wasteHazardClasses: null,
    operationCode: null,
    counterpartName: null,
    counterpartAddress: null,
    firId: null,
    firIdRicopia: null,
    ricopiaChiave: '',
    recordedByUserId: null,
    entryHash: 'h',
    hashVersione: 2,
    notes: null,
    tipoAnnotazione: 'ORDINARIA',
    movimentoRettificatoId: null,
    movimentoOriginaleId: null,
    motivoAnnotazione: null,
    ...over,
  }
}

const SALDO_OK = {
  saldoComplessivoKg: 100,
  saldoMinimoGiornalieroKg: 100,
  unitaNonDiMassaCaricate: [],
}

function creaTx(opts: {
  letti?: Array<ReturnType<typeof riga> | null>
  correzioni?: number
  radice?: ReturnType<typeof riga> | null
  mud?: number[]
  fir?: { id: string; firNumber: string | null; rentriNumeroFir: string | null } | null
}) {
  const letti = [...(opts.letti ?? [riga(), riga()])]
  const findFirst = jest.fn().mockImplementation(async ({ where }: any) => {
    if (where.id === 'radice') return opts.radice ?? null
    return letti.length > 1 ? letti.shift() : letti[0]
  })
  const creato = riga({ id: 'n-1', progressiveNumber: 6, tipoAnnotazione: 'RETTIFICA' })
  return {
    wasteMovement: {
      findFirst,
      count: jest.fn().mockResolvedValue(opts.correzioni ?? 0),
      create: jest
        .fn()
        .mockImplementation(async ({ data }: any) => ({ ...creato, ...data, id: 'n-1' })),
    },
    // Catalogo delle causali: le 11 di sistema, nessuna personalizzazione dell'azienda.
    causaleRegistro: { findMany: jest.fn().mockResolvedValue(righeCausaliSistema()) },
    causaleRegistroAzienda: { findMany: jest.fn().mockResolvedValue([]) },
    cERCode: { count: jest.fn().mockResolvedValue(1) },
    mUDReport: {
      findMany: jest.fn().mockResolvedValue((opts.mud ?? []).map(year => ({ year }))),
    },
    registroProgressivoIniziale: { findUnique: jest.fn().mockResolvedValue(null) },
    fIR: { findFirst: jest.fn().mockResolvedValue(opts.fir ?? null) },
    activityLog: { create: jest.fn().mockResolvedValue({}) },
    $executeRaw: jest.fn().mockResolvedValue(1),
    $queryRaw: jest.fn().mockResolvedValue([{ max_num: 5, entry_hash: 'hprec' }]),
  }
}

function creaUseCase(tx: ReturnType<typeof creaTx>) {
  const prisma = {
    $transaction: jest.fn(async (fn: any) => fn(tx)),
    wasteMovement: { count: jest.fn().mockResolvedValue(0) },
  }
  return new CorreggiMovimentoUseCase(prisma as never, logger as never)
}

const base = { tenantId: TENANT, userId: 'u-1', movimentoId: 'o-1', motivo: 'errore' }
const dati = {
  movementDate: new Date('2026-03-01T00:00:00Z'),
  causale: 'PRODUZIONE_INTERNA',
  cerCode: '99 99 07',
  quantity: 90,
  unit: 'KG',
}

describe('CorreggiMovimentoUseCase (unitario)', () => {
  let saldi: jest.SpyInstance
  beforeEach(() => {
    jest.clearAllMocks()
    verificaMock.mockResolvedValue(undefined)
    fotoMock.mockResolvedValue(STATO_PRIMA)
    riallineaMock.mockResolvedValue([])
    legameMock.mockResolvedValue([])
    saldi = jest.spyOn(giacenzaModulo, 'saldiRegistroCer').mockResolvedValue(SALDO_OK)
  })
  afterEach(() => saldi.mockRestore())

  describe('legame movimento-cliente-prezzo (4.3b, Task 21)', () => {
    function useCaseCon(tx: ReturnType<typeof creaTx>) {
      const prisma = {
        $transaction: jest.fn(async (fn: any, _opzioni?: unknown) => fn(tx)),
        wasteMovement: { count: jest.fn().mockResolvedValue(0) },
      }
      return { prisma, uc: new CorreggiMovimentoUseCase(prisma as never, logger as never) }
    }

    it('la transazione di correzione ha un timeout esplicito di 30 s (maxWait 10 s)', async () => {
      const { prisma, uc } = useCaseCon(creaTx({}))
      await uc.rettifica({ ...base, dati })
      expect(prisma.$transaction).toHaveBeenCalledWith(expect.any(Function), {
        timeout: 30_000,
        maxWait: 10_000,
      })
    })

    it('il riallineamento riceve radice, nuova testa e budget; i suoi avvisi finiscono nella risposta', async () => {
      legameMock.mockResolvedValue(['avviso del legame'])
      const { uc } = useCaseCon(creaTx({}))
      const r = await uc.rettifica({ ...base, dati })
      expect(legameMock).toHaveBeenCalledTimes(1)
      const c = legameMock.mock.calls[0][1]
      expect(c).toMatchObject({
        tenantId: TENANT,
        tipo: 'RETTIFICA',
        radiceId: 'o-1',
        nuovoVigenteId: 'n-1',
      })
      expect(c.trascorsoMs).toBeGreaterThanOrEqual(0)
      expect(r.avvisi).toContain('avviso del legame')
    })

    it('annullo: stesso riallineamento con tipo ANNULLAMENTO', async () => {
      const { uc } = useCaseCon(creaTx({}))
      await uc.annulla(base)
      expect(legameMock.mock.calls[0][1]).toMatchObject({ tipo: 'ANNULLAMENTO' })
    })

    it('blocco legame con numeri scritti male: 400 prima di aprire la transazione', async () => {
      const { prisma, uc } = useCaseCon(creaTx({}))
      await expect(
        uc.rettifica({ ...base, dati, legame: { azione: 'BOH' as never } })
      ).rejects.toBeInstanceOf(BadRequestException)
      await expect(
        uc.rettifica({
          ...base,
          dati,
          legame: {
            azione: 'CONFERMA',
            righe: [{ rigaAddebitoId: 'r-1', quantita: '1,5' }],
          },
        })
      ).rejects.toBeInstanceOf(BadRequestException)
      expect(prisma.$transaction).not.toHaveBeenCalled()
      expect(legameMock).not.toHaveBeenCalled()
    })
  })

  describe('abbinamenti (4.6)', () => {
    it('carico: verifica la correzione con i dati nuovi in famiglia, prima della numerazione', async () => {
      const tx = creaTx({
        letti: [riga({ operationCode: 'R13' }), riga({ operationCode: 'R13' })],
        radice: null,
      })
      await creaUseCase(tx).rettifica({
        ...base,
        dati: { ...dati, quantity: 2, unit: 't', operationCode: 'r13' },
      })
      expect(verificaMock).toHaveBeenCalledTimes(1)
      expect(verificaMock.mock.calls[0][1]).toMatchObject({
        tenantId: TENANT,
        caricoRadiceId: 'o-1',
        numeroCarico: '5/2026',
        tipo: 'RETTIFICA',
        nuovo: {
          giorno: '2026-03-01',
          chiaveCer: '999907',
          famiglia: 'KG',
          quantita: 2000,
          classe: 'R13',
        },
      })
      expect(fotoMock).not.toHaveBeenCalled()
      expect(riallineaMock).not.toHaveBeenCalled()
      // prima dell'insert
      expect(verificaMock.mock.invocationCallOrder[0]).toBeLessThan(
        tx.wasteMovement.create.mock.invocationCallOrder[0]
      )
    })

    it('scarico senza righe (fotografia null): nessun riallineamento', async () => {
      fotoMock.mockResolvedValueOnce(null)
      const tx = creaTx({ letti: [riga({ type: 'SCARICO' }), riga({ type: 'SCARICO' })] })
      await creaUseCase(tx).annulla(base)
      expect(riallineaMock).not.toHaveBeenCalled()
    })

    it('carico: la verifica che rifiuta (409) interrompe la correzione senza insert', async () => {
      verificaMock.mockRejectedValueOnce(new ConflictException('carico abbinato'))
      const tx = creaTx({})
      await expect(creaUseCase(tx).annulla(base)).rejects.toBeInstanceOf(ConflictException)
      expect(verificaMock.mock.calls[0][1]).toMatchObject({
        tipo: 'ANNULLAMENTO',
        nuovo: undefined,
      })
      expect(tx.wasteMovement.create).not.toHaveBeenCalled()
    })

    it("scarico: fotografia prima dell'insert, riallineamento dopo, avvisi riportati", async () => {
      riallineaMock.mockResolvedValueOnce(['Abbinamento ricalcolato con FIFO.'])
      const tx = creaTx({ letti: [riga({ type: 'SCARICO' }), riga({ type: 'SCARICO' })] })
      const esito = await creaUseCase(tx).rettifica({
        ...base,
        dati: { ...dati, causale: 'AVVIO_RECUPERO' },
      })
      expect(verificaMock).not.toHaveBeenCalled()
      expect(fotoMock.mock.calls[0][3]).toBe('RETTIFICA')
      expect(fotoMock.mock.calls[0][4]).toBe('o-1')
      expect(riallineaMock.mock.calls[0][1]).toMatchObject({
        tenantId: TENANT,
        registroId: REG,
        scaricoRadiceId: 'o-1',
        tipo: 'RETTIFICA',
        prima: STATO_PRIMA,
        userId: 'u-1',
      })
      expect(fotoMock.mock.invocationCallOrder[0]).toBeLessThan(
        tx.wasteMovement.create.mock.invocationCallOrder[0]
      )
      expect(riallineaMock.mock.invocationCallOrder[0]).toBeGreaterThan(
        tx.wasteMovement.create.mock.invocationCallOrder[0]
      )
      expect(esito.avvisi).toContain('Abbinamento ricalcolato con FIFO.')
    })
  })

  it('motivo vuoto o oltre 500 caratteri: 400 senza aprire la transazione', async () => {
    const tx = creaTx({})
    const uc = creaUseCase(tx)
    await expect(uc.annulla({ ...base, motivo: '  ' })).rejects.toBeInstanceOf(BadRequestException)
    await expect(uc.annulla({ ...base, motivo: 'x'.repeat(501) })).rejects.toBeInstanceOf(
      BadRequestException
    )
    expect(tx.wasteMovement.findFirst).not.toHaveBeenCalled()
  })

  it('movimento di un’altra azienda o inesistente: 404', async () => {
    const tx = creaTx({ letti: [null] })
    await expect(creaUseCase(tx).annulla(base)).rejects.toBeInstanceOf(NotFoundException)
  })

  it('non vigente (ha una correzione o e un annullamento): 409', async () => {
    await expect(creaUseCase(creaTx({ correzioni: 1 })).annulla(base)).rejects.toBeInstanceOf(
      ConflictException
    )
    const tx = creaTx({ letti: [riga({ tipoAnnotazione: 'ANNULLAMENTO' })] })
    await expect(creaUseCase(tx).annulla(base)).rejects.toBeInstanceOf(ConflictException)
  })

  it('la radice e l’originale alla prima correzione, la radice del predecessore dopo', async () => {
    const tx = creaTx({})
    const prima = await creaUseCase(tx).rettifica({ ...base, dati })
    expect(prima.movimento.movimentoOriginaleId).toBe('o-1')

    const anello = riga({
      id: 'r-1',
      tipoAnnotazione: 'RETTIFICA',
      movimentoRettificatoId: 'o-1',
      movimentoOriginaleId: 'radice',
    })
    const tx2 = creaTx({
      letti: [anello, anello],
      radice: riga({ id: 'radice', tipoAnnotazione: 'ORDINARIA' }),
    })
    const seconda = await creaUseCase(tx2).rettifica({ ...base, movimentoId: 'r-1', dati })
    expect(seconda.movimento.movimentoOriginaleId).toBe('radice')
    expect(seconda.movimento.movimentoRettificatoId).toBe('r-1')
    expect(tx2.wasteMovement.create.mock.calls[0][0].data).toMatchObject({
      movimentoOriginaleId: 'radice',
      movimentoRettificatoId: 'r-1',
      tipoAnnotazione: 'RETTIFICA',
      firIdRicopia: null,
      ricopiaChiave: '',
      hashVersione: 2,
    })
  })

  it('invariante: la radice di una correzione deve esistere ed essere ORDINARIA', async () => {
    const anello = (originale: string | null) =>
      riga({
        id: 'r-1',
        tipoAnnotazione: 'RETTIFICA',
        movimentoRettificatoId: 'o-1',
        movimentoOriginaleId: originale,
      })
    // radice assente (colonna NULL)
    const senza = creaTx({ letti: [anello(null), anello(null)] })
    await expect(
      creaUseCase(senza).annulla({ ...base, movimentoId: 'r-1' })
    ).rejects.toBeInstanceOf(InternalServerErrorException)
    // radice che non e una ORDINARIA
    const storta = creaTx({
      letti: [anello('radice'), anello('radice')],
      radice: riga({ id: 'radice', tipoAnnotazione: 'RETTIFICA' }),
    })
    await expect(
      creaUseCase(storta).annulla({ ...base, movimentoId: 'r-1' })
    ).rejects.toBeInstanceOf(InternalServerErrorException)
    expect(storta.wasteMovement.create).not.toHaveBeenCalled()
  })

  it('lock nell’ordine fisso: progressivo, poi giacenza dei CER toccati in ordine di chiave', async () => {
    const tx = creaTx({})
    await creaUseCase(tx).rettifica({ ...base, dati: { ...dati, cerCode: '99 99 08' } })
    // 1 progressivo + 2 giacenze (CER cambiato)
    expect(tx.$executeRaw).toHaveBeenCalledTimes(3)
    const chiavi = tx.$executeRaw.mock.calls.map(c => (c[1] as string) ?? '')
    expect(chiavi[0]).toMatch(new RegExp(`^${REG}-\\d{4}$`))
    expect(chiavi[1] < chiavi[2]).toBe(true)
    expect(saldi).toHaveBeenCalledTimes(4) // 2 CER, prima e dopo
  })

  it('stesso CER (anche con o senza asterisco): una sola chiave di giacenza', async () => {
    const tx = creaTx({ letti: [riga({ cerCode: '99 99 07*' }), riga({ cerCode: '99 99 07*' })] })
    await creaUseCase(tx).annulla(base)
    expect(tx.$executeRaw).toHaveBeenCalledTimes(2)
  })

  it('P2002 sul vincolo della correzione unica: 409; su altro: errore interno', async () => {
    const errore = (target: string) =>
      new Prisma.PrismaClientKnownRequestError('dup', {
        code: 'P2002',
        clientVersion: 'x',
        meta: { target: [target] },
      })
    const tx = creaTx({})
    tx.wasteMovement.create.mockRejectedValueOnce(errore('movimento_rettificato_id'))
    await expect(creaUseCase(tx).annulla(base)).rejects.toBeInstanceOf(ConflictException)
    const tx2 = creaTx({})
    tx2.wasteMovement.create.mockRejectedValueOnce(errore('registro_id'))
    await expect(creaUseCase(tx2).annulla(base)).rejects.toBeInstanceOf(
      InternalServerErrorException
    )
  })

  it('blocco di giacenza: 409; con unita non di massa dopo la correzione solo un avviso', async () => {
    const dopoNegativo = {
      saldoComplessivoKg: -20,
      saldoMinimoGiornalieroKg: -20,
      unitaNonDiMassaCaricate: [] as string[],
    }
    saldi.mockResolvedValueOnce(SALDO_OK).mockResolvedValueOnce(dopoNegativo)
    await expect(creaUseCase(creaTx({})).annulla(base)).rejects.toBeInstanceOf(ConflictException)

    saldi
      .mockResolvedValueOnce(SALDO_OK)
      .mockResolvedValueOnce({ ...dopoNegativo, unitaNonDiMassaCaricate: ['LITRI'] })
    const r = await creaUseCase(creaTx({})).annulla(base)
    expect(r.avvisi.join(' ')).toContain('LITRI')
  })

  it('storico gia negativo che non peggiora: nessun blocco ne avviso', async () => {
    const neg = {
      saldoComplessivoKg: -20,
      saldoMinimoGiornalieroKg: -20,
      unitaNonDiMassaCaricate: [],
    }
    saldi.mockResolvedValue(neg)
    const r = await creaUseCase(creaTx({})).annulla(base)
    expect(r.avvisi).toEqual([])
  })

  it('minimo giornaliero che peggiora sotto zero: avviso e la riga resta', async () => {
    saldi
      .mockResolvedValueOnce(SALDO_OK)
      .mockResolvedValueOnce({ ...SALDO_OK, saldoMinimoGiornalieroKg: -30 })
    const r = await creaUseCase(creaTx({})).rettifica({ ...base, dati })
    expect(r.avvisi).toHaveLength(1)
  })

  it('MUD: senza conferma 409 con codice e anni; con conferma avviso', async () => {
    const tx = creaTx({ mud: [2026, 2027] })
    const e = await creaUseCase(tx)
      .annulla(base)
      .catch(x => x)
    expect(e).toBeInstanceOf(ConflictException)
    expect(e.getResponse()).toMatchObject({ error: 'REGISTRO_ANNO_MUD_PRESENTATO' })
    expect(e.getResponse().message).toContain('2026 e 2027')
    expect(tx.wasteMovement.create).not.toHaveBeenCalled()
    const ok = await creaUseCase(creaTx({ mud: [2026] })).annulla({
      ...base,
      confermaAnnoPresentato: true,
    })
    expect(ok.avvisi[0]).toContain('MUD 2026')
  })

  it('annullamento di una ricopia di FIR: avviso con il numero del FIR', async () => {
    const ricopia = riga({ firId: 'f-1', firIdRicopia: 'f-1' })
    const tx = creaTx({
      letti: [ricopia, ricopia],
      fir: { id: 'f-1', firNumber: 'FIR-77', rentriNumeroFir: null },
    })
    const r = await creaUseCase(tx).annulla(base)
    expect(r.avvisi).toEqual([
      "Questa registrazione veniva dalla ricopia del FIR FIR-77: dopo l'annullamento il FIR non si può " +
        'ricopiare di nuovo nel registro. Se il movimento va registrato, registralo a mano.',
    ])
    expect(INDICAZIONE_FIR_ANNULLATO).toContain('registralo a mano')
  })

  it('la rettifica di una ricopia non porta l’avviso del FIR', async () => {
    const ricopia = riga({ firId: 'f-1', firIdRicopia: 'f-1' })
    const r = await creaUseCase(creaTx({ letti: [ricopia, ricopia] })).rettifica({ ...base, dati })
    expect(r.avvisi).toEqual([])
  })

  it('rettifica: dati non validi (CER fuori catalogo, quantita zero) sono 400', async () => {
    const tx = creaTx({})
    tx.cERCode.count.mockResolvedValueOnce(0)
    await expect(creaUseCase(tx).rettifica({ ...base, dati })).rejects.toBeInstanceOf(
      BadRequestException
    )
    await expect(
      creaUseCase(creaTx({})).rettifica({ ...base, dati: { ...dati, quantity: 0 } })
    ).rejects.toBeInstanceOf(BadRequestException)
  })

  it('annullamento: nessuna validazione del catalogo (riga storica)', async () => {
    const tx = creaTx({ letti: [riga({ cerCode: '111111' }), riga({ cerCode: '111111' })] })
    tx.cERCode.count.mockResolvedValue(0)
    const r = await creaUseCase(tx).annulla(base)
    expect(r.movimento.cerCode).toBe('111111')
    expect(tx.cERCode.count).not.toHaveBeenCalled()
  })

  describe('causali aziendali (F2-5 task 4b)', () => {
    const VERSIONE = '00000000-0000-4000-8000-0000000000b1'
    const propria = (over: Record<string, unknown> = {}) => ({
      id: VERSIONE,
      natura: 'PROPRIA',
      codice: 'AZ_PROVA',
      verso: 'CARICO',
      descrizione: 'Prova aziendale',
      ruoloMud: 'ESCLUSO',
      codiceRentri: null,
      operazione: null,
      ordine: 0,
      validaDal: new Date('2026-01-01T00:00:00Z'),
      validaAl: null,
      ...over,
    })
    const conPropria = (tx: ReturnType<typeof creaTx>, over: Record<string, unknown> = {}) => {
      tx.causaleRegistroAzienda.findMany.mockResolvedValue([propria(over)])
      return tx
    }

    it('rettifica con causale propria: conferma la versione riletta, la salva e la mette nella risposta', async () => {
      const testa = riga({ causale: 'AZ_PROVA', causaleAziendaId: VERSIONE })
      const tx = conPropria(creaTx({ letti: [testa, testa] }))
      tx.$queryRaw.mockImplementation(async (...args: unknown[]) => {
        const testo = (args[0] as TemplateStringsArray).join('?')
        return testo.includes('FOR KEY SHARE')
          ? [{ valida_dal: new Date('2026-01-01T00:00:00Z'), valida_al: null }]
          : [{ max_num: 5, entry_hash: 'hprec' }]
      })
      const r = await creaUseCase(tx).rettifica({
        ...base,
        dati: { ...dati, causale: 'AZ_PROVA' },
      })
      expect(r.movimento.causaleDescrizione).toBe('Prova aziendale')
      expect(tx.wasteMovement.create.mock.calls[0][0].data.causaleAziendaId).toBe(VERSIONE)
      expect(
        tx.$queryRaw.mock.calls.filter(c =>
          (c[0] as TemplateStringsArray).join('?').includes('FOR KEY SHARE')
        )
      ).toHaveLength(1)
    })

    it('rettifica: versione chiusa nel frattempo -> 409 CAUSALE_MODIFICATA senza insert', async () => {
      const testa = riga({ causale: 'AZ_PROVA', causaleAziendaId: VERSIONE })
      const tx = conPropria(creaTx({ letti: [testa, testa] }))
      tx.$queryRaw.mockImplementation(async (...args: unknown[]) =>
        (args[0] as TemplateStringsArray).join('?').includes('FOR KEY SHARE')
          ? []
          : [{ max_num: 5, entry_hash: 'hprec' }]
      )
      const e = await creaUseCase(tx)
        .rettifica({ ...base, dati: { ...dati, causale: 'AZ_PROVA' } })
        .catch(x => x)
      expect(e).toBeInstanceOf(ConflictException)
      expect(e.getResponse()).toMatchObject({ error: 'CAUSALE_MODIFICATA' })
      expect(tx.wasteMovement.create).not.toHaveBeenCalled()
    })

    it('rettifica con causale di sistema: nessuna conferma di versione e causaleAziendaId null', async () => {
      const tx = creaTx({})
      await creaUseCase(tx).rettifica({ ...base, dati })
      expect(tx.wasteMovement.create.mock.calls[0][0].data.causaleAziendaId).toBeNull()
      expect(
        tx.$queryRaw.mock.calls.filter(c =>
          (c[0] as TemplateStringsArray).join('?').includes('FOR KEY SHARE')
        )
      ).toHaveLength(0)
    })

    it('annullamento: copia causale e versione della testa e non legge il catalogo nella transazione', async () => {
      const testa = riga({ causale: 'AZ_PROVA', causaleAziendaId: VERSIONE })
      const tx = creaTx({ letti: [testa, testa] })
      const r = await creaUseCase(tx).annulla(base)
      const data = tx.wasteMovement.create.mock.calls[0][0].data
      expect(data.causale).toBe('AZ_PROVA')
      expect(data.causaleAziendaId).toBe(VERSIONE)
      expect(tx.causaleRegistro.findMany).not.toHaveBeenCalled()
      // Catalogo non disponibile fuori transazione (mock senza lettore): vale il codice.
      expect(r.movimento.causaleDescrizione).toBe('AZ_PROVA')
    })

    it('annullamento: la descrizione viene dal catalogo letto dopo il commit', async () => {
      const testa = riga({ causale: 'AZ_PROVA', causaleAziendaId: VERSIONE })
      const tx = creaTx({ letti: [testa, testa] })
      const prisma = {
        $transaction: jest.fn(async (fn: any) => fn(tx)),
        causaleRegistro: { findMany: jest.fn().mockResolvedValue(righeCausaliSistema()) },
        causaleRegistroAzienda: {
          findMany: jest
            .fn()
            .mockResolvedValue([propria({ validaAl: new Date('2026-02-28T00:00:00Z') })]),
        },
      }
      const uc = new CorreggiMovimentoUseCase(prisma as never, logger as never)
      const r = await uc.annulla(base)
      expect(r.movimento.causaleDescrizione).toBe('Prova aziendale')
    })
  })

  it('quantita non positiva: 400 prima dei lock e del controllo MUD', async () => {
    const tx = creaTx({ mud: [2026] })
    await expect(
      creaUseCase(tx).rettifica({ ...base, dati: { ...dati, quantity: 0 } })
    ).rejects.toBeInstanceOf(BadRequestException)
    expect(tx.$executeRaw).not.toHaveBeenCalled()
    expect(tx.mUDReport.findMany).not.toHaveBeenCalled()
  })

  it('audit nella transazione con id e numeri', async () => {
    const tx = creaTx({})
    await creaUseCase(tx).rettifica({ ...base, dati })
    const log = tx.activityLog.create.mock.calls[0][0].data
    expect(log.action).toBe('REGISTRO_MOVIMENTO_RETTIFICATO')
    expect(log.metadata).toMatchObject({
      predecessoreId: 'o-1',
      radiceId: 'o-1',
      radiceNumero: '5/2026',
      correzioneId: 'n-1',
      motivo: 'errore',
    })
  })
})
