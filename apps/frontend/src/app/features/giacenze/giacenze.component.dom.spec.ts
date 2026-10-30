import { ComponentFixture, TestBed } from '@angular/core/testing'
import { provideNoopAnimations } from '@angular/platform-browser/animations'
import { of } from 'rxjs'

import { GiacenzeComponent } from './giacenze.component'
import {
  AvvisoDeposito,
  ConfigurazioneSoglie,
  DepositoCer,
  DepositoRegistro,
  DepositoTemporaneoVista,
  GiacenzeService,
  Giacenza,
  SoglieApplicate,
} from './giacenze.service'
import { RegistroService, RegistroVista } from '../registro/registro.service'
import { ToastService } from '../../core/services/toast.service'

const predefinite: SoglieApplicate = {
  criterio: 'NON_SCELTO',
  giorniMax: null,
  kgMaxTotale: 30000,
  kgMaxPericolosi: 10000,
  preavvisoGiorni: 15,
  preavvisoPercentuale: 80,
  origine: 'PREDEFINITA',
}

function sede(id: string, denominazione: string, principale = false): RegistroVista {
  return {
    id,
    unitaLocaleId: `u-${id}`,
    numIscrSito: null,
    denominazione,
    codice: id,
    attivo: true,
    principale,
  }
}

function cer(p: Partial<DepositoCer> = {}): DepositoCer {
  return {
    cerCode: '17 04 05',
    pericoloso: false,
    residuoKg: 1500,
    giornoPiuVecchio: '2026-03-01',
    etaGiorni: 244,
    scadenza: '2026-06-01',
    famiglie: [
      {
        unita: 'KG',
        residuo: 1500,
        scoperto: 0,
        lottiOmessi: 0,
        lotti: [
          {
            giorno: '2026-03-01',
            quantita: 1000,
            residuo: 500,
            origine: 'MOVIMENTO',
            riferimento: { id: 'm1', numero: '3/2026' },
          },
          {
            giorno: '2026-01-01',
            quantita: 1000,
            residuo: 1000,
            origine: 'APERTURA',
            riferimento: { id: 'a1' },
          },
        ],
      },
    ],
    ...p,
  }
}

function registro(id: string, p: Partial<DepositoRegistro> = {}): DepositoRegistro {
  return {
    registroId: id,
    registroDescrizione: `Registro ${id}`,
    attivo: true,
    soglie: predefinite,
    cer: [cer()],
    totaleKg: 1500,
    totalePericolosiKg: 0,
    quantitaParziale: false,
    scopertoPresente: false,
    avvisi: [],
    ...p,
  }
}

function avviso(p: Partial<AvvisoDeposito>): AvvisoDeposito {
  return {
    tipo: 'DURATA',
    livello: 'SUPERATO',
    cerCode: '17 04 05',
    valore: 244,
    soglia: 92,
    unita: 'giorni',
    giornoPiuVecchio: '2026-03-01',
    scadenza: '2026-06-01',
    messaggio: 'Messaggio del backend',
    ...p,
  }
}

describe('GiacenzeComponent (DOM)', () => {
  let fixture: ComponentFixture<GiacenzeComponent>
  let service: jasmine.SpyObj<GiacenzeService>

  function setup(opts: {
    registri: RegistroVista[]
    deposito?: DepositoRegistro[]
    giacenze?: Giacenza[]
    soglie?: ConfigurazioneSoglie
  }): void {
    service = jasmine.createSpyObj<GiacenzeService>('GiacenzeService', [
      'getGiacenze',
      'getDepositoTemporaneo',
      'getSoglie',
    ])
    service.getGiacenze.and.returnValue(of(opts.giacenze ?? []))
    service.getDepositoTemporaneo.and.callFake((id?: string) =>
      of({
        oggi: '2026-10-30',
        registri: (opts.deposito ?? []).filter(r => !id || r.registroId === id),
      } as DepositoTemporaneoVista)
    )
    service.getSoglie.and.returnValue(
      of(
        opts.soglie ?? {
          puoImpostare: false,
          predefinite,
          azienda: null,
          registri: [],
        }
      )
    )
    const reg = jasmine.createSpyObj<RegistroService>('RegistroService', ['listRegistri'])
    reg.listRegistri.and.returnValue(of(opts.registri))
    TestBed.configureTestingModule({
      imports: [GiacenzeComponent],
      providers: [
        provideNoopAnimations(),
        { provide: GiacenzeService, useValue: service },
        { provide: RegistroService, useValue: reg },
        { provide: ToastService, useValue: jasmine.createSpyObj('ToastService', ['error']) },
      ],
    })
    fixture = TestBed.createComponent(GiacenzeComponent)
    fixture.detectChanges()
  }

  const el = (): HTMLElement => fixture.nativeElement
  const q = (id: string): HTMLElement | null => el().querySelector(`[data-testid="${id}"]`)
  const qa = (id: string): HTMLElement[] =>
    Array.from(el().querySelectorAll<HTMLElement>(`[data-testid="${id}"]`))

  afterEach(() => fixture?.destroy())

  it('con un solo registro non mostra il selettore e chiede tutto senza registroId', () => {
    setup({ registri: [sede('r1', 'Unica', true)], deposito: [registro('r1')] })
    expect(q('giacenze-sede')).toBeNull()
    expect(service.getDepositoTemporaneo).toHaveBeenCalledWith(undefined)
  })

  it('con due registri mostra il selettore e parte dal predefinito; il cambio sede ricarica con registroId', () => {
    setup({
      registri: [sede('r1', 'Milano', true), sede('r2', 'Torino')],
      deposito: [registro('r1'), registro('r2')],
    })
    expect(q('giacenze-sede')).not.toBeNull()
    expect(service.getDepositoTemporaneo).toHaveBeenCalledWith('r1')
    expect(service.getGiacenze).toHaveBeenCalledWith('r1')

    el().querySelector<HTMLElement>('[data-testid="giacenze-sede"] .p-dropdown')!.click()
    fixture.detectChanges()
    const voci = Array.from(
      document.body.querySelectorAll<HTMLElement>('p-dropdownitem li, .p-dropdown-item')
    )
    const torino = voci.find(v => v.textContent?.includes('Torino'))
    expect(torino).withContext('voce Torino').toBeDefined()
    torino!.click()
    fixture.detectChanges()

    expect(service.getDepositoTemporaneo).toHaveBeenCalledWith('r2')
    expect(service.getGiacenze).toHaveBeenCalledWith('r2')
    expect(q('deposito-r2')).not.toBeNull()
    expect(q('deposito-r1')).toBeNull()
  })

  it('"Tutte le sedi" mostra il deposito registro per registro', () => {
    setup({
      registri: [sede('r1', 'Milano'), sede('r2', 'Torino')],
      deposito: [registro('r1'), registro('r2')],
    })
    // nessuna sede principale e due attivi: nessun predefinito, quindi tutte le sedi
    expect(service.getDepositoTemporaneo).toHaveBeenCalledWith(undefined)
    expect(q('deposito-r1')).not.toBeNull()
    expect(q('deposito-r2')).not.toBeNull()
  })

  it('rende gli avvisi col livello giusto, il messaggio del backend e i contatori', () => {
    setup({
      registri: [sede('r1', 'Unica', true)],
      deposito: [
        registro('r1', {
          avvisi: [
            avviso({ livello: 'SUPERATO', messaggio: 'Scaduto il termine' }),
            avviso({ livello: 'PREAVVISO', messaggio: 'In scadenza' }),
          ],
        }),
      ],
    })
    const avvisi = qa('avviso')
    expect(avvisi.length).toBe(2)
    expect(avvisi[0].querySelector('.p-tag-danger')?.textContent).toContain('Superato')
    expect(avvisi[0].textContent).toContain('Scaduto il termine')
    expect(avvisi[1].querySelector('.p-tag-warning')?.textContent).toContain('Preavviso')
    expect(avvisi[1].textContent).toContain('In scadenza')
    expect(q('kpi-superamenti')?.textContent).toContain('1')
    expect(q('kpi-preavvisi')?.textContent).toContain('1')
  })

  it('espande i lotti residui con un clic: giorno, numero o giacenza iniziale, residuo', () => {
    setup({ registri: [sede('r1', 'Unica', true)], deposito: [registro('r1')] })
    expect(qa('lotto').length).toBe(0)
    q('lotti-toggle')!.click()
    fixture.detectChanges()
    const lotti = qa('lotto')
    expect(lotti.length).toBe(2)
    expect(lotti[0].textContent).toContain('01/03/2026')
    expect(lotti[0].textContent).toContain('3/2026')
    expect(lotti[0].textContent).toContain('residuo 500 di 1.000 kg')
    expect(lotti[1].textContent).toContain('giacenza iniziale')
    q('lotti-toggle')!.click()
    fixture.detectChanges()
    expect(qa('lotto').length).toBe(0)
  })

  it('le date del deposito sono scritte GG/MM/AAAA senza spostamenti di fuso', () => {
    setup({ registri: [sede('r1', 'Unica', true)], deposito: [registro('r1')] })
    expect(q('cer-dal')?.textContent?.trim()).toBe('01/03/2026')
    expect(q('cer-entro')?.textContent?.trim()).toBe('01/06/2026')
  })

  it('le note di parzialità e di scoperto compaiono solo quando vere; quella dei gestori sempre', () => {
    setup({ registri: [sede('r1', 'Unica', true)], deposito: [registro('r1')] })
    expect(q('nota-parziale')).toBeNull()
    expect(q('nota-scoperto')).toBeNull()
    expect(q('nota-gestori')?.textContent).toContain('R13/D15')
    fixture.destroy()
    TestBed.resetTestingModule()

    setup({
      registri: [sede('r1', 'Unica', true)],
      deposito: [registro('r1', { quantitaParziale: true, scopertoPresente: true })],
    })
    expect(q('nota-parziale')?.textContent).toContain(
      'Il controllo quantitativo considera solo le quantità in kg: m³ e litri restano fuori.'
    )
    expect(q('nota-scoperto')?.textContent).toContain(
      'Ci sono scarichi senza un carico corrispondente: vedi Anomalie.'
    )
  })

  it("descrive le soglie applicate: criterio, origine e note dell'azienda", () => {
    setup({
      registri: [sede('r1', 'Unica', true)],
      deposito: [
        registro('r1', {
          soglie: { ...predefinite, criterio: 'TEMPORALE', giorniMax: 60, origine: 'AZIENDA' },
        }),
      ],
      soglie: {
        puoImpostare: true,
        predefinite,
        azienda: {
          ...predefinite,
          note: 'Fattore 800 kg/m³',
          aggiornatoIl: '2026-10-01T00:00:00Z',
        },
        registri: [],
      },
    })
    const testo = q('soglie-applicate')!.textContent!
    expect(q('soglie-criterio')?.textContent).toContain(
      'Temporale: avvio entro tre mesi di calendario e comunque entro 60 giorni'
    )
    expect(testo).toContain("dell'azienda")
    expect(q('soglie-note')?.textContent).toContain('Fattore 800 kg/m³')
  })

  it('criterio quantitativo e criterio non scelto in parole; predefinite con il fattore implicito', () => {
    setup({
      registri: [sede('r1', 'A', true), sede('r2', 'B')],
      deposito: [
        registro('r1', {
          soglie: { ...predefinite, criterio: 'QUANTITATIVO', origine: 'REGISTRO' },
        }),
        registro('r2'),
      ],
    })
    // selezionata r1 (principale): una sola sezione
    expect(q('soglie-criterio')?.textContent).toContain(
      'Quantitativo: 30.000 kg complessivi, di cui 10.000 kg pericolosi, e comunque entro un anno'
    )
    expect(q('soglie-applicate')?.textContent).toContain('di questa sede')
  })

  it('criterio non scelto e conversione dei predefiniti', () => {
    setup({ registri: [sede('r1', 'Unica', true)], deposito: [registro('r1')] })
    expect(q('soglie-criterio')?.textContent).toContain(
      'Criterio non scelto: si controllano entrambi'
    )
    expect(q('soglie-conversione')?.textContent).toContain('1 m³ in 1.000 kg')
    expect(q('soglie-applicate')?.textContent).toContain('predefinite')
  })

  it('la colonna "In deposito dal" della tabella giacenze mostra 01/03/2026 per 2026-03-01', () => {
    setup({
      registri: [sede('r1', 'Unica', true)],
      deposito: [registro('r1')],
      giacenze: [
        {
          cerCode: '17 04 05',
          caricoKg: 10,
          scaricoKg: 0,
          giacenzaKg: 10,
          inizialeKg: 0,
          oldestCaricoDate: '2026-03-01T00:00:00.000Z',
          altreUnita: [],
          scarichiSuFirAnnullati: [],
        },
      ],
    })
    expect(el().textContent).toContain('In deposito dal')
    expect(el().textContent).not.toContain('Carico più vecchio')
    expect(q('giacenza-dal')?.textContent?.trim()).toBe('01/03/2026')
  })
})
