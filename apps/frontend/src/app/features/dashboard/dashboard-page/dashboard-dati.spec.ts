import { VoceAttenzione } from '../attenzione.service'
import { AvvisoDeposito } from '../../giacenze/giacenze.service'
import {
  barreDeposito,
  celleAnalisi,
  intervalloMeseCorrente,
  livelloConformita,
  rispostaDelGiorno,
  unisciVoci,
  vociClassifica,
  vociDaDeposito,
} from './dashboard-dati'
import {
  cerFixture,
  dashboardFixture,
  dashboardSenzaFir,
  depositoFixture,
  registroFixture,
} from './dashboard-fixture'

function voce(chiave: string, gravita: VoceAttenzione['gravita']): VoceAttenzione {
  return { chiave, gravita, titolo: chiave, dettaglio: '' }
}

function avviso(over: Partial<AvvisoDeposito>): AvvisoDeposito {
  return {
    tipo: 'DURATA',
    livello: 'SUPERATO',
    cerCode: '08 01 11*',
    valore: 95,
    soglia: 92,
    unita: 'giorni',
    giornoPiuVecchio: '2026-08-01',
    scadenza: '2026-11-01',
    messaggio: 'messaggio',
    ...over,
  }
}

describe('dashboard-dati', () => {
  describe('intervalloMeseCorrente', () => {
    it('va dal 1° del mese alle 00:00 UTC fino a oggi', () => {
      const oggi = new Date(Date.UTC(2026, 10, 5, 9, 20))
      const { startDate, endDate } = intervalloMeseCorrente(oggi)
      expect(startDate.getTime()).toBe(Date.UTC(2026, 10, 1))
      expect(endDate.getTime()).toBe(oggi.getTime())
    })

    it('a cavallo della mezzanotte usa il mese UTC, come le barre', () => {
      // 31/10 23:30 UTC = 1/11 00:30 a Roma: per il backend e' ancora ottobre.
      const oggi = new Date(Date.UTC(2026, 9, 31, 23, 30))
      expect(intervalloMeseCorrente(oggi).startDate.getTime()).toBe(Date.UTC(2026, 9, 1))
    })
  })

  describe('vociDaDeposito', () => {
    it('un avviso SUPERATO è critico e uno PREAVVISO è avviso, con chiavi per tipo', () => {
      const vista = depositoFixture([
        registroFixture({
          avvisi: [
            avviso({
              tipo: 'DURATA',
              livello: 'SUPERATO',
              messaggio: 'Giacenza oltre i 92 giorni',
            }),
            avviso({
              tipo: 'QUANTITA_TOTALE',
              livello: 'PREAVVISO',
              cerCode: null,
              messaggio: 'Quasi 30 m³',
            }),
          ],
        }),
      ])
      const voci = vociDaDeposito(vista)
      expect(voci.map(v => [v.chiave, v.gravita])).toEqual([
        ['deposito-durata', 'critico'],
        ['deposito-quantita-totale', 'avviso'],
      ])
      expect(voci[0].titolo).toBe('Giacenza oltre i 92 giorni')
      expect(voci[0].dettaglio).toBe('Registro impianto di Sesto')
      expect(voci[0].azione).toEqual({ etichetta: 'Vedi le giacenze', rotta: '/giacenze' })
    })

    it('ignora i registri non attivi, come il blocco del deposito (M9)', () => {
      const vista = depositoFixture([registroFixture({ attivo: false, avvisi: [avviso({})] })])
      expect(vociDaDeposito(vista)).toEqual([])
    })

    it('senza avvisi non dà voci', () => {
      expect(vociDaDeposito(depositoFixture())).toEqual([])
    })
  })

  describe('unisciVoci', () => {
    it("mette i critici per primi e a parità tiene l'ordine", () => {
      const unite = unisciVoci(
        [voce('a1', 'avviso'), voce('c1', 'critico'), voce('i1', 'informativo')],
        [voce('d1', 'avviso'), voce('d2', 'critico')]
      )
      expect(unite.map(v => v.chiave)).toEqual(['c1', 'd2', 'a1', 'd1', 'i1'])
    })
  })

  describe('rispostaDelGiorno', () => {
    it('0 voci', () => {
      expect(rispostaDelGiorno([])).toBe('Nessuna scadenza da seguire oggi')
    })
    it('1 voce', () => {
      expect(rispostaDelGiorno([voce('a', 'avviso')])).toBe('1 cosa da fare oggi')
    })
    it('4 voci con 1 critico', () => {
      const voci = [
        voce('a', 'critico'),
        voce('b', 'avviso'),
        voce('c', 'avviso'),
        voce('d', 'informativo'),
      ]
      expect(rispostaDelGiorno(voci)).toBe('4 cose da fare oggi, 1 urgente')
    })
    it('4 voci con 2 critici', () => {
      const voci = [
        voce('a', 'critico'),
        voce('b', 'critico'),
        voce('c', 'avviso'),
        voce('d', 'informativo'),
      ]
      expect(rispostaDelGiorno(voci)).toBe('4 cose da fare oggi, 2 urgenti')
    })
  })

  describe('barreDeposito', () => {
    it('TEMPORALE: solo la barra della durata', () => {
      const barre = barreDeposito(registroFixture())
      expect(barre.length).toBe(1)
      expect(barre[0]).toEqual({
        etichetta: 'Giacenza più vecchia',
        valore: 89,
        limite: 92,
        unita: 'giorni',
        allarme: false,
        nota: '08 01 11* · entro il 08/11',
      })
    })

    it('giorniMax null con 89 giorni su 92 dà «89 di 92»', () => {
      const [barra] = barreDeposito(registroFixture())
      expect([barra.valore, barra.limite]).toEqual([89, 92])
    })

    it('QUANTITATIVO: pericolosi, totale e durata sul tetto annuale', () => {
      const r = registroFixture({
        soglie: { ...registroFixture().soglie, criterio: 'QUANTITATIVO' },
        cer: [
          cerFixture({ etaGiorni: 120, giornoPiuVecchio: '2026-07-08', scadenza: '2027-07-08' }),
        ],
        totalePericolosiKg: 6400,
        totaleKg: 17900,
      })
      const barre = barreDeposito(r)
      expect(barre.map(b => b.etichetta)).toEqual(['Pericolosi', 'Totale', 'Giacenza più vecchia'])
      expect(barre[0]).toEqual(
        jasmine.objectContaining({ valore: 6400, limite: 10000, unita: 'kg' })
      )
      expect(barre[1]).toEqual(
        jasmine.objectContaining({ valore: 17900, limite: 30000, unita: 'kg' })
      )
      expect(barre[2]).toEqual(
        jasmine.objectContaining({ valore: 120, limite: 365, unita: 'giorni' })
      )
    })

    it('NON_SCELTO: tre barre e la nota del criterio non scelto', () => {
      const r = registroFixture({ soglie: { ...registroFixture().soglie, criterio: 'NON_SCELTO' } })
      const barre = barreDeposito(r)
      expect(barre.length).toBe(3)
      expect(barre[0].nota).toBe('Criterio non ancora scelto')
      expect(barre[1].nota).toBeNull()
    })

    it('con quantità parziale la nota dice «solo i rifiuti in kg»', () => {
      const r = registroFixture({
        soglie: { ...registroFixture().soglie, criterio: 'QUANTITATIVO' },
        quantitaParziale: true,
      })
      expect(barreDeposito(r)[0].nota).toBe('solo i rifiuti in kg')
    })

    it('nessun CER in giacenza: nessuna barra di durata', () => {
      expect(barreDeposito(registroFixture({ cer: [] }))).toEqual([])
      const q = registroFixture({
        cer: [],
        soglie: { ...registroFixture().soglie, criterio: 'QUANTITATIVO' },
      })
      expect(barreDeposito(q).map(b => b.etichetta)).toEqual(['Pericolosi', 'Totale'])
    })

    it("sceglie il CER più vecchio e segnala l'allarme del tipo corrispondente", () => {
      const r = registroFixture({
        cer: [
          cerFixture({
            cerCode: '15 01 06',
            etaGiorni: 10,
            giornoPiuVecchio: '2026-10-26',
            scadenza: '2027-01-26',
          }),
          cerFixture({ cerCode: '08 01 11*' }),
        ],
        avvisi: [avviso({ tipo: 'DURATA', livello: 'PREAVVISO' })],
      })
      const [barra] = barreDeposito(r)
      expect(barra.nota).toContain('08 01 11*')
      expect(barra.allarme).toBeTrue()
    })

    it("l'allarme delle quantità segue il tipo di avviso", () => {
      const r = registroFixture({
        soglie: { ...registroFixture().soglie, criterio: 'QUANTITATIVO' },
        avvisi: [avviso({ tipo: 'QUANTITA_PERICOLOSI', livello: 'SUPERATO', cerCode: null })],
      })
      const barre = barreDeposito(r)
      expect(barre.find(b => b.etichetta === 'Pericolosi')?.allarme).toBeTrue()
      expect(barre.find(b => b.etichetta === 'Totale')?.allarme).toBeFalse()
    })
  })

  describe('celleAnalisi', () => {
    const mesi = [
      { mese: '2026-10', conteggio: 32 },
      { mese: '2026-11', conteggio: 41 },
    ]

    it('con 0 FIR tutte le celle sono «—», senza il 20% della formula', () => {
      const celle = celleAnalisi(dashboardSenzaFir(), [])
      expect(celle.map(c => c.etichetta)).toEqual(['Conformità', 'Firme', 'RENTRI', 'Andamento'])
      expect(celle.every(c => c.valore === '—' && c.vuota)).toBeTrue()
      expect(celle[0].dettaglio).toBe('Si calcola dal primo formulario')
      expect(JSON.stringify(celle)).not.toContain('20%')
    })

    it('con 20 FIR: conformità, firme e RENTRI', () => {
      const celle = celleAnalisi(dashboardFixture(), mesi)
      expect(celle[0].valore).toBe('82%')
      expect(celle[0].dettaglio).toBe('Firme 90% · RENTRI 75% · Ritardi 4%')
      expect(celle[1].valore).toBe('18 di 20')
      expect(celle[1].dettaglio).toBe('Tempo medio 12,5 h')
      expect(celle[2].valore).toBe('15 di 20')
      expect(celle[2].dettaglio).toBe('5 in attesa')
    })

    it('senza modulo rentri: niente cella RENTRI e niente RENTRI nel dettaglio della conformità', () => {
      const celle = celleAnalisi(dashboardFixture(), mesi, false)
      expect(celle.map(c => c.etichetta)).toEqual(['Conformità', 'Firme', 'Andamento'])
      expect(celle[0].dettaglio).toBe('Firme 90% · Ritardi 4%')
      expect(
        celleAnalisi(dashboardSenzaFir(), [], false).map(c => c.etichetta)
      ).toEqual(['Conformità', 'Firme', 'Andamento'])
    })

    it('raggruppa anche le quattro cifre: «1.240 di 1.300» e «1.647 questo mese»', () => {
      const d = dashboardFixture({
        signatures: { completionRate: 0.9, total: 1300, completed: 1240, averageTimeHours: 3 },
      })
      const celle = celleAnalisi(d, [
        { mese: 'a', conteggio: 1200 },
        { mese: 'b', conteggio: 1647 },
      ])
      expect(celle[1].valore).toBe('1.240 di 1.300')
      expect(celle[3].valore).toBe('1.647 questo mese')
    })

    it('Andamento legge gli ultimi due mesi della serie, non trends.monthOverMonth', () => {
      const d = dashboardFixture({
        trends: {
          monthOverMonth: { current: 999, previous: 1, percentage: 9 },
          prediction: { nextMonth: 45 },
        },
      })
      const a = celleAnalisi(d, mesi)[3]
      expect(a.valore).toBe('41 questo mese')
      expect(a.dettaglio).toBe('32 il mese scorso · previsione del mese 45')
      expect(a.variazione).toBe('+28% sul mese scorso')
    })

    it('previsione null diventa «—»', () => {
      const d = dashboardFixture({
        trends: {
          monthOverMonth: { current: 0, previous: 0, percentage: 0 },
          prediction: { nextMonth: null },
        },
      })
      expect(celleAnalisi(d, mesi)[3].dettaglio).toBe('32 il mese scorso · previsione del mese —')
    })

    it('variazione in parole: invariato, nuovo, calo', () => {
      const d = dashboardFixture()
      const v = (p: number, c: number): string | null | undefined =>
        celleAnalisi(d, [
          { mese: 'a', conteggio: p },
          { mese: 'b', conteggio: c },
        ])[3].variazione
      expect(v(30, 30)).toBe('come il mese scorso')
      expect(v(0, 8)).toBe('nuovo')
      expect(v(40, 30)).toBe('−25% sul mese scorso')
    })

    it('tempo medio «—» con 0 firme completate e mai «0 h»', () => {
      const d = dashboardFixture({
        signatures: { completionRate: 0, total: 4, completed: 0, averageTimeHours: 0 },
      })
      expect(celleAnalisi(d, mesi)[1].dettaglio).toBe('Tempo medio —')
      const d2 = dashboardFixture({
        signatures: { completionRate: 1, total: 4, completed: 4, averageTimeHours: 0 },
      })
      expect(celleAnalisi(d2, mesi)[1].dettaglio).not.toMatch(/\b0 h/)
    })

    it("senza serie dell'andamento la cella è vuota", () => {
      const a = celleAnalisi(dashboardFixture(), [])[3]
      expect(a.valore).toBe('—')
      expect(a.vuota).toBeTrue()
    })
  })

  describe('livelloConformita', () => {
    it('null con 0 FIR (bug 5)', () => {
      expect(livelloConformita(dashboardSenzaFir())).toBeNull()
    })
    it('le quattro parole con il loro tono', () => {
      const livello = (l: 'EXCELLENT' | 'GOOD' | 'NEEDS_IMPROVEMENT' | 'CRITICAL') =>
        livelloConformita(
          dashboardFixture({ compliance: { ...dashboardFixture().compliance, level: l } })
        )
      expect(livello('EXCELLENT')).toEqual({ parola: 'Eccellente', tono: 'ok' })
      expect(livello('GOOD')).toEqual({ parola: 'Buona', tono: 'ok' })
      expect(livello('NEEDS_IMPROVEMENT')).toEqual({ parola: 'Da migliorare', tono: 'warn' })
      expect(livello('CRITICAL')).toEqual({ parola: 'Critica', tono: 'err' })
    })
  })

  describe('vociClassifica', () => {
    it('usa la ragione sociale e, senza nome, la P. IVA (bug 7)', () => {
      const voci = vociClassifica([
        { partitaIva: '01234567890', nome: 'Acciaierie Valdelsa S.p.A.', count: 12 },
        { partitaIva: '09876543210', nome: null, count: 3 },
        { partitaIva: '05555555555', nome: '   ', count: 1 },
      ])
      expect(voci).toEqual([
        { nome: 'Acciaierie Valdelsa S.p.A.', partitaIva: '01234567890', conteggio: 12 },
        { nome: '09876543210', partitaIva: '09876543210', conteggio: 3 },
        { nome: '05555555555', partitaIva: '05555555555', conteggio: 1 },
      ])
    })
  })
})
