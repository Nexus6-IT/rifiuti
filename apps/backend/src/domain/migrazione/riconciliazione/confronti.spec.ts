import {
  confrontiDa1A5,
  confronto1,
  confronto2,
  confronto3,
  confronto5,
  IngressiConfronti,
  SorgenteRiconciliazione,
} from './confronti'
import { RapportoDestinazione } from './tipi'

const sorgente: SorgenteRiconciliazione = {
  archivio: 'WW00012026',
  confronto1: {
    movimentiPerOper: [
      { oper: '10', tipo: 'CARICO', attivi: 3, annullati: 1 },
      { oper: '11', tipo: 'SCARICO', attivi: 2, annullati: 0 },
      { oper: '13', tipo: 'ENTRAMBI', attivi: 1, annullati: 0 },
      { oper: '12', tipo: 'NESSUNA_GIACENZA', attivi: 5, annullati: 0 },
    ],
    formulariPerStato: [{ stato: 'A', conteggio: 4 }],
  },
  confronto2: {
    righe: [
      { anno: 2026, cer: '15 01 01', tipo: 'CARICO', movimenti: 3, kgnum: 300, mcnum: 0 },
      { anno: 2026, cer: '15 01 01', tipo: 'SCARICO', movimenti: 2, kgnum: 120.5, mcnum: 2 },
      { anno: 2026, cer: '20 03 01', tipo: 'ENTRAMBI', movimenti: 1, kgnum: 10, mcnum: 0 },
    ],
  },
  confronto4: {
    registri: [{ anno: 2026, conteggio: 6, buchiTotali: 1, duplicati: [] }],
  },
  confronto5: { renRegistrazioni: { presente: true, conIdRentri: 2 } },
}

const destinazione: RapportoDestinazione = {
  lotti: [
    {
      id: 'l1',
      ambito: 'REGISTRO',
      archivio: 'WW00012026',
      stato: 'COMPLETATO',
      inserite: 7,
      lette: 7,
      saltate: 0,
    },
    {
      id: 'l2',
      ambito: 'FIR',
      archivio: 'WW00012026',
      stato: 'COMPLETATO',
      inserite: 4,
      lette: 4,
      saltate: 0,
    },
    {
      id: 'l3',
      ambito: 'GIACENZE',
      archivio: 'WW00012026',
      stato: 'COMPLETATO',
      inserite: 2,
      lette: 2,
      saltate: 0,
    },
  ],
  righePerTabella: { WasteMovement: 7, FIR: 4, GiacenzaIniziale: 2 },
  movimentiPerVerso: { CARICO: 4, SCARICO: 3 },
  totali: [
    { anno: 2026, cer: '15 01 01', verso: 'CARICO', movimenti: 3, kg: 300, m3: 0 },
    { anno: 2026, cer: '15 01 01', verso: 'SCARICO', movimenti: 2, kg: 120.5, m3: 2 },
    { anno: 2026, cer: '20 03 01', verso: 'CARICO', movimenti: 1, kg: 10, m3: 0 },
    { anno: 2026, cer: '20 03 01', verso: 'SCARICO', movimenti: 1, kg: 10, m3: 0 },
  ],
  numerazione: [
    { registroId: 'r', anno: 2026, conteggio: 6, primo: 1, ultimo: 7, buchi: [4], buchiTotali: 1 },
  ],
  collisioniNumerazione: 0,
  firImportati: 4,
  giacenze: [
    { registroId: 'r', cer: '15 01 01', statoFisico: 'Solido', kg: 100.25 },
    { registroId: 'r2', cer: '15 01 01', statoFisico: 'Solido', kg: 50 },
  ],
  rentri: {
    movimenti: 7,
    daRiconciliare: 7,
    nonBloccati: 0,
    conIdentificativo: 2,
    identificativi: [
      { identificativo: 'MOV-1', registroRentri: 'REG-1' },
      { identificativo: 'MOV-2', registroRentri: 'REG-1' },
    ],
  },
}

const base: IngressiConfronti = {
  sorgente,
  destinazione,
  giacenzeAttese: [{ cer: '15 01 01', kg: 150.25 }],
  verificheRentri: [
    { identificativo: 'MOV-1', esito: 'PRESENTE' },
    { identificativo: 'MOV-2', esito: 'PRESENTE' },
  ],
}

describe('confronti 1-5 della riconciliazione', () => {
  it('un import coerente da tutti OK', () => {
    const c = confrontiDa1A5(base)
    expect(c.map(x => [x.numero, x.esito])).toEqual([
      [1, 'OK'],
      [2, 'OK'],
      [3, 'OK'],
      [4, 'OK'],
      [5, 'OK'],
    ])
  })

  it('ENTRAMBI conta come carico e come scarico; gli annullati e le operazioni senza giacenza no', () => {
    const c = confronto1(base)
    const carico = c.voci.find(v => v.chiave === 'movimenti-carico')
    const scarico = c.voci.find(v => v.chiave === 'movimenti-scarico')
    expect([carico?.sorgente, scarico?.sorgente]).toEqual([4, 3])
  })

  it('un movimento in meno nel registro e una differenza di conteggio', () => {
    const c = confronto1({
      ...base,
      destinazione: { ...destinazione, movimentiPerVerso: { CARICO: 3, SCARICO: 3 } },
    })
    expect(c.esito).toBe('DIFFERENZE')
    expect(c.voci.filter(v => v.esito === 'DIFFERENZA').map(v => v.chiave)).toEqual([
      'movimenti-carico',
    ])
  })

  it('kg e m3 sono voci separate: i m3 non si sommano ai kg', () => {
    const c = confronto2(base)
    const chiavi = c.voci.map(v => v.chiave)
    expect(chiavi).toContain('2026|15 01 01|SCARICO|kg')
    expect(chiavi).toContain('2026|15 01 01|SCARICO|m3')
    // 2 m3 di sorgente non compensano 2 kg in meno a destinazione.
    const d = {
      ...destinazione,
      totali: destinazione.totali.map(t =>
        t.verso === 'SCARICO' && t.cer === '15 01 01' ? { ...t, kg: 118.5, m3: 2 } : t
      ),
    }
    const g = confronto2({ ...base, destinazione: d })
    expect(g.voci.filter(v => v.esito === 'DIFFERENZA').map(v => v.chiave)).toEqual([
      '2026|15 01 01|SCARICO|kg',
    ])
  })

  it('la soglia e 0,001 kg: sotto passa, sopra no', () => {
    const con = (kg: number) =>
      confronto2({
        ...base,
        destinazione: {
          ...destinazione,
          totali: destinazione.totali.map(t =>
            t.cer === '15 01 01' && t.verso === 'CARICO' ? { ...t, kg } : t
          ),
        },
      }).esito
    expect(con(300.0004)).toBe('OK')
    expect(con(300.002)).toBe('DIFFERENZE')
  })

  it('un totale presente solo a destinazione e una differenza', () => {
    const d = {
      ...destinazione,
      totali: [
        ...destinazione.totali,
        { anno: 2026, cer: '13 02 05*', verso: 'CARICO' as const, movimenti: 1, kg: 5, m3: 0 },
      ],
    }
    expect(confronto2({ ...base, destinazione: d }).esito).toBe('DIFFERENZE')
  })

  it('senza giacenza attesa il confronto 3 e NON_VERIFICATO con una differenza accettabile', () => {
    const c = confronto3({ ...base, giacenzeAttese: undefined })
    expect(c.esito).toBe('NON_VERIFICATO')
    expect(c.voci.find(v => v.chiave === 'non-verificato')?.esito).toBe('DIFFERENZA')
  })

  it('la giacenza si somma sui registri e la soglia e 0,001', () => {
    expect(confronto3(base).esito).toBe('OK')
    const c = confronto3({ ...base, giacenzeAttese: [{ cer: '15 01 01', kg: 150.3 }] })
    expect(c.esito).toBe('DIFFERENZE')
  })

  it('una giacenza negativa e una differenza', () => {
    const d = {
      ...destinazione,
      giacenze: [{ registroId: 'r', cer: '15 01 01', statoFisico: 'Solido', kg: -1 }],
    }
    const c = confronto3({
      ...base,
      destinazione: d,
      giacenzeAttese: [{ cer: '15 01 01', kg: -1 }],
    })
    expect(c.voci.find(v => v.chiave === 'negative')?.esito).toBe('DIFFERENZA')
  })

  it('i confronti del registro non si applicano senza lotto del registro', () => {
    const d = { ...destinazione, lotti: destinazione.lotti.filter(l => l.ambito !== 'REGISTRO') }
    const c = confrontiDa1A5({ ...base, destinazione: d })
    expect(c.map(x => x.esito)).toEqual([
      'OK',
      'NON_APPLICABILE',
      'OK',
      'NON_APPLICABILE',
      'NON_APPLICABILE',
    ])
  })

  it('numerazione: un buco non dichiarato dalla sorgente e una differenza', () => {
    const d = {
      ...destinazione,
      numerazione: [
        {
          registroId: 'r',
          anno: 2026,
          conteggio: 6,
          primo: 1,
          ultimo: 8,
          buchi: [4, 5],
          buchiTotali: 2,
        },
      ],
    }
    const c = confrontiDa1A5({ ...base, destinazione: d })[3]
    expect(c.voci.find(v => v.chiave === 'anno|2026|buchi')?.esito).toBe('DIFFERENZA')
  })

  it('RENTRI: movimento non bloccato, identificativo mancante o assente su RENTRI sono differenze', () => {
    expect(confronto5(base).esito).toBe('OK')
    const nonBloccato = confronto5({
      ...base,
      destinazione: { ...destinazione, rentri: { ...destinazione.rentri, nonBloccati: 1 } },
    })
    expect(nonBloccato.esito).toBe('DIFFERENZE')
    const assente = confronto5({
      ...base,
      verificheRentri: [
        { identificativo: 'MOV-1', esito: 'PRESENTE' },
        { identificativo: 'MOV-2', esito: 'ASSENTE' },
      ],
    })
    expect(assente.voci.filter(v => v.esito === 'DIFFERENZA').map(v => v.chiave)).toEqual([
      'verifica-presenti',
      'verifica-assenti',
    ])
  })

  it('RENTRI: identificativi da verificare ma verifica non eseguita = NON_VERIFICATO', () => {
    const c = confronto5({ ...base, verificheRentri: undefined })
    expect(c.esito).toBe('NON_VERIFICATO')
  })
})
