// Prisma finto con la forma che serve a MudAggregazioneService e al lettore del bilancio.
// Usato SOLO dagli spec. Ogni tabella risponde con un elenco vuoto, tranne il catalogo di sistema.
import { righeCausaliSistema } from '../registro/causali/catalogo-causali.fixture'

export function prismaFintoMud(): any {
  return {
    wasteMovement: {
      findMany: jest.fn().mockResolvedValue([]),
      groupBy: jest.fn().mockResolvedValue([]),
    },
    causaleRegistro: { findMany: jest.fn().mockResolvedValue(righeCausaliSistema()) },
    causaleRegistroAzienda: { findMany: jest.fn().mockResolvedValue([]) },
    fIR: { findMany: jest.fn().mockResolvedValue([]) },
    destinatario: { findMany: jest.fn().mockResolvedValue([]) },
    trasportatore: { findMany: jest.fn().mockResolvedValue([]) },
    tenant: {
      findUnique: jest
        .fn()
        .mockResolvedValue({ city: 'Roma', province: 'RM', atecoCode: '38.11.00' }),
    },
    rentriUnitaLocale: {
      findMany: jest
        .fn()
        .mockResolvedValue([{ denominazione: 'Sede', numIscrSito: 'OP1', principale: true }]),
    },
    mUDReport: { findUnique: jest.fn().mockResolvedValue(null) },
    registroRifiuti: { findMany: jest.fn().mockResolvedValue([]) },
    giacenzaIniziale: { findMany: jest.fn().mockResolvedValue([]) },
  }
}

export const referenceDataFinto = (): any => ({
  findComuneByName: jest.fn().mockResolvedValue({ code: '015146' }),
})

export const loggerFinto = (): any => ({
  setContext: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
})
