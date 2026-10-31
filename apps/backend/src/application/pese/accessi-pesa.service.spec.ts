import { Prisma } from '@prisma/client'
import { AccessiPesaService, traduciErroreDatabase } from './accessi-pesa.service'
import {
  AlibiGiaUsatoError,
  DatiPesaNonValidiError,
  RegolaPesataError,
  RuoloPesaInsufficienteError,
  StatoAccessoNonValidoError,
} from './errori-pese'
import { RegistroNonTrovatoError } from '../registro/registri.service'
import { MSG_TRIGGER } from './messaggi-trigger-pese'

jest.mock('./viste-accesso', () => ({
  leggiVistaAccesso: jest.fn(async (_tx: unknown, _t: string, id: string) => ({ id })),
  leggiRiepiloghi: jest.fn(async () => []),
}))

const T = 'aaaaaaaa-0000-4000-8000-000000000001'
const U = 'bbbbbbbb-0000-4000-8000-000000000002'
const R = 'cccccccc-0000-4000-8000-000000000003'
const ACC = 'dddddddd-0000-4000-8000-000000000004'
const AUTO = 'eeeeeeee-0000-4000-8000-000000000005'
const CH = '11111111-0000-4000-8000-000000000006'
const operatore = { id: U, ruolo: 'OPERATOR' as const }
const admin = { id: U, ruolo: 'ADMIN' as const }

const pesata = {
  pesoKg: 24000,
  strumentoEsterno: 'Pesa del cliente',
  motivo: 'bilancia senza stampante',
  stabileDichiarato: true,
}
const apertura = (extra: Record<string, unknown> = {}) => ({
  chiaveIdempotenza: CH,
  verso: 'CARICO' as const,
  modo: 'DOPPIA' as const,
  pesata,
  ...extra,
})

describe('AccessiPesaService (Prisma finto)', () => {
  let tx: any
  let service: AccessiPesaService
  let registri: any
  let automezzi: any
  let aggiornamenti: any[]

  beforeEach(() => {
    aggiornamenti = []
    tx = {
      $executeRaw: jest.fn().mockResolvedValue(1),
      $queryRaw: jest.fn().mockImplementation(async (strings: TemplateStringsArray) =>
        /accessi_pesa/.test(strings.join(''))
          ? [{ id: ACC }]
          : [
              {
                tara_kg: new Prisma.Decimal('7000'),
                tara_aggiornata_il: new Date('2026-09-01T00:00:00Z'),
              },
            ]
      ),
      pesata: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn(async ({ data }: any) => ({ id: `p${data.ordine}`, ...data })),
      },
      accessoPesa: {
        findFirst: jest.fn(),
        aggregate: jest.fn().mockResolvedValue({ _max: { numero: 4 } }),
        create: jest.fn(async ({ data }: any) => ({ id: ACC, ...data })),
        update: jest.fn(async (a: any) => {
          aggiornamenti.push(a)
          return {}
        }),
      },
      cERCode: { findMany: jest.fn().mockResolvedValue([{ code: '20 01 01' }]) },
      collegamentoAccesso: { count: jest.fn().mockResolvedValue(0) },
      rettificaPeso: { findMany: jest.fn().mockResolvedValue([]) },
      activityLog: { create: jest.fn().mockResolvedValue({}) },
    }
    registri = { risolviInLettura: jest.fn().mockResolvedValue({ id: R, attivo: true }) }
    automezzi = {
      leggiPerAccesso: jest
        .fn()
        .mockResolvedValue({ id: AUTO, targa: 'AB123CD', targaRimorchio: 'XY99', attivo: true }),
    }
    const strumenti = { leggiPerPesata: jest.fn() }
    const allegati = { salva: jest.fn() }
    service = new AccessiPesaService(
      { $transaction: (fn: any) => fn(tx) } as any,
      registri,
      strumenti as any,
      automezzi,
      allegati as any
    )
    ;(service as any).adesso = () => new Date('2026-10-30T10:00:00Z')
  })

  const accessoAperto = (extra: Record<string, unknown> = {}) => ({
    id: ACC,
    tenantId: T,
    stato: 'APERTO',
    modo: 'DOPPIA',
    verso: 'CARICO',
    ...extra,
  })

  describe('apri', () => {
    it('registro predefinito se assente; numero = massimo + 1 con lock; DOPPIA resta APERTO', async () => {
      await service.apri(T, operatore, apertura())

      expect(registri.risolviInLettura).toHaveBeenCalledWith(T, undefined)
      const dati = tx.accessoPesa.create.mock.calls[0][0].data
      expect(dati).toMatchObject({
        registroId: R,
        numero: 5,
        anno: 2026,
        modo: 'DOPPIA',
        apertoDa: U,
      })
      expect(aggiornamenti).toHaveLength(0)
      expect(tx.pesata.create).toHaveBeenCalledTimes(1)
    })

    it('registro disattivato: RegistroNonTrovatoError', async () => {
      registri.risolviInLettura.mockResolvedValue({ id: R, attivo: false })

      await expect(service.apri(T, operatore, apertura())).rejects.toThrow(RegistroNonTrovatoError)
    })

    it('targa normalizzata; targa non valida: 400', async () => {
      await service.apri(T, operatore, apertura({ targa: 'ab 123-cd' }))
      expect(tx.accessoPesa.create.mock.calls[0][0].data.targa).toBe('AB123CD')

      await expect(service.apri(T, operatore, apertura({ targa: '!' }))).rejects.toThrow(
        'Targa non valida.'
      )
    })

    it('con automezzoId copia le targhe dell’anagrafica', async () => {
      await service.apri(T, operatore, apertura({ automezzoId: AUTO, targa: 'ZZ999ZZ' }))

      expect(tx.accessoPesa.create.mock.calls[0][0].data).toMatchObject({
        automezzoId: AUTO,
        targa: 'AB123CD',
        targaRimorchio: 'XY99',
      })
    })

    it('CER normalizzato e verificato nel catalogo; sconosciuto: 400', async () => {
      await service.apri(T, operatore, apertura({ cerCode: '200101' }))
      expect(tx.accessoPesa.create.mock.calls[0][0].data.cerCode).toBe('20 01 01')

      tx.cERCode.findMany.mockResolvedValue([])
      await expect(service.apri(T, operatore, apertura({ cerCode: '999999' }))).rejects.toThrow(
        DatiPesaNonValidiError
      )
    })

    it('SINGOLA: pesata 1 e chiusura nella stessa transazione', async () => {
      await service.apri(T, operatore, apertura({ modo: 'SINGOLA' }))

      expect(tx.pesata.create).toHaveBeenCalledTimes(1)
      expect(aggiornamenti[0].data).toMatchObject({ stato: 'CHIUSO', chiusoDa: U })
      const azioni = tx.activityLog.create.mock.calls.map((c: any) => c[0].data.action)
      expect(azioni).toEqual(['PESA_ACCESSO_APERTO', 'PESA_ACCESSO_CHIUSO'])
    })

    it('TARA_ANAGRAFICA: richiede un automezzo, poi pesata 2 con la tara e chiusura', async () => {
      await expect(
        service.apri(T, operatore, apertura({ modo: 'TARA_ANAGRAFICA' }))
      ).rejects.toThrow(RegolaPesataError)

      await service.apri(T, operatore, apertura({ modo: 'TARA_ANAGRAFICA', automezzoId: AUTO }))

      expect(tx.pesata.create).toHaveBeenCalledTimes(2)
      expect(tx.pesata.create.mock.calls[1][0].data).toMatchObject({
        fonte: 'TARA_ANAGRAFICA',
        pesoKg: '7000.00',
      })
      expect(aggiornamenti[0].data.stato).toBe('CHIUSO')
    })

    it('TARA_ANAGRAFICA con automezzo senza tara: 422 e nessuna chiusura', async () => {
      tx.$queryRaw.mockResolvedValue([{ tara_kg: null, tara_aggiornata_il: null }])

      await expect(
        service.apri(T, operatore, apertura({ modo: 'TARA_ANAGRAFICA', automezzoId: AUTO }))
      ).rejects.toThrow("L'automezzo non ha una tara registrata.")
      expect(aggiornamenti).toHaveLength(0)
    })

    it('netto NON_VALIDO alla chiusura (lordo <= tara): 422 col messaggio di D6, nessun UPDATE di stato', async () => {
      tx.$queryRaw.mockResolvedValue([
        {
          tara_kg: new Prisma.Decimal('25000'),
          tara_aggiornata_il: new Date('2026-09-01T00:00:00Z'),
        },
      ])

      const esito = service.apri(
        T,
        operatore,
        apertura({ modo: 'TARA_ANAGRAFICA', automezzoId: AUTO })
      )

      await expect(esito).rejects.toThrow(RegolaPesataError)
      await expect(esito).rejects.toThrow(/non supera la tara/)
      expect(aggiornamenti).toHaveLength(0)
    })

    it('stessa chiaveIdempotenza: nessuna scrittura, giaRegistrata', async () => {
      tx.pesata.findFirst.mockResolvedValue({ accessoId: ACC })

      const v = await service.apri(T, operatore, apertura())

      expect(v).toMatchObject({ id: ACC, giaRegistrata: true })
      expect(tx.accessoPesa.create).not.toHaveBeenCalled()
    })

    it('ruolo di sola lettura: 403 prima di toccare il database', async () => {
      await expect(service.apri(T, { id: U, ruolo: 'VIEWER' as any }, apertura())).rejects.toThrow(
        RuoloPesaInsufficienteError
      )
      expect(registri.risolviInLettura).not.toHaveBeenCalled()
    })
  })

  describe('secondaPesata', () => {
    const seconda = {
      chiaveIdempotenza: '22222222-0000-4000-8000-000000000007',
      pesata: { ...pesata, pesoKg: 7000 },
    }
    beforeEach(() => {
      tx.accessoPesa.findFirst.mockResolvedValue(accessoAperto())
      tx.pesata.findFirst.mockImplementation(async ({ where }: any) =>
        where.ordine === 1
          ? {
              id: 'p1',
              fonte: 'MANUALE',
              pesoKg: new Prisma.Decimal('24000'),
              stabile: true,
              oraStrumento: null,
              oraRicezione: new Date(),
              taraAggiornataIl: null,
              automezzoId: null,
            }
          : null
      )
    })

    it('prende advisory lock e FOR UPDATE PRIMA di leggere pesate e inserire; poi chiude', async () => {
      const ordine: string[] = []
      tx.$executeRaw.mockImplementation(async () => ordine.push('advisory'))
      tx.$queryRaw.mockImplementation(async () => {
        ordine.push('for-update')
        return [{ id: ACC }]
      })
      tx.pesata.create.mockImplementation(async ({ data }: any) => {
        ordine.push('insert-pesata')
        return { id: 'p2', ...data }
      })

      await service.secondaPesata(T, operatore, ACC, seconda)

      // 1° advisory della chiave di idempotenza, poi advisory dell'accesso, poi FOR UPDATE, poi INSERT
      expect(ordine).toEqual(['advisory', 'advisory', 'for-update', 'insert-pesata'])
      expect(aggiornamenti[0].data.stato).toBe('CHIUSO')
    })

    it.each([
      ['CHIUSO', 'DOPPIA'],
      ['ANNULLATO', 'DOPPIA'],
      ['APERTO', 'SINGOLA'],
    ])('accesso %s modo %s: 409', async (stato, modo) => {
      tx.accessoPesa.findFirst.mockResolvedValue(accessoAperto({ stato, modo }))

      await expect(service.secondaPesata(T, operatore, ACC, seconda)).rejects.toThrow(
        StatoAccessoNonValidoError
      )
      expect(tx.pesata.create).not.toHaveBeenCalled()
    })

    it('accesso inesistente (o di un’altra azienda): 404', async () => {
      tx.$queryRaw.mockResolvedValue([])

      await expect(service.secondaPesata(T, operatore, ACC, seconda)).rejects.toThrow(
        'Accesso non trovato.'
      )
    })

    it('ora strumento precedente alla prima: 422', async () => {
      tx.pesata.findFirst.mockImplementation(async ({ where }: any) =>
        where.ordine === 1
          ? {
              id: 'p1',
              fonte: 'MANUALE',
              pesoKg: new Prisma.Decimal('24000'),
              stabile: true,
              oraStrumento: new Date('2026-10-30T09:00:00Z'),
              oraRicezione: new Date(),
              taraAggiornataIl: null,
              automezzoId: null,
            }
          : null
      )

      await expect(
        service.secondaPesata(T, operatore, ACC, {
          ...seconda,
          pesata: { ...seconda.pesata, oraStrumento: '2026-10-30T09:30:00+01:00' },
        })
      ).rejects.toThrow(/precedente alla prima/)
    })

    it('lordo <= tara: 422 e l’accesso non viene chiuso', async () => {
      await expect(
        service.secondaPesata(T, operatore, ACC, {
          ...seconda,
          pesata: { ...seconda.pesata, pesoKg: 24000 },
        })
      ).rejects.toThrow(RegolaPesataError)
      expect(aggiornamenti).toHaveLength(0)
    })

    it('stessa chiave già registrata: giaRegistrata, nessuna scrittura', async () => {
      tx.pesata.findFirst.mockResolvedValue({ accessoId: ACC })

      const v = await service.secondaPesata(T, operatore, ACC, seconda)

      expect(v).toMatchObject({ giaRegistrata: true })
      expect(tx.pesata.create).not.toHaveBeenCalled()
    })
  })

  describe('annulla', () => {
    beforeEach(() => tx.accessoPesa.findFirst.mockResolvedValue(accessoAperto()))

    it('APERTO: operatore ok, FOR UPDATE preso, audit', async () => {
      await service.annulla(T, operatore, ACC, 'errore')

      expect(aggiornamenti[0].data).toMatchObject({
        stato: 'ANNULLATO',
        annullatoDa: U,
        motivoAnnullamento: 'errore',
      })
      expect(tx.activityLog.create.mock.calls[0][0].data.action).toBe('PESA_ACCESSO_ANNULLATO')
    })

    it('CHIUSO: l’operatore no (403), l’amministratore sì', async () => {
      tx.accessoPesa.findFirst.mockResolvedValue(accessoAperto({ stato: 'CHIUSO' }))

      await expect(service.annulla(T, operatore, ACC, 'errore')).rejects.toThrow(
        RuoloPesaInsufficienteError
      )
      await expect(service.annulla(T, admin, ACC, 'errore')).resolves.toBeDefined()
    })

    it('con collegamenti attivi: 409 "Prima revocare i collegamenti."', async () => {
      tx.collegamentoAccesso.count.mockResolvedValue(1)

      await expect(service.annulla(T, admin, ACC, 'errore')).rejects.toThrow(
        'Prima revocare i collegamenti.'
      )
      expect(aggiornamenti).toHaveLength(0)
    })

    it('già annullato: 409; motivo vuoto: 400', async () => {
      tx.accessoPesa.findFirst.mockResolvedValue(accessoAperto({ stato: 'ANNULLATO' }))
      await expect(service.annulla(T, admin, ACC, 'x')).rejects.toThrow(StatoAccessoNonValidoError)
      await expect(service.annulla(T, admin, ACC, '  ')).rejects.toThrow(DatiPesaNonValidiError)
    })
  })

  describe('apri: controlli aggiuntivi', () => {
    it('automezzo disattivato: 422 italiano', async () => {
      automezzi.leggiPerAccesso.mockResolvedValue({
        id: AUTO,
        targa: 'AB123CD',
        targaRimorchio: null,
        attivo: false,
      })

      await expect(service.apri(T, operatore, apertura({ automezzoId: AUTO }))).rejects.toThrow(
        "L'automezzo non è attivo."
      )
      expect(tx.accessoPesa.create).not.toHaveBeenCalled()
    })

    it('strumento di un’altra sede: 422; strumento senza sede (condiviso): ok', async () => {
      const strumenti = (service as any).strumenti
      strumenti.leggiPerPesata.mockResolvedValue({
        id: 's',
        registroId: 'altro-registro',
        attivo: true,
        portataMaxKg: null,
        divisioneKg: null,
        dataUltimaVerificazione: null,
      })
      const conStrumento = apertura({
        pesata: { ...pesata, strumentoEsterno: null, strumentoId: 's' },
      })

      await expect(service.apri(T, operatore, conStrumento)).rejects.toThrow(
        'Lo strumento appartiene a un’altra sede.'
      )

      strumenti.leggiPerPesata.mockResolvedValue({
        id: 's',
        registroId: null,
        attivo: true,
        portataMaxKg: null,
        divisioneKg: null,
        dataUltimaVerificazione: null,
      })
      await expect(service.apri(T, operatore, conStrumento)).resolves.toBeDefined()
    })

    it('tara dichiarata: l’automezzo è bloccato (FOR NO KEY UPDATE) PRIMA di creare l’accesso', async () => {
      const ordine: string[] = []
      tx.$queryRaw.mockImplementation(async (strings: TemplateStringsArray) => {
        const q = strings.join('')
        if (/FOR NO KEY UPDATE/.test(q)) ordine.push('automezzo')
        return /accessi_pesa/.test(q)
          ? [{ id: ACC }]
          : [
              {
                tara_kg: new Prisma.Decimal('7000'),
                tara_aggiornata_il: new Date('2026-09-01T00:00:00Z'),
              },
            ]
      })
      tx.accessoPesa.create.mockImplementation(async ({ data }: any) => {
        ordine.push('accesso')
        return { id: ACC, ...data }
      })

      await service.apri(T, operatore, apertura({ modo: 'TARA_ANAGRAFICA', automezzoId: AUTO }))

      expect(ordine.slice(0, 2)).toEqual(['automezzo', 'accesso'])
    })

    it('le transazioni hanno timeout e maxWait espliciti', async () => {
      const opzioni: any[] = []
      ;(service as any).prisma = { $transaction: (fn: any, o: any) => (opzioni.push(o), fn(tx)) }

      await service.apri(T, operatore, apertura())

      expect(opzioni[0]).toEqual({ timeout: 15_000, maxWait: 5_000 })
    })
  })

  describe('annulla: audit', () => {
    it('salva solo la lunghezza del motivo, non il testo libero', async () => {
      tx.accessoPesa.findFirst.mockResolvedValue(accessoAperto())

      await service.annulla(T, admin, ACC, 'Mario Rossi ha sbagliato')

      const meta = tx.activityLog.create.mock.calls[0][0].data.metadata
      expect(meta).toMatchObject({ motivoLunghezza: 'Mario Rossi ha sbagliato'.length })
      expect(JSON.stringify(meta)).not.toContain('Mario')
    })
  })

  describe('traduciErroreDatabase', () => {
    const p2002 = (target: unknown) =>
      new Prisma.PrismaClientKnownRequestError('Unique constraint failed on the fields', {
        code: 'P2002',
        clientVersion: 'x',
        meta: { target },
      })

    it('P2002: riconosce l’unicità dalle colonne di meta.target', async () => {
      expect(await traduciErroreDatabase(p2002(['strumento_id', 'alibi_id']))).toBeInstanceOf(
        AlibiGiaUsatoError
      )
      expect(await traduciErroreDatabase(p2002(['tenant_id', 'chiave_idempotenza']))).toEqual(
        new StatoAccessoNonValidoError('Questa pesata è già stata registrata.')
      )
      expect(await traduciErroreDatabase(p2002(['registro_id', 'anno', 'numero']))).toEqual(
        new StatoAccessoNonValidoError('Numero di accesso già assegnato: riprovare.')
      )
      expect(await traduciErroreDatabase(p2002(['accesso_id', 'ordine']))).toBeInstanceOf(
        StatoAccessoNonValidoError
      )
    })

    it('P2002 senza target: rilegge il database; se non trova nulla, conflitto generico in italiano', async () => {
      const trovato = new AlibiGiaUsatoError()
      expect(await traduciErroreDatabase(p2002(undefined), async () => trovato)).toBe(trovato)
      const generico = (await traduciErroreDatabase(p2002(undefined), async () => null)) as Error
      expect(generico).toBeInstanceOf(StatoAccessoNonValidoError)
      expect(generico.message).toMatch(/riprovare/)
    })

    it('trigger: testo esatto dei messaggi della migration', async () => {
      const raw = (m: string) => new Error(`Raw query failed. Code: P0001. Message: ERROR: ${m}`)
      expect(await traduciErroreDatabase(raw(MSG_TRIGGER.accessoNonAperto))).toBeInstanceOf(
        StatoAccessoNonValidoError
      )
      expect(await traduciErroreDatabase(raw(MSG_TRIGGER.collegamentoAttivo))).toEqual(
        new StatoAccessoNonValidoError('Prima revocare i collegamenti.')
      )
      expect(await traduciErroreDatabase(raw(MSG_TRIGGER.singolaSoloOrdine1))).toBeInstanceOf(
        RegolaPesataError
      )
    })

    it('"riga immutabile" e errori sconosciuti restano guasti, non diventano regole', async () => {
      for (const m of ['pesate: riga immutabile', 'connessione persa', 'pesate: ordine strano']) {
        const e = new Error(m)
        expect(await traduciErroreDatabase(e)).toBe(e)
      }
    })
  })
})
