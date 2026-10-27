import { ComponentFixture, TestBed } from '@angular/core/testing'
import { HttpClientTestingModule } from '@angular/common/http/testing'
import { DatePipe } from '@angular/common'
import { HttpErrorResponse } from '@angular/common/http'
import { provideNoopAnimations } from '@angular/platform-browser/animations'
import { of, throwError } from 'rxjs'
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
    expect(toast.success).toHaveBeenCalledWith('Annullamento registrata: annotazione 13/2026')
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

describe('CorreggiMovimentoDialogComponent - unità e stato fisico storici', () => {
  let servizio: jasmine.SpyObj<RegistroService>
  let fixture: ComponentFixture<CorreggiMovimentoDialogComponent>

  beforeEach(() => {
    servizio = jasmine.createSpyObj<RegistroService>('RegistroService', ['rettifica', 'annulla'])
    TestBed.configureTestingModule({
      imports: [CorreggiMovimentoDialogComponent, HttpClientTestingModule],
      providers: [
        provideNoopAnimations(),
        { provide: RegistroService, useValue: servizio },
        {
          provide: ToastService,
          useValue: jasmine.createSpyObj('ToastService', ['error', 'success', 'info', 'warn']),
        },
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
    expect(c.unitaOptions().map(o => o.value)).toEqual(['KG', 'T', 'M3', 'LITRI'])
    expect(c.form.get('unit')?.value).toBe('LITRI')
    expect(c.statiFisiciOptions().map(o => o.value)).toContain('PASTOSO')

    scrivi('#corr-motivo', 'Unità da verificare')
    clic('correzione-invia')
    expect(servizio.rettifica.calls.mostRecent().args[1].unit).toBe('LITRI')
  })

  it('uno stato fisico in maiuscolo si riconduce alla voce dell’elenco', () => {
    const c = apri(mov({ wastePhysicalState: 'LIQUIDO' }))
    expect(c.form.get('wastePhysicalState')?.value).toBe('Liquido')
    expect(c.statiFisiciOptions().length).toBe(4)
  })

  it('con le unità dei FIR non aggiunge voci e le causali sono quelle del tipo del movimento', () => {
    const c = apri(mov({ type: 'SCARICO', causale: 'CESSIONE', unit: 'M3' }))
    expect(c.unitaOptions().map(o => o.label)).toEqual(['kg', 't', 'm³'])
    const valori = c.causaliOptions().map(o => o.value)
    expect(valori).toContain('CONFERIMENTO_TRASPORTATORE')
    expect(valori).not.toContain('PRODUZIONE_INTERNA')
    expect(c.form.get('causale')?.value).toBe('CESSIONE')
  })
})
