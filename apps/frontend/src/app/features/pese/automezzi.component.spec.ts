import { ComponentFixture, TestBed, fakeAsync, tick } from '@angular/core/testing'
import { provideNoopAnimations } from '@angular/platform-browser/animations'
import { HttpClientTestingModule } from '@angular/common/http/testing'
import { of, throwError } from 'rxjs'
import { AutomezziComponent } from './automezzi.component'
import { Automezzo, PeseService, AccessoVista, ElencoConPermessi } from './pese.service'
import { RegistryService } from '../registry/registry.service'
import { ToastService } from '../../core/services/toast.service'
import { MSG_PUNTO_DECIMALE } from './peso-it.directive'

function automezzo(p: Partial<Automezzo> = {}): Automezzo {
  return {
    id: 'a1',
    targa: 'AB123CD',
    targaRimorchio: 'XY987ZT',
    trasportatoreId: 't1',
    taraKg: 12500.5,
    taraOrigine: 'DICHIARATA',
    taraPesataId: null,
    taraAggiornataIl: new Date().toISOString(),
    ultimaPesataVuotoIl: null,
    note: null,
    attivo: true,
    ...p,
  }
}

const elenco = (
  righe: Automezzo[],
  puoOperare = true,
  puoRettificare = true
): ElencoConPermessi<Automezzo> => ({ righe, puoOperare, puoRettificare })

const q = <T extends HTMLElement = HTMLElement>(id: string): T | null =>
  document.body.querySelector<T>(`[data-testid="${id}"]`)
const qb = (id: string): HTMLButtonElement | null => {
  const e = q(id)
  return e instanceof HTMLButtonElement ? e : (e?.querySelector('button') ?? null)
}

function scrivi(input: HTMLInputElement, testo: string): void {
  input.value = testo
  input.dispatchEvent(new Event('input', { bubbles: true }))
}
function incolla(input: HTMLInputElement, testo: string): void {
  const dt = new DataTransfer()
  dt.setData('text', testo)
  input.dispatchEvent(
    new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true })
  )
}

describe('AutomezziComponent (DOM)', () => {
  let pese: jasmine.SpyObj<PeseService>
  let registry: jasmine.SpyObj<RegistryService>
  let toast: jasmine.SpyObj<ToastService>
  let fixture: ComponentFixture<AutomezziComponent>

  function apri(e: ElencoConPermessi<Automezzo>): void {
    pese.elencaAutomezzi.and.returnValue(of(e))
    fixture = TestBed.createComponent(AutomezziComponent)
    fixture.detectChanges()
  }

  beforeEach(() => {
    pese = jasmine.createSpyObj<PeseService>('PeseService', [
      'elencaAutomezzi',
      'creaAutomezzo',
      'aggiornaAutomezzo',
      'impostaTara',
      'elencaAccessi',
      'dettaglioAccesso',
    ])
    registry = jasmine.createSpyObj<RegistryService>('RegistryService', ['getTrasportatori'])
    registry.getTrasportatori.and.returnValue(
      of({
        items: [{ id: 't1', ragioneSociale: 'Trasporti Rossi' } as any],
        total: 1,
        page: 1,
        limit: 100,
        totalPages: 1,
      })
    )
    pese.elencaAccessi.and.returnValue(
      of({ righe: [], totale: 0, puoOperare: true, puoRettificare: true })
    )
    toast = jasmine.createSpyObj<ToastService>('ToastService', ['error', 'success', 'info', 'warn'])
    TestBed.configureTestingModule({
      imports: [AutomezziComponent, HttpClientTestingModule],
      providers: [
        provideNoopAnimations(),
        { provide: PeseService, useValue: pese },
        { provide: RegistryService, useValue: registry },
        { provide: ToastService, useValue: toast },
      ],
    })
  })
  afterEach(() => fixture?.destroy())

  it('la riga mostra targa, rimorchio, trasportatore e tara con origine e data', () => {
    apri(elenco([automezzo({ taraAggiornataIl: '2026-03-10T09:00:00.000Z' })]))
    const t = q('aut-riga-a1')!.textContent!
    expect(t).toContain('AB123CD')
    expect(t).toContain('XY987ZT')
    expect(t).toContain('Trasporti Rossi')
    expect(t).toContain('12.500,5 kg')
    expect(t).toContain('Dichiarata')
    expect(t).toContain('10/03/2026')
    expect(t).not.toContain('a1')
  })

  it('avvisa se la tara e vecchia di oltre un anno', () => {
    apri(elenco([automezzo({ taraAggiornataIl: '2024-01-10T09:00:00.000Z' })]))
    expect(q('aut-tara-vecchia-a1')?.textContent).toContain('oltre un anno')
    fixture.destroy()
    apri(elenco([automezzo()]))
    expect(q('aut-tara-vecchia-a1')).toBeNull()
  })

  it('senza puoOperare non ci sono azioni di scrittura', () => {
    apri(elenco([automezzo()], false, false))
    expect(q('aut-nuovo')).toBeNull()
    expect(q('aut-modifica-a1')).toBeNull()
    expect(q('aut-tara-a1')).toBeNull()
  })

  it('nuovo automezzo: mostra la targa normalizzata e invia la richiesta', () => {
    apri(elenco([]))
    qb('aut-nuovo')!.click()
    fixture.detectChanges()
    const targa = document.getElementById('aut-targa') as HTMLInputElement
    scrivi(targa, 'ab 123-cd')
    fixture.detectChanges()
    expect(q('aut-targa-normalizzata')?.textContent).toContain('AB123CD')
    pese.creaAutomezzo.and.returnValue(of(automezzo()))
    qb('aut-salva')!.click()
    expect(pese.creaAutomezzo).toHaveBeenCalledTimes(1)
    expect(pese.creaAutomezzo.calls.mostRecent().args[0].targa).toBe('ab 123-cd')
  })

  it('una targa non valida mostra l avviso e non invia', () => {
    apri(elenco([]))
    qb('aut-nuovo')!.click()
    fixture.detectChanges()
    scrivi(document.getElementById('aut-targa') as HTMLInputElement, 'a/1')
    fixture.detectChanges()
    expect(q('aut-targa-normalizzata')?.textContent).toContain('non valida')
    qb('aut-salva')!.click()
    expect(pese.creaAutomezzo).not.toHaveBeenCalled()
  })

  it('il 409 del backend e mostrato testuale nel dialog, che resta aperto', () => {
    apri(elenco([]))
    qb('aut-nuovo')!.click()
    fixture.detectChanges()
    scrivi(document.getElementById('aut-targa') as HTMLInputElement, 'AB123CD')
    pese.creaAutomezzo.and.returnValue(
      throwError(() => ({
        status: 409,
        error: { message: 'Esiste già un automezzo con queste targhe.' },
      }))
    )
    qb('aut-salva')!.click()
    fixture.detectChanges()
    const err = q('aut-errore')!
    expect(err.textContent).toContain('Esiste già un automezzo con queste targhe.')
    expect(err.getAttribute('role')).toBe('alert')
    expect(document.getElementById('aut-targa')).not.toBeNull()
  })

  it('Esc chiude il dialog e il focus va sulla targa all apertura', fakeAsync(() => {
    apri(elenco([]))
    qb('aut-nuovo')!.click()
    fixture.detectChanges()
    tick(50)
    expect(document.activeElement).toBe(document.getElementById('aut-targa'))
    document.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', keyCode: 27, which: 27, bubbles: true })
    )
    fixture.detectChanges()
    tick(300)
    expect(document.getElementById('aut-targa')).toBeNull()
  }))

  it('la tara dichiarata c e solo con puoRettificare', () => {
    apri(elenco([automezzo()], true, false))
    qb('aut-tara-a1')!.click()
    fixture.detectChanges()
    expect(q('tara-modo-dichiarata')).toBeNull()
    expect(q('tara-modo-pesata')).not.toBeNull()
  })

  it('tara dichiarata: "12,5" vale 12,5; il campo e collegato a etichetta e aiuto', () => {
    apri(elenco([automezzo()]))
    qb('aut-tara-a1')!.click()
    fixture.detectChanges()
    const campo = document.getElementById('tara-valore') as HTMLInputElement
    expect(campo.getAttribute('aria-labelledby')).toBe('tara-valore-etichetta tara-valore-aiuto')
    expect(document.getElementById('tara-valore-aiuto')).not.toBeNull()
    incolla(campo, '12,5')
    pese.impostaTara.and.returnValue(of(automezzo()))
    qb('tara-salva')!.click()
    expect(pese.impostaTara).toHaveBeenCalledOnceWith('a1', { taraKg: 12.5 })
  })

  it('tara dichiarata: "12.5" e rifiutato con avviso, senza inviare 125', () => {
    apri(elenco([automezzo()]))
    qb('aut-tara-a1')!.click()
    fixture.detectChanges()
    const campo = document.getElementById('tara-valore') as HTMLInputElement
    incolla(campo, '12.5')
    fixture.detectChanges()
    expect(q('tara-peso-errore')?.textContent).toContain(MSG_PUNTO_DECIMALE)
    qb('tara-salva')!.click()
    expect(pese.impostaTara).not.toHaveBeenCalled()
  })

  it('tara dichiarata: il 403/422 del backend e mostrato testuale', () => {
    apri(elenco([automezzo()]))
    qb('aut-tara-a1')!.click()
    fixture.detectChanges()
    incolla(document.getElementById('tara-valore') as HTMLInputElement, '10')
    pese.impostaTara.and.returnValue(
      throwError(() => ({
        status: 422,
        error: { message: 'La tara non può superare la portata.' },
      }))
    )
    qb('tara-salva')!.click()
    fixture.detectChanges()
    expect(q('tara-errore')?.textContent).toContain('La tara non può superare la portata.')
  })

  it('tara da pesata: sceglie accesso e pesata, invia pesataId e mostra il 422 del backend', () => {
    apri(elenco([automezzo()]))
    pese.elencaAccessi.and.returnValue(
      of({
        righe: [
          {
            id: 'x1',
            numero: '5/2026',
            stato: 'CHIUSO',
            verso: 'CARICO',
            modo: 'DOPPIA',
            targa: 'AB123CD',
            cerCode: null,
            apertoIl: '2026-10-30T08:00:00.000Z',
            nettoKg: 1,
            qualita: null,
            manuale: true,
            rettificato: false,
            collegato: false,
          },
        ],
        totale: 1,
        puoOperare: true,
        puoRettificare: true,
      })
    )
    pese.dettaglioAccesso.and.returnValue(
      of({
        id: 'x1',
        pesate: [
          {
            id: 'p9',
            ordine: 2,
            fonte: 'MANUALE',
            pesoEffettivoKg: 8000,
            oraRicezione: '2026-10-30T09:00:00.000Z',
          },
        ],
      } as unknown as AccessoVista)
    )
    qb('aut-tara-a1')!.click()
    fixture.detectChanges()
    qb('tara-modo-pesata')!.click()
    fixture.detectChanges()
    expect(pese.elencaAccessi).toHaveBeenCalledWith({ targa: 'AB123CD' })
    const sel = document.getElementById('tara-accesso') as HTMLSelectElement
    expect(sel.textContent).toContain('5/2026')
    sel.value = sel.options[1].value
    sel.dispatchEvent(new Event('change', { bubbles: true }))
    fixture.detectChanges()
    const sp = document.getElementById('tara-pesata') as HTMLSelectElement
    expect(sp.textContent).toContain('8.000 kg')
    sp.value = sp.options[1].value
    sp.dispatchEvent(new Event('change', { bubbles: true }))
    pese.impostaTara.and.returnValue(
      throwError(() => ({
        status: 422,
        error: { message: 'Questa pesata non è del lato a vuoto.' },
      }))
    )
    fixture.detectChanges()
    qb('tara-salva')!.click()
    fixture.detectChanges()
    expect(pese.impostaTara).toHaveBeenCalledOnceWith('a1', { pesataId: 'p9' })
    expect(q('tara-errore')?.textContent).toContain('Questa pesata non è del lato a vuoto.')
  })
})
