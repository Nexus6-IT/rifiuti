import { TestBed } from '@angular/core/testing'
import { DatePipe } from '@angular/common'
import { signal } from '@angular/core'
import { FormBuilder } from '@angular/forms'
import { RegistroComponent } from './registro.component'
import { RegistroService } from './registro.service'
import { ToastService } from '../../core/services/toast.service'
import { ExportService } from '../../core/services/export.service'
import { AuthService } from '../../core/services/auth.service'
import { AdminTenantContextService } from '../../core/services/admin-tenant-context.service'
import { CompanyService } from '../../core/services/company.service'
import { FirService } from '../fir/fir.service'
import { RegistryService } from '../registry/registry.service'
import { FIR } from '../../shared/models/fir.model'

/**
 * Collegamento di un FIR nel dialog del registro (C-W-01): tipo, causale e quantità si
 * ricavano dal ruolo dell'azienda nel FIR, e la quantità segue il tipo anche se l'utente lo
 * cambia dopo aver scelto il FIR.
 */
describe('RegistroComponent — selezione di un FIR', () => {
  let component: RegistroComponent

  const fir = {
    id: 'fir-1',
    numeroFIR: 'FIR-2026-1',
    rifiuto: { cerCode: '15 01 01', quantita: 1234.5, unitaMisura: 'kg', statoFisico: 'Solido' },
    produttore: { partitaIva: '01111111111', ragioneSociale: 'Produttore SRL', indirizzo: 'Via A' },
    destinatario: { partitaIva: '02222222222', ragioneSociale: 'Impianto SPA', indirizzo: 'Via B' },
    pesoEffettivo: 1200,
    dataConsegna: null,
    dataPresaCaricoEffettiva: null,
  } as unknown as FIR

  function creaPer(partitaIva: string): void {
    TestBed.configureTestingModule({
      providers: [
        FormBuilder,
        DatePipe,
        { provide: RegistroService, useValue: {} },
        { provide: ToastService, useValue: {} },
        { provide: ExportService, useValue: {} },
        { provide: AuthService, useValue: {} },
        { provide: AdminTenantContextService, useValue: {} },
        {
          provide: CompanyService,
          useValue: { activeCompany: signal({ partitaIva, ragioneSociale: 'Azienda' }) },
        },
        { provide: FirService, useValue: {} },
        { provide: RegistryService, useValue: {} },
      ],
    })
    component = TestBed.runInInjectionContext(() => new RegistroComponent())
    component.initForm()
  }

  const seleziona = () => component.onFirSelect({ value: { fir, label: 'FIR-2026-1' } } as never)

  it('il destinatario carica il peso verificato a destino', () => {
    creaPer('02222222222')
    seleziona()

    expect(component.form.get('type')?.value).toBe('CARICO')
    expect(component.form.get('causale')?.value).toBe('INGRESSO_ESTERNO')
    expect(component.form.get('quantity')?.value).toBe(1200)
    expect(component.form.get('unit')?.value).toBe('KG')
    expect(component.form.get('firId')?.value).toBe('fir-1')
    expect(component.form.get('counterpartName')?.value).toBe('Produttore SRL')
    expect(component.ruoloHint()).toContain('DESTINATARIO')
    expect(component.ruoloHint()).toContain('peso verificato a destino')
  })

  it('il produttore scarica la quantità dichiarata alla partenza', () => {
    creaPer('01111111111')
    seleziona()

    expect(component.form.get('type')?.value).toBe('SCARICO')
    expect(component.form.get('causale')?.value).toBe('CONFERIMENTO_TRASPORTATORE')
    expect(component.form.get('quantity')?.value).toBe(1234.5)
    expect(component.form.get('counterpartName')?.value).toBe('Impianto SPA')
  })

  it('cambiando il tipo dopo la scelta del FIR la quantità segue il nuovo verso', () => {
    creaPer('02222222222')
    seleziona()
    expect(component.form.get('quantity')?.value).toBe(1200)

    component.form.get('type')?.setValue('SCARICO')
    component.onTipoChange()
    expect(component.form.get('quantity')?.value).toBe(1234.5)

    component.form.get('type')?.setValue('CARICO')
    component.onTipoChange()
    expect(component.form.get('quantity')?.value).toBe(1200)
  })
})
