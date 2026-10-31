import { Prisma } from '@prisma/client'
import { CollegamentiAccessoService } from './collegamenti-accesso.service'
import {
  CollegamentoNonTrovatoError,
  CollegamentoNonValidoError,
  DatiPesaNonValidiError,
  RuoloPesaInsufficienteError,
  StatoAccessoNonValidoError,
} from './errori-pese'

jest.mock('./viste-accesso', () => ({
  leggiVistaAccesso: jest.fn(async (_tx: unknown, _t: string, id: string) => ({
    id,
    netto: { stato: 'CALCOLATO', nettoKg: 12345 },
  })),
}))
jest.mock('./movimenti-collegati', () => ({
  leggiRadiceOrdinaria: jest.fn(),
  leggiMovimentiCollegati: jest.fn(),
}))
import { leggiMovimentiCollegati, leggiRadiceOrdinaria } from './movimenti-collegati'

const T = 'aaaaaaaa-0000-4000-8000-000000000001'
const U = 'bbbbbbbb-0000-4000-8000-000000000002'
const REG = 'cccccccc-0000-4000-8000-000000000003'
const ACC = 'dddddddd-0000-4000-8000-000000000004'
const FIR = 'eeeeeeee-0000-4000-8000-000000000005'
const MOV = 'ffffffff-0000-4000-8000-000000000006'
const COL = '12121212-0000-4000-8000-000000000007'
const operatore = { id: U, ruolo: 'OPERATOR' as const }
const admin = { id: U, ruolo: 'ADMIN' as const }
const MSG_GIA = "L'accesso o il documento è già collegato."

describe('CollegamentiAccessoService (Prisma finto)', () => {
  let tx: any
  let service: CollegamentiAccessoService
  let ordine: string[]

  const accesso = (extra: Record<string, unknown> = {}) => ({
    id: ACC,
    tenantId: T,
    registroId: REG,
    verso: 'CARICO',
    stato: 'CHIUSO',
    cerCode: null,
    ...extra,
  })
  const fir = (extra: Record<string, unknown> = {}) => ({
    id: FIR,
    status: 'AWAITING_CARRIER',
    firNumber: 'F1',
    rentriNumeroFir: null,
    rentriStatoFormulario: null,
    unit: 'KG',
    ...extra,
  })

  beforeEach(() => {
    ordine = []
    tx = {
      $executeRaw: jest.fn(async (_s: unknown, ...v: unknown[]) => {
        ordine.push(`advisory:${String(v[0])}`)
        return 1
      }),
      $queryRaw: jest.fn(async () => {
        ordine.push('for-update')
        return [{ id: ACC }]
      }),
      accessoPesa: { findFirst: jest.fn().mockResolvedValue(accesso()) },
      fIR: { findFirst: jest.fn().mockResolvedValue(fir()) },
      collegamentoAccesso: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn(async ({ data }: any) => {
          ordine.push('insert')
          return { id: COL, ...data }
        }),
        update: jest.fn().mockResolvedValue({}),
      },
      activityLog: { create: jest.fn().mockResolvedValue({}) },
    }
    ;(leggiRadiceOrdinaria as jest.Mock).mockResolvedValue({
      id: MOV,
      registroId: REG,
      type: 'CARICO',
      tipoAnnotazione: 'ORDINARIA',
      cerCode: '20 01 01',
    })
    ;(leggiMovimentiCollegati as jest.Mock).mockResolvedValue(
      new Map([[MOV, { radiceId: MOV, annullato: false }]])
    )
    service = new CollegamentiAccessoService({ $transaction: (fn: any) => fn(tx) } as any)
    ;(service as any).adesso = () => new Date('2026-10-31T10:00:00Z')
  })

  describe('collegaFir', () => {
    it('lock dell`accesso (advisory, FOR UPDATE) prima dell`insert', async () => {
      await service.collegaFir(T, operatore, ACC, FIR)

      expect(ordine).toEqual([`advisory:accesso-pesa|${ACC}`, 'for-update', 'insert'])
      expect(tx.collegamentoAccesso.create.mock.calls[0][0].data).toMatchObject({
        tenantId: T,
        accessoId: ACC,
        registroId: REG,
        verso: 'CARICO',
        tipo: 'FIR',
        firId: FIR,
        creatoDa: U,
      })
      expect(tx.activityLog.create.mock.calls[0][0].data.action).toBe('PESA_COLLEGAMENTO_CREATO')
    })

    it.each(['AWAITING_CARRIER', 'AWAITING_RECEIVER', 'COMPLETED'])(
      'FIR %s si collega',
      async s => {
        tx.fIR.findFirst.mockResolvedValue(fir({ status: s }))
        await expect(service.collegaFir(T, operatore, ACC, FIR)).resolves.toBeDefined()
      }
    )

    it.each(['DRAFT', 'AWAITING_PRODUCER', 'CANCELLED'])('FIR %s → 422', async s => {
      tx.fIR.findFirst.mockResolvedValue(fir({ status: s }))
      await expect(service.collegaFir(T, operatore, ACC, FIR)).rejects.toThrow(
        CollegamentoNonValidoError
      )
      expect(tx.collegamentoAccesso.create).not.toHaveBeenCalled()
    })

    it('FIR annullato presso l`ente → 422', async () => {
      tx.fIR.findFirst.mockResolvedValue(fir({ rentriStatoFormulario: 'Annullato' }))
      await expect(service.collegaFir(T, operatore, ACC, FIR)).rejects.toThrow(
        CollegamentoNonValidoError
      )
    })

    it('FIR di un`altra azienda o inesistente → 422', async () => {
      tx.fIR.findFirst.mockResolvedValue(null)
      await expect(service.collegaFir(T, operatore, ACC, FIR)).rejects.toThrow('FIR non trovato.')
    })

    it('accesso non chiuso → 409', async () => {
      tx.accessoPesa.findFirst.mockResolvedValue(accesso({ stato: 'APERTO' }))
      await expect(service.collegaFir(T, operatore, ACC, FIR)).rejects.toThrow(
        StatoAccessoNonValidoError
      )
    })

    it('già collegato (accesso o documento) → 409 col testo del brief', async () => {
      tx.collegamentoAccesso.findFirst.mockResolvedValue({ id: 'x', firId: 'altro' })
      await expect(service.collegaFir(T, operatore, ACC, FIR)).rejects.toThrow(MSG_GIA)
    })

    it('violazione dell`indice unico nella corsa → 409 col testo del brief', async () => {
      tx.collegamentoAccesso.create.mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError('Unique', {
          code: 'P2002',
          clientVersion: 'x',
          meta: { target: ['fir_id'] },
        })
      )
      const p = service.collegaFir(T, operatore, ACC, FIR)
      await expect(p).rejects.toThrow(StatoAccessoNonValidoError)
      await expect(p).rejects.toThrow(MSG_GIA)
    })
  })

  describe('collegaMovimento', () => {
    it('radice ordinaria dello stesso registro e verso → collegamento MOVIMENTO', async () => {
      await service.collegaMovimento(T, operatore, ACC, MOV)

      expect(tx.collegamentoAccesso.create.mock.calls[0][0].data).toMatchObject({
        tipo: 'MOVIMENTO',
        movimentoId: MOV,
        registroId: REG,
        verso: 'CARICO',
      })
    })

    it('una rettifica → 422 "Collegare l`annotazione originale…"', async () => {
      ;(leggiRadiceOrdinaria as jest.Mock).mockResolvedValue({
        id: MOV,
        registroId: REG,
        type: 'CARICO',
        tipoAnnotazione: 'RETTIFICA',
        cerCode: '20 01 01',
      })
      await expect(service.collegaMovimento(T, operatore, ACC, MOV)).rejects.toThrow(
        "Collegare l'annotazione originale, non una sua rettifica."
      )
    })

    it('altro registro, altro verso, inesistente → 422', async () => {
      const base = {
        id: MOV,
        registroId: REG,
        type: 'CARICO',
        tipoAnnotazione: 'ORDINARIA',
        cerCode: '20 01 01',
      }
      ;(leggiRadiceOrdinaria as jest.Mock).mockResolvedValueOnce({ ...base, registroId: 'x' })
      await expect(service.collegaMovimento(T, operatore, ACC, MOV)).rejects.toThrow(
        CollegamentoNonValidoError
      )
      ;(leggiRadiceOrdinaria as jest.Mock).mockResolvedValueOnce({ ...base, type: 'SCARICO' })
      await expect(service.collegaMovimento(T, operatore, ACC, MOV)).rejects.toThrow(
        CollegamentoNonValidoError
      )
      ;(leggiRadiceOrdinaria as jest.Mock).mockResolvedValueOnce(null)
      await expect(service.collegaMovimento(T, operatore, ACC, MOV)).rejects.toThrow(
        CollegamentoNonValidoError
      )
    })

    it('CER dell`accesso diverso → 422; uguale a meno degli spazi → ok', async () => {
      tx.accessoPesa.findFirst.mockResolvedValue(accesso({ cerCode: '17 01 01' }))
      await expect(service.collegaMovimento(T, operatore, ACC, MOV)).rejects.toThrow(
        CollegamentoNonValidoError
      )
      tx.accessoPesa.findFirst.mockResolvedValue(accesso({ cerCode: '200101' }))
      await expect(service.collegaMovimento(T, operatore, ACC, MOV)).resolves.toBeDefined()
    })

    it('catena già annullata → 422', async () => {
      ;(leggiMovimentiCollegati as jest.Mock).mockResolvedValue(
        new Map([[MOV, { radiceId: MOV, annullato: true }]])
      )
      await expect(service.collegaMovimento(T, operatore, ACC, MOV)).rejects.toThrow(
        CollegamentoNonValidoError
      )
    })
  })

  describe('revoca', () => {
    beforeEach(() => {
      tx.collegamentoAccesso.findFirst.mockResolvedValue({
        id: COL,
        accessoId: ACC,
        tipo: 'FIR',
        revocatoIl: null,
      })
    })

    it('solo il responsabile', async () => {
      await expect(service.revoca(T, operatore, COL, 'errore')).rejects.toThrow(
        RuoloPesaInsufficienteError
      )
    })

    it('motivo obbligatorio, al massimo 500', async () => {
      await expect(service.revoca(T, admin, COL, ' ')).rejects.toThrow(DatiPesaNonValidiError)
      await expect(service.revoca(T, admin, COL, 'x'.repeat(501))).rejects.toThrow(
        DatiPesaNonValidiError
      )
    })

    it('lock dell`accesso, poi UPDATE di sole colonne di revoca; audit senza testo libero', async () => {
      await service.revoca(T, admin, COL, 'collegato per errore')

      expect(ordine.slice(0, 2)).toEqual([`advisory:accesso-pesa|${ACC}`, 'for-update'])
      const data = tx.collegamentoAccesso.update.mock.calls[0][0].data
      expect(Object.keys(data).sort()).toEqual(['motivoRevoca', 'revocatoDa', 'revocatoIl'])
      const a = tx.activityLog.create.mock.calls[0][0].data
      expect(a.action).toBe('PESA_COLLEGAMENTO_REVOCATO')
      expect(JSON.stringify(a)).not.toContain('collegato per errore')
    })

    it('già revocato → 409; inesistente → 404', async () => {
      tx.collegamentoAccesso.findFirst.mockResolvedValue({
        id: COL,
        accessoId: ACC,
        revocatoIl: new Date(),
      })
      await expect(service.revoca(T, admin, COL, 'm')).rejects.toThrow(StatoAccessoNonValidoError)
      tx.collegamentoAccesso.findFirst.mockResolvedValue(null)
      await expect(service.revoca(T, admin, COL, 'm')).rejects.toThrow(CollegamentoNonTrovatoError)
    })
  })

  describe('pesoPerConsegnaFir (D12)', () => {
    it('FIR in kg: netto invariato; crea il collegamento e scrive FIR_PESO_DA_ACCESSO', async () => {
      await expect(service.pesoPerConsegnaFir(T, U, FIR, ACC)).resolves.toBe(12345)

      expect(tx.collegamentoAccesso.create).toHaveBeenCalledTimes(1)
      expect(tx.activityLog.create.mock.calls.map((c: any) => c[0].data.action)).toContain(
        'FIR_PESO_DA_ACCESSO'
      )
    })

    it('FIR in T: 12.345 kg → 12,35', async () => {
      tx.fIR.findFirst.mockResolvedValue(fir({ unit: 'T', status: 'AWAITING_RECEIVER' }))
      await expect(service.pesoPerConsegnaFir(T, U, FIR, ACC)).resolves.toBe(12.35)
    })

    it('FIR in M3 → 422 con l`unità nel messaggio', async () => {
      tx.fIR.findFirst.mockResolvedValue(fir({ unit: 'M3' }))
      await expect(service.pesoPerConsegnaFir(T, U, FIR, ACC)).rejects.toThrow(
        'Il FIR è in M3: il peso della pesa (kg) non si converte.'
      )
      expect(tx.collegamentoAccesso.create).not.toHaveBeenCalled()
    })

    it('accesso SCARICO → 422; FIR legato a RENTRI → 422', async () => {
      tx.accessoPesa.findFirst.mockResolvedValue(accesso({ verso: 'SCARICO' }))
      await expect(service.pesoPerConsegnaFir(T, U, FIR, ACC)).rejects.toThrow(
        CollegamentoNonValidoError
      )
      tx.accessoPesa.findFirst.mockResolvedValue(accesso())
      tx.fIR.findFirst.mockResolvedValue(fir({ rentriNumeroFir: 'RENTRI-1' }))
      await expect(service.pesoPerConsegnaFir(T, U, FIR, ACC)).rejects.toThrow(
        CollegamentoNonValidoError
      )
    })

    it('accesso già collegato allo stesso FIR: nessun nuovo collegamento; ad altro FIR → 409', async () => {
      tx.collegamentoAccesso.findFirst.mockResolvedValue({ id: COL, accessoId: ACC, firId: FIR })
      await expect(service.pesoPerConsegnaFir(T, U, FIR, ACC)).resolves.toBe(12345)
      expect(tx.collegamentoAccesso.create).not.toHaveBeenCalled()

      tx.collegamentoAccesso.findFirst.mockResolvedValue({
        id: COL,
        accessoId: ACC,
        firId: 'altro',
      })
      await expect(service.pesoPerConsegnaFir(T, U, FIR, ACC)).rejects.toThrow(MSG_GIA)
    })
  })
})
