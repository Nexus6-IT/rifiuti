import { createHash } from 'crypto'
import { readFileSync } from 'fs'
import { join } from 'path'
import { validaXmlRegistro } from './valida-xml-registro'

/** Impronte di `xsd/VERSIONI.md`: se cambia un XSD, aggiornare entrambi. */
const IMPRONTE: Record<string, string> = {
  'rentri-common-1.0.xsd': '2cbfdaee62928b3b09d83508f1c9ecd1750d9374406de4940806b9098461063c',
  'rentri-enum-1.0.xsd': '0bcecee799c0eb0e2e2a4d7a70cafabaf07dcec377b79a22df84bc923cef8bfc',
  'rentri-movimenti-1.0.xsd': '210760de42bd9edd46dd71a9bef276cd5cbea1daf2f6297dbfd8b26a50978283',
  'rentri-registri-1.0.xsd': 'c3ac8461738d1d3da284e3bf4c9436d4bd501acd782e31cc3e6b416a609a7807',
  'xmldsig-core-schema.xsd': '35cf8197da812c85e40d57891b35c94187569ed474a2dac813ce5090dafcd35c',
}

describe('XSD del registro RENTRI', () => {
  it.each(Object.entries(IMPRONTE))('%s coincide con VERSIONI.md', (nome, sha) => {
    // Fine riga normalizzato: git puo' convertire CRLF in LF (e viceversa su Windows).
    const byte = readFileSync(join(__dirname, 'xsd', nome), 'utf8').replace(/\r\n/g, '\n')
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
