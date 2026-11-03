import { contentDisposition } from './content-disposition'

describe('contentDisposition', () => {
  it('nome semplice: ASCII e UTF-8 coincidono', () => {
    expect(contentDisposition('attachment', 'contratto.pdf')).toBe(
      `attachment; filename="contratto.pdf"; filename*=UTF-8''contratto.pdf`
    )
  })

  it('inline e attachment cambiano solo il tipo', () => {
    expect(contentDisposition('inline', 'a.pdf').startsWith('inline; ')).toBe(true)
    expect(contentDisposition('attachment', 'a.pdf').startsWith('attachment; ')).toBe(true)
  })

  it('accenti: ripiego ASCII con "_" e filename* percent-encoded', () => {
    expect(contentDisposition('attachment', 'Società è già')).toBe(
      `attachment; filename="Societ_ _ gi_"; filename*=UTF-8''Societ%C3%A0%20%C3%A8%20gi%C3%A0`
    )
  })

  it('spazi: nel ripiego restano, nel filename* diventano %20', () => {
    expect(contentDisposition('attachment', 'due parole.txt')).toBe(
      `attachment; filename="due parole.txt"; filename*=UTF-8''due%20parole.txt`
    )
  })

  it('virgolette, backslash, punto e virgola e percento non possono chiudere il valore', () => {
    const h = contentDisposition('attachment', 'a"b;c%d\'e(f)g*.pdf')
    const ascii = /filename="([^"]*)"/.exec(h)![1]
    expect(ascii).toBe("a_b_c_d'e(f)g*.pdf")
    expect(h).toContain(`filename*=UTF-8''a%22b%3Bc%25d%27e%28f%29g%2A.pdf`)
  })

  it('percorso e caratteri di controllo vengono tolti; nome vuoto diventa "allegato"', () => {
    expect(contentDisposition('attachment', 'C:\\temp\\x/y\r\n.pdf')).toContain('filename="y.pdf"')
    expect(contentDisposition('attachment', '   ')).toContain('filename="allegato"')
  })

  it('surrogato spaiato: non lancia e diventa U+FFFD', () => {
    expect(contentDisposition('inline', 'a\uD800b')).toContain(`filename*=UTF-8''a%EF%BF%BDb`)
  })
})
