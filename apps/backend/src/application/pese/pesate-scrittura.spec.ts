import { Prisma } from '@prisma/client'
import {
  chiaveDerivata,
  inserisciPesataManuale,
  inserisciPesataTaraAnagrafica,
  leggiOraStrumento,
  verificaCoerenzaFonteModo,
  AVVISO_ALIBI_ESTERNO,
  type ContestoPesata,
} from './pesate-scrittura'
import { AlibiGiaUsatoError, RegolaPesataError } from './errori-pese'

const T = 'aaaaaaaa-0000-4000-8000-000000000001'
const U = 'bbbbbbbb-0000-4000-8000-000000000002'
const ACC = 'cccccccc-0000-4000-8000-000000000003'
const CH = 'dddddddd-0000-4000-8000-000000000004'
const S = 'eeeeeeee-0000-4000-8000-000000000005'
const ADESSO = new Date('2026-10-30T10:00:00Z')

const strumento = {
  id: S,
  registroId: null,
  descrizione: 'Pesa',
  costruttore: null,
  modello: null,
  matricola: null,
  portataMaxKg: 60000,
  divisioneKg: 0.05,
  dataUltimaVerificazione: '2026-01-10',
  attivo: true,
}

describe('pesate-scrittura', () => {
  let tx: any
  let allegati: any
  const ctx = (extra: Partial<ContestoPesata> = {}): ContestoPesata => ({
    tenantId: T,
    utenteId: U,
    accessoId: ACC,
    ordine: 1,
    modo: 'DOPPIA',
    chiaveIdempotenza: CH,
    adesso: ADESSO,
    strumento,
    allegati,
    ...extra,
  })
  const dati = (extra: Record<string, unknown> = {}) => ({
    pesoKg: 24000,
    motivo: 'bilancia senza stampante',
    stabileDichiarato: true,
    ...extra,
  })

  beforeEach(() => {
    tx = {
      pesata: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn(async ({ data }: any) => ({ id: 'p1', ...data })),
      },
      $queryRaw: jest.fn(),
    }
    allegati = { salva: jest.fn().mockResolvedValue({ id: 'al1', sha256: 'f'.repeat(64) }) }
  })

  describe('coerenza fonte/modo (422 prima del database)', () => {
    it.each([
      ['SINGOLA', 2, 'MANUALE'],
      ['SINGOLA', 1, 'TARA_ANAGRAFICA'],
      ['DOPPIA', 2, 'TARA_ANAGRAFICA'],
      ['TARA_ANAGRAFICA', 1, 'TARA_ANAGRAFICA'],
      ['TARA_ANAGRAFICA', 2, 'MANUALE'],
      ['DOPPIA', 3, 'MANUALE'],
    ] as const)('modo %s ordine %s fonte %s: rifiutata', (modo, ordine, fonte) => {
      expect(() => verificaCoerenzaFonteModo(modo, ordine, fonte)).toThrow(RegolaPesataError)
    })

    it.each([
      ['SINGOLA', 1, 'MANUALE'],
      ['DOPPIA', 1, 'MANUALE'],
      ['DOPPIA', 2, 'STRUMENTO'],
      ['TARA_ANAGRAFICA', 1, 'MANUALE'],
      ['TARA_ANAGRAFICA', 2, 'TARA_ANAGRAFICA'],
    ] as const)('modo %s ordine %s fonte %s: ammessa', (modo, ordine, fonte) => {
      expect(() => verificaCoerenzaFonteModo(modo, ordine, fonte)).not.toThrow()
    })
  })

  describe('pesata manuale', () => {
    it('scrive pesata MANUALE con impronta, operatore e motivo', async () => {
      const r = await inserisciPesataManuale(tx, ctx(), dati())

      const d = tx.pesata.create.mock.calls[0][0].data
      expect(d).toMatchObject({
        fonte: 'MANUALE',
        ordine: 1,
        strumentoId: S,
        operatoreId: U,
        motivoManuale: 'bilancia senza stampante',
        stabile: true,
        pesoKg: 24000,
        chiaveIdempotenza: CH,
      })
      expect(d.impronta).toMatch(/^[0-9a-f]{64}$/)
      expect(r.avvisi).toEqual([])
    })

    it.each([
      ['senza motivo', { motivo: '  ' }, 'motivo'],
      ['stabile non confermato', { stabileDichiarato: false }, 'stabile'],
      ['peso zero', { pesoKg: 0 }, 'maggiore di zero'],
      ['peso oltre la portata', { pesoKg: 60000.05 }, 'portata massima'],
      ['tre decimali', { pesoKg: 100.123 }, 'due decimali'],
      ['ora nel futuro', { oraStrumento: '2026-10-30T12:00:00+01:00' }, 'futuro'],
      ['ora senza fuso', { oraStrumento: '2026-10-30T10:00' }, 'fuso orario'],
    ])('%s: 422', async (_n, extra, testo) => {
      await expect(inserisciPesataManuale(tx, ctx(), dati(extra))).rejects.toThrow(
        new RegExp(testo)
      )
      expect(tx.pesata.create).not.toHaveBeenCalled()
    })

    it('strumento registrato E esterno insieme, o nessuno dei due: 422', async () => {
      await expect(
        inserisciPesataManuale(tx, ctx(), dati({ strumentoEsterno: 'Pesa del cliente' }))
      ).rejects.toThrow(RegolaPesataError)
      await expect(inserisciPesataManuale(tx, ctx({ strumento: null }), dati())).rejects.toThrow(
        RegolaPesataError
      )
    })

    it('arrotondamento ai margini: 0,01 e 99.999.999,99 ammessi, 0,005 e 99.999.999,995 no', async () => {
      const libero = { strumento: null }
      const ext = { strumentoEsterno: 'Pesa esterna' }
      await expect(
        inserisciPesataManuale(tx, ctx(libero), dati({ ...ext, pesoKg: 0.01 }))
      ).resolves.toBeDefined()
      await expect(
        inserisciPesataManuale(tx, ctx(libero), dati({ ...ext, pesoKg: 99_999_999.99 }))
      ).resolves.toBeDefined()
      await expect(
        inserisciPesataManuale(tx, ctx(libero), dati({ ...ext, pesoKg: 0.005 }))
      ).rejects.toThrow(/due decimali/)
      await expect(
        inserisciPesataManuale(tx, ctx(libero), dati({ ...ext, pesoKg: 99_999_999.995 }))
      ).rejects.toThrow(RegolaPesataError)
    })

    it('multiplo della divisione in millesimi: 1250,55 con e = 0,05 non da avviso, 1250,57 si', async () => {
      const ok = await inserisciPesataManuale(tx, ctx(), dati({ pesoKg: 1250.55 }))
      const no = await inserisciPesataManuale(tx, ctx(), dati({ pesoKg: 1250.57 }))

      expect(ok.avvisi).toEqual([])
      expect(no.avvisi.join(' ')).toMatch(/multiplo della divisione/)
    })

    it('avvisi D7 riportati senza bloccare (verificazione scaduta, sotto 20 divisioni)', async () => {
      const r = await inserisciPesataManuale(
        tx,
        ctx({ strumento: { ...strumento, dataUltimaVerificazione: '2020-01-01' } }),
        dati({ pesoKg: 0.5 })
      )

      expect(r.avvisi.join(' ')).toMatch(/scaduta/)
      expect(r.avvisi.join(' ')).toMatch(/20 divisioni/)
      expect(tx.pesata.create).toHaveBeenCalled()
    })

    it('alibi già usato con lo stesso strumento registrato: AlibiGiaUsatoError', async () => {
      tx.pesata.findFirst.mockResolvedValue({ id: 'altra' })

      await expect(inserisciPesataManuale(tx, ctx(), dati({ alibiId: 'A-100' }))).rejects.toThrow(
        AlibiGiaUsatoError
      )
      expect(tx.pesata.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({ where: { tenantId: T, strumentoId: S, alibiId: 'A-100' } })
      )
    })

    it('strumento esterno con alibi già visto: solo avviso', async () => {
      tx.pesata.findFirst.mockResolvedValue({ id: 'altra' })

      const r = await inserisciPesataManuale(
        tx,
        ctx({ strumento: null }),
        dati({ strumentoEsterno: 'Pesa del cliente', alibiId: 'A-100' })
      )

      expect(r.avvisi).toContain(AVVISO_ALIBI_ESTERNO)
      expect(AVVISO_ALIBI_ESTERNO).toBe(
        'Memoria alibi già usata con la stessa descrizione dello strumento.'
      )
    })

    it('salva l’allegato nella stessa transazione e ne mette lo sha256 nell’impronta', async () => {
      const file = {
        nomeFile: 's.pdf',
        mimeDichiarato: 'application/pdf',
        contenuto: Buffer.from('x'),
      }

      await inserisciPesataManuale(tx, ctx(), dati(), file)
      const senza = tx.pesata.create.mock.calls[0][0].data.impronta
      allegati.salva.mockClear()
      tx.pesata.create.mockClear()
      await inserisciPesataManuale(tx, ctx(), dati())
      const senzaAllegato = tx.pesata.create.mock.calls[0][0].data

      expect(allegati.salva).not.toHaveBeenCalled()
      expect(senzaAllegato.allegatoId).toBeNull()
      expect(senza).not.toBe(senzaAllegato.impronta)
    })
  })

  describe('ora dello strumento', () => {
    it('02:30+02:00 e 02:30+01:00 del cambio ora sono istanti diversi', () => {
      const a = leggiOraStrumento('2026-10-25T02:30+02:00') as Date
      const b = leggiOraStrumento('2026-10-25T02:30+01:00') as Date
      expect(b.getTime() - a.getTime()).toBe(60 * 60 * 1000)
    })
  })

  describe('tara dichiarata', () => {
    it('copia peso e data dell’automezzo letto con FOR UPDATE; chiave derivata diversa', async () => {
      const agg = new Date('2026-09-01T08:00:00.000Z')
      tx.$queryRaw.mockResolvedValue([
        { tara_kg: new Prisma.Decimal('7120.50'), tara_aggiornata_il: agg },
      ])

      const r = await inserisciPesataTaraAnagrafica(
        tx,
        {
          tenantId: T,
          utenteId: U,
          accessoId: ACC,
          modo: 'TARA_ANAGRAFICA',
          chiaveIdempotenza: CH,
          adesso: ADESSO,
        },
        'ffffffff-0000-4000-8000-00000000000f'
      )

      const d = tx.pesata.create.mock.calls[0][0].data
      expect(d).toMatchObject({
        fonte: 'TARA_ANAGRAFICA',
        ordine: 2,
        pesoKg: '7120.50',
        taraAggiornataIl: agg,
        automezzoId: 'ffffffff-0000-4000-8000-00000000000f',
        operatoreId: U,
      })
      expect(d.chiaveIdempotenza).toBe(chiaveDerivata(CH, 2))
      expect(d.chiaveIdempotenza).not.toBe(CH)
      expect(d.chiaveIdempotenza).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
      )
      expect(String(tx.$queryRaw.mock.calls[0][0].join(' '))).toMatch(/FOR UPDATE/)
      expect(r.pesoKg).toBe(7120.5)
    })

    it('automezzo senza tara: 422 "L’automezzo non ha una tara registrata."', async () => {
      tx.$queryRaw.mockResolvedValue([{ tara_kg: null, tara_aggiornata_il: null }])

      await expect(
        inserisciPesataTaraAnagrafica(
          tx,
          {
            tenantId: T,
            utenteId: U,
            accessoId: ACC,
            modo: 'TARA_ANAGRAFICA',
            chiaveIdempotenza: CH,
            adesso: ADESSO,
          },
          'ffffffff-0000-4000-8000-00000000000f'
        )
      ).rejects.toThrow("L'automezzo non ha una tara registrata.")
    })
  })
})
