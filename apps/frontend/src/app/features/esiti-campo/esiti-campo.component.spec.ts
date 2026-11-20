import { ComponentFixture, TestBed } from '@angular/core/testing'
import { HttpClientTestingModule } from '@angular/common/http/testing'
import { provideNoopAnimations } from '@angular/platform-browser/animations'
import { of, throwError } from 'rxjs'
import { EsitiCampoComponent } from './esiti-campo.component'
import { ElencoEsitiCampo, EsitoCampo, EsitiCampoService } from './esiti-campo.service'

const esito = (p: Partial<EsitoCampo> = {}): EsitoCampo => ({
  id: 'e1',
  tipo: 'RITIRO_NON_ESEGUITO',
  esito: 'DA_RICONCILIARE',
  motivoConflitto: 'RITIRO_ANNULLATO',
  dati: { motivo: 'Cliente assente' },
  versioneVista: 2,
  rilevatoIl: '2026-12-01T08:30:00.000Z',
  ricevutoIl: '2026-12-01T09:05:00.000Z',
  autista: { id: 'a1', nome: 'Bianchi Luca' },
  ritiro: {
    id: 'r1',
    dataPrevista: '2026-12-01',
    produttore: 'Rossi Srl',
    cerCode: '150102',
    descrizione: 'Imballaggi',
    stato: 'ANNULLATO',
    versione: 3,
  },
  ...p,
})
const q = (id: string): HTMLElement | null => document.body.querySelector(`[data-testid="${id}"]`)

describe('EsitiCampoComponent (DOM)', () => {
  let servizio: jasmine.SpyObj<EsitiCampoService>
  let fixture: ComponentFixture<EsitiCampoComponent>

  async function apri(risposta: ElencoEsitiCampo | 'errore'): Promise<void> {
    servizio.elenca.and.returnValue(
      risposta === 'errore' ? throwError(() => ({ status: 500, error: {} })) : of(risposta)
    )
    fixture = TestBed.createComponent(EsitiCampoComponent)
    document.body.appendChild(fixture.nativeElement)
    fixture.detectChanges()
    await fixture.whenStable()
    fixture.detectChanges()
  }

  beforeEach(async () => {
    servizio = jasmine.createSpyObj<EsitiCampoService>('EsitiCampoService', ['elenca'])
    await TestBed.configureTestingModule({
      imports: [EsitiCampoComponent, HttpClientTestingModule],
      providers: [provideNoopAnimations(), { provide: EsitiCampoService, useValue: servizio }],
    }).compileComponents()
  })

  afterEach(() => fixture?.nativeElement.remove())

  it('parte dai «da riconciliare» e mostra esito, motivo e perche', async () => {
    await apri({ righe: [esito()], totale: 1 })
    expect(servizio.elenca).toHaveBeenCalledWith('DA_RICONCILIARE', 1)
    const riga = q('ec-riga-e1')?.textContent ?? ''
    expect(riga).toContain('Rossi Srl')
    expect(riga).toContain('Bianchi Luca')
    expect(riga).toContain('Ritiro non eseguito')
    expect(riga).toContain('Motivo: Cliente assente')
    expect(q('ec-esito-e1')?.textContent).toContain('Da riconciliare')
    expect(q('ec-esito-e1')?.textContent).toContain('annullato in ufficio')
    expect(q('ec-stato-ritiro-e1')?.textContent).toContain('annullato')
  })

  it('un esito applicato mostra «Applicato» senza avviso', async () => {
    await apri({
      righe: [
        esito({
          id: 'e2',
          esito: 'APPLICATO',
          motivoConflitto: null,
          tipo: 'RITIRO_ESEGUITO',
          dati: { nota: 'ok' },
        }),
      ],
      totale: 1,
    })
    expect(q('ec-esito-e2')?.textContent).toContain('Applicato')
    expect(q('ec-esito-e2')?.textContent).not.toContain('Da riconciliare')
    expect(q('ec-riga-e2')?.textContent).toContain('Nota: ok')
  })

  it('i filtri richiedono l elenco giusto e tornano a pagina 1', async () => {
    await apri({ righe: [], totale: 0 })
    expect(q('ec-vuota')?.textContent).toContain('Nessun esito da riconciliare')
    ;(q('ec-filtro-applicati') as HTMLButtonElement).click()
    expect(servizio.elenca).toHaveBeenCalledWith('APPLICATO', 1)
    ;(q('ec-filtro-tutti') as HTMLButtonElement).click()
    expect(servizio.elenca).toHaveBeenCalledWith(null, 1)
    fixture.detectChanges()
    expect(q('ec-vuota')?.textContent).toContain('Nessun esito ricevuto')
  })

  it('con piu di 50 esiti c e la paginazione', async () => {
    await apri({ righe: [esito()], totale: 120 })
    expect(q('ec-pagina')?.textContent).toContain('Pagina 1 di 3')
    ;(q('ec-successiva')?.querySelector('button') as HTMLButtonElement).click()
    expect(servizio.elenca).toHaveBeenCalledWith('DA_RICONCILIARE', 2)
  })

  it('errore del server: messaggio visibile e nessuna riga', async () => {
    await apri('errore')
    expect(q('ec-errore')?.textContent).toContain('Impossibile leggere gli esiti dal campo.')
    expect(q('ec-riga-e1')).toBeNull()
  })
})
