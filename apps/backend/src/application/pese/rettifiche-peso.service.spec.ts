import { Prisma } from '@prisma/client'
import { improntaRettifica } from '../../domain/pese/impronta-pesata'
import { AVVISO_DOCUMENTI_COLLEGATI, RettifichePesoService } from './rettifiche-peso.service'
import {
  DatiPesaNonValidiError,
  PesataNonTrovataError,
  RegolaPesataError,
  RuoloPesaInsufficienteError,
  StatoAccessoNonValidoError,
} from './errori-pese'
import { MSG_TRIGGER } from './messaggi-trigger-pese'

jest.mock('./viste-accesso', () => ({
  leggiVistaAccesso: jest.fn(async (_tx: unknown, _t: string, id: string) => ({
    id,
    avvisi: [],
  })),
}))

const T = 'aaaaaaaa-0000-4000-8000-000000000001'
const U = 'bbbbbbbb-0000-4000-8000-000000000002'
const ACC = 'dddddddd-0000-4000-8000-000000000004'
const PES = '99999999-0000-4000-8000-000000000009'
const admin = { id: U, ruolo: 'ADMIN' as const }
const operatore = { id: U, ruolo: 'OPERATOR' as const }
const ADESSO = new Date('2026-10-31T10:00:00Z')

describe('RettifichePesoService (Prisma finto)', () => {
  let tx: any
  let service: RettifichePesoService
  let ordine: string[]
  let allegati: any

  beforeEach(() => {
    ordine = []
    tx = {
      $executeRaw: jest.fn(async (s: TemplateStringsArray, ...v: unknown[]) => {
        ordine.push(`advisory:${String(v[0])}`)
        return 1
      }),
      $queryRaw: jest.fn(async () => {
        ordine.push('for-update')
        return [{ id: ACC }]
      }),
      accessoPesa: {
        findFirst: jest.fn().mockResolvedValue({ id: ACC, tenantId: T, stato: 'CHIUSO' }),
      },
      pesata: {
        findFirst: jest.fn().mockResolvedValue({
          id: PES,
          accessoId: ACC,
          fonte: 'MANUALE',
          pesoKg: new Prisma.Decimal('24000'),
        }),
      },
      rettificaPeso: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn(async ({ data }: any) => {
          ordine.push('insert')
          return { id: 'r1', ...data }
        }),
      },
      collegamentoAccesso: { count: jest.fn().mockResolvedValue(0) },
      activityLog: { create: jest.fn().mockResolvedValue({}) },
    }
    allegati = { salva: jest.fn() }
    service = new RettifichePesoService({ $transaction: (fn: any) => fn(tx) } as any, allegati)
    ;(service as any).adesso = () => ADESSO
  })

  const dati = (extra: Record<string, unknown> = {}) => ({
    pesoNuovoKg: 23500,
    motivo: 'errore di trascrizione',
    ...extra,
  })

  it('prende accesso (advisory + FOR UPDATE) PRIMA di rettifica-peso e di inserire', async () => {
    await service.rettifica(T, admin, PES, dati())

    expect(ordine).toEqual([
      `advisory:accesso-pesa|${ACC}`,
      'for-update',
      `advisory:rettifica-peso|${PES}`,
      'insert',
    ])
  })

  it('numero 1 e peso precedente = peso originale; impronta ricalcolabile', async () => {
    await service.rettifica(T, admin, PES, dati())

    const d = tx.rettificaPeso.create.mock.calls[0][0].data
    expect(d).toMatchObject({
      tenantId: T,
      pesataId: PES,
      numero: 1,
      pesoPrecedenteKg: '24000.00',
      pesoNuovoKg: '23500.00',
      autoreId: U,
      createdAt: ADESSO,
    })
    expect(d.impronta).toBe(
      improntaRettifica({
        tenantId: T,
        pesataId: PES,
        numero: 1,
        pesoPrecedenteKg: '24000.00',
        pesoNuovoKg: '23500.00',
        motivo: 'errore di trascrizione',
        autoreId: U,
        allegatoSha256: null,
        createdAt: ADESSO,
      })
    )
  })

  it('seconda rettifica: numero 2, parte dal peso della prima', async () => {
    tx.rettificaPeso.findFirst.mockResolvedValue({
      numero: 1,
      pesoNuovoKg: new Prisma.Decimal('23500'),
    })

    await service.rettifica(T, admin, PES, dati({ pesoNuovoKg: 23400 }))

    expect(tx.rettificaPeso.create.mock.calls[0][0].data).toMatchObject({
      numero: 2,
      pesoPrecedenteKg: '23500.00',
      pesoNuovoKg: '23400.00',
    })
  })

  it('nuovo peso uguale all`attuale → 422 con il testo del brief', async () => {
    const p = service.rettifica(T, admin, PES, dati({ pesoNuovoKg: 24000 }))

    await expect(p).rejects.toThrow(RegolaPesataError)
    await expect(p).rejects.toThrow('Il nuovo peso è uguale a quello attuale.')
    expect(tx.rettificaPeso.create).not.toHaveBeenCalled()
  })

  it.each([0, -5, 12.345, Number.NaN, 100_000_000])('peso non valido %p → 422', async peso => {
    await expect(service.rettifica(T, admin, PES, dati({ pesoNuovoKg: peso }))).rejects.toThrow(
      RegolaPesataError
    )
  })

  it('motivo vuoto o oltre 500 caratteri → 400', async () => {
    await expect(service.rettifica(T, admin, PES, dati({ motivo: '  ' }))).rejects.toThrow(
      DatiPesaNonValidiError
    )
    await expect(
      service.rettifica(T, admin, PES, dati({ motivo: 'x'.repeat(501) }))
    ).rejects.toThrow(DatiPesaNonValidiError)
  })

  it('serve il ruolo di responsabile', async () => {
    await expect(service.rettifica(T, operatore, PES, dati())).rejects.toThrow(
      RuoloPesaInsufficienteError
    )
    expect(tx.$executeRaw).not.toHaveBeenCalled()
  })

  it('accesso annullato → 409; tara dichiarata → 409; pesata inesistente → 404', async () => {
    tx.accessoPesa.findFirst.mockResolvedValue({ id: ACC, tenantId: T, stato: 'ANNULLATO' })
    await expect(service.rettifica(T, admin, PES, dati())).rejects.toThrow(
      StatoAccessoNonValidoError
    )

    tx.accessoPesa.findFirst.mockResolvedValue({ id: ACC, tenantId: T, stato: 'CHIUSO' })
    tx.pesata.findFirst.mockResolvedValue({
      id: PES,
      accessoId: ACC,
      fonte: 'TARA_ANAGRAFICA',
      pesoKg: new Prisma.Decimal('7000'),
    })
    await expect(service.rettifica(T, admin, PES, dati())).rejects.toThrow(
      StatoAccessoNonValidoError
    )

    tx.pesata.findFirst.mockResolvedValue(null)
    await expect(service.rettifica(T, admin, PES, dati())).rejects.toThrow(PesataNonTrovataError)
  })

  it('allegato: salvato nella stessa transazione e il suo sha256 entra nell`impronta', async () => {
    allegati.salva.mockResolvedValue({ id: 'al1', sha256: 'ab'.repeat(32) })

    await service.rettifica(T, admin, PES, dati(), {
      nomeFile: 's.pdf',
      mimeDichiarato: 'application/pdf',
      contenuto: Buffer.from('%PDF-1.4'),
    })

    const d = tx.rettificaPeso.create.mock.calls[0][0].data
    expect(allegati.salva).toHaveBeenCalledWith(tx, T, U, expect.anything())
    expect(d.allegatoId).toBe('al1')
    expect(d.impronta).toBe(
      improntaRettifica({
        tenantId: T,
        pesataId: PES,
        numero: 1,
        pesoPrecedenteKg: '24000.00',
        pesoNuovoKg: '23500.00',
        motivo: 'errore di trascrizione',
        autoreId: U,
        allegatoSha256: 'ab'.repeat(32),
        createdAt: ADESSO,
      })
    )
  })

  it('con collegamenti attivi la vista porta l`avviso sui documenti', async () => {
    tx.collegamentoAccesso.count.mockResolvedValue(1)

    const v: any = await service.rettifica(T, admin, PES, dati())

    expect(v.avvisi).toContain(AVVISO_DOCUMENTI_COLLEGATI)
    expect(AVVISO_DOCUMENTI_COLLEGATI).toBe(
      'I documenti collegati non cambiano: FIR e registro restano con il peso già scritto; se serve, rettificare il registro.'
    )
  })

  it('audit senza testo libero: solo numeri e lunghezze', async () => {
    await service.rettifica(T, admin, PES, dati())

    const a = tx.activityLog.create.mock.calls[0][0].data
    expect(a.action).toBe('PESA_PESATA_RETTIFICATA')
    expect(JSON.stringify(a)).not.toContain('errore di trascrizione')
    expect(a.metadata).toMatchObject({
      pesataId: PES,
      numero: 1,
      precedente: 24000,
      nuovo: 23500,
      motivoLunghezza: 22,
    })
  })

  it('un errore del trigger di rettifica diventa un errore di dominio italiano', async () => {
    tx.rettificaPeso.create.mockRejectedValue(new Error(MSG_TRIGGER.rettificaAccessoAnnullato))

    await expect(service.rettifica(T, admin, PES, dati())).rejects.toThrow(
      StatoAccessoNonValidoError
    )
  })
})
