import { ComponentFixture, TestBed } from '@angular/core/testing'
import { provideNoopAnimations } from '@angular/platform-browser/animations'
import { By } from '@angular/platform-browser'
import { Subject, of, throwError } from 'rxjs'
import { Calendar } from 'primeng/calendar'
import { InputNumber } from 'primeng/inputnumber'
import { MessageService } from 'primeng/api'
import { AuthService } from '../../../core/services/auth.service'
import { bottone, q, stabilizza } from '../../clienti/tabelle/tabelle-test-utils'
import { ImpostazioniFatturazione44Service } from './impostazioni-fatturazione-4-4.service'
import { NumerazioneVista } from './impostazioni.model'
import { NumerazioneSchedaComponent, dataLocale, isoLocale } from './numerazione-scheda.component'

const anno = new Date().getFullYear()

const riga = (o: Partial<NumerazioneVista>): NumerazioneVista => ({
  registroIvaId: 'r1',
  codiceRegistro: 'VEN',
  anno,
  ultimoNumero: 0,
  ultimaData: null,
  numeroPartenza: 0,
  dataPartenza: null,
  partenzaModificabile: true,
  versione: 1,
  ...o,
})

describe('NumerazioneSchedaComponent', () => {
  let fixture: ComponentFixture<NumerazioneSchedaComponent>
  let servizio: jasmine.SpyObj<ImpostazioniFatturazione44Service>

  async function crea(ruolo: string, elenco: NumerazioneVista[]): Promise<void> {
    servizio = jasmine.createSpyObj('ImpostazioniFatturazione44Service', [
      'numerazioni',
      'impostaPartenza',
    ])
    servizio.numerazioni.and.returnValue(of(elenco))
    await TestBed.configureTestingModule({
      imports: [NumerazioneSchedaComponent],
      providers: [
        provideNoopAnimations(),
        MessageService,
        { provide: ImpostazioniFatturazione44Service, useValue: servizio },
        { provide: AuthService, useValue: { currentUser: () => ({ role: ruolo }) } },
      ],
    }).compileComponents()
    fixture = TestBed.createComponent(NumerazioneSchedaComponent)
    await stabilizza(fixture)
  }

  afterEach(() => {
    jasmine.clock().uninstall()
    fixture?.destroy()
  })

  it('tabella per registro con ultimo numero, ultima data e partenza', async () => {
    await crea('ADMIN', [
      riga({
        ultimoNumero: 121,
        ultimaData: '2026-03-05',
        numeroPartenza: 120,
        dataPartenza: '2026-03-01',
        partenzaModificabile: false,
      }),
    ])
    expect(servizio.numerazioni).toHaveBeenCalledWith(anno)
    const r = q('numerazione-riga-VEN')!
    expect(r.querySelector('[data-testid="numerazione-ultimo"]')!.textContent).toContain('121')
    expect(r.querySelector('[data-testid="numerazione-data"]')!.textContent).toContain('05/03/2026')
    expect(r.querySelector('[data-testid="numerazione-partenza"]')!.textContent).toContain('120')
  })

  it('la didascalia sr-only sta in un contenitore position: relative', async () => {
    await crea('ADMIN', [riga({})])
    const caption = fixture.nativeElement.querySelector('caption.sr-only') as HTMLElement
    expect(caption).not.toBeNull()
    const contenitore = caption.closest('.tabella-numerazioni') as HTMLElement
    expect(getComputedStyle(contenitore).position).toBe('relative')
  })

  it('«Numero di partenza» solo se partenzaModificabile', async () => {
    await crea('ADMIN', [
      riga({ registroIvaId: 'r1', codiceRegistro: 'VEN', partenzaModificabile: true }),
      riga({ registroIvaId: 'r2', codiceRegistro: 'ACQ', partenzaModificabile: false }),
    ])
    expect(q('numerazione-modifica-VEN')).not.toBeNull()
    expect(q('numerazione-modifica-ACQ')).toBeNull()
  })

  it('nessuna partenza e nessun definitivo: «La numerazione partirà da 1»', async () => {
    await crea('ADMIN', [riga({})])
    expect(q('numerazione-parte-da-1')?.textContent).toContain('La numerazione partirà da 1')
  })

  it('con una partenza o dei numeri emessi l’avviso non c’è', async () => {
    await crea('ADMIN', [riga({ numeroPartenza: 10, ultimoNumero: 10 })])
    expect(q('numerazione-parte-da-1')).toBeNull()
  })

  /** Apre il dialog dal clic sul pulsante della riga, come fa l'utente. */
  async function apri(codice = 'VEN'): Promise<Calendar> {
    bottone(`numerazione-modifica-${codice}`)!.click()
    await stabilizza(fixture)
    expect(q('partenza-numero')).not.toBeNull()
    return fixture.debugElement.query(By.directive(Calendar)).componentInstance as Calendar
  }

  const campoNumero = (): InputNumber =>
    fixture.debugElement.query(By.directive(InputNumber)).componentInstance as InputNumber

  it('il pulsante di ogni riga dice a quale registro si riferisce', async () => {
    await crea('ADMIN', [riga({})])
    const b = bottone('numerazione-modifica-VEN')!
    expect(b.getAttribute('aria-label')).toBe('Imposta il numero di partenza del registro VEN')
  })

  it('data di partenza dal template: maxDate = fine del giorno, ricalcolata a onShow e onFocus', async () => {
    jasmine.clock().install()
    jasmine.clock().mockDate(new Date(2026, 10, 5, 8, 0, 0))
    await crea('ADMIN', [riga({})])
    const cal = await apri()
    expect(cal.maxDate!.getTime()).toBe(new Date(2026, 10, 5, 23, 59, 59, 999).getTime())

    jasmine.clock().mockDate(new Date(2026, 10, 6, 0, 30, 0))
    cal.onShow.emit({})
    fixture.detectChanges()
    expect(cal.maxDate!.getTime()).toBe(new Date(2026, 10, 6, 23, 59, 59, 999).getTime())

    jasmine.clock().mockDate(new Date(2026, 10, 7, 0, 5, 0))
    cal.onFocus.emit(new Event('focus'))
    fixture.detectChanges()
    expect(cal.maxDate!.getTime()).toBe(new Date(2026, 10, 7, 23, 59, 59, 999).getTime())
  })

  it("data di partenza dal template: il calendario sta nell'anno della coppia", async () => {
    jasmine.clock().install()
    jasmine.clock().mockDate(new Date(2026, 10, 5, 8, 0, 0))
    // Anno passato: da 1 gennaio a 31 dicembre di quell'anno.
    await crea('ADMIN', [riga({ anno: 2025 })])
    let cal = await apri()
    expect(cal.minDate!.getTime()).toBe(new Date(2025, 0, 1).getTime())
    expect(cal.maxDate!.getTime()).toBe(new Date(2025, 11, 31, 23, 59, 59, 999).getTime())
    expect(q('partenza-data-anno-futuro')).toBeNull()
    bottone('partenza-annulla')!.click()
    await stabilizza(fixture)
    fixture.destroy()
    TestBed.resetTestingModule()
    // Anno corrente: il tetto e' la fine di oggi.
    await crea('ADMIN', [riga({ anno: 2026 })])
    cal = await apri()
    expect(cal.minDate!.getTime()).toBe(new Date(2026, 0, 1).getTime())
    expect(cal.maxDate!.getTime()).toBe(new Date(2026, 10, 5, 23, 59, 59, 999).getTime())
    bottone('partenza-annulla')!.click()
    await stabilizza(fixture)
    fixture.destroy()
    TestBed.resetTestingModule()
    // Anno futuro: nessuna data selezionabile e un avviso.
    await crea('ADMIN', [riga({ anno: 2027 })])
    cal = await apri()
    expect(cal.minDate!.getTime()).toBe(new Date(2027, 0, 1).getTime())
    expect(cal.maxDate!.getTime()).toBeLessThan(cal.minDate!.getTime())
    expect(q('partenza-data-anno-futuro')).not.toBeNull()
  })

  it("«oggi» e' quello italiano: alle 00:30 del 1 gennaio a Roma (23:30 UTC) il tetto e' il 1 gennaio", async () => {
    jasmine.clock().install()
    jasmine.clock().mockDate(new Date(Date.UTC(2026, 11, 31, 23, 30, 0)))
    await crea('ADMIN', [riga({ anno: 2027 })])
    const cal = await apri()
    expect(cal.maxDate!.getTime()).toBe(new Date(2027, 0, 1, 23, 59, 59, 999).getTime())
    expect(cal.maxDate!.getTime()).toBeGreaterThanOrEqual(cal.minDate!.getTime())
    expect(q('partenza-data-anno-futuro')).toBeNull()
  })

  it('il numero di partenza ammette al massimo 99999999 (come il backend)', async () => {
    await crea('ADMIN', [riga({})])
    await apri()
    expect(campoNumero().max).toBe(99999999)
  })

  it('la riapertura del dialog ricalcola la fine del giorno', async () => {
    jasmine.clock().install()
    jasmine.clock().mockDate(new Date(2026, 10, 5, 8, 0, 0))
    await crea('ADMIN', [riga({})])
    let cal = await apri()
    expect(cal.maxDate!.getDate()).toBe(5)
    bottone('partenza-annulla')!.click()
    await stabilizza(fixture)
    jasmine.clock().mockDate(new Date(2026, 10, 6, 0, 30, 0))
    cal = await apri()
    expect(cal.maxDate!.getTime()).toBe(new Date(2026, 10, 6, 23, 59, 59, 999).getTime())
  })

  it('il calendario si può svuotare con la X', async () => {
    await crea('ADMIN', [riga({})])
    const cal = await apri()
    expect(cal.showClear).toBeTrue()
  })

  it('imposta la partenza dal dialog: PUT con numero, data AAAA-MM-GG e versione, riga aggiornata', async () => {
    await crea('ADMIN', [riga({ versione: 4 })])
    servizio.impostaPartenza.and.returnValue(
      of(riga({ numeroPartenza: 120, ultimoNumero: 120, dataPartenza: '2026-03-01', versione: 5 }))
    )
    const cal = await apri()
    campoNumero().onModelChange(120)
    cal.onModelChange(new Date(2026, 2, 1))
    bottone('partenza-salva')!.click()
    await stabilizza(fixture)
    expect(servizio.impostaPartenza).toHaveBeenCalledOnceWith('r1', anno, {
      numeroPartenza: 120,
      dataPartenza: '2026-03-01',
      versione: 4,
    })
    expect(q('partenza-numero')).toBeNull()
    expect(q('numerazione-partenza')!.textContent).toContain('120')
    expect(q('numerazione-partenza')!.textContent).toContain('01/03/2026')
  })

  it('numero di partenza negativo: errore nel dialog e nessuna PUT', async () => {
    await crea('ADMIN', [riga({})])
    await apri()
    campoNumero().onModelChange(-1)
    bottone('partenza-salva')!.click()
    await stabilizza(fixture)
    expect(servizio.impostaPartenza).not.toHaveBeenCalled()
    expect(q('partenza-errore')).not.toBeNull()
  })

  for (const ruolo of ['VIEWER', 'OPERATOR']) {
    it(`${ruolo}: nessun pulsante di modifica`, async () => {
      await crea(ruolo, [riga({})])
      expect(q('numerazione-modifica-VEN')).toBeNull()
      expect(q('numerazione-sola-lettura')).not.toBeNull()
    })
  }

  it('409 PARTENZA_NON_MODIFICABILE dal dialog: messaggio nella pagina, dialog chiuso, ricarica', async () => {
    await crea('ADMIN', [riga({})])
    servizio.impostaPartenza.and.returnValue(
      throwError(() => ({ status: 409, error: { error: 'PARTENZA_NON_MODIFICABILE' } }))
    )
    servizio.numerazioni.and.returnValue(of([riga({ partenzaModificabile: false })]))
    await apri()
    campoNumero().onModelChange(5)
    bottone('partenza-salva')!.click()
    await stabilizza(fixture)
    expect(servizio.numerazioni).toHaveBeenCalledTimes(2)
    expect(q('numerazione-errore')?.textContent).toContain('non si può più cambiare')
    expect(q('numerazione-modifica-VEN')).toBeNull()
    expect(q('partenza-numero')).toBeNull()
  })

  it('409 VERSIONE_SUPERATA dal dialog: messaggio, dialog chiuso, ricarica', async () => {
    await crea('ADMIN', [riga({})])
    servizio.impostaPartenza.and.returnValue(
      throwError(() => ({ status: 409, error: { error: 'VERSIONE_SUPERATA' } }))
    )
    servizio.numerazioni.and.returnValue(of([riga({ versione: 9 })]))
    await apri()
    campoNumero().onModelChange(5)
    bottone('partenza-salva')!.click()
    await stabilizza(fixture)
    expect(servizio.numerazioni).toHaveBeenCalledTimes(2)
    expect(q('numerazione-errore')?.textContent).toContain('modificata da un altro utente')
    expect(q('partenza-numero')).toBeNull()
  })

  it('409 che non è di rilettura: l’errore resta nel dialog, che non si chiude', async () => {
    await crea('ADMIN', [riga({})])
    servizio.impostaPartenza.and.returnValue(
      throwError(() => ({ status: 409, error: { error: 'ALTRO', message: 'Numero non valido.' } }))
    )
    await apri()
    campoNumero().onModelChange(5)
    bottone('partenza-salva')!.click()
    await stabilizza(fixture)
    expect(servizio.numerazioni).toHaveBeenCalledTimes(1)
    expect(q('partenza-errore')?.textContent).toContain('Numero non valido.')
    expect(q('partenza-numero')).not.toBeNull()
  })

  it('due cambi d’anno rapidi: la risposta lenta dell’anno vecchio non sovrascrive', async () => {
    await crea('ADMIN', [riga({})])
    const lenta = new Subject<NumerazioneVista[]>()
    servizio.numerazioni.and.returnValues(lenta, of([riga({ anno: anno - 2, ultimoNumero: 7 })]))
    fixture.componentInstance.cambiaAnno(anno - 1)
    fixture.componentInstance.cambiaAnno(anno - 2)
    await stabilizza(fixture)
    lenta.next([riga({ anno: anno - 1, ultimoNumero: 99 })])
    await stabilizza(fixture)
    expect(q('numerazione-ultimo')!.textContent).toContain('7')
    expect(q('numerazione-ultimo')!.textContent).not.toContain('99')
  })

  it('cambio anno: rilegge l’elenco dell’anno scelto', async () => {
    await crea('ADMIN', [riga({})])
    fixture.componentInstance.cambiaAnno(anno - 1)
    await stabilizza(fixture)
    expect(servizio.numerazioni).toHaveBeenCalledWith(anno - 1)
  })

  it('le date si convertono senza passare da UTC', () => {
    expect(isoLocale(new Date(2026, 0, 1, 0, 30))).toBe('2026-01-01')
    expect(isoLocale(dataLocale('2026-12-31')!)).toBe('2026-12-31')
    expect(dataLocale('boh')).toBeNull()
  })

  it('elenco non caricato: errore con Riprova', async () => {
    servizio = jasmine.createSpyObj('ImpostazioniFatturazione44Service', ['numerazioni'])
    servizio.numerazioni.and.returnValues(
      throwError(() => ({ status: 500, error: {} })),
      of([riga({})])
    )
    await TestBed.configureTestingModule({
      imports: [NumerazioneSchedaComponent],
      providers: [
        provideNoopAnimations(),
        MessageService,
        { provide: ImpostazioniFatturazione44Service, useValue: servizio },
        { provide: AuthService, useValue: { currentUser: () => ({ role: 'ADMIN' }) } },
      ],
    }).compileComponents()
    fixture = TestBed.createComponent(NumerazioneSchedaComponent)
    await stabilizza(fixture)
    expect(q('numerazione-errore')).not.toBeNull()
    bottone('numerazione-riprova')!.click()
    await stabilizza(fixture)
    expect(q('numerazione-tabella')).not.toBeNull()
  })
})
