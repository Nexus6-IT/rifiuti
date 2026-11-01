import { ComponentFixture, TestBed } from '@angular/core/testing'
import { FormControl } from '@angular/forms'
import { Subject, of, throwError } from 'rxjs'
import { ContrattoCliente } from '../clienti/clienti.model'
import { ClientiService } from '../clienti/clienti.service'
import { q, stabilizza } from '../clienti/tabelle/tabelle-test-utils'
import { ContrattoPrincipaleSelectComponent } from './contratto-principale-select.component'

const c = (id: string, numero: string, over: Partial<ContrattoCliente> = {}) =>
  ({
    id,
    numero,
    descrizione: `Contratto ${numero}`,
    stato: 'ATTIVO',
    contrattoPrincipale: null,
    allegati: 0,
    ...over,
  }) as unknown as ContrattoCliente

describe('ContrattoPrincipaleSelectComponent', () => {
  let fixture: ComponentFixture<ContrattoPrincipaleSelectComponent>
  let list: jasmine.Spy
  let controllo: FormControl<string>

  const opzioni = () =>
    Array.from(q<HTMLSelectElement>('contratto-dlg-principale')!.options).map(o => o.value)

  async function apri(over: { clienteId?: string; contrattoId?: string | null } = {}) {
    fixture = TestBed.createComponent(ContrattoPrincipaleSelectComponent)
    fixture.componentRef.setInput('controllo', controllo)
    fixture.componentRef.setInput('clienteId', over.clienteId ?? 'cl1')
    fixture.componentRef.setInput('contrattoId', over.contrattoId ?? 'ct1')
    await stabilizza(fixture)
  }

  beforeEach(() => {
    controllo = new FormControl('', { nonNullable: true })
    list = jasmine.createSpy('list').and.returnValue(
      of({
        elementi: [
          c('ct1', 'CC-1'), // sé stesso
          c('ct2', 'CC-2'),
          c('ct3', 'CC-3', { stato: 'ANNULLATO' }),
          c('ct4', 'CC-4', { contrattoPrincipale: { id: 'ct2', numero: 'CC-2' } }), // già allegato
          c('ct5', 'CC-5', { stato: 'BOZZA' }),
        ],
        totale: 5,
      })
    )
    TestBed.configureTestingModule({
      imports: [ContrattoPrincipaleSelectComponent],
      providers: [{ provide: ClientiService, useValue: { contratti: { list } } }],
    })
  })
  afterEach(() => fixture?.destroy())

  it('elenca solo i contratti ammessi: stesso cliente, non annullati, non allegati, non sé stesso', async () => {
    await apri()
    expect(list).toHaveBeenCalledWith({ clienteId: 'cl1', dimensione: 100 })
    expect(opzioni()).toEqual(['', 'ct2', 'ct5'])
  })

  it('svuotabile: la voce vuota azzera il controllo', async () => {
    controllo.setValue('ct2')
    await apri()
    const sel = q<HTMLSelectElement>('contratto-dlg-principale')!
    expect(sel.value).toBe('ct2')
    sel.value = ''
    sel.dispatchEvent(new Event('change'))
    expect(controllo.value).toBe('')
  })

  it("il principale già scelto resta fra le opzioni anche se l'elenco non lo contiene più", async () => {
    controllo.setValue('ct9')
    await apri()
    expect(opzioni()).toContain('ct9')
  })

  it('senza cliente non chiede nulla', async () => {
    await apri({ clienteId: '' })
    expect(list).not.toHaveBeenCalled()
    expect(opzioni()).toEqual([''])
  })

  it('cambiando cliente rilegge, e la risposta tardiva del precedente non conta', async () => {
    const prima = new Subject<{ elementi: ContrattoCliente[]; totale: number }>()
    list.and.returnValues(prima, of({ elementi: [c('ct7', 'CC-7')], totale: 1 }))
    await apri()
    fixture.componentRef.setInput('clienteId', 'cl2')
    await stabilizza(fixture)
    prima.next({ elementi: [c('ct8', 'CC-8')], totale: 1 })
    await stabilizza(fixture)
    expect(opzioni()).toEqual(['', 'ct7'])
  })

  it('errore di caricamento: lo comunica con il messaggio del backend', async () => {
    list.and.returnValue(throwError(() => ({ error: { message: 'Non autorizzato.' } })))
    await apri()
    expect(q('contratto-dlg-principale-errore')!.textContent).toContain('Non autorizzato.')
  })

  it('controllo disabilitato: il select è disabilitato', async () => {
    controllo.disable()
    await apri()
    expect(q<HTMLSelectElement>('contratto-dlg-principale')!.disabled).toBeTrue()
  })
})
