import { HttpClientTestingModule } from '@angular/common/http/testing'
import { Component } from '@angular/core'
import {
  ComponentFixture,
  TestBed,
  discardPeriodicTasks,
  fakeAsync,
  tick,
} from '@angular/core/testing'
import { provideNoopAnimations } from '@angular/platform-browser/animations'
import { of } from 'rxjs'
import { agente } from './agenti-pesa.component.dom.spec'
import { MESSAGGIO_NESSUNA_LETTURA } from './letture-strumento.component'
import { NuovoAccessoDialogComponent } from './nuovo-accesso-dialog.component'
import { q, qb } from './pese-test-utils'
import { SecondaPesataDialogComponent } from './seconda-pesata-dialog.component'
import { AccessoVista, AgenteVista, LetturaVista, PeseService } from './pese.service'
import { accesso } from './pese-test-utils'

function lettura(p: Partial<LetturaVista> = {}): LetturaVista {
  return {
    id: 'l1',
    strumento: { id: 's1', descrizione: 'Pesa a ponte' },
    pesoKg: 8000,
    alibiId: '000123',
    oraStrumento: '2026-11-13T09:15:03.000Z',
    oraAgente: '2026-11-13T09:15:04.000Z',
    oraRicezione: '2026-11-13T09:15:05.000Z',
    simulata: false,
    usataIn: null,
    utilizzabile: true,
    avvisi: [],
    firmaValida: true,
    ...p,
  }
}

@Component({
  standalone: true,
  imports: [SecondaPesataDialogComponent],
  template: `<app-seconda-pesata-dialog
    [accesso]="acc"
    [agenti]="agenti"
    (fatto)="fatti.push($event)"
  ></app-seconda-pesata-dialog>`,
})
class OspiteSecondaComponent {
  acc: AccessoVista = accesso({ stato: 'APERTO', pesate: [accesso().pesate[0]] })
  agenti: AgenteVista[] = [agente()]
  fatti: AccessoVista[] = []
}

@Component({
  standalone: true,
  imports: [NuovoAccessoDialogComponent],
  template: `<app-nuovo-accesso-dialog
    [registri]="[]"
    [agenti]="agenti"
    (creato)="creati.push($event)"
  ></app-nuovo-accesso-dialog>`,
})
class OspiteNuovoComponent {
  agenti: AgenteVista[] = [agente()]
  creati: AccessoVista[] = []
}

describe('Pesata da strumento nei dialog (DOM)', () => {
  let pese: jasmine.SpyObj<PeseService>

  beforeEach(() => {
    pese = jasmine.createSpyObj<PeseService>('PeseService', [
      'secondaPesata',
      'apriAccesso',
      'elencaLetture',
    ])
    pese.elencaLetture.and.returnValue(
      of({
        righe: [
          lettura(),
          lettura({
            id: 'l2',
            pesoKg: 100,
            simulata: true,
            avvisi: ['Trasmessa in differita (45 min dopo la pesata)'],
          }),
          lettura({
            id: 'l3',
            usataIn: { accessoId: 'a9', numero: 'ACC-9/2026' },
            utilizzabile: false,
          }),
        ],
      })
    )
    TestBed.configureTestingModule({
      imports: [HttpClientTestingModule],
      providers: [provideNoopAnimations(), { provide: PeseService, useValue: pese }],
    })
  })
  afterEach(() => document.body.querySelectorAll('.p-dialog-mask').forEach(e => e.remove()))

  describe('seconda pesata', () => {
    let fixture: ComponentFixture<OspiteSecondaComponent>
    const apri = () => {
      fixture = TestBed.createComponent(OspiteSecondaComponent)
      fixture.detectChanges()
    }

    it('con un agente attivo il predefinito e "Da strumento" e il peso non si digita', () => {
      apri()
      expect(q<HTMLInputElement>('sp-src-da-strumento')!.checked).toBeTrue()
      expect(pese.elencaLetture).toHaveBeenCalledWith({ registroId: 'r1', libere: true })
      expect(q('ls-riga-l1')!.textContent).toContain('8.000 kg')
      expect(q('ls-riga-l1')!.textContent).toContain('alibi 000123')
      expect(q('ls-simulata')).not.toBeNull()
      expect(q('ls-riga-l2')!.querySelector('[data-testid="ls-simulata"]')).not.toBeNull()
      expect(q('ls-riga-l2')!.querySelector('[data-testid="ls-differita"]')).not.toBeNull()
      expect(q('ls-scegli-l3')!.hasAttribute('disabled')).toBeTrue()
      expect(document.getElementById('sp-peso')!.closest('[hidden]')).not.toBeNull()
    })

    it('senza scegliere una lettura non invia; scegliendola manda solo letturaId', () => {
      apri()
      pese.secondaPesata.and.returnValue(of(accesso()))
      qb('sp-salva')!.click()
      fixture.detectChanges()
      expect(pese.secondaPesata).not.toHaveBeenCalled()
      expect(q('sp-lettura-errore')).not.toBeNull()
      q<HTMLInputElement>('ls-scegli-l1')!.click()
      fixture.detectChanges()
      qb('sp-salva')!.click()
      const [id, dati, allegato] = pese.secondaPesata.calls.mostRecent().args
      expect(id).toBe('a1')
      expect(dati.pesata).toEqual({ letturaId: 'l1' })
      expect(dati.chiaveIdempotenza).toMatch(/^[0-9a-f-]{36}$/)
      expect(allegato).toBeNull()
    })

    it('nessuna lettura: messaggio e scelta manuale disponibile', () => {
      pese.elencaLetture.and.returnValue(of({ righe: [] }))
      apri()
      expect(q('ls-vuota')!.textContent).toContain(MESSAGGIO_NESSUNA_LETTURA)
      q<HTMLInputElement>('sp-src-manuale')!.click()
      fixture.detectChanges()
      expect(document.getElementById('sp-peso')!.closest('[hidden]')).toBeNull()
      expect(q('ls-vuota')).toBeNull()
    })

    it('senza agenti il predefinito e Manuale e non si leggono le letture', () => {
      apri()
      fixture.destroy()
      pese.elencaLetture.calls.reset()
      const f = TestBed.createComponent(OspiteSecondaComponent)
      f.componentInstance.agenti = []
      f.detectChanges()
      expect(q<HTMLInputElement>('sp-src-manuale')!.checked).toBeTrue()
      expect(pese.elencaLetture).not.toHaveBeenCalled()
      f.destroy()
    })

    it('aggiorna ogni 5 secondi e si ferma alla chiusura', fakeAsync(() => {
      apri()
      expect(pese.elencaLetture).toHaveBeenCalledTimes(1)
      tick(5000)
      expect(pese.elencaLetture).toHaveBeenCalledTimes(2)
      tick(5000)
      expect(pese.elencaLetture).toHaveBeenCalledTimes(3)
      fixture.destroy()
      tick(20000)
      expect(pese.elencaLetture).toHaveBeenCalledTimes(3)
      discardPeriodicTasks()
    }))

    it('se la lettura scelta sparisce dall elenco la scelta si azzera', fakeAsync(() => {
      apri()
      q<HTMLInputElement>('ls-scegli-l1')!.click()
      fixture.detectChanges()
      pese.elencaLetture.and.returnValue(of({ righe: [lettura({ id: 'l2' })] }))
      tick(5000)
      fixture.detectChanges()
      pese.secondaPesata.and.returnValue(of(accesso()))
      qb('sp-salva')!.click()
      fixture.detectChanges()
      expect(pese.secondaPesata).not.toHaveBeenCalled()
      expect(q('sp-lettura-errore')).not.toBeNull()
      fixture.destroy()
      discardPeriodicTasks()
    }))
  })

  describe('nuovo accesso', () => {
    it('apre l accesso con la lettura scelta, senza peso ne allegato', () => {
      const fixture = TestBed.createComponent(OspiteNuovoComponent)
      fixture.detectChanges()
      expect(q<HTMLInputElement>('na-src-da-strumento')!.checked).toBeTrue()
      pese.apriAccesso.and.returnValue(of(accesso()))
      q<HTMLInputElement>('ls-scegli-l1')!.click()
      fixture.detectChanges()
      qb('na-salva')!.click()
      const [dati, allegato] = pese.apriAccesso.calls.mostRecent().args
      expect(dati.pesata).toEqual({ letturaId: 'l1' })
      expect(dati.modo).toBe('DOPPIA')
      expect(allegato).toBeNull()
      expect(fixture.componentInstance.creati.length).toBe(1)
      fixture.destroy()
    })
  })
})
