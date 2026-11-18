import { FeatureFlagsService } from '../../core/services/feature-flags.service'
import { TestBed } from '@angular/core/testing'
import { DatePipe } from '@angular/common'
import { signal } from '@angular/core'
import { FormBuilder } from '@angular/forms'
import { NEVER, of, Subject } from 'rxjs'
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
  let getDitta: jasmine.Spy

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

  const sedeA = {
    id: 'sede-predefinita',
    via: 'Via Roma',
    civico: '1',
    cap: '38060',
    citta: 'Calliano',
    provincia: 'TN',
    attiva: true,
    principale: true,
  }
  const sedeB = {
    id: 'sede-b',
    via: 'Via Dante',
    civico: '2',
    cap: '38122',
    citta: 'Trento',
    provincia: 'TN',
    attiva: true,
    principale: false,
  }
  const sedeOff = { ...sedeB, id: 'sede-off', attiva: false }
  const dittaConSedi = { id: 'd1', sedi: [sedeA, sedeB, sedeOff] }
  const produttoreMulti = { ...produttore, dittaId: 'd1', numeroSedi: 2 } as unknown as Produttore
  const scegliMulti = () => component.onProduttoreSelect({ value: produttoreMulti } as never)

  function crea(partitaIvaAzienda = '99999999999'): void {
    registra = jasmine.createSpy('registra').and.returnValue(NEVER)
    getDitta = jasmine.createSpy('getDitta').and.returnValue(of(dittaConSedi))
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
        {
          provide: RegistryService,
          useValue: { getProduttori: () => of({ items: [] }), getDitta },
        },
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
  describe('selettore della sede', () => {
    it('ditta con piu sedi: elenca le sole sedi attive e preseleziona la predefinita', () => {
      crea()
      scegliMulti()
      expect(getDitta).toHaveBeenCalledWith('d1')
      expect(component.sediControparte().map(s => s.id)).toEqual(['sede-predefinita', 'sede-b'])
      expect(component.sedeControparteSelezionata()).toBe('sede-predefinita')
      expect(salva()['counterpartSedeId']).toBe('sede-predefinita')
    })

    it('ditta con una sola sede: nessun selettore e nessuna chiamata, sede automatica', () => {
      crea()
      component.onProduttoreSelect({
        value: { ...produttore, dittaId: 'd1', numeroSedi: 1 },
      } as never)
      expect(getDitta).not.toHaveBeenCalled()
      expect(component.sediControparte()).toEqual([])
      expect(salva()['counterpartSedeId']).toBe('sede-predefinita')
    })

    it('sede scelta dall utente: va nel payload e l indirizzo diventa quello della sede', () => {
      crea()
      scegliMulti()
      component.onSedeControparteChange('sede-b')
      expect(component.form.get('counterpartAddress')?.value).toBe('Via Dante 2, 38122 Trento (TN)')
      expect(salva()['counterpartSedeId']).toBe('sede-b')
    })

    it('sede scelta e indirizzo poi modificato a mano: niente counterpartSedeId', () => {
      crea()
      scegliMulti()
      component.onSedeControparteChange('sede-b')
      component.form.patchValue({ counterpartAddress: 'Via Dante 22' })
      expect(salva()['counterpartSedeId']).toBeUndefined()
    })

    it('id non presente fra le sedi: ignorato', () => {
      crea()
      scegliMulti()
      component.onSedeControparteChange('sconosciuta')
      expect(salva()['counterpartSedeId']).toBe('sede-predefinita')
    })

    it('cambio di produttore: il selettore si riallinea; cancellazione: si svuota', () => {
      crea()
      scegliMulti()
      component.onProduttoreSelect({ value: produttore } as never)
      expect(component.sediControparte()).toEqual([])
      scegliMulti()
      component.onProduttoreClear()
      expect(component.sediControparte()).toEqual([])
    })

    it('apertura di un nuovo form: selettore svuotato', () => {
      crea()
      scegliMulti()
      component.apriForm()
      expect(component.sediControparte()).toEqual([])
    })
  })

  describe('corse e sedi disattivate', () => {
    it('I1: risposta tardiva della ditta A dopo la scelta della ditta B (una sola sede): selettore vuoto', () => {
      crea()
      const rispostaA = new Subject<unknown>()
      getDitta.and.returnValue(rispostaA)
      scegliMulti()
      component.onProduttoreSelect({
        value: { ...produttore, ragioneSociale: 'Ditta B', dittaId: 'dB', numeroSedi: 1 },
      } as never)
      rispostaA.next(dittaConSedi)
      expect(component.sediControparte()).toEqual([])
      expect(salva()['counterpartSedeId']).toBe('sede-predefinita')
    })

    it('I1: errore tardivo della ditta A non svuota il selettore della ditta B piu recente', () => {
      crea()
      const rispostaA = new Subject<unknown>()
      const rispostaB = new Subject<unknown>()
      getDitta.and.returnValues(rispostaA, rispostaB)
      scegliMulti()
      component.onProduttoreSelect({
        value: { ...produttoreMulti, ragioneSociale: 'Ditta B', dittaId: 'dB' },
      } as never)
      rispostaB.next(dittaConSedi)
      rispostaA.error(new Error('rete'))
      expect(component.sediControparte().length).toBe(2)
    })

    it('M1: stessa ditta riselezionata dopo una scelta esplicita: anche l indirizzo segue la sede', () => {
      crea()
      scegliMulti()
      component.onSedeControparteChange('sede-b')
      scegliMulti()
      expect(component.form.get('counterpartAddress')?.value).toBe('Via Dante 2, 38122 Trento (TN)')
      expect(salva()['counterpartSedeId']).toBe('sede-b')
    })

    it('M2: sede disattivata ricordata: voce «(disattivata)» selezionata nel dropdown', () => {
      crea('02222222222')
      const firOff = {
        ...fir,
        produttore: {
          partitaIva: '01111111111',
          ragioneSociale: 'Comune di Calliano',
          indirizzo: 'Via Dante 2, 38122 Trento (TN)',
          sedeId: 'sede-off',
        },
      } as unknown as FIR
      component.onFirSelect({ value: { fir: firOff, label: 'FIR-2026-1' } } as never)
      scegliMulti()
      const opz = component.sediControparteOptions()
      expect(component.sedeControparteSelezionata()).toBe('sede-off')
      expect(opz.find(o => o.value === 'sede-off')?.label).toContain('(disattivata)')
      expect(opz.filter(o => !o.label.includes('(disattivata)')).length).toBe(2)
      expect(salva()['counterpartSedeId']).toBe('sede-off')
    })
  })

  describe('ordine: scelta esplicita > sede del FIR > predefinita', () => {
    const firConProduttore = {
      ...fir,
      produttore: {
        partitaIva: '01111111111',
        ragioneSociale: 'Comune di Calliano',
        indirizzo: 'Via FIR 9, Calliano (TN)',
        sedeId: 'sede-b',
      },
    } as unknown as FIR

    it('FIR collegato e poi stessa ditta riselezionata dall anagrafica: resta la sede del FIR', () => {
      crea('02222222222')
      component.onFirSelect({ value: { fir: firConProduttore, label: 'FIR-2026-1' } } as never)
      scegliMulti()
      expect(salva()['counterpartSedeId']).toBe('sede-b')
      expect(component.sedeControparteSelezionata()).toBe('sede-b')
    })

    it('FIR collegato e poi ditta diversa dall anagrafica: la predefinita della nuova', () => {
      crea('02222222222')
      component.onFirSelect({ value: { fir: firConProduttore, label: 'FIR-2026-1' } } as never)
      component.onProduttoreSelect({
        value: { ...produttore, ragioneSociale: 'Altra ditta' },
      } as never)
      expect(salva()['counterpartSedeId']).toBe('sede-predefinita')
    })

    it('scelta esplicita e poi stessa ditta riselezionata: resta la scelta', () => {
      crea()
      scegliMulti()
      component.onSedeControparteChange('sede-b')
      scegliMulti()
      expect(salva()['counterpartSedeId']).toBe('sede-b')
    })

    it('scelta esplicita e poi FIR collegato: vince il FIR (azione piu recente)', () => {
      crea('02222222222')
      scegliMulti()
      component.onSedeControparteChange('sede-b')
      component.onFirSelect({ value: { fir, label: 'FIR-2026-1' } } as never)
      expect(salva()['counterpartSedeId']).toBe('sede-produttore')
    })
  })
})
