import { HttpClientTestingModule } from '@angular/common/http/testing'
import { ComponentFixture, TestBed } from '@angular/core/testing'
import { of, throwError } from 'rxjs'
import { FIR } from '../../shared/models/fir.model'
import { accesso, q } from '../pese/pese-test-utils'
import { AccessoRiepilogo, ElencoAccessi, FiltriAccessi, PeseService } from '../pese/pese.service'
import { ConsegnaDaAccessoComponent, SceltaConsegna } from './consegna-da-accesso.component'

const riga = (id: string, p: Partial<AccessoRiepilogo> = {}): AccessoRiepilogo => ({
  id,
  numero: 'ACC-' + id,
  stato: 'CHIUSO',
  verso: 'CARICO',
  modo: 'DOPPIA',
  targa: 'ZZ999ZZ',
  cerCode: '17 05 04',
  apertoIl: '2026-10-30T08:00:00.000Z',
  nettoKg: 16000,
  qualita: 'DUE_PESATE',
  manuale: false,
  rettificato: false,
  collegato: false,
  ...p,
})
const elenco = (righe: AccessoRiepilogo[], puoOperare = true): ElencoAccessi => ({
  righe,
  totale: righe.length,
  pagina: 1,
  puoOperare,
  puoRettificare: false,
})
const firIn = (unita: string, quantita = 15): FIR =>
  ({
    id: 'fir-1',
    rifiuto: { cerCode: '170504', quantita, unitaMisura: unita },
    trasportatore: { targaVeicolo: 'AB 123 CD' },
  }) as unknown as FIR

describe('ConsegnaDaAccessoComponent (DOM)', () => {
  let pese: jasmine.SpyObj<PeseService>
  let fixture: ComponentFixture<ConsegnaDaAccessoComponent>
  let emessi: SceltaConsegna[]

  function apri(fir: FIR, righe: AccessoRiepilogo[] = [riga('a1')], puoOperare = true) {
    pese.elencaAccessi.and.callFake((f?: FiltriAccessi) =>
      of(elenco(f?.targa ? righe.filter(r => r.targa === 'AB123CD') : righe, puoOperare))
    )
    fixture = TestBed.createComponent(ConsegnaDaAccessoComponent)
    fixture.componentRef.setInput('fir', fir)
    fixture.componentInstance.cambio.subscribe((s: SceltaConsegna) => emessi.push(s))
    fixture.detectChanges()
  }
  const interruttore = () => q<HTMLInputElement>('cda-interruttore')!
  function attiva() {
    interruttore().click()
    fixture.detectChanges()
  }

  beforeEach(() => {
    emessi = []
    pese = jasmine.createSpyObj<PeseService>('PeseService', ['elencaAccessi', 'dettaglioAccesso'])
    TestBed.configureTestingModule({
      imports: [ConsegnaDaAccessoComponent, HttpClientTestingModule],
      providers: [{ provide: PeseService, useValue: pese }],
    })
  })
  afterEach(() => fixture?.destroy())

  it('di partenza l interruttore è spento e l elenco non si vede', () => {
    apri(firIn('T'))
    expect(interruttore().checked).toBeFalse()
    expect(q('cda-elenco')).toBeNull()
  })

  it('acceso mostra gli accessi chiusi in carico con netto, e avvisa il chiamante', () => {
    apri(firIn('T'), [riga('a1'), riga('a2', { verso: 'SCARICO' }), riga('a3', { nettoKg: null })])
    attiva()
    expect(q('cda-accesso-a1')).not.toBeNull()
    expect(q('cda-accesso-a2')).toBeNull()
    expect(q('cda-accesso-a3')).toBeNull()
    expect(emessi.at(-1)).toEqual({ attivo: true, accessoId: null, convertito: null })
  })

  it('gli accessi con la targa del FIR vengono per primi', () => {
    apri(firIn('T'), [riga('a1'), riga('a2', { targa: 'AB123CD' })])
    attiva()
    const ids = Array.from(document.body.querySelectorAll('[data-testid^="cda-accesso-"]')).map(e =>
      e.getAttribute('data-testid')
    )
    expect(ids).toEqual(['cda-accesso-a2', 'cda-accesso-a1'])
    expect(q('cda-accesso-a2')!.textContent).toContain('stessa targa del FIR')
  })

  it('scelto un accesso mostra netto, valore nell unità del FIR e scostamento', () => {
    apri(firIn('T', 15))
    attiva()
    q<HTMLInputElement>('cda-radio-a1')!.click()
    fixture.detectChanges()
    const anteprima = q('cda-anteprima')!.textContent!
    expect(anteprima).toContain('16.000 kg')
    expect(anteprima).toContain('16 T')
    expect(q('cda-scostamento')!.textContent).toContain('+6,7%')
    expect(q('cda-avviso')).toBeNull()
    expect(emessi.at(-1)).toEqual({ attivo: true, accessoId: 'a1', convertito: 16 })
  })

  it('accesso con pesata manuale: badge in elenco e avviso nell anteprima', () => {
    apri(firIn('T', 15), [riga('a1', { manuale: true }), riga('a2')])
    attiva()
    expect(q('cda-manuale-a1')).not.toBeNull()
    expect(q('cda-manuale-a2')).toBeNull()
    q<HTMLInputElement>('cda-radio-a2')!.click()
    fixture.detectChanges()
    expect(q('cda-avviso-manuale')).toBeNull()
    q<HTMLInputElement>('cda-radio-a1')!.click()
    fixture.detectChanges()
    expect(q('cda-avviso-manuale')!.textContent).toContain('Pesata inserita a mano')
  })

  it('oltre soglia l avviso è testuale ma non blocca', () => {
    apri(firIn('T', 10))
    attiva()
    q<HTMLInputElement>('cda-radio-a1')!.click()
    fixture.detectChanges()
    expect(q('cda-scostamento')!.textContent).toContain('+60%')
    expect(q('cda-avviso')!.textContent).toContain('La quantità verificata differisce del +60%')
    expect(emessi.at(-1)!.accessoId).toBe('a1')
  })

  it('FIR in M3: interruttore disabilitato con spiegazione', () => {
    apri(firIn('M3'))
    expect(interruttore().disabled).toBeTrue()
    expect(q('cda-spiegazione')!.textContent).toContain(
      'Il FIR è in M3: il peso della pesa (kg) non si converte.'
    )
    expect(interruttore().getAttribute('aria-describedby')).toBe('cda-spiegazione')
    expect(pese.elencaAccessi).not.toHaveBeenCalled()
  })

  it('netto sotto i 5 kg in tonnellate: errore del backend, nessun accesso scelto', () => {
    apri(firIn('T'), [riga('a1', { nettoKg: 4 })])
    attiva()
    q<HTMLInputElement>('cda-radio-a1')!.click()
    fixture.detectChanges()
    const errore = q('cda-errore-conversione')!
    expect(errore.getAttribute('role')).toBe('alert')
    expect(errore.textContent).toContain('Il netto è troppo piccolo per essere espresso nel FIR')
    expect(emessi.at(-1)).toEqual({ attivo: true, accessoId: null, convertito: null })
  })

  it('senza permesso di operare l interruttore è disabilitato con spiegazione', () => {
    apri(firIn('T'), [riga('a1')], false)
    expect(interruttore().disabled).toBeTrue()
    expect(q('cda-spiegazione')!.textContent).toContain('non consente')
  })

  it('accesso collegato: si vede solo se è collegato a questo FIR', () => {
    const conLegame = (firId: string) =>
      accesso({
        id: 'c1',
        collegamenti: [
          {
            id: 'l1',
            tipo: 'FIR',
            fir: {
              id: firId,
              numero: 'X',
              stato: 'IN_TRANSITO',
              quantita: 1,
              unita: 'T',
              pesoEffettivo: null,
            },
            confronto: null,
            creatoIl: '2026-10-30T10:00:00.000Z',
            revocatoIl: null,
            motivoRevoca: null,
          },
        ],
      })
    pese.dettaglioAccesso.and.returnValue(of(conLegame('fir-1')))
    apri(firIn('T'), [riga('c1', { collegato: true }), riga('c2', { collegato: false })])
    attiva()
    expect(q('cda-accesso-c1')).not.toBeNull()

    fixture.destroy()
    pese.dettaglioAccesso.and.returnValue(of(conLegame('altro-fir')))
    apri(firIn('T'), [riga('c1', { collegato: true }), riga('c2', { collegato: false })])
    attiva()
    expect(q('cda-accesso-c1')).toBeNull()
    expect(q('cda-accesso-c2')).not.toBeNull()
  })

  it('i dettagli dei collegati si leggono solo quando l interruttore si accende', () => {
    pese.dettaglioAccesso.and.returnValue(of(accesso({ id: 'c1' })))
    apri(firIn('T'), [riga('c1', { collegato: true })])
    expect(pese.dettaglioAccesso).not.toHaveBeenCalled()
    attiva()
    expect(pese.dettaglioAccesso).toHaveBeenCalledTimes(1)
  })

  it('un collegamento alla sola annotazione del registro non esclude l accesso', () => {
    pese.dettaglioAccesso.and.returnValue(
      of(
        accesso({
          id: 'c1',
          collegamenti: [
            {
              id: 'l1',
              tipo: 'MOVIMENTO',
              confronto: null,
              creatoIl: '2026-10-30T10:00:00.000Z',
              revocatoIl: null,
              motivoRevoca: null,
            },
          ],
        })
      )
    )
    apri(firIn('T'), [riga('c1', { collegato: true })])
    attiva()
    expect(q('cda-accesso-c1')).not.toBeNull()
  })

  it('elenco troncato: lo dice e invita a cercare per targa; vuoto coerente', () => {
    pese.elencaAccessi.and.returnValue(
      of({ ...elenco([riga('s1', { verso: 'SCARICO' })]), totale: 40 })
    )
    fixture = TestBed.createComponent(ConsegnaDaAccessoComponent)
    fixture.componentRef.setInput('fir', firIn('T'))
    fixture.detectChanges()
    attiva()
    expect(q('cda-troncato')!.textContent).toContain(
      'Mostrati solo gli ultimi 1 accessi chiusi: cercare per targa.'
    )
    expect(q('cda-vuoto')!.textContent).toContain('cercare per targa')
  })

  it('sotto l anteprima: il valore registrato lo calcola il server', () => {
    apri(firIn('T'))
    attiva()
    q<HTMLInputElement>('cda-radio-a1')!.click()
    fixture.detectChanges()
    expect(q('cda-nota-server')!.textContent).toContain(
      'Il valore registrato lo calcola il server con la stessa regola.'
    )
  })

  it('ricarica rilegge l elenco (seconda chiamata) e azzera la scelta', () => {
    apri(firIn('T'))
    attiva()
    q<HTMLInputElement>('cda-radio-a1')!.click()
    fixture.detectChanges()
    const prima = pese.elencaAccessi.calls.count()
    fixture.componentInstance.ricarica()
    fixture.detectChanges()
    expect(pese.elencaAccessi.calls.count()).toBeGreaterThan(prima)
    expect(emessi.at(-1)).toEqual({ attivo: true, accessoId: null, convertito: null })
  })

  it('nessun accesso disponibile: lo dice', () => {
    apri(firIn('T'), [])
    attiva()
    expect(q('cda-vuoto')).not.toBeNull()
  })

  it('errore di lettura: messaggio del backend', () => {
    pese.elencaAccessi.and.returnValue(
      throwError(() => ({ status: 403, error: { message: 'Pese riservate agli operatori.' } }))
    )
    fixture = TestBed.createComponent(ConsegnaDaAccessoComponent)
    fixture.componentRef.setInput('fir', firIn('T'))
    fixture.detectChanges()
    attiva()
    expect(q('cda-errore-elenco')!.textContent).toContain('Pese riservate agli operatori.')
  })

  it('spegnere l interruttore azzera la scelta', () => {
    apri(firIn('T'))
    attiva()
    q<HTMLInputElement>('cda-radio-a1')!.click()
    fixture.detectChanges()
    attiva()
    expect(emessi.at(-1)).toEqual({ attivo: false, accessoId: null, convertito: null })
  })
})
