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
})
