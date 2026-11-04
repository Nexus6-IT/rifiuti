import { ComponentFixture, TestBed } from '@angular/core/testing'
import { provideNoopAnimations } from '@angular/platform-browser/animations'
import { bottone, q, stabilizza } from '../clienti/tabelle/tabelle-test-utils'
import { RigaLegame } from './legami.model'
import { RigheLegameTabellaComponent } from './righe-legame-tabella.component'

function riga(id: string): RigaLegame {
  return {
    id: `r-${id}`,
    rigaAddebitoId: id,
    ordine: 1,
    origine: 'PRINCIPALE',
    tipo: 'RITIRO',
    descrizione: `Ritiro ${id}`,
    tipoQuantita: 'PESO',
    unitaMisura: 'kg',
    quantita: '10',
    quantitaOrigine: 'DA_MOVIMENTO',
    prezzoSpeciale: false,
    prezzo: '12.5',
    sconto: null,
    prezzoManuale: false,
    aliquotaIva: '22',
    naturaIva: null,
    congelataIl: null,
    importo: '125.00',
  }
}

describe('RigheLegameTabellaComponent: rimozione per riga', () => {
  let fixture: ComponentFixture<RigheLegameTabellaComponent>
  let stato: boolean[]

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [RigheLegameTabellaComponent],
      providers: [provideNoopAnimations()],
    }).compileComponents()
    fixture = TestBed.createComponent(RigheLegameTabellaComponent)
    stato = []
    fixture.componentInstance.erroriChange.subscribe(v => stato.push(v))
    fixture.componentRef.setInput('righe', [riga('a'), riga('b')])
  })

  afterEach(() => fixture.destroy())

  it('senza `rimovibile` non c’è nessuna colonna di azioni', async () => {
    await stabilizza(fixture)
    expect(q('rimuovi-a')).toBeNull()
  })

  it('con `rimovibile`: «Rimuovi» emette l’id; la riga rimossa dice «da rimuovere» e offre «Ripristina»', async () => {
    fixture.componentRef.setInput('rimovibile', true)
    await stabilizza(fixture)
    const emessi: string[] = []
    fixture.componentInstance.rimuovi.subscribe(id => emessi.push(id))
    expect(bottone('rimuovi-a')!.textContent).toContain('Rimuovi')
    bottone('rimuovi-a')!.click()
    expect(emessi).toEqual(['a'])
    fixture.componentRef.setInput('rimosse', new Set(['a']))
    await stabilizza(fixture)
    expect(q('rimossa-a')).not.toBeNull()
    expect(q('rimossa-b')).toBeNull()
    expect(bottone('rimuovi-a')!.textContent).toContain('Ripristina')
  })

  it('l’errore di una riga rimossa non conta in `erroriChange`, tornando attivo se la si ripristina', async () => {
    fixture.componentRef.setInput('rimovibile', true)
    await stabilizza(fixture)
    fixture.componentInstance.alCambio(riga('a'), 'quantita', 0)
    await stabilizza(fixture)
    expect(stato).toEqual([true])
    fixture.componentRef.setInput('rimosse', new Set(['a']))
    await stabilizza(fixture)
    expect(stato).toEqual([true, false])
    fixture.componentRef.setInput('rimosse', new Set())
    await stabilizza(fixture)
    expect(stato).toEqual([true, false, true])
  })
})
