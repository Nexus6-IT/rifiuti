import { ComponentFixture, TestBed } from '@angular/core/testing'
import { of, throwError } from 'rxjs'
import { AnagraficaSedeComponent } from './anagrafica-sede.component'
import { DatiComunicazioniService } from './dati-comunicazioni.service'
import { AnagraficaComunicazioniRisposta } from './dati-comunicazioni.model'
import { ToastService } from '../../core/services/toast.service'

function risposta(
  over: Partial<AnagraficaComunicazioniRisposta> = {}
): AnagraficaComunicazioniRisposta {
  return {
    anagrafica: {
      sedeDittaId: 's1',
      eComune: false,
      codiceIstatComune: null,
      codiceAteco: '38.11.00',
      codiceOrso: null,
      alboDataIscrizione: null,
      alboClassi: null,
      autorizzazioneData: null,
      legaleRappresentanteCognome: null,
      legaleRappresentanteNome: null,
      esclusaOrr: false,
    },
    istat: { codice: null, motivo: 'COMUNE_NON_TROVATO' },
    puoModificare: true,
    ...over,
  }
}

describe('AnagraficaSedeComponent', () => {
  let fixture: ComponentFixture<AnagraficaSedeComponent>
  let svc: jasmine.SpyObj<DatiComunicazioniService>
  let toast: jasmine.SpyObj<ToastService>
  const q = <T extends HTMLElement>(id: string) =>
    fixture.nativeElement.querySelector(`[data-testid="${id}"]`) as T | null

  function setup(r: AnagraficaComunicazioniRisposta = risposta()): void {
    svc = jasmine.createSpyObj<DatiComunicazioniService>('DatiComunicazioniService', [
      'anagraficaSede',
      'impostaAnagraficaSede',
    ])
    svc.anagraficaSede.and.returnValue(of(r))
    svc.impostaAnagraficaSede.and.returnValue(of(r.anagrafica))
    toast = jasmine.createSpyObj<ToastService>('ToastService', ['success', 'error', 'warn'])
    TestBed.configureTestingModule({
      imports: [AnagraficaSedeComponent],
      providers: [
        { provide: DatiComunicazioniService, useValue: svc },
        { provide: ToastService, useValue: toast },
      ],
    })
    fixture = TestBed.createComponent(AnagraficaSedeComponent)
    fixture.componentRef.setInput('sedeDittaId', 's1')
    fixture.detectChanges()
  }

  it('legge i dati della sede e mostra il motivo se l’ISTAT non si risolve', async () => {
    setup()
    await fixture.whenStable()
    fixture.detectChanges()
    expect(svc.anagraficaSede).toHaveBeenCalledOnceWith('s1')
    expect((fixture.nativeElement.querySelector('#ana-ateco') as HTMLInputElement).value).toBe(
      '38.11.00'
    )
    expect(q('anagrafica-istat')?.textContent).toContain('Comune non trovato')
  })

  it('con ISTAT risolto lo mostra con la sua origine', async () => {
    setup(risposta({ istat: { codice: '063049', origine: 'DA_NOME' } }))
    await fixture.whenStable()
    fixture.detectChanges()
    expect(q('anagrafica-istat')?.textContent).toContain('063049')
    expect(q('anagrafica-istat')?.textContent).toContain('dal nome del comune')
  })

  it('salva i soli campi valorizzati (stringhe vuote = null) e dice che e fatto', async () => {
    setup()
    await fixture.whenStable()
    fixture.detectChanges()
    const c = fixture.componentInstance
    c.modulo.update(m => (m ? { ...m, codiceOrso: ' 123456 ', alboClassi: '' } : m))
    c.salva()
    expect(svc.impostaAnagraficaSede).toHaveBeenCalledWith(
      's1',
      jasmine.objectContaining({
        codiceAteco: '38.11.00',
        codiceOrso: '123456',
        alboClassi: null,
        eComune: false,
      })
    )
    expect(toast.success).toHaveBeenCalled()
  })

  it('errori del backend: elenco accanto al modulo, nessun toast di successo', async () => {
    setup()
    await fixture.whenStable()
    fixture.detectChanges()
    svc.impostaAnagraficaSede.and.returnValue(
      throwError(() => ({
        error: { details: { errori: ['codiceAteco: formato NN.NN.NN oppure 6 cifre'] } },
      }))
    )
    fixture.componentInstance.salva()
    fixture.detectChanges()
    expect(q('anagrafica-errori-campo')?.textContent).toContain('formato NN.NN.NN')
    expect(toast.success).not.toHaveBeenCalled()
  })

  it('chi non puo modificare non vede il pulsante e salva non fa nulla', async () => {
    setup(risposta({ puoModificare: false }))
    await fixture.whenStable()
    fixture.detectChanges()
    expect(q('anagrafica-salva')).toBeNull()
    fixture.componentInstance.salva()
    expect(svc.impostaAnagraficaSede).not.toHaveBeenCalled()
  })

  it('lettura fallita: messaggio di errore', async () => {
    svc = jasmine.createSpyObj<DatiComunicazioniService>('DatiComunicazioniService', [
      'anagraficaSede',
    ])
    svc.anagraficaSede.and.returnValue(throwError(() => new Error('x')))
    TestBed.configureTestingModule({
      imports: [AnagraficaSedeComponent],
      providers: [
        { provide: DatiComunicazioniService, useValue: svc },
        { provide: ToastService, useValue: jasmine.createSpyObj('ToastService', ['success']) },
      ],
    })
    fixture = TestBed.createComponent(AnagraficaSedeComponent)
    fixture.componentRef.setInput('sedeDittaId', 's1')
    fixture.detectChanges()
    expect(q('anagrafica-errore')?.textContent).toContain('Impossibile leggere')
  })
})
