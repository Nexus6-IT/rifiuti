import { ComponentFixture, TestBed } from '@angular/core/testing'
import { provideNoopAnimations } from '@angular/platform-browser/animations'
import { Subject, of, throwError } from 'rxjs'
import { DocumentoDettaglio } from '../fatturazione.model'
import { FatturazioneService, FileScaricato } from '../fatturazione.service'
import { DocumentoAnteprimaDialogComponent } from './documento-anteprima-dialog.component'

const q = <T extends HTMLElement = HTMLElement>(id: string): T | null =>
  document.body.querySelector<T>(`[data-testid="${id}"]`)

function documento(extra: Partial<DocumentoDettaglio> = {}): DocumentoDettaglio {
  return {
    id: 'd1',
    stato: 'BOZZA',
    tipoDocumento: 'TD01',
    numeroTesto: null,
    dataDocumento: '2026-11-03',
    cliente: { id: 'c1', denominazione: 'Rossi Srl' },
    contratto: { id: 'k1', numero: 'CC-2026-001' },
    registro: { id: 'r1', codice: 'A' },
    totaleImponibile: '1000.00',
    totaleIva: '220.00',
    totaleDocumento: '1220.00',
    errori: [],
    avvisi: [{ codice: 'ARRETRATI_PRESENTI', messaggio: 'testo del backend' }],
    esclusoDaDefinitiva: false,
    emessoIl: null,
    annullabile: false,
    motivoNonAnnullabile: null,
    stornabile: false,
    righe: [
      {
        numeroLinea: 1,
        tipoRiga: 'MOVIMENTO',
        legameId: 'l1',
        rigaAddebitoId: null,
        descrizione: 'Smaltimento 170904',
        dataMovimento: '2026-10-12',
        cerCode: '170904',
        numeroFir: 'FIR123',
        quantita: '1234.500',
        unitaMisura: 'kg',
        prezzoUnitario: '0.50',
        sconto: null,
        importoLordo: '617.25',
        importoSconto: '0.00',
        prezzoTotale: '617.25',
        aliquotaIva: '22.00',
        naturaIva: null,
      },
    ],
    riepiloghi: [
      {
        aliquota: '22.00',
        natura: null,
        imponibile: '1000.00',
        imposta: '220.00',
        esigibilita: 'I',
        riferimentoNormativo: null,
      },
    ],
    rate: [
      {
        ordine: 1,
        modalita: 'MP05',
        dataScadenza: '2026-12-31',
        importo: '1220.00',
        istituto: null,
        iban: null,
        abi: null,
        cab: null,
        bic: null,
      },
    ],
    nettoAPagare: '1220.00',
    bolloDovuto: false,
    importoBollo: null,
    versione: 1,
    documentoOrigineId: null,
    stornoId: null,
    xmlGenerato: false,
    ...extra,
  }
}

describe('DocumentoAnteprimaDialogComponent', () => {
  let fixture: ComponentFixture<DocumentoAnteprimaDialogComponent>
  let servizio: jasmine.SpyObj<FatturazioneService>

  async function crea(
    risposta = of(documento()),
    id: string | null = 'd1'
  ): Promise<DocumentoAnteprimaDialogComponent> {
    servizio = jasmine.createSpyObj('FatturazioneService', ['documento', 'scaricaPdf'])
    servizio.documento.and.returnValue(risposta)
    await TestBed.configureTestingModule({
      imports: [DocumentoAnteprimaDialogComponent],
      providers: [provideNoopAnimations(), { provide: FatturazioneService, useValue: servizio }],
    }).compileComponents()
    fixture = TestBed.createComponent(DocumentoAnteprimaDialogComponent)
    fixture.componentRef.setInput('visible', true)
    fixture.componentRef.setInput('documentoId', id)
    fixture.detectChanges()
    await fixture.whenStable()
    fixture.detectChanges()
    return fixture.componentInstance
  }

  afterEach(() => fixture?.destroy())

  it('righe, riepilogo IVA, rate e totali del documento', async () => {
    await crea()
    expect(servizio.documento).toHaveBeenCalledWith('d1')
    const righe = q('doc-righe')!.textContent!
    expect(righe).toContain('Smaltimento 170904')
    expect(righe).toContain('1.234,5')
    expect(righe).toContain('617,25')
    const iva = q('doc-riepilogo-iva')!.textContent!
    expect(iva).toContain('22,00')
    expect(iva).toContain('1.000,00')
    expect(iva).toContain('220,00')
    const rate = q('doc-rate')!.textContent!
    expect(rate).toContain('31/12/2026')
    expect(rate).toContain('1.220,00')
    expect(q('doc-totale')!.textContent).toContain('1.220,00')
    expect(q('doc-testata')!.textContent).toContain('Fattura del 03/11/2026')
    expect(q('doc-testata')!.textContent).not.toContain('TD01')
    expect(q('doc-avvisi')!.textContent).not.toContain('testo del backend')
  })

  it('senza rate e senza bollo non mostra le sezioni vuote', async () => {
    await crea(of(documento({ rate: [] })))
    expect(q('doc-rate')).toBeNull()
    expect(q('doc-bollo')).toBeNull()
  })

  it('il link al PDF scarica la copia di cortesia', async () => {
    const salvato = jasmine.createSpy('salva')
    const file: FileScaricato = { blob: new Blob(['%PDF']), nomeFile: 'f.pdf', saltati: 0 }
    const comp = await crea()
    servizio.scaricaPdf.and.returnValue(of(file))
    comp.salva = salvato
    q('doc-pdf')!.querySelector('button')!.click()
    expect(servizio.scaricaPdf).toHaveBeenCalledWith('d1')
    expect(salvato).toHaveBeenCalledWith(file, jasmine.any(String))
  })

  it('errore del PDF in un Blob: legge il codice e mostra il testo del vocabolario', async () => {
    const comp = await crea()
    const blob = new Blob([JSON.stringify({ error: 'DOCUMENTO_NON_TROVATO', message: 'x' })])
    servizio.scaricaPdf.and.returnValue(throwError(() => ({ status: 404, error: blob })))
    q('doc-pdf')!.querySelector('button')!.click()
    // Blob.text() è una promise nativa: la zona non la aspetta.
    for (let i = 0; i < 100 && comp.erroreScarico() === null; i++) {
      await new Promise(r => setTimeout(r, 5))
    }
    fixture.detectChanges()
    expect(comp.erroreScarico()).toBe('Il documento non esiste più: ricarica la pagina.')
    expect(q('doc-errore-pdf')!.textContent).toContain('Il documento non esiste più')
  })

  it('errore di lettura: messaggio senza id né dettagli tecnici', async () => {
    await crea(throwError(() => ({ status: 500, error: { message: 'boom d1' } })))
    const t = q('doc-errore')!.textContent!
    expect(t).toContain('Impossibile caricare il documento.')
  })

  it('cambiando documento la lettura pendente viene annullata: la risposta tardiva non conta', async () => {
    const prima = new Subject<DocumentoDettaglio>()
    const comp = await crea(prima as never)
    const seconda = of(documento({ id: 'd2', totaleDocumento: '5.00', righe: [] }))
    servizio.documento.and.returnValue(seconda)
    fixture.componentRef.setInput('documentoId', 'd2')
    fixture.detectChanges()
    expect(prima.observed).toBeFalse()
    prima.next(documento({ id: 'd1', totaleDocumento: '9999.00' }))
    fixture.detectChanges()
    expect(comp.documento()?.id).toBe('d2')
  })

  it('chiudendo (id null) annulla la lettura pendente', async () => {
    const prima = new Subject<DocumentoDettaglio>()
    await crea(prima as never)
    expect(prima.observed).toBeTrue()
    fixture.componentRef.setInput('documentoId', null)
    fixture.detectChanges()
    expect(prima.observed).toBeFalse()
  })
})
