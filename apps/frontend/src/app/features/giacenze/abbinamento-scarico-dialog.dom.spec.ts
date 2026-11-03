import { ComponentFixture, TestBed } from '@angular/core/testing'
import { provideNoopAnimations } from '@angular/platform-browser/animations'
import { of, throwError } from 'rxjs'
import { HttpErrorResponse } from '@angular/common/http'
import { AbbinamentoScaricoDialogComponent } from './abbinamento-scarico-dialog.component'
import { AbbinamentiService } from './abbinamenti.service'
import { ToastService } from '../../core/services/toast.service'
import { carico, proposta, scarico } from './abbinamenti.fixture.spec'

describe('AbbinamentoScaricoDialogComponent (DOM)', () => {
  let fixture: ComponentFixture<AbbinamentoScaricoDialogComponent>
  let comp: AbbinamentoScaricoDialogComponent
  let servizio: jasmine.SpyObj<AbbinamentiService>
  let chiusure: boolean[]
  const s = scarico({ stato: 'NON_ABBINATO', abbinato: 0, righe: [] })

  const q = <T extends HTMLElement>(sel: string): T | null =>
    document.body.querySelector(sel) as T | null
  const aspetta = async (): Promise<void> => {
    fixture.detectChanges()
    await fixture.whenStable()
    await new Promise(r => setTimeout(r, 20))
    fixture.detectChanges()
  }
  const clic = async (testid: string): Promise<void> => {
    const el =
      q<HTMLElement>(`[data-testid="${testid}"] button`) ??
      q<HTMLElement>(`[data-testid="${testid}"]`)
    expect(el).withContext(testid).not.toBeNull()
    el!.click()
    await aspetta()
  }
  const digita = (id: string, valore: string): void => {
    const input = q<HTMLInputElement>(`#${id}`)!
    input.focus()
    input.value = valore
    input.dispatchEvent(new Event('input', { bubbles: true }))
    input.dispatchEvent(new Event('blur'))
    fixture.detectChanges()
  }

  async function apri(p = proposta()): Promise<void> {
    servizio = jasmine.createSpyObj<AbbinamentiService>('AbbinamentiService', ['proposta', 'salva'])
    servizio.proposta.and.returnValue(of(p))
    await TestBed.configureTestingModule({
      imports: [AbbinamentoScaricoDialogComponent],
      providers: [
        provideNoopAnimations(),
        { provide: AbbinamentiService, useValue: servizio },
        {
          provide: ToastService,
          useValue: jasmine.createSpyObj('ToastService', ['success', 'error', 'warn']),
        },
      ],
    }).compileComponents()
    fixture = TestBed.createComponent(AbbinamentoScaricoDialogComponent)
    comp = fixture.componentInstance
    chiusure = []
    comp.visibleChange.subscribe(v => chiusure.push(v))
    fixture.componentRef.setInput('scarico', s)
    fixture.componentRef.setInput('unita', 'kg')
    fixture.componentRef.setInput('visible', true)
    await aspetta()
  }
  afterEach(async () => {
    // chiude il dialog prima: la sua animazione di uscita non deve girare a injector distrutto
    fixture?.componentRef.setInput('visible', false)
    fixture?.detectChanges()
    await fixture?.whenStable()
    await new Promise(r => setTimeout(r, 30))
    fixture?.destroy()
  })

  it('e un dialog con titolo, una riga per candidato, etichette collegate e focus sul primo campo', async () => {
    await apri()
    expect(q('[role="dialog"]')).not.toBeNull()
    expect(q('.p-dialog-title')?.textContent).toContain('Abbinamenti dello scarico n. 3/2026')
    expect(servizio.proposta).toHaveBeenCalledWith('s1')
    const input = q<HTMLInputElement>('#ab-q-0')!
    expect(q('label[for="ab-q-0"]')?.textContent).toContain('residuo 1.000')
    expect(q('label[for="ab-q-1"]')?.textContent).toContain('residuo 250')
    expect(input.getAttribute('aria-labelledby')).toBe('ab-q-lbl-0 ab-ed-aiuto')
    expect(document.activeElement).toBe(input)
  })

  it('digitazione con la virgola italiana, totale, salvataggio ed evento', async () => {
    await apri()
    digita('ab-q-0', '12,5')
    expect(q('[data-testid="totale"]')?.textContent).toContain('12,5')
    const esito = { scarico: s, avvisi: ['x'] }
    servizio.salva.and.returnValue(of(esito))
    const salvati: unknown[] = []
    comp.salvato.subscribe(e => salvati.push(e))
    await clic('salva-modifica')
    expect(servizio.salva).toHaveBeenCalledWith('s1', [{ caricoId: 'c1', quantita: 12.5 }])
    expect(salvati).toEqual([esito])
    expect(chiusure).toEqual([false])
  })

  it('regola unica: il punto e rifiutato con il messaggio, "1000" vale 1000 e "0,125" tiene 3 decimali', async () => {
    await apri()
    const input = q<HTMLInputElement>('#ab-q-0')!
    input.focus()
    const punto = new KeyboardEvent('keydown', {
      key: '.',
      code: 'Period',
      bubbles: true,
      cancelable: true,
    })
    input.dispatchEvent(punto)
    fixture.detectChanges()
    expect(punto.defaultPrevented).toBeTrue()
    expect(q('[data-testid="numero-errore"]')?.textContent).toBe('Usa la virgola per i decimali')
    digita('ab-q-0', '0,125')
    expect(q('[data-testid="totale"]')?.textContent).toContain('0,125')
    digita('ab-q-0', '1000')
    expect(q<HTMLInputElement>('#ab-q-0')!.value).toBe('1000')
  })

  it('Usa la proposta FIFO ripristina le quantita', async () => {
    await apri()
    digita('ab-q-0', '7')
    await clic('usa-proposta')
    expect(q<HTMLInputElement>('#ab-q-0')!.value).toBe('400')
  })

  it('un carico di classe diversa da quella attesa ha l etichetta "classe diversa"', async () => {
    await apri(
      proposta({
        candidati: [
          carico({ id: 'c1', numero: '1/2026', classe: 'R13', residuo: 1000 }),
          carico({ id: 'c2', numero: '2/2026', classe: 'D15', residuo: 250 }),
        ],
      })
    )
    expect(q('[data-testid="classe-diversa-0"]')).toBeNull()
    expect(q('[data-testid="classe-diversa-1"]')?.textContent).toContain('classe diversa')
    expect(q('label[for="ab-q-1"]')?.textContent).toContain('classe diversa')
    expect(q('label[for="ab-q-0"]')?.textContent).not.toContain('classe diversa')
  })

  it('Salva e disabilitato se il totale supera lo scarico, con messaggio', async () => {
    await apri()
    digita('ab-q-0', '500')
    expect(q('[data-testid="supera-scarico"]')?.textContent).toContain('supera la quantità')
    expect(q<HTMLButtonElement>('[data-testid="salva-modifica"] button')?.disabled).toBeTrue()
  })

  it('un 400 mostra il messaggio del backend cosi com e e il dialog resta aperto', async () => {
    await apri()
    servizio.salva.and.returnValue(
      throwError(
        () =>
          new HttpErrorResponse({
            status: 400,
            error: { message: 'Il carico n. 1/2026 ha un residuo di 100: non basta per 400.' },
          })
      )
    )
    digita('ab-q-0', '400')
    await clic('salva-modifica')
    expect(q('[data-testid="errore-modifica"]')?.textContent).toContain(
      'Il carico n. 1/2026 ha un residuo di 100: non basta per 400.'
    )
    expect(chiusure).toEqual([])
  })

  it('Scollega chiede conferma con focus sul Si e poi manda l elenco vuoto', async () => {
    await apri()
    servizio.salva.and.returnValue(of({ scarico: s, avvisi: [] }))
    await clic('scollega')
    expect(servizio.salva).not.toHaveBeenCalled()
    expect(q('[data-testid="conferma-scollega"]')?.textContent).toContain('lo riabbina con il FIFO')
    expect(document.activeElement).toBe(q('[data-testid="scollega-conferma"] button'))
    await clic('scollega-conferma')
    expect(servizio.salva).toHaveBeenCalledWith('s1', [])
  })

  it('Scollega: No riporta il focus sul pulsante; Esc annulla la conferma ma NON chiude il dialog', async () => {
    await apri()
    await clic('scollega')
    await clic('scollega-annulla')
    expect(q('[data-testid="conferma-scollega"]')).toBeNull()
    expect(document.activeElement).toBe(q('[data-testid="scollega"] button'))
    await clic('scollega')
    document.activeElement!.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })
    )
    await aspetta()
    expect(q('[data-testid="conferma-scollega"]')).toBeNull()
    expect(servizio.salva).not.toHaveBeenCalled()
    expect(chiusure).toEqual([])
  })

  it('Esc, X e Annulla chiudono il dialog', async () => {
    await apri()
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    await aspetta()
    expect(chiusure).toEqual([false])
    await clic('annulla-modifica')
    expect(chiusure).toEqual([false, false])
    expect(q('.p-dialog-header-close')?.getAttribute('aria-label')).toBe(
      'Chiudi la finestra degli abbinamenti'
    )
  })

  it('durante il salvataggio non si puo chiudere', async () => {
    await apri()
    comp.inElaborazione.set(true)
    await aspetta()
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    await aspetta()
    expect(chiusure).toEqual([])
  })
})
