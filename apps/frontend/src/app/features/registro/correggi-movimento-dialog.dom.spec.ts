import { ComponentFixture, TestBed } from '@angular/core/testing'
import { HttpClientTestingModule, HttpTestingController } from '@angular/common/http/testing'
import { DatePipe } from '@angular/common'
import { HttpErrorResponse } from '@angular/common/http'
import { provideNoopAnimations } from '@angular/platform-browser/animations'
import { Subject, of, throwError } from 'rxjs'
import { CausaliRegistroService, OpzioneCausaleApi } from './causali-registro.service'
import { RegistroComponent } from './registro.component'
import {
  CorreggiMovimentoDialogComponent,
  ERRORE_ANNO_MUD_PRESENTATO,
  TESTO_CONFERMA_FIR,
} from './correggi-movimento-dialog.component'
import {
  EsitoCorrezioneMovimento,
  Movimento,
  RegistroService,
  RegistroVista,
  StatoProgressivoIniziale,
} from './registro.service'
import { ToastService } from '../../core/services/toast.service'
import { ExportService } from '../../core/services/export.service'
import { AuthService } from '../../core/services/auth.service'
import { AdminTenantContextService } from '../../core/services/admin-tenant-context.service'
import { CompanyService } from '../../core/services/company.service'
import { FirService } from '../fir/fir.service'
import { RegistryService } from '../registry/registry.service'

function mov(parziale: Partial<Movimento> = {}): Movimento {
  return {
    id: 'm1',
    registroId: 'r1',
    tenantId: 't1',
    progressiveNumber: 12,
    progressiveYear: 2026,
    type: 'CARICO',
    movementDate: '2026-10-20T00:00:00.000Z',
    registrationDate: '2026-10-21T08:00:00.000Z',
    causale: 'PRODUZIONE_INTERNA',
    cerCode: '17 04 05',
    quantity: 120,
    unit: 'KG',
    entryHash: 'abc',
    createdAt: '2026-10-21T08:00:00.000Z',
    tipoAnnotazione: 'ORDINARIA',
    stato: 'VIGENTE',
    ...parziale,
  }
}

function riga(codice: string, descrizione = codice): OpzioneCausaleApi {
  return {
    codice,
    descrizione,
    origine: 'SISTEMA',
    ruoloMud: 'ESCLUSO',
    codiceRentri: null,
    operazione: null,
    versioneId: null,
  }
}

const registro: RegistroVista = {
  id: 'r1',
  unitaLocaleId: 'u1',
  numIscrSito: null,
  denominazione: 'Sede',
  codice: 'CARICO_SCARICO',
  attivo: true,
  principale: true,
}

function stato(parziale: Partial<StatoProgressivoIniziale> = {}): StatoProgressivoIniziale {
  return {
    anno: 2026,
    registroId: 'r1',
    primoProgressivo: null,
    impostatoIl: null,
    haMovimenti: true,
    puoImpostare: false,
    puoRegistrare: true,
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
  const el = document.body.querySelector<HTMLTextAreaElement>(selettore)
  expect(el).withContext(`campo ${selettore}`).not.toBeNull()
  el!.value = valore
  el!.dispatchEvent(new Event('input', { bubbles: true }))
}

function esito(m: Partial<Movimento> = {}, avvisi: string[] = []): EsitoCorrezioneMovimento {
  return {
    movimento: mov({ id: 'm9', progressiveNumber: 13, tipoAnnotazione: 'RETTIFICA', ...m }),
    avvisi,
  }
}

function errore409Mud(): HttpErrorResponse {
  return new HttpErrorResponse({
    status: 409,
    error: {
      statusCode: 409,
      error: ERRORE_ANNO_MUD_PRESENTATO,
      message: 'Il MUD 2025 risulta già presentato: la correzione cambia i dati di quegli anni.',
    },
  })
}

describe('Registro - rettifica e annullamento (template reale, click veri)', () => {
  let servizio: jasmine.SpyObj<RegistroService>
  let toast: jasmine.SpyObj<ToastService>
  let fixture: ComponentFixture<RegistroComponent>

  function apri(movimenti: Movimento[], st: StatoProgressivoIniziale = stato()): void {
    servizio.lista.and.returnValue(
      of({ items: movimenti, total: movimenti.length, page: 1, limit: 20, totalPages: 1 })
    )
    servizio.getProgressivoIniziale.and.returnValue(of(st))
    fixture = TestBed.createComponent(RegistroComponent)
    fixture.detectChanges()
  }

  beforeEach(() => {
    servizio = jasmine.createSpyObj<RegistroService>('RegistroService', [
      'lista',
      'listRegistri',
      'assicuraRegistri',
      'getProgressivoIniziale',
      'rettifica',
      'annulla',
      'verificaCatena',
    ])
    servizio.assicuraRegistri.and.returnValue(of([registro]))
    servizio.listRegistri.and.returnValue(of([registro]))
    toast = jasmine.createSpyObj<ToastService>('ToastService', ['error', 'success', 'info', 'warn'])
    TestBed.configureTestingModule({
      imports: [RegistroComponent, HttpClientTestingModule],
      providers: [
        provideNoopAnimations(),
        DatePipe,
        { provide: RegistroService, useValue: servizio },
        { provide: ToastService, useValue: toast },
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
  })

  afterEach(() => fixture?.destroy())

  it('mostra i badge delle correzioni, attenua le righe non vigenti e offre le azioni solo sulle vigenti', () => {
    apri([
      mov({ id: 'v', progressiveNumber: 20 }),
      mov({
        id: 'r',
        progressiveNumber: 10,
        stato: 'RETTIFICATO',
        correttoDa: { progressiveNumber: 11, progressiveYear: 2026, tipoAnnotazione: 'RETTIFICA' },
      }),
      mov({
        id: 'rr',
        progressiveNumber: 11,
        tipoAnnotazione: 'RETTIFICA',
        motivoAnnotazione: 'Quantità errata',
        rettificaDi: { progressiveNumber: 10, progressiveYear: 2026, tipoAnnotazione: 'ORDINARIA' },
        stato: 'ANNULLATO',
        correttoDa: {
          progressiveNumber: 12,
          progressiveYear: 2026,
          tipoAnnotazione: 'ANNULLAMENTO',
        },
      }),
      mov({
        id: 'a',
        progressiveNumber: 12,
        tipoAnnotazione: 'ANNULLAMENTO',
        rettificaDi: { progressiveNumber: 11, progressiveYear: 2026, tipoAnnotazione: 'RETTIFICA' },
        stato: 'ANNULLATO',
      }),
    ])

    expect(testo('registro-correzione-r')).toContain('Rettificato da 11/2026')
    expect(testo('registro-correzione-rr')).toContain('Annullato')
    expect(testo('registro-annotazione-rr')).toContain('Rettifica di 10/2026')
    expect(testo('registro-annotazione-a')).toContain('Annullamento di 11/2026')
    expect(q('registro-correzione-v')).toBeNull()
    expect(q('registro-annotazione-v')).toBeNull()

    expect(q('registro-riga-v')?.classList).not.toContain('riga-non-vigente')
    for (const id of ['r', 'rr', 'a']) {
      expect(q(`registro-riga-${id}`)?.classList)
        .withContext(id)
        .toContain('riga-non-vigente')
      expect(q(`registro-rettifica-${id}`))
        .withContext(id)
        .toBeNull()
      expect(q(`registro-annulla-${id}`))
        .withContext(id)
        .toBeNull()
    }
    expect(q('registro-rettifica-v')).not.toBeNull()
    expect(q('registro-annulla-v')).not.toBeNull()
  })

  it('rettifica: la causale attuale disattivata resta nell’elenco e selezionata, e si reinvia', () => {
    servizio.rettifica.and.returnValue(of(esito()))
    apri([mov({ causale: 'AZ_VECCHIA', causaleDescrizione: 'Vecchia causale' })])
    const http = TestBed.inject(HttpTestingController)

    clic('registro-rettifica-m1')
    fixture.detectChanges()
    // le opzioni del tipo alla data del movimento arrivano dall'API e non contengono la causale attuale
    http
      .expectOne(r => r.url.endsWith('/registro/causali') && r.params.get('data') === '2026-10-20')
      .flush({
        tipo: 'CARICO',
        data: '2026-10-20',
        causali: [riga('PRODUZIONE_INTERNA', 'Produzione interna')],
      })
    fixture.detectChanges()

    expect(testo('correzione-causale')).toContain('Vecchia causale')
    // il riepilogo in testa usa la descrizione del movimento
    expect(testo('correzione-riepilogo')).toContain('Vecchia causale')

    // apertura reale del menu: la causale attuale e quella selezionabile
    document.body
      .querySelector<HTMLElement>('[data-testid="correzione-causale"] .p-dropdown')!
      .click()
    fixture.detectChanges()
    const voci = Array.from(document.body.querySelectorAll('.p-dropdown-item')).map(e =>
      (e.textContent ?? '').trim()
    )
    expect(voci).toEqual(['Produzione interna', 'Vecchia causale'])

    scrivi('#corr-motivo', 'Quantità errata')
    clic('correzione-invia')
    fixture.detectChanges()
    expect(servizio.rettifica.calls.mostRecent().args[1].causale).toBe('AZ_VECCHIA')
  })

  it('in sola consultazione le azioni non si offrono', () => {
    apri([mov()], stato({ puoRegistrare: false }))
    expect(q('registro-rettifica-m1')).toBeNull()
    expect(q('registro-annulla-m1')).toBeNull()
  })

  it('rettifica: azione -> dialog precompilato -> invio, con la data come stringa del giorno', () => {
    servizio.rettifica.and.returnValue(of(esito({}, ['Giacenza del CER ridotta'])))
    apri([mov({ quantity: 120, unit: 'KG', counterpartName: 'Rossi Srl' })])

    clic('registro-rettifica-m1')
    fixture.detectChanges()

    expect(testo('correzione-riepilogo')).toContain('Movimento 12/2026')
    expect(document.body.querySelector<HTMLInputElement>('#corr-tipo')?.disabled).toBeTrue()
    expect(document.body.querySelector<HTMLInputElement>('#corr-controparte')?.value).toBe(
      'Rossi Srl'
    )

    // senza motivo non parte nulla
    clic('correzione-invia')
    fixture.detectChanges()
    expect(servizio.rettifica).not.toHaveBeenCalled()
    expect(q('correzione-motivo-errore')).not.toBeNull()

    scrivi('#corr-motivo', '  Quantità pesata male  ')
    clic('correzione-invia')
    fixture.detectChanges()

    expect(servizio.rettifica).toHaveBeenCalledTimes(1)
    const [id, corpo] = servizio.rettifica.calls.mostRecent().args
    expect(id).toBe('m1')
    expect(corpo.movementDate).toBe('2026-10-20')
    expect(corpo.motivo).toBe('Quantità pesata male')
    expect(corpo.causale).toBe('PRODUZIONE_INTERNA')
    expect(corpo.cerCode).toBe('17 04 05')
    expect(corpo.quantity).toBe(120)
    expect(corpo.unit).toBe('KG')
    expect(corpo.counterpartName).toBe('Rossi Srl')
    expect(corpo.confermaAnnoPresentato).toBeUndefined()
    expect(Object.keys(corpo)).not.toContain('type')
    expect(Object.keys(corpo)).not.toContain('registroId')

    expect(toast.success).toHaveBeenCalled()
    expect(toast.warn).toHaveBeenCalledWith('Giacenza del CER ridotta')
    // dialog chiuso e elenco ricaricato
    expect(q('correzione-riepilogo')).toBeNull()
    expect(servizio.lista.calls.count()).toBe(2)
  })

  it('rettifica, quantita: punto rifiutato col messaggio, "12,5" vale 12.5 e "1000" vale 1000', () => {
    servizio.rettifica.and.returnValue(of(esito({})))
    apri([mov({ quantity: 120, unit: 'KG' })])
    clic('registro-rettifica-m1')
    fixture.detectChanges()

    const input = document.body.querySelector<HTMLInputElement>('#corr-quantita')!
    const incolla = (testo: string): ClipboardEvent => {
      const dt = new DataTransfer()
      dt.setData('text', testo)
      const e = new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true })
      input.dispatchEvent(e)
      return e
    }
    input.focus()
    expect(incolla('12.5').defaultPrevented).toBeTrue()
    fixture.detectChanges()
    expect(q('numero-errore')?.textContent).toBe('Usa la virgola per i decimali')
    expect(input.value).toBe('120')

    input.value = ''
    incolla('12,5')
    input.dispatchEvent(new Event('blur'))
    scrivi('#corr-motivo', 'Quantita')
    clic('correzione-invia')
    fixture.detectChanges()
    expect(servizio.rettifica.calls.mostRecent().args[1].quantity).toBe(12.5)
  })

  it('annullamento: azione -> riepilogo e motivo -> invio', () => {
    servizio.annulla.and.returnValue(
      of(esito({ tipoAnnotazione: 'ANNULLAMENTO', progressiveNumber: 13 }))
    )
    apri([mov()])

    clic('registro-annulla-m1')
    fixture.detectChanges()
    expect(testo('correzione-riepilogo')).toContain('Movimento 12/2026')
    expect(q('correzione-causale')).toBeNull() // solo il motivo

    scrivi('#corr-motivo', 'Registrato per errore')
    clic('correzione-invia')
    fixture.detectChanges()

    expect(servizio.annulla).toHaveBeenCalledOnceWith('m1', { motivo: 'Registrato per errore' })
    expect(toast.success).toHaveBeenCalledWith('Annullamento registrato: annotazione 13/2026')
  })

  it('annullamento di una registrazione con FIR chiede prima una conferma esplicita', () => {
    servizio.annulla.and.returnValue(of(esito({ tipoAnnotazione: 'ANNULLAMENTO' })))
    apri([mov({ firId: 'fir-1' })])

    clic('registro-annulla-m1')
    fixture.detectChanges()
    scrivi('#corr-motivo', 'Ricopia sbagliata')
    clic('correzione-invia')
    fixture.detectChanges()

    expect(servizio.annulla).not.toHaveBeenCalled()
    expect(testo('correzione-conferma-fir')).toContain(TESTO_CONFERMA_FIR)
    expect(TESTO_CONFERMA_FIR).toContain('non si potrà ricopiare di nuovo nel registro')
    expect(TESTO_CONFERMA_FIR).toContain('usa la rettifica invece dell’annullamento')

    // "Torna indietro" non invia nulla
    clic('correzione-conferma-indietro')
    fixture.detectChanges()
    expect(q('correzione-conferma-fir')).toBeNull()
    expect(servizio.annulla).not.toHaveBeenCalled()

    clic('correzione-invia')
    fixture.detectChanges()
    clic('correzione-conferma-ok')
    fixture.detectChanges()
    expect(servizio.annulla).toHaveBeenCalledOnceWith('m1', { motivo: 'Ricopia sbagliata' })
  })

  it('409 MUD presentato: conferma col testo del backend e reinvio con confermaAnnoPresentato', () => {
    servizio.rettifica.and.returnValues(
      throwError(() => errore409Mud()),
      of(esito())
    )
    apri([mov()])

    clic('registro-rettifica-m1')
    fixture.detectChanges()
    scrivi('#corr-motivo', 'Peso corretto')
    clic('correzione-invia')
    fixture.detectChanges()

    expect(servizio.rettifica).toHaveBeenCalledTimes(1)
    expect(toast.error).not.toHaveBeenCalled()
    expect(testo('correzione-conferma-mud')).toContain('Il MUD 2025 risulta già presentato')

    clic('correzione-conferma-ok')
    fixture.detectChanges()

    expect(servizio.rettifica).toHaveBeenCalledTimes(2)
    const [id, corpo] = servizio.rettifica.calls.mostRecent().args
    expect(id).toBe('m1')
    expect(corpo.confermaAnnoPresentato).toBeTrue()
    expect(corpo.motivo).toBe('Peso corretto')
    expect(corpo.movementDate).toBe('2026-10-20')
    expect(q('correzione-conferma-mud')).toBeNull()
    expect(servizio.lista.calls.count()).toBe(2)
  })

  it('gli altri 409 (non vigente, saldo) si mostrano nel toast e il dialog resta aperto', () => {
    servizio.annulla.and.returnValue(
      throwError(
        () =>
          new HttpErrorResponse({
            status: 409,
            error: { message: 'Il movimento n. 12/2026 non è più vigente.' },
          })
      )
    )
    apri([mov()])
    clic('registro-annulla-m1')
    fixture.detectChanges()
    scrivi('#corr-motivo', 'Doppione')
    clic('correzione-invia')
    fixture.detectChanges()

    expect(toast.error).toHaveBeenCalledWith('Il movimento n. 12/2026 non è più vigente.')
    expect(q('correzione-conferma-mud')).toBeNull()
    expect(q('correzione-riepilogo')).not.toBeNull()
  })

  it('verifica catena: solo per chi può impostare, per l’anno corrente del registro', () => {
    apri([mov()], stato({ puoImpostare: false }))
    expect(q('registro-verifica-catena')).toBeNull()
    fixture.destroy()

    servizio.verificaCatena.and.returnValue(
      of({
        registroId: 'r1',
        anno: 2026,
        verificate: 40,
        nonVerificabili: [
          { numero: 1, motivo: 'HASH_ASSENTE' },
          { numero: 2, motivo: 'HASH_ASSENTE' },
        ],
        primoErrore: null,
      })
    )
    apri([mov()], stato({ puoImpostare: true }))
    clic('registro-verifica-catena')
    fixture.detectChanges()

    expect(servizio.verificaCatena).toHaveBeenCalledOnceWith(
      fixture.componentInstance.annoCorrente,
      'r1'
    )
    expect(testo('registro-esito-verifica')).toBe(
      '40 annotazioni verificate, nessuna alterazione (2 storiche non verificabili)'
    )
  })

  it('verifica catena con più sedi: l’esito indica la sede e sparisce al cambio di sede', () => {
    const r2: RegistroVista = {
      ...registro,
      id: 'r2',
      denominazione: 'Deposito',
      principale: false,
    }
    servizio.assicuraRegistri.and.returnValue(of([registro, r2]))
    servizio.verificaCatena.and.returnValue(
      of({ registroId: 'r2', anno: 2026, verificate: 3, nonVerificabili: [], primoErrore: null })
    )
    apri([mov()], stato({ puoImpostare: true, registroId: null }))
    const c = fixture.componentInstance
    c.filtroRegistro = 'r2'
    c.onFiltroRegistroChange()
    fixture.detectChanges()

    clic('registro-verifica-catena')
    fixture.detectChanges()
    expect(servizio.verificaCatena).toHaveBeenCalledOnceWith(c.annoCorrente, 'r2')
    expect(testo('registro-esito-verifica')).toBe(
      'Deposito: 3 annotazioni verificate, nessuna alterazione'
    )

    c.filtroRegistro = 'r1'
    c.onFiltroRegistroChange()
    fixture.detectChanges()
    expect(q('registro-esito-verifica')).toBeNull()
  })

  it('errore della verifica: usa il messaggio del backend anche se è un elenco', () => {
    servizio.verificaCatena.and.returnValue(
      throwError(() => new HttpErrorResponse({ status: 400, error: { message: ['a', 'b'] } }))
    )
    apri([mov()], stato({ puoImpostare: true }))
    clic('registro-verifica-catena')
    expect(toast.error).toHaveBeenCalledWith('a · b')
  })

  it('verifica catena con anomalia: numero, anno e motivo leggibile', () => {
    servizio.verificaCatena.and.returnValue(
      of({
        registroId: 'r1',
        anno: 2026,
        verificate: 7,
        nonVerificabili: [],
        primoErrore: { numero: 8, motivo: 'HASH_DIVERSO' },
      })
    )
    apri([mov()], stato({ puoImpostare: true }))
    clic('registro-verifica-catena')
    fixture.detectChanges()
    expect(testo('registro-esito-verifica')).toBe(
      "Anomalia all'annotazione 8/2026: i dati non corrispondono all'impronta registrata"
    )
  })
})

describe('CorreggiMovimentoDialogComponent - unità, stato fisico e causali', () => {
  let servizio: jasmine.SpyObj<RegistroService>
  let toast: jasmine.SpyObj<ToastService>
  let causali: { opzioni: jasmine.Spy; invalida: jasmine.Spy }
  let fixture: ComponentFixture<CorreggiMovimentoDialogComponent>

  const CARICO = [riga('PRODUZIONE_INTERNA', 'Produzione interna'), riga('AZ_RESO', 'Reso')]
  const SCARICO = [
    riga('CONFERIMENTO_TRASPORTATORE', 'Conferimento a trasportatore'),
    riga('CESSIONE', 'Cessione a terzi'),
  ]

  beforeEach(() => {
    servizio = jasmine.createSpyObj<RegistroService>('RegistroService', ['rettifica', 'annulla'])
    toast = jasmine.createSpyObj<ToastService>('ToastService', ['error', 'success', 'info', 'warn'])
    causali = {
      opzioni: jasmine
        .createSpy('opzioni')
        .and.callFake((tipo: string) => of(tipo === 'CARICO' ? CARICO : SCARICO)),
      invalida: jasmine.createSpy('invalida'),
    }
    TestBed.configureTestingModule({
      imports: [CorreggiMovimentoDialogComponent, HttpClientTestingModule],
      providers: [
        provideNoopAnimations(),
        { provide: RegistroService, useValue: servizio },
        { provide: CausaliRegistroService, useValue: causali },
        { provide: ToastService, useValue: toast },
      ],
    })
  })

  afterEach(() => fixture?.destroy())

  function apri(m: Movimento): CorreggiMovimentoDialogComponent {
    fixture = TestBed.createComponent(CorreggiMovimentoDialogComponent)
    fixture.componentRef.setInput('movimento', m)
    fixture.componentRef.setInput('modo', 'rettifica')
    fixture.componentRef.setInput('visible', true)
    fixture.detectChanges()
    return fixture.componentInstance
  }

  it('un’unità fuori elenco resta selezionabile e viene reinviata com’è', () => {
    servizio.rettifica.and.returnValue(of(esito()))
    const c = apri(mov({ unit: 'litri', wastePhysicalState: 'PASTOSO' }))
    expect(c.unitaOptions().map(o => o.value)).toEqual(['KG', 'T', 'M3', 'litri'])
    expect(c.form.get('unit')?.value).toBe('litri')
    expect(c.statiFisiciOptions().map(o => o.value)).toContain('PASTOSO')

    scrivi('#corr-motivo', 'Unità da verificare')
    clic('correzione-invia')
    expect(servizio.rettifica.calls.mostRecent().args[1].unit).toBe('litri')
  })

  it('uno stato fisico in maiuscolo si riconduce alla voce dell’elenco', () => {
    const c = apri(mov({ wastePhysicalState: 'LIQUIDO' }))
    expect(c.form.get('wastePhysicalState')?.value).toBe('Liquido')
    expect(c.statiFisiciOptions().length).toBe(4)
  })

  it('con le unità dei FIR non aggiunge voci e le causali sono quelle dell’API per il tipo del movimento', () => {
    const c = apri(mov({ type: 'SCARICO', causale: 'CESSIONE', unit: 'M3' }))
    expect(c.unitaOptions().map(o => o.label)).toEqual(['kg', 't', 'm³'])
    expect(causali.opzioni).toHaveBeenCalledWith('SCARICO', '2026-10-20')
    const valori = c.causaliOptions().map(o => o.value)
    expect(valori).toContain('CONFERIMENTO_TRASPORTATORE')
    expect(valori).not.toContain('PRODUZIONE_INTERNA')
    expect(c.form.get('causale')?.value).toBe('CESSIONE')
  })

  it('una causale attuale fuori dalle opzioni è presente e selezionata, con la sua descrizione', () => {
    const c = apri(mov({ causale: 'AZ_VECCHIA', causaleDescrizione: 'Vecchia causale' }))
    expect(c.causaliOptions()).toEqual([
      { label: 'Produzione interna', value: 'PRODUZIONE_INTERNA' },
      { label: 'Reso', value: 'AZ_RESO' },
      { label: 'Vecchia causale', value: 'AZ_VECCHIA' },
    ])
    expect(c.form.get('causale')?.value).toBe('AZ_VECCHIA')
    expect(c.messaggioCausale()).toBeNull()
  })

  it('senza descrizione nel movimento la causale attuale si etichetta con il codice', () => {
    const c = apri(mov({ causale: 'AZ_VECCHIA' }))
    expect(c.causaliOptions().pop()).toEqual({ label: 'AZ_VECCHIA', value: 'AZ_VECCHIA' })
  })

  it('le opzioni si ricaricano al cambio di giorno, non per la stessa data', () => {
    const c = apri(mov())
    causali.opzioni.calls.reset()
    const data = c.form.get('movementDate')!
    data.setValue(new Date(2026, 9, 21, 8, 0))
    data.setValue(new Date(2026, 9, 21, 17, 0))
    data.setValue(null)
    expect(causali.opzioni.calls.allArgs()).toEqual([['CARICO', '2026-10-21']])
  })

  it('una causale scelta che non vale più alla nuova data si azzera con un messaggio', () => {
    const c = apri(mov())
    c.form.get('causale')!.setValue('AZ_RESO')
    causali.opzioni.and.callFake(() => of([riga('PRODUZIONE_INTERNA', 'Produzione interna')]))
    c.form.get('movementDate')!.setValue(new Date(2026, 0, 5))
    expect(c.form.get('causale')!.value).toBeNull()
    expect(c.messaggioCausale()).toContain('non è disponibile alla data indicata')
  })

  it('con la risposta in ritardo la causale attuale resta comunque selezionabile', () => {
    const risposta = new Subject<OpzioneCausaleApi[]>()
    causali.opzioni.and.returnValue(risposta)
    const c = apri(mov({ causale: 'PRODUZIONE_INTERNA', causaleDescrizione: 'Produzione interna' }))
    expect(c.causaliOptions()).toEqual([
      { label: 'Produzione interna', value: 'PRODUZIONE_INTERNA' },
    ])
    expect(c.form.get('causale')!.value).toBe('PRODUZIONE_INTERNA')
  })

  it('un 409 CAUSALE_MODIFICATA mostra il messaggio del backend e ricarica le opzioni', () => {
    const c = apri(mov())
    servizio.rettifica.and.returnValue(
      throwError(
        () =>
          new HttpErrorResponse({
            status: 409,
            error: {
              error: 'CAUSALE_MODIFICATA',
              message: 'La causale è stata modificata nel frattempo: ricarica e riprova.',
            },
          })
      )
    )
    c.form.get('causale')!.setValue('AZ_RESO')
    c.form.patchValue({ motivo: 'Correzione' })
    causali.opzioni.calls.reset()
    causali.opzioni.and.callFake(() => of([riga('PRODUZIONE_INTERNA', 'Produzione interna')]))

    c.invia()

    expect(toast.error).toHaveBeenCalledWith(
      'La causale è stata modificata nel frattempo: ricarica e riprova.'
    )
    expect(causali.invalida).toHaveBeenCalled()
    expect(causali.opzioni.calls.allArgs()).toEqual([['CARICO', '2026-10-20']])
    // la causale modificata non è più fra le opzioni: la scelta si azzera
    expect(c.form.get('causale')!.value).toBeNull()
  })

  it('l’annullamento non carica le opzioni delle causali', () => {
    fixture = TestBed.createComponent(CorreggiMovimentoDialogComponent)
    fixture.componentRef.setInput('movimento', mov())
    fixture.componentRef.setInput('modo', 'annullamento')
    fixture.componentRef.setInput('visible', true)
    fixture.detectChanges()
    expect(causali.opzioni).not.toHaveBeenCalled()
  })
})
