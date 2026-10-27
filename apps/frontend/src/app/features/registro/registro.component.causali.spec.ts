import { TestBed } from '@angular/core/testing'
import { DatePipe } from '@angular/common'
import { HttpErrorResponse } from '@angular/common/http'
import { signal } from '@angular/core'
import { ReplaySubject, of, throwError } from 'rxjs'
import { RegistroComponent } from './registro.component'
import { RegistroService } from './registro.service'
import { CausaliRegistroService, OpzioneCausaleApi } from './causali-registro.service'
import { giornoLocale } from './registro-opzioni'
import { ToastService } from '../../core/services/toast.service'
import { ExportService } from '../../core/services/export.service'
import { AuthService } from '../../core/services/auth.service'
import { AdminTenantContextService } from '../../core/services/admin-tenant-context.service'
import { CompanyService } from '../../core/services/company.service'
import { FirService } from '../fir/fir.service'
import { RegistryService } from '../registry/registry.service'
import { FIR } from '../../shared/models/fir.model'

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

/**
 * Causali del form di registrazione (F2-5 task 7a): le opzioni vengono dall'API per tipo e data,
 * e la causale proposta dal FIR si applica solo dopo che sono arrivate.
 */
describe('RegistroComponent — causali dall’API', () => {
  let servizio: jasmine.SpyObj<RegistroService>
  let toast: jasmine.SpyObj<ToastService>
  /** Una risposta controllabile per ogni coppia tipo|giorno (come la cache del servizio vero). */
  let risposte: Map<string, ReplaySubject<OpzioneCausaleApi[]>>
  let causali: { opzioni: jasmine.Spy; invalida: jasmine.Spy }

  const risposta = (tipo: string, giorno: string): ReplaySubject<OpzioneCausaleApi[]> => {
    const k = `${tipo}|${giorno}`
    if (!risposte.has(k)) risposte.set(k, new ReplaySubject<OpzioneCausaleApi[]>(1))
    return risposte.get(k)!
  }
  const oggi = () => giornoLocale(new Date())

  const fir = {
    id: 'fir-1',
    numeroFIR: 'FIR-2026-1',
    rifiuto: { cerCode: '15 01 01', quantita: 100, unitaMisura: 'kg', statoFisico: 'Solido' },
    produttore: { partitaIva: '01111111111', ragioneSociale: 'Produttore SRL', indirizzo: 'Via A' },
    destinatario: { partitaIva: '02222222222', ragioneSociale: 'Impianto SPA', indirizzo: 'Via B' },
    pesoEffettivo: 100,
    dataConsegna: '2026-09-15T12:00:00.000Z',
    dataPresaCaricoEffettiva: '2026-09-10T12:00:00.000Z',
  } as unknown as FIR

  function crea(partitaIva = '02222222222'): RegistroComponent {
    TestBed.configureTestingModule({
      imports: [RegistroComponent],
      providers: [
        DatePipe,
        { provide: RegistroService, useValue: servizio },
        { provide: CausaliRegistroService, useValue: causali },
        { provide: ToastService, useValue: toast },
        { provide: ExportService, useValue: {} },
        { provide: AuthService, useValue: { currentUser: () => null } },
        { provide: AdminTenantContextService, useValue: { selectedTenantName: () => 'Azienda' } },
        {
          provide: CompanyService,
          useValue: {
            loadActiveCompany: () => of(null),
            activeCompany: signal({ partitaIva, ragioneSociale: 'Azienda' }),
          },
        },
        { provide: FirService, useValue: { getFIRList: () => of({ items: [] }) } },
        { provide: RegistryService, useValue: { getProduttori: () => of({ items: [] }) } },
      ],
    }).overrideComponent(RegistroComponent, { set: { template: '', imports: [] } })
    const c = TestBed.createComponent(RegistroComponent).componentInstance
    c.initForm()
    return c
  }

  const chiamate = (): string[] => causali.opzioni.calls.allArgs().map(a => `${a[0]}|${a[1]}`)

  beforeEach(() => {
    risposte = new Map()
    servizio = jasmine.createSpyObj<RegistroService>('RegistroService', ['registra'])
    toast = jasmine.createSpyObj<ToastService>('ToastService', ['error', 'success', 'info', 'warn'])
    causali = {
      opzioni: jasmine.createSpy('opzioni').and.callFake((t: string, g: string) => risposta(t, g)),
      invalida: jasmine.createSpy('invalida'),
    }
  })

  it('carica le opzioni del tipo e della data del form, e non mostra quelle di un altro tipo', () => {
    const c = crea()
    expect(chiamate()).toEqual([`CARICO|${oggi()}`])
    expect(c.causaliOptions()).toEqual([])

    risposta('CARICO', oggi()).next([riga('PRODUZIONE_INTERNA', 'Produzione interna')])
    expect(c.causaliOptions()).toEqual([
      { label: 'Produzione interna', value: 'PRODUZIONE_INTERNA' },
    ])

    c.setTipo('SCARICO')
    expect(chiamate()).toEqual([`CARICO|${oggi()}`, `SCARICO|${oggi()}`])
    // finché non arrivano le opzioni dello scarico non restano quelle del carico
    expect(c.causaliOptions()).toEqual([])
    risposta('SCARICO', oggi()).next([riga('CESSIONE', 'Cessione a terzi')])
    expect(c.causaliOptions().map(o => o.value)).toEqual(['CESSIONE'])
  })

  it('ricarica le opzioni al cambio di giorno, non a ogni modifica della stessa data', () => {
    const c = crea()
    const data = c.form.get('movementDate')!
    data.setValue(new Date(2026, 9, 20, 9, 30))
    data.setValue(new Date(2026, 9, 20, 18, 0)) // stesso giorno: nessuna richiesta
    data.setValue(null) // campo svuotato a metà digitazione: nessuna richiesta
    data.setValue(new Date(2026, 9, 21))
    expect(chiamate()).toEqual([`CARICO|${oggi()}`, 'CARICO|2026-10-20', 'CARICO|2026-10-21'])
  })

  it('un cambio di data che rende non valida la causale scelta la azzera con un messaggio', () => {
    const c = crea()
    risposta('CARICO', oggi()).next([riga('PRODUZIONE_INTERNA'), riga('AZ_RESO')])
    c.form.get('causale')!.setValue('AZ_RESO')
    expect(c.messaggioCausale()).toBeNull()

    c.form.get('movementDate')!.setValue(new Date(2026, 0, 5))
    risposta('CARICO', '2026-01-05').next([riga('PRODUZIONE_INTERNA')])

    expect(c.form.get('causale')!.value).toBeNull()
    expect(c.messaggioCausale()).toContain('non è disponibile alla data indicata')

    // una causale ancora valida alla nuova data resta e il messaggio sparisce
    c.form.get('causale')!.setValue('PRODUZIONE_INTERNA')
    c.form.get('movementDate')!.setValue(new Date(2026, 0, 6))
    risposta('CARICO', '2026-01-06').next([riga('PRODUZIONE_INTERNA')])
    expect(c.form.get('causale')!.value).toBe('PRODUZIONE_INTERNA')
    expect(c.messaggioCausale()).toBeNull()
  })

  it('il cambio di tipo azzera la causale senza il messaggio della data', () => {
    const c = crea()
    risposta('CARICO', oggi()).next([riga('PRODUZIONE_INTERNA')])
    c.form.get('causale')!.setValue('PRODUZIONE_INTERNA')
    c.setTipo('SCARICO')
    risposta('SCARICO', oggi()).next([riga('CESSIONE')])
    expect(c.form.get('causale')!.value).toBeNull()
    expect(c.messaggioCausale()).toBeNull()
  })

  describe('causale proposta dal FIR (M7)', () => {
    const seleziona = (c: RegistroComponent) =>
      c.onFirSelect({ value: { fir, label: 'FIR-2026-1' } } as never)

    it('con la risposta delle opzioni ritardata non imposta nulla prima, e poi la applica', () => {
      const c = crea('02222222222') // destinatario: CARICO, data di arrivo del FIR
      seleziona(c)

      expect(c.form.get('type')!.value).toBe('CARICO')
      expect(giornoLocale(c.form.get('movementDate')!.value)).toBe('2026-09-15')
      // opzioni ancora in viaggio: nessuna causale impostata
      expect(c.form.get('causale')!.value).toBeNull()

      risposta('CARICO', '2026-09-15').next([riga('INGRESSO_ESTERNO'), riga('PRODUZIONE_INTERNA')])

      expect(c.form.get('causale')!.value).toBe('INGRESSO_ESTERNO')
    })

    it('lo scarico del produttore usa il tipo e il giorno del FIR', () => {
      const c = crea('01111111111')
      seleziona(c)
      expect(c.form.get('causale')!.value).toBeNull()

      risposta('SCARICO', '2026-09-10').next([riga('CONFERIMENTO_TRASPORTATORE')])

      expect(c.form.get('type')!.value).toBe('SCARICO')
      expect(c.form.get('causale')!.value).toBe('CONFERIMENTO_TRASPORTATORE')
    })

    it('con la causale proposta disattivata (assente dalle opzioni) non c’è nessuna proposta', () => {
      const c = crea('02222222222')
      seleziona(c)
      risposta('CARICO', '2026-09-15').next([riga('PRODUZIONE_INTERNA')])

      expect(c.form.get('causale')!.value).toBeNull()
      expect(c.ruoloHint()).toContain('scegli la causale')
    })

    it('se nel frattempo l’utente sceglie un’altra causale, la sua scelta vince', () => {
      const c = crea('02222222222')
      seleziona(c)
      c.form.get('causale')!.setValue('PRODUZIONE_INTERNA')

      risposta('CARICO', '2026-09-15').next([riga('INGRESSO_ESTERNO'), riga('PRODUZIONE_INTERNA')])

      expect(c.form.get('causale')!.value).toBe('PRODUZIONE_INTERNA')
    })

    it('con il ruolo non riconosciuto non propone nessuna causale', () => {
      const c = crea('99999999999')
      seleziona(c)
      risposta('CARICO', oggi()).next([riga('INGRESSO_ESTERNO')])
      expect(c.form.get('causale')!.value).toBeNull()
    })
  })

  describe('registrazione con 409 CAUSALE_MODIFICATA', () => {
    it('mostra il messaggio del backend, invalida la cache e ricarica le opzioni', () => {
      const c = crea()
      risposta('CARICO', oggi()).next([riga('AZ_RESO')])
      c.form.patchValue({
        causale: 'AZ_RESO',
        cerCode: '15 01 01',
        quantity: 10,
        movementDate: new Date(2026, 9, 20),
      })
      risposta('CARICO', '2026-10-20').next([riga('AZ_RESO')])
      causali.opzioni.calls.reset()
      servizio.registra.and.returnValue(
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

      c.salva()

      expect(toast.error).toHaveBeenCalledWith(
        'La causale è stata modificata nel frattempo: ricarica e riprova.'
      )
      expect(causali.invalida).toHaveBeenCalled()
      expect(chiamate()).toEqual(['CARICO|2026-10-20'])

      // le opzioni nuove tolgono la causale modificata: la scelta si azzera
      risposta('CARICO', '2026-10-20').next([riga('PRODUZIONE_INTERNA')])
      expect(c.form.get('causale')!.value).toBeNull()
    })
  })
})
