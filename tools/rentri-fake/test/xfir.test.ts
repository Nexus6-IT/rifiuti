import { creaContainerXfir } from './aiuti/xfir'
import { validaAsicE } from '../src/xfir/validatore-asice'

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
})
