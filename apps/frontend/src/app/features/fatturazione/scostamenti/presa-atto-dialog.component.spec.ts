import { ComponentFixture, TestBed } from '@angular/core/testing'
import { provideNoopAnimations } from '@angular/platform-browser/animations'
import { HttpErrorResponse } from '@angular/common/http'
import { Subject, of, throwError } from 'rxjs'
import { ScostamentoRiga } from '../fatturazione.model'
import { FatturazioneService } from '../fatturazione.service'
import { PresaAttoDialogComponent } from './presa-atto-dialog.component'

const scostamento: ScostamentoRiga = {
  legameId: 'lg-1',
  versioneLegame: 4,
  documento: { id: 'd-1', numeroTesto: '12/2026', dataDocumento: '2026-10-31' },
  tipoCorrezione: 'RETTIFICA',
  quantitaFatturata: '10',
  unitaFatturata: 'KG',
  unitaAttuale: 'KG',
  importoFatturato: '100.00',
  quantitaAttuale: '8',
  importoAttuale: '80.00',
  soloQuantita: false,
}

const q = <T extends HTMLElement = HTMLElement>(id: string): T | null =>
  document.body.querySelector<T>(`[data-testid="${id}"]`)

describe('PresaAttoDialogComponent', () => {
  let fixture: ComponentFixture<PresaAttoDialogComponent>
  let servizio: jasmine.SpyObj<FatturazioneService>
  let registrati: number
  let chiusi: number

  async function crea(): Promise<void> {
    servizio = jasmine.createSpyObj('FatturazioneService', ['presaAtto'])
    servizio.presaAtto.and.returnValue(of(undefined))
    await TestBed.configureTestingModule({
      imports: [PresaAttoDialogComponent],
      providers: [provideNoopAnimations(), { provide: FatturazioneService, useValue: servizio }],
    }).compileComponents()
    fixture = TestBed.createComponent(PresaAttoDialogComponent)
    registrati = 0
    chiusi = 0
    fixture.componentInstance.registrata.subscribe(() => registrati++)
    fixture.componentInstance.chiuso.subscribe(() => chiusi++)
    fixture.componentRef.setInput('scostamento', scostamento)
    fixture.componentRef.setInput('visible', true)
    fixture.detectChanges()
    await fixture.whenStable()
    fixture.detectChanges()
  }

  function scrivi(testo: string): void {
    const area = q<HTMLTextAreaElement>('presa-atto-nota')!
    area.value = testo
    area.dispatchEvent(new Event('input'))
    fixture.detectChanges()
  }

  afterEach(() => fixture?.destroy())

  it('l’etichetta del campo dice che la nota è obbligatoria', async () => {
    await crea()
    expect(document.querySelector('label[for="presa-atto-nota"]')?.textContent).toContain(
      '(obbligatorio)'
    )
  })

  it('nota obbligatoria: senza testo (o solo spazi) il pulsante resta spento', async () => {
    await crea()
    expect(
      q<HTMLButtonElement>('presa-atto-conferma')!.querySelector('button')!.disabled
    ).toBeTrue()
    scrivi('   ')
    expect(
      q<HTMLButtonElement>('presa-atto-conferma')!.querySelector('button')!.disabled
    ).toBeTrue()
    scrivi('Concordato col cliente')
    expect(
      q<HTMLButtonElement>('presa-atto-conferma')!.querySelector('button')!.disabled
    ).toBeFalse()
  })

  it('la nota ha tetto 200 e un contatore', async () => {
    await crea()
    expect(q<HTMLTextAreaElement>('presa-atto-nota')!.maxLength).toBe(200)
    expect(q('presa-atto-contatore')!.textContent).toContain('0 / 200')
    scrivi('abc')
    expect(q('presa-atto-contatore')!.textContent).toContain('3 / 200')
  })

  it('conferma: manda la nota senza spazi di bordo e la versione del legame, poi segnala', async () => {
    await crea()
    scrivi('  Concordato col cliente  ')
    q('presa-atto-conferma')!.querySelector('button')!.click()
    fixture.detectChanges()
    expect(servizio.presaAtto).toHaveBeenCalledOnceWith('lg-1', 'Concordato col cliente', 4)
    expect(registrati).toBe(1)
  })

  it('doppio clic durante la richiesta: una sola chiamata', async () => {
    await crea()
    const attesa = new Subject<void>()
    servizio.presaAtto.and.returnValue(attesa)
    scrivi('Nota')
    const bottone = q('presa-atto-conferma')!.querySelector('button')!
    bottone.click()
    bottone.click()
    expect(servizio.presaAtto).toHaveBeenCalledTimes(1)
  })

  it('errore 409 SCOSTAMENTO_NON_APERTO: messaggio del vocabolario, nessun id, la chiusura chiede di rileggere', async () => {
    await crea()
    servizio.presaAtto.and.returnValue(
      throwError(
        () =>
          new HttpErrorResponse({
            status: 409,
            error: { error: 'SCOSTAMENTO_NON_APERTO', message: 'legame lg-1 non aperto' },
          })
      )
    )
    scrivi('Nota')
    q('presa-atto-conferma')!.querySelector('button')!.click()
    fixture.detectChanges()
    const msg = q('presa-atto-errore')!.textContent ?? ''
    expect(msg).toContain('non è più aperto')
    expect(msg).not.toContain('lg-1')
    expect(registrati).toBe(0)
    q('presa-atto-annulla')!.querySelector('button')!.click()
    expect(registrati).toBe(1)
    expect(chiusi).toBe(1)
  })

  it('riaprendo il dialog la nota riparte vuota', async () => {
    await crea()
    scrivi('Vecchia nota')
    fixture.componentRef.setInput('visible', false)
    fixture.detectChanges()
    fixture.componentRef.setInput('visible', true)
    fixture.detectChanges()
    await fixture.whenStable()
    fixture.detectChanges()
    expect(fixture.componentInstance.nota()).toBe('')
    expect(fixture.componentInstance.errore()).toBeNull()
  })
})
