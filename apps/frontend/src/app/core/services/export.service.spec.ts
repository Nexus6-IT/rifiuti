import { ExportService } from './export.service'
import { Movimento } from '../../features/registro/registro.service'
import { FIR } from '../../shared/models/fir.model'

function mov(parziale: Partial<Movimento> = {}): Movimento {
  return {
    id: 'm1',
    tenantId: 't1',
    progressiveNumber: 12,
    progressiveYear: 2026,
    type: 'CARICO',
    movementDate: '2026-10-20',
    registrationDate: '2026-10-21',
    causale: 'PRODUZIONE_INTERNA',
    cerCode: '17 04 05',
    quantity: 120,
    unit: 'KG',
    entryHash: 'abc',
    createdAt: '2026-10-21T08:00:00.000Z',
    ...parziale,
  }
}

const ricopia = (n: number) => ({
  progressiveNumber: n,
  progressiveYear: 2026,
  tipoAnnotazione: 'ORDINARIA' as const,
})

describe('ExportService - registro con rettifiche e annullamenti', () => {
  const servizio = new ExportService()
  const movimenti = [
    mov({ id: 'a', progressiveNumber: 1, stato: 'RETTIFICATO' }),
    mov({ id: 'b', progressiveNumber: 2, tipoAnnotazione: 'RETTIFICA', rettificaDi: ricopia(1) }),
    mov({
      id: 'c',
      progressiveNumber: 3,
      tipoAnnotazione: 'ANNULLAMENTO',
      rettificaDi: ricopia(2),
      stato: 'ANNULLATO',
    }),
    mov({ id: 'd', progressiveNumber: 4, tipoAnnotazione: 'ORDINARIA', stato: 'VIGENTE' }),
    mov({ id: 'e', progressiveNumber: 5 }), // backend senza i nuovi campi
  ]

  it('PDF: colonne Annotazione e Stato, con il quantitativo ancora nella colonna giusta', () => {
    const { head, body } = servizio.tabellaRegistroPdf(movimenti)
    expect(head).toContain('Annotazione')
    expect(head).toContain('Stato')
    const iAnn = head.indexOf('Annotazione')
    const iSta = head.indexOf('Stato')
    expect(body.map(r => r[iAnn])).toEqual([
      'Ordinaria',
      'Rettifica di 1/2026',
      'Annullamento di 2/2026',
      'Ordinaria',
      'Ordinaria',
    ])
    expect(body.map(r => r[iSta])).toEqual([
      'Rettificato',
      'Vigente',
      'Annullato',
      'Vigente',
      'Vigente',
    ])
    expect(body.every(r => r.length === head.length)).toBeTrue()
    expect(body[0][head.indexOf('Quantità')]).toBe('120 KG')
  })

  it('PDF con la colonna Sede: la colonna Quantità resta il decimo campo (indice 9)', () => {
    const meta = { etichettaSede: () => 'Sede A' }
    const { head } = servizio.tabellaRegistroPdf(movimenti, meta)
    expect(head.indexOf('Sede')).toBe(1)
    expect(head.indexOf('Quantità')).toBe(9)
    expect(servizio.tabellaRegistroPdf(movimenti).head.indexOf('Quantità')).toBe(8)
  })

  it('Excel: colonne Annotazione e Stato su ogni riga', () => {
    const righe = servizio.righeRegistroExcel(movimenti)
    expect(righe.map(r => r['Annotazione'])).toEqual([
      'Ordinaria',
      'Rettifica di 1/2026',
      'Annullamento di 2/2026',
      'Ordinaria',
      'Ordinaria',
    ])
    expect(righe.map(r => r['Stato'])).toEqual([
      'Rettificato',
      'Vigente',
      'Annullato',
      'Vigente',
      'Vigente',
    ])
    expect(Object.keys(righe[0])).toEqual(
      jasmine.arrayContaining(['Progressivo', 'Tipo', 'Annotazione', 'Stato', 'Causale', 'CER'])
    )
  })
})

describe('ExportService - PDF di dettaglio del FIR', () => {
  const servizio = new ExportService()
  const fir = (unitaMisura: string, pesoEffettivo?: number) =>
    ({
      rifiuto: { cerCode: '17 04 05', quantita: 2, unitaMisura, statoFisico: 'SOLIDO' },
      pesoEffettivo,
    }) as unknown as FIR

  it('il peso effettivo esce con l unita del FIR, non con kg fisso', () => {
    const righe = servizio.righeRifiutoPdf(fir('T', 2.5))
    expect(righe.find(r => r[0] === 'Peso Effettivo')).toEqual(['Peso Effettivo', '2.5 T'])
    expect(righe.find(r => r[0] === 'Quantità Dichiarata')).toEqual(['Quantità Dichiarata', '2 T'])
  })

  it('senza peso a destino resta N/D', () => {
    const righe = servizio.righeRifiutoPdf(fir('KG'))
    expect(righe.find(r => r[0] === 'Peso Effettivo')).toEqual(['Peso Effettivo', 'N/D'])
  })
})
