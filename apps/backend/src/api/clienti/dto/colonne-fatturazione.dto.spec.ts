import { plainToInstance } from 'class-transformer'
import { validate } from 'class-validator'
import { CreaRegistroIvaDto, ModificaRegistroIvaDto } from './registro-iva.dto'
import { CreaSpesaAccessoriaDto, ModificaSpesaAccessoriaDto } from './spesa-accessoria.dto'

const ID = 'cccccccc-0000-4000-8000-000000000003'

async function errori<T extends object>(cls: new () => T, plain: object): Promise<string[]> {
  const e = await validate(plainToInstance(cls, plain))
  return e.map(x => x.property)
}

describe('DTO delle colonne della 4.4a', () => {
  describe('suffissoNumero del registro IVA', () => {
    const base = { codice: '01', descrizione: 'V', ricevuteSplit: false }
    it.each(['/A', 'A', '/A-1', 'ABCDEFGHIJ', '12/2026'])('"%s" e` valido', async s => {
      expect(await errori(CreaRegistroIvaDto, { ...base, suffissoNumero: s })).toEqual([])
      expect(await errori(ModificaRegistroIvaDto, { suffissoNumero: s, versione: 1 })).toEqual([])
    })
    it.each(['/A B', 'ABCDEFGHIJK', '', 'A.B', 'è', 5])('%j e` rifiutato', async s => {
      expect(await errori(CreaRegistroIvaDto, { ...base, suffissoNumero: s })).toEqual([
        'suffissoNumero',
      ])
      expect(await errori(ModificaRegistroIvaDto, { suffissoNumero: s, versione: 1 })).toEqual([
        'suffissoNumero',
      ])
    })
    it('omesso o null: valido', async () => {
      expect(await errori(CreaRegistroIvaDto, base)).toEqual([])
      expect(await errori(CreaRegistroIvaDto, { ...base, suffissoNumero: null })).toEqual([])
      expect(await errori(ModificaRegistroIvaDto, { suffissoNumero: null, versione: 1 })).toEqual(
        []
      )
    })
  })

  describe('codiceIvaId della spesa accessoria', () => {
    const base = { tipo: 'INCASSO', codice: 'X', descrizione: 'S', importo: '1.00' }
    it('un uuid, null o omesso sono validi', async () => {
      expect(await errori(CreaSpesaAccessoriaDto, { ...base, codiceIvaId: ID })).toEqual([])
      expect(await errori(CreaSpesaAccessoriaDto, { ...base, codiceIvaId: null })).toEqual([])
      expect(await errori(CreaSpesaAccessoriaDto, base)).toEqual([])
      expect(await errori(ModificaSpesaAccessoriaDto, { codiceIvaId: null, versione: 1 })).toEqual(
        []
      )
    })
    it('una stringa che non e` uuid (anche vuota) e` rifiutata', async () => {
      for (const v of ['', 'abc', 12]) {
        expect(await errori(CreaSpesaAccessoriaDto, { ...base, codiceIvaId: v })).toEqual([
          'codiceIvaId',
        ])
        expect(await errori(ModificaSpesaAccessoriaDto, { codiceIvaId: v, versione: 1 })).toEqual([
          'codiceIvaId',
        ])
      }
    })
  })
})
