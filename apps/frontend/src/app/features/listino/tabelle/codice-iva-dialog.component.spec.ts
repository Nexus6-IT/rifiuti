import { ComponentFixture, TestBed } from '@angular/core/testing'
import { provideNoopAnimations } from '@angular/platform-browser/animations'
import { of } from 'rxjs'
import { CodiceIvaDialogComponent } from './codice-iva-dialog.component'
import { ListinoService } from '../listino.service'
import { CodiceIva } from '../listino.model'
import { stabilizza, tabellaFinta } from '../../clienti/tabelle/tabelle-test-utils'

const iva: CodiceIva = {
  id: 'i1',
  versione: 2,
  eliminabile: true,
  codice: 'N61',
  descrizione: 'Inversione',
  aliquota: '0.00',
  natura: 'N6.1',
  attivo: true,
}

describe('CodiceIvaDialogComponent', () => {
  let tabella: ReturnType<typeof tabellaFinta>
  let fixture: ComponentFixture<CodiceIvaDialogComponent>

  beforeEach(() => {
    tabella = tabellaFinta()
    tabella.modifica.and.returnValue(of(iva))
    TestBed.configureTestingModule({
      imports: [CodiceIvaDialogComponent],
      providers: [
        provideNoopAnimations(),
        { provide: ListinoService, useValue: { codiciIva: tabella } },
      ],
    })
    fixture = TestBed.createComponent(CodiceIvaDialogComponent)
    fixture.componentRef.setInput('elemento', iva)
    fixture.componentRef.setInput('visible', true)
  })
  afterEach(() => fixture?.destroy())

  it("in modifica precompila il form dall'elemento", async () => {
    await stabilizza(fixture)
    expect(fixture.componentInstance.form.getRawValue()).toEqual({
      codice: 'N61',
      descrizione: 'Inversione',
      aliquota: '0.00',
      natura: 'N6.1',
    })
  })

  it('alla chiusura il form si svuota e il dialog chiede di nascondersi', async () => {
    await stabilizza(fixture)
    let chiuso = false
    fixture.componentInstance.visibleChange.subscribe(v => (chiuso = v === false))
    fixture.componentInstance.chiudi()
    expect(fixture.componentInstance.form.controls.aliquota.value).toBe('')
    expect(chiuso).toBeTrue()
  })

  it('riaprendo dopo una chiusura il form riparte pulito da un altro elemento', async () => {
    await stabilizza(fixture)
    fixture.componentInstance.chiudi()
    fixture.componentRef.setInput('visible', false)
    await stabilizza(fixture)
    fixture.componentRef.setInput('elemento', null)
    fixture.componentRef.setInput('visible', true)
    await stabilizza(fixture)
    expect(fixture.componentInstance.form.controls.codice.value).toBe('')
    expect(fixture.componentInstance.errore()).toBeNull()
  })
})
