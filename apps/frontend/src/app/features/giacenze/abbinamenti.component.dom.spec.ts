import { ComponentFixture, TestBed } from '@angular/core/testing'
import { provideNoopAnimations } from '@angular/platform-browser/animations'
import { of, throwError, timer } from 'rxjs'
import { map } from 'rxjs/operators'
import { AbbinamentiComponent } from './abbinamenti.component'
import { AbbinamentiService } from './abbinamenti.service'
import { RegistroService } from '../registro/registro.service'
import { ToastService } from '../../core/services/toast.service'
import { ambito, carico, proposta, scarico, sede, vista } from './abbinamenti.fixture.spec'

describe('AbbinamentiComponent (DOM)', () => {
  let fixture: ComponentFixture<AbbinamentiComponent>
  let servizio: jasmine.SpyObj<AbbinamentiService>

  const q = <T extends HTMLElement>(sel: string): T | null =>
    fixture.nativeElement.querySelector(sel) as T | null
  const testo = (): string => (fixture.nativeElement as HTMLElement).textContent ?? ''
  const clic = async (testid: string): Promise<void> => {
    const el =
      q<HTMLElement>(`[data-testid="${testid}"] button`) ??
      q<HTMLElement>(`[data-testid="${testid}"]`)
    expect(el).withContext(testid).not.toBeNull()
    el!.click()
    fixture.detectChanges()
    await fixture.whenStable()
    fixture.detectChanges()
  }

  async function setup(v = vista(), registri = [sede('r1', 'Sede unica', true)]): Promise<void> {
    servizio = jasmine.createSpyObj<AbbinamentiService>('AbbinamentiService', [
      'vista',
      'differenze',
      'proposta',
      'salva',
      'ricalcola',
    ])
    servizio.vista.and.returnValue(of(v))
    servizio.differenze.and.returnValue(
      of([
        {
          scarico: { id: 's1', numero: '3/2026' },
          carico: { tipo: 'MOVIMENTO', id: 'c2', numero: '2/2026', giorno: '2026-03-10' },
          persistita: 60,
          fifo: 0,
        },
      ])
    )
    servizio.proposta.and.returnValue(of(proposta()))
    servizio.ricalcola.and.returnValue(
      of({
        scarichiAbbinati: 1,
        righeScritte: 1,
        righeCancellate: 0,
        avvisi: ['1 scarico non è coperto del tutto.'],
      })
    )
    const reg = jasmine.createSpyObj<RegistroService>('RegistroService', ['listRegistri'])
    reg.listRegistri.and.returnValue(of(registri))
    await TestBed.configureTestingModule({
      imports: [AbbinamentiComponent],
      providers: [
        provideNoopAnimations(),
        { provide: AbbinamentiService, useValue: servizio },
        { provide: RegistroService, useValue: reg },
        {
          provide: ToastService,
          useValue: jasmine.createSpyObj('ToastService', ['success', 'error', 'warn']),
        },
      ],
    }).compileComponents()
    fixture = TestBed.createComponent(AbbinamentiComponent)
    document.body.appendChild(fixture.nativeElement)
    fixture.detectChanges()
    await fixture.whenStable()
    fixture.detectChanges()
  }
  afterEach(() => fixture?.nativeElement.remove())

  it('pannello per ambito con titolo, tabelle e riga dello scarico col suo tag', async () => {
    await setup()
    expect(q('[data-testid="ambito-15 01 01"] h2')?.textContent).toContain('CER 15 01 01 · R13')
    expect(q('[data-testid="tabella-carichi-15 01 01"]')).not.toBeNull()
    expect(q('[data-testid="tabella-scarichi-15 01 01"]')).not.toBeNull()
    expect(q('[data-testid="scarico-3/2026"]')).not.toBeNull()
    expect(q('[data-testid="stato-3/2026"]')?.textContent).toContain('Abbinato')
    // numeri e date in italiano, nessun id in pagina
    expect(testo()).toContain('1.000')
    expect(testo()).toContain('20/03/2026')
    expect(testo()).not.toContain('s1')
  })

  it('un solo bottone primario («Abbina con FIFO»); gli altri sono a contorno', async () => {
    await setup()
    const primari = fixture.nativeElement.querySelectorAll('.wf-primario')
    expect(primari.length).toBe(1)
    expect(primari[0].textContent).toContain('Abbina con FIFO')
  })

  it('nessun ambito: testo previsto', async () => {
    await setup(vista({ ambiti: [] }))
    expect(q('[data-testid="nessun-ambito"]')?.textContent).toContain(
      'Nessun rifiuto in stoccaggio R13/D15 in questo registro. Compaiono qui i carichi con operazione R13 o D15.'
    )
  })

  it('filtro "solo da completare" nasconde gli scarichi abbinati', async () => {
    await setup(
      vista({
        ambiti: [
          ambito({
            carichi: [
              carico({ id: 'c1', numero: '1/2026', stato: 'ESAURITO' }),
              carico({ id: 'c2', numero: '2/2026', stato: 'APERTO' }),
            ],
            scarichi: [scarico(), scarico({ id: 's2', numero: '4/2026', stato: 'PARZIALE' })],
          }),
        ],
      })
    )
    expect(q('[data-testid="scarico-3/2026"]')).not.toBeNull()
    expect(q('[data-testid="carico-1/2026"]')).not.toBeNull()
    expect(q('[data-testid="carico-2/2026"]')).not.toBeNull()
    expect(q('#ab-filtro-aiuto')?.textContent).toContain(
      'Nasconde scarichi abbinati e carichi esauriti'
    )
    expect(q('#ab-solo-da-completare')?.getAttribute('aria-describedby')).toBe('ab-filtro-aiuto')
    await clic('solo-da-completare')
    expect(q('[data-testid="carico-1/2026"]')).toBeNull()
    expect(q('[data-testid="carico-2/2026"]')).not.toBeNull()
    expect(q('[data-testid="scarico-3/2026"]')).toBeNull()
    expect(q('[data-testid="scarico-4/2026"]')).not.toBeNull()
  })

  it('pulsanti secondo i permessi', async () => {
    await setup(vista({ puoModificare: true, puoRicalcolare: false }))
    expect(q('[data-testid="abbina-non-abbinati"]')).not.toBeNull()
    expect(q('[data-testid="ricalcola-automatici"]')).toBeNull()
    fixture.destroy()
    TestBed.resetTestingModule()
    await setup(vista({ puoModificare: false, puoRicalcolare: false }))
    expect(q('[data-testid="abbina-non-abbinati"]')).toBeNull()
    expect(q('[data-testid="modifica-3/2026"]')).toBeNull()
  })

  it('Abbina con FIFO: chiama il ricalcolo e mostra l avviso in un messaggio', async () => {
    await setup()
    await clic('abbina-non-abbinati')
    expect(servizio.ricalcola).toHaveBeenCalledWith({ registroId: 'r1', modalita: 'NON_ABBINATI' })
    expect(q('[data-testid="avviso"]')?.textContent).toContain('1 scarico non è coperto del tutto.')
  })

  it('Ricalcola gli automatici: conferma con il testo previsto e focus sul Sì', async () => {
    await setup()
    await clic('ricalcola-automatici')
    expect(q('[data-testid="conferma-ricalcolo"]')?.textContent).toContain(
      'Le righe automatiche di questo registro vengono ricalcolate con FIFO; quelle inserite a mano restano.'
    )
    expect(servizio.ricalcola).not.toHaveBeenCalled()
    await new Promise(r => setTimeout(r))
    expect(document.activeElement).toBe(q('[data-testid="ricalcola-conferma"] button'))
    await clic('ricalcola-conferma')
    expect(servizio.ricalcola).toHaveBeenCalledWith({ registroId: 'r1', modalita: 'AUTOMATICI' })
    expect(q('[data-testid="conferma-ricalcolo"]')).toBeNull()
  })

  it('differenze: sezione espandibile con il conteggio', async () => {
    await setup()
    const toggle = q<HTMLButtonElement>('[data-testid="differenze-toggle"]')!
    expect(toggle.textContent).toContain('Differenze dal FIFO (1)')
    expect(toggle.getAttribute('aria-expanded')).toBe('false')
    expect(q('[data-testid="differenze"]')).toBeNull()
    await clic('differenze-toggle')
    expect(toggle.getAttribute('aria-expanded')).toBe('true')
    expect(q('[data-testid="differenze"]')?.textContent).toContain(
      'scarico diverso dal FIFO da capo'
    )
  })

  it('Modifica apre il dialog dello scarico; salvando mostra l avviso, ricarica e riporta il focus', async () => {
    await setup()
    fixture.autoDetectChanges(true) // come in app: la vista si ridisegna da sola dopo la risposta
    await clic('modifica-3/2026')
    await new Promise(r => setTimeout(r, 20))
    fixture.detectChanges()
    expect(servizio.proposta).toHaveBeenCalledWith('s1')
    expect(document.body.querySelector('[role="dialog"]')?.textContent).toContain(
      'Abbinamenti dello scarico n. 3/2026'
    )
    servizio.salva.and.returnValue(
      of({
        scarico: scarico(),
        avvisi: [
          'Lo scarico è senza abbinamento: il prossimo ricalcolo lo riabbinerà con il FIFO.',
        ],
      })
    )
    servizio.vista.calls.reset()
    // ricarica asincrona: le tabelle spariscono e tornano, il focus deve seguirle
    servizio.vista.and.returnValue(timer(30).pipe(map(() => vista())))
    document.querySelector<HTMLElement>('[data-testid="scollega"] button')!.click()
    fixture.detectChanges()
    document.querySelector<HTMLElement>('[data-testid="scollega-conferma"] button')!.click()
    fixture.detectChanges()
    await fixture.whenStable()
    fixture.detectChanges()
    expect(servizio.salva).toHaveBeenCalledWith('s1', [])
    expect(servizio.vista).toHaveBeenCalledTimes(1)
    expect(q('[data-testid="avviso"]')?.textContent).toContain('lo riabbinerà con il FIFO')
    expect(document.body.querySelector('[role="dialog"]')).toBeNull()
    // la risposta asincrona ricrea le tabelle: il focus deve finire sul nuovo pulsante
    await new Promise(r => setTimeout(r, 50))
    fixture.detectChanges()
    await new Promise(r => setTimeout(r))
    expect(document.activeElement).toBe(q('[data-testid="modifica-3/2026"] button'))
  })

  it('chiudere il dialog con Esc riporta il focus sul pulsante Modifica', async () => {
    await setup()
    await clic('modifica-3/2026')
    await new Promise(r => setTimeout(r, 20))
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    fixture.detectChanges()
    await fixture.whenStable()
    await new Promise(r => setTimeout(r, 20))
    fixture.detectChanges()
    expect(document.body.querySelector('[role="dialog"]')).toBeNull()
    expect(document.activeElement).toBe(q('[data-testid="modifica-3/2026"] button'))
  })

  it('Ricalcola: No e Esc annullano e riportano il focus sul pulsante', async () => {
    await setup()
    await clic('ricalcola-automatici')
    await clic('ricalcola-annulla')
    await new Promise(r => setTimeout(r))
    expect(document.activeElement).toBe(q('[data-testid="ricalcola-automatici"] button'))
    await clic('ricalcola-automatici')
    q('[data-testid="conferma-ricalcolo"]')!.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })
    )
    fixture.detectChanges()
    expect(q('[data-testid="conferma-ricalcolo"]')).toBeNull()
    expect(servizio.ricalcola).not.toHaveBeenCalled()
  })

  it('differenze non disponibili: testo onesto, non "nessuna differenza"', async () => {
    await setup()
    servizio.differenze.and.returnValue(throwError(() => new Error('rete')))
    await clic('aggiorna')
    await clic('differenze-toggle')
    expect(q('[data-testid="differenze-non-disponibili"]')?.textContent).toContain(
      'Differenze non disponibili, riprova'
    )
    expect(testo()).not.toContain('Nessuna differenza')
  })

  it('zero registri: messaggio in italiano', async () => {
    await setup(vista(), [])
    expect(q('[data-testid="nessun-registro"]')?.textContent).toContain(
      'Nessun registro disponibile'
    )
  })

  it('carico con la sola giacenza iniziale: etichetta senza numero', async () => {
    await setup(
      vista({
        ambiti: [ambito({ carichi: [carico({ tipo: 'APERTURA', id: 'g1', numero: null })] })],
      })
    )
    expect(testo()).toContain('Giacenza iniziale')
  })
})
