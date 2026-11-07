import { erroreDaBlob, salvaFile } from './download-fatturazione'

describe('erroreDaBlob', () => {
  it('Blob con JSON: il corpo torna oggetto, il resto dell’errore resta', async () => {
    const err = {
      status: 409,
      error: new Blob([JSON.stringify({ error: 'XML_NON_VALIDO', message: 'x' })]),
    }
    expect(await erroreDaBlob(err)).toEqual({
      status: 409,
      error: { error: 'XML_NON_VALIDO', message: 'x' },
    })
  })

  it('Blob che non è JSON: error diventa null', async () => {
    const r = (await erroreDaBlob({ status: 500, error: new Blob(['<html>']) })) as {
      status: number
      error: unknown
    }
    expect(r.status).toBe(500)
    expect(r.error).toBeNull()
  })

  it('errore che non è un Blob: restituito invariato', async () => {
    const err = { status: 400, error: { error: 'X' } }
    expect(await erroreDaBlob(err)).toBe(err)
    expect(await erroreDaBlob(null)).toBeNull()
  })
})

describe('salvaFile', () => {
  it('usa il nome del file, altrimenti quello di ripiego', () => {
    const nomi: string[] = []
    spyOn(URL, 'createObjectURL').and.returnValue('blob:x')
    spyOn(URL, 'revokeObjectURL')
    spyOn(HTMLAnchorElement.prototype, 'click').and.callFake(function (this: HTMLAnchorElement) {
      nomi.push(this.download)
    })
    salvaFile({ blob: new Blob(['a']), nomeFile: 'fattura.pdf', saltati: 0 }, 'ripiego.pdf')
    salvaFile({ blob: new Blob(['a']), nomeFile: null, saltati: 0 }, 'ripiego.pdf')
    expect(nomi).toEqual(['fattura.pdf', 'ripiego.pdf'])
  })
})
