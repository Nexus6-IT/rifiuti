import { ComponentFixture, TestBed } from '@angular/core/testing'
import { provideNoopAnimations } from '@angular/platform-browser/animations'
import { of, throwError } from 'rxjs'
import { ToastService } from '../../core/services/toast.service'
import { Cliente, CodificaContratto } from '../clienti/clienti.model'
import { ClientiService } from '../clienti/clienti.service'
import { TabelleFatturazioneService } from '../clienti/tabelle-fatturazione.service'
import { bottone, q, scrivi, stabilizza } from '../clienti/tabelle/tabelle-test-utils'
import { ProrogaDialogComponent } from './proroga-dialog.component'

const categoria: CodificaContratto = {
  id: 'cat1',
  versione: 1,
  eliminabile: true,
  genere: 'CATEGORIA',
  codice: '001',
  descrizione: 'Smaltimento',
  attiva: true,
}

describe('ProrogaDialogComponent', () => {
  let fixture: ComponentFixture<ProrogaDialogComponent>
  let proroga: jasmine.Spy
  let listCodifiche: jasmine.Spy
  let toast: jasmine.SpyObj<ToastService>
  let prorogati: number[]
  let visibilita: boolean[]

  async function apri() {
    fixture = TestBed.createComponent(ProrogaDialogComponent)
    fixture.componentRef.setInput('visible', true)
    prorogati = []
    visibilita = []
    fixture.componentInstance.prorogato.subscribe(n => prorogati.push(n))
    fixture.componentInstance.visibleChange.subscribe(v => visibilita.push(v))
    await stabilizza(fixture)
  }

  beforeEach(() => {
    proroga = jasmine.createSpy('proroga').and.returnValue(of({ prorogati: 3 }))
    listCodifiche = jasmine.createSpy('list').and.returnValue(of([categoria]))
    toast = jasmine.createSpyObj('ToastService', ['error', 'success'])
    TestBed.configureTestingModule({
      imports: [ProrogaDialogComponent],
      providers: [
        provideNoopAnimations(),
        {
          provide: ClientiService,
          useValue: {
            contratti: { proroga },
            clienti: { list: () => of({ elementi: [], totale: 0 }) },
          },
        },
        { provide: TabelleFatturazioneService, useValue: { codifiche: { list: listCodifiche } } },
        { provide: ToastService, useValue: toast },
      ],
    })
  })
  afterEach(() => fixture?.destroy())

  it('valori di partenza: "solo con rinnovo automatico" spuntato, "anche sospesi" no', async () => {
    await apri()
    const v = fixture.componentInstance.form.getRawValue()
    expect(v.soloRinnovoAutomatico).toBeTrue()
    expect(v.ancheSospesi).toBeFalse()
    expect(q('proroga-solo-rinnovo-automatico')).toBeTruthy()
    expect(q('proroga-anche-sospesi')).toBeTruthy()
  })

  it('legge le categorie attive per il filtro facoltativo', async () => {
    await apri()
    expect(listCodifiche).toHaveBeenCalledOnceWith('CATEGORIA')
    expect(fixture.componentInstance.categorie().map(c => c.etichetta)).toEqual(['Smaltimento'])
  })

  it('senza data la conferma è disabilitata', async () => {
    await apri()
    expect(bottone('proroga-conferma')!.disabled).toBeTrue()
    scrivi('proroga-data', '2026-12-31')
    await stabilizza(fixture)
    expect(bottone('proroga-conferma')!.disabled).toBeFalse()
  })

  it('conferma: manda data e i due flag; cliente e categoria assenti se non scelti', async () => {
    await apri()
    scrivi('proroga-data', '2026-12-31')
    await stabilizza(fixture)
    bottone('proroga-conferma')!.click()
    await stabilizza(fixture)
    bottone('proroga-conferma-finale')!.click()
    expect(proroga).toHaveBeenCalledOnceWith({
      scadutiEntro: '2026-12-31',
      soloRinnovoAutomatico: true,
      ancheSospesi: false,
    })
  })

  it('prima dell’invio chiede conferma con il riepilogo dei filtri; Indietro non invia nulla', async () => {
    await apri()
    scrivi('proroga-data', '2026-06-30')
    fixture.componentInstance.clienteScelto({
      id: 'cl1',
      ditta: { ragioneSociale: 'Rossi SRL' },
    } as Cliente)
    fixture.componentInstance.form.patchValue({ categoriaId: 'cat1', ancheSospesi: true })
    await stabilizza(fixture)
    bottone('proroga-conferma')!.click()
    await stabilizza(fixture)
    expect(proroga).not.toHaveBeenCalled()
    const testo = q('proroga-riepilogo')!.textContent!
    expect(testo).toContain('30/06/2026')
    expect(testo).toContain('Categoria: Smaltimento')
    expect(testo).toContain('Cliente: Rossi SRL')
    expect(testo).toContain('Solo contratti con rinnovo automatico')
    expect(testo).toContain('Compresi i contratti sospesi')
    bottone('proroga-indietro')!.click()
    await stabilizza(fixture)
    expect(q('proroga-riepilogo')).toBeNull()
    expect(proroga).not.toHaveBeenCalled()
  })

  it('con cliente, categoria e flag cambiati', async () => {
    await apri()
    scrivi('proroga-data', '2026-06-30')
    fixture.componentInstance.clienteScelto({ id: 'cl1' } as Cliente)
    fixture.componentInstance.form.patchValue({
      categoriaId: 'cat1',
      soloRinnovoAutomatico: false,
      ancheSospesi: true,
    })
    await stabilizza(fixture)
    bottone('proroga-conferma')!.click()
    await stabilizza(fixture)
    bottone('proroga-conferma-finale')!.click()
    expect(proroga).toHaveBeenCalledOnceWith({
      scadutiEntro: '2026-06-30',
      soloRinnovoAutomatico: false,
      ancheSospesi: true,
      clienteId: 'cl1',
      categoriaId: 'cat1',
    })
  })

  it('al termine: toast "Contratti prorogati: N", evento con N e dialog chiuso', async () => {
    await apri()
    scrivi('proroga-data', '2026-12-31')
    await stabilizza(fixture)
    bottone('proroga-conferma')!.click()
    await stabilizza(fixture)
    bottone('proroga-conferma-finale')!.click()
    expect(toast.success).toHaveBeenCalledWith('Contratti prorogati: 3')
    expect(prorogati).toEqual([3])
    expect(visibilita).toEqual([false])
  })

  it('zero contratti: lo dice comunque', async () => {
    proroga.and.returnValue(of({ prorogati: 0 }))
    await apri()
    scrivi('proroga-data', '2026-12-31')
    await stabilizza(fixture)
    bottone('proroga-conferma')!.click()
    await stabilizza(fixture)
    bottone('proroga-conferma-finale')!.click()
    expect(toast.success).toHaveBeenCalledWith('Contratti prorogati: 0')
  })

  it('errore: messaggio nel dialog, che resta aperto, nessun evento', async () => {
    proroga.and.returnValue(throwError(() => ({ error: { message: ['La data non è valida.'] } })))
    await apri()
    scrivi('proroga-data', '2026-12-31')
    await stabilizza(fixture)
    bottone('proroga-conferma')!.click()
    await stabilizza(fixture)
    bottone('proroga-conferma-finale')!.click()
    await stabilizza(fixture)
    expect(q('proroga-errore')!.textContent).toContain('La data non è valida.')
    expect(prorogati).toEqual([])
    expect(visibilita).toEqual([])
    expect(bottone('proroga-conferma')!.disabled).toBeFalse()
  })

  it('riaperto, riparte pulito', async () => {
    await apri()
    scrivi('proroga-data', '2026-12-31')
    fixture.componentInstance.form.patchValue({ ancheSospesi: true })
    fixture.componentRef.setInput('visible', false)
    await stabilizza(fixture)
    fixture.componentRef.setInput('visible', true)
    await stabilizza(fixture)
    const v = fixture.componentInstance.form.getRawValue()
    expect(v.scadutiEntro).toBe('')
    expect(v.ancheSospesi).toBeFalse()
    expect(v.soloRinnovoAutomatico).toBeTrue()
  })
})
