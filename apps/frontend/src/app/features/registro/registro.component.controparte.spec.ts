import { FeatureFlagsService } from '../../core/services/feature-flags.service'
import { TestBed } from '@angular/core/testing'
import { DatePipe } from '@angular/common'
import { signal } from '@angular/core'
import { FormBuilder } from '@angular/forms'
import { NEVER, of } from 'rxjs'
import { RegistroComponent } from './registro.component'
import { RegistroService } from './registro.service'
import { CausaliRegistroService } from './causali-registro.service'
import { ToastService } from '../../core/services/toast.service'
import { ExportService } from '../../core/services/export.service'
import { AuthService } from '../../core/services/auth.service'
import { AdminTenantContextService } from '../../core/services/admin-tenant-context.service'
import { CompanyService } from '../../core/services/company.service'
import { FirService } from '../fir/fir.service'
import { RegistryService } from '../registry/registry.service'
import { FIR } from '../../shared/models/fir.model'
import { Produttore } from '../../shared/models/registry.model'

/**
 * Sede della controparte nel payload della registrazione (D5): impostata dalla scelta del produttore
 * o dal FIR, inviata solo finche' nome e indirizzo restano quelli compilati dalla scelta.
 */
describe('RegistroComponent — sede della controparte nel payload', () => {
  let component: RegistroComponent
  let registra: jasmine.Spy

  const fir = {
    id: 'fir-1',
    numeroFIR: 'FIR-2026-1',
    rifiuto: { cerCode: '15 01 01', quantita: 100, unitaMisura: 'kg', statoFisico: 'Solido' },
    produttore: {
      partitaIva: '01111111111',
      ragioneSociale: 'Produttore SRL',
      indirizzo: 'Via A 1, Calliano (TN)',
      sedeId: 'sede-produttore',
    },
    destinatario: {
      partitaIva: '02222222222',
      ragioneSociale: 'Impianto SPA',
      indirizzo: 'Via B 2, Milano (MI)',
      sedeId: 'sede-destinatario',
    },
    pesoEffettivo: 100,
    dataConsegna: null,
    dataPresaCaricoEffettiva: null,
  } as unknown as FIR

  const produttore = {
    id: 'p1',
    ragioneSociale: 'Comune di Calliano',
    partitaIVA: '00000000000',
    sedeId: 'sede-predefinita',
    sedeLegale: { via: 'Via Roma', civico: '1', cap: '38060', comune: 'Calliano', provincia: 'TN' },
  } as unknown as Produttore

  function crea(partitaIvaAzienda = '99999999999'): void {
    registra = jasmine.createSpy('registra').and.returnValue(NEVER)
    TestBed.configureTestingModule({
      providers: [
        { provide: FeatureFlagsService, useValue: { has: () => true } },
        FormBuilder,
        DatePipe,
        { provide: RegistroService, useValue: { registra } },
        { provide: ToastService, useValue: { error: () => {}, info: () => {} } },
        {
          provide: CausaliRegistroService,
          useValue: {
            opzioni: () =>
              of([
                { codice: 'INGRESSO_ESTERNO', descrizione: 'Ingresso da esterno' },
                { codice: 'PRODUZIONE_INTERNA', descrizione: 'Produzione interna' },
                {
                  codice: 'CONFERIMENTO_TRASPORTATORE',
                  descrizione: 'Conferimento a trasportatore',
                },
              ]),
            invalida: () => {},
          },
        },
        { provide: ExportService, useValue: {} },
        { provide: AuthService, useValue: {} },
        { provide: AdminTenantContextService, useValue: {} },
        {
          provide: CompanyService,
          useValue: {
            activeCompany: signal({ partitaIva: partitaIvaAzienda, ragioneSociale: 'Azienda' }),
            loadActiveCompany: () => of(null),
          },
        },
        { provide: FirService, useValue: { getFIRList: () => of({ items: [] }) } },
        { provide: RegistryService, useValue: { getProduttori: () => of({ items: [] }) } },
      ],
    })
    component = TestBed.runInInjectionContext(() => new RegistroComponent())
    component.initForm()
  }

  /** Compila i campi obbligatori non toccati dalla scelta e salva. */
  function salva(extra: Record<string, unknown> = {}): Record<string, unknown> {
    component.form.patchValue({
      type: 'CARICO',
      movementDate: new Date(2026, 9, 20),
      causale: 'PRODUZIONE_INTERNA',
      cerCode: '15 01 01',
      quantity: 10,
      ...extra,
    })
    component.salva()
    expect(registra).toHaveBeenCalledTimes(1)
    return registra.calls.mostRecent().args[0]
  }

  const scegliProduttore = () => component.onProduttoreSelect({ value: produttore } as never)

  it('produttore scelto e salvato: la richiesta ha la sede predefinita del produttore', () => {
    crea()
    scegliProduttore()
    expect(salva()['counterpartSedeId']).toBe('sede-predefinita')
  })

  it('produttore scelto e poi nome modificato a mano: niente counterpartSedeId', () => {
    crea()
    scegliProduttore()
    component.form.patchValue({ counterpartName: 'Comune di Trento' })
    // (la chiave resta con valore undefined: il JSON la scarta)
    expect(salva()['counterpartSedeId']).toBeUndefined()
  })

  it('produttore scelto e poi indirizzo modificato a mano: niente counterpartSedeId', () => {
    crea()
    scegliProduttore()
    component.form.patchValue({ counterpartAddress: 'Via Dante 2' })
    expect(salva()['counterpartSedeId']).toBeUndefined()
  })

  it('senza nessuna scelta (testo scritto a mano): niente counterpartSedeId', () => {
    crea()
    expect(salva({ counterpartName: 'Ditta a mano' })['counterpartSedeId']).toBeUndefined()
  })

  it('produttore senza sedeId: niente counterpartSedeId', () => {
    crea()
    component.onProduttoreSelect({ value: { ...produttore, sedeId: undefined } } as never)
    expect(salva()['counterpartSedeId']).toBeUndefined()
  })

  it('FIR collegato come destinatario (CARICO): la sede e quella del produttore del FIR', () => {
    crea('02222222222')
    component.onFirSelect({ value: { fir, label: 'FIR-2026-1' } } as never)
    expect(component.form.get('type')?.value).toBe('CARICO')
    expect(salva()['counterpartSedeId']).toBe('sede-produttore')
  })

  it('FIR collegato come produttore (SCARICO): la sede e quella del destinatario del FIR', () => {
    crea('01111111111')
    component.onFirSelect({ value: { fir, label: 'FIR-2026-1' } } as never)
    expect(component.form.get('type')?.value).toBe('SCARICO')
    expect(salva({ causale: 'CONFERIMENTO_TRASPORTATORE' })['counterpartSedeId']).toBe(
      'sede-destinatario'
    )
  })

  it('cambio di tipo con il FIR collegato: la sede si aggiorna al nuovo verso', () => {
    crea('02222222222')
    component.onFirSelect({ value: { fir, label: 'FIR-2026-1' } } as never)
    component.form.get('type')?.setValue('SCARICO')
    component.onTipoChange()
    expect(salva({ causale: 'CONFERIMENTO_TRASPORTATORE' })['counterpartSedeId']).toBe(
      'sede-destinatario'
    )
  })

  it('FIR senza sede sulla parte (FIR precedenti): niente counterpartSedeId', () => {
    crea('02222222222')
    const vecchio = {
      ...fir,
      produttore: { ...(fir as unknown as { produttore: object }).produttore, sedeId: null },
    } as unknown as FIR
    component.onFirSelect({ value: { fir: vecchio, label: 'FIR-2026-1' } } as never)
    expect(salva()['counterpartSedeId']).toBeUndefined()
  })

  it('apertura di un nuovo form: la scelta precedente non resta', () => {
    crea()
    scegliProduttore()
    component.apriForm()
    expect(
      salva({
        counterpartName: 'Comune di Calliano',
        counterpartAddress: 'Via Roma 1, 38060 Calliano (TN)',
      })['counterpartSedeId']
    ).toBeUndefined()
  })
})
