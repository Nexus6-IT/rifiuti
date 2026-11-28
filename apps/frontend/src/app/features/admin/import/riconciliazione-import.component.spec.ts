import { ComponentFixture, TestBed } from '@angular/core/testing'
import { signal } from '@angular/core'
import { HttpErrorResponse } from '@angular/common/http'
import { of, throwError } from 'rxjs'

import { AuthService } from '../../../core/services/auth.service'
import { ToastService } from '../../../core/services/toast.service'
import { RiconciliazioneImportComponent } from './riconciliazione-import.component'
import {
  RapportoRiconciliazione,
  RiconciliazioneImportService,
  RiepilogoRapporto,
} from './riconciliazione-import.service'

const TENANT = '33333333-3333-4333-8333-333333333333'
const RADICE = '44444444-4444-4444-8444-444444444444'

function rapporto(over: Partial<RapportoRiconciliazione> = {}): RapportoRiconciliazione {
  return {
    id: RADICE,
    radiceId: RADICE,
    versione: 1,
    stato: 'APERTO',
    lottiImportIds: ['l1'],
    esiti: {
      archivioSorgente: 'WW00012026',
      confronti: [
        {
          numero: 1,
          titolo: 'Conteggi per tabella e verso',
          esito: 'DIFFERENZE',
          voci: [
            {
              chiave: 'fir',
              descrizione: 'Formulari',
              sorgente: 4,
              destinazione: 3,
              esito: 'DIFFERENZA',
            },
            {
              chiave: 'movimenti-carico',
              descrizione: 'Carichi',
              sorgente: 5,
              destinazione: 5,
              esito: 'OK',
            },
          ],
        },
        { numero: 2, titolo: 'Totali', esito: 'NON_APPLICABILE', nota: 'nessun lotto', voci: [] },
      ],
      campione: { seme: 'seme-1', richiesti: 2, movimenti: 1, fir: 0 },
      accettazioni: {},
    },
    hashRapporto: 'a'.repeat(64),
    chiusoIl: null,
    campioni: [
      {
        id: 'c1',
        tipo: 'MOVIMENTO',
        riferimentoId: 'm1',
        legacyKey: '0001|2026|MOVIMENTI|1',
        esito: null,
        nota: null,
      },
    ],
    verbali: [],
    valutazione: {
      chiudibile: false,
      differenzeAperte: ['1:fir'],
      campioniSenzaEsito: 1,
      campioniNonCorrispondono: 0,
    },
    ...over,
  }
}

const riepilogo: RiepilogoRapporto = {
  radiceId: RADICE,
  versione: 1,
  stato: 'APERTO',
  archivio: 'WW00012026',
  lottiImportIds: ['l1'],
  creatoIl: '2026-11-28T10:00:00.000Z',
  chiudibile: false,
  differenzeAperte: 1,
  campioniSenzaEsito: 1,
  verbali: 0,
}

describe('RiconciliazioneImportComponent', () => {
  let fixture: ComponentFixture<RiconciliazioneImportComponent>
  let component: RiconciliazioneImportComponent
  let service: jasmine.SpyObj<RiconciliazioneImportService>
  let toast: jasmine.SpyObj<ToastService>

  function setup(role: string | undefined): void {
    service = jasmine.createSpyObj<RiconciliazioneImportService>('RiconciliazioneImportService', [
      'elenca',
      'leggi',
      'esitoCampione',
      'accetta',
      'chiudi',
      'caricaVerbale',
    ])
    service.elenca.and.returnValue(of([riepilogo]))
    service.leggi.and.returnValue(of(rapporto()))
    toast = jasmine.createSpyObj<ToastService>('ToastService', ['success', 'error'])
    TestBed.configureTestingModule({
      imports: [RiconciliazioneImportComponent],
      providers: [
        { provide: RiconciliazioneImportService, useValue: service },
        { provide: ToastService, useValue: toast },
        {
          provide: AuthService,
          useValue: { currentUser: signal(role ? { id: 'u1', email: 'u@t.it', role } : null) },
        },
      ],
    })
    fixture = TestBed.createComponent(RiconciliazioneImportComponent)
    component = fixture.componentInstance
    fixture.detectChanges()
  }

  const el = (id: string): HTMLElement | null =>
    fixture.nativeElement.querySelector(`[data-testid="${id}"]`)

  function apriRapporto(): void {
    component.tenantId.set(TENANT)
    component.caricaElenco()
    component.apri(riepilogo)
    fixture.detectChanges()
  }

  it('un ruolo diverso da SUPER_ADMIN non vede nulla e non chiama il servizio', () => {
    setup('ADMIN')
    expect(el('riconciliazione-non-autorizzato')).not.toBeNull()
    expect(el('riconciliazione-tenant')).toBeNull()
    expect(service.elenca).not.toHaveBeenCalled()
  })

  it('l azienda deve essere un UUID valido prima di cercare', () => {
    setup('SUPER_ADMIN')
    component.tenantId.set('abc')
    expect(component.tenantValido()).toBeFalse()
    component.tenantId.set(TENANT)
    expect(component.tenantValido()).toBeTrue()
  })

  it('mostra i confronti, le differenze e il campione', () => {
    setup('SUPER_ADMIN')
    apriRapporto()
    expect(service.leggi).toHaveBeenCalledWith(TENANT, RADICE)
    expect(el('riconciliazione-esito-1')!.textContent).toContain('Differenze')
    expect(el('riconciliazione-esito-2')!.textContent).toContain('Non applicabile')
    expect(el('riconciliazione-campione')!.textContent).toContain('0001|2026|MOVIMENTI|1')
  })

  it('con differenze aperte la chiusura e disabilitata e dice perche', () => {
    setup('SUPER_ADMIN')
    apriRapporto()
    const motivo = el('riconciliazione-motivo-blocco')!.textContent!
    expect(motivo).toContain('1 differenze da accettare')
    expect(motivo).toContain('1 campioni senza esito')
    expect(component.motivoBlocco()).not.toBeNull()
    component.chiudi()
    expect(service.chiudi).not.toHaveBeenCalled()
  })

  it('accetta solo con un motivo di almeno 5 caratteri, inviando la versione letta', () => {
    setup('SUPER_ADMIN')
    apriRapporto()
    const conf = component.rapporto()!.esiti.confronti[0]
    const voce = conf.voci[0]
    component.impostaMotivo(conf, voce, 'no')
    component.accetta(conf, voce)
    expect(service.accetta).not.toHaveBeenCalled()
    component.impostaMotivo(conf, voce, 'FIR digitali riacquisiti da RENTRI')
    service.accetta.and.returnValue(of(rapporto({ versione: 2 })))
    component.accetta(conf, voce)
    expect(service.accetta).toHaveBeenCalledWith(
      TENANT,
      RADICE,
      1,
      '1:fir',
      'FIR digitali riacquisiti da RENTRI'
    )
    expect(component.rapporto()!.versione).toBe(2)
    expect(toast.success).toHaveBeenCalled()
  })

  it('la chiusura chiede conferma in due passaggi e invia la versione letta', () => {
    setup('SUPER_ADMIN')
    service.leggi.and.returnValue(
      of(
        rapporto({
          valutazione: {
            chiudibile: true,
            differenzeAperte: [],
            campioniSenzaEsito: 0,
            campioniNonCorrispondono: 0,
          },
        })
      )
    )
    apriRapporto()
    expect(component.motivoBlocco()).toBeNull()
    expect(el('riconciliazione-chiudi')).not.toBeNull()
    component.confermaChiusura.set(true)
    fixture.detectChanges()
    expect(el('riconciliazione-conferma-chiusura')).not.toBeNull()
    service.chiudi.and.returnValue(of(rapporto({ stato: 'CHIUSO' })))
    component.chiudi()
    expect(service.chiudi).toHaveBeenCalledWith(TENANT, RADICE, 1)
    expect(component.rapporto()!.stato).toBe('CHIUSO')
  })

  it('409: il rapporto e cambiato, si rilegge e si avvisa', () => {
    setup('SUPER_ADMIN')
    service.leggi.and.returnValue(
      of(
        rapporto({
          valutazione: {
            chiudibile: true,
            differenzeAperte: [],
            campioniSenzaEsito: 0,
            campioniNonCorrispondono: 0,
          },
        })
      )
    )
    apriRapporto()
    service.chiudi.and.returnValue(throwError(() => new HttpErrorResponse({ status: 409 })))
    const letture = service.leggi.calls.count()
    component.chiudi()
    expect(service.leggi.calls.count()).toBe(letture + 1)
    expect(component.errore()).toContain('cambiato')
  })

  it('un rapporto chiuso non permette azioni: chiusura disabilitata con la sua ragione', () => {
    setup('SUPER_ADMIN')
    service.leggi.and.returnValue(of(rapporto({ stato: 'CHIUSO' })))
    apriRapporto()
    expect(component.motivoBlocco()).toBe('Il rapporto e gia chiuso.')
  })
})
