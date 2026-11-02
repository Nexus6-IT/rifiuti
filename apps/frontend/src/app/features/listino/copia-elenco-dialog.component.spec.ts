import { Component, EventEmitter, Input, Output } from '@angular/core'
import { ComponentFixture, TestBed } from '@angular/core/testing'
import { provideNoopAnimations } from '@angular/platform-browser/animations'
import { Subject, of, throwError } from 'rxjs'
import { bottone, q, stabilizza } from '../clienti/tabelle/tabelle-test-utils'
import { CopiaElencoDialogComponent, righeEscluse } from './copia-elenco-dialog.component'
import { ElencoAddebiti, EsitoCopia } from './listino.model'
import { ListinoService } from './listino.service'
import { SceltaElencoOrigineComponent } from './scelta-elenco-origine.component'

@Component({ selector: 'app-scelta-elenco-origine', standalone: true, template: '' })
class SceltaFinta {
  @Input() prefisso = ''
  @Input() escludiElencoId: string | null = null
  @Input() azzera = 0
  @Output() scelto = new EventEmitter<ElencoAddebiti | null>()
}

const arrivo = { id: 'e1', codice: '001', righe: 3, versione: 7 } as ElencoAddebiti
const origine = { id: 'e9', codice: '009', righe: 12, versione: 1 } as ElencoAddebiti
const ESITO: EsitoCopia = {
  copiate: 10,
  escluse: { minimi: 1, acconti: 0, conguagli: 1, duplicate: 0, condizioni: 2 },
}

describe('CopiaElencoDialogComponent', () => {
  let fixture: ComponentFixture<CopiaElencoDialogComponent>
  let sostituisciDa: jasmine.Spy
  let eventi: string[]

  async function apri() {
    fixture = TestBed.createComponent(CopiaElencoDialogComponent)
    eventi = []
    fixture.componentInstance.copiato.subscribe(() => eventi.push('copiato'))
    fixture.componentInstance.ricarica.subscribe(() => eventi.push('ricarica'))
    fixture.componentInstance.visibleChange.subscribe(v => eventi.push(`visibile:${v}`))
    fixture.componentRef.setInput('elenco', arrivo)
    fixture.componentRef.setInput('visible', true)
    await stabilizza(fixture)
  }
  const scegliOrigine = async () => {
    fixture.debugElement
      .query(x => x.componentInstance instanceof SceltaFinta)
      .componentInstance.scelto.emit(origine)
    await stabilizza(fixture)
  }

  beforeEach(() => {
    sostituisciDa = jasmine.createSpy('sostituisciDa').and.returnValue(of(ESITO))
    TestBed.configureTestingModule({
      imports: [CopiaElencoDialogComponent],
      providers: [
        provideNoopAnimations(),
        { provide: ListinoService, useValue: { azioni: { sostituisciDa } } },
      ],
    })
    TestBed.overrideComponent(CopiaElencoDialogComponent, {
      remove: { imports: [SceltaElencoOrigineComponent] },
      add: { imports: [SceltaFinta] },
    })
  })
  afterEach(() => fixture?.destroy())

  it('"Avanti" resta spento finché non si sceglie l’origine', async () => {
    await apri()
    expect(bottone('copia-avanti')!.disabled).toBeTrue()
    await scegliOrigine()
    expect(bottone('copia-avanti')!.disabled).toBeFalse()
  })

  it('la conferma dice che le righe sono sostituite; solo lì si copia, con la versione dell’elenco', async () => {
    await apri()
    await scegliOrigine()
    bottone('copia-avanti')!.click()
    await stabilizza(fixture)
    expect(q('copia-conferma')!.textContent).toContain('sostituite')
    expect(sostituisciDa).not.toHaveBeenCalled()
    bottone('copia-conferma-finale')!.click()
    await stabilizza(fixture)
    expect(sostituisciDa).toHaveBeenCalledOnceWith('e1', 'e9', 7)
    expect(eventi).toContain('copiato')
  })

  it('esito coi conteggi: copiate e non copiate', async () => {
    await apri()
    await scegliOrigine()
    bottone('copia-avanti')!.click()
    await stabilizza(fixture)
    bottone('copia-conferma-finale')!.click()
    await stabilizza(fixture)
    expect(q('copia-esito')!.textContent).toContain('Righe copiate: 10')
    expect(q('copia-escluse')!.textContent).toContain(
      '1 minimi, 1 conguagli, 2 per le regole di condizione'
    )
  })

  it('righeEscluse: solo le voci diverse da zero', () => {
    expect(
      righeEscluse({ minimi: 0, acconti: 2, conguagli: 0, duplicate: 3, condizioni: 0 })
    ).toEqual(['2 acconti', '3 già presenti'])
  })

  it('400: i messaggi del backend, uno per riga, senza "Ricarica"', async () => {
    sostituisciDa.and.returnValue(
      throwError(() => ({
        status: 400,
        error: {
          details: { errori: [{ campo: null, messaggio: 'Un elenco non si copia su sé stesso.' }] },
        },
      }))
    )
    await apri()
    await scegliOrigine()
    bottone('copia-avanti')!.click()
    await stabilizza(fixture)
    bottone('copia-conferma-finale')!.click()
    await stabilizza(fixture)
    expect(q('copia-errore')!.textContent).toContain('Un elenco non si copia su sé stesso.')
    expect(q('copia-ricarica')).toBeNull()
  })

  it('409: messaggio con "Ricarica" che avvisa la pagina', async () => {
    sostituisciDa.and.returnValue(
      throwError(() => ({ status: 409, error: { message: 'Elenco modificato nel frattempo.' } }))
    )
    await apri()
    await scegliOrigine()
    bottone('copia-avanti')!.click()
    await stabilizza(fixture)
    bottone('copia-conferma-finale')!.click()
    await stabilizza(fixture)
    expect(q('copia-errore')!.textContent).toContain('Elenco modificato nel frattempo.')
    bottone('copia-ricarica')!.click()
    expect(eventi).toContain('ricarica')
  })

  it('durante la copia né Annulla né Esc chiudono; una seconda conferma non parte', async () => {
    const lenta = new Subject<EsitoCopia>()
    sostituisciDa.and.returnValue(lenta)
    await apri()
    await scegliOrigine()
    bottone('copia-avanti')!.click()
    await stabilizza(fixture)
    bottone('copia-conferma-finale')!.click()
    await stabilizza(fixture)
    expect(bottone('copia-chiudi')!.disabled).toBeTrue()
    fixture.componentInstance.chiudi()
    fixture.componentInstance.copia()
    expect(eventi.filter(e => e.startsWith('visibile'))).toEqual([])
    expect(sostituisciDa).toHaveBeenCalledTimes(1)
    lenta.next(ESITO)
    await stabilizza(fixture)
    fixture.componentInstance.chiudi()
    expect(eventi).toContain('visibile:false')
  })

  it('riaprendo, la scelta e gli errori ripartono da zero', async () => {
    sostituisciDa.and.returnValue(throwError(() => ({ status: 400, error: { message: 'KO' } })))
    await apri()
    await scegliOrigine()
    bottone('copia-avanti')!.click()
    await stabilizza(fixture)
    bottone('copia-conferma-finale')!.click()
    await stabilizza(fixture)
    fixture.componentRef.setInput('visible', false)
    await stabilizza(fixture)
    fixture.componentRef.setInput('visible', true)
    await stabilizza(fixture)
    expect(q('copia-errore')).toBeNull()
    expect(fixture.componentInstance.origine()).toBeNull()
  })
})
