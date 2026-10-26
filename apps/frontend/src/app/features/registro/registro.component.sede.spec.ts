import { TestBed } from '@angular/core/testing'
import { DatePipe } from '@angular/common'
import { of, throwError } from 'rxjs'
import { RegistroComponent } from './registro.component'
import { RegistroService, RegistroVista, StatoProgressivoIniziale } from './registro.service'
import { ToastService } from '../../core/services/toast.service'
import { ExportService } from '../../core/services/export.service'
import { AuthService } from '../../core/services/auth.service'
import { AdminTenantContextService } from '../../core/services/admin-tenant-context.service'
import { CompanyService } from '../../core/services/company.service'
import { FirService } from '../fir/fir.service'
import { RegistryService } from '../registry/registry.service'

function reg(parziale: Partial<RegistroVista>): RegistroVista {
  return {
    id: 'r1',
    unitaLocaleId: 'u1',
    numIscrSito: null,
    denominazione: 'Sede',
    codice: 'CARICO_SCARICO',
    attivo: true,
    principale: false,
    ...parziale,
  }
}

function stato(parziale: Partial<StatoProgressivoIniziale>): StatoProgressivoIniziale {
  return {
    anno: 2026,
    registroId: null,
    primoProgressivo: null,
    impostatoIl: null,
    haMovimenti: false,
    puoImpostare: true,
    puoRegistrare: true,
    ...parziale,
  }
}

describe('RegistroComponent — sede del registro', () => {
  let servizio: jasmine.SpyObj<RegistroService>
  let toast: jasmine.SpyObj<ToastService>
  let exportSvc: jasmine.SpyObj<ExportService>

  function crea(): RegistroComponent {
    TestBed.configureTestingModule({
      imports: [RegistroComponent],
      providers: [
        DatePipe,
        { provide: RegistroService, useValue: servizio },
        { provide: ToastService, useValue: toast },
        { provide: ExportService, useValue: exportSvc },
        { provide: AuthService, useValue: { currentUser: () => null } },
        { provide: AdminTenantContextService, useValue: { selectedTenantName: () => 'Azienda' } },
        {
          provide: CompanyService,
          useValue: { loadActiveCompany: () => of(null), activeCompany: () => null },
        },
        { provide: FirService, useValue: { getFIRList: () => of({ items: [] }) } },
        { provide: RegistryService, useValue: { getProduttori: () => of({ items: [] }) } },
      ],
    }).overrideComponent(RegistroComponent, { set: { template: '', imports: [] } })
    const c = TestBed.createComponent(RegistroComponent).componentInstance
    c.initForm()
    return c
  }

  beforeEach(() => {
    servizio = jasmine.createSpyObj<RegistroService>('RegistroService', [
      'lista',
      'listRegistri',
      'assicuraRegistri',
      'getProgressivoIniziale',
      'impostaProgressivoIniziale',
      'registra',
    ])
    exportSvc = jasmine.createSpyObj<ExportService>('ExportService', [
      'exportRegistroToPDF',
      'exportRegistroToExcel',
    ])
    toast = jasmine.createSpyObj<ToastService>('ToastService', ['error', 'success', 'info', 'warn'])
    servizio.lista.and.returnValue(of({ items: [], total: 0, page: 1, limit: 20, totalPages: 0 }))
  })

  it('chi può registrare chiama assicuraRegistri e non listRegistri', () => {
    servizio.getProgressivoIniziale.and.returnValue(of(stato({ puoRegistrare: true })))
    servizio.assicuraRegistri.and.returnValue(of([reg({ id: 'a' })]))
    const c = crea()
    c.caricaRegistri()
    expect(servizio.assicuraRegistri).toHaveBeenCalled()
    expect(servizio.listRegistri).not.toHaveBeenCalled()
    expect(c.registri().length).toBe(1)
  })

  it('chi è in sola consultazione usa listRegistri senza chiamare assicura', () => {
    servizio.getProgressivoIniziale.and.returnValue(of(stato({ puoRegistrare: false })))
    servizio.listRegistri.and.returnValue(of([reg({ id: 'a' })]))
    const c = crea()
    c.caricaRegistri()
    expect(servizio.assicuraRegistri).not.toHaveBeenCalled()
    expect(servizio.listRegistri).toHaveBeenCalled()
    expect(c.registri().length).toBe(1)
  })

  it('se assicura risponde 403 ripiega su listRegistri senza mostrare errori', () => {
    servizio.getProgressivoIniziale.and.returnValue(of(stato({ puoRegistrare: true })))
    servizio.assicuraRegistri.and.returnValue(throwError(() => ({ status: 403 })))
    servizio.listRegistri.and.returnValue(of([reg({ id: 'a' })]))
    const c = crea()
    c.caricaRegistri()
    expect(servizio.listRegistri).toHaveBeenCalled()
    expect(toast.error).not.toHaveBeenCalled()
    expect(c.registri().length).toBe(1)
  })

  it('con un registro solo selettore e colonna non compaiono e registroId non viene inviato', () => {
    servizio.getProgressivoIniziale.and.returnValue(of(stato({})))
    servizio.assicuraRegistri.and.returnValue(of([reg({ id: 'a' })]))
    const c = crea()
    c.caricaRegistri()
    expect(c.piuRegistri()).toBeFalse()
    c.apriForm()
    expect(c.form.get('registroId')?.valid).toBeTrue()
  })

  it('più registri senza principale: la sede è obbligatoria e il progressivo non si offre', () => {
    servizio.getProgressivoIniziale.and.returnValue(of(stato({ registroId: null })))
    servizio.assicuraRegistri.and.returnValue(
      of([reg({ id: 'a' }), reg({ id: 'b', denominazione: 'Altra' })])
    )
    const c = crea()
    c.caricaRegistri()
    expect(c.piuRegistri()).toBeTrue()
    // il progressivo si chiede senza registro: nessun valore finché la sede non è scelta
    expect(servizio.getProgressivoIniziale).toHaveBeenCalledWith(jasmine.any(Number), undefined)
    expect(c.offriProgressivo()).toBeFalse()
    c.apriForm()
    expect(c.form.get('registroId')?.valid).toBeFalse()
    c.form.get('registroId')?.setValue('b')
    expect(c.form.get('registroId')?.valid).toBeTrue()
  })

  it('più registri con una principale: il form la precompila', () => {
    servizio.getProgressivoIniziale.and.returnValue(of(stato({ registroId: 'b' })))
    servizio.assicuraRegistri.and.returnValue(
      of([reg({ id: 'a' }), reg({ id: 'b', principale: true })])
    )
    const c = crea()
    c.caricaRegistri()
    c.apriForm()
    expect(c.form.get('registroId')?.value).toBe('b')
    expect(servizio.getProgressivoIniziale).toHaveBeenCalledWith(jasmine.any(Number), 'b')
  })

  const DUE = () => [
    reg({ id: 'a', denominazione: 'Sede A', principale: false }),
    reg({ id: 'b', denominazione: 'Sede B', principale: false }),
  ]

  function conDueRegistri(registri = DUE(), parz: Partial<StatoProgressivoIniziale> = {}) {
    servizio.getProgressivoIniziale.and.returnValue(of(stato(parz)))
    servizio.assicuraRegistri.and.returnValue(of(registri))
    servizio.listRegistri.and.returnValue(of(registri))
    const c = crea()
    c.caricaRegistri()
    return c
  }

  function esportaConUnMovimento(c: RegistroComponent, formato: 'pdf' | 'excel') {
    servizio.lista.and.returnValue(
      of({
        items: [{ id: 'm1', registroId: 'b' } as never],
        total: 1,
        page: 1,
        limit: 20,
        totalPages: 1,
      })
    )
    c.paginazione.set({ total: 1, page: 1, limit: 20, totalPages: 1 })
    if (formato === 'pdf') c.esportaPdf()
    else c.esportaExcel()
    const chiamata = (
      formato === 'pdf' ? exportSvc.exportRegistroToPDF : exportSvc.exportRegistroToExcel
    ).calls.mostRecent()
    return chiamata.args[1] as import('../../core/services/export.service').RegistroExportMeta
  }

  it('export con più registri e nessun filtro: colonna Sede (PDF ed Excel), nessuna sede in intestazione', () => {
    const c = conDueRegistri()
    for (const f of ['pdf', 'excel'] as const) {
      const meta = esportaConUnMovimento(c, f)
      expect(meta.sede).toBeNull()
      expect(meta.etichettaSede?.({ registroId: 'b' } as never)).toBe('Sede B')
    }
  })

  it('export con più registri e filtro di sede: la sede va nell’intestazione, senza colonna', () => {
    const c = conDueRegistri()
    c.filtroRegistro = 'a'
    for (const f of ['pdf', 'excel'] as const) {
      const meta = esportaConUnMovimento(c, f)
      expect(meta.sede).toBe('Sede A')
      expect(meta.etichettaSede).toBeUndefined()
    }
  })

  it('export con un solo registro: identico a prima (né sede né colonna)', () => {
    const c = conDueRegistri([reg({ id: 'a' })])
    const meta = esportaConUnMovimento(c, 'pdf')
    expect(meta.sede).toBeNull()
    expect(meta.etichettaSede).toBeUndefined()
  })

  it('dialog del progressivo con più registri: dice su quale sede si imposta', () => {
    const c = conDueRegistri(DUE(), { registroId: 'b' })
    c.filtroRegistro = 'b'
    expect(c.etichettaSedeProgressivo()).toBe('Sede B')
    expect(c.titoloProgressivo()).toContain('Sede B')
  })

  it('dialog del progressivo con un solo registro: nessuna sede nel titolo', () => {
    const c = conDueRegistri([reg({ id: 'a' })])
    expect(c.etichettaSedeProgressivo()).toBeNull()
    expect(c.titoloProgressivo()).not.toContain('·')
  })

  it('apriForm precompila la sede filtrata, non il predefinito', () => {
    const c = conDueRegistri([
      reg({ id: 'a', principale: true }),
      reg({ id: 'b', denominazione: 'Sede B' }),
    ])
    c.filtroRegistro = 'b'
    c.apriForm()
    expect(c.form.get('registroId')?.value).toBe('b')
  })

  it('registri arrivati a form aperto: validatore required e valore predefinito', () => {
    servizio.getProgressivoIniziale.and.returnValue(of(stato({})))
    const c = crea()
    c.apriForm()
    expect(c.form.get('registroId')?.valid).toBeTrue() // un solo registro (nessuno): nessun obbligo
    servizio.assicuraRegistri.and.returnValue(
      of([reg({ id: 'a' }), reg({ id: 'b', principale: true })])
    )
    c.caricaRegistri()
    expect(c.form.get('registroId')?.value).toBe('b')
    c.form.get('registroId')?.setValue(null)
    expect(c.form.get('registroId')?.valid).toBeFalse()
  })

  // la selezione vera del FIR compila mezzo form: qui conta solo il blocco della sede
  const selezionaFir = (c: RegistroComponent) =>
    (c as never as { bloccaSedeSeFir(): void }).bloccaSedeSeFir()

  it('FIR collegato con sede principale: la sede si blocca sulla principale; senza principale è libera', () => {
    const c = conDueRegistri([
      reg({ id: 'a' }),
      reg({ id: 'b', principale: true, denominazione: 'Sede B' }),
    ])
    c.apriForm()
    c.form.get('registroId')?.setValue('a')
    selezionaFir(c)
    expect(c.form.get('registroId')?.value).toBe('b')
    expect(c.form.get('registroId')?.disabled).toBeTrue()
    expect(c.sedeBloccataDaFir()).toBeTrue()
    c.onFirClear()
    expect(c.form.get('registroId')?.enabled).toBeTrue()
    expect(c.sedeBloccataDaFir()).toBeFalse()

    TestBed.resetTestingModule()
    const libera = conDueRegistri()
    libera.apriForm()
    selezionaFir(libera)
    expect(libera.form.get('registroId')?.enabled).toBeTrue()
    expect(libera.sedeBloccataDaFir()).toBeFalse()
  })

  it('errore nel ricaricare il progressivo: "Registra movimento" non cambia e non si offre l’impostazione', () => {
    const c = conDueRegistri(DUE(), { registroId: 'a', puoRegistrare: false, puoImpostare: true })
    servizio.getProgressivoIniziale.and.returnValue(throwError(() => new Error('rete')))
    c.caricaProgressivo()
    expect(c.offriRegistrazione()).toBeFalse() // sola consultazione: resta nascosto
    expect(c.offriProgressivo()).toBeFalse()
  })

  it('errore nel ricaricare il progressivo con ruolo di scrittura: Registra movimento resta', () => {
    const c2 = conDueRegistri(DUE(), { registroId: 'a', puoRegistrare: true })
    servizio.getProgressivoIniziale.and.returnValue(throwError(() => new Error('rete')))
    c2.caricaProgressivo()
    expect(c2.offriRegistrazione()).toBeTrue()
    expect(c2.offriProgressivo()).toBeFalse()
  })
})
