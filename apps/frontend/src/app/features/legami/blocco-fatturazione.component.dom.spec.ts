import { ComponentFixture, TestBed, fakeAsync, tick } from '@angular/core/testing'
import { provideNoopAnimations } from '@angular/platform-browser/animations'
import { of } from 'rxjs'
import { AuthService } from '../../core/services/auth.service'
import {
  ATTESA_PROPOSTA_MS,
  ATTESA_RICERCA_CLIENTI_MS,
  BloccoFatturazioneComponent,
  StatoBlocco,
} from './blocco-fatturazione.component'
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
  let stati: StatoBlocco[]
  const confermabile = (): boolean => stati[stati.length - 1]?.confermabile ?? false

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
    stati = []
    fixture.componentInstance.statoChange.subscribe(x => stati.push(x))
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
    expect(confermabile()).toBeTrue()
  }))

  it('quantità "1.5": «Usa la virgola per i decimali» e il pulsante si blocca', fakeAsync(() => {
    crea()
    const input = campo('qta-ra-1')
    expect(incolla(input, '1.5').defaultPrevented).toBeTrue()
    fixture.detectChanges()
    expect(q('errore-qta-ra-1')?.textContent).toContain('Usa la virgola per i decimali')
    expect(confermabile()).toBeFalse()
    // il valore non è cambiato
    expect(rigaRegistrata('ra-1')?.quantita).toBeUndefined()
  }))

  it('quantità "0": errore e pulsante bloccato', fakeAsync(() => {
    crea()
    scrivi('qta-ra-1', '0')
    expect(q('errore-qta-ra-1')?.textContent).toContain('maggiore di zero')
    expect(confermabile()).toBeFalse()
    expect(rigaRegistrata('ra-1')?.quantita).toBeUndefined()
  }))

  it('quantità "1,2345": errore sui decimali e pulsante bloccato', fakeAsync(() => {
    crea()
    scrivi('qta-ra-1', '1,2345')
    expect(q('errore-qta-ra-1')?.textContent).toContain('3 decimali')
    expect(confermabile()).toBeFalse()
  }))

  it('un valore corretto dopo l’errore sblocca il pulsante', fakeAsync(() => {
    crea()
    scrivi('qta-ra-1', '0')
    expect(confermabile()).toBeFalse()
    scrivi('qta-ra-1', '2,5')
    expect(q('errore-qta-ra-1')).toBeNull()
    expect(confermabile()).toBeTrue()
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
    expect(confermabile()).toBeFalse()
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
      expect(confermabile()).toBeFalse()
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
    expect(confermabile()).toBeFalse()
    rispostaCorrente = proposta({ righe: [proposta().righe[0]] })
    fixture.componentRef.setInput('datiMovimento', { ...DATI, cerCode: '17 04 02' })
    fixture.detectChanges()
    tick(ATTESA_PROPOSTA_MS)
    fixture.detectChanges()
    tick()
    fixture.detectChanges()
    expect(confermabile()).toBeTrue()
  }))

  it('m7: cambia la quantità del movimento (stesso FIR): l’errore di campo della riga si pulisce', fakeAsync(() => {
    crea()
    scrivi('qta-ra-1', '0')
    expect(q('errore-qta-ra-1')).not.toBeNull()
    expect(confermabile()).toBeFalse()
    rispostaCorrente = proposta({
      righe: [proposta().righe[0], proposta().righe[1]].map(r =>
        r.rigaAddebitoId === 'ra-1' ? { ...r, quantita: '130' } : r
      ),
    })
    fixture.componentRef.setInput('datiMovimento', { ...DATI, quantity: '130' })
    fixture.detectChanges()
    tick(ATTESA_PROPOSTA_MS)
    fixture.detectChanges()
    tick()
    fixture.detectChanges()
    expect(q('errore-qta-ra-1')).toBeNull()
    expect(campo('qta-ra-1').value).toBe('130')
    expect(confermabile()).toBeTrue()
  }))

  it('N1: sconto «10,50» uguale a «10.5» della proposta: la riga non diventa manuale', fakeAsync(() => {
    crea(proposta({ righe: [{ ...proposta().righe[0], sconto: '10.5' }, proposta().righe[1]] }))
    const s = campo('sconto-ra-1')
    s.value = '10,50'
    s.dispatchEvent(new Event('input'))
    fixture.detectChanges()
    expect(q('badge-prezzo-manuale-ra-1')).toBeNull()
    expect(rigaRegistrata('ra-1')?.sconto).toBeUndefined()
    // una cascata diversa invece si' (stesso numero di termini, valori diversi)
    s.value = '10,5+5'
    s.dispatchEvent(new Event('input'))
    fixture.detectChanges()
    expect(rigaRegistrata('ra-1')?.sconto).toBe('10.5+5')
  }))

  it('N3: dati -> null -> dati con un altro FIR azzera le modifiche delle righe', fakeAsync(() => {
    crea()
    const con = (firId: string) => ({ ...DATI, firId })
    const passa = (dati: unknown): void => {
      fixture.componentRef.setInput('datiMovimento', dati)
      fixture.detectChanges()
      tick(ATTESA_PROPOSTA_MS)
      fixture.detectChanges()
      tick()
      fixture.detectChanges()
    }
    passa(con('fir-1'))
    scrivi('prezzo-ra-1', '12,5')
    expect(q('badge-prezzo-manuale-ra-1')).not.toBeNull()
    passa(null)
    passa(con('fir-2'))
    expect(q('badge-prezzo-manuale-ra-1')).toBeNull()
  }))

  it('N3: dati -> null -> dati con lo stesso FIR conserva le modifiche', fakeAsync(() => {
    crea()
    const con = (firId: string) => ({ ...DATI, firId })
    const passa = (dati: unknown): void => {
      fixture.componentRef.setInput('datiMovimento', dati)
      fixture.detectChanges()
      tick(ATTESA_PROPOSTA_MS)
      fixture.detectChanges()
      tick()
      fixture.detectChanges()
    }
    passa(con('fir-1'))
    scrivi('prezzo-ra-1', '12,5')
    passa(null)
    passa(con('fir-1'))
    expect(q('badge-prezzo-manuale-ra-1')).not.toBeNull()
  }))

  describe('m6: menu dei clienti', () => {
    const CON_CODICE = [
      { id: 'cl-42', codice: 'C0042', ditta: { ragioneSociale: 'Bianchi Srl', partitaIva: '011' } },
      { id: 'cl-43', codice: null, ditta: { ragioneSociale: 'Neri Spa', partitaIva: null } },
    ] as never[]

    it('l’etichetta mostra il codice e il filtro lo trova anche se la ragione sociale non lo contiene', fakeAsync(() => {
      crea(proposta({ cliente: null, motivi: ['SENZA_CLIENTE'] }))
      const opzioni = fixture.componentInstance.clientiOpzioni()
      expect(opzioni.map(o => o.etichetta)).toEqual(['Bianchi Srl', 'Neri Spa'])
      fixture.componentInstance.clienti.set(CON_CODICE)
      fixture.detectChanges()
      expect(fixture.componentInstance.clientiOpzioni().map(o => o.etichetta)).toEqual([
        'C0042 · Bianchi Srl',
        'Neri Spa',
      ])
      // apertura reale del menu e filtro del dropdown per codice
      fixture.nativeElement.querySelector('[data-testid="fatt-cliente-menu"] .p-dropdown').click()
      fixture.detectChanges()
      const filtro = fixture.nativeElement.querySelector('.p-dropdown-filter') as HTMLInputElement
      filtro.value = 'C0042'
      filtro.dispatchEvent(new Event('input'))
      fixture.detectChanges()
      const voci = Array.from(
        fixture.nativeElement.querySelectorAll('.p-dropdown-item') as NodeListOf<HTMLElement>
      ).map(e => (e.textContent ?? '').trim())
      expect(voci).toEqual(['C0042 · Bianchi Srl'])
      tick(ATTESA_RICERCA_CLIENTI_MS)
    }))
  })
})
