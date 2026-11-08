import { ComponentFixture, TestBed, fakeAsync, flush, tick } from '@angular/core/testing'
import { scriviCampoData } from '../../shared/testing/campo-data'
import { HttpClientTestingModule } from '@angular/common/http/testing'
import { DatePipe } from '@angular/common'
import { provideNoopAnimations } from '@angular/platform-browser/animations'
import { Subject, of } from 'rxjs'
import {
  GiacenzeInizialiDialogComponent,
  ORIGINI_MASSIME,
  UNITA_GIACENZA,
  etichettaStatoFisico,
  etichettaUnita,
} from './giacenze-iniziali-dialog.component'
import { RegistroComponent } from './registro.component'
import {
  ElencoGiacenzeIniziali,
  GiacenzaInizialeInElenco,
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

function voce(parziale: Partial<GiacenzaInizialeInElenco> = {}): GiacenzaInizialeInElenco {
  return {
    id: 'g1',
    registroId: 'r1',
    cerCode: '17 04 05',
    statoFisico: 'SOLIDO',
    quantita: 120,
    unita: 'M3',
    dataRiferimento: '2026-01-01',
    origini: [],
    provenienza: 'MANUALE',
    note: null,
    impostatoDa: 'u1',
    createdAt: '2026-10-27T10:00:00.000Z',
    updatedAt: '2026-10-27T10:00:00.000Z',
    modificabile: true,
    ...parziale,
  }
}

function elenco(parziale: Partial<ElencoGiacenzeIniziali> = {}): ElencoGiacenzeIniziali {
  return { registroId: 'r1', puoImpostare: true, voci: [voce()], ...parziale }
}

const q = (testid: string): HTMLElement | null =>
  document.body.querySelector(`[data-testid="${testid}"]`)

const clic = (testid: string): void => {
  const b = document.body.querySelector<HTMLElement>(`[data-testid="${testid}"] button`)
  expect(b).withContext(`pulsante ${testid}`).not.toBeNull()
  b!.click()
}

describe('GiacenzeInizialiDialogComponent - unità, validazione e click', () => {
  let servizio: jasmine.SpyObj<RegistroService>
  let toast: jasmine.SpyObj<ToastService>
  let fixture: ComponentFixture<GiacenzeInizialiDialogComponent>
  let c: GiacenzeInizialiDialogComponent

  function apri(el: ElencoGiacenzeIniziali): void {
    servizio.getGiacenzeIniziali.and.returnValue(of(el))
    fixture = TestBed.createComponent(GiacenzeInizialiDialogComponent)
    c = fixture.componentInstance
    fixture.componentRef.setInput('registroId', 'r1')
    fixture.componentRef.setInput('visible', true)
    fixture.detectChanges()
  }

  beforeEach(() => {
    servizio = jasmine.createSpyObj<RegistroService>('RegistroService', [
      'getGiacenzeIniziali',
      'creaGiacenzaIniziale',
      'modificaGiacenzaIniziale',
      'eliminaGiacenzaIniziale',
    ])
    toast = jasmine.createSpyObj<ToastService>('ToastService', ['error', 'success', 'info', 'warn'])
    TestBed.configureTestingModule({
      imports: [GiacenzeInizialiDialogComponent, HttpClientTestingModule],
      providers: [
        provideNoopAnimations(),
        { provide: RegistroService, useValue: servizio },
        { provide: ToastService, useValue: toast },
      ],
    })
  })

  afterEach(() => fixture?.destroy())

  it('le unità ammesse sono quelle dei FIR: kg, t e m³ (niente litri né MC)', () => {
    expect(UNITA_GIACENZA).toEqual([
      { label: 'kg', value: 'KG' },
      { label: 't', value: 'T' },
      { label: 'm³', value: 'M3' },
    ])
    expect(etichettaUnita('M3')).toBe('m³')
    expect(etichettaUnita('KG')).toBe('kg')
    expect(etichettaUnita('LITRI')).toBe('LITRI')
  })

  it('la tabella mostra unità e stato fisico con le etichette leggibili', () => {
    apri(elenco())
    const riga = q('gi-riga-g1')?.textContent ?? ''
    expect(riga).toContain('120 m³')
    expect(riga).toContain('Solido')
    expect(riga).not.toContain('SOLIDO')
    expect(etichettaStatoFisico(null)).toBe('—')
    expect(etichettaStatoFisico('altro')).toBe('altro')
  })

  it('il form offre solo kg, t e m³ e conserva un valore storico fuori elenco', () => {
    apri(elenco())
    c.apriNuova()
    expect(c.unitaOptions().map(o => o.label)).toEqual(['kg', 't', 'm³'])
    c.apriModifica(voce({ unita: 'LITRI' }))
    expect(c.unitaOptions().map(o => o.value)).toEqual(['KG', 'T', 'M3', 'LITRI'])
  })

  it('la quantità non supera 99.999.999,99', () => {
    apri(elenco())
    c.apriNuova()
    c.form.patchValue({ quantita: 100000000 })
    expect(c.form.get('quantita')?.hasError('max')).toBeTrue()
  })

  it("l'anno di un'origine va da 1990 all'anno corrente", () => {
    apri(elenco())
    c.apriNuova()
    c.aggiungiOrigine()
    const anno = c.origini.at(0).get('anno')!
    anno.setValue(1989)
    expect(anno.invalid).toBeTrue()
    anno.setValue(c.annoCorrente + 1)
    expect(anno.invalid).toBeTrue()
    anno.setValue(c.annoCorrente)
    expect(anno.valid).toBeTrue()
  })

  it('segnala coppie anno/protocollo duplicate e somma oltre la giacenza (solo con tutte le quantità)', () => {
    apri(elenco())
    c.apriNuova()
    c.form.patchValue({ quantita: 100 })
    c.aggiungiOrigine()
    c.aggiungiOrigine()
    c.origini.at(0).patchValue({ anno: 2025, protocollo: 1, quantita: 60 })
    c.origini.at(1).patchValue({ anno: 2025, protocollo: 1, quantita: 50 })
    expect(c.form.hasError('origineDuplicata')).toBeTrue()
    expect(c.form.hasError('origineSommaOltre')).toBeTrue()

    c.origini.at(1).patchValue({ protocollo: 2, quantita: 40 })
    expect(c.form.hasError('origineDuplicata')).toBeFalse()
    expect(c.form.hasError('origineSommaOltre')).toBeFalse()

    // Con una quantità mancante la somma non si controlla (come il backend).
    c.origini.at(1).patchValue({ quantita: null })
    c.origini.at(0).patchValue({ quantita: 500 })
    expect(c.form.hasError('origineSommaOltre')).toBeFalse()
  })

  it('al massimo 200 righe di origine e il pulsante si disabilita', () => {
    apri(elenco())
    c.apriNuova()
    for (let i = 0; i < ORIGINI_MASSIME + 5; i++) c.aggiungiOrigine()
    expect(c.origini.length).toBe(ORIGINI_MASSIME)
    fixture.detectChanges()
    const b = document.body.querySelector<HTMLButtonElement>(
      '[data-testid="gi-aggiungi-origine"] button'
    )
    expect(b?.disabled).toBeTrue()
  })

  it('il messaggio per registro non determinato copre anche il caso "nessun registro"', () => {
    apri({ registroId: null, puoImpostare: true, voci: [] })
    expect(q('gi-registro-da-indicare')?.textContent).toContain('non ha ancora un registro')
  })

  it('una lettura nuova annulla la precedente: la risposta vecchia non vince', () => {
    const prima = new Subject<ElencoGiacenzeIniziali>()
    servizio.getGiacenzeIniziali.and.returnValue(prima)
    fixture = TestBed.createComponent(GiacenzeInizialiDialogComponent)
    c = fixture.componentInstance
    fixture.componentRef.setInput('visible', true)
    fixture.detectChanges()
    servizio.getGiacenzeIniziali.and.returnValue(of(elenco({ voci: [voce({ id: 'nuova' })] })))
    c.carica()
    prima.next(elenco({ voci: [voce({ id: 'vecchia' })] }))
    expect(c.elenco()?.voci[0].id).toBe('nuova')
    expect(prima.observed).toBeFalse()
  })

  it('click su "Salva" invia la giacenza al servizio', () => {
    apri(elenco({ voci: [] }))
    servizio.creaGiacenzaIniziale.and.returnValue(of({ giacenza: voce(), avvisi: [] }))
    clic('gi-aggiungi')
    fixture.detectChanges()
    c.form.patchValue({
      cerCode: '17 04 05',
      quantita: 10,
      unita: 'M3',
      dataRiferimento: '2026-01-01',
    })
    fixture.detectChanges()
    clic('gi-salva')
    expect(servizio.creaGiacenzaIniziale).toHaveBeenCalledTimes(1)
    expect(servizio.creaGiacenzaIniziale.calls.mostRecent().args[0].unita).toBe('M3')
  })

  it('la data di riferimento e un calendario in italiano: scritta a mano arriva al form, non oltre oggi', () => {
    apri(elenco({ voci: [] }))
    clic('gi-aggiungi')
    fixture.detectChanges()
    expect(document.body.querySelector('input[type="date"]')).toBeNull()
    expect(document.querySelector('label[for="gi-data"]')).not.toBeNull()
    const campo = document.getElementById('gi-data') as HTMLInputElement
    expect(campo.getAttribute('aria-required')).toBe('true')
    scriviCampoData(campo, '2026-03-29')
    expect(c.form.get('dataRiferimento')?.value).toBe('2026-03-29')
    // Oltre oggi non si accetta: il campo torna all'ultima data valida.
    scriviCampoData(campo, '2999-01-01')
    expect(c.form.get('dataRiferimento')?.value).toBe('2026-03-29')
    expect(campo.value).toBe('29/03/2026')
  })

  it('click su Elimina porta il focus su "Sì"; il click su "Sì" cancella', fakeAsync(() => {
    apri(elenco())
    servizio.eliminaGiacenzaIniziale.and.returnValue(of(undefined))
    clic('gi-elimina-g1')
    fixture.detectChanges()
    tick()
    const si = document.body.querySelector<HTMLElement>(
      '[data-testid="gi-elimina-conferma-g1"] button'
    )
    expect(si).not.toBeNull()
    expect(document.activeElement).toBe(si)
    clic('gi-elimina-conferma-g1')
    expect(servizio.eliminaGiacenzaIniziale).toHaveBeenCalledOnceWith('g1')
    flush()
  }))
})

describe('RegistroComponent - pulsante Giacenze iniziali (template reale)', () => {
  it('il click sul pulsante apre il dialog e legge le giacenze del registro', () => {
    const registro: RegistroVista = {
      id: 'r1',
      unitaLocaleId: 'u1',
      numIscrSito: null,
      denominazione: 'Sede',
      codice: 'CARICO_SCARICO',
      attivo: true,
      principale: true,
    }
    const stato: StatoProgressivoIniziale = {
      anno: 2026,
      registroId: 'r1',
      primoProgressivo: null,
      impostatoIl: null,
      haMovimenti: false,
      puoImpostare: false,
      puoRegistrare: true,
    }
    const servizio = jasmine.createSpyObj<RegistroService>('RegistroService', [
      'lista',
      'listRegistri',
      'assicuraRegistri',
      'getProgressivoIniziale',
      'getGiacenzeIniziali',
    ])
    servizio.lista.and.returnValue(of({ items: [], total: 0, page: 1, limit: 20, totalPages: 0 }))
    servizio.getProgressivoIniziale.and.returnValue(of(stato))
    servizio.assicuraRegistri.and.returnValue(of([registro]))
    servizio.listRegistri.and.returnValue(of([registro]))
    servizio.getGiacenzeIniziali.and.returnValue(of(elenco({ puoImpostare: false })))

    TestBed.configureTestingModule({
      imports: [RegistroComponent, HttpClientTestingModule],
      providers: [
        provideNoopAnimations(),
        DatePipe,
        { provide: RegistroService, useValue: servizio },
        {
          provide: ToastService,
          useValue: jasmine.createSpyObj('ToastService', ['error', 'success', 'info', 'warn']),
        },
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
    const fixture = TestBed.createComponent(RegistroComponent)
    fixture.detectChanges()

    expect(servizio.getGiacenzeIniziali).not.toHaveBeenCalled()
    clic('registro-giacenze-iniziali')
    fixture.detectChanges()
    expect(servizio.getGiacenzeIniziali).toHaveBeenCalledOnceWith('r1')
    expect(q('gi-riga-g1')).not.toBeNull()
    fixture.destroy()
  })
})
