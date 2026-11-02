import { ComponentFixture, TestBed } from '@angular/core/testing'
import { bottone, q, stabilizza } from '../clienti/tabelle/tabelle-test-utils'
import {
  AnteprimaContrattiComponent,
  anteprimaInCsv,
  prezzoItaliano,
} from './anteprima-contratti.component'
import { AnteprimaVariazioneContratti } from './listino.model'

const righe = (n: number) =>
  Array.from({ length: n }, (_, i) => ({
    id: `r${i}`,
    cliente: i === 0 ? null : `Cliente ${i}`,
    contratto: `CC-${i}`,
    elenco: '001',
    voce: `20 03 ${String(i).padStart(2, '0')}`,
    prima: '10',
    dopo: '10,5',
    invariata: false,
  }))
const anteprima = (
  n: number,
  over: Partial<AnteprimaVariazioneContratti> = {}
): AnteprimaVariazioneContratti => ({
  totale: n,
  righe: righe(n),
  errori: [],
  impronta: 'x',
  ...over,
})

describe('AnteprimaContrattiComponent', () => {
  let fixture: ComponentFixture<AnteprimaContrattiComponent>

  async function mostra(a: AnteprimaVariazioneContratti) {
    if (!fixture) {
      fixture = TestBed.createComponent(AnteprimaContrattiComponent)
    }
    fixture.componentRef.setInput('anteprima', a)
    await stabilizza(fixture)
  }
  beforeEach(() => {
    TestBed.configureTestingModule({ imports: [AnteprimaContrattiComponent] })
    fixture = undefined as unknown as ComponentFixture<AnteprimaContrattiComponent>
  })
  afterEach(() => fixture?.destroy())

  it('la tabella ha una caption per i lettori di schermo (M11)', async () => {
    await mostra(anteprima(3))
    expect(q('anteprima-righe')!.querySelector('caption')?.textContent?.trim()).toBe(
      'Anteprima delle righe che cambiano'
    )
  })

  it('pagina da 20 righe con precedente e successiva', async () => {
    await mostra(anteprima(45))
    expect(q('anteprima-righe')!.querySelectorAll('tbody tr').length).toBe(20)
    expect(q('anteprima-pagina')!.textContent).toContain('Pagina 1 di 3')
    expect(bottone('anteprima-precedente')!.disabled).toBeTrue()
    bottone('anteprima-successiva')!.click()
    bottone('anteprima-successiva')!.click()
    await stabilizza(fixture)
    expect(q('anteprima-righe')!.querySelectorAll('tbody tr').length).toBe(5)
    expect(bottone('anteprima-successiva')!.disabled).toBeTrue()
  })

  it('un’anteprima nuova riparte dalla prima pagina', async () => {
    await mostra(anteprima(45))
    bottone('anteprima-successiva')!.click()
    fixture.componentRef.setInput('anteprima', anteprima(30))
    await stabilizza(fixture)
    expect(q('anteprima-pagina')!.textContent).toContain('Pagina 1 di 2')
  })

  it('nessuna riga: messaggio; errori elencati con l’avviso che bloccano', async () => {
    await mostra(
      anteprima(0, {
        errori: [{ id: 'r1', voce: '20 03 01', messaggio: 'Il nuovo prezzo sarebbe negativo.' }],
      })
    )
    expect(q('anteprima-nessuna-riga')).not.toBeNull()
    expect(q('anteprima-errori')!.textContent).toContain(
      '20 03 01: Il nuovo prezzo sarebbe negativo.'
    )
    expect(q('anteprima-errori')!.textContent).toContain('non può essere applicata')
  })

  it('oltre le righe mandate dal backend dice che sono parziali', async () => {
    await mostra(anteprima(3, { totale: 500 }))
    expect(q('anteprima-parziale')!.textContent).toContain('prime 3 righe su 500')
  })

  it('"Scarica CSV" crea un file e lo fa scaricare', async () => {
    await mostra(anteprima(2))
    const crea = spyOn(URL, 'createObjectURL').and.returnValue('blob:csv')
    const revoca = spyOn(URL, 'revokeObjectURL')
    const clic = spyOn(HTMLAnchorElement.prototype, 'click')
    bottone('anteprima-csv')!.click()
    expect(crea).toHaveBeenCalledTimes(1)
    expect(clic).toHaveBeenCalled()
    await new Promise(r => setTimeout(r, 5))
    expect(revoca).toHaveBeenCalledWith('blob:csv')
  })

  it('anteprimaInCsv: BOM, separatore ";", virgolette raddoppiate, cliente vuoto', () => {
    const csv = anteprimaInCsv(
      anteprima(2, {
        righe: [
          {
            id: 'a',
            cliente: null,
            contratto: 'CC "1"',
            elenco: '001',
            voce: 'X',
            prima: '1',
            dopo: '2',
            invariata: false,
          },
          righe(2)[1],
        ],
      })
    )
    expect(csv.startsWith('﻿"Cliente";"Contratto"')).toBeTrue()
    expect(csv).toContain('"";"CC ""1""";="001";"X";1;2;"no"')
    expect(csv.split('\r\n').length).toBe(4)
  })

  it('CSV all’italiana: decimali con la virgola, nessun punto, separatore ";"', () => {
    const csv = anteprimaInCsv(
      anteprima(1, {
        righe: [
          {
            id: 'a',
            cliente: 'Verdi',
            contratto: '2026001',
            elenco: '001',
            voce: '200301',
            prima: '10.50',
            dopo: '1234.567891',
            invariata: false,
          },
        ],
      })
    )
    expect(csv).toContain('"Verdi";="2026001";="001";="200301";10,50;1234,567891;"no"')
    expect(csv.split('\r\n')[1]).not.toMatch(/\d\.\d/)
    expect(csv.split('\r\n')[1].split(';').length).toBe(7)
  })

  it('righe invariate (singolare e plurale) solo se ce ne sono', async () => {
    await mostra(anteprima(2, { invariate: 3 }))
    expect(q('anteprima-invariate')!.textContent).toContain('3 righe invariate')
    expect(q('anteprima-invariate')!.textContent).toContain('il prezzo arrotondato non cambia')
    fixture.componentRef.setInput('anteprima', anteprima(2, { invariate: 1 }))
    await stabilizza(fixture)
    expect(q('anteprima-invariate')!.textContent).toContain('1 riga invariata')
    fixture.componentRef.setInput('anteprima', anteprima(2))
    await stabilizza(fixture)
    expect(q('anteprima-invariate')).toBeNull()
  })

  it('gli avvisi si vedono e dicono che non bloccano', async () => {
    await mostra(anteprima(2, { avvisi: ['Marzo 2024: già applicato il 15/04/2026.'] }))
    expect(q('anteprima-avvisi')!.textContent).toContain('già applicato il 15/04/2026')
    expect(q('anteprima-avvisi')!.textContent).toContain('non bloccano')
  })

  const riga = (over: Partial<AnteprimaVariazioneContratti['righe'][number]> = {}) => ({
    id: 'a',
    cliente: 'Verdi',
    contratto: 'CC-1',
    elenco: '001',
    voce: 'X',
    prima: '1',
    dopo: '2',
    invariata: false,
    ...over,
  })
  const secondaRiga = (csv: string) => csv.split('\r\n')[1]

  it('CSV: formule neutralizzate con l’apostrofo (=, +, -, @, TAB, CR)', () => {
    for (const cattivo of ['=1+1', '+SOMMA(A1)', '-2+3', '@cmd', '\tx', '\rx']) {
      const csv = anteprimaInCsv(anteprima(1, { righe: [riga({ contratto: cattivo })] }))
      expect(secondaRiga(csv)).toContain(`"'${cattivo}"`)
      expect(secondaRiga(csv)).not.toContain(`"${cattivo}"`)
    }
  })

  it('CSV: le sole cifre (zeri iniziali) diventano ="001" e un testo con = resta con l’apostrofo', () => {
    const csv = anteprimaInCsv(
      anteprima(1, { righe: [riga({ contratto: '0042', elenco: '001', voce: '="001"' })] })
    )
    expect(secondaRiga(csv)).toContain('="0042";="001";"\'=""001"""')
  })

  it('CSV: prezzi delle righe speciali con la virgola, pezzo per pezzo (M2)', () => {
    const csv = anteprimaInCsv(
      anteprima(1, { righe: [riga({ prima: '10.00 / 12.50', dopo: '11.00 / 13.75' })] })
    )
    expect(secondaRiga(csv)).toContain('"10,00 / 12,50";"11,00 / 13,75"')
    expect(prezzoItaliano('10.00 / 12.50')).toBe('10,00 / 12,50')
  })

  it('CSV: colonna "Invariata" sì/no', () => {
    const csv = anteprimaInCsv(
      anteprima(2, { righe: [riga(), riga({ id: 'b', invariata: true })] })
    )
    expect(csv.split('\r\n')[0]).toContain('"Invariata"')
    expect(csv.split('\r\n')[1].endsWith('"no"')).toBeTrue()
    expect(csv.split('\r\n')[2].endsWith('"sì"')).toBeTrue()
  })

  it('righe invariate: marcate e in grigio nella tabella; la tabella usa la virgola', async () => {
    await mostra(
      anteprima(1, {
        totale: 1,
        invariate: 1,
        righe: [riga({ prima: '10.00', dopo: '10.50' }), riga({ id: 'b', invariata: true })],
      })
    )
    const righeInvariate = document.body.querySelectorAll(
      '[data-testid="anteprima-riga-invariata"]'
    )
    expect(righeInvariate.length).toBe(1)
    expect(righeInvariate[0].textContent).toContain('invariata')
    expect(q('anteprima-righe')!.textContent).toContain('10,50')
    expect(q('anteprima-righe')!.textContent).not.toContain('10.50')
  })

  it('tutte invariate: totale 0, messaggio "Nessun prezzo cambia" e non "nessun criterio"', async () => {
    await mostra(
      anteprima(0, {
        invariate: 2,
        righe: [riga({ invariata: true }), riga({ id: 'b', invariata: true })],
      })
    )
    expect(q('anteprima-nessun-cambio')!.textContent).toContain('Nessun prezzo cambia')
    expect(q('anteprima-nessuna-riga')).toBeNull()
  })

  it('parziale con invariate: il confronto è con totale + invariate', async () => {
    const tutte = Array.from({ length: 200 }, (_, i) => riga({ id: `r${i}`, invariata: i >= 150 }))
    await mostra(anteprima(0, { totale: 150, invariate: 100, righe: tutte }))
    expect(q('anteprima-parziale')!.textContent).toContain('prime 200 righe su 250')
    await mostra(anteprima(0, { totale: 150, invariate: 50, righe: tutte }))
    expect(q('anteprima-parziale')).toBeNull()
  })
})
