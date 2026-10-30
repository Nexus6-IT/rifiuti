import { FIR, FIRStato } from '../../shared/models/fir.model'
import {
  etichettaSede,
  formDaFir,
  sedeSoloSeCambiata,
  testoMotivoNonModificabile,
} from './fir-form'

describe('formDaFir', () => {
  const fir: FIR = {
    id: 'f1',
    numeroProgressivo: null,
    anno: 2026,
    stato: FIRStato.BOZZA,
    versione: 5,
    modificabile: true,
    produttoreId: 'p1',
    trasportatoreId: 't1',
    destinatarioId: 'd1',
    provenienza: 'SPECIALE',
    tipoTrattaPrincipale: 'FERROVIARIA',
    rifiuto: {
      cerCode: '150101',
      quantita: 12.5,
      unitaMisura: 't',
      statoFisico: 'Solido',
      caratteristichePericolo: 'HP4',
      numeroColli: 3,
      codiceOperazione: 'R13',
      descrizione: 'Imballaggi in carta',
      categoria: 'URBANI',
      tipoOperazione: 'RECOVERY',
    },
    annotazioni: 'note',
    trasportatoriAggiuntivi: [
      { trasportatoreId: 't2', tipoTratta: 'MARITTIMA', ordine: 1 },
      { tipoTratta: 'TERRESTRE', ordine: 2 },
    ],
    createdAt: '2026-01-01T00:00:00Z',
  }

  it('riporta i campi del form, con l’unità di misura del FIR', () => {
    const dto = formDaFir(fir)
    expect(dto.produttoreId).toBe('p1')
    expect(dto.trasportatoreId).toBe('t1')
    expect(dto.destinatarioId).toBe('d1')
    expect(dto.provenienza).toBe('SPECIALE')
    expect(dto.tipoTrattaPrincipale).toBe('FERROVIARIA')
    expect(dto.annotazioni).toBe('note')
    expect(dto.rifiuto).toEqual({
      cerCode: '150101',
      quantita: 12.5,
      unitaMisura: 't',
      statoFisico: 'Solido',
      caratteristichePericolo: 'HP4',
      numeroColli: 3,
      codiceOperazione: 'R13',
    })
  })

  it('non copia i campi del rifiuto che il backend rifiuta con 400', () => {
    const rifiuto = formDaFir(fir).rifiuto as Record<string, unknown>
    expect('descrizione' in rifiuto).toBeFalse()
    expect('categoria' in rifiuto).toBeFalse()
    expect('tipoOperazione' in rifiuto).toBeFalse()
  })

  it('non porta campi di sola lettura del FIR', () => {
    const dto = formDaFir(fir) as unknown as Record<string, unknown>
    for (const k of ['id', 'stato', 'versione', 'modificabile', 'numeroProgressivo', 'createdAt']) {
      expect(k in dto).toBeFalse()
    }
  })

  it('riporta le tratte con trasportatore, tipo e ordine e omette quelle senza trasportatore', () => {
    expect(formDaFir(fir).trasportatoriAggiuntivi).toEqual([
      { trasportatoreId: 't2', tipoTratta: 'MARITTIMA', ordine: 1 },
    ])
  })

  it('senza tratte non valorizza trasportatoriAggiuntivi', () => {
    expect(
      formDaFir({ ...fir, trasportatoriAggiuntivi: [] }).trasportatoriAggiuntivi
    ).toBeUndefined()
  })

  it('conserva le sedi del FIR come valore iniziale e non le porta se assenti', () => {
    const conSedi = formDaFir({
      ...fir,
      produttore: { ragioneSociale: 'P', partitaIva: '12345678903', sedeId: 'sede-p' },
      destinatario: { ragioneSociale: 'D', partitaIva: '', codiceFiscale: 'X', sedeId: 'sede-d' },
    })
    expect(conSedi.produttoreSedeId).toBe('sede-p')
    expect(conSedi.destinatarioSedeId).toBe('sede-d')

    const senza = formDaFir({
      ...fir,
      produttore: { ragioneSociale: 'P', partitaIva: '12345678903', sedeId: null },
    })
    expect(senza.produttoreSedeId).toBeUndefined()
    expect(senza.destinatarioSedeId).toBeUndefined()
  })

  it('i null del backend diventano undefined', () => {
    const dto = formDaFir({
      ...fir,
      provenienza: null,
      tipoTrattaPrincipale: null,
      annotazioni: null,
    })
    expect(dto.provenienza).toBeUndefined()
    expect(dto.tipoTrattaPrincipale).toBeUndefined()
    expect(dto.annotazioni).toBeUndefined()
  })
})

describe('testoMotivoNonModificabile', () => {
  it('ha un testo per ogni motivo e nessuno senza motivo', () => {
    for (const m of [
      'LEGATO_RENTRI',
      'NON_BOZZA',
      'FIRMATO',
      'IN_ATTESA_FIRMA_PRODUTTORE',
    ] as const) {
      expect(testoMotivoNonModificabile(m).length).toBeGreaterThan(10)
    }
    expect(testoMotivoNonModificabile(null)).toBe('')
    expect(testoMotivoNonModificabile(undefined)).toBe('')
  })
})

describe('sedeSoloSeCambiata', () => {
  it('omette la sede se uguale a quella iniziale o se assente', () => {
    expect(sedeSoloSeCambiata('s1', 's1')).toBeUndefined()
    expect(sedeSoloSeCambiata(undefined, 's1')).toBeUndefined()
    expect(sedeSoloSeCambiata(null, null)).toBeUndefined()
  })

  it('porta la sede se diversa da quella iniziale, anche quando l’iniziale è nulla', () => {
    expect(sedeSoloSeCambiata('s2', 's1')).toBe('s2')
    expect(sedeSoloSeCambiata('s2', null)).toBe('s2')
    expect(sedeSoloSeCambiata('s2', undefined)).toBe('s2')
  })
})

describe('etichettaSede', () => {
  const base = {
    denominazione: null,
    via: 'Via Roma',
    civico: '1',
    cap: '20100',
    citta: 'Milano',
    provincia: 'MI',
  }

  it('descrive l’indirizzo, con denominazione e note se ci sono', () => {
    expect(etichettaSede(base)).toBe('Via Roma 1, 20100 Milano (MI)')
    expect(etichettaSede({ ...base, denominazione: 'Deposito', principale: true })).toBe(
      'Deposito — Via Roma 1, 20100 Milano (MI) [principale]'
    )
    expect(etichettaSede({ ...base, attiva: false })).toContain('[non attiva]')
  })
})
