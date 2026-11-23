import { ComponentFixture, TestBed } from '@angular/core/testing'
import { HttpClientTestingModule } from '@angular/common/http/testing'
import { provideNoopAnimations } from '@angular/platform-browser/animations'
import { of, throwError } from 'rxjs'
import { RicevuteCampoComponent } from './ricevute-campo.component'
import { ElencoRicevuteCampo, RicevuteCampoService, RicevutaCampo } from './ricevute-campo.service'

const ricevuta = (p: Partial<RicevutaCampo> = {}): RicevutaCampo => ({
  id: 'x1',
  ritiroId: 'r1',
  dataRitiro: '2026-12-01',
  cliente: 'Rossi Srl',
  cerCode: '150102',
  descrizione: 'Imballaggi',
  firmatarioNome: 'Mario Verdi',
  firmatoIl: '2026-12-01T08:30:00.000Z',
  ricevutoIl: '2026-12-01T09:05:00.000Z',
  autista: 'Bianchi Luca',
  dimensionePdf: 20480,
  pdfSha256: 'abcdef0123456789'.repeat(4),
  contenutoSha256: 'f'.repeat(64),
  esito: 'REGISTRATA',
  motivoConflitto: null,
  invio: null,
  ...p,
})
const q = (id: string): HTMLElement | null => document.body.querySelector(`[data-testid="${id}"]`)

describe('RicevuteCampoComponent (DOM)', () => {
  let servizio: jasmine.SpyObj<RicevuteCampoService>
  let fixture: ComponentFixture<RicevuteCampoComponent>

  async function apri(risposta: ElencoRicevuteCampo | 'errore'): Promise<void> {
    servizio.elenca.and.returnValue(
      risposta === 'errore' ? throwError(() => ({ status: 500, error: {} })) : of(risposta)
    )
    fixture = TestBed.createComponent(RicevuteCampoComponent)
    document.body.appendChild(fixture.nativeElement)
    fixture.detectChanges()
    await fixture.whenStable()
    fixture.detectChanges()
  }

  beforeEach(async () => {
    servizio = jasmine.createSpyObj<RicevuteCampoService>('RicevuteCampoService', [
      'elenca',
      'scarica',
    ])
    await TestBed.configureTestingModule({
      imports: [RicevuteCampoComponent, HttpClientTestingModule],
      providers: [provideNoopAnimations(), { provide: RicevuteCampoService, useValue: servizio }],
    }).compileComponents()
  })

  afterEach(() => fixture?.nativeElement.remove())

  it('dice che non sostituisce il FIR e che la firma e semplice, non qualificata', async () => {
    await apri({ righe: [], totale: 0 })
    const avviso = q('rc-avviso')?.textContent ?? ''
    expect(avviso).toContain('Non sostituiscono il')
    expect(avviso).toContain('FIR')
    expect(avviso).toContain('firma elettronica semplice')
    expect(avviso).toContain('non qualificata')
    expect(q('rc-vuota')?.textContent).toContain('Nessuna ricevuta')
  })

  it('mostra cliente, firmatario, autista, impronta e «Non inviata»', async () => {
    await apri({ righe: [ricevuta()], totale: 1 })
    const riga = q('rc-riga-x1')?.textContent ?? ''
    expect(riga).toContain('Rossi Srl')
    expect(riga).toContain('Mario Verdi')
    expect(riga).toContain('Bianchi Luca')
    expect(riga).toContain('150102')
    expect(q('rc-invio-x1')?.textContent).toContain('Non inviata')
    expect(q('rc-impronta-x1')?.textContent).toContain('SHA-256 abcdef012345')
    expect(q('rc-impronta-x1')?.getAttribute('title')).toBe(ricevuta().pdfSha256)
  })

  it('segnala «Da riconciliare» col motivo; una ricevuta regolare non ha il segno', async () => {
    await apri({
      righe: [
        ricevuta({ id: 'x1' }),
        ricevuta({ id: 'x2', esito: 'DA_RICONCILIARE', motivoConflitto: 'RITIRO_ANNULLATO' }),
      ],
      totale: 2,
    })
    expect(q('rc-conflitto-x1')).toBeNull()
    expect(q('rc-conflitto-x2')?.textContent).toContain('Da riconciliare')
    expect(q('rc-conflitto-x2')?.textContent).toContain('annullato')
  })

  it('mostra l esito dell invio al cliente con l indirizzo mascherato', async () => {
    await apri({
      righe: [
        ricevuta({ invio: { esito: 'INVIATO', destinatario: 'm***@ditta.it' } }),
        ricevuta({ id: 'x2', invio: { esito: 'FALLITO', destinatario: 'c***@esempio.it' } }),
      ],
      totale: 2,
    })
    expect(q('rc-invio-x1')?.textContent).toContain('Inviata')
    expect(q('rc-invio-x1')?.textContent).toContain('m***@ditta.it')
    expect(q('rc-invio-x2')?.textContent).toContain('Invio non riuscito')
  })

  it('«Scarica» chiede il PDF e lo salva col nome del server', async () => {
    await apri({ righe: [ricevuta()], totale: 1 })
    const blob = new Blob(['%PDF-'], { type: 'application/pdf' })
    servizio.scarica.and.returnValue(of({ blob, nomeFile: 'ricevuta-ritiro-2026-12-01.pdf' }))
    const salva = spyOn<any>(fixture.componentInstance, 'salva')
    ;(q('rc-scarica-x1')?.querySelector('button') as HTMLButtonElement).click()
    expect(servizio.scarica).toHaveBeenCalledWith('x1')
    expect(salva).toHaveBeenCalledWith(blob, 'ricevuta-ritiro-2026-12-01.pdf')
  })

  it('download in errore (anche impronta non corrispondente): messaggio chiaro, nessun file', async () => {
    await apri({ righe: [ricevuta()], totale: 1 })
    servizio.scarica.and.returnValue(throwError(() => ({ status: 500 })))
    const salva = spyOn<any>(fixture.componentInstance, 'salva')
    ;(q('rc-scarica-x1')?.querySelector('button') as HTMLButtonElement).click()
    fixture.detectChanges()
    expect(salva).not.toHaveBeenCalled()
    expect(q('rc-errore')?.textContent).toContain('Download non riuscito')
  })

  it('con piu di 50 ricevute c e la paginazione', async () => {
    await apri({ righe: [ricevuta()], totale: 120 })
    expect(q('rc-pagina')?.textContent).toContain('Pagina 1 di 3')
    ;(q('rc-successiva')?.querySelector('button') as HTMLButtonElement).click()
    expect(servizio.elenca).toHaveBeenCalledWith(2)
  })

  it('errore del server: messaggio visibile e nessuna riga', async () => {
    await apri('errore')
    expect(q('rc-errore')?.textContent).toContain('Impossibile leggere le ricevute di ritiro.')
    expect(q('rc-riga-x1')).toBeNull()
  })
})
