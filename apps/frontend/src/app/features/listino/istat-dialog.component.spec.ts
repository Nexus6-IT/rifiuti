import { ComponentFixture, TestBed } from '@angular/core/testing'
import { provideNoopAnimations } from '@angular/platform-browser/animations'
import { Subject, of, throwError } from 'rxjs'
import { AuthService } from '../../core/services/auth.service'
import { bottone, q, scrivi, stabilizza } from '../clienti/tabelle/tabelle-test-utils'
import {
  IstatDialogComponent,
  MESSAGGIO_ISTAT_SUPERATA,
  etichettaMese,
} from './istat-dialog.component'
import { AnteprimaVariazioneContratti, EsitoVariazione, MeseIstat } from './listino.model'
import { ListinoService } from './listino.service'

const MESI: MeseIstat[] = [
  { anno: 2024, mese: 3, contratti: 4 },
  { anno: 2023, mese: 11, contratti: 2 },
  { anno: 2024, mese: 7, contratti: 1 },
]
const ANTEPRIMA: AnteprimaVariazioneContratti = {
  totale: 3,
  righe: [
    {
      id: 'r1',
      cliente: 'Verdi',
      contratto: 'CC-1',
      elenco: '001',
      voce: 'X',
      prima: '10',
      dopo: '11',
      invariata: false,
    },
  ],
  errori: [],
  impronta: 'impI',
}

describe('IstatDialogComponent', () => {
  let fixture: ComponentFixture<IstatDialogComponent>
  let mesiIstat: jasmine.Spy
  let anteprimaIstat: jasmine.Spy
  let applicaIstat: jasmine.Spy
  let visibilita: boolean[]
  let applicati: number[]

  async function apri(role = 'ADMIN') {
    TestBed.overrideProvider(AuthService, { useValue: { currentUser: () => ({ role }) } })
    fixture = TestBed.createComponent(IstatDialogComponent)
    visibilita = []
    applicati = []
    fixture.componentInstance.visibleChange.subscribe(v => visibilita.push(v))
    fixture.componentInstance.applicata.subscribe(n => applicati.push(n))
    fixture.componentRef.setInput('visible', true)
    await stabilizza(fixture)
  }
  async function compila() {
    scrivi('istat-perc-2023-11', '3,5')
    scrivi('istat-perc-2024-3', '2')
    q<HTMLInputElement>('istat-tipo-F')!.click()
    await stabilizza(fixture)
  }
  async function anteprima() {
    bottone('istat-anteprima')!.click()
    await stabilizza(fixture)
  }
  async function finoAConferma() {
    await compila()
    await anteprima()
    bottone('istat-applica')!.click()
    await stabilizza(fixture)
  }

  beforeEach(() => {
    mesiIstat = jasmine.createSpy('mesiIstat').and.returnValue(of(MESI))
    anteprimaIstat = jasmine.createSpy('anteprimaIstat').and.returnValue(of(ANTEPRIMA))
    applicaIstat = jasmine
      .createSpy('applicaIstat')
      .and.returnValue(of({ aggiornati: 3 } as EsitoVariazione))
    TestBed.configureTestingModule({
      imports: [IstatDialogComponent],
      providers: [
        provideNoopAnimations(),
        {
          provide: ListinoService,
          useValue: { variazioniContratti: { mesiIstat, anteprimaIstat, applicaIstat } },
        },
        { provide: AuthService, useValue: { currentUser: () => ({ role: 'ADMIN' }) } },
      ],
    })
  })
  afterEach(() => fixture?.destroy())

  it('etichetta del mese in italiano', () => {
    expect(etichettaMese({ anno: 2024, mese: 3, contratti: 1 })).toBe('marzo 2024')
  })

  it('griglia dei mesi con il numero dei contratti, dal più vecchio; anno precedente escluso di default', async () => {
    await apri()
    expect(mesiIstat).toHaveBeenCalledOnceWith(false)
    expect(q('istat-mesi')!.querySelector('caption')?.textContent).toContain('Percentuale ISTAT')
    expect(q('istat-mesi')!.textContent).toContain('marzo 2024')
    expect(q('istat-mesi')!.textContent).toContain('novembre 2023')
    q<HTMLInputElement>('istat-anno-precedente')!.click()
    await stabilizza(fixture)
    expect(mesiIstat).toHaveBeenCalledWith(true)
  })

  it('nessun mese: messaggio', async () => {
    mesiIstat.and.returnValue(of([]))
    await apri()
    expect(q('istat-nessun-mese')).not.toBeNull()
  })

  it('errore di caricamento dei mesi in una zona sua', async () => {
    mesiIstat.and.returnValue(throwError(() => ({ error: { message: 'Mesi KO.' } })))
    await apri()
    expect(q('istat-errore-caricamento')!.textContent).toContain('Mesi KO.')
  })

  it('senza percentuale o senza tipi l’anteprima è spenta', async () => {
    await apri()
    expect(bottone('istat-anteprima')!.disabled).toBeTrue()
    scrivi('istat-perc-2024-3', '2')
    await stabilizza(fixture)
    expect(bottone('istat-anteprima')!.disabled).toBeTrue()
    q<HTMLInputElement>('istat-tipo-F')!.click()
    await stabilizza(fixture)
    expect(bottone('istat-anteprima')!.disabled).toBeFalse()
  })

  it('virgola obbligatoria: «2.5» dà l’errore sul mese e blocca', async () => {
    await apri()
    await compila()
    scrivi('istat-perc-2024-3', '2.5')
    await stabilizza(fixture)
    expect(q('istat-errore-2024-3')!.textContent).toContain('Usa la virgola per i decimali')
    expect(bottone('istat-anteprima')!.disabled).toBeTrue()
  })

  it('il corpo ha le sole percentuali compilate, in ordine di tempo, col punto', async () => {
    await apri()
    await compila()
    await anteprima()
    expect(anteprimaIstat).toHaveBeenCalledOnceWith({
      percentuali: [
        { anno: 2023, mese: 11, percentuale: '3.5' },
        { anno: 2024, mese: 3, percentuale: '2' },
      ],
      tipi: ['F'],
    })
    expect(q('anteprima-righe')).not.toBeNull()
  })

  it('cambiare una percentuale scarta l’anteprima', async () => {
    await apri()
    await compila()
    await anteprima()
    scrivi('istat-perc-2024-3', '1,5')
    await stabilizza(fixture)
    expect(q('anteprima-righe')).toBeNull()
    expect(q('istat-applica')).toBeNull()
  })

  it('errori dell’anteprima del backend (regole sulle percentuali) mostrati com’è', async () => {
    anteprimaIstat.and.returnValue(
      throwError(() => ({
        status: 400,
        error: {
          details: {
            errori: [
              {
                campo: null,
                messaggio:
                  'Le percentuali devono essere decrescenti dai mesi più vecchi ai più recenti.',
              },
            ],
          },
        },
      }))
    )
    await apri()
    await compila()
    await anteprima()
    expect(q('istat-errore-anteprima')!.textContent).toContain('decrescenti')
  })

  it('riepilogo, conferma con impronta, esito', async () => {
    await apri()
    await finoAConferma()
    expect(q('istat-riepilogo')!.textContent).toContain('novembre 2023: 3,5 %')
    // M11: focus sul riepilogo; tabella dei mesi con la sua caption
    await new Promise(r => setTimeout(r))
    expect(document.activeElement).toBe(q('istat-riepilogo'))
    expect(applicaIstat).not.toHaveBeenCalled()
    bottone('istat-conferma-finale')!.click()
    await stabilizza(fixture)
    expect(applicaIstat).toHaveBeenCalledOnceWith({
      percentuali: [
        { anno: 2023, mese: 11, percentuale: '3.5' },
        { anno: 2024, mese: 3, percentuale: '2' },
      ],
      tipi: ['F'],
      impronta: 'impI',
    })
    expect(q('istat-esito')!.textContent).toContain('Prezzi aggiornati: 3')
    expect(applicati).toEqual([3])
  })

  it('409: "rifai l’anteprima" e anteprima scartata', async () => {
    applicaIstat.and.returnValue(throwError(() => ({ status: 409 })))
    await apri()
    await finoAConferma()
    bottone('istat-conferma-finale')!.click()
    await stabilizza(fixture)
    expect(q('istat-errore-applica')!.textContent).toContain(MESSAGGIO_ISTAT_SUPERATA)
    expect(q('istat-applica')).toBeNull()
  })

  it('durante l’applicazione né Annulla né Esc chiudono', async () => {
    const lenta = new Subject<EsitoVariazione>()
    applicaIstat.and.returnValue(lenta)
    await apri()
    await finoAConferma()
    bottone('istat-conferma-finale')!.click()
    await stabilizza(fixture)
    expect(bottone('istat-chiudi')!.disabled).toBeTrue()
    fixture.componentInstance.chiudi()
    expect(visibilita).toEqual([])
  })

  it('un OPERATOR non può calcolare l’anteprima', async () => {
    await apri('OPERATOR')
    await compila()
    expect(bottone('istat-anteprima')!.disabled).toBeTrue()
  })

  it('accanto al mese l’ultima applicazione, se c’è', async () => {
    mesiIstat.and.returnValue(
      of([{ anno: 2024, mese: 3, contratti: 4, ultimaApplicazione: '2026-04-15' }, MESI[1]])
    )
    await apri()
    expect(q('istat-applicato-2024-3')!.textContent).toContain('applicato il 15/04/2026')
    expect(q('istat-applicato-2023-11')).toBeNull()
  })

  it('avvisi e righe invariate dell’anteprima: si vedono e non bloccano Applica', async () => {
    anteprimaIstat.and.returnValue(
      of({ ...ANTEPRIMA, invariate: 2, avvisi: ['Marzo 2024: già applicato il 15/04/2026.'] })
    )
    await apri()
    await compila()
    await anteprima()
    expect(q('anteprima-avvisi')!.textContent).toContain('già applicato')
    expect(q('anteprima-invariate')!.textContent).toContain('2 righe invariate')
    expect(bottone('istat-applica')!.disabled).toBeFalse()
  })

  it('VARIAZIONE_SUPERATA scarta l’anteprima; OPERAZIONE_CONCORRENTE la mantiene', async () => {
    applicaIstat.and.returnValue(
      throwError(() => ({ status: 409, error: { error: 'VARIAZIONE_SUPERATA' } }))
    )
    await apri()
    await finoAConferma()
    bottone('istat-conferma-finale')!.click()
    await stabilizza(fixture)
    expect(q('istat-errore-applica')!.textContent).toContain('rifai l’anteprima')
    expect(q('istat-applica')).toBeNull()

    applicaIstat.and.returnValues(
      throwError(() => ({ status: 409, error: { error: 'OPERAZIONE_CONCORRENTE' } })),
      of({ aggiornati: 3 })
    )
    await anteprima()
    bottone('istat-applica')!.click()
    await stabilizza(fixture)
    bottone('istat-conferma-finale')!.click()
    await stabilizza(fixture)
    expect(q('istat-errore-applica')!.textContent).toContain('riprova')
    bottone('istat-applica')!.click()
    await stabilizza(fixture)
    bottone('istat-conferma-finale')!.click()
    await stabilizza(fixture)
    expect(applicati).toEqual([3])
  })

  it('solo righe invariate (totale 0): Applica spento e messaggio "Nessun prezzo cambia"', async () => {
    anteprimaIstat.and.returnValue(
      of({
        ...ANTEPRIMA,
        totale: 0,
        invariate: 1,
        righe: [{ ...ANTEPRIMA.righe[0], invariata: true }],
      })
    )
    await apri()
    await compila()
    await anteprima()
    expect(q('anteprima-nessun-cambio')).not.toBeNull()
    expect(bottone('istat-applica')!.disabled).toBeTrue()
  })

  it('gli avvisi si ripetono nel riepilogo della conferma (M1)', async () => {
    anteprimaIstat.and.returnValue(
      of({ ...ANTEPRIMA, avvisi: ['Marzo 2024: già applicato il 15/04/2026.'] })
    )
    await apri()
    await finoAConferma()
    expect(q('istat-riepilogo')!.textContent).toContain('Attenzione: Marzo 2024: già applicato')
  })
})
