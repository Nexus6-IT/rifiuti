import { Component } from '@angular/core'
import { ComponentFixture, TestBed } from '@angular/core/testing'
import { of, throwError } from 'rxjs'
import { DittaIdentificativiComponent } from './ditta-identificativi.component'
import { RegistryService } from './registry.service'
import { Ditta, SedeDitta } from '../../shared/models/registry.model'
import type { ModalitaAnagrafica, TipoAnagrafica } from './anagrafica-form-dialog.component'

const PIVA_VALIDA = '12345678903'
const PIVA_ERRATA = '12345678901'
const CF_PERSONA = 'RSSMRA80A01H501U'

function sede(id: string, over: Partial<SedeDitta> = {}): SedeDitta {
  return {
    id,
    denominazione: null,
    via: 'Via Roma',
    civico: '1',
    cap: '00100',
    citta: 'Roma',
    provincia: 'RM',
    referente: null,
    email: null,
    telefono: null,
    pec: null,
    principale: false,
    attiva: true,
    ...over,
  }
}

const DITTA: Ditta = {
  id: 'd1',
  ragioneSociale: 'ACME S.r.l.',
  partitaIva: PIVA_VALIDA,
  codiceFiscale: null,
  partitaIvaDaVerificare: false,
  privato: false,
  sedi: [
    sede('s1', { principale: true }),
    sede('s2', { via: 'Via Milano', civico: '9', cap: '20100', citta: 'Milano', provincia: 'MI' }),
    sede('s3', { via: 'Via Chiusa', attiva: false }),
  ],
  ruoli: { destinatarioId: 'x' },
}

@Component({
  standalone: true,
  imports: [DittaIdentificativiComponent],
  template: `
    <app-ditta-identificativi
      pfx="t"
      [tipo]="tipo"
      [modalita]="modalita"
      [(partitaIVA)]="piva"
      [(codiceFiscale)]="cf"
      [partitaIvaOriginale]="pivaOriginale"
      [codiceFiscaleOriginale]="cfOriginale"
      [partitaIvaDaVerificare]="daVerificare"
      [errori]="errori"
      (dittaTrovata)="trovate.push($event)"
      (sedeScelta)="scelte.push($event)"
    />
  `,
})
class HostComponent {
  tipo: TipoAnagrafica = 'produttore'
  modalita: ModalitaAnagrafica = 'create'
  piva = ''
  cf = ''
  pivaOriginale: string | null = null
  cfOriginale: string | null = null
  daVerificare = false
  errori = {}
  trovate: Array<Ditta | null> = []
  scelte: Array<SedeDitta | null> = []
}

describe('DittaIdentificativiComponent', () => {
  let fixture: ComponentFixture<HostComponent>
  let host: HostComponent
  let registry: jasmine.SpyObj<RegistryService>
  const root = () => fixture.nativeElement as HTMLElement
  const q = <T extends HTMLElement>(sel: string) => root().querySelector(sel) as T | null

  function scrivi(id: string, valore: string): HTMLInputElement {
    const input = q<HTMLInputElement>(`#${id}`)!
    input.value = valore
    input.dispatchEvent(new Event('input'))
    fixture.detectChanges()
    return input
  }
  function esci(input: HTMLInputElement): void {
    input.dispatchEvent(new Event('blur'))
    fixture.detectChanges()
  }

  beforeEach(async () => {
    registry = jasmine.createSpyObj<RegistryService>('RegistryService', ['cercaDitta'])
    registry.cercaDitta.and.returnValue(of({ ditta: null }))
    await TestBed.configureTestingModule({
      imports: [HostComponent],
      providers: [{ provide: RegistryService, useValue: registry }],
    }).compileComponents()
    fixture = TestBed.createComponent(HostComponent)
    host = fixture.componentInstance
    fixture.detectChanges()
  })

  it('mostra "Codice fiscale" accanto alla "Partita IVA", entrambe senza asterisco di obbligo', () => {
    expect(root().querySelector('label[for="t-cf"]')?.textContent).toContain('Codice fiscale')
    expect(root().querySelector('label[for="t-piva"]')?.textContent).toContain('Partita IVA')
    expect(root().querySelector('label[for="t-piva"] .req')).toBeNull()
    expect(q<HTMLInputElement>('#t-cf')!.maxLength).toBe(16)
  })

  it('aggiorna il genitore mentre si scrive (two-way)', () => {
    scrivi('t-piva', PIVA_VALIDA)
    scrivi('t-cf', CF_PERSONA)
    expect(host.piva).toBe(PIVA_VALIDA)
    expect(host.cf).toBe(CF_PERSONA)
  })

  describe('ricerca della ditta (creazione)', () => {
    it("all'uscita dal campo con una P.IVA valida cerca la ditta, una volta sola per valore", () => {
      const piva = scrivi('t-piva', PIVA_VALIDA)
      expect(registry.cercaDitta).not.toHaveBeenCalled() // non a ogni tasto
      esci(piva)
      esci(piva)
      esci(q<HTMLInputElement>('#t-cf')!)
      expect(registry.cercaDitta).toHaveBeenCalledTimes(1)
      expect(registry.cercaDitta).toHaveBeenCalledWith(PIVA_VALIDA)

      scrivi('t-piva', '09876543217')
      esci(piva)
      expect(registry.cercaDitta).toHaveBeenCalledTimes(2)
    })

    it('non cerca con un identificativo non valido (checksum errato, CF malformato)', () => {
      esci(scrivi('t-piva', PIVA_ERRATA))
      esci(scrivi('t-cf', 'ABC'))
      expect(registry.cercaDitta).not.toHaveBeenCalled()
    })

    it('cerca col codice fiscale se la P.IVA manca', () => {
      esci(scrivi('t-cf', CF_PERSONA))
      expect(registry.cercaDitta).toHaveBeenCalledOnceWith(CF_PERSONA)
    })

    it('ditta non trovata: nessun avviso', () => {
      esci(scrivi('t-piva', PIVA_VALIDA))
      expect(q('[role="status"]')).toBeNull()
      expect(host.trovate).toEqual([])
    })

    it('un errore della ricerca non blocca il form e si può riprovare', () => {
      registry.cercaDitta.and.returnValue(throwError(() => new Error('rete')))
      const piva = scrivi('t-piva', PIVA_VALIDA)
      esci(piva)
      expect(q('[role="status"]')).toBeNull()
      registry.cercaDitta.and.returnValue(of({ ditta: DITTA }))
      esci(piva)
      expect(registry.cercaDitta).toHaveBeenCalledTimes(2)
      expect(q('[role="status"]')).toBeTruthy()
    })

    describe('ditta trovata', () => {
      beforeEach(() => {
        registry.cercaDitta.and.returnValue(of({ ditta: DITTA }))
        esci(scrivi('t-piva', PIVA_VALIDA))
      })

      it('mostra un avviso role="status" con la ragione sociale e avvisa il genitore', () => {
        const avviso = q('[role="status"]')!
        expect(avviso.textContent).toContain('Ditta già presente')
        expect(avviso.textContent).toContain('ACME S.r.l.')
        expect(host.trovate).toEqual([DITTA])
      })

      it('elenca solo le sedi attive più "Nuova sede" e preseleziona la principale', () => {
        const radio = root().querySelectorAll<HTMLInputElement>('input[type="radio"]')
        expect(radio.length).toBe(3) // s1, s2, nuova (s3 disattivata)
        expect(q<HTMLInputElement>('[data-testid="t-sede-s1"]')!.checked).toBeTrue()
        expect(host.scelte.length).toBe(1)
        expect(host.scelte[0]!.id).toBe('s1')
        expect(q('fieldset legend')?.textContent).toContain('Sede')
      })

      it('scegliere un\'altra sede, o "Nuova sede", lo comunica al genitore (clic reale)', () => {
        q<HTMLInputElement>('[data-testid="t-sede-s2"]')!.click()
        fixture.detectChanges()
        expect(host.scelte[host.scelte.length - 1]!.id).toBe('s2')

        q<HTMLInputElement>('[data-testid="t-sede-nuova"]')!.click()
        fixture.detectChanges()
        expect(host.scelte[host.scelte.length - 1]).toBeNull()
      })

      it("cambiando l'identificativo l'avviso sparisce e il genitore ne è informato", () => {
        scrivi('t-piva', '1234567890')
        expect(q('[role="status"]')).toBeNull()
        expect(host.trovate[host.trovate.length - 1]).toBeNull()
      })

      it('segnala che il ruolo esiste già per la ditta', () => {
        // la ditta ha già un destinatario
        host.tipo = 'destinatario'
        fixture.detectChanges()
        expect(q('[role="status"]')!.textContent).toContain('già registrata come destinatario')
      })
    })
  })

  describe('modifica', () => {
    beforeEach(() => {
      host.modalita = 'edit'
    })

    it('P.IVA valida già impostata: non modificabile; il CF mancante si può aggiungere', async () => {
      host.piva = PIVA_VALIDA
      host.pivaOriginale = PIVA_VALIDA
      fixture.detectChanges()
      await fixture.whenStable()
      fixture.detectChanges()
      expect(q<HTMLInputElement>('#t-piva')!.disabled).toBeTrue()
      expect(q<HTMLInputElement>('#t-cf')!.disabled).toBeFalse()
      expect(q('[data-testid="t-piva-da-verificare"]')).toBeNull()
    })

    it('D2.8: P.IVA "da verificare" modificabile, con avviso', async () => {
      host.piva = PIVA_ERRATA
      host.pivaOriginale = PIVA_ERRATA
      host.daVerificare = true
      fixture.detectChanges()
      await fixture.whenStable()
      fixture.detectChanges()
      const input = q<HTMLInputElement>('#t-piva')!
      expect(input.disabled).toBeFalse()
      expect(q('[data-testid="t-piva-da-verificare"]')!.textContent).toContain('Da verificare')
      expect(input.getAttribute('aria-describedby')).toContain('t-piva-warn')
    })

    it('CF già impostato: non modificabile; in modifica non cerca la ditta', async () => {
      host.cf = CF_PERSONA
      host.cfOriginale = CF_PERSONA
      fixture.detectChanges()
      await fixture.whenStable()
      fixture.detectChanges()
      expect(q<HTMLInputElement>('#t-cf')!.disabled).toBeTrue()
      esci(scrivi('t-piva', PIVA_VALIDA))
      expect(registry.cercaDitta).not.toHaveBeenCalled()
    })
  })

  it('collega gli errori ai campi con aria-describedby / aria-invalid e role="alert"', () => {
    host.errori = {
      partitaIva: 'Partita IVA non valida: servono 11 cifre con la cifra di controllo corretta.',
      generale: 'Indica la partita IVA o il codice fiscale.',
    }
    fixture.detectChanges()
    const piva = q<HTMLInputElement>('#t-piva')!
    expect(piva.getAttribute('aria-invalid')).toBe('true')
    const ids = piva.getAttribute('aria-describedby')!.split(' ')
    expect(ids).toEqual(['t-piva-err', 't-id-err'])
    for (const id of ids) expect(q(`#${id}`)!.getAttribute('role')).toBe('alert')
    expect(q('#t-id-err')!.textContent).toContain('Indica la partita IVA o il codice fiscale.')
  })
})
