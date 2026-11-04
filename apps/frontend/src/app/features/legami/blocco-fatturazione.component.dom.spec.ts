import { ComponentFixture, TestBed, fakeAsync, tick } from '@angular/core/testing'
import { provideNoopAnimations } from '@angular/platform-browser/animations'
import { of } from 'rxjs'
import { AuthService } from '../../core/services/auth.service'
import { ATTESA_PROPOSTA_MS, BloccoFatturazioneComponent } from './blocco-fatturazione.component'
import { DATI, proposta } from './blocco-fatturazione.test-util'
import { DatiLegameRegistrazione, PropostaLegame } from './legami.model'
import { LegamiService } from './legami.service'
import { ClientiService } from '../clienti/clienti.service'

/**
 * Campi numerici del blocco «Fatturazione» nel DOM: virgola decimale, punto rifiutato, nessun
 * separatore delle migliaia, quantità > 0 con al massimo 3 decimali.
 */
const CLIENTI = [
  { id: 'cl-7', ditta: { ragioneSociale: 'Bianchi Srl' } },
  { id: 'cl-8', ditta: { ragioneSociale: 'Neri Spa' } },
] as never[]

describe('BloccoFatturazioneComponent — campi numerici (DOM)', () => {
  let fixture: ComponentFixture<BloccoFatturazioneComponent>
  let legami: (DatiLegameRegistrazione | null)[]

  const q = (testid: string): HTMLElement | null =>
    fixture.nativeElement.querySelector(`[data-testid="${testid}"]`)
  const campo = (id: string): HTMLInputElement =>
    fixture.nativeElement.querySelector(`#${id}`) as HTMLInputElement
  const ultimo = (): DatiLegameRegistrazione | null => legami[legami.length - 1] ?? null
  const rigaRegistrata = (id: string) => ultimo()?.righe?.find(r => r.rigaAddebitoId === id)

  /** Incolla un testo nel campo e esce: la via più fedele a «digitare» con la direttiva. */
  function incolla(input: HTMLInputElement, testo: string): ClipboardEvent {
    input.focus()
    const dt = new DataTransfer()
    dt.setData('text', testo)
    const e = new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true })
    input.dispatchEvent(e)
    return e
  }

  function scrivi(id: string, testo: string): void {
    const input = campo(id)
    input.focus()
    input.select()
    input.value = ''
    incolla(input, testo)
    input.dispatchEvent(new Event('blur'))
    fixture.detectChanges()
  }

  let rispostaCorrente: PropostaLegame

  function crea(p: PropostaLegame = proposta()): void {
    rispostaCorrente = p
    TestBed.configureTestingModule({
      imports: [BloccoFatturazioneComponent],
      providers: [
        provideNoopAnimations(),
        { provide: LegamiService, useValue: { proposta: () => of(rispostaCorrente) } },
        {
          provide: ClientiService,
          useValue: { clienti: { list: () => of({ elementi: CLIENTI, totale: CLIENTI.length }) } },
        },
        { provide: AuthService, useValue: { currentUser: () => ({ role: 'OPERATOR' }) } },
      ],
    })
    fixture = TestBed.createComponent(BloccoFatturazioneComponent)
    legami = []
    fixture.componentInstance.legameChange.subscribe(l => legami.push(l))
    fixture.componentRef.setInput('datiMovimento', DATI)
    fixture.detectChanges()
    tick(ATTESA_PROPOSTA_MS)
    fixture.detectChanges()
    // ngModel scrive il valore nei campi in un microtask
    tick()
    fixture.detectChanges()
  }

  it('quantità "1,5" accettata e inviata come "1.5"', fakeAsync(() => {
    crea()
    scrivi('qta-ra-1', '1,5')
    expect(rigaRegistrata('ra-1')?.quantita).toBe('1.5')
    expect(q('errore-qta-ra-1')).toBeNull()
    expect((q('fatt-conferma') as HTMLButtonElement).disabled).toBeFalse()
  }))

  it('quantità "1.5": «Usa la virgola per i decimali» e il pulsante si blocca', fakeAsync(() => {
    crea()
    const input = campo('qta-ra-1')
    expect(incolla(input, '1.5').defaultPrevented).toBeTrue()
    fixture.detectChanges()
    expect(q('errore-qta-ra-1')?.textContent).toContain('Usa la virgola per i decimali')
    expect((q('fatt-conferma') as HTMLButtonElement).disabled).toBeTrue()
    // il valore non è cambiato
    expect(rigaRegistrata('ra-1')?.quantita).toBeUndefined()
  }))

  it('quantità "0": errore e pulsante bloccato', fakeAsync(() => {
    crea()
    scrivi('qta-ra-1', '0')
    expect(q('errore-qta-ra-1')?.textContent).toContain('maggiore di zero')
    expect((q('fatt-conferma') as HTMLButtonElement).disabled).toBeTrue()
    expect(rigaRegistrata('ra-1')?.quantita).toBeUndefined()
  }))

  it('quantità "1,2345": errore sui decimali e pulsante bloccato', fakeAsync(() => {
    crea()
    scrivi('qta-ra-1', '1,2345')
    expect(q('errore-qta-ra-1')?.textContent).toContain('3 decimali')
    expect((q('fatt-conferma') as HTMLButtonElement).disabled).toBeTrue()
  }))

  it('un valore corretto dopo l’errore sblocca il pulsante', fakeAsync(() => {
    crea()
    scrivi('qta-ra-1', '0')
    expect((q('fatt-conferma') as HTMLButtonElement).disabled).toBeTrue()
    scrivi('qta-ra-1', '2,5')
    expect(q('errore-qta-ra-1')).toBeNull()
    expect((q('fatt-conferma') as HTMLButtonElement).disabled).toBeFalse()
  }))

  it('prezzo "12,5" a mano: inviato come "12.5", badge «prezzo manuale» e avviso', fakeAsync(() => {
    crea()
    scrivi('prezzo-ra-1', '12,5')
    expect(rigaRegistrata('ra-1')?.prezzo).toBe('12.5')
    expect(q('badge-prezzo-manuale-ra-1')?.textContent).toContain('prezzo manuale')
    expect(q('fatt-avviso-PREZZO_MANUALE')).not.toBeNull()
  }))

  it('prezzo "12.5" (punto): «Usa la virgola per i decimali»', fakeAsync(() => {
    crea()
    incolla(campo('prezzo-ra-1'), '12.5')
    fixture.detectChanges()
    expect(q('errore-prezzo-ra-1')?.textContent).toContain('Usa la virgola per i decimali')
    expect(rigaRegistrata('ra-1')?.prezzo).toBeUndefined()
  }))

  it('prezzo negativo: errore', fakeAsync(() => {
    crea()
    scrivi('prezzo-ra-1', '-3')
    expect(q('errore-prezzo-ra-1')?.textContent).toContain('negativo')
  }))

  it('sconto "10,5+5": inviato come "10.5+5" (cascata), col badge «prezzo manuale»', fakeAsync(() => {
    crea()
    const s = campo('sconto-ra-1')
    s.value = '10,5+5'
    s.dispatchEvent(new Event('input'))
    fixture.detectChanges()
    expect(rigaRegistrata('ra-1')?.sconto).toBe('10.5+5')
    expect(q('badge-prezzo-manuale-ra-1')).not.toBeNull()
  }))

  it('sconto "10.5" (punto): «Usa la virgola per i decimali» e pulsante bloccato', fakeAsync(() => {
    crea()
    const s = campo('sconto-ra-1')
    s.value = '10.5'
    s.dispatchEvent(new Event('input'))
    fixture.detectChanges()
    expect(q('errore-sconto-ra-1')?.textContent).toContain('Usa la virgola per i decimali')
    expect((q('fatt-conferma') as HTMLButtonElement).disabled).toBeTrue()
  }))

  it('nessun separatore delle migliaia nei campi modificabili', fakeAsync(() => {
    crea(
      proposta({
        righe: [
          {
            ...proposta().righe[0],
            quantita: '12345.5',
            prezzo: '1234.5',
          },
        ],
      })
    )
    expect(campo('qta-ra-1').value).toBe('12345,5')
    expect(campo('prezzo-ra-1').value).toBe('1234,5')
  }))

  for (const [testoSconto, nome] of [
    ['-5', 'negativo'],
    ['100', 'oltre 99,99'],
    ['10,555', 'tre decimali'],
    ['5+5+5+5', 'quattro termini'],
  ] as const) {
    it(`sconto ${nome} («${testoSconto}»): errore e pulsante bloccato, come il backend`, fakeAsync(() => {
      crea()
      const s = campo('sconto-ra-1')
      s.value = testoSconto
      s.dispatchEvent(new Event('input'))
      fixture.detectChanges()
      expect(q('errore-sconto-ra-1')).not.toBeNull()
      expect((q('fatt-conferma') as HTMLButtonElement).disabled).toBeTrue()
      expect(rigaRegistrata('ra-1')?.sconto).toBeUndefined()
    }))
  }

  it('sconto «99,99+0,5+10» è ammesso (tre termini, fino a 99,99)', fakeAsync(() => {
    crea()
    const s = campo('sconto-ra-1')
    s.value = '99,99+0,5+10'
    s.dispatchEvent(new Event('input'))
    fixture.detectChanges()
    expect(q('errore-sconto-ra-1')).toBeNull()
    expect(rigaRegistrata('ra-1')?.sconto).toBe('99.99+0.5+10')
  }))

  it('prezzo con più di 8 cifre intere: errore', fakeAsync(() => {
    crea()
    scrivi('prezzo-ra-1', '123456789')
    expect(q('errore-prezzo-ra-1')?.textContent).toContain('troppo grande')
  }))

  it('errore su una riga, poi la riga sparisce con la nuova proposta: nessun blocco residuo', fakeAsync(() => {
    crea()
    scrivi('qta-ra-2', '0')
    expect((q('fatt-conferma') as HTMLButtonElement).disabled).toBeTrue()
    rispostaCorrente = proposta({ righe: [proposta().righe[0]] })
    fixture.componentRef.setInput('datiMovimento', { ...DATI, cerCode: '17 04 02' })
    fixture.detectChanges()
    tick(ATTESA_PROPOSTA_MS)
    fixture.detectChanges()
    tick()
    fixture.detectChanges()
    expect((q('fatt-conferma') as HTMLButtonElement).disabled).toBeFalse()
  }))
})
