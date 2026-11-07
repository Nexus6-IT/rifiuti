import { ComponentFixture, TestBed } from '@angular/core/testing'
import { provideNoopAnimations } from '@angular/platform-browser/animations'
import { provideRouter } from '@angular/router'
import { HttpErrorResponse } from '@angular/common/http'
import { By } from '@angular/platform-browser'
import { Subject, of, throwError } from 'rxjs'
import { AuthService } from '../../../core/services/auth.service'
import { Pagina, ScostamentoRiga } from '../fatturazione.model'
import { FatturazioneService } from '../fatturazione.service'
import { PresaAttoDialogComponent } from './presa-atto-dialog.component'
import { ScostamentiComponent, differenzaDecimale } from './scostamenti.component'

function riga(n: number, extra: Partial<ScostamentoRiga> = {}): ScostamentoRiga {
  return {
    legameId: `lg-${n}`,
    versioneLegame: 2,
    documento: { id: `d-${n}`, numeroTesto: `${n}/2026`, dataDocumento: '2026-10-31' },
    tipoCorrezione: 'RETTIFICA',
    quantitaFatturata: '1250.5',
    importoFatturato: '12345.60',
    quantitaAttuale: '1000',
    unitaFatturata: 'KG',
    unitaAttuale: 'KG',
    importoAttuale: '9876.50',
    soloQuantita: false,
    ...extra,
  }
}

const pagina = (e: ScostamentoRiga[], totale = e.length): Pagina<ScostamentoRiga> => ({
  elementi: e,
  totale,
  pagina: 1,
  dimensione: 50,
})

const q = <T extends HTMLElement = HTMLElement>(id: string): T | null =>
  document.body.querySelector<T>(`[data-testid="${id}"]`)

describe('ScostamentiComponent', () => {
  let fixture: ComponentFixture<ScostamentiComponent>
  let servizio: jasmine.SpyObj<FatturazioneService>

  async function crea(ruolo: string, risposta = of(pagina([riga(1)]))): Promise<void> {
    servizio = jasmine.createSpyObj('FatturazioneService', ['scostamenti', 'presaAtto'])
    servizio.scostamenti.and.returnValue(risposta)
    await TestBed.configureTestingModule({
      imports: [ScostamentiComponent],
      providers: [
        provideNoopAnimations(),
        provideRouter([]),
        { provide: FatturazioneService, useValue: servizio },
        { provide: AuthService, useValue: { currentUser: () => ({ role: ruolo }) } },
      ],
    }).compileComponents()
    fixture = TestBed.createComponent(ScostamentiComponent)
    fixture.detectChanges()
    await fixture.whenStable()
    fixture.detectChanges()
  }

  afterEach(() => fixture?.destroy())

  it('usa la classe pagina-lavoro', async () => {
    await crea('ADMIN')
    expect(fixture.nativeElement.querySelector('.pagina-lavoro')).not.toBeNull()
  })

  it('lista con documento, quantità e importo fatturati e attuali (it-IT), tipo di correzione', async () => {
    await crea('ADMIN')
    const tr = q('scostamento-lg-1')!
    const t = (id: string): string =>
      (tr.querySelector(`[data-testid="${id}"]`)?.textContent ?? '').replace(/\s+/g, ' ').trim()
    expect(t('sc-documento')).toContain('1/2026')
    expect(t('sc-documento')).toContain('31/10/2026')
    expect(t('sc-tipo')).toBe('Rettifica')
    expect(t('sc-qta-fatturata')).toBe('1.250,5 KG')
    expect(t('sc-qta-attuale')).toBe('1.000 KG')
    expect(t('sc-importo-fatturato')).toBe('12.345,60')
    expect(t('sc-importo-attuale')).toBe('9.876,50')
  })

  it('i tipi di correzione hanno un testo proprio', async () => {
    await crea(
      'ADMIN',
      of(
        pagina([
          riga(1, { tipoCorrezione: 'ANNULLO' }),
          riga(2, { tipoCorrezione: 'CAMBIO_CER' }),
          riga(3, { tipoCorrezione: 'CAMBIO_CAUSALE' }),
        ])
      )
    )
    const tipo = (n: number): string =>
      q(`scostamento-lg-${n}`)!.querySelector('[data-testid="sc-tipo"]')!.textContent!.trim()
    expect(tipo(1)).toBe('Annullo')
    expect(tipo(2)).toBe('Cambio di CER')
    expect(tipo(3)).toBe('Cambio di causale')
  })

  it('riga a prezzo speciale: solo la differenza di quantità, nessun importo attuale', async () => {
    await crea('ADMIN', of(pagina([riga(1, { soloQuantita: true, importoAttuale: null })])))
    const tr = q('scostamento-lg-1')!
    expect(tr.querySelector('[data-testid="sc-solo-quantita"]')!.textContent).toContain(
      'Prezzo speciale'
    )
    expect(tr.querySelector('[data-testid="sc-importo-attuale"]')!.textContent!.trim()).toBe('—')
    expect(tr.querySelector('[data-testid="sc-differenza"]')!.textContent!.trim()).toBe(
      'Differenza di quantità: −250,5 KG'
    )
  })

  it("«Presa d'atto» solo per ADMIN; il VIEWER e l'OPERATOR non vedono azioni", async () => {
    await crea('ADMIN')
    expect(q('presa-atto-lg-1')).not.toBeNull()
    expect(q('storna-lg-1')).not.toBeNull()
    fixture.destroy()
    TestBed.resetTestingModule()
    for (const ruolo of ['VIEWER', 'OPERATOR']) {
      await crea(ruolo)
      expect(q('presa-atto-lg-1')).toBeNull()
      expect(q('storna-lg-1')).toBeNull()
      fixture.destroy()
      TestBed.resetTestingModule()
    }
  })

  it('cambio di unità: ogni quantità porta la sua unità', async () => {
    await crea(
      'ADMIN',
      of(
        pagina([
          riga(1, {
            quantitaFatturata: '1000',
            unitaFatturata: 'KG',
            quantitaAttuale: '1',
            unitaAttuale: 'T',
          }),
        ])
      )
    )
    const tr = q('scostamento-lg-1')!
    expect(tr.querySelector('[data-testid="sc-qta-fatturata"]')!.textContent!.trim()).toBe(
      '1.000 KG'
    )
    expect(tr.querySelector('[data-testid="sc-qta-attuale"]')!.textContent!.trim()).toBe('1 T')
    expect(tr.querySelector('[data-testid="sc-differenza"]')).toBeNull()
  })

  it('il binding (registrata) del dialog chiude e rilegge la lista', async () => {
    await crea('ADMIN')
    q('presa-atto-lg-1')!.querySelector('button')!.click()
    fixture.detectChanges()
    servizio.scostamenti.calls.reset()
    fixture.debugElement
      .query(By.directive(PresaAttoDialogComponent))
      .componentInstance.registrata.emit()
    expect(servizio.scostamenti).toHaveBeenCalledTimes(1)
    expect(fixture.componentInstance.scelto()).toBeNull()
  })

  it("«Presa d'atto» apre il dialog con la nota; a registrazione avvenuta rilegge la lista", async () => {
    await crea('ADMIN')
    servizio.scostamenti.calls.reset()
    q('presa-atto-lg-1')!.querySelector('button')!.click()
    fixture.detectChanges()
    await fixture.whenStable()
    expect(q('presa-atto-nota')).not.toBeNull()
    fixture.componentInstance.dopoPresaAtto()
    expect(servizio.scostamenti).toHaveBeenCalledTimes(1)
  })

  it('«Storna e rifattura» porta allo storno del documento con rifatturabile acceso', async () => {
    await crea('ADMIN')
    const a = q<HTMLAnchorElement>('storna-lg-1')!
    const href = a.getAttribute('href')!
    expect(href).toContain('/fatturazione/documenti/d-1')
    expect(href).toContain('storno=1')
    expect(href).toContain('rifatturabile=1')
  })

  it('il numero del documento porta al documento', async () => {
    await crea('VIEWER')
    expect(q<HTMLAnchorElement>('sc-link-documento-lg-1')!.getAttribute('href')).toBe(
      '/fatturazione/documenti/d-1'
    )
  })

  it('pagine da 50, mai oltre 100', async () => {
    await crea('ADMIN')
    const opz = servizio.scostamenti.calls.mostRecent().args[0]!
    expect(opz.pagina).toBe(1)
    expect(opz.dimensione!).toBeLessThanOrEqual(100)
  })

  it('lista vuota: messaggio', async () => {
    await crea('ADMIN', of(pagina([])))
    expect(q('scostamenti-vuota')).not.toBeNull()
  })

  it('errore di lettura: messaggio dal vocabolario e «Riprova»', async () => {
    await crea(
      'ADMIN',
      throwError(() => new HttpErrorResponse({ status: 500, error: {} }))
    )
    expect(q('scostamenti-errore')).not.toBeNull()
    servizio.scostamenti.and.returnValue(of(pagina([riga(1)])))
    q('scostamenti-riprova')!.querySelector('button')!.click()
    fixture.detectChanges()
    expect(q('scostamento-lg-1')).not.toBeNull()
  })

  it('una lettura nuova annulla quella pendente', async () => {
    const lenta = new Subject<Pagina<ScostamentoRiga>>()
    await crea('ADMIN', lenta as never)
    expect(lenta.observed).toBeTrue()
    servizio.scostamenti.and.returnValue(of(pagina([riga(2)])))
    fixture.componentInstance.carica()
    expect(lenta.observed).toBeFalse()
  })
})

describe('differenzaDecimale', () => {
  it('sottrae in aritmetica decimale esatta', () => {
    expect(differenzaDecimale('1000', '1250.5')).toBe('-250.5')
    expect(differenzaDecimale('0.3', '0.1')).toBe('0.2')
    expect(differenzaDecimale('5.000', '5')).toBe('0')
    expect(differenzaDecimale('0.05', '0.1')).toBe('-0.05')
    expect(differenzaDecimale(null, '1')).toBeNull()
  })
})
