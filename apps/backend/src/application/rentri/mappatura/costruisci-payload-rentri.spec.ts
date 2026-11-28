import { PIVA_VALIDA } from '../../../test-support/anagrafiche-di-test'
import { CostruisciPayloadRentri } from './costruisci-payload-rentri'
import { DatiViaggioFirInMemoria } from '../dati-viaggio-fir.in-memoria'

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
  partitaIVA: PIVA_VALIDA,
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
    trasportatoriAggiuntivi: [],
    rifiuto: {
      cerCode: '150106',
      statoFisico: 'Solido',
      descrizione: 'Imballaggi misti',
      quantita: { valore: 120, unitaMisura: 'kg' },
    },
  }
}

const unitaLocale = {
  getPrincipale: jest.fn(async () => ({ numIscrSito: 'OP1234ABC000001-AB0001' })),
}

describe('CostruisciPayloadRentri', () => {
  let datiViaggio: DatiViaggioFirInMemoria
  beforeEach(() => {
    unitaLocale.getPrincipale.mockClear()
    datiViaggio = new DatiViaggioFirInMemoria()
  })

  it('costruisce un corpo che il validatore del contratto accetta', async () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { validaNuovoFormulario } = require(ORACOLO)
    const servizio = new CostruisciPayloadRentri(
      prismaFinto() as never,
      unitaLocale as never,
      logger() as never,
      datiViaggio
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
      logger() as never,
      datiViaggio
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

  describe("quantita' e trasporto noti (FIR in viaggio P2, D2)", () => {
    const viaggio = (extra: Record<string, unknown> = {}) => ({
      firId: 'fir-1',
      dichiarato: null,
      quantita: 120,
      unitaMisura: 'kg',
      numeroColli: null,
      verificatoInPartenza: null,
      rinfusa: null,
      dataTrasporto: new Date('2026-11-21T07:00:00Z'),
      targaAutomezzo: '',
      principale: {
        conducenteNome: null,
        conducenteCognome: null,
        targaRimorchio: null,
        percorso: null,
      },
      tratteAggiuntive: [],
      ...extra,
    })

    const costruisci = async (fir: Record<string, unknown>) => {
      const servizio = new CostruisciPayloadRentri(
        prismaFinto() as never,
        unitaLocale as never,
        logger() as never,
        datiViaggio
      )
      return (await servizio.costruisci(fir as never, 'tenant-1')) as {
        dati_partenza: { rifiuto: Record<string, unknown>; trasportatori: unknown[] }
        dati_trasporto_partenza?: Record<string, unknown>
      }
    }

    it("senza colli ne' rinfusa la quantita' NON parte con la creazione (la dara il dialog)", async () => {
      datiViaggio.righe.set('fir-1', viaggio())
      const corpo = await costruisci(firFinto())
      expect(corpo.dati_partenza.rifiuto).not.toHaveProperty('quantita')
      expect(corpo).not.toHaveProperty('dati_trasporto_partenza')
    })

    it("con i colli (o la rinfusa) la quantita' parte, in kg, e il corpo e' valido per il contratto", async () => {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { validaNuovoFormulario } = require(ORACOLO)
      datiViaggio.righe.set('fir-1', viaggio({ rinfusa: true, verificatoInPartenza: true }))
      const fir = firFinto()
      fir.rifiuto = {
        ...(fir.rifiuto as object),
        quantita: { valore: 2, unitaMisura: 't' },
        caratteristichePericolo: 'HP4',
      }
      const corpo = await costruisci(fir)
      expect(corpo.dati_partenza.rifiuto).toMatchObject({
        quantita: { valore: 2000, unita_misura: 'kg' },
        rinfusa: true,
        verificato_in_partenza: true,
        caratteristiche_pericolo: ['HP04'],
      })
      expect(validaNuovoFormulario(corpo)).toBeNull()
    })

    it('il trasporto parte solo se terrestre, con conducente completo e almeno una targa', async () => {
      const completo = viaggio({
        principale: {
          conducenteNome: 'Mario',
          conducenteCognome: 'Rossi',
          targaRimorchio: null,
          percorso: 'A1',
        },
      })
      const fir = firFinto()
      fir.trasportatore = {
        registroId: 't1',
        ragioneSociale: 'Z',
        partitaIva: '3',
        targaVeicolo: 'ab123cd',
      }

      datiViaggio.righe.set('fir-1', completo)
      const corpo = await costruisci(fir)
      expect(corpo.dati_trasporto_partenza).toMatchObject({
        conducente: { nome: 'Mario', cognome: 'Rossi' },
        targa_automezzo: 'AB123CD',
        percorso: 'A1',
        data_ora_inizio_trasporto: '2026-11-21T07:00:00.000Z',
      })

      // senza targa: niente trasporto
      const senzaTarga = firFinto()
      expect(await costruisci(senzaTarga)).not.toHaveProperty('dati_trasporto_partenza')

      // non terrestre: niente trasporto
      fir.tipoTrattaPrincipale = 'FERROVIARIA'
      expect(await costruisci(fir)).not.toHaveProperty('dati_trasporto_partenza')

      // conducente incompleto: niente trasporto
      fir.tipoTrattaPrincipale = 'TERRESTRE'
      datiViaggio.righe.set(
        'fir-1',
        viaggio({ principale: { ...completo.principale, conducenteCognome: ' ' } })
      )
      expect(await costruisci(fir)).not.toHaveProperty('dati_trasporto_partenza')
    })

    it("invia tutti i trasportatori: principale piu' le tratte aggiuntive", async () => {
      datiViaggio.righe.set('fir-1', viaggio())
      const fir = firFinto()
      fir.trasportatoriAggiuntivi = [
        {
          ordine: 1,
          tipoTratta: 'FERROVIARIA',
          denominazione: 'Ferrovie Merci SPA',
          partitaIva: '99887766554',
          numeroIscrizioneAlbo: 'MI/7490',
        },
      ]
      const corpo = await costruisci(fir)
      expect(corpo.dati_partenza.trasportatori).toHaveLength(2)
      expect(corpo.dati_partenza.trasportatori[1]).toMatchObject({
        denominazione: 'Ferrovie Merci SPA',
        codice_fiscale: '99887766554',
        tipo_trasporto: 'Ferroviario',
        numero_iscrizione_albo: 'MI/007490',
      })
    })
  })

  it('rifiuta quando il tenant non ha una unita locale RENTRI', async () => {
    unitaLocale.getPrincipale.mockResolvedValueOnce(null as never)
    const servizio = new CostruisciPayloadRentri(
      prismaFinto() as never,
      unitaLocale as never,
      logger() as never,
      datiViaggio
    )

    await expect(servizio.costruisci(firFinto() as never, 'tenant-1')).rejects.toThrow(
      /unit(a|à) locale/i
    )
  })

  it('rifiuta quando una parte non e agganciata al registro anagrafico', async () => {
    const servizio = new CostruisciPayloadRentri(
      prismaFinto({ registroPresente: false }) as never,
      unitaLocale as never,
      logger() as never,
      datiViaggio
    )

    await expect(servizio.costruisci(firFinto() as never, 'tenant-1')).rejects.toThrow(/registro/i)
  })

  describe('numero vidimato della scorta', () => {
    const servizioConScorta = (consumato: { numeroFir: string } | null) => {
      const scorta = { trovaConsumatoDaFir: jest.fn(async () => consumato) }
      const servizio = new CostruisciPayloadRentri(
        prismaFinto() as never,
        unitaLocale as never,
        logger() as never,
        datiViaggio,
        scorta as never
      )
      return { servizio, scorta }
    }

    it('il numero consumato dal FIR entra in dati_partenza.numero_fir e il contratto lo accetta', async () => {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { validaNuovoFormulario } = require(ORACOLO)
      const { servizio, scorta } = servizioConScorta({ numeroFir: 'BCDFG 000042 L' })

      const corpo = (await servizio.costruisci(firFinto() as never, 'tenant-1')) as {
        dati_partenza: { numero_fir?: string }
      }

      expect(scorta.trovaConsumatoDaFir).toHaveBeenCalledWith('tenant-1', 'fir-1')
      expect(corpo.dati_partenza.numero_fir).toBe('BCDFG 000042 L')
      expect(validaNuovoFormulario(corpo)).toBeNull()
    })

    it('FIR senza numero consumato (MANUALE, importato): nessun numero_fir, lo assegna l ente', async () => {
      const { servizio } = servizioConScorta(null)
      const corpo = (await servizio.costruisci(firFinto() as never, 'tenant-1')) as {
        dati_partenza: Record<string, unknown>
      }
      expect('numero_fir' in corpo.dati_partenza).toBe(false)
    })

    it('un nuovo tentativo di invio ricostruisce lo STESSO numero (nessun secondo consumo)', async () => {
      const { servizio, scorta } = servizioConScorta({ numeroFir: 'BCDFG 000042 L' })
      const a = (await servizio.costruisci(firFinto() as never, 'tenant-1')) as any
      const b = (await servizio.costruisci(firFinto() as never, 'tenant-1')) as any
      expect(a.dati_partenza.numero_fir).toBe(b.dati_partenza.numero_fir)
      expect(scorta.trovaConsumatoDaFir).toHaveBeenCalledTimes(2)
    })
  })
})

const ORACOLO = '../../../../../../tools/rentri-fake/src/dominio/nuovo-formulario'

function logger() {
  return { setContext: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() }
}
