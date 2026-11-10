import { comandoFirDaRitiro, unitaDaRitiro, type RitiroPerFir } from './comando-fir-da-ritiro'
import { ProvenienzaRifiuto, TipoTratta } from '../fir/aggregates/fir.aggregate'
import { UnitaMisura } from '../fir/value-objects/quantita'

const ritiro: RitiroPerFir = {
  id: 'r-1',
  produttoreId: 'p-1',
  produttoreSedeId: 'ps-1',
  trasportatoreId: 't-1',
  destinatarioId: 'd-1',
  destinatarioSedeId: 'ds-1',
  cerCode: '15 01 01',
  descrizione: 'Imballaggi in carta',
  statoFisico: 'SOLIDO',
  caratteristichePericolo: 'HP3,HP4',
  numeroColli: 4,
  quantitaPresunta: '1250.50',
  unita: 'kg',
  tipoOperazione: 'RECOVERY',
  codiceOperazione: 'R13',
  provenienza: ProvenienzaRifiuto.SPECIALE,
  tipoTratta: TipoTratta.TERRESTRE,
  annotazioni: 'Citofonare',
  noteInterne: 'cancello rosso',
}

describe('comandoFirDaRitiro', () => {
  const ctx = { userId: 'u-1', tenantId: 'ten-1' }

  it('copia tutti i campi e valorizza ritiroId', () => {
    expect(comandoFirDaRitiro(ritiro, ctx)).toEqual({
      produttoreId: 'p-1',
      produttoreSedeId: 'ps-1',
      trasportatoreId: 't-1',
      destinatarioId: 'd-1',
      destinatarioSedeId: 'ds-1',
      rifiuto: {
        cerCode: '15 01 01',
        quantita: 1250.5,
        unitaMisura: UnitaMisura.KG,
        statoFisico: 'SOLIDO',
        caratteristichePericolo: 'HP3,HP4',
        numeroColli: 4,
        descrizione: 'Imballaggi in carta',
        tipoOperazione: 'RECOVERY',
        codiceOperazione: 'R13',
      },
      userId: 'u-1',
      tenantId: 'ten-1',
      provenienza: ProvenienzaRifiuto.SPECIALE,
      tipoTrattaPrincipale: TipoTratta.TERRESTRE,
      trasportatoriAggiuntivi: [],
      annotazioni: 'Citofonare',
      ritiroId: 'r-1',
    })
  })

  it('le note interne non finiscono mai sul FIR', () => {
    expect(JSON.stringify(comandoFirDaRitiro(ritiro, ctx))).not.toContain('cancello rosso')
  })

  it('i campi facoltativi nulli o vuoti diventano assenti', () => {
    const c = comandoFirDaRitiro(
      {
        ...ritiro,
        descrizione: null,
        statoFisico: '  ',
        caratteristichePericolo: null,
        numeroColli: null,
        tipoOperazione: null,
        codiceOperazione: null,
        annotazioni: null,
      },
      ctx
    )
    expect(c.annotazioni).toBeUndefined()
    expect(c.rifiuto).toEqual({
      cerCode: '15 01 01',
      quantita: 1250.5,
      unitaMisura: UnitaMisura.KG,
      statoFisico: undefined,
      caratteristichePericolo: undefined,
      numeroColli: undefined,
      descrizione: undefined,
      tipoOperazione: undefined,
      codiceOperazione: undefined,
    })
  })

  it('rifiuta quantità illeggibile o non positiva', () => {
    expect(() => comandoFirDaRitiro({ ...ritiro, quantitaPresunta: 'abc' }, ctx)).toThrow(
      /Quantità/
    )
    expect(() => comandoFirDaRitiro({ ...ritiro, quantitaPresunta: '0' }, ctx)).toThrow(/Quantità/)
  })
})

describe('unitaDaRitiro', () => {
  it('accetta maiuscole e minuscole, rifiuta le sconosciute', () => {
    expect(unitaDaRitiro('KG')).toBe(UnitaMisura.KG)
    expect(unitaDaRitiro('litri')).toBe(UnitaMisura.LITRI)
    expect(unitaDaRitiro('T')).toBe(UnitaMisura.TONNELLATE)
    expect(() => unitaDaRitiro('mc')).toThrow(/non supportata/)
  })
})
