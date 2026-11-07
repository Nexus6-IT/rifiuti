import { ComponentFixture, TestBed } from '@angular/core/testing'
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router'
import { provideNoopAnimations } from '@angular/platform-browser/animations'
import { MessageService } from 'primeng/api'
import { BehaviorSubject, Subject, of, throwError } from 'rxjs'
import { AuthService } from '../../../core/services/auth.service'
import { bottone, q, stabilizza } from '../../clienti/tabelle/tabelle-test-utils'
import {
  AdattatoreVista,
  CHIAVE_SELEZIONE_MAPPATURE,
  ChiaveMancante,
  MAX_VOCI_MAPPATURE,
  MappaturaVista,
} from '../fatturazione.model'
import { FatturazioneService } from '../fatturazione.service'
import { MESSAGGIO_TROPPE_MODIFICHE, MappatureComponent } from './mappature.component'

const ADATTATORE: AdattatoreVista = {
  codice: 'TEAMSYSTEM',
  nome: 'TeamSystem',
  modalita: 'FILE',
  verificato: true,
}

const mappatura = (o: Partial<MappaturaVista>): MappaturaVista => ({
  tipo: 'CODICE_IVA',
  chiaveWasteflow: '22',
  valore: 'A22',
  versione: 1,
  etichetta: 'IVA 22%',
  ...o,
})

const errore = (status: number, codice: string) => ({ status, error: { error: codice } })

describe('MappatureComponent', () => {
  let fixture: ComponentFixture<MappatureComponent>
  let servizio: jasmine.SpyObj<FatturazioneService>
  let param: BehaviorSubject<ReturnType<typeof convertToParamMap>>

  async function crea(
    ruolo: string,
    opzioni: {
      adattatori?: AdattatoreVista[]
      mappature?: MappaturaVista[]
      mancanti?: ChiaveMancante[]
      adattatore?: string | null
    } = {}
  ): Promise<void> {
    history.replaceState(opzioni.mancanti ? { mancanti: opzioni.mancanti } : {}, '')
    servizio = jasmine.createSpyObj('FatturazioneService', [
      'adattatori',
      'mappature',
      'salvaMappature',
      'chiaviMancanti',
    ])
    servizio.chiaviMancanti.and.returnValue(of([]))
    servizio.adattatori.and.returnValue(of(opzioni.adattatori ?? [ADATTATORE]))
    servizio.mappature.and.returnValue(of(opzioni.mappature ?? []))
    const codice = opzioni.adattatore === undefined ? 'TEAMSYSTEM' : opzioni.adattatore
    param = new BehaviorSubject(convertToParamMap(codice ? { adattatore: codice } : {}))
    await TestBed.configureTestingModule({
      imports: [MappatureComponent],
      providers: [
        provideNoopAnimations(),
        provideRouter([]),
        MessageService,
        { provide: FatturazioneService, useValue: servizio },
        { provide: AuthService, useValue: { currentUser: () => ({ role: ruolo }) } },
        { provide: ActivatedRoute, useValue: { paramMap: param } },
      ],
    }).compileComponents()
    fixture = TestBed.createComponent(MappatureComponent)
    await stabilizza(fixture)
  }

  const campo = (id: string): HTMLInputElement => q<HTMLInputElement>(id)!
  async function scrivi(id: string, testo: string): Promise<void> {
    const el = campo(id)
    el.value = testo
    el.dispatchEvent(new Event('input', { bubbles: true }))
    await stabilizza(fixture)
  }

  afterEach(() => {
    fixture?.destroy()
    history.replaceState({}, '')
    sessionStorage.removeItem(CHIAVE_SELEZIONE_MAPPATURE)
  })

  it("adattatore con verificato false: riquadro «Tracciato non verificato su un'installazione reale» in cima", async () => {
    await crea('ADMIN', {
      adattatori: [{ ...ADATTATORE, verificato: false }],
      mappature: [mappatura({})],
    })
    const riquadro = q('mappature-non-verificato')!
    expect(riquadro.textContent).toContain("Tracciato non verificato su un'installazione reale")
    const sezione = q('mappature-sezione-CODICE_IVA')!
    expect(
      riquadro.compareDocumentPosition(sezione) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy()
  })

  it('adattatore verificato: nessun riquadro', async () => {
    await crea('ADMIN')
    expect(q('mappature-non-verificato')).toBeNull()
  })

  it('una sezione per tipo, con chiave WasteFlow, etichetta e valore modificabile', async () => {
    await crea('ADMIN', {
      mappature: [
        mappatura({ tipo: 'CODICE_IVA', chiaveWasteflow: '22', valore: 'A22' }),
        mappatura({ tipo: 'CONTO_RICAVI', chiaveWasteflow: 'CAT1', valore: '4010' }),
      ],
      mancanti: [{ tipo: 'CODICE_IVA', chiaveWasteflow: '10', etichetta: 'IVA 10%' }],
    })
    expect(q('mappature-sezione-CODICE_IVA')).not.toBeNull()
    expect(q('mappature-sezione-CONTO_RICAVI')).not.toBeNull()
    expect(q('mappature-sezione-CLIENTE')).toBeNull()
    expect(servizio.mappature).toHaveBeenCalledOnceWith('TEAMSYSTEM')
    const riga22 = q('mappature-riga-CODICE_IVA-22')!
    expect(riga22.textContent).toContain('IVA 22%')
    expect(campo('mappature-valore-CODICE_IVA-22').value).toBe('A22')
    const riga10 = q('mappature-riga-CODICE_IVA-10')!
    expect(riga10.textContent).toContain('IVA 10%')
    expect(campo('mappature-valore-CODICE_IVA-10').value).toBe('')
    // il tracciato TeamSystem vuole solo cifre, al massimo 3 per il codice IVA
    expect(campo('mappature-valore-CODICE_IVA-10').getAttribute('maxlength')).toBe('3')
    expect(campo('mappature-valore-CODICE_IVA-10').getAttribute('inputmode')).toBe('numeric')
  })

  it('sotto ogni gruppo dice il formato richiesto e lo collega al campo', async () => {
    await crea('ADMIN', {
      mappature: [
        mappatura({ tipo: 'CODICE_IVA', chiaveWasteflow: '22', valore: 'A22' }),
        mappatura({ tipo: 'CONTO_RICAVI', chiaveWasteflow: 'RIFIUTO', valore: '' }),
      ],
    })
    const hint = q('mappature-formato-CODICE_IVA')!
    expect(hint.textContent).toContain('al massimo 3 cifre')
    expect(campo('mappature-valore-CODICE_IVA-22').getAttribute('aria-describedby')).toBe(hint.id)
    expect(q('mappature-formato-CONTO_RICAVI')!.textContent).toContain('7 cifre')
  })

  it('elenco delle mancanti in cima, finché non hanno un valore', async () => {
    await crea('ADMIN', {
      mancanti: [{ tipo: 'CODICE_IVA', chiaveWasteflow: '10', etichetta: 'IVA 10%' }],
    })
    const elenco = q('mappature-mancanti')!
    expect(elenco.textContent).toContain('IVA 10%')
    await scrivi('mappature-valore-CODICE_IVA-10', 'A10')
    expect(q('mappature-mancanti')).toBeNull()
  })

  it('solo ADMIN e SUPER_ADMIN: OPERATOR e VIEWER non chiamano il server', async () => {
    for (const ruolo of ['OPERATOR', 'VIEWER']) {
      TestBed.resetTestingModule()
      await crea(ruolo)
      expect(servizio.adattatori).not.toHaveBeenCalled()
      expect(servizio.mappature).not.toHaveBeenCalled()
      expect(q('mappature-non-autorizzato')).not.toBeNull()
      expect(q('mappature-salva')).toBeNull()
    }
    TestBed.resetTestingModule()
    await crea('SUPER_ADMIN')
    expect(servizio.mappature).toHaveBeenCalled()
    expect(q('mappature-non-autorizzato')).toBeNull()
  })

  it('nessun adattatore: stato vuoto chiaro', async () => {
    await crea('ADMIN', { adattatori: [], adattatore: null })
    expect(q('mappature-vuoto')!.textContent).toContain('Nessun gestionale contabile')
    expect(servizio.mappature).not.toHaveBeenCalled()
  })

  it('adattatore sconosciuto: messaggio del vocabolario, nessuna mappatura chiesta', async () => {
    await crea('ADMIN', { adattatore: 'ALTRO' })
    expect(q('mappature-errore')!.textContent).toContain('non è tra quelli disponibili')
    expect(servizio.mappature).not.toHaveBeenCalled()
  })

  it('salvataggio di più voci in un solo PUT, solo le modificate', async () => {
    await crea('ADMIN', {
      mappature: [
        mappatura({ chiaveWasteflow: '22', valore: 'A22', versione: 3 }),
        mappatura({ chiaveWasteflow: '4', valore: 'A4', etichetta: 'IVA 4%' }),
      ],
      mancanti: [{ tipo: 'PAGAMENTO', chiaveWasteflow: 'BONIFICO', etichetta: 'Bonifico' }],
    })
    servizio.salvaMappature.and.returnValue(
      of([
        mappatura({ chiaveWasteflow: '22', valore: 'B22', versione: 2 }),
        mappatura({ chiaveWasteflow: '4', valore: 'A4' }),
        mappatura({ tipo: 'PAGAMENTO', chiaveWasteflow: 'BONIFICO', valore: 'P1' }),
      ])
    )
    await scrivi('mappature-valore-CODICE_IVA-22', '  B22 ')
    await scrivi('mappature-valore-PAGAMENTO-BONIFICO', 'P1')
    bottone('mappature-salva')!.click()
    await stabilizza(fixture)
    expect(servizio.salvaMappature).toHaveBeenCalledTimes(1)
    expect(servizio.salvaMappature).toHaveBeenCalledWith('TEAMSYSTEM', [
      { tipo: 'CODICE_IVA', chiaveWasteflow: '22', valore: 'B22', versione: 3 },
      { tipo: 'PAGAMENTO', chiaveWasteflow: 'BONIFICO', valore: 'P1', versione: null },
    ])
    expect(campo('mappature-valore-CODICE_IVA-22').value).toBe('B22')
    expect(bottone('mappature-salva')!.disabled).toBeTrue()
  })

  it('senza modifiche il pulsante di salvataggio è disattivato', async () => {
    await crea('ADMIN', { mappature: [mappatura({})] })
    expect(bottone('mappature-salva')!.disabled).toBeTrue()
    await scrivi('mappature-valore-CODICE_IVA-22', 'X')
    expect(bottone('mappature-salva')!.disabled).toBeFalse()
  })

  it('valore vuoto di una voce salvata → null (cancella)', async () => {
    await crea('ADMIN', { mappature: [mappatura({})] })
    servizio.salvaMappature.and.returnValue(of([]))
    await scrivi('mappature-valore-CODICE_IVA-22', '   ')
    bottone('mappature-salva')!.click()
    await stabilizza(fixture)
    expect(servizio.salvaMappature).toHaveBeenCalledWith('TEAMSYSTEM', [
      { tipo: 'CODICE_IVA', chiaveWasteflow: '22', valore: null, versione: 1 },
    ])
  })

  it('una voce mai salvata e lasciata vuota non viene inviata', async () => {
    await crea('ADMIN', {
      mappature: [mappatura({})],
      mancanti: [{ tipo: 'CODICE_IVA', chiaveWasteflow: '10', etichetta: 'IVA 10%' }],
    })
    servizio.salvaMappature.and.returnValue(of([mappatura({ valore: 'Z' })]))
    await scrivi('mappature-valore-CODICE_IVA-22', 'Z')
    bottone('mappature-salva')!.click()
    await stabilizza(fixture)
    const voci = servizio.salvaMappature.calls.mostRecent().args[1]
    expect(voci.length).toBe(1)
  })

  it('oltre 500 modifiche: «Salva» disattivato con il messaggio, nessuna richiesta', async () => {
    await crea('ADMIN', { mappature: [mappatura({})] })
    fixture.componentInstance.righe.set(
      Array.from({ length: MAX_VOCI_MAPPATURE + 1 }, (_, i) => ({
        tipo: 'CODICE_IVA' as const,
        chiaveWasteflow: `K${i}`,
        etichetta: `Voce ${i}`,
        salvato: 'v',
        versione: 1,
        valore: 'w',
      }))
    )
    await stabilizza(fixture)
    expect(bottone('mappature-salva')!.disabled).toBeTrue()
    expect(q('mappature-troppe')!.textContent).toContain(
      'Salva le modifiche fatte prima di continuare (massimo 500 per volta)'
    )
    expect(MESSAGGIO_TROPPE_MODIFICHE).toContain('massimo 500 per volta')
    fixture.componentInstance.salva()
    expect(servizio.salvaMappature).not.toHaveBeenCalled()
  })

  it('1500 voci: si disegna la prima pagina da 50 senza errori e se ne modifica una', async () => {
    const molte = Array.from({ length: 1500 }, (_, i) =>
      mappatura({
        tipo: 'CLIENTE',
        chiaveWasteflow: `c${i}`,
        valore: `V${i}`,
        etichetta: `Cliente ${String(i).padStart(4, '0')}`,
      })
    )
    await crea('ADMIN', { mappature: molte })
    const campi = document.body.querySelectorAll('[data-testid^="mappature-valore-CLIENTE-"]')
    expect(campi.length).toBe(50)
    expect(document.body.querySelector('.p-paginator')).not.toBeNull()
    servizio.salvaMappature.and.returnValue(of(molte))
    await scrivi('mappature-valore-CLIENTE-c0', 'NUOVO')
    bottone('mappature-salva')!.click()
    await stabilizza(fixture)
    expect(servizio.salvaMappature).toHaveBeenCalledWith('TEAMSYSTEM', [
      { tipo: 'CLIENTE', chiaveWasteflow: 'c0', valore: 'NUOVO', versione: 1 },
    ])
  })

  it('i campi non usano la direttiva pInputText e nessuna riga mostra la chiave grezza', async () => {
    await crea('ADMIN', {
      mappature: [
        mappatura({
          tipo: 'CLIENTE',
          chiaveWasteflow: '0b7a3d6e-id-grezzo',
          etichetta: 'Rossi SRL',
        }),
      ],
    })
    const campo = q<HTMLInputElement>('mappature-valore-CLIENTE-0b7a3d6e-id-grezzo')!
    expect(campo.classList.contains('p-inputtext')).toBeTrue()
    expect(q('mappature-riga-CLIENTE-0b7a3d6e-id-grezzo')!.textContent).not.toContain('id-grezzo')
  })

  it('durante il salvataggio i campi sono disattivati', async () => {
    await crea('ADMIN', { mappature: [mappatura({})] })
    servizio.salvaMappature.and.returnValue(new Subject<MappaturaVista[]>())
    await scrivi('mappature-valore-CODICE_IVA-22', 'X')
    bottone('mappature-salva')!.click()
    await stabilizza(fixture)
    expect(campo('mappature-valore-CODICE_IVA-22').disabled).toBeTrue()
  })

  it('selezione in sessionStorage: POST mancanti e chiavi in cima', async () => {
    const selezione = { anno: 2026, registroIvaId: 'r1' }
    sessionStorage.setItem(CHIAVE_SELEZIONE_MAPPATURE, JSON.stringify(selezione))
    await crea('ADMIN', {})
    servizio.chiaviMancanti.and.returnValue(
      of([{ tipo: 'CODICE_IVA', chiaveWasteflow: '10', etichetta: 'IVA 10%' }])
    )
    param.next(convertToParamMap({ adattatore: 'TEAMSYSTEM' }))
    await stabilizza(fixture)
    expect(servizio.chiaviMancanti).toHaveBeenCalledWith('TEAMSYSTEM', selezione)
    expect(q('mappature-mancanti')!.textContent).toContain('IVA 10%')
    expect(campo('mappature-valore-CODICE_IVA-10').value).toBe('')
  })

  it('history.state ha la precedenza: nessun POST', async () => {
    sessionStorage.setItem(CHIAVE_SELEZIONE_MAPPATURE, JSON.stringify({ anno: 2026 }))
    await crea('ADMIN', {
      mancanti: [{ tipo: 'CODICE_IVA', chiaveWasteflow: '10', etichetta: 'IVA 10%' }],
    })
    expect(servizio.chiaviMancanti).not.toHaveBeenCalled()
    expect(q('mappature-mancanti')).not.toBeNull()
  })

  it('sessionStorage illeggibile o assente: nessun POST e la pagina funziona', async () => {
    sessionStorage.setItem(CHIAVE_SELEZIONE_MAPPATURE, '{non json')
    await crea('ADMIN', { mappature: [mappatura({})] })
    expect(servizio.chiaviMancanti).not.toHaveBeenCalled()
    expect(q('mappature-mancanti')).toBeNull()
    expect(q('mappature-sezione-CODICE_IVA')).not.toBeNull()
  })

  it('409 VERSIONE_SUPERATA: messaggio e ricarica', async () => {
    await crea('ADMIN', { mappature: [mappatura({})] })
    servizio.salvaMappature.and.returnValue(throwError(() => errore(409, 'VERSIONE_SUPERATA')))
    servizio.mappature.and.returnValue(of([mappatura({ valore: 'DALLALTRO' })]))
    await scrivi('mappature-valore-CODICE_IVA-22', 'X')
    bottone('mappature-salva')!.click()
    await stabilizza(fixture)
    expect(servizio.mappature).toHaveBeenCalledTimes(2)
    expect(q('mappature-errore')!.textContent).toContain('ricarica')
    expect(campo('mappature-valore-CODICE_IVA-22').value).toBe('DALLALTRO')
  })

  it('409 OPERAZIONE_CONCORRENTE: messaggio, i valori scritti restano e non si ricarica', async () => {
    await crea('ADMIN', { mappature: [mappatura({})] })
    servizio.salvaMappature.and.returnValue(throwError(() => errore(409, 'OPERAZIONE_CONCORRENTE')))
    await scrivi('mappature-valore-CODICE_IVA-22', 'X')
    bottone('mappature-salva')!.click()
    await stabilizza(fixture)
    expect(servizio.mappature).toHaveBeenCalledTimes(1)
    expect(q('mappature-errore')).not.toBeNull()
    expect(campo('mappature-valore-CODICE_IVA-22').value).toBe('X')
  })

  it('errore 400 con codice del vocabolario: etichetta, senza id né dati', async () => {
    await crea('ADMIN', { mappature: [mappatura({})] })
    servizio.salvaMappature.and.returnValue(throwError(() => errore(400, 'VOCI_DUPLICATE')))
    await scrivi('mappature-valore-CODICE_IVA-22', 'X')
    bottone('mappature-salva')!.click()
    await stabilizza(fixture)
    expect(q('mappature-errore')!.textContent).toContain('più volte')
  })

  it('doppio clic su «Salva»: una sola richiesta', async () => {
    await crea('ADMIN', { mappature: [mappatura({})] })
    const risposta = new Subject<MappaturaVista[]>()
    servizio.salvaMappature.and.returnValue(risposta)
    await scrivi('mappature-valore-CODICE_IVA-22', 'X')
    bottone('mappature-salva')!.click()
    bottone('mappature-salva')!.click()
    expect(servizio.salvaMappature).toHaveBeenCalledTimes(1)
    risposta.complete()
  })

  it('le GET pendenti si annullano alla distruzione e al cambio di adattatore', async () => {
    const lenta = new Subject<MappaturaVista[]>()
    history.replaceState({}, '')
    servizio = jasmine.createSpyObj('FatturazioneService', [
      'adattatori',
      'mappature',
      'chiaviMancanti',
    ])
    servizio.chiaviMancanti.and.returnValue(of([]))
    servizio.adattatori.and.returnValue(of([ADATTATORE, { ...ADATTATORE, codice: 'ALTRO' }]))
    servizio.mappature.and.returnValue(lenta)
    param = new BehaviorSubject(convertToParamMap({ adattatore: 'TEAMSYSTEM' }))
    await TestBed.configureTestingModule({
      imports: [MappatureComponent],
      providers: [
        provideNoopAnimations(),
        provideRouter([]),
        MessageService,
        { provide: FatturazioneService, useValue: servizio },
        { provide: AuthService, useValue: { currentUser: () => ({ role: 'ADMIN' }) } },
        { provide: ActivatedRoute, useValue: { paramMap: param } },
      ],
    }).compileComponents()
    fixture = TestBed.createComponent(MappatureComponent)
    await stabilizza(fixture)
    expect(lenta.observed).toBeTrue()
    const seconda = new Subject<MappaturaVista[]>()
    servizio.mappature.and.returnValue(seconda)
    param.next(convertToParamMap({ adattatore: 'ALTRO' }))
    await stabilizza(fixture)
    expect(lenta.observed).toBeFalse()
    expect(seconda.observed).toBeTrue()
    fixture.destroy()
    expect(seconda.observed).toBeFalse()
  })

  it('senza adattatore nell’indirizzo: elenco dei gestionali con un collegamento ciascuno', async () => {
    await crea('ADMIN', { adattatore: null })
    const link = q<HTMLAnchorElement>('mappature-adattatore-TEAMSYSTEM')!
    expect(link.textContent).toContain('TeamSystem')
    expect(servizio.mappature).not.toHaveBeenCalled()
  })

  it('errore di caricamento: messaggio e «Riprova»', async () => {
    await crea('ADMIN')
    servizio.mappature.and.returnValue(throwError(() => ({ status: 500 })))
    param.next(convertToParamMap({ adattatore: 'TEAMSYSTEM' }))
    await stabilizza(fixture)
    expect(q('mappature-errore')).not.toBeNull()
    expect(bottone('mappature-riprova')).not.toBeNull()
  })
})
