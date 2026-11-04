import { ComponentFixture, TestBed } from '@angular/core/testing'
import { HttpClientTestingModule } from '@angular/common/http/testing'
import { DatePipe } from '@angular/common'
import { provideNoopAnimations } from '@angular/platform-browser/animations'
import { of } from 'rxjs'
import { RegistroComponent } from './registro.component'
import { Movimento, RegistroService, RegistroVista } from './registro.service'
import { ToastService } from '../../core/services/toast.service'
import { ExportService } from '../../core/services/export.service'
import { AuthService } from '../../core/services/auth.service'
import { AdminTenantContextService } from '../../core/services/admin-tenant-context.service'
import { CompanyService } from '../../core/services/company.service'
import { FirService } from '../fir/fir.service'
import { RegistryService } from '../registry/registry.service'
import { LegamiService } from '../legami/legami.service'
import { ClientiService } from '../clienti/clienti.service'
import { proposta } from '../legami/blocco-fatturazione.test-util'
import { PropostaLegame } from '../legami/legami.model'

const registro: RegistroVista = {
  id: 'r1',
  unitaLocaleId: 'u1',
  numIscrSito: null,
  denominazione: 'Sede',
  codice: 'CARICO_SCARICO',
  attivo: true,
  principale: true,
}


const attendi = (ms: number): Promise<void> => new Promise(r => setTimeout(r, ms))

/** Data di oggi come la mostra il campo («gg/mm/aaaa»). */
function oggiVisibile(): string {
  const d = new Date()
  const p = (n: number): string => String(n).padStart(2, '0')
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()}`
}

/**
 * «Data operazione» all'apertura del form. Il campo ha `[maxDate]`: PrimeNG confronta il valore con
 * il limite come istante, non come giorno, e svuota il testo di una data piu' recente del limite.
 * Il form si apre con `new Date()` (adesso), quindi un limite fissato al caricamento del componente
 * (un istante gia' passato) faceva restare il campo vuoto senza data e senza blocco «Fatturazione».
 */
describe('Registro - Data operazione precompilata all apertura', () => {
  let servizio: jasmine.SpyObj<RegistroService>
  let fixture: ComponentFixture<RegistroComponent>
  let risposta: PropostaLegame

  beforeEach(() => {
    risposta = proposta()
    servizio = jasmine.createSpyObj<RegistroService>('RegistroService', [
      'lista',
      'listRegistri',
      'assicuraRegistri',
      'getProgressivoIniziale',
      'registra',
    ])
    servizio.lista.and.returnValue(of({ items: [], total: 0, page: 1, limit: 20, totalPages: 1 }))
    servizio.assicuraRegistri.and.returnValue(of([registro]))
    servizio.listRegistri.and.returnValue(of([registro]))
    servizio.getProgressivoIniziale.and.returnValue(
      of({
        anno: 2026,
        registroId: 'r1',
        primoProgressivo: null,
        impostatoIl: null,
        haMovimenti: true,
        puoImpostare: false,
        puoRegistrare: true,
      })
    )
    servizio.registra.and.returnValue(
      of({ progressiveNumber: 1, progressiveYear: 2026 } as unknown as Movimento)
    )
    TestBed.configureTestingModule({
      imports: [RegistroComponent, HttpClientTestingModule],
      providers: [
        provideNoopAnimations(),
        DatePipe,
        { provide: RegistroService, useValue: servizio },
        {
          provide: LegamiService,
          useValue: {
            proposta: () => of(risposta),
          },
        },
        {
          provide: ClientiService,
          useValue: { clienti: { list: () => of({ elementi: [], totale: 0 }) } },
        },
        {
          provide: ToastService,
          useValue: jasmine.createSpyObj('ToastService', ['error', 'success', 'info', 'warn']),
        },
        { provide: ExportService, useValue: {} },
        { provide: AuthService, useValue: { currentUser: () => ({ role: 'OPERATOR' }) } },
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

  const campo = (): HTMLInputElement | null =>
    document.body.querySelector<HTMLInputElement>('input#movementDate')

  async function creaEApri(): Promise<RegistroComponent> {
    fixture = TestBed.createComponent(RegistroComponent)
    fixture.detectChanges()
    // il componente vive da un po' prima che l'utente apra il form
    await attendi(30)
    const c = fixture.componentInstance
    c.apriForm()
    fixture.detectChanges()
    await fixture.whenStable()
    fixture.detectChanges()
    return c
  }

  it('si apre con la data di oggi nel campo e nel form', async () => {
    const c = await creaEApri()
    expect(campo()).not.toBeNull()
    expect(campo()!.value).toBe(oggiVisibile())
    expect(c.form.get('movementDate')!.value instanceof Date).toBeTrue()
  })

  it('riaprendo il form dopo averlo chiuso la data e\' di nuovo oggi', async () => {
    const c = await creaEApri()
    c.chiudiForm()
    fixture.detectChanges()
    await fixture.whenStable()
    await attendi(30)
    c.apriForm()
    fixture.detectChanges()
    await fixture.whenStable()
    fixture.detectChanges()
    expect(campo()!.value).toBe(oggiVisibile())
  })

  it('il limite massimo copre tutto il giorno di oggi, fino a fine giornata', async () => {
    const c = await creaEApri()
    const limite = c.oggi
    const fineGiornata = new Date()
    fineGiornata.setHours(23, 59, 59, 999)
    expect(limite.getTime()).toBeGreaterThanOrEqual(fineGiornata.getTime() - 5)
  })
})
