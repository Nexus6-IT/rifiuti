import { NotFoundException } from '@nestjs/common'
import { Prisma } from '@prisma/client'
import { CedenteService } from './cedente.service'

const TENANT = '5a5a5a5a-0000-4000-8000-000000000004'

function servizio(riga: unknown, tenant: Record<string, unknown> | null) {
  const prisma: any = {
    cedenteFatturazione: { findFirst: jest.fn().mockResolvedValue(riga) },
    tenant: { findUnique: jest.fn().mockResolvedValue(tenant) },
  }
  return new CedenteService(prisma)
}

const tenantCompleto = {
  ragioneSociale: 'Azienda SRL',
  partitaIva: '01234567890',
  codiceFiscale: null,
  address: 'Via Roma',
  civico: '1',
  postalCode: '00100',
  city: 'Roma',
  province: 'RM',
  reaNumber: '123456',
  country: 'IT',
}

describe('CedenteService.leggi (con DB finto)', () => {
  it('senza riga: versione 0, regime null, «Regime fiscale» fra i mancanti', async () => {
    const v = await servizio(null, tenantCompleto).leggi(TENANT)
    expect(v).toMatchObject({
      regimeFiscale: null,
      versione: 0,
      completo: false,
      statoLiquidazione: 'LN',
    })
    expect(v.mancanti).toEqual(['Regime fiscale'])
    expect(v.daTenant).toMatchObject({ indirizzo: 'Via Roma 1', cap: '00100', comune: 'Roma' })
  })

  it('con regime e sede completa: completo', async () => {
    const v = await servizio(
      { regimeFiscale: 'RF01', reaUfficio: 'RM', statoLiquidazione: 'LN', versione: 2 },
      tenantCompleto
    ).leggi(TENANT)
    expect(v).toMatchObject({ completo: true, mancanti: [], versione: 2 })
  })

  it('senza indirizzo: «Indirizzo della sede»', async () => {
    const v = await servizio(
      { regimeFiscale: 'RF01', reaUfficio: 'RM', statoLiquidazione: 'LN', versione: 1 },
      { ...tenantCompleto, address: null }
    ).leggi(TENANT)
    expect(v.completo).toBe(false)
    expect(v.mancanti).toEqual(['Indirizzo della sede'])
  })

  it('azienda inesistente: 404', async () => {
    await expect(servizio(null, null).leggi(TENANT)).rejects.toBeInstanceOf(NotFoundException)
  })
})

describe('CedenteService.leggi: sede e REA', () => {
  const riga = { regimeFiscale: 'RF01', reaUfficio: 'RM', statoLiquidazione: 'LN', versione: 1 }

  it('CAP italiano non di 5 cifre: «Indirizzo della sede»', async () => {
    const v = await servizio(riga, { ...tenantCompleto, postalCode: '1234' }).leggi(TENANT)
    expect(v.mancanti).toEqual(['Indirizzo della sede'])
  })

  it('ufficio REA senza numero REA: «Numero REA»; numero senza ufficio: «Ufficio REA»', async () => {
    const a = await servizio(
      { ...riga, reaUfficio: 'RM' },
      { ...tenantCompleto, reaNumber: null }
    ).leggi(TENANT)
    expect(a.mancanti).toEqual(['Numero REA'])
    const b = await servizio({ ...riga, reaUfficio: null }, tenantCompleto).leggi(TENANT)
    expect(b.mancanti).toEqual(['Ufficio REA'])
  })
})

describe('CedenteService.imposta: prima impostazione concorrente', () => {
  it('P2002 sull’unico del tenant: 409 VERSIONE_SUPERATA', async () => {
    const errore = new Prisma.PrismaClientKnownRequestError('unico', {
      code: 'P2002',
      clientVersion: 'test',
    })
    const prisma: any = { $transaction: jest.fn().mockRejectedValue(errore) }
    const err: any = await new CedenteService(prisma)
      .imposta(TENANT, 'u', { regimeFiscale: 'RF01', versione: 0 })
      .catch(e => e)
    expect(err.getStatus()).toBe(409)
    expect(err.getResponse().error).toBe('VERSIONE_SUPERATA')
  })
})
