import { ComponentFixture, TestBed } from '@angular/core/testing'
import { NoopAnimationsModule } from '@angular/platform-browser/animations'
import { of } from 'rxjs'
import { MessageService } from 'primeng/api'
import { AnagraficaFormDialogComponent, TipoAnagrafica } from './anagrafica-form-dialog.component'
import { RegistryService } from './registry.service'
import { Ditta, Produttore, Trasportatore } from '../../shared/models/registry.model'

const PIVA_VALIDA = '12345678903'
const PIVA_ERRATA = '12345678901'
const PIVA_NUOVA = '09876543217'
const CF_PERSONA = 'RSSMRA80A01H501U'

const DITTA: Ditta = {
  id: 'd1',
  ragioneSociale: 'ACME S.r.l.',
  partitaIva: PIVA_VALIDA,
  codiceFiscale: null,
  partitaIvaDaVerificare: false,
  privato: false,
  sedi: [
    {
      id: 's1',
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
      principale: true,
      attiva: true,
    },
    {
      id: 's2',
      denominazione: 'Milano',
      via: 'Via Milano',
      civico: '9',
      cap: '20100',
      citta: 'Milano',
      provincia: 'MI',
      referente: null,
      email: null,
      telefono: null,
      pec: null,
      principale: false,
      attiva: true,
    },
  ],
  ruoli: {},
}

const PRODUTTORE: Produttore = {
  id: 'p1',
  ragioneSociale: 'Verdi S.r.l.',
  partitaIVA: PIVA_ERRATA,
  codiceFiscale: null,
  partitaIvaDaVerificare: true,
  sedeLegale: { via: 'Via Po', civico: '2', cap: '10100', comune: 'Torino', provincia: 'TO' },
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
}

describe('AnagraficaFormDialogComponent — codice fiscale, ditta già presente, sedi', () => {
  let fixture: ComponentFixture<AnagraficaFormDialogComponent>
  let component: AnagraficaFormDialogComponent
  let registry: jasmine.SpyObj<RegistryService>
  let toast: MessageService

  const doc = document.body
  const q = <T extends HTMLElement>(sel: string) => doc.querySelector(sel) as T | null

  async function apri(
    tipo: TipoAnagrafica,
    modalita: 'create' | 'edit' = 'create',
    entity: unknown = null
  ) {
    fixture.componentRef.setInput('tipo', tipo)
    fixture.componentRef.setInput('modalita', modalita)
    fixture.componentRef.setInput('entityData', entity)
    fixture.componentRef.setInput('visible', true)
    fixture.detectChanges()
    // NgModel scrive il valore iniziale in un microtask: va atteso prima di digitare
    await fixture.whenStable()
    fixture.detectChanges()
  }
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
  function compilaIndirizzo(p: string): void {
    scrivi(`${p}-via`, 'Via Nuova')
    scrivi(`${p}-civico`, '5')
    scrivi(`${p}-cap`, '40100')
    scrivi(`${p}-comune`, 'Bologna')
    scrivi(`${p}-prov`, 'BO')
  }
  function salva(): void {
    const bottone = Array.from(doc.querySelectorAll<HTMLButtonElement>('p-button button')).find(b =>
      b.textContent?.includes('Salva')
    )!
    bottone.click()
    fixture.detectChanges()
  }

  beforeEach(async () => {
    registry = jasmine.createSpyObj<RegistryService>('RegistryService', [
      'cercaDitta',
      'createProduttore',
      'createTrasportatore',
      'createDestinatario',
      'updateProduttore',
      'updateTrasportatore',
      'updateDestinatario',
    ])
    registry.cercaDitta.and.returnValue(of({ ditta: null }))
    registry.createProduttore.and.returnValue(of({ id: 'nuovo' } as Produttore))
    registry.updateProduttore.and.returnValue(of(PRODUTTORE))
    registry.createTrasportatore.and.returnValue(of({ id: 'nuovo' } as Trasportatore))

    await TestBed.configureTestingModule({
      imports: [AnagraficaFormDialogComponent, NoopAnimationsModule],
      providers: [{ provide: RegistryService, useValue: registry }, MessageService],
    }).compileComponents()
    fixture = TestBed.createComponent(AnagraficaFormDialogComponent)
    component = fixture.componentInstance
    toast = TestBed.inject(MessageService)
    spyOn(toast, 'add').and.callThrough()
  })

  afterEach(() => {
    fixture.destroy()
    doc.querySelectorAll('.p-dialog-mask').forEach(e => e.remove())
  })

  it('onSedeScelta precompila anche la PEC della sede scelta e "Nuova sede" la svuota', async () => {
    await apri('produttore')
    component.onSedeScelta({
      id: 's1',
      denominazione: null,
      via: 'Via Po',
      civico: '3',
      cap: '10100',
      citta: 'Torino',
      provincia: 'TO',
      referente: null,
      email: null,
      telefono: null,
      pec: 'sede@pec.it',
      principale: true,
      attiva: true,
    })
    expect(component.form.via).toBe('Via Po')
    expect(component.form.pec).toBe('sede@pec.it')
    component.onSedeScelta(null)
    expect(component.form.pec).toBe('')
  })

  it('mostra "Codice fiscale" (max 16) accanto alla P.IVA, che non è più obbligatoria', async () => {
    await apri('produttore')
    expect(q('label[for="ana-produttore-cf"]')!.textContent).toContain('Codice fiscale')
    expect(q<HTMLInputElement>('#ana-produttore-cf')!.maxLength).toBe(16)
    expect(q('label[for="ana-produttore-piva"] .req')).toBeNull()
  })

  it('senza né P.IVA né codice fiscale: "Indica la partita IVA o il codice fiscale." e nessuna chiamata', async () => {
    await apri('produttore')
    scrivi('ana-produttore-ragione', 'Rossi')
    compilaIndirizzo('ana-produttore')
    salva()
    const err = q('#ana-produttore-id-err')!
    expect(err.textContent).toContain('Indica la partita IVA o il codice fiscale.')
    expect(err.getAttribute('role')).toBe('alert')
    expect(registry.createProduttore).not.toHaveBeenCalled()
    expect(q('#ana-produttore-piva')!.getAttribute('aria-invalid')).toBe('true')
  })

  it('un privato (solo CF di 16 caratteri) è ammesso come produttore e invia il solo codice fiscale', async () => {
    await apri('produttore')
    scrivi('ana-produttore-ragione', 'Mario Rossi')
    scrivi('ana-produttore-cf', CF_PERSONA.toLowerCase())
    compilaIndirizzo('ana-produttore')
    salva()
    expect(registry.createProduttore).toHaveBeenCalledTimes(1)
    const inviato = registry.createProduttore.calls.mostRecent().args[0]
    expect(inviato.codiceFiscale).toBe(CF_PERSONA)
    expect(inviato.partitaIVA).toBeUndefined()
  })

  it('trasportatore con il solo CF di un privato: messaggio D2.5 e nessuna chiamata', async () => {
    await apri('trasportatore')
    scrivi('ana-trasportatore-ragione', 'Mario Rossi')
    scrivi('ana-trasportatore-cf', CF_PERSONA)
    scrivi('ana-trasportatore-iscrizione', 'MI/1')
    compilaIndirizzo('ana-trasportatore')
    salva()
    expect(q('#ana-trasportatore-cf-err')!.textContent).toContain(
      'Un privato senza partita IVA può essere solo produttore.'
    )
    expect(registry.createTrasportatore).not.toHaveBeenCalled()
  })

  it('P.IVA con checksum errato: errore sul campo senza riportarne il valore', async () => {
    await apri('produttore')
    scrivi('ana-produttore-ragione', 'Rossi')
    scrivi('ana-produttore-piva', PIVA_ERRATA)
    compilaIndirizzo('ana-produttore')
    salva()
    const msg = q('#ana-produttore-piva-err')!.textContent!
    expect(msg).toContain('Partita IVA non valida')
    expect(msg).not.toContain(PIVA_ERRATA)
    expect(registry.createProduttore).not.toHaveBeenCalled()
  })

  describe('ditta già presente', () => {
    beforeEach(async () => {
      registry.cercaDitta.and.returnValue(of({ ditta: DITTA }))
      await apri('produttore')
      scrivi('ana-produttore-ragione', 'Scritto a mano')
      esci(scrivi('ana-produttore-piva', PIVA_VALIDA))
    })

    it('avviso role="status", ragione sociale precompilata e bloccata, sede principale precompilata', () => {
      expect(q('[role="status"]')!.textContent).toContain('Ditta già presente')
      const ragione = q<HTMLInputElement>('#ana-produttore-ragione')!
      expect(ragione.value).toBe('ACME S.r.l.')
      expect(ragione.readOnly).toBeTrue()
      expect(q<HTMLInputElement>('#ana-produttore-via')!.value).toBe('Via Roma')
      expect(q<HTMLInputElement>('#ana-produttore-comune')!.value).toBe('Roma')
      expect(q<HTMLInputElement>('#ana-produttore-prov')!.value).toBe('RM')
    })

    it('scegliendo un\'altra sede si precompila quell\'indirizzo; "Nuova sede" svuota i campi', async () => {
      q<HTMLInputElement>('[data-testid="ana-produttore-sede-s2"]')!.click()
      fixture.detectChanges()
      await fixture.whenStable() // NgModel aggiorna il DOM in un microtask
      fixture.detectChanges()
      expect(q<HTMLInputElement>('#ana-produttore-via')!.value).toBe('Via Milano')
      expect(q<HTMLInputElement>('#ana-produttore-cap')!.value).toBe('20100')

      q<HTMLInputElement>('[data-testid="ana-produttore-sede-nuova"]')!.click()
      fixture.detectChanges()
      await fixture.whenStable()
      fixture.detectChanges()
      expect(q<HTMLInputElement>('#ana-produttore-via')!.value).toBe('')
      expect(q<HTMLInputElement>('#ana-produttore-comune')!.value).toBe('')
    })

    it('salva inviando indirizzo della sede scelta; gli avvisi del backend vanno in un toast info', () => {
      registry.createProduttore.and.returnValue(
        of({
          id: 'nuovo',
          avvisi: [
            'La ragione sociale registrata per questa ditta è «ACME S.r.l.»: è stata mantenuta.',
          ],
        } as Produttore)
      )
      salva()
      const inviato = registry.createProduttore.calls.mostRecent().args[0]
      expect(inviato.ragioneSociale).toBe('ACME S.r.l.')
      expect(inviato.partitaIVA).toBe(PIVA_VALIDA)
      expect(inviato.sedeLegale).toEqual({
        via: 'Via Roma',
        civico: '1',
        cap: '00100',
        comune: 'Roma',
        provincia: 'RM',
      })
      expect(toast.add).toHaveBeenCalledWith(
        jasmine.objectContaining({
          severity: 'info',
          detail: jasmine.stringContaining('è stata mantenuta'),
        })
      )
    })

    it('cambiando la P.IVA la ragione sociale torna modificabile', () => {
      scrivi('ana-produttore-piva', '1234567890')
      expect(q<HTMLInputElement>('#ana-produttore-ragione')!.readOnly).toBeFalse()
      expect(q('[role="status"]')).toBeNull()
    })
  })

  describe('modifica', () => {
    it('D2.8: la P.IVA da verificare è modificabile con avviso e, se sostituita, si invia', async () => {
      await apri('produttore', 'edit', PRODUTTORE)
      expect(q<HTMLInputElement>('#ana-produttore-piva')!.disabled).toBeFalse()
      expect(q('[data-testid="ana-produttore-piva-da-verificare"]')).toBeTruthy()

      scrivi('ana-produttore-piva', PIVA_NUOVA)
      salva()
      const args = registry.updateProduttore.calls.mostRecent().args
      expect(args[0]).toBe('p1')
      expect(args[1].partitaIVA).toBe(PIVA_NUOVA)
      expect(registry.cercaDitta).not.toHaveBeenCalled()
    })

    it("P.IVA da verificare lasciata com'è: non si invia né si ri-valida", async () => {
      await apri('produttore', 'edit', PRODUTTORE)
      salva()
      const inviato = registry.updateProduttore.calls.mostRecent().args[1]
      expect('partitaIVA' in inviato).toBeFalse()
      expect('codiceFiscale' in inviato).toBeFalse()
    })

    it('P.IVA valida impostata: non modificabile; il codice fiscale mancante si aggiunge', async () => {
      await apri('produttore', 'edit', {
        ...PRODUTTORE,
        partitaIVA: PIVA_VALIDA,
        partitaIvaDaVerificare: false,
      })
      await fixture.whenStable()
      fixture.detectChanges()
      expect(q<HTMLInputElement>('#ana-produttore-piva')!.disabled).toBeTrue()
      scrivi('ana-produttore-cf', CF_PERSONA)
      salva()
      const inviato = registry.updateProduttore.calls.mostRecent().args[1]
      expect(inviato.codiceFiscale).toBe(CF_PERSONA)
      expect('partitaIVA' in inviato).toBeFalse()
    })

    it('Esc chiude il dialog', async () => {
      await apri('produttore')
      const chiusure: boolean[] = []
      component.visibleChange.subscribe(v => chiusure.push(v))
      doc.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
      fixture.detectChanges()
      expect(chiusure).toContain(false)
    })
  })
})
