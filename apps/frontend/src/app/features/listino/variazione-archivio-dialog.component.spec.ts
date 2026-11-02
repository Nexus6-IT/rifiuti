import { ComponentFixture, TestBed } from '@angular/core/testing'
import { provideNoopAnimations } from '@angular/platform-browser/animations'
import { Subject, of, throwError } from 'rxjs'
import { VariazioneArchivioDialogComponent } from './variazione-archivio-dialog.component'
import { ListinoService } from './listino.service'
import { AnteprimaVariazione, CodiceIva, CodificaAddebito } from './listino.model'
import { AuthService } from '../../core/services/auth.service'
import { bottone, q, scrivi, stabilizza } from '../clienti/tabelle/tabelle-test-utils'

const ANTEPRIMA: AnteprimaVariazione = {
  totale: 2,
  righe: [
    { id: 'ad1', descrizione: 'Trasporto', listino: 1, prima: '10.00', dopo: '10.50' },
    { id: 'ad1', descrizione: 'Trasporto', listino: 2, prima: '8.00', dopo: '8.40' },
  ],
  errori: [],
  impronta: 'abc123',
}

const ANTEPRIMA_CON_ERRORI: AnteprimaVariazione = {
  ...ANTEPRIMA,
  errori: [{ id: 'ad2', descrizione: 'Analisi', messaggio: 'Il prezzo supera il massimo.' }],
}

const iva = (id: string, codice: string): CodiceIva => ({
  id,
  versione: 1,
  eliminabile: true,
  codice,
  descrizione: `Iva ${codice}`,
  aliquota: '22.00',
  natura: null,
  attivo: true,
})

describe('VariazioneArchivioDialogComponent', () => {
  let fixture: ComponentFixture<VariazioneArchivioDialogComponent>
  let addebiti: { anteprimaVariazione: jasmine.Spy; applicaVariazione: jasmine.Spy }
  let applicati: number[]
  let visibilita: boolean[]

  async function apri(role = 'ADMIN', addebitiIds: string[] | null = null) {
    TestBed.overrideProvider(AuthService, { useValue: { currentUser: () => ({ role }) } })
    fixture = TestBed.createComponent(VariazioneArchivioDialogComponent)
    applicati = []
    visibilita = []
    fixture.componentInstance.applicata.subscribe(n => applicati.push(n))
    fixture.componentInstance.visibleChange.subscribe(v => visibilita.push(v))
    fixture.componentRef.setInput('addebitiIds', addebitiIds)
    fixture.componentRef.setInput('visible', true)
    await stabilizza(fixture)
  }

  const sel = (id: string, v: string) => {
    const s = q<HTMLSelectElement>(id)!
    s.value = v
    s.dispatchEvent(new Event('change'))
  }
  async function preparaAumento(valore = '3,5') {
    sel('var-tipo', 'AUMENTO_PERCENTUALE')
    await stabilizza(fixture)
    scrivi('var-valore', valore)
    await stabilizza(fixture)
  }
  async function anteprima() {
    bottone('var-anteprima')!.click()
    await stabilizza(fixture)
  }

  beforeEach(() => {
    addebiti = {
      anteprimaVariazione: jasmine.createSpy('anteprima').and.returnValue(of(ANTEPRIMA)),
      applicaVariazione: jasmine.createSpy('applica').and.returnValue(of({ aggiornati: 2 })),
    }
    TestBed.configureTestingModule({
      imports: [VariazioneArchivioDialogComponent],
      providers: [
        provideNoopAnimations(),
        {
          provide: ListinoService,
          useValue: {
            addebiti,
            codifiche: {
              list: jasmine.createSpy('list').and.returnValue(
                of([
                  {
                    id: 'c1',
                    codice: '001',
                    descrizione: 'Standard',
                    genere: 'CATEGORIA',
                  } as CodificaAddebito,
                  {
                    id: 'c2',
                    codice: '002',
                    descrizione: 'Speciale',
                    genere: 'CATEGORIA',
                  } as CodificaAddebito,
                ])
              ),
            },
            codiciIva: {
              list: jasmine
                .createSpy('list')
                .and.returnValue(of([iva('i1', '22'), iva('i2', '10')])),
            },
          },
        },
        { provide: AuthService, useValue: { currentUser: () => ({ role: 'ADMIN' }) } },
      ],
    })
  })
  afterEach(() => fixture?.destroy())

  it('prima dell’anteprima non c’è nessun pulsante per applicare', async () => {
    await apri()
    expect(q('var-applica')).toBeNull()
    expect(bottone('var-anteprima')!.disabled).toBeTrue()
  })

  it('virgola obbligatoria: «3.5» dà l’errore e l’anteprima resta spenta', async () => {
    await apri()
    await preparaAumento('3.5')
    q<HTMLInputElement>('var-tipo-F')!.click()
    expect(q('var-errore-valore')!.textContent).toContain('Usa la virgola per i decimali')
    expect(bottone('var-anteprima')!.disabled).toBeTrue()
  })

  it('l’anteprima manda il valore con il punto, come stringa, e i listini scelti', async () => {
    await apri()
    await preparaAumento('3,5')
    q<HTMLInputElement>('var-cat-c1')!.click()
    q<HTMLInputElement>('var-cat-c2')!.click()
    q<HTMLInputElement>('var-tipo-F')!.click()
    q<HTMLInputElement>('var-tipo-TS')!.click()
    for (const n of [3, 4, 5, 6]) q<HTMLInputElement>(`var-listino-${n}`)!.click()
    await stabilizza(fixture)
    await anteprima()
    expect(addebiti.anteprimaVariazione).toHaveBeenCalledOnceWith({
      tipo: 'AUMENTO_PERCENTUALE',
      valore: '3.5',
      filtri: { listini: [1, 2], categorieIds: ['c1', 'c2'], tipi: ['F', 'TS'] },
    })
  })

  it('aperta da una riga limita l’anteprima a quell’addebito', async () => {
    await apri('ADMIN', ['ad1'])
    await preparaAumento('2')
    await anteprima()
    expect(addebiti.anteprimaVariazione.calls.mostRecent().args[0].filtri.addebitiIds).toEqual([
      'ad1',
    ])
  })

  it('mostra la tabella vecchio → nuovo per addebito e listino', async () => {
    await apri()
    await preparaAumento()
    await anteprima()
    const testo = q('var-righe')!.textContent!
    expect(testo).toContain('Trasporto')
    expect(testo).toContain('10.00')
    expect(testo).toContain('10.50')
    expect(testo).toContain('8.40')
    expect(testo).not.toContain('ad1')
    expect(q('var-errori')).toBeNull()
  })

  it('errori nell’anteprima: sono bloccanti, la variazione non si applica (D20)', async () => {
    addebiti.anteprimaVariazione.and.returnValue(of(ANTEPRIMA_CON_ERRORI))
    await apri()
    await preparaAumento()
    await anteprima()
    const errori = q('var-errori')!.textContent!
    expect(errori).toContain('Analisi')
    expect(errori).toContain('Il prezzo supera il massimo.')
    expect(errori).toContain('non può essere applicata')
    expect(errori).not.toContain('Non verranno modificati')
    expect(bottone('var-applica')!.disabled).toBeTrue()
    bottone('var-applica')!.click()
    await stabilizza(fixture)
    expect(q('var-riepilogo')).toBeNull()
    expect(addebiti.applicaVariazione).not.toHaveBeenCalled()
  })

  it('cambiare un listino dopo l’anteprima la scarta', async () => {
    await apri()
    await preparaAumento()
    await anteprima()
    expect(q('var-applica')).toBeTruthy()
    q<HTMLInputElement>('var-listino-6')!.click()
    await stabilizza(fixture)
    expect(q('var-applica')).toBeNull()
    expect(q('var-righe')).toBeNull()
  })

  it('durante l’applicazione Annulla è disabilitato', async () => {
    addebiti.applicaVariazione.and.returnValue(new Subject())
    await apri()
    await preparaAumento()
    await anteprima()
    bottone('var-applica')!.click()
    await stabilizza(fixture)
    bottone('var-conferma-finale')!.click()
    await stabilizza(fixture)
    expect(bottone('var-chiudi')!.disabled).toBeTrue()
  })

  it('applica dopo il riepilogo di conferma, con l’impronta dell’anteprima', async () => {
    await apri()
    await preparaAumento()
    await anteprima()
    bottone('var-applica')!.click()
    await stabilizza(fixture)
    expect(addebiti.applicaVariazione).not.toHaveBeenCalled()
    expect(q('var-riepilogo')!.textContent).toContain('3,5')
    bottone('var-conferma-finale')!.click()
    await stabilizza(fixture)
    expect(addebiti.applicaVariazione).toHaveBeenCalledOnceWith({
      tipo: 'AUMENTO_PERCENTUALE',
      valore: '3.5',
      filtri: { listini: [1, 2, 3, 4, 5, 6] },
      impronta: 'abc123',
    })
  })

  it('a esito: "Prezzi aggiornati: N" e notifica del numero', async () => {
    await apri()
    await preparaAumento()
    await anteprima()
    bottone('var-applica')!.click()
    await stabilizza(fixture)
    bottone('var-conferma-finale')!.click()
    await stabilizza(fixture)
    expect(q('var-esito')!.textContent).toContain('Prezzi aggiornati: 2')
    expect(applicati).toEqual([2])
    expect(bottone('var-applica')).toBeNull()
  })

  it('cambiare un valore dopo l’anteprima la invalida: non si applica più', async () => {
    await apri()
    await preparaAumento()
    await anteprima()
    expect(q('var-applica')).toBeTruthy()
    scrivi('var-valore', '4')
    await stabilizza(fixture)
    expect(q('var-applica')).toBeNull()
    expect(q('var-righe')).toBeNull()
  })

  it('anteprima senza righe: niente da applicare', async () => {
    addebiti.anteprimaVariazione.and.returnValue(
      of({ totale: 0, righe: [], errori: [], impronta: 'x' })
    )
    await apri()
    await preparaAumento()
    await anteprima()
    expect(q('var-nessuna-riga')).toBeTruthy()
    expect(bottone('var-applica')!.disabled).toBeTrue()
  })

  it('409 all’applicazione: "rifai l’anteprima", anteprima scartata, niente esito', async () => {
    addebiti.applicaVariazione.and.returnValue(
      throwError(() => ({ status: 409, error: { message: 'Impronta non valida.' } }))
    )
    await apri()
    await preparaAumento()
    await anteprima()
    bottone('var-applica')!.click()
    await stabilizza(fixture)
    bottone('var-conferma-finale')!.click()
    await stabilizza(fixture)
    expect(q('var-errore')!.textContent).toContain('rifai l’anteprima')
    expect(q('var-applica')).toBeNull()
    expect(q('var-esito')).toBeNull()
    expect(applicati).toEqual([])
    // si può rifare l'anteprima
    expect(bottone('var-anteprima')!.disabled).toBeFalse()
  })

  it('altri errori dell’applicazione: messaggio del backend', async () => {
    addebiti.applicaVariazione.and.returnValue(
      throwError(() => ({ status: 400, error: { message: 'Troppe righe.' } }))
    )
    await apri()
    await preparaAumento()
    await anteprima()
    bottone('var-applica')!.click()
    await stabilizza(fixture)
    bottone('var-conferma-finale')!.click()
    await stabilizza(fixture)
    expect(q('var-errore')!.textContent).toContain('Troppe righe.')
  })

  it('errore dell’anteprima: messaggio del backend', async () => {
    addebiti.anteprimaVariazione.and.returnValue(
      throwError(() => ({ status: 400, error: { message: 'Il valore non è valido.' } }))
    )
    await apri()
    await preparaAumento()
    await anteprima()
    expect(q('var-errore')!.textContent).toContain('Il valore non è valido.')
    expect(q('var-applica')).toBeNull()
  })

  it('sostituzione IVA: listino 0 mostrato come "—" e esito "Addebiti aggiornati"', async () => {
    addebiti.anteprimaVariazione.and.returnValue(
      of({
        totale: 1,
        righe: [{ id: 'ad1', descrizione: 'Trasporto', listino: 0, prima: '22', dopo: '10' }],
        errori: [],
        impronta: 'iva1',
      })
    )
    await apri()
    sel('var-tipo', 'SOSTITUZIONE_IVA')
    await stabilizza(fixture)
    sel('var-da-iva', 'i1')
    sel('var-a-iva', 'i2')
    await stabilizza(fixture)
    await anteprima()
    const celle = Array.from(q('var-righe')!.querySelectorAll('tbody td')).map(c =>
      c.textContent!.trim()
    )
    expect(celle[1]).toBe('—')
    bottone('var-applica')!.click()
    await stabilizza(fixture)
    bottone('var-conferma-finale')!.click()
    await stabilizza(fixture)
    expect(q('var-esito')!.textContent).toContain('Addebiti aggiornati: 2')
    expect(q('var-esito')!.textContent).not.toContain('Prezzi aggiornati')
  })

  it('sostituzione IVA: servono i due codici IVA e nessun valore', async () => {
    await apri()
    sel('var-tipo', 'SOSTITUZIONE_IVA')
    await stabilizza(fixture)
    expect(q('var-valore')).toBeNull()
    expect(bottone('var-anteprima')!.disabled).toBeTrue()
    sel('var-da-iva', 'i1')
    sel('var-a-iva', 'i2')
    await stabilizza(fixture)
    await anteprima()
    expect(addebiti.anteprimaVariazione).toHaveBeenCalledOnceWith({
      tipo: 'SOSTITUZIONE_IVA',
      daCodiceIvaId: 'i1',
      aCodiceIvaId: 'i2',
      filtri: { listini: [1, 2, 3, 4, 5, 6] },
    })
  })

  it('una risposta di anteprima in ritardo non vale più', async () => {
    const vecchia = new Subject<AnteprimaVariazione>()
    const nuova = new Subject<AnteprimaVariazione>()
    addebiti.anteprimaVariazione.and.returnValues(vecchia, nuova)
    await apri()
    await preparaAumento()
    await anteprima()
    await anteprima()
    nuova.next({ ...ANTEPRIMA, impronta: 'nuova' })
    vecchia.next({ ...ANTEPRIMA, impronta: 'vecchia' })
    await stabilizza(fixture)
    bottone('var-applica')!.click()
    await stabilizza(fixture)
    bottone('var-conferma-finale')!.click()
    expect(addebiti.applicaVariazione.calls.mostRecent().args[0].impronta).toBe('nuova')
  })

  it('senza ruolo di amministratore non si applica', async () => {
    await apri('OPERATOR')
    await preparaAumento()
    await anteprima()
    expect(bottone('var-applica')!.disabled).toBeTrue()
  })

  it('alla riapertura lo stato è azzerato', async () => {
    await apri()
    await preparaAumento()
    await anteprima()
    fixture.componentRef.setInput('visible', false)
    fixture.componentRef.setInput('visible', true)
    await stabilizza(fixture)
    expect(q('var-righe')).toBeNull()
    expect(q<HTMLInputElement>('var-valore')!.value).toBe('')
  })
})
