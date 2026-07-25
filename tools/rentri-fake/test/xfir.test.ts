import { creaContainerXfir } from './aiuti/xfir'
import { validaAsicE } from '../src/xfir/validatore-asice'

// La generazione RSA di node-forge (pura JS, sincrona) usata da
// creaContainerXfir per firmare ogni container di test puo' superare il
// timeout di default di Jest su macchine lente.
jest.setTimeout(30000)

describe('Validazione xFIR', () => {
  it('accetta un container in cui ogni firma copre tutti gli XML presenti', async () => {
    const contenuto = await creaContainerXfir({
      xml: ['fir.xml', 'allegato.xml'],
      firme: [
        { nomeFile: 'signatures001.xml', copre: ['fir.xml', 'allegato.xml'] },
        { nomeFile: 'signatures002.xml', copre: ['fir.xml', 'allegato.xml'] },
      ],
    })

    const esito = await validaAsicE(contenuto)

    expect(esito.valido).toBe(true)
  })

  it('RIFIUTA un container in cui una firma non copre tutti gli XML', async () => {
    const contenuto = await creaContainerXfir({
      xml: ['fir.xml', 'allegato.xml'],
      firme: [
        { nomeFile: 'signatures001.xml', copre: ['fir.xml', 'allegato.xml'] },
        { nomeFile: 'signatures002.xml', copre: ['fir.xml'] },
      ],
    })

    const esito = await validaAsicE(contenuto)

    expect(esito.valido).toBe(false)
    if (!esito.valido) {
      expect(esito.motivo).toContain('allegato.xml')
    }
  })

  it('rifiuta un container privo di mimetype ASiC-E', async () => {
    const contenuto = await creaContainerXfir({
      xml: ['fir.xml'],
      firme: [{ nomeFile: 'signatures001.xml', copre: ['fir.xml'] }],
      conMimetype: false,
    })

    const esito = await validaAsicE(contenuto)

    expect(esito.valido).toBe(false)
  })

  it('rifiuta un container senza alcuna firma', async () => {
    const contenuto = await creaContainerXfir({ xml: ['fir.xml'], firme: [] })

    const esito = await validaAsicE(contenuto)

    expect(esito.valido).toBe(false)
  })

  it('rifiuta un contenuto che non è nemmeno uno ZIP', async () => {
    const esito = await validaAsicE(Buffer.from('questo non e uno zip'))

    expect(esito.valido).toBe(false)
  })

  // FEDELTA.md §5.2 punto 5: la regola di copertura va verificata in
  // entrambi i versi, non solo "ogni XML presente e' coperto".
  it('RIFIUTA un container con un riferimento pendente (la firma copre un file assente dal container)', async () => {
    const contenuto = await creaContainerXfir({
      xml: ['fir.xml'],
      firme: [{ nomeFile: 'signatures001.xml', copre: ['fir.xml', 'fantasma.xml'] }],
    })

    const esito = await validaAsicE(contenuto)

    expect(esito.valido).toBe(false)
    if (!esito.valido) {
      expect(esito.motivo).toContain('fantasma.xml')
    }
  })

  it('RIFIUTA un container senza alcun XML presente, anche se la firma non copre nulla', async () => {
    const contenuto = await creaContainerXfir({
      xml: [],
      firme: [{ nomeFile: 'signatures001.xml', copre: [] }],
    })

    const esito = await validaAsicE(contenuto)

    expect(esito.valido).toBe(false)
  })

  // FEDELTA.md §5.2 punto 6: il DigestValue e la firma crittografica vanno
  // verificati davvero, non solo la loro presenza.
  it('RIFIUTA un container il cui DigestValue non corrisponde al contenuto referenziato', async () => {
    const contenuto = await creaContainerXfir({
      xml: ['fir.xml'],
      firme: [{ nomeFile: 'signatures001.xml', copre: ['fir.xml'], digestErrato: true }],
    })

    const esito = await validaAsicE(contenuto)

    expect(esito.valido).toBe(false)
    if (!esito.valido) {
      expect(esito.motivo).toContain('DigestValue')
    }
  })

  it('RIFIUTA un container la cui firma crittografica non è valida (SignatureValue manomesso)', async () => {
    const contenuto = await creaContainerXfir({
      xml: ['fir.xml'],
      firme: [{ nomeFile: 'signatures001.xml', copre: ['fir.xml'], firmaCorrotta: true }],
    })

    const esito = await validaAsicE(contenuto)

    expect(esito.valido).toBe(false)
    if (!esito.valido) {
      expect(esito.motivo).toContain('crittografica')
    }
  })

  it('accetta un container con DigestValue reale e firma crittografica valida su piu file', async () => {
    const contenuto = await creaContainerXfir({
      xml: ['fir.xml', 'allegato.xml'],
      firme: [{ nomeFile: 'signatures001.xml', copre: ['fir.xml', 'allegato.xml'] }],
    })

    const esito = await validaAsicE(contenuto)

    expect(esito.valido).toBe(true)
  })
})
