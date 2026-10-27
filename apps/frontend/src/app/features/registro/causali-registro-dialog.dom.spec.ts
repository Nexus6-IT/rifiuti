import { ComponentFixture, TestBed, fakeAsync, flush, tick } from '@angular/core/testing'
import { HttpClientTestingModule, HttpTestingController } from '@angular/common/http/testing'
import { DatePipe } from '@angular/common'
import { provideNoopAnimations } from '@angular/platform-browser/animations'
import { of } from 'rxjs'
import { CausaliRegistroDialogComponent } from './causali-registro-dialog.component'
import {
  CausaleAziendaleGestione,
  CausaleSistemaGestione,
  CausaliRegistroService,
  GestioneCausali,
} from './causali-registro.service'
import { oggiItaliano } from './giacenze-iniziali-dialog.component'
import { RegistroComponent } from './registro.component'
import { RegistroService, RegistroVista, StatoProgressivoIniziale } from './registro.service'
import { ToastService } from '../../core/services/toast.service'
import { ExportService } from '../../core/services/export.service'
import { AuthService } from '../../core/services/auth.service'
import { AdminTenantContextService } from '../../core/services/admin-tenant-context.service'
import { CompanyService } from '../../core/services/company.service'
import { FirService } from '../fir/fir.service'
import { RegistryService } from '../registry/registry.service'
import { environment } from '../../../environments/environment'

const URL = `${environment.apiUrl}/registro/causali`

function sistema(parziale: Partial<CausaleSistemaGestione> = {}): CausaleSistemaGestione {
  return {
    codice: 'PRODUZIONE_INTERNA',
    verso: 'CARICO',
    descrizione: 'Produzione interna',
    ruoloMud: 'PRODOTTO',
    codiceRentri: 'DT',
    operazione: null,
    ordine: 10,
    attiva: true,
    disattivataPerAzienda: false,
    ...parziale,
  }
}

function propria(parziale: Partial<CausaleAziendaleGestione> = {}): CausaleAziendaleGestione {
  return {
    id: 'v1',
    codice: 'AZ_RESO',
    verso: 'CARICO',
    descrizione: 'Reso da cliente',
    ruoloMud: 'RICEVUTO_DA_TERZI',
    codiceRentri: 'T*',
    operazione: null,
    ordine: 100,
    validaDal: '2026-01-01',
    validaAl: null,
    usata: false,
    ultimoGiornoUso: null,
    ...parziale,
  }
}

const q = (testid: string): HTMLElement | null =>
  document.body.querySelector(`[data-testid="${testid}"]`)

const testo = (testid: string): string => (q(testid)?.textContent ?? '').replace(/\s+/g, ' ').trim()

const clic = (testid: string): void => {
  const b = document.body.querySelector<HTMLElement>(`[data-testid="${testid}"] button`)
  expect(b).withContext(`pulsante ${testid}`).not.toBeNull()
  b!.click()
}

function scrivi(selettore: string, valore: string): void {
  const el = document.body.querySelector<HTMLInputElement>(selettore)
  expect(el).withContext(`campo ${selettore}`).not.toBeNull()
  el!.value = valore
  el!.dispatchEvent(new Event('input', { bubbles: true }))
}

describe('CausaliRegistroDialogComponent (click veri, HTTP simulato)', () => {
  let http: HttpTestingController
  let servizio: CausaliRegistroService
  let toast: jasmine.SpyObj<ToastService>
  let fixture: ComponentFixture<CausaliRegistroDialogComponent>

  function apri(g: GestioneCausali): void {
    fixture = TestBed.createComponent(CausaliRegistroDialogComponent)
    fixture.componentRef.setInput('visible', true)
    fixture.detectChanges()
    http.expectOne(`${URL}/gestione`).flush(g)
    fixture.detectChanges()
  }

  /** Dopo una scrittura riuscita la vista si rilegge. */
  function rileggi(g: GestioneCausali): void {
    http.expectOne(`${URL}/gestione`).flush(g)
    fixture.detectChanges()
  }

  beforeEach(() => {
    toast = jasmine.createSpyObj<ToastService>('ToastService', ['error', 'success', 'info', 'warn'])
    TestBed.configureTestingModule({
      imports: [CausaliRegistroDialogComponent, HttpClientTestingModule],
      providers: [provideNoopAnimations(), { provide: ToastService, useValue: toast }],
    })
    http = TestBed.inject(HttpTestingController)
    servizio = TestBed.inject(CausaliRegistroService)
  })

  afterEach(() => {
    fixture?.destroy()
    http.verify()
  })

  it('disattiva una causale di sistema: PUT, cache invalidata e stato aggiornato', fakeAsync(() => {
    const invalida = spyOn(servizio, 'invalida').and.callThrough()
    apri({ sistema: [sistema()], aziendali: [] })
    expect(testo('cg-sistema-CARICO-PRODUZIONE_INTERNA')).toContain('Attiva')

    clic('cg-disattiva-CARICO-PRODUZIONE_INTERNA')
    const req = http.expectOne(`${URL}/sistema/CARICO/PRODUZIONE_INTERNA/disattivazione`)
    expect(req.request.method).toBe('PUT')
    req.flush(null, { status: 204, statusText: 'No Content' })
    expect(invalida).toHaveBeenCalled()

    rileggi({ sistema: [sistema({ disattivataPerAzienda: true })], aziendali: [] })
    expect(testo('cg-sistema-CARICO-PRODUZIONE_INTERNA')).toContain('Disattivata')
    expect(q('cg-riattiva-CARICO-PRODUZIONE_INTERNA')).not.toBeNull()
    expect(q('cg-disattiva-CARICO-PRODUZIONE_INTERNA')).toBeNull()
    expect(toast.success).toHaveBeenCalled()
    flush()
  }))

  it('crea una causale propria: form, invio e POST con i soli campi compilati', fakeAsync(() => {
    apri({ sistema: [], aziendali: [] })
    clic('cg-nuova')
    fixture.detectChanges()
    tick()
    expect(document.activeElement?.id).toBe('cg-codice')

    scrivi('#cg-codice', 'AZ_NUOVA')
    scrivi('#cg-descrizione', 'Nuova causale')
    fixture.detectChanges()
    clic('cg-invia')

    const req = http.expectOne(`${URL}/aziendali`)
    expect(req.request.method).toBe('POST')
    expect(req.request.body).toEqual({
      codice: 'AZ_NUOVA',
      verso: 'CARICO',
      descrizione: 'Nuova causale',
      ruoloMud: 'PRODOTTO',
    })
    req.flush(propria({ id: 'n1', codice: 'AZ_NUOVA', descrizione: 'Nuova causale' }))
    rileggi({
      sistema: [],
      aziendali: [propria({ id: 'n1', codice: 'AZ_NUOVA', descrizione: 'Nuova causale' })],
    })
    expect(q('cg-form')).toBeNull()
    expect(testo('cg-az-n1')).toContain('Nuova causale')
    flush()
  }))

  it("un codice senza prefisso AZ_ non parte e segnala l'errore accessibile", fakeAsync(() => {
    apri({ sistema: [], aziendali: [] })
    clic('cg-nuova')
    fixture.detectChanges()
    scrivi('#cg-codice', 'RESO')
    scrivi('#cg-descrizione', 'x')
    fixture.detectChanges()
    clic('cg-invia')
    fixture.detectChanges()
    http.expectNone(`${URL}/aziendali`)
    const campo = document.getElementById('cg-codice')!
    expect(campo.getAttribute('aria-invalid')).toBe('true')
    expect(campo.getAttribute('aria-describedby')).toBe('cg-codice-err')
    expect(document.getElementById('cg-codice-err')?.getAttribute('role')).toBe('alert')
    flush()
  }))

  it('modifica il ruolo di una causale usata: 409 del backend e proposta "Nuova versione"', fakeAsync(() => {
    const usata = propria({ usata: true, ultimoGiornoUso: '2026-03-10' })
    apri({ sistema: [], aziendali: [usata] })

    clic('cg-modifica-v1')
    fixture.detectChanges()
    tick()
    // ruolo scelto dal menu, con click veri
    document.querySelector<HTMLElement>('[data-testid="cg-ruolo"] .p-dropdown')!.click()
    fixture.detectChanges()
    const voce = Array.from(document.querySelectorAll<HTMLElement>('.p-dropdown-item')).find(e =>
      (e.textContent ?? '').includes('Escluso dal MUD')
    )
    expect(voce).withContext('voce Escluso dal MUD').toBeDefined()
    voce!.click()
    fixture.detectChanges()
    clic('cg-invia')

    const req = http.expectOne(`${URL}/aziendali/v1`)
    expect(req.request.method).toBe('PATCH')
    // solo il campo cambiato
    expect(req.request.body).toEqual({ ruoloMud: 'ESCLUSO' })
    const messaggio =
      'La causale è già stata usata: per cambiarne il ruolo crea una nuova versione.'
    req.flush(
      { statusCode: 409, error: 'CAUSALE_USATA_NUOVA_VERSIONE', message: messaggio },
      { status: 409, statusText: 'Conflict' }
    )
    rileggi({ sistema: [], aziendali: [usata] })
    expect(testo('cg-errore-testo')).toBe(messaggio)

    // la proposta apre la nuova versione con il ruolo già scelto
    clic('cg-proponi-versione')
    fixture.detectChanges()
    expect(testo('cg-form')).toContain('Nuova versione di AZ_RESO')
    clic('cg-invia')
    const post = http.expectOne(`${URL}/aziendali/v1/versioni`)
    expect(post.request.method).toBe('POST')
    expect(post.request.body.ruoloMud).toBe('ESCLUSO')
    // dopo l'ultimo uso e mai prima di oggi, come giorno senza fuso
    expect(post.request.body.validaDal).toBe(
      oggiItaliano() > '2026-03-11' ? oggiItaliano() : '2026-03-11'
    )
    post.flush(propria({ id: 'v2', ruoloMud: 'ESCLUSO' }))
    rileggi({ sistema: [], aziendali: [usata, propria({ id: 'v2', ruoloMud: 'ESCLUSO' })] })
    expect(q('cg-form')).toBeNull()
    flush()
  }))

  it("409 su una versione vecchia: la nuova versione parte dall'ultima della causale", fakeAsync(() => {
    const v1 = propria({
      id: 'v1',
      validaAl: '2026-05-31',
      usata: true,
      ultimoGiornoUso: '2026-05-20',
    })
    const v2 = propria({
      id: 'v2',
      validaDal: '2026-06-01',
      usata: true,
      ultimoGiornoUso: '2026-06-10',
    })
    apri({ sistema: [], aziendali: [v1, v2] })
    expect(q('cg-versione-v1')).toBeNull()
    clic('cg-modifica-v1')
    fixture.detectChanges()
    scrivi('#cg-descrizione', 'Altra descrizione')
    fixture.detectChanges()
    clic('cg-invia')
    const req = http.expectOne(`${URL}/aziendali/v1`)
    req.flush(
      { statusCode: 409, error: 'CAUSALE_USATA_NUOVA_VERSIONE', message: 'Versione già usata.' },
      { status: 409, statusText: 'Conflict' }
    )
    rileggi({ sistema: [], aziendali: [v1, v2] })
    clic('cg-proponi-versione')
    fixture.detectChanges()
    expect(testo('cg-form')).toContain('Nuova versione di AZ_RESO')
    clic('cg-invia')
    const post = http.expectOne(`${URL}/aziendali/v2/versioni`)
    expect(post.request.body.descrizione).toBe('Altra descrizione')
    post.flush(propria({ id: 'v3' }))
    rileggi({ sistema: [], aziendali: [v1, v2] })
    flush()
  }))

  it('"nessun codice RENTRI" in modifica invia null e nient\'altro', fakeAsync(() => {
    apri({ sistema: [], aziendali: [propria()] })
    clic('cg-modifica-v1')
    fixture.detectChanges()
    // la X del dropdown (showClear), con click vero
    const x = document.querySelector<HTMLElement>(
      '[data-testid="cg-rentri"] .p-dropdown-clear-icon'
    )
    expect(x).withContext('X del dropdown RENTRI').not.toBeNull()
    x!.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    fixture.detectChanges()
    clic('cg-invia')
    const req = http.expectOne(`${URL}/aziendali/v1`)
    expect(req.request.body).toEqual({ codiceRentri: null })
    req.flush(propria({ codiceRentri: null }))
    rileggi({ sistema: [], aziendali: [propria({ codiceRentri: null })] })
    flush()
  }))

  it('il 403 del backend alla lettura si mostra', fakeAsync(() => {
    fixture = TestBed.createComponent(CausaliRegistroDialogComponent)
    fixture.componentRef.setInput('visible', true)
    fixture.detectChanges()
    http.expectOne(`${URL}/gestione`).flush(
      {
        statusCode: 403,
        error: 'REGISTRO_CAUSALI_RISERVATE_AMMINISTRATORI',
        message: "Solo un amministratore dell'azienda può gestire le causali del registro.",
      },
      { status: 403, statusText: 'Forbidden' }
    )
    fixture.detectChanges()
    expect(testo('cg-errore-caricamento')).toContain('Solo un amministratore')
    flush()
  }))

  it('elimina con conferma: la versione mai usata parte con DELETE', fakeAsync(() => {
    apri({ sistema: [], aziendali: [propria()] })
    clic('cg-elimina-v1')
    fixture.detectChanges()
    tick()
    clic('cg-elimina-conferma-v1')
    const req = http.expectOne(`${URL}/aziendali/v1`)
    expect(req.request.method).toBe('DELETE')
    req.flush(null, { status: 204, statusText: 'No Content' })
    rileggi({ sistema: [], aziendali: [] })
    expect(q('cg-vuota')).not.toBeNull()
    flush()
  }))
})

describe('RegistroComponent - pulsante Causali', () => {
  function monta(puoImpostare: boolean): ComponentFixture<RegistroComponent> {
    const registro: RegistroVista = {
      id: 'r1',
      unitaLocaleId: 'u1',
      numIscrSito: null,
      denominazione: 'Sede',
      codice: 'CARICO_SCARICO',
      attivo: true,
      principale: true,
    }
    const stato: StatoProgressivoIniziale = {
      anno: 2026,
      registroId: 'r1',
      primoProgressivo: null,
      impostatoIl: null,
      haMovimenti: false,
      puoImpostare,
      puoRegistrare: true,
    }
    const servizio = jasmine.createSpyObj<RegistroService>('RegistroService', [
      'lista',
      'listRegistri',
      'assicuraRegistri',
      'getProgressivoIniziale',
    ])
    servizio.lista.and.returnValue(of({ items: [], total: 0, page: 1, limit: 20, totalPages: 0 }))
    servizio.getProgressivoIniziale.and.returnValue(of(stato))
    servizio.assicuraRegistri.and.returnValue(of([registro]))
    servizio.listRegistri.and.returnValue(of([registro]))
    const causali = jasmine.createSpyObj<CausaliRegistroService>('CausaliRegistroService', [
      'opzioni',
      'invalida',
      'gestione',
    ])
    causali.opzioni.and.returnValue(of([]))
    causali.gestione.and.returnValue(of({ sistema: [], aziendali: [] }))

    TestBed.configureTestingModule({
      imports: [RegistroComponent, HttpClientTestingModule],
      providers: [
        provideNoopAnimations(),
        DatePipe,
        { provide: RegistroService, useValue: servizio },
        { provide: CausaliRegistroService, useValue: causali },
        {
          provide: ToastService,
          useValue: jasmine.createSpyObj('ToastService', ['error', 'success', 'info', 'warn']),
        },
        {
          provide: ExportService,
          useValue: jasmine.createSpyObj('ExportService', [
            'exportRegistroToPDF',
            'exportRegistroToExcel',
          ]),
        },
        { provide: AuthService, useValue: { currentUser: () => null } },
        { provide: AdminTenantContextService, useValue: { selectedTenantName: () => 'Azienda' } },
        {
          provide: CompanyService,
          useValue: { loadActiveCompany: () => of(null), activeCompany: () => null },
        },
        { provide: FirService, useValue: { getFIRList: () => of({ items: [] }) } },
        { provide: RegistryService, useValue: { getProduttori: () => of({ items: [] }) } },
      ],
    })
    const f = TestBed.createComponent(RegistroComponent)
    f.detectChanges()
    return f
  }

  it("senza puoImpostare il pulsante non c'è", () => {
    const f = monta(false)
    expect(q('registro-causali')).toBeNull()
    f.destroy()
  })

  it('con puoImpostare il click apre la gestione e legge il catalogo', () => {
    const f = monta(true)
    expect(q('registro-causali')).not.toBeNull()
    clic('registro-causali')
    f.detectChanges()
    expect(q('cg-tabella-sistema')).not.toBeNull()
    f.destroy()
  })
})
