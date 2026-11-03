import { ComponentFixture, TestBed } from '@angular/core/testing'
import { provideNoopAnimations } from '@angular/platform-browser/animations'
import { PeriodoFatturazione } from '../clienti/clienti.model'
import { bottone, q, scrivi, stabilizza } from '../clienti/tabelle/tabelle-test-utils'
import { PeriodiFatturazioneComponent } from './periodi-fatturazione.component'

describe('PeriodiFatturazioneComponent', () => {
  let fixture: ComponentFixture<PeriodiFatturazioneComponent>
  let emessi: PeriodoFatturazione[][]

  async function crea(periodi: PeriodoFatturazione[] = [], disabled = false) {
    fixture = TestBed.createComponent(PeriodiFatturazioneComponent)
    emessi = []
    fixture.componentInstance.periodiChange.subscribe(p => emessi.push(p))
    fixture.componentRef.setInput('periodi', periodi)
    fixture.componentRef.setInput('disabled', disabled)
    await stabilizza(fixture)
  }

  beforeEach(() =>
    TestBed.configureTestingModule({
      imports: [PeriodiFatturazioneComponent],
      providers: [provideNoopAnimations()],
    })
  )
  afterEach(() => fixture?.destroy())

  const riga = (n: number) => ({
    gi: q<HTMLInputElement>(`periodi-gi-${n}`)!,
    mi: q<HTMLInputElement>(`periodi-mi-${n}`)!,
    gf: q<HTMLInputElement>(`periodi-gf-${n}`)!,
    mf: q<HTMLInputElement>(`periodi-mf-${n}`)!,
  })

  it('Trimestrale genera i 4 periodi di D10', async () => {
    await crea()
    bottone('periodi-freq-TRIMESTRALE')!.click()
    await stabilizza(fixture)
    expect(emessi.at(-1)).toEqual([
      { giornoInizio: 1, meseInizio: 1, giornoFine: 31, meseFine: 3 },
      { giornoInizio: 1, meseInizio: 4, giornoFine: 30, meseFine: 6 },
      { giornoInizio: 1, meseInizio: 7, giornoFine: 30, meseFine: 9 },
      { giornoInizio: 1, meseInizio: 10, giornoFine: 31, meseFine: 12 },
    ])
  })

  it('Mensile genera 12 periodi con febbraio a 28 e Annuale uno solo', async () => {
    await crea()
    bottone('periodi-freq-MENSILE')!.click()
    expect(emessi.at(-1)!.length).toBe(12)
    expect(emessi.at(-1)![1]).toEqual({
      giornoInizio: 1,
      meseInizio: 2,
      giornoFine: 28,
      meseFine: 2,
    })
    bottone('periodi-freq-ANNUALE')!.click()
    expect(emessi.at(-1)).toEqual([
      { giornoInizio: 1, meseInizio: 1, giornoFine: 31, meseFine: 12 },
    ])
  })

  it("mostra una riga per periodo e una modifica emette l'elenco intero", async () => {
    await crea([{ giornoInizio: 1, meseInizio: 1, giornoFine: 30, meseFine: 6 }])
    expect(riga(0).gf.value).toBe('30')
    scrivi('periodi-gf-0', '15')
    q('periodi-gf-0')!.dispatchEvent(new Event('change'))
    expect(emessi.at(-1)).toEqual([{ giornoInizio: 1, meseInizio: 1, giornoFine: 15, meseFine: 6 }])
  })

  it('aggiungi e rimuovi riga, al massimo 12', async () => {
    await crea([{ giornoInizio: 1, meseInizio: 1, giornoFine: 31, meseFine: 12 }])
    bottone('periodi-aggiungi')!.click()
    expect(emessi.at(-1)!.length).toBe(2)
    await crea(
      Array.from({ length: 12 }, (_, i) => ({
        giornoInizio: 1,
        meseInizio: i + 1,
        giornoFine: 28,
        meseFine: i + 1,
      }))
    )
    expect(bottone('periodi-aggiungi')!.disabled).toBeTrue()
    bottone('periodi-rimuovi-0')!.click()
    expect(emessi.at(-1)!.length).toBe(11)
    expect(emessi.at(-1)![0].meseInizio).toBe(2)
  })

  it('disabled blocca tutto', async () => {
    await crea([{ giornoInizio: 1, meseInizio: 1, giornoFine: 31, meseFine: 12 }], true)
    expect(riga(0).gi.disabled).toBeTrue()
    expect(q('periodi-aggiungi')).toBeNull()
    expect(q('periodi-rimuovi-0')).toBeNull()
    expect(q('periodi-freq-MENSILE')).toBeNull()
  })

  it("un valore non numerico non entra nell'elenco come NaN", async () => {
    await crea([{ giornoInizio: 1, meseInizio: 1, giornoFine: 31, meseFine: 12 }])
    scrivi('periodi-gi-0', '')
    q('periodi-gi-0')!.dispatchEvent(new Event('change'))
    expect(emessi.at(-1)![0].giornoInizio).toBe(0)
  })

  it("«1.000» e «1a» sono errori e non entrano nell'elenco; il valore corretto toglie l'errore", async () => {
    await crea([{ giornoInizio: 1, meseInizio: 1, giornoFine: 31, meseFine: 12 }])
    scrivi('periodi-gi-0', '1.000')
    q('periodi-gi-0')!.dispatchEvent(new Event('change'))
    await stabilizza(fixture)
    expect(emessi.length).toBe(0)
    expect(q('periodi-gi-0')!.getAttribute('aria-invalid')).toBe('true')
    expect(q('periodi-errori')!.textContent).toContain('Periodo 1, giorno di inizio')
    scrivi('periodi-gi-0', '1a')
    q('periodi-gi-0')!.dispatchEvent(new Event('change'))
    expect(emessi.length).toBe(0)
    scrivi('periodi-gi-0', '15')
    q('periodi-gi-0')!.dispatchEvent(new Event('change'))
    await stabilizza(fixture)
    expect(emessi.at(-1)![0].giornoInizio).toBe(15)
    expect(q('periodi-gi-0')!.getAttribute('aria-invalid')).toBeNull()
  })
})
