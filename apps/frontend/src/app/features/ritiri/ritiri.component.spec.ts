import { HttpClientTestingModule } from '@angular/common/http/testing'
import { ComponentFixture, TestBed } from '@angular/core/testing'
import { provideNoopAnimations } from '@angular/platform-browser/animations'
import { provideRouter } from '@angular/router'
import { HttpHeaders, HttpResponse } from '@angular/common/http'
import { Subject, of, throwError } from 'rxjs'
import { AuthService } from '../../core/services/auth.service'
import { ToastService } from '../../core/services/toast.service'
import { FirService } from '../fir/fir.service'
import { FIR } from '../../shared/models/fir.model'
import { RegistryService } from '../registry/registry.service'
import { PeseService } from '../pese/pese.service'
import { RitiriComponent } from './ritiri.component'
import { RitiroVista } from './ritiri.model'
import { RitiriService } from './ritiri.service'
import { ritiroDiProva } from './ritiri-test-utils'
import { ModelliStampaService } from '../impostazioni/modelli-stampa/modelli-stampa.service'
import { ModelloStampaVista } from '../impostazioni/modelli-stampa/modello-stampa.model'

const modello = (p: Partial<ModelloStampaVista>): ModelloStampaVista => ({
  id: 'm',
  nome: 'Modello',
  ambito: 'FIR',
  copie: 1,
  testoIntestazione: null,
  testoPiePagina: null,
  colorePrimario: '#000000',
  coloreSecondario: '#000000',
  logoBase64: null,
  predefinito: false,
  versione: 1,
  ...p,
})
const MODELLI: ModelloStampaVista[] = [
  modello({ id: 'mf1', nome: 'FIR standard', ambito: 'FIR', predefinito: true }),
  modello({ id: 'mf2', nome: 'FIR a colori', ambito: 'FIR' }),
  modello({ id: 'mg', nome: 'Generale', ambito: 'GENERALE' }),
  modello({ id: 'md1', nome: 'Distinta giro', ambito: 'DISTINTA_RITIRI', predefinito: true }),
  modello({ id: 'md2', nome: 'Distinta corta', ambito: 'DISTINTA_RITIRI' }),
]

const q = <T extends HTMLElement = HTMLElement>(id: string): T | null =>
  document.body.querySelector<T>(`[data-testid="${id}"]`)
const bottone = (id: string): HTMLButtonElement | null => {
  const e = q(id)
  return e instanceof HTMLButtonElement ? e : (e?.querySelector('button') ?? null)
}

describe('RitiriComponent', () => {
  let fixture: ComponentFixture<RitiriComponent>
  let servizio: jasmine.SpyObj<RitiriService>
  let toast: jasmine.SpyObj<ToastService>
  let fir: jasmine.SpyObj<FirService>
  let modelli: jasmine.SpyObj<ModelliStampaService>

  const righe: RitiroVista[] = [
    ritiroDiProva({ id: 'r1' }),
    ritiroDiProva({
      id: 'r2',
      statoVisibile: 'FIR_BOZZA',
      fir: { id: 'f2', numero: null, status: 'DRAFT' },
    }),
    ritiroDiProva({
      id: 'r3',
      stato: 'NON_ESEGUITO',
      statoVisibile: 'NON_ESEGUITO',
      motivo: 'mezzo guasto',
    }),
    ritiroDiProva({ id: 'r4', stato: 'ANNULLATO', statoVisibile: 'ANNULLATO', motivo: 'chiuso' }),
  ]

  async function crea(ruolo = 'ADMIN', elenco: RitiroVista[] = righe): Promise<void> {
    servizio = jasmine.createSpyObj<RitiriService>('RitiriService', [
      'elenca',
      'dettaglio',
      'annulla',
      'nonEseguito',
      'riprogramma',
      'generaFir',
      'stampaFir',
      'distinta',
    ])
    servizio.elenca.and.returnValue(of({ righe: elenco, totale: elenco.length }))
    modelli = jasmine.createSpyObj<ModelliStampaService>('ModelliStampaService', ['elenco'])
    modelli.elenco.and.returnValue(of(MODELLI))
    fir = jasmine.createSpyObj<FirService>('FirService', ['emettiFIR'])
    fir.emettiFIR.and.returnValue(of({} as unknown as FIR))
    toast = jasmine.createSpyObj<ToastService>('ToastService', ['success', 'error', 'info', 'warn'])
    await TestBed.configureTestingModule({
      imports: [RitiriComponent, HttpClientTestingModule],
      providers: [
        provideNoopAnimations(),
        provideRouter([]),
        { provide: RitiriService, useValue: servizio },
        { provide: ToastService, useValue: toast },
        { provide: FirService, useValue: fir },
        { provide: ModelliStampaService, useValue: modelli },
        { provide: AuthService, useValue: { currentUser: () => ({ role: ruolo }) } },
        { provide: PeseService, useValue: { elencaAutomezzi: () => of({ righe: [] }) } },
        { provide: RegistryService, useValue: {} },
      ],
    }).compileComponents()
    fixture = TestBed.createComponent(RitiriComponent)
    fixture.detectChanges()
    await fixture.whenStable()
    fixture.detectChanges()
  }

  afterEach(() => document.body.querySelectorAll('.p-dialog-mask').forEach(e => e.remove()))

  it('mostra una riga per ritiro con stato, motivo e numero del FIR', async () => {
    await crea()
    expect(document.body.querySelectorAll('[data-testid^="ri-riga-"]').length).toBe(4)
    expect(q('ri-riga-r1')?.textContent).toContain('Da generare')
    expect(q('ri-riga-r2')?.textContent).toContain('FIR in bozza')
    expect(q('ri-motivo-r3')?.textContent).toContain('mezzo guasto')
    expect(q('ri-fir-r2')?.getAttribute('href')).toBe('/fir/f2')
  })

  it('i filtri viaggiano al servizio alla ricerca', async () => {
    await crea()
    fixture.componentInstance.filtri.dal = '2026-11-01'
    fixture.componentInstance.filtri.statoVisibile = 'DA_GENERARE'
    bottone('ri-cerca')!.click()
    const ultimo = servizio.elenca.calls.mostRecent().args[0]!
    expect(ultimo.dal).toBe('2026-11-01')
    expect(ultimo.statoVisibile).toBe('DA_GENERARE')
    expect(ultimo.pagina).toBe(1)
    expect(ultimo.cerCode).toBeUndefined()
  })

  it('si spuntano solo i ritiri programmati (con o senza FIR), non i non eseguiti né gli annullati', async () => {
    await crea()
    expect(q<HTMLInputElement>('ri-sel-r1')!.disabled).toBeFalse()
    expect(q<HTMLInputElement>('ri-sel-r2')!.disabled).toBeFalse()
    expect(q<HTMLInputElement>('ri-sel-r3')!.disabled).toBeTrue()
    expect(q<HTMLInputElement>('ri-sel-r4')!.disabled).toBeTrue()
    expect(bottone('ri-genera')!.disabled).toBeTrue()
    expect(bottone('ri-emetti')!.disabled).toBeTrue()
    expect(bottone('ri-stampa-fir')!.disabled).toBeTrue()
  })

  it('Genera FIR manda i ritiri spuntati e apre l’esito', async () => {
    await crea()
    servizio.generaFir.and.returnValue(
      of({ esiti: [{ ritiroId: 'r1', esito: 'CREATO' as const, firId: 'f1' }] })
    )
    const sel = q<HTMLInputElement>('ri-sel-r1')!
    sel.click()
    fixture.detectChanges()
    expect(bottone('ri-genera')!.disabled).toBeFalse()
    bottone('ri-genera')!.click()
    fixture.detectChanges()
    expect(servizio.generaFir).toHaveBeenCalledOnceWith(['r1'])
    expect(q('eg-riepilogo')).not.toBeNull()
  })

  it('Stampa FIR manda i ritiri spuntati con un FIR, scarica il PDF e avvisa dei saltati', async () => {
    await crea()
    spyOn(URL, 'createObjectURL').and.returnValue('blob:x')
    spyOn(HTMLAnchorElement.prototype, 'click').and.stub()
    servizio.stampaFir.and.returnValue(
      of(
        new HttpResponse({
          body: new Blob(['%PDF']),
          headers: new HttpHeaders({
            'Content-Disposition': 'attachment; filename="FIR-ritiri.pdf"',
            'X-Ritiri-Saltati': '1',
          }),
        })
      )
    )
    q<HTMLInputElement>('ri-sel-r1')!.click()
    q<HTMLInputElement>('ri-sel-r2')!.click()
    fixture.detectChanges()
    bottone('ri-stampa-fir')!.click()
    fixture.detectChanges()
    // r1 non ha FIR: parte solo r2
    expect(servizio.stampaFir).toHaveBeenCalledOnceWith(['r2'], 'mf1')
    expect(URL.createObjectURL).toHaveBeenCalled()
    expect(toast.warn).toHaveBeenCalledWith(jasmine.stringContaining('saltato'))
  })

  it('Stampa FIR: un errore del server si mostra senza scaricare nulla', async () => {
    await crea()
    servizio.stampaFir.and.returnValue(
      throwError(() => ({ status: 400, error: { message: 'Nessuno dei ritiri ha un FIR.' } }))
    )
    q<HTMLInputElement>('ri-sel-r2')!.click()
    fixture.detectChanges()
    bottone('ri-stampa-fir')!.click()
    expect(toast.error).toHaveBeenCalledWith('Nessuno dei ritiri ha un FIR.')
  })

  it('Emetti FIR emette solo le bozze spuntate, una alla volta, e a fine corsa ricarica l’elenco', async () => {
    await crea()
    q<HTMLInputElement>('ri-sel-r1')!.click()
    q<HTMLInputElement>('ri-sel-r2')!.click()
    fixture.detectChanges()
    bottone('ri-emetti')!.click()
    fixture.detectChanges()
    expect(fir.emettiFIR.calls.allArgs()).toEqual([['f2']])
    expect(q('em-riepilogo')?.textContent).toContain('1 emessi')
    servizio.elenca.calls.reset()
    bottone('em-chiudi')!.click()
    fixture.detectChanges()
    expect(q('em-riepilogo')).toBeNull()
    expect(servizio.elenca).toHaveBeenCalled()
  })

  it('Emetti FIR si ferma alla prima mancanza di firma con un messaggio chiaro', async () => {
    const tre = [
      ritiroDiProva({
        id: 'a',
        statoVisibile: 'FIR_BOZZA',
        fir: { id: 'fa', numero: null, status: 'DRAFT' },
      }),
      ritiroDiProva({
        id: 'b',
        statoVisibile: 'FIR_BOZZA',
        fir: { id: 'fb', numero: null, status: 'DRAFT' },
      }),
      ritiroDiProva({
        id: 'c',
        statoVisibile: 'FIR_BOZZA',
        fir: { id: 'fc', numero: null, status: 'DRAFT' },
      }),
    ]
    await crea('ADMIN', tre)
    fir.emettiFIR.and.callFake(id =>
      id === 'fb'
        ? throwError(() => ({
            status: 400,
            error: { error: 'FIRMA_NON_RIUSCITA', message: 'Firma produttore non riuscita: x' },
          }))
        : of({} as unknown as FIR)
    )
    q<HTMLInputElement>('ri-sel-tutti')!.click()
    fixture.detectChanges()
    bottone('ri-emetti')!.click()
    fixture.detectChanges()
    expect(fir.emettiFIR.calls.allArgs()).toEqual([['fa'], ['fb']])
    expect(q('em-stop')?.textContent).toContain('certificato di firma')
    expect(q('em-riga-a')?.textContent).toContain('Emesso')
    expect(q('em-riga-b')?.textContent).toContain('Errore')
    expect(q('em-riga-c')?.textContent).toContain('Non tentato')
  })

  it('Interrompi non annulla la richiesta in volo: la riga mostra il suo esito e le altre restano non tentate', async () => {
    const due = [
      ritiroDiProva({
        id: 'a',
        statoVisibile: 'FIR_BOZZA',
        fir: { id: 'fa', numero: null, status: 'DRAFT' },
      }),
      ritiroDiProva({
        id: 'b',
        statoVisibile: 'FIR_BOZZA',
        fir: { id: 'fb', numero: null, status: 'DRAFT' },
      }),
    ]
    await crea('ADMIN', due)
    const volo = new Subject<FIR>()
    fir.emettiFIR.and.returnValue(volo)
    q<HTMLInputElement>('ri-sel-tutti')!.click()
    fixture.detectChanges()
    bottone('ri-emetti')!.click()
    fixture.detectChanges()
    bottone('em-interrompi')!.click()
    fixture.detectChanges()
    // la richiesta e` ancora in volo: nessun «Chiudi», nessuna riga data per non tentata a torto
    expect(q('em-chiudi')).toBeNull()
    volo.next({} as unknown as FIR)
    volo.complete()
    fixture.detectChanges()
    expect(fir.emettiFIR.calls.allArgs()).toEqual([['fa']])
    expect(q('em-riga-a')?.textContent).toContain('Emesso')
    expect(q('em-riga-b')?.textContent).toContain('Non tentato')
    expect(q('em-chiudi')).not.toBeNull()
  })

  it('Distinta apre la scelta del giorno e scarica il PDF del giorno e del mezzo', async () => {
    await crea('VIEWER')
    spyOn(URL, 'createObjectURL').and.returnValue('blob:x')
    spyOn(HTMLAnchorElement.prototype, 'click').and.stub()
    servizio.distinta.and.returnValue(of(new HttpResponse({ body: new Blob(['%PDF']) })))
    fixture.componentInstance.filtri.dal = '2026-12-01'
    bottone('ri-distinta')!.click()
    fixture.detectChanges()
    const mezzo = q<HTMLSelectElement>('di-mezzo')!
    expect(mezzo).not.toBeNull()
    bottone('di-scarica')!.click()
    fixture.detectChanges()
    expect(servizio.distinta).toHaveBeenCalledOnceWith('2026-12-01', undefined, 'md1')
    expect(toast.success).toHaveBeenCalledWith('Distinta scaricata.')
  })

  it('Distinta: un errore resta nel dialog', async () => {
    await crea()
    servizio.distinta.and.returnValue(
      throwError(() => ({ status: 404, error: { message: 'Automezzo non trovato.' } }))
    )
    fixture.componentInstance.filtri.dal = '2026-12-01'
    bottone('ri-distinta')!.click()
    fixture.detectChanges()
    bottone('di-scarica')!.click()
    fixture.detectChanges()
    expect(q('di-errore')?.textContent).toContain('Automezzo non trovato.')
  })

  it('Annulla chiede il motivo e non parte senza', async () => {
    await crea()
    fixture.componentInstance.apriAzione('ANNULLA', righe[0])
    fixture.detectChanges()
    expect(q('ri-azione-indietro')).not.toBeNull()
    bottone('ri-azione-conferma')!.click()
    fixture.detectChanges()
    expect(servizio.annulla).not.toHaveBeenCalled()
    expect(q('ri-azione-errore')?.textContent).toContain('motivo')
  })

  it('Annulla con motivo chiama il servizio con la versione e ricarica', async () => {
    await crea()
    servizio.annulla.and.returnValue(of(righe[0]))
    fixture.componentInstance.apriAzione('ANNULLA', righe[0])
    fixture.componentInstance.motivo = 'cliente chiuso'
    fixture.detectChanges()
    const prima = servizio.elenca.calls.count()
    bottone('ri-azione-conferma')!.click()
    expect(servizio.annulla).toHaveBeenCalledOnceWith('r1', 'cliente chiuso', 1)
    expect(servizio.elenca.calls.count()).toBe(prima + 1)
    expect(toast.success).toHaveBeenCalled()
  })

  it('un 409 RITIRO_CON_FIR resta nel dialog con la frase che dice cosa fare', async () => {
    await crea()
    servizio.nonEseguito.and.returnValue(
      throwError(() => ({ status: 409, error: { error: 'RITIRO_CON_FIR' } }))
    )
    fixture.componentInstance.apriAzione('NON_ESEGUITO', righe[0])
    fixture.componentInstance.motivo = 'mezzo guasto'
    fixture.detectChanges()
    bottone('ri-azione-conferma')!.click()
    fixture.detectChanges()
    expect(q('ri-azione-errore')?.textContent).toContain('annulla prima il FIR')
  })

  it('Riprogramma chiede la data e la manda al servizio', async () => {
    await crea()
    servizio.riprogramma.and.returnValue(of(righe[2]))
    fixture.componentInstance.apriAzione('RIPROGRAMMA', righe[2])
    fixture.componentInstance.nuovaData = '2026-11-20'
    fixture.detectChanges()
    bottone('ri-azione-conferma')!.click()
    expect(servizio.riprogramma).toHaveBeenCalledOnceWith('r3', '2026-11-20', 1)
  })

  it('le azioni dipendono dallo stato del ritiro', async () => {
    await crea()
    const c = fixture.componentInstance
    expect(c.azioni(righe[0]).principale).not.toBeNull()
    expect(c.azioni(righe[0]).altre.map(a => a.etichetta)).toEqual([
      'Non eseguito',
      'Annulla il ritiro',
    ])
    // con un FIR attivo niente modifica e l'annullo è spiegato
    expect(c.azioni(righe[1]).principale).toBeNull()
    expect(c.azioni(righe[1]).altre[0].disabilitata).toBeTrue()
    // non eseguito: si può riprogramma
    expect(c.azioni(righe[2]).altre.map(a => a.etichetta)).toContain('Riprogramma')
    // annullato: nessuna azione
    expect(c.azioni(righe[3]).altre).toEqual([])
  })

  it('un lettore non vede pulsanti di scrittura né azioni di riga, ma seleziona e stampa i FIR', async () => {
    await crea('VIEWER')
    expect(q('ri-nuovo')).toBeNull()
    expect(q('ri-genera')).toBeNull()
    expect(q('ri-emetti')).toBeNull()
    expect(q('ri-azioni-r1')).toBeNull()
    // la distinta e la stampa dei FIR sono letture: le vedono tutti
    expect(q('ri-distinta')).not.toBeNull()
    expect(q('ri-stampa-fir')).not.toBeNull()
    expect(q<HTMLInputElement>('ri-sel-r2')!.disabled).toBeFalse()
    expect(q('ri-sel-tutti')).not.toBeNull()
  })

  it('un lettore stampa i FIR dei ritiri spuntati', async () => {
    await crea('VIEWER')
    spyOn(URL, 'createObjectURL').and.returnValue('blob:x')
    spyOn(HTMLAnchorElement.prototype, 'click').and.stub()
    servizio.stampaFir.and.returnValue(of(new HttpResponse({ body: new Blob(['%PDF']) })))
    q<HTMLInputElement>('ri-sel-r2')!.click()
    fixture.detectChanges()
    bottone('ri-stampa-fir')!.click()
    expect(servizio.stampaFir).toHaveBeenCalledOnceWith(['r2'], 'mf1')
  })

  it('la vista vuota copre tutte le colonne anche per un lettore', async () => {
    await crea('VIEWER', [])
    const c = fixture.componentInstance
    const intestazioni = document.body.querySelectorAll('thead th').length
    expect(intestazioni).toBeGreaterThan(0)
    expect(Number(q('ri-vuota')!.getAttribute('colspan'))).toBe(intestazioni)
    expect(c.colonneTotali()).toBe(intestazioni)
  })

  it('il menu del modello FIR offre i modelli FIR e generali, con il predefinito scelto', async () => {
    await crea()
    const menu = q<HTMLSelectElement>('ri-modello-fir')!
    expect(Array.from(menu.options).map(o => o.value)).toEqual(['', 'mf1', 'mf2', 'mg'])
    expect(menu.value).toBe('mf1')
    spyOn(URL, 'createObjectURL').and.returnValue('blob:x')
    spyOn(HTMLAnchorElement.prototype, 'click').and.stub()
    servizio.stampaFir.and.returnValue(of(new HttpResponse({ body: new Blob(['%PDF']) })))
    menu.value = 'mf2'
    menu.dispatchEvent(new Event('change'))
    q<HTMLInputElement>('ri-sel-r2')!.click()
    fixture.detectChanges()
    bottone('ri-stampa-fir')!.click()
    expect(servizio.stampaFir).toHaveBeenCalledOnceWith(['r2'], 'mf2')
  })

  it('senza modello predefinito il menu mostra «Modello predefinito» e la stampa parte senza modello', async () => {
    await crea()
    modelli.elenco.and.returnValue(of(MODELLI.map(m => ({ ...m, predefinito: false }))))
    fixture.componentInstance.caricaModelli()
    fixture.detectChanges()
    const menu = q<HTMLSelectElement>('ri-modello-fir')!
    expect(menu.value).toBe('')
    expect(menu.selectedOptions[0].textContent).toContain('Modello predefinito')
    servizio.stampaFir.and.returnValue(of(new HttpResponse({ body: new Blob(['%PDF']) })))
    spyOn(URL, 'createObjectURL').and.returnValue('blob:x')
    spyOn(HTMLAnchorElement.prototype, 'click').and.stub()
    q<HTMLInputElement>('ri-sel-r2')!.click()
    fixture.detectChanges()
    bottone('ri-stampa-fir')!.click()
    expect(servizio.stampaFir).toHaveBeenCalledOnceWith(['r2'], undefined)
  })

  it('si torna al «Modello predefinito» scegliendo la voce vuota', async () => {
    await crea()
    const menu = q<HTMLSelectElement>('ri-modello-fir')!
    menu.value = ''
    menu.dispatchEvent(new Event('change'))
    servizio.stampaFir.and.returnValue(of(new HttpResponse({ body: new Blob(['%PDF']) })))
    spyOn(URL, 'createObjectURL').and.returnValue('blob:x')
    spyOn(HTMLAnchorElement.prototype, 'click').and.stub()
    q<HTMLInputElement>('ri-sel-r2')!.click()
    fixture.detectChanges()
    bottone('ri-stampa-fir')!.click()
    expect(servizio.stampaFir).toHaveBeenCalledOnceWith(['r2'], undefined)
  })

  it('Distinta senza modello predefinito: voce «Modello predefinito» e nessun modelloId', async () => {
    await crea()
    modelli.elenco.and.returnValue(of(MODELLI.map(m => ({ ...m, predefinito: false }))))
    spyOn(URL, 'createObjectURL').and.returnValue('blob:x')
    spyOn(HTMLAnchorElement.prototype, 'click').and.stub()
    servizio.distinta.and.returnValue(of(new HttpResponse({ body: new Blob(['%PDF']) })))
    fixture.componentInstance.filtri.dal = '2026-12-01'
    bottone('ri-distinta')!.click()
    fixture.detectChanges()
    await fixture.whenStable()
    fixture.detectChanges()
    const menu = q<HTMLSelectElement>('di-modello')!
    expect(menu.selectedOptions[0].textContent).toContain('Modello predefinito')
    bottone('di-scarica')!.click()
    expect(servizio.distinta).toHaveBeenCalledOnceWith('2026-12-01', undefined, undefined)
  })

  it('Distinta: il menu offre i modelli della distinta e passa quello scelto', async () => {
    await crea()
    spyOn(URL, 'createObjectURL').and.returnValue('blob:x')
    spyOn(HTMLAnchorElement.prototype, 'click').and.stub()
    servizio.distinta.and.returnValue(of(new HttpResponse({ body: new Blob(['%PDF']) })))
    fixture.componentInstance.filtri.dal = '2026-12-01'
    bottone('ri-distinta')!.click()
    fixture.detectChanges()
    await fixture.whenStable()
    fixture.detectChanges()
    const menu = q<HTMLSelectElement>('di-modello')!
    expect(Array.from(menu.options).map(o => o.value)).toEqual(['', 'mg', 'md1', 'md2'])
    expect(menu.value).toBe('md1')
    menu.value = 'md2'
    menu.dispatchEvent(new Event('change'))
    bottone('di-scarica')!.click()
    expect(servizio.distinta).toHaveBeenCalledOnceWith('2026-12-01', undefined, 'md2')
  })

  it('senza modelli leggibili la stampa parte senza modello (predefinito del server)', async () => {
    await crea()
    modelli.elenco.and.returnValue(throwError(() => ({ status: 403 })))
    fixture.componentInstance.caricaModelli()
    fixture.detectChanges()
    expect(q('ri-modello-fir')).toBeNull()
    servizio.stampaFir.and.returnValue(of(new HttpResponse({ body: new Blob(['%PDF']) })))
    spyOn(URL, 'createObjectURL').and.returnValue('blob:x')
    spyOn(HTMLAnchorElement.prototype, 'click').and.stub()
    q<HTMLInputElement>('ri-sel-r2')!.click()
    fixture.detectChanges()
    bottone('ri-stampa-fir')!.click()
    expect(servizio.stampaFir).toHaveBeenCalledOnceWith(['r2'], undefined)
  })

  it('senza ritiri mostra il messaggio e nessun paginatore', async () => {
    await crea('ADMIN', [])
    expect(q('ri-vuota')?.textContent).toContain('Nessun ritiro')
    expect(document.body.querySelector('.p-paginator')).toBeNull()
  })

  it('un errore di lettura si mostra in un avviso', async () => {
    await crea()
    servizio.elenca.and.returnValue(throwError(() => ({ status: 500 })))
    fixture.componentInstance.carica()
    fixture.detectChanges()
    expect(q('ri-errore')?.textContent).toContain('Impossibile leggere i ritiri')
  })
})
