import { ComponentFixture, TestBed } from '@angular/core/testing'
import { provideNoopAnimations } from '@angular/platform-browser/animations'
import { of, throwError } from 'rxjs'
import { AuthService } from '../../../core/services/auth.service'
import { ToastService } from '../../../core/services/toast.service'
import {
  accettaConferma,
  bottone,
  q,
  scrivi,
  stabilizza,
} from '../../clienti/tabelle/tabelle-test-utils'
import { ModelloStampaVista } from './modello-stampa.model'
import { ModelliStampaComponent } from './modelli-stampa.component'
import { ModelliStampaService } from './modelli-stampa.service'

const fir: ModelloStampaVista = {
  id: 'm1',
  nome: 'FIR standard',
  ambito: 'FIR',
  copie: 2,
  testoIntestazione: 'Ditta Rossi',
  testoPiePagina: null,
  colorePrimario: '#112233',
  coloreSecondario: '#445566',
  logoBase64: null,
  predefinito: true,
  versione: 1,
}
const distinta: ModelloStampaVista = {
  ...fir,
  id: 'm2',
  nome: 'Distinta',
  ambito: 'DISTINTA_RITIRI',
  copie: 1,
  predefinito: false,
}

describe('ModelliStampaComponent', () => {
  let servizio: jasmine.SpyObj<ModelliStampaService>
  let toast: jasmine.SpyObj<ToastService>
  let fixture: ComponentFixture<ModelliStampaComponent>

  async function apri(role = 'ADMIN') {
    TestBed.overrideProvider(AuthService, { useValue: { currentUser: () => ({ role }) } })
    fixture = TestBed.createComponent(ModelliStampaComponent)
    await stabilizza(fixture)
  }

  beforeEach(() => {
    servizio = jasmine.createSpyObj('ModelliStampaService', [
      'elenco',
      'crea',
      'modifica',
      'rendiPredefinito',
      'elimina',
    ])
    servizio.elenco.and.returnValue(of([fir, distinta]))
    toast = jasmine.createSpyObj('ToastService', ['error', 'success'])
    TestBed.configureTestingModule({
      imports: [ModelliStampaComponent],
      providers: [
        provideNoopAnimations(),
        { provide: ModelliStampaService, useValue: servizio },
        { provide: ToastService, useValue: toast },
        { provide: AuthService, useValue: { currentUser: () => ({ role: 'ADMIN' }) } },
      ],
    })
  })
  afterEach(() => fixture?.destroy())

  it('mostra ambito etichettato in italiano e il badge Predefinito', async () => {
    await apri()
    expect(q('modello-riga-m1')!.textContent).toContain('FIR')
    expect(q('modello-riga-m1')!.textContent).toContain('Predefinito')
    expect(q('modello-riga-m2')!.textContent).toContain('Distinta dei ritiri')
    expect(q('modello-riga-m2')!.querySelector('.badge-predefinito')).toBeNull()
  })

  it('nessun modello: messaggio vuoto', async () => {
    servizio.elenco.and.returnValue(of([]))
    await apri()
    expect(q('modelli-vuoto')).not.toBeNull()
  })

  it('un solo pulsante primario (Nuovo modello)', async () => {
    await apri()
    expect(document.body.querySelectorAll('.wf-primario').length).toBe(1)
  })

  it('non admin: nessuna chiamata, nessun pulsante, messaggio', async () => {
    await apri('OPERATOR')
    expect(servizio.elenco).not.toHaveBeenCalled()
    expect(q('modello-nuovo')).toBeNull()
    expect(q('modelli-solo-admin')).not.toBeNull()
  })

  it('errore di caricamento: avviso con role=alert', async () => {
    servizio.elenco.and.returnValue(throwError(() => ({ error: { message: 'Boom' } })))
    await apri()
    expect(q('modelli-errore')!.textContent).toContain('Boom')
  })

  it('Rendi predefinito: chiama il servizio con la versione e ricarica', async () => {
    servizio.rendiPredefinito.and.returnValue(of({ ...distinta, predefinito: true }))
    await apri()
    fixture.componentInstance.rendiPredefinito(distinta)
    expect(servizio.rendiPredefinito).toHaveBeenCalledWith('m2', 1)
    expect(servizio.elenco).toHaveBeenCalledTimes(2)
  })

  it('il predefinito attuale non offre «Rendi predefinito»', async () => {
    await apri()
    expect(fixture.componentInstance.azioni.di(fir).altre.map(a => a.etichetta)).toEqual([
      'Elimina',
    ])
    expect(fixture.componentInstance.azioni.di(distinta).altre.map(a => a.etichetta)).toEqual([
      'Rendi predefinito',
      'Elimina',
    ])
  })

  it('Elimina chiede conferma e, accettata, cancella con la versione', async () => {
    servizio.elimina.and.returnValue(of(undefined))
    await apri()
    fixture.componentInstance.elimina(distinta)
    await stabilizza(fixture)
    expect(servizio.elimina).not.toHaveBeenCalled()
    accettaConferma()
    expect(servizio.elimina).toHaveBeenCalledWith('m2', 1)
  })

  it('conflitto su Elimina: toast col messaggio del server e ricarica', async () => {
    servizio.elimina.and.returnValue(
      throwError(() => ({ error: { message: 'Modello modificato da un altro utente.' } }))
    )
    await apri()
    fixture.componentInstance.elimina(distinta)
    await stabilizza(fixture)
    accettaConferma()
    expect(toast.error).toHaveBeenCalledWith('Modello modificato da un altro utente.')
    expect(servizio.elenco).toHaveBeenCalledTimes(2)
  })

  it('crea dal dialog: manda i dati scritti e ricarica', async () => {
    servizio.crea.and.returnValue(of(fir))
    await apri()
    fixture.componentInstance.apri(null)
    await stabilizza(fixture)
    scrivi('modello-dlg-nome', '  Nuovo  ')
    scrivi('modello-dlg-copie', '3')
    await stabilizza(fixture)
    bottone('modello-dlg-salva')!.click()
    await stabilizza(fixture)
    expect(servizio.crea).toHaveBeenCalledWith(
      jasmine.objectContaining({ nome: 'Nuovo', copie: 3, ambito: 'GENERALE', logoBase64: null })
    )
    expect(servizio.elenco).toHaveBeenCalledTimes(2)
  })

  it('copie fuori da 1-4: Salva disabilitato', async () => {
    await apri()
    fixture.componentInstance.apri(null)
    await stabilizza(fixture)
    scrivi('modello-dlg-nome', 'X')
    scrivi('modello-dlg-copie', '5')
    await stabilizza(fixture)
    expect(bottone('modello-dlg-salva')!.disabled).toBeTrue()
    scrivi('modello-dlg-copie', '4')
    await stabilizza(fixture)
    expect(bottone('modello-dlg-salva')!.disabled).toBeFalse()
  })

  it("modifica: manda la versione letta e l'anteprima mostra l'intestazione", async () => {
    servizio.modifica.and.returnValue(of(fir))
    await apri()
    fixture.componentInstance.apri(fir)
    await stabilizza(fixture)
    expect(q('modello-dlg-anteprima-testa')!.textContent).toContain('Ditta Rossi')
    bottone('modello-dlg-salva')!.click()
    await stabilizza(fixture)
    expect(servizio.modifica).toHaveBeenCalledWith('m1', jasmine.any(Object), 1)
  })

  it('errore di salvataggio: messaggio nel dialog che resta aperto', async () => {
    servizio.crea.and.returnValue(throwError(() => ({ error: { message: 'Nome già usato.' } })))
    await apri()
    fixture.componentInstance.apri(null)
    await stabilizza(fixture)
    scrivi('modello-dlg-nome', 'X')
    await stabilizza(fixture)
    bottone('modello-dlg-salva')!.click()
    await stabilizza(fixture)
    expect(q('modello-dlg-errore')!.textContent).toContain('Nome già usato.')
  })
})
