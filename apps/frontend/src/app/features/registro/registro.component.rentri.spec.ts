import { ComponentFixture, TestBed } from '@angular/core/testing'
import { DatePipe } from '@angular/common'
import { HttpClientTestingModule } from '@angular/common/http/testing'
import { provideNoopAnimations } from '@angular/platform-browser/animations'
import { of } from 'rxjs'
import { RegistroComponent } from './registro.component'
import { CausaliRegistroService } from './causali-registro.service'
import { Movimento, RegistroService } from './registro.service'
import { RentriRegistroService } from './rentri-registro.service'
import { ToastService } from '../../core/services/toast.service'
import { ExportService } from '../../core/services/export.service'
import { AuthService } from '../../core/services/auth.service'
import { AdminTenantContextService } from '../../core/services/admin-tenant-context.service'
import { CompanyService } from '../../core/services/company.service'
import { FirService } from '../fir/fir.service'
import { RegistryService } from '../registry/registry.service'
import { StatoRentri } from './stato-rentri'

function mov(id: string, n: number, stato: StatoRentri | null): Movimento {
  return {
    id,
    registroId: 'r1',
    tenantId: 't',
    progressiveNumber: n,
    progressiveYear: 2026,
    type: 'CARICO',
    movementDate: '2026-10-01',
    registrationDate: '2026-10-01',
    causale: 'X',
    cerCode: '17 04 05',
    quantity: 1,
    unit: 'KG',
    entryHash: 'h',
    createdAt: '2026-10-01',
    stato: 'VIGENTE',
    trasmissioneRentri: stato ? { stato, identificativo: null, motivo: null } : null,
  } as Movimento
}

describe('RegistroComponent — trasmissione a RENTRI', () => {
  let servizio: jasmine.SpyObj<RegistroService>
  let rentri: jasmine.SpyObj<RentriRegistroService>
  let toast: jasmine.SpyObj<ToastService>
  let fixture: ComponentFixture<RegistroComponent>

  function monta(puoTrasmettere = true): void {
    servizio.lista.and.returnValue(
      of({
        items: [
          mov('m-mai', 1, null),
          mov('m-ok', 2, 'TRASMESSA'),
          mov('m-attesa', 3, 'ATTESA_ESITO'),
          mov('m-rif', 4, 'RIFIUTATA'),
        ],
        total: 4,
        page: 1,
        limit: 20,
        totalPages: 1,
      })
    )
    rentri.registri.and.returnValue(
      of({
        registri: [
          {
            registroId: 'r1',
            descrizione: 'Sede',
            identificativoRentri: 'RABCDE12345',
            invioAutomatico: false,
            invioAutomaticoDal: null,
            perStato: {},
            nonTrasmessi: 1,
            haCertificato: true,
          },
        ],
        puoConfigurare: false,
        puoTrasmettere,
      })
    )
    rentri.trasmetti.and.returnValue(of({ accodate: 2, saltate: [], avvio: 'AVVIATO' }))
    fixture = TestBed.createComponent(RegistroComponent)
    fixture.detectChanges()
  }

  beforeEach(() => {
    servizio = jasmine.createSpyObj<RegistroService>('RegistroService', [
      'lista',
      'listRegistri',
      'assicuraRegistri',
      'getProgressivoIniziale',
    ])
    rentri = jasmine.createSpyObj<RentriRegistroService>('RentriRegistroService', [
      'registri',
      'trasmetti',
    ])
    toast = jasmine.createSpyObj<ToastService>('ToastService', ['error', 'success', 'info', 'warn'])
    servizio.getProgressivoIniziale.and.returnValue(
      of({
        anno: 2026,
        registroId: 'r1',
        primoProgressivo: null,
        impostatoIl: null,
        haMovimenti: true,
        puoImpostare: false,
        puoRegistrare: false,
      })
    )
    servizio.listRegistri.and.returnValue(
      of([
        {
          id: 'r1',
          unitaLocaleId: null,
          numIscrSito: null,
          denominazione: 'Sede',
          codice: 'CARICO_SCARICO',
          attivo: true,
          principale: true,
        },
      ])
    )
    TestBed.configureTestingModule({
      imports: [RegistroComponent, HttpClientTestingModule],
      providers: [
        DatePipe,
        provideNoopAnimations(),
        { provide: RegistroService, useValue: servizio },
        { provide: RentriRegistroService, useValue: rentri },
        { provide: ToastService, useValue: toast },
        {
          provide: CausaliRegistroService,
          useValue: { opzioni: () => of([]), invalida: () => {} },
        },
        { provide: ExportService, useValue: {} },
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

  const el = (testid: string): HTMLInputElement | null =>
    document.body.querySelector<HTMLInputElement>(`[data-testid="${testid}"]`)

  it('colonna RENTRI con le etichette; checkbox disabilitata sulle righe bloccate', () => {
    monta()
    expect(el('registro-col-rentri')).not.toBeNull()
    expect(el('rentri-stato-m-ok')!.textContent).toContain('Trasmessa')
    expect(el('rentri-stato-m-attesa')!.textContent).toContain("In attesa dell'esito")
    expect(el('registro-rentri-sel-m-mai')!.disabled).toBeFalse()
    expect(el('registro-rentri-sel-m-rif')!.disabled).toBeFalse()
    expect(el('registro-rentri-sel-m-ok')!.disabled).toBeTrue()
    expect(el('registro-rentri-sel-m-attesa')!.disabled).toBeTrue()
  })

  it('senza puoTrasmettere non ci sono checkbox', () => {
    monta(false)
    expect(el('registro-rentri-sel-m-mai')).toBeNull()
    expect(el('registro-col-rentri')).not.toBeNull()
  })

  it('con click reali: selezione, conteggio nel bottone, conferma e invio delle sole scelte', () => {
    monta()
    el('registro-rentri-sel-m-mai')!.click()
    el('registro-rentri-sel-m-rif')!.click()
    fixture.detectChanges()
    expect(el('rentri-trasmetti')!.textContent).toContain('(2)')
    el('rentri-trasmetti')!.querySelector('button')!.click()
    fixture.detectChanges()
    el('rentri-conferma-si')!.querySelector('button')!.click()
    expect(rentri.trasmetti).toHaveBeenCalledWith('r1', ['m-mai', 'm-rif'])
    // la lista si è riletta e la selezione è vuota
    expect(servizio.lista.calls.count()).toBeGreaterThan(1)
    expect(fixture.componentInstance.rentriSelezionati()).toEqual([])
  })

  describe('più sedi', () => {
    function montaDueSedi(): void {
      servizio.listRegistri.and.returnValue(
        of(
          ['r1', 'r2'].map((id, i) => ({
            id,
            unitaLocaleId: null,
            numIscrSito: null,
            denominazione: 'Sede ' + id,
            codice: 'CARICO_SCARICO',
            attivo: true,
            principale: i === 0,
          }))
        )
      )
      servizio.lista.and.returnValue(
        of({
          items: [mov('m-a', 1, null), { ...mov('m-b', 2, null), registroId: 'r2' }],
          total: 2,
          page: 1,
          limit: 20,
          totalPages: 1,
        })
      )
      rentri.registri.and.returnValue(
        of({
          registri: [
            {
              registroId: 'r1',
              descrizione: 'Sede',
              identificativoRentri: 'RABCDE12345',
              invioAutomatico: false,
              invioAutomaticoDal: null,
              perStato: {},
              nonTrasmessi: 1,
              haCertificato: true,
            },
          ],
          puoConfigurare: false,
          puoTrasmettere: true,
        })
      )
      fixture = TestBed.createComponent(RegistroComponent)
      fixture.detectChanges()
    }

    it('senza filtro di sede: né colonna RENTRI né checkbox', () => {
      montaDueSedi()
      expect(el('rentri-pannello')).not.toBeNull()
      expect(el('registro-col-rentri')).toBeNull()
      expect(el('registro-rentri-sel-m-a')).toBeNull()
      expect(el('registro-rentri-sel-m-b')).toBeNull()
    })

    it('con la sede filtrata: colonna e checkbox, ma le righe di altri registri restano bloccate', () => {
      montaDueSedi()
      fixture.componentInstance.filtroRegistro = 'r1'
      fixture.componentInstance.onFiltroRegistroChange()
      fixture.detectChanges()
      expect(el('registro-col-rentri')).not.toBeNull()
      expect(el('registro-rentri-sel-m-a')!.disabled).toBeFalse()
      expect(el('registro-rentri-sel-m-b')!.disabled).toBeTrue()
    })
  })

  it('avvisoRentri dopo una correzione compare come avviso', () => {
    monta()
    const c = fixture.componentInstance
    servizio.getProgressivoIniziale.and.returnValue(of({} as any))
    c.onCorretto({
      movimento: mov('n', 5, null),
      avvisi: [],
      avvisoRentri:
        "L'annotazione corretta era già su RENTRI: la correzione sarà trasmessa come rettifica.",
    })
    expect(toast.warn).toHaveBeenCalledWith(
      "L'annotazione corretta era già su RENTRI: la correzione sarà trasmessa come rettifica."
    )
  })

  it('nessun avviso se avvisoRentri è null', () => {
    monta()
    fixture.componentInstance.onCorretto({
      movimento: mov('n', 5, null),
      avvisi: [],
      avvisoRentri: null,
    })
    expect(toast.warn).not.toHaveBeenCalled()
  })
})
