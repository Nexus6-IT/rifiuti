import { ComponentFixture, TestBed } from '@angular/core/testing'
import { By } from '@angular/platform-browser'
import { provideNoopAnimations } from '@angular/platform-browser/animations'
import { Subject, of, throwError } from 'rxjs'
import { ClientiService } from '../../clienti/clienti.service'
import { FatturazioneService } from '../fatturazione.service'
import { NuovaElaborazioneDialogComponent } from './nuova-elaborazione-dialog.component'

const q = <T extends HTMLElement = HTMLElement>(id: string): T | null =>
  document.body.querySelector<T>(`[data-testid="${id}"]`)

const dopo = async (f: ComponentFixture<unknown>): Promise<void> => {
  f.detectChanges()
  await f.whenStable()
  f.detectChanges()
}

describe('NuovaElaborazioneDialogComponent', () => {
  let fixture: ComponentFixture<NuovaElaborazioneDialogComponent>
  let comp: NuovaElaborazioneDialogComponent
  let avvia: jasmine.Spy
  let listaClienti: jasmine.Spy
  let listaContratti: jasmine.Spy

  async function crea(): Promise<void> {
    avvia = jasmine.createSpy('avvia').and.returnValue(of({ id: 'e1' }))
    listaClienti = jasmine.createSpy('clienti').and.returnValue(
      of({
        elementi: [{ id: 'c1', codice: 'C1', ditta: { ragioneSociale: 'Rossi Srl' } }],
        totale: 1,
      })
    )
    listaContratti = jasmine.createSpy('contratti').and.returnValue(
      of({
        elementi: [
          {
            id: 'k1',
            numero: 'CC-2026-001',
            stato: 'ATTIVO',
            cliente: { ragioneSociale: 'Rossi Srl' },
          },
        ],
        totale: 1,
      })
    )
    await TestBed.configureTestingModule({
      imports: [NuovaElaborazioneDialogComponent],
      providers: [
        provideNoopAnimations(),
        { provide: FatturazioneService, useValue: { avvia } },
        {
          provide: ClientiService,
          useValue: { clienti: { list: listaClienti }, contratti: { list: listaContratti } },
        },
      ],
    }).compileComponents()
    fixture = TestBed.createComponent(NuovaElaborazioneDialogComponent)
    comp = fixture.componentInstance
    fixture.componentRef.setInput('visible', true)
    await dopo(fixture)
  }

  const imposta = (dal: Date | null, al: Date | null, doc: Date | null): void => {
    comp.periodoDal = dal
    comp.periodoAl = al
    comp.dataDocumento = doc
  }
  const giorno = (a: number, m: number, g: number): Date => new Date(a, m - 1, g)

  afterEach(() => fixture?.destroy())

  it('mostra periodo, data documento, raggruppamento, arretrati e i filtri cliente e contratto', async () => {
    await crea()
    for (const id of [
      'nuova-periodo-dal',
      'nuova-periodo-al',
      'nuova-data-documento',
      'nuova-raggruppamento',
      'nuova-arretrati',
      'nuova-filtro-cliente',
      'nuova-filtro-contratto',
    ]) {
      expect(q(id)).withContext(id).not.toBeNull()
    }
  })

  it('la ricerca di clienti e contratti è lato server con dimensione 25', async () => {
    await crea()
    expect(listaClienti.calls.mostRecent().args[0]).toEqual(
      jasmine.objectContaining({ dimensione: 25, soloAttivi: true })
    )
    expect(listaContratti.calls.mostRecent().args[0]).toEqual(
      jasmine.objectContaining({ dimensione: 25 })
    )
    comp.cercaClienti('ross')
    await new Promise(r => setTimeout(r, 350))
    expect(listaClienti.calls.mostRecent().args[0]).toEqual(
      jasmine.objectContaining({ testo: 'ross', dimensione: 25 })
    )
  })

  it('data documento: maxDate è la fine del giorno e si ricalcola a ogni apertura', async () => {
    await crea()
    const calendario = (): Date =>
      fixture.debugElement.query(By.css('[data-testid="nuova-data-documento"]')).componentInstance
        .maxDate
    const prima = calendario()
    expect([prima.getHours(), prima.getMinutes(), prima.getSeconds()]).toEqual([23, 59, 59])
    // Chiusura e riapertura: il valore è un'istanza nuova, non quella del costruttore.
    fixture.componentRef.setInput('visible', false)
    await dopo(fixture)
    comp.fineGiorno.set(new Date(2000, 0, 1, 23, 59, 59, 999))
    fixture.componentRef.setInput('visible', true)
    await dopo(fixture)
    expect(comp.fineGiorno().getFullYear()).toBeGreaterThan(2000)
    expect(calendario().getFullYear()).toBeGreaterThan(2000)
  })

  it('la data documento di oggi è ammessa; domani no', async () => {
    await crea()
    const oggi = comp.fineGiorno()
    imposta(giorno(oggi.getFullYear(), 1, 1), giorno(oggi.getFullYear(), 1, 31), oggi)
    expect(comp.errori().dataFutura).toBeFalse()
    const domani = new Date(oggi.getTime() + 24 * 3600 * 1000)
    imposta(giorno(oggi.getFullYear(), 1, 1), giorno(oggi.getFullYear(), 1, 31), domani)
    expect(comp.errori().dataFutura).toBeTrue()
    expect(comp.valido()).toBeFalse()
  })

  it('periodo a cavallo d’anno: errore nel dialog e nessuna richiesta', async () => {
    await crea()
    imposta(giorno(2025, 12, 15), giorno(2026, 1, 15), giorno(2026, 1, 20))
    await dopo(fixture)
    expect(q('nuova-errore-anno')!.textContent).toContain('due anni')
    expect(comp.valido()).toBeFalse()
    comp.avvia()
    expect(avvia).not.toHaveBeenCalled()
  })

  it('data iniziale dopo la finale: errore', async () => {
    await crea()
    imposta(giorno(2026, 10, 20), giorno(2026, 10, 10), giorno(2026, 10, 25))
    await dopo(fixture)
    expect(q('nuova-errore-periodo')).not.toBeNull()
    expect(comp.valido()).toBeFalse()
  })

  it('campi obbligatori mancanti: non si può avviare', async () => {
    await crea()
    imposta(null, null, null)
    expect(comp.valido()).toBeFalse()
  })

  it('avvia con il corpo giusto: date AAAA-MM-GG, raggruppamento, arretrati e filtri', async () => {
    await crea()
    imposta(giorno(2026, 10, 1), giorno(2026, 10, 31), giorno(2026, 10, 31))
    comp.raggruppamento = 'PER_ELENCO'
    comp.includiArretrati = true
    comp.clienteId = 'c1'
    comp.contrattoId = 'k1'
    comp.avvia()
    expect(avvia).toHaveBeenCalledWith({
      periodoDal: '2026-10-01',
      periodoAl: '2026-10-31',
      dataDocumento: '2026-10-31',
      raggruppamento: 'PER_ELENCO',
      includiArretrati: true,
      filtri: { clienteIds: ['c1'], contrattoIds: ['k1'] },
    })
  })

  it('senza filtri il corpo ha filtri vuoti e raggruppamento per contratto', async () => {
    await crea()
    imposta(giorno(2026, 10, 1), giorno(2026, 10, 31), giorno(2026, 10, 31))
    comp.avvia()
    expect(avvia.calls.mostRecent().args[0]).toEqual(
      jasmine.objectContaining({
        raggruppamento: 'PER_CONTRATTO',
        includiArretrati: false,
        filtri: {},
      })
    )
  })

  it('dopo l’avvio emette l’id per la navigazione al dettaglio', async () => {
    await crea()
    const emessi: string[] = []
    comp.avviato.subscribe(id => emessi.push(id))
    imposta(giorno(2026, 10, 1), giorno(2026, 10, 31), giorno(2026, 10, 31))
    comp.avvia()
    expect(emessi).toEqual(['e1'])
  })

  it('409 ELABORAZIONE_IN_CORSO: messaggio dal vocabolario, il dialog resta aperto', async () => {
    await crea()
    avvia.and.returnValue(
      throwError(() => ({ status: 409, error: { error: 'ELABORAZIONE_IN_CORSO', message: 'x' } }))
    )
    const chiusi: number[] = []
    comp.chiuso.subscribe(() => chiusi.push(1))
    imposta(giorno(2026, 10, 1), giorno(2026, 10, 31), giorno(2026, 10, 31))
    comp.avvia()
    await dopo(fixture)
    expect(q('nuova-errore')!.textContent).toContain('già in corso')
    expect(comp.inCorso()).toBeFalse()
    expect(chiusi).toEqual([])
  })

  it('messaggio del backend come array: tutti mostrati', async () => {
    await crea()
    avvia.and.returnValue(
      throwError(() => ({ status: 400, error: { message: ['uno non valido', 'due non valido'] } }))
    )
    imposta(giorno(2026, 10, 1), giorno(2026, 10, 31), giorno(2026, 10, 31))
    comp.avvia()
    await dopo(fixture)
    const t = q('nuova-errore')!.textContent!
    expect(t).toContain('uno non valido')
    expect(t).toContain('due non valido')
  })

  it('doppio clic su «Avvia»: una sola richiesta', async () => {
    await crea()
    const r = new Subject<{ id: string }>()
    avvia.and.returnValue(r)
    imposta(giorno(2026, 10, 1), giorno(2026, 10, 31), giorno(2026, 10, 31))
    comp.avvia()
    comp.avvia()
    expect(avvia).toHaveBeenCalledTimes(1)
  })

  it('reset del form alla chiusura e alla riapertura', async () => {
    await crea()
    imposta(giorno(2026, 10, 1), giorno(2026, 10, 31), giorno(2026, 10, 31))
    comp.raggruppamento = 'PER_ELENCO'
    comp.includiArretrati = true
    comp.clienteId = 'c1'
    comp.errore.set(['vecchio'])
    fixture.componentRef.setInput('visible', false)
    await dopo(fixture)
    expect(comp.periodoDal).toBeNull()
    expect(comp.raggruppamento).toBe('PER_CONTRATTO')
    expect(comp.includiArretrati).toBeFalse()
    expect(comp.clienteId).toBeNull()
    expect(comp.errore()).toEqual([])
    fixture.componentRef.setInput('visible', true)
    await dopo(fixture)
    expect(comp.periodoDal).toBeNull()
  })

  it('alla riapertura annulla le GET pendenti e ignora la risposta tardiva', async () => {
    await crea()
    fixture.componentRef.setInput('visible', false)
    await dopo(fixture)
    const vecchia = new Subject<unknown>()
    const nuova = new Subject<unknown>()
    listaClienti.and.returnValues(vecchia, nuova)
    fixture.componentRef.setInput('visible', true)
    await dopo(fixture)
    expect(vecchia.observed).toBeTrue()
    // Chiusura: la GET pendente viene annullata.
    fixture.componentRef.setInput('visible', false)
    await dopo(fixture)
    expect(vecchia.observed).toBeFalse()
    // Riapertura: nuova GET; la risposta della vecchia, arrivata tardi, non cambia il menu.
    fixture.componentRef.setInput('visible', true)
    await dopo(fixture)
    nuova.next({ elementi: [{ id: 'n', ditta: { ragioneSociale: 'Nuovo' } }], totale: 1 })
    vecchia.next({ elementi: [{ id: 'v', ditta: { ragioneSociale: 'Vecchio' } }], totale: 1 })
    expect(comp.opzioniClienti().map(o => o.value)).toEqual(['n'])
  })

  it('la ricerca contratti segue il cliente scelto', async () => {
    await crea()
    comp.scegliCliente('c1')
    await new Promise(r => setTimeout(r, 350))
    expect(listaContratti.calls.mostRecent().args[0]).toEqual(
      jasmine.objectContaining({ clienteId: 'c1', dimensione: 25 })
    )
  })

  it('«Annulla» emette chiuso; durante la richiesta non si chiude', async () => {
    await crea()
    const chiusi: number[] = []
    comp.chiuso.subscribe(() => chiusi.push(1))
    comp.chiudi()
    expect(chiusi.length).toBe(1)
    comp.inCorso.set(true)
    comp.chiudi()
    expect(chiusi.length).toBe(1)
  })
})
