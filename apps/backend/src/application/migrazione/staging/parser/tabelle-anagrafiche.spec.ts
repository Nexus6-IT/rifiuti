import { sorgenteInMemoria } from '../../../../test-support/migrazione-sorgente'
import { StagingError } from '../manifest'
import { CHIAVI_TABELLE_ESTESE, parsaTabellaEstesa } from './tabelle-anagrafiche'

type Valori = Record<string, string | null>
const parsa = (tabella: string, ...righe: Valori[]) =>
  parsaTabellaEstesa(tabella, sorgenteInMemoria(tabella, righe))

describe('parsaTabellaEstesa (I1: parser minimi delle tabelle nuove)', () => {
  it('copre le 17 tabelle del catalogo esteso, ognuna con almeno una colonna chiave', () => {
    expect(Object.keys(CHIAVI_TABELLE_ESTESE)).toHaveLength(17)
    for (const k of Object.values(CHIAVI_TABELLE_ESTESE)) expect(k.chiave.length).toBeGreaterThan(0)
  })

  it('CLIFOR: chiave PRECOD+COD, valori ripuliti dagli spazi', async () => {
    const r = await parsa('CLIFOR', { PRECOD: 'C', COD: '000001', DES: '  Rossi Srl ' })
    expect(r.scarti).toEqual([])
    expect(r.record).toHaveLength(1)
    expect(r.record[0]).toMatchObject({
      tabella: 'CLIFOR',
      riga: 1,
      chiave: 'C|000001',
      campi: { PRECOD: 'C', COD: '000001', DES: 'Rossi Srl' },
    })
  })

  it('senza PK, due righe con la stessa chiave: la seconda e scartata CHIAVE_DUPLICATA', async () => {
    const r = await parsa(
      'AUTOMEZZI',
      { PRECOD: '00000100000', COD: '0001', TARGA: 'AA111AA' },
      { PRECOD: '00000100000', COD: '0001', TARGA: 'BB222BB' },
      { PRECOD: '00000100000', COD: '0002', TARGA: 'CC333CC' }
    )
    expect(r.record.map(x => x.chiave)).toEqual(['00000100000|0001', '00000100000|0002'])
    expect(r.scarti).toEqual([
      {
        tabella: 'AUTOMEZZI',
        cod: '00000100000|0001',
        riga: 2,
        codice: 'CHIAVE_DUPLICATA',
        dettaglio: 'PRECOD+COD gia presenti alla riga 1',
      },
    ])
    // Il rapporto non contiene valori (targa): solo chiave e numero di riga.
    expect(JSON.stringify(r.scarti)).not.toContain('BB222BB')
  })

  it('duplicati come sul server: maiuscole/minuscole ininfluenti, il separatore non crea collisioni', async () => {
    const r = await parsa(
      'AUTISTI',
      { PRECOD: 'a|b', COD: 'c' },
      { PRECOD: 'a', COD: 'b|c' },
      { PRECOD: 'X1', COD: 'ab' },
      { PRECOD: 'x1', COD: 'AB' }
    )
    expect(r.record).toHaveLength(3)
    expect(r.scarti.map(x => x.riga)).toEqual([4])
  })

  it('chiave vuota: scarto CHIAVE_VUOTA con le colonne coinvolte', async () => {
    const r = await parsa('ADDEBCON', { COD: ' ' })
    expect(r.record).toEqual([])
    expect(r.scarti[0]).toMatchObject({ codice: 'CHIAVE_VUOTA', dettaglio: 'COD: obbligatorio' })
  })

  it('NULL e stringa vuota si equivalgono per la chiave', async () => {
    const r = await parsa('CONTRATTI', { PRECOD: null, COD: '0001' })
    expect(r.scarti[0].codice).toBe('CHIAVE_VUOTA')
    expect(r.scarti[0].dettaglio).toBe('PRECOD: obbligatorio')
  })

  it('XRENTRIFORMULARI: il codice fiscale non finisce mai nel rapporto degli scarti', async () => {
    const r = await parsa(
      'XRENTRIFORMULARI',
      { CODICEFISCALE: '01234567890', NUMEROFIR: 'AB123456' },
      { CODICEFISCALE: '01234567890', NUMEROFIR: 'AB123456' }
    )
    expect(r.scarti).toHaveLength(1)
    expect(JSON.stringify(r.scarti)).not.toContain('01234567890')
    expect(r.scarti[0].cod).toBe('AB123456')
    // Nel record la chiave e completa (servira all'import dei FIR, I5).
    expect(r.record[0].chiave).toBe('01234567890|AB123456')
  })

  it('RENesportazioni: nessun valore di DOCUMENTO (escluso dal catalogo) nei record', async () => {
    const r = await parsa('RENesportazioni', { ID: '7', HASH: 'abc' })
    expect(Object.keys(r.record[0].campi)).not.toContain('DOCUMENTO')
  })

  it('manca una colonna chiave nel manifest: errore COLONNA_OBBLIGATORIA_ASSENTE', async () => {
    await expect(
      parsaTabellaEstesa('CLIFOR', sorgenteInMemoria('CLIFOR', [], ['PRECOD', 'DES']))
    ).rejects.toThrow(StagingError)
    await expect(
      parsaTabellaEstesa('CLIFOR', sorgenteInMemoria('CLIFOR', [], ['PRECOD', 'DES']))
    ).rejects.toMatchObject({ codice: 'COLONNA_OBBLIGATORIA_ASSENTE' })
  })

  it('una tabella che non e del catalogo esteso e rifiutata', async () => {
    await expect(
      parsaTabellaEstesa('MOVIMENTI', sorgenteInMemoria('MOVIMENTI', []))
    ).rejects.toThrow(/non gestita/)
  })
})
