import { ComponentFixture, TestBed, fakeAsync, flush, tick } from '@angular/core/testing'
import { provideNoopAnimations } from '@angular/platform-browser/animations'
import { of, throwError } from 'rxjs'
import { SoglieDepositoDialogComponent } from './soglie-deposito-dialog.component'
import { GiacenzeComponent } from './giacenze.component'
import {
  ConfigurazioneSoglie,
  DepositoTemporaneoVista,
  GiacenzeService,
  SoglieConfigurate,
  SoglieDeposito,
} from './giacenze.service'
import { RegistroService } from '../registro/registro.service'
import { ToastService } from '../../core/services/toast.service'

const predefinite: SoglieDeposito = {
  criterio: 'NON_SCELTO',
  giorniMax: null,
  kgMaxTotale: 30000,
  kgMaxPericolosi: 10000,
  preavvisoGiorni: 15,
  preavvisoPercentuale: 80,
}

function configurazione(p: Partial<ConfigurazioneSoglie> = {}): ConfigurazioneSoglie {
  return {
    puoImpostare: true,
    predefinite,
    azienda: null,
    registri: [
      { registroId: 'r1', registroDescrizione: 'Milano', attivo: true, soglie: null },
      { registroId: 'r2', registroDescrizione: 'Torino', attivo: true, soglie: null },
    ],
    ...p,
  }
}

const riga = (p: Partial<SoglieConfigurate> = {}): SoglieConfigurate => ({
  ...predefinite,
  note: null,
  aggiornatoIl: '2026-10-30T10:00:00.000Z',
  ...p,
})

const q = (testid: string): HTMLElement | null =>
  document.body.querySelector(`[data-testid="${testid}"]`)

const clic = (testid: string): void => {
  const b = document.body.querySelector<HTMLElement>(`[data-testid="${testid}"] button`)
  expect(b).withContext(`pulsante ${testid}`).not.toBeNull()
  b!.click()
}

describe('SoglieDepositoDialogComponent (DOM)', () => {
  let service: jasmine.SpyObj<GiacenzeService>
  let toast: jasmine.SpyObj<ToastService>
  let fixture: ComponentFixture<SoglieDepositoDialogComponent>
  let c: SoglieDepositoDialogComponent
  let salvato: number

  function apri(conf: ConfigurazioneSoglie, registro: string | null = 'r1'): void {
    fixture = TestBed.createComponent(SoglieDepositoDialogComponent)
    c = fixture.componentInstance
    salvato = 0
    c.salvato.subscribe(() => salvato++)
    fixture.componentRef.setInput('configurazione', conf)
    fixture.componentRef.setInput('registroIniziale', registro)
    fixture.componentRef.setInput('visible', true)
    fixture.detectChanges()
  }

  function sceltaCriterio(testo: string): void {
    const bottoni = Array.from(
      document.body.querySelectorAll<HTMLElement>('[data-testid="sd-criterio"] .p-button')
    )
    const b = bottoni.find(x => x.textContent?.includes(testo))
    expect(b).withContext(`criterio ${testo}`).toBeDefined()
    b!.click()
    fixture.detectChanges()
  }

  beforeEach(() => {
    service = jasmine.createSpyObj<GiacenzeService>('GiacenzeService', [
      'impostaSoglie',
      'eliminaSoglie',
    ])
    toast = jasmine.createSpyObj<ToastService>('ToastService', ['error', 'success', 'info', 'warn'])
    TestBed.configureTestingModule({
      imports: [SoglieDepositoDialogComponent],
      providers: [
        provideNoopAnimations(),
        { provide: GiacenzeService, useValue: service },
        { provide: ToastService, useValue: toast },
      ],
    })
  })

  afterEach(() => fixture?.destroy())

  it('scegliere QUANTITATIVO nasconde la soglia in giorni e mostra i kg', () => {
    apri(configurazione())
    sceltaCriterio('Temporale')
    expect(q('sd-blocco-giorni')).not.toBeNull()
    expect(q('sd-blocco-kg')).toBeNull()
    sceltaCriterio('Quantitativo')
    expect(q('sd-blocco-giorni')).toBeNull()
    expect(q('sd-blocco-kg')).not.toBeNull()
    expect(document.body.textContent).toContain(
      'Quanti kg corrispondono, per i vostri rifiuti, a 30 m³?'
    )
  })

  it('salvare per una sede con la casella spenta invia PUT con giorniMax null', () => {
    service.impostaSoglie.and.returnValue(of(riga()))
    apri(configurazione())
    sceltaCriterio('Temporale')
    c.form.patchValue({ note: '  Piazzale nord  ' })
    clic('sd-salva')
    expect(service.impostaSoglie).toHaveBeenCalledOnceWith('r1', {
      criterio: 'TEMPORALE',
      giorniMax: null,
      kgMaxTotale: 30000,
      kgMaxPericolosi: 10000,
      preavvisoGiorni: 15,
      preavvisoPercentuale: 80,
      note: 'Piazzale nord',
    })
    expect(salvato).toBe(1)
  })

  it('la casella accende il campo e il corpo porta il numero di giorni', () => {
    service.impostaSoglie.and.returnValue(of(riga()))
    apri(configurazione(), null)
    sceltaCriterio('Temporale')
    expect(document.getElementById('sd-giorni')).toBeNull()
    document.body.querySelector<HTMLInputElement>('[data-testid="sd-usa-giorni"]')!.click()
    fixture.detectChanges()
    expect(document.getElementById('sd-giorni')).not.toBeNull()
    c.form.patchValue({ giorniMax: 60 })
    clic('sd-salva')
    expect(service.impostaSoglie.calls.mostRecent().args[0]).toBeNull()
    expect(service.impostaSoglie.calls.mostRecent().args[1].giorniMax).toBe(60)
  })

  it('"Usa le soglie dell\'azienda" invia DELETE per la sede', () => {
    service.eliminaSoglie.and.returnValue(of(undefined))
    apri(
      configurazione({
        registri: [
          { registroId: 'r1', registroDescrizione: 'Milano', attivo: true, soglie: riga() },
        ],
      })
    )
    expect(q('sd-ripristina')?.textContent).toContain("Usa le soglie dell'azienda")
    clic('sd-ripristina')
    expect(service.eliminaSoglie).toHaveBeenCalledOnceWith('r1')
    expect(salvato).toBe(1)
  })

  it('per l\'azienda il ripristino si chiama "Torna ai valori predefiniti" e invia DELETE null', () => {
    service.eliminaSoglie.and.returnValue(of(undefined))
    apri(configurazione({ azienda: riga() }), null)
    expect(q('sd-ripristina')?.textContent).toContain('Torna ai valori predefiniti')
    clic('sd-ripristina')
    expect(service.eliminaSoglie).toHaveBeenCalledOnceWith(null)
  })

  it('senza riga salvata il ripristino non compare', () => {
    apri(configurazione())
    expect(q('sd-ripristina')).toBeNull()
  })

  it('mostra i messaggi del 400 del backend come arrivano', () => {
    service.impostaSoglie.and.returnValue(
      throwError(() => ({
        error: { message: 'Bad Request', details: { messaggi: ['Primo problema.', 'Secondo.'] } },
      }))
    )
    apri(configurazione())
    clic('sd-salva')
    fixture.detectChanges()
    const blocco = q('sd-backend')
    expect(blocco?.textContent).toContain('Primo problema.')
    expect(blocco?.textContent).toContain('Secondo.')
    expect(blocco?.getAttribute('role')).toBe('alert')
    expect(salvato).toBe(0)
  })

  it("pericolosi oltre il totale è bloccato prima dell'invio, con messaggio legato al campo", () => {
    apri(configurazione())
    sceltaCriterio('Quantitativo')
    c.form.patchValue({ kgMaxTotale: 100, kgMaxPericolosi: 200 })
    clic('sd-salva')
    fixture.detectChanges()
    expect(service.impostaSoglie).not.toHaveBeenCalled()
    const err = q('sd-err-kgMaxPericolosi')
    expect(err?.textContent).toContain('non può superare la soglia totale')
    const campo = document.getElementById('sd-kg-pericolosi')
    expect(err?.id).toBe('sd-kg-pericolosi-err')
    expect(campo?.closest('p-inputnumber')?.getAttribute('aria-describedby')).toBe(
      'sd-kg-pericolosi-err'
    )
  })

  it('cambiare livello precompila dalle soglie di quel livello', () => {
    apri(
      configurazione({
        registri: [
          {
            registroId: 'r1',
            registroDescrizione: 'Milano',
            attivo: true,
            soglie: riga({ criterio: 'QUANTITATIVO', kgMaxTotale: 5000, kgMaxPericolosi: 1000 }),
          },
          { registroId: 'r2', registroDescrizione: 'Torino', attivo: true, soglie: null },
        ],
      })
    )
    expect(c.form.value.kgMaxTotale).toBe(5000)
    c.cambiaLivello('r2')
    expect(c.form.value.kgMaxTotale).toBe(30000)
  })

  it('al primo apri il focus va sul primo campo e Esc chiude', fakeAsync(() => {
    apri(configurazione())
    const uscite: boolean[] = []
    c.visibleChange.subscribe(v => uscite.push(v))
    tick(100)
    fixture.detectChanges()
    expect(document.activeElement?.id).toBe('sd-livello')
    document.activeElement?.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })
    )
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    flush()
    expect(uscite).toContain(false)
  }))
})

describe('GiacenzeComponent: pulsante Soglie', () => {
  let fixture: ComponentFixture<GiacenzeComponent>

  function setup(puoImpostare: boolean): void {
    const service = jasmine.createSpyObj<GiacenzeService>('GiacenzeService', [
      'getGiacenze',
      'getDepositoTemporaneo',
      'getSoglie',
    ])
    service.getGiacenze.and.returnValue(of([]))
    service.getDepositoTemporaneo.and.returnValue(
      of({ oggi: '2026-10-30', registri: [] } as DepositoTemporaneoVista)
    )
    service.getSoglie.and.returnValue(of(configurazione({ puoImpostare })))
    const reg = jasmine.createSpyObj<RegistroService>('RegistroService', ['listRegistri'])
    reg.listRegistri.and.returnValue(of([]))
    TestBed.configureTestingModule({
      imports: [GiacenzeComponent],
      providers: [
        provideNoopAnimations(),
        { provide: GiacenzeService, useValue: service },
        { provide: RegistroService, useValue: reg },
        { provide: ToastService, useValue: jasmine.createSpyObj('ToastService', ['error']) },
      ],
    })
    fixture = TestBed.createComponent(GiacenzeComponent)
    fixture.detectChanges()
  }

  afterEach(() => fixture?.destroy())

  it('è assente senza puoImpostare', () => {
    setup(false)
    expect(fixture.nativeElement.querySelector('[data-testid="soglie-apri"]')).toBeNull()
  })

  it('con puoImpostare un clic apre il dialog', () => {
    setup(true)
    fixture.nativeElement.querySelector('[data-testid="soglie-apri"] button').click()
    fixture.detectChanges()
    expect(document.body.querySelector('[data-testid="sd-form"]')).not.toBeNull()
  })
})
