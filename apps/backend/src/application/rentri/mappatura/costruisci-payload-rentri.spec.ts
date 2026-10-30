import { CostruisciPayloadRentri } from './costruisci-payload-rentri'

/**
 * Raccoglie dal database quello che il mappatore chiede e glielo passa.
 *
 * Lo snapshot delle parti dentro il FIR appiattisce l'indirizzo in una sola
 * stringa, mentre il contratto vuole via, civico, CAP e un codice comune:
 * i dati strutturati vivono nei registri anagrafici, e si raggiungono dal
 * `registroId` dello snapshot. Se quel legame manca, l'invio viene rifiutato
 * invece di essere completato con un indirizzo inventato.
 */

const REGISTRO = {
  ragioneSociale: 'Impresa Uno SRL',
  partitaIVA: '12345678901',
  via: 'Via Roma',
  civico: '1',
  cap: '80100',
  comune: 'Napoli',
  provincia: 'NA',
  numeroIscrizione: 'NA/123456',
  ditta: { ragioneSociale: 'Impresa Uno SRL', partitaIva: '12345678903', codiceFiscale: null },
  sede: { via: 'Via Roma', civico: '1', cap: '80100', comune: 'Napoli', provincia: 'NA' },
}

function prismaFinto(opzioni: { registroPresente?: boolean } = {}) {
  const trova = jest.fn(
    async (): Promise<Record<string, unknown> | null> =>
      opzioni.registroPresente === false ? null : REGISTRO
  )
  return {
    db: {
      produttore: { findFirst: trova },
      destinatario: { findFirst: trova },
      trasportatore: { findFirst: trova },
      istatComune: { findFirst: jest.fn(async () => ({ code: '063049' })) },
    },
  }
}

function firFinto(): Record<string, unknown> {
  return {
    id: 'fir-1',
    tenantId: 'tenant-1',
    provenienza: 'SPECIALE',
    tipoTrattaPrincipale: 'TERRESTRE',
    produttore: { registroId: 'p1', ragioneSociale: 'X', partitaIva: '1' },
    destinatario: { registroId: 'd1', ragioneSociale: 'Y', partitaIva: '2' },
    trasportatore: { registroId: 't1', ragioneSociale: 'Z', partitaIva: '3' },
    rifiuto: { cerCode: '150106', statoFisico: 'Solido', descrizione: 'Imballaggi misti' },
  }
}

const unitaLocale = {
  getPrincipale: jest.fn(async () => ({ numIscrSito: 'OP1234ABC000001-AB0001' })),
}

describe('CostruisciPayloadRentri', () => {
  beforeEach(() => unitaLocale.getPrincipale.mockClear())

  it('costruisce un corpo che il validatore del contratto accetta', async () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { validaNuovoFormulario } = require(ORACOLO)
    const servizio = new CostruisciPayloadRentri(
      prismaFinto() as never,
      unitaLocale as never,
      logger() as never
    )

    const corpo = await servizio.costruisci(firFinto() as never, 'tenant-1')

    expect(validaNuovoFormulario(corpo)).toBeNull()
  })

  it('usa ditta e sede nella lettura: CF ?? P.IVA, indirizzo della sede', async () => {
    const prisma = prismaFinto()
    prisma.db.produttore.findFirst.mockResolvedValue({
      ...REGISTRO,
      ditta: {
        ragioneSociale: 'Ditta SPA',
        partitaIva: '12345678903',
        codiceFiscale: 'RSSMRA80A01H501U',
      },
      sede: { via: 'Via Sede', civico: '9', cap: '80100', comune: 'Napoli', provincia: 'NA' },
    })
    const servizio = new CostruisciPayloadRentri(
      prisma as never,
      unitaLocale as never,
      logger() as never
    )

    const corpo = (await servizio.costruisci(firFinto() as never, 'tenant-1')) as {
      dati_partenza: {
        produttore: {
          denominazione: string
          codice_fiscale: string
          indirizzo: { indirizzo: string }
        }
      }
    }

    expect(corpo.dati_partenza.produttore.denominazione).toBe('Ditta SPA')
    expect(corpo.dati_partenza.produttore.codice_fiscale).toBe('RSSMRA80A01H501U')
    expect(corpo.dati_partenza.produttore.indirizzo.indirizzo).toBe('Via Sede')
    expect(prisma.db.produttore.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ include: { ditta: true, sede: true } })
    )
  })

  it('rifiuta quando il tenant non ha una unita locale RENTRI', async () => {
    unitaLocale.getPrincipale.mockResolvedValueOnce(null as never)
    const servizio = new CostruisciPayloadRentri(
      prismaFinto() as never,
      unitaLocale as never,
      logger() as never
    )

    await expect(servizio.costruisci(firFinto() as never, 'tenant-1')).rejects.toThrow(
      /unit(a|à) locale/i
    )
  })

  it('rifiuta quando una parte non e agganciata al registro anagrafico', async () => {
    const servizio = new CostruisciPayloadRentri(
      prismaFinto({ registroPresente: false }) as never,
      unitaLocale as never,
      logger() as never
    )

    await expect(servizio.costruisci(firFinto() as never, 'tenant-1')).rejects.toThrow(/registro/i)
  })
})

const ORACOLO = '../../../../../../tools/rentri-fake/src/dominio/nuovo-formulario'

function logger() {
  return { setContext: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() }
}
