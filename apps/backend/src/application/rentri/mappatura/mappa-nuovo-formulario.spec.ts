import { mappaNuovoFormulario, DatiFirPerRentri } from './mappa-nuovo-formulario'
import { RisolutoreComune } from './mappa-parti'

// Il giudice NON e' una nostra idea del contratto: e' lo stesso validatore che
// il finto RENTRI applica alla rotta di creazione, generato da
// `docs/contracts/rentri/formulari.yaml`. Se la mappatura sbaglia un campo,
// qui diventa rosso invece di arrivare a un ente pubblico.
const PERCORSO_ORACOLO = '../../../../../../tools/rentri-fake/src/dominio/nuovo-formulario'
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { validaNuovoFormulario } = require(PERCORSO_ORACOLO)

const risolutoreComune: RisolutoreComune = {
  risolvi: async (nome: string) => (nome === 'Napoli' ? '063049' : null),
}

function firCompleto(): DatiFirPerRentri {
  return {
    numIscrSito: 'OP1234ABC000001-AB0001',
    provenienza: 'S',
    tipoTrasporto: 'Terrestre',
    produttore: {
      ragioneSociale: 'Produttore Uno SRL',
      partitaIVA: '12345678901',
      indirizzo: {
        via: 'Via Roma',
        civico: '1',
        cap: '80100',
        comune: 'Napoli',
        provincia: 'NA',
      },
    },
    destinatario: {
      ragioneSociale: 'Destinatario Due SPA',
      partitaIVA: '98765432109',
      indirizzo: {
        via: 'Via Milano',
        civico: '2',
        cap: '80100',
        comune: 'Napoli',
        provincia: 'NA',
      },
    },
    trasportatori: [
      {
        ragioneSociale: 'Trasporti Tre SNC',
        partitaIVA: '11223344556',
        numeroIscrizione: 'NA/123456',
      },
    ],
    rifiuto: {
      cerCode: '150106',
      wastePhysicalState: 'SOLIDO',
      wasteDescription: 'Imballaggi in materiali misti',
    },
  }
}

describe('mappaNuovoFormulario', () => {
  it('produce un corpo che il validatore del contratto accetta', async () => {
    const corpo = await mappaNuovoFormulario(firCompleto(), risolutoreComune)

    expect(validaNuovoFormulario(corpo)).toBeNull()
  })

  it('rifiuta il FIR quando il comune non e risolvibile nel catalogo RENTRI', async () => {
    const fir = firCompleto()
    fir.produttore.indirizzo.comune = 'Comune Inesistente'

    await expect(mappaNuovoFormulario(fir, risolutoreComune)).rejects.toThrow(/comune/i)
  })

  it('rifiuta il FIR quando manca la provenienza del rifiuto', async () => {
    const fir = firCompleto()
    fir.provenienza = null

    await expect(mappaNuovoFormulario(fir, risolutoreComune)).rejects.toThrow(/provenienza/i)
  })

  it('rifiuta il FIR quando non c e almeno un trasportatore', async () => {
    const fir = firCompleto()
    fir.trasportatori = []

    await expect(mappaNuovoFormulario(fir, risolutoreComune)).rejects.toThrow(/trasportatore/i)
  })

  describe("quantita' e trasporto alla creazione (FIR in viaggio P2, D2)", () => {
    it("senza quantita' e senza trasporto il corpo resta quello di prima (nessuna chiave nuova)", async () => {
      const corpo = (await mappaNuovoFormulario(firCompleto(), risolutoreComune)) as {
        dati_partenza: { rifiuto: Record<string, unknown> }
      }

      expect(corpo.dati_partenza.rifiuto).not.toHaveProperty('quantita')
      expect(corpo.dati_partenza.rifiuto).not.toHaveProperty('numero_colli')
      expect(corpo.dati_partenza.rifiuto).not.toHaveProperty('caratteristiche_pericolo')
      expect(corpo).not.toHaveProperty('dati_trasporto_partenza')
    })

    it("con quantita', colli, HP e trasporto: tutto nel corpo e il contratto lo accetta", async () => {
      const fir = firCompleto()
      fir.quantita = {
        valore: 1.2,
        unitaMisura: 't',
        numeroColli: 4,
        verificatoInPartenza: false,
      }
      fir.caratteristichePericolo = 'HP4,HP14'
      fir.datiTrasportoPartenza = {
        conducenteNome: 'Mario',
        conducenteCognome: 'Rossi',
        targaAutomezzo: 'ab123cd',
        dataOraInizioTrasporto: new Date('2026-11-21T07:00:00Z'),
      }

      const corpo = (await mappaNuovoFormulario(fir, risolutoreComune)) as {
        dati_partenza: { rifiuto: Record<string, unknown> }
        dati_trasporto_partenza: Record<string, unknown>
      }

      expect(corpo.dati_partenza.rifiuto).toMatchObject({
        quantita: { valore: 1200, unita_misura: 'kg' },
        numero_colli: '4',
        verificato_in_partenza: false,
        caratteristiche_pericolo: ['HP04', 'HP14'],
      })
      expect(corpo.dati_trasporto_partenza).toMatchObject({
        conducente: { nome: 'Mario', cognome: 'Rossi' },
        targa_automezzo: 'AB123CD',
        data_ora_inizio_trasporto: '2026-11-21T07:00:00.000Z',
      })
      expect(validaNuovoFormulario(corpo)).toBeNull()
    })

    it("invia tutti i trasportatori, ognuno con la sua modalita'", async () => {
      const fir = firCompleto()
      fir.trasportatori.push({
        ragioneSociale: 'Ferrovie Merci SPA',
        partitaIVA: '99887766554',
        tipoTrasporto: 'Ferroviario',
      })

      const corpo = (await mappaNuovoFormulario(fir, risolutoreComune)) as {
        dati_partenza: { trasportatori: Array<Record<string, unknown>> }
      }

      expect(corpo.dati_partenza.trasportatori).toHaveLength(2)
      expect(corpo.dati_partenza.trasportatori[0]).toMatchObject({ tipo_trasporto: 'Terrestre' })
      expect(corpo.dati_partenza.trasportatori[1]).toMatchObject({
        denominazione: 'Ferrovie Merci SPA',
        tipo_trasporto: 'Ferroviario',
      })
      expect(validaNuovoFormulario(corpo)).toBeNull()
    })

    it("una quantita' senza colli ne' rinfusa non esce: dato mancante, mai un valore inventato", async () => {
      const fir = firCompleto()
      fir.quantita = { valore: 10, unitaMisura: 'kg' }
      await expect(mappaNuovoFormulario(fir, risolutoreComune)).rejects.toThrow(/numero_colli/)
    })

    it("un trasporto con la targa troppo lunga e' rifiutato prima di arrivare all'ente", async () => {
      const fir = firCompleto()
      fir.datiTrasportoPartenza = {
        conducenteNome: 'Mario',
        conducenteCognome: 'Rossi',
        targaAutomezzo: 'ABCDEFGHIJK',
        dataOraInizioTrasporto: new Date('2026-11-21T07:00:00Z'),
      }
      await expect(mappaNuovoFormulario(fir, risolutoreComune)).rejects.toThrow(/targa_automezzo/)
    })
  })

  describe('numero_fir vidimato dall ente (scorta)', () => {
    it('lo mette in dati_partenza.numero_fir e il validatore del contratto accetta', async () => {
      const corpo = (await mappaNuovoFormulario(
        { ...firCompleto(), numeroFir: 'BCDFG 000123 L' },
        risolutoreComune
      )) as { dati_partenza: { numero_fir?: string } }

      expect(corpo.dati_partenza.numero_fir).toBe('BCDFG 000123 L')
      expect(validaNuovoFormulario(corpo)).toBeNull()
    })

    it('senza numero vidimato il campo non c e (lo assegna l ente, il contratto lo ammette)', async () => {
      const corpo = (await mappaNuovoFormulario(firCompleto(), risolutoreComune)) as {
        dati_partenza: Record<string, unknown>
      }

      expect('numero_fir' in corpo.dati_partenza).toBe(false)
      expect(validaNuovoFormulario(corpo)).toBeNull()
    })

    it('un numero non conforme al pattern del contratto si rifiuta, non si invia', async () => {
      await expect(
        mappaNuovoFormulario({ ...firCompleto(), numeroFir: 'FIR-2026-000001' }, risolutoreComune)
      ).rejects.toThrow(/numero_fir/)
    })

    it('un numero vuoto o di soli spazi equivale a nessun numero', async () => {
      const corpo = (await mappaNuovoFormulario(
        { ...firCompleto(), numeroFir: '   ' },
        risolutoreComune
      )) as { dati_partenza: Record<string, unknown> }
      expect('numero_fir' in corpo.dati_partenza).toBe(false)
    })
  })
})
