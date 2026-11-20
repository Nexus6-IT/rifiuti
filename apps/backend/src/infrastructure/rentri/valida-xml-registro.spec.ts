import { createHash } from 'crypto'
import { readFileSync } from 'fs'
import { join } from 'path'
import { validaXmlRegistro } from './valida-xml-registro'

/** Impronte di `xsd/VERSIONI.md`: se cambia un XSD, aggiornare entrambi. */
const IMPRONTE: Record<string, string> = {
  'rentri-common-1.0.xsd': 'def8de099428ac8108d7a5c9abcfddb6a4d02b0eb677d0a35bed85bfb7a9487c',
  'rentri-enum-1.0.xsd': 'e150451ccbfcab8192cfdb973ab7de718c79e7403470894718ec431f36336c51',
  'rentri-movimenti-1.0.xsd': '2ac4882c89692244770da29275f60c1b100b0d1d1c04f3bbafafbaef79d7bac0',
  'rentri-registri-1.0.xsd': 'f2b061bab8b1b83d80a4002d51533ef4b46dde103f6369411fa41228b672193d',
  'xmldsig-core-schema.xsd': '35cf8197da812c85e40d57891b35c94187569ed474a2dac813ce5090dafcd35c',
}

describe('XSD del registro RENTRI', () => {
  it.each(Object.entries(IMPRONTE))('%s coincide con VERSIONI.md', (nome, sha) => {
    const byte = readFileSync(join(__dirname, 'xsd', nome))
    expect(createHash('sha256').update(byte).digest('hex')).toBe(sha)
    expect(readFileSync(join(__dirname, 'xsd', 'VERSIONI.md'), 'utf8')).toContain(sha)
  })
})

describe('validaXmlRegistro', () => {
  it('XML non ben formato: non valido, senza eccezioni', async () => {
    const e = await validaXmlRegistro('<reg:Registro')
    expect(e.valido).toBe(false)
    expect(e.errori.length).toBeGreaterThan(0)
  })

  it('radice sbagliata: non valido', async () => {
    expect((await validaXmlRegistro('<a/>')).valido).toBe(false)
  })

  it('Registro senza eREGI: non valido (elemento obbligatorio mancante)', async () => {
    const e = await validaXmlRegistro('<reg:Registro xmlns:reg="urn:it:rentri:registri:1.0"/>')
    expect(e.valido).toBe(false)
    expect(e.errori[0]).toContain('Registro')
  })
})
