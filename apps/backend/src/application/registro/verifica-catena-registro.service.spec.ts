import { Prisma } from '@prisma/client'
import { VerificaCatenaRegistroService } from './verifica-catena-registro.service'
import { WasteMovement, hashAnnotazioneV2 } from '../../domain/waste-movement/waste-movement.entity'

describe('VerificaCatenaRegistroService (unitaria, con prisma finto)', () => {
  const TENANT = 't'
  const REG = 'r'
  const ANNO = 2026
  const DATA = new Date('2026-03-05T10:20:30.123Z')

  function riga(numero: number, hashPrecedente: string, extra: Record<string, unknown> = {}) {
    const base = {
      tenantId: TENANT,
      registroId: REG,
      progressiveYear: ANNO,
      progressiveNumber: numero,
      type: 'CARICO',
      cerCode: '20 03 01',
      quantity: new Prisma.Decimal('12.50'),
      unit: 'KG',
      movementDate: DATA,
      causale: 'PRODUZIONE_INTERNA',
      tipoAnnotazione: 'ORDINARIA',
      movimentoRettificatoId: null,
      hashVersione: 2,
      entryHash: '',
    }
    const r = { ...base, ...extra }
    if (r.entryHash === '' && !('entryHash' in extra)) {
      r.entryHash = hashAnnotazioneV2({
        hashPrecedente,
        registroId: REG,
        anno: ANNO,
        numero,
        tipoAnnotazione: 'ORDINARIA',
        type: 'CARICO',
        cerCode: base.cerCode,
        quantita: base.quantity,
        unit: 'KG',
        movementDate: DATA,
        causale: 'PRODUZIONE_INTERNA',
      })
    }
    return r
  }

  function servizio(righe: unknown[], iniziale: number | null = null) {
    const prisma = {
      wasteMovement: { findMany: jest.fn().mockResolvedValue(righe) },
      registroProgressivoIniziale: {
        findUnique: jest.fn().mockResolvedValue(iniziale ? { primoProgressivo: iniziale } : null),
      },
    }
    return { prisma, svc: new VerificaCatenaRegistroService(prisma as never) }
  }

  it('catena v2 integra', async () => {
    const r1 = riga(1, '')
    const r2 = riga(2, r1.entryHash)
    const r3 = riga(3, r2.entryHash)
    const { svc, prisma } = servizio([r1, r2, r3])
    expect(await svc.verifica(TENANT, REG, ANNO)).toEqual({
      verificate: 3,
      nonVerificabili: [],
      primoErrore: null,
    })
    expect(prisma.wasteMovement.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { tenantId: TENANT, registroId: REG, progressiveYear: ANNO },
        orderBy: { progressiveNumber: 'asc' },
      })
    )
  })

  it('riga alterata: HASH_DIVERSO sul suo numero', async () => {
    const r1 = riga(1, '')
    const r2 = riga(2, r1.entryHash)
    const alterata = { ...r2, quantity: new Prisma.Decimal('13') }
    const { svc } = servizio([r1, alterata, riga(3, r2.entryHash)])
    expect(await svc.verifica(TENANT, REG, ANNO)).toEqual({
      verificate: 1,
      nonVerificabili: [],
      primoErrore: { numero: 2, motivo: 'HASH_DIVERSO' },
    })
  })

  it('riga v1 verificata con la v1 (quantita nel formato storico)', async () => {
    const hash = WasteMovement.computeHash({
      tenantId: TENANT,
      progressiveYear: ANNO,
      progressiveNumber: 1,
      type: 'CARICO',
      cerCode: '20 03 01',
      quantity: 12.5,
      movementDate: DATA,
      causale: 'PRODUZIONE_INTERNA',
    })
    const { svc } = servizio([riga(1, '', { hashVersione: 1, entryHash: hash })])
    expect((await svc.verifica(TENANT, REG, ANNO)).verificate).toBe(1)
  })

  it('hash vuoto: nonVerificabile, la v2 successiva si concatena a stringa vuota', async () => {
    const r1 = riga(1, '', { entryHash: '' })
    const r2 = riga(2, '')
    const { svc } = servizio([r1, r2])
    expect(await svc.verifica(TENANT, REG, ANNO)).toEqual({
      verificate: 1,
      nonVerificabili: [{ numero: 1, motivo: 'HASH_ASSENTE' }],
      primoErrore: null,
    })
  })

  it('buco fra due progressivi, e fra il progressivo iniziale e la prima riga', async () => {
    const r1 = riga(1, '')
    const r3 = riga(3, r1.entryHash)
    expect((await servizio([r1, r3]).svc.verifica(TENANT, REG, ANNO)).primoErrore).toEqual({
      numero: 2,
      motivo: 'BUCO',
    })
    const r5 = riga(5, '')
    expect((await servizio([r5], 4).svc.verifica(TENANT, REG, ANNO)).primoErrore).toEqual({
      numero: 4,
      motivo: 'BUCO',
    })
    expect((await servizio([r5], 5).svc.verifica(TENANT, REG, ANNO)).primoErrore).toBeNull()
  })

  it('versione sconosciuta e registro senza righe', async () => {
    const { svc } = servizio([riga(1, '', { hashVersione: 7, entryHash: 'x' })])
    expect((await svc.verifica(TENANT, REG, ANNO)).primoErrore).toEqual({
      numero: 1,
      motivo: 'VERSIONE_SCONOSCIUTA',
    })
    expect(await servizio([]).svc.verifica(TENANT, REG, ANNO)).toEqual({
      verificate: 0,
      nonVerificabili: [],
      primoErrore: null,
    })
  })
})
