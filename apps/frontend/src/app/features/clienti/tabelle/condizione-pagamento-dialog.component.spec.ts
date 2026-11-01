import { ComponentFixture, TestBed } from '@angular/core/testing'
import { provideNoopAnimations } from '@angular/platform-browser/animations'
import { of, throwError } from 'rxjs'
import { CondizionePagamentoDialogComponent } from './condizione-pagamento-dialog.component'
import { TabelleFatturazioneService } from '../tabelle-fatturazione.service'
import { CondizionePagamento } from '../clienti.model'
import { bottone, q, scrivi, stabilizza, tabellaFinta } from './tabelle-test-utils'

describe('CondizionePagamentoDialogComponent', () => {
  let tabella: ReturnType<typeof tabellaFinta>
  let fixture: ComponentFixture<CondizionePagamentoDialogComponent>

  async function apri(elemento: CondizionePagamento | null = null) {
    fixture = TestBed.createComponent(CondizionePagamentoDialogComponent)
    fixture.componentRef.setInput('elemento', elemento)
    fixture.componentRef.setInput('visible', true)
    await stabilizza(fixture)
  }

  beforeEach(() => {
    tabella = tabellaFinta()
    TestBed.configureTestingModule({
      imports: [CondizionePagamentoDialogComponent],
      providers: [
        provideNoopAnimations(),
        { provide: TabelleFatturazioneService, useValue: { condizioni: tabella } },
      ],
    })
  })
  afterEach(() => fixture?.destroy())

  it('nuova: campi vuoti', async () => {
    await apri()
    expect(q<HTMLInputElement>('cond-dlg-codice')!.value).toBe('')
    expect(q<HTMLInputElement>('cond-dlg-descrizione')!.value).toBe('')
  })

  it('salva manda giorniRate come numeri', async () => {
    tabella.crea.and.returnValue(of({ id: 'x' }))
    await apri()
    scrivi('cond-dlg-codice', '30')
    scrivi('cond-dlg-descrizione', 'Sessanta e trenta')
    scrivi('cond-dlg-giorno', '60')
    bottone('cond-dlg-aggiungi-giorno')!.click()
    await stabilizza(fixture)
    scrivi('cond-dlg-giorno', '30')
    bottone('cond-dlg-aggiungi-giorno')!.click()
    await stabilizza(fixture)
    await stabilizza(fixture)
    bottone('cond-dlg-salva')!.click()
    await stabilizza(fixture)
    expect(tabella.crea).toHaveBeenCalledWith({
      codice: '30',
      descrizione: 'Sessanta e trenta',
      modalita: 'MP05',
      giorniRate: [60, 30],
      fineMese: false,
    })
  })

  it('senza rate manda [0] (a vista)', async () => {
    tabella.crea.and.returnValue(of({ id: 'x' }))
    await apri()
    scrivi('cond-dlg-codice', 'RD')
    scrivi('cond-dlg-descrizione', 'Rimessa diretta')
    await stabilizza(fixture)
    bottone('cond-dlg-salva')!.click()
    await stabilizza(fixture)
    expect(tabella.crea.calls.mostRecent().args[0].giorniRate).toEqual([0])
  })

  it('mostra il messaggio 400 del backend nel dialog', async () => {
    tabella.crea.and.returnValue(
      throwError(() => ({ error: { message: ['I giorni delle rate vanno in ordine crescente.'] } }))
    )
    await apri()
    scrivi('cond-dlg-codice', '30')
    scrivi('cond-dlg-descrizione', 'X')
    await stabilizza(fixture)
    bottone('cond-dlg-salva')!.click()
    await stabilizza(fixture)
    expect(q('cond-dlg-errore')!.textContent).toContain('ordine crescente')
  })
})
