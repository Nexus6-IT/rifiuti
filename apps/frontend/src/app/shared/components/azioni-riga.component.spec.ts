import { Component } from '@angular/core'
import { DialogModule } from 'primeng/dialog'
import { ComponentFixture, TestBed } from '@angular/core/testing'
import { provideNoopAnimations } from '@angular/platform-browser/animations'
import { AzioneRiga, AzioniRigaComponent } from './azioni-riga.component'

@Component({
  standalone: true,
  imports: [AzioniRigaComponent],
  template: `<app-azioni-riga [principale]="principale" [altre]="altre" [nome]="nome" />`,
})
class OspiteComponent {
  principale: AzioneRiga | null = null
  altre: AzioneRiga[] = []
  nome = 'Rossi S.r.l.'
}

const tutti = (sel: string): HTMLElement[] =>
  Array.from(document.body.querySelectorAll<HTMLElement>(sel))

describe('AzioniRigaComponent (DOM)', () => {
  let fixture: ComponentFixture<OspiteComponent>
  let ospite: OspiteComponent
  let modifica: jasmine.Spy
  let duplica: jasmine.Spy
  let elimina: jasmine.Spy
  let bloccata: jasmine.Spy

  const kebab = (): HTMLButtonElement | null =>
    fixture.nativeElement.querySelector('button[aria-haspopup="menu"]')
  const principale = (): HTMLButtonElement | null =>
    fixture.nativeElement.querySelector('[data-testid="azione-principale"]')
  const voci = (): HTMLElement[] => tutti('[role="menuitem"]')
  /** Lascia finire le animazioni di PrimeNG (onShow/onHide arrivano a transizione conclusa). */
  const assesta = async (): Promise<void> => {
    fixture.detectChanges()
    await fixture.whenStable()
    fixture.detectChanges()
  }
  const apri = async (): Promise<void> => {
    kebab()?.click()
    await assesta()
  }

  beforeEach(async () => {
    modifica = jasmine.createSpy('modifica')
    duplica = jasmine.createSpy('duplica')
    elimina = jasmine.createSpy('elimina')
    bloccata = jasmine.createSpy('bloccata')
    await TestBed.configureTestingModule({
      imports: [OspiteComponent],
      providers: [provideNoopAnimations()],
    }).compileComponents()
    fixture = TestBed.createComponent(OspiteComponent)
    ospite = fixture.componentInstance
    ospite.principale = { etichetta: 'Modifica', icona: 'pi pi-pencil', esegui: modifica }
    ospite.altre = [
      { etichetta: 'Elimina', pericolosa: true, esegui: elimina },
      { etichetta: 'Duplica', esegui: duplica },
    ]
    fixture.detectChanges()
  })

  afterEach(() => {
    fixture.destroy()
    // il menu e' appeso al body: se il test lo ha lasciato aperto va tolto a mano
    tutti('.p-menu-overlay').forEach(e => e.remove())
  })

  it("rende un bottone con il nome completo e un ⋯ con l'aria-label delle altre azioni", () => {
    expect(principale()?.getAttribute('aria-label')).toBe('Modifica Rossi S.r.l.')
    expect(kebab()?.getAttribute('aria-label')).toBe('Altre azioni per Rossi S.r.l.')
    expect(kebab()?.querySelector('.pi-ellipsis-h')).not.toBeNull()
  })

  it("non ripete il nome se l'etichetta lo contiene gia'", () => {
    ospite.principale = { etichetta: 'Modifica il cliente Rossi S.r.l.', esegui: modifica }
    fixture.detectChanges()
    expect(principale()?.getAttribute('aria-label')).toBe('Modifica il cliente Rossi S.r.l.')
  })

  it("il clic sul bottone principale esegue l'azione", () => {
    principale()?.click()
    expect(modifica).toHaveBeenCalledTimes(1)
  })

  it('il clic sul ⋯ apre le voci con role=menuitem, la pericolosa per ultima', async () => {
    expect(voci().length).toBe(0)
    await apri()
    expect(voci().map(v => v.textContent?.trim())).toEqual(['Duplica', 'Elimina'])
    expect(kebab()?.getAttribute('aria-expanded')).toBe('true')
  })

  it('separa le pericolose con un filetto', async () => {
    await apri()
    expect(tutti('.p-menu-overlay li[role="separator"]').length).toBe(1)
  })

  it('il clic su una voce esegue la sua azione, chiude il menu e riporta il focus sul ⋯', async () => {
    await apri()
    voci()[0].querySelector<HTMLElement>('a')?.click()
    await assesta()
    expect(duplica).toHaveBeenCalledTimes(1)
    expect(elimina).not.toHaveBeenCalled()
    expect(voci().length).toBe(0)
    expect(document.activeElement).toBe(kebab())
    expect(kebab()?.getAttribute('aria-expanded')).toBe('false')
  })

  it('Invio sul ⋯ apre il menu e Esc lo chiude riportando il focus sul ⋯', async () => {
    const k = kebab() as HTMLButtonElement
    k.focus()
    // Invio su un <button> nativo produce un clic: e' quello che il browser fa davvero
    k.click()
    await assesta()
    expect(voci().length).toBe(2)
    const lista = document.body.querySelector<HTMLElement>('.p-menu-overlay ul')
    lista?.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true })
    )
    await assesta()
    expect(voci().length).toBe(0)
    expect(document.activeElement).toBe(k)
  })

  it('una voce disabilitata ha il motivo come title e non esegue nulla', async () => {
    ospite.altre = [
      {
        etichetta: 'Elimina',
        pericolosa: true,
        disabilitata: true,
        motivo: 'Ha dei FIR collegati',
        esegui: bloccata,
      },
    ]
    fixture.detectChanges()
    await apri()
    const voce = voci()[0]
    expect(voce.getAttribute('aria-disabled')).toBe('true')
    expect(voce.querySelector('a')?.getAttribute('title')).toBe('Ha dei FIR collegati')
    // il motivo e' testo visibile e fa parte del nome accessibile della voce
    expect(voce.textContent).toContain('Non disponibile: Ha dei FIR collegati')
    expect(voce.getAttribute('aria-label')).toContain('Ha dei FIR collegati')
    voce.querySelector<HTMLElement>('a')?.click()
    expect(bloccata).not.toHaveBeenCalled()
  })

  it('il bottone principale disabilitato ha il motivo nel nome accessibile', () => {
    ospite.principale = {
      etichetta: 'Modifica',
      disabilitata: true,
      motivo: 'Cliente bloccato',
      esegui: modifica,
    }
    fixture.detectChanges()
    expect(principale()?.getAttribute('aria-label')).toBe(
      'Modifica Rossi S.r.l., non disponibile: Cliente bloccato'
    )
  })

  it('senza nome il ⋯ si chiama «Altre azioni» (niente spazio finale)', () => {
    ospite.nome = ''
    fixture.detectChanges()
    expect(kebab()?.getAttribute('aria-label')).toBe('Altre azioni')
  })

  it('senza altre azioni non rende il ⋯', () => {
    ospite.altre = []
    fixture.detectChanges()
    expect(kebab()).toBeNull()
    expect(principale()).not.toBeNull()
  })

  it('senza principale e senza altre non rende nulla', () => {
    ospite.principale = null
    ospite.altre = []
    fixture.detectChanges()
    expect(fixture.nativeElement.querySelector('button')).toBeNull()
  })

  it("solo le altre azioni: il ⋯ c'e' e il bottone principale no", () => {
    ospite.principale = null
    fixture.detectChanges()
    expect(principale()).toBeNull()
    expect(kebab()).not.toBeNull()
  })
})

@Component({
  standalone: true,
  imports: [AzioniRigaComponent, DialogModule],
  template: `
    <p-dialog [(visible)]="visibile" [modal]="true" header="Conti correnti">
      <app-azioni-riga [altre]="altre" nome="Conto 1" />
    </p-dialog>
  `,
})
class OspiteDialogComponent {
  visibile = true
  altre: AzioneRiga[] = [{ etichetta: 'Duplica', esegui: () => undefined }]
}

describe('AzioniRigaComponent dentro un p-dialog', () => {
  it('Esc chiude solo il menu: il dialog resta aperto e il focus torna sul ⋯', async () => {
    await TestBed.configureTestingModule({
      imports: [OspiteDialogComponent],
      providers: [provideNoopAnimations()],
    }).compileComponents()
    const fixture = TestBed.createComponent(OspiteDialogComponent)
    const assesta = async (): Promise<void> => {
      fixture.detectChanges()
      await fixture.whenStable()
      fixture.detectChanges()
    }
    await assesta()
    const kebab = document.body.querySelector<HTMLButtonElement>('button[aria-haspopup="menu"]')
    expect(kebab).not.toBeNull()
    kebab?.click()
    await assesta()
    expect(document.body.querySelectorAll('[role="menuitem"]').length).toBe(1)
    document.body
      .querySelector('.p-menu-overlay ul')
      ?.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true })
      )
    await assesta()
    expect(document.body.querySelectorAll('[role="menuitem"]').length).toBe(0)
    expect(fixture.componentInstance.visibile).toBeTrue()
    expect(document.activeElement).toBe(kebab)
    fixture.destroy()
    document.body.querySelectorAll('.p-menu-overlay, .p-dialog-mask').forEach(e => e.remove())
  })
})
