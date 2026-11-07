import { ComponentFixture, TestBed } from '@angular/core/testing'
import { provideNoopAnimations } from '@angular/platform-browser/animations'
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router'
import { Observable, Subject, of } from 'rxjs'
import { AuthService } from '../../../core/services/auth.service'
import { ElaborazioneDettaglio } from '../fatturazione.model'
import { FatturazioneService } from '../fatturazione.service'
import { AnteprimaComponent } from './anteprima.component'
import { dettaglio, documentoRiga, paginaDocumenti } from './anteprima.fixture'

const q = <T extends HTMLElement = HTMLElement>(id: string): T | null =>
  document.body.querySelector<T>(`[data-testid="${id}"]`)
const tutti = (id: string): HTMLElement[] =>
  Array.from(document.body.querySelectorAll<HTMLElement>(`[data-testid="${id}"]`))
const bottone = (id: string): HTMLButtonElement | null =>
  q(id)?.querySelector('button') ?? (q(id) as HTMLButtonElement | null)

describe('AnteprimaComponent (DOM)', () => {
  let fixture: ComponentFixture<AnteprimaComponent>
  let servizio: jasmine.SpyObj<FatturazioneService>

  async function crea(
    ruolo: string,
    d: ElaborazioneDettaglio | Observable<ElaborazioneDettaglio> = dettaglio(),
    documenti = [
      documentoRiga(1),
      documentoRiga(2, {
        errori: [{ codice: 'SENZA_REGISTRO_IVA', messaggio: 'testo libero del backend' }],
        avvisi: [{ codice: 'ARRETRATI_PRESENTI', messaggio: 'altro testo' }],
      }),
    ]
  ): Promise<void> {
    servizio = jasmine.createSpyObj('FatturazioneService', [
      'dettaglio',
      'documentiElaborazione',
      'ricalcola',
      'scarta',
      'definitiva',
      'escludi',
      'riammetti',
      'documento',
      'scaricaPdf',
    ])
    servizio.dettaglio.and.returnValue('subscribe' in d ? d : of(d))
    servizio.documentiElaborazione.and.returnValue(of(paginaDocumenti(documenti)))
    await TestBed.configureTestingModule({
      imports: [AnteprimaComponent],
      providers: [
        provideNoopAnimations(),
        provideRouter([]),
        { provide: FatturazioneService, useValue: servizio },
        {
          provide: ActivatedRoute,
          useValue: { snapshot: { paramMap: convertToParamMap({ id: 'e1' }) } },
        },
        { provide: AuthService, useValue: { currentUser: () => ({ role: ruolo }) } },
      ],
    }).compileComponents()
    fixture = TestBed.createComponent(AnteprimaComponent)
    fixture.detectChanges()
    await fixture.whenStable()
    fixture.detectChanges()
  }

  afterEach(() => fixture?.destroy())

  it('usa la classe pagina-lavoro e mostra periodo e stato', async () => {
    await crea('ADMIN')
    expect(fixture.nativeElement.querySelector('.pagina-lavoro')).not.toBeNull()
    expect(q('an-periodo')!.textContent).toContain('01/10/2026')
    expect(q('an-periodo')!.textContent).toContain('31/10/2026')
    expect(q('an-stato')!.textContent).toContain('Anteprima pronta')
  })

  it('documenti con imponibile, IVA, totale, errori e avvisi dal vocabolario', async () => {
    await crea('ADMIN')
    const r1 = q('documento-d1')!
    expect(r1.querySelector('[data-testid="doc-imponibile"]')!.textContent).toContain('1.000,00')
    expect(r1.querySelector('[data-testid="doc-iva"]')!.textContent).toContain('220,00')
    expect(r1.querySelector('[data-testid="doc-totale"]')!.textContent).toContain('1.220,00')
    const segn = q('documento-d2')!.querySelector('[data-testid="doc-segnalazioni"]')!.textContent!
    expect(segn).toContain('registro IVA')
    expect(segn).not.toContain('testo libero del backend')
    expect(servizio.documentiElaborazione).toHaveBeenCalledWith('e1', {
      pagina: 1,
      dimensione: 50,
    })
  })

  it('dimensione di pagina non oltre 100', async () => {
    await crea('ADMIN')
    const comp = fixture.componentInstance
    expect(comp.dimensione).toBeLessThanOrEqual(100)
  })

  it('escludi: chiama il servizio, la riga diventa «Escluso» e il dettaglio viene riletto', async () => {
    await crea('ADMIN')
    servizio.escludi.and.returnValue(of(documentoRiga(1, { esclusoDaDefinitiva: true })))
    bottone('escludi-d1')!.click()
    fixture.detectChanges()
    expect(servizio.escludi).toHaveBeenCalledWith('e1', 'd1')
    expect(servizio.dettaglio).toHaveBeenCalledTimes(2)
    expect(q('documento-d1')!.querySelector('[data-testid="doc-escluso"]')).not.toBeNull()
    expect(q('escludi-d1')).toBeNull()
    expect(q('riammetti-d1')).not.toBeNull()
  })

  it('riammetti: chiama il servizio e la riga torna normale', async () => {
    await crea('ADMIN', dettaglio(), [documentoRiga(1, { esclusoDaDefinitiva: true })])
    servizio.riammetti.and.returnValue(of(documentoRiga(1)))
    bottone('riammetti-d1')!.click()
    fixture.detectChanges()
    expect(servizio.riammetti).toHaveBeenCalledWith('e1', 'd1')
    expect(q('documento-d1')!.querySelector('[data-testid="doc-escluso"]')).toBeNull()
  })

  it('errori del periodo raggruppati per motivo, con link ai movimenti da collegare per periodo e contratto', async () => {
    await crea(
      'ADMIN',
      dettaglio({
        erroriPeriodo: [
          { motivo: 'SENZA_REGISTRO_IVA', quanti: 2, contrattoId: 'k1' },
          { motivo: 'SENZA_REGISTRO_IVA', quanti: 3, contrattoId: 'k2' },
          { motivo: 'CONTRATTO_SOSPESO', quanti: 1, contrattoId: null },
        ],
      })
    )
    const gruppi = tutti('errori-gruppo')
    expect(gruppi.length).toBe(2)
    expect(gruppi[0].querySelector('[data-testid="errori-quanti"]')!.textContent).toContain('5')
    const link = gruppi[0].querySelectorAll<HTMLAnchorElement>('[data-testid="errori-link"]')
    expect(link.length).toBe(2)
    const href = link[0].getAttribute('href')!
    expect(href).toContain('/legami/da-collegare')
    expect(href).toContain('contrattoId=k1')
    expect(href).toContain('dataDa=2026-10-01')
    expect(href).toContain('dataA=2026-10-31')
    expect(gruppi[1].querySelector('[data-testid="errori-link"]')).toBeNull()
  })

  it('numerazione prevista «da 15/A a 42/A»', async () => {
    await crea('ADMIN')
    expect(q('numerazione-r1')!.textContent).toContain('da 15/A a 42/A')
    expect(q('numerazione-r1')!.textContent).toContain('12.345,60')
  })

  it('«Rendi definitiva» apre la conferma con numeri e data, e manda impronta e versione', async () => {
    await crea('ADMIN')
    servizio.definitiva.and.returnValue(of({ id: 'e1' }))
    bottone('btn-definitiva')!.click()
    fixture.detectChanges()
    await fixture.whenStable()
    fixture.detectChanges()
    expect(q('conferma-testo')!.textContent).toContain(
      'Verranno emessi 28 documenti, numeri da 15/A a 42/A del registro A, data 03/11/2026.'
    )
    bottone('conferma-ok')!.click()
    expect(servizio.definitiva).toHaveBeenCalledWith('e1', 'a'.repeat(64), 3)
  })

  it('solo l’ADMIN vede «Rendi definitiva»; l’OPERATOR vede ricalcola e scarta', async () => {
    await crea('OPERATOR')
    expect(q('btn-definitiva')).toBeNull()
    expect(q('btn-ricalcola')).not.toBeNull()
    expect(q('btn-scarta')).not.toBeNull()
  })

  it('definitiveAttive false: pulsante disattivato con il motivo del vocabolario', async () => {
    await crea('ADMIN', dettaglio({ definitiveAttive: false }))
    expect(bottone('btn-definitiva')!.disabled).toBeTrue()
    expect(q('motivo-definitiva')!.textContent).toContain(
      'Le fatture definitive non sono ancora attive per questa azienda'
    )
    expect(fixture.componentInstance.motivoDefinitiva()).toBe(
      'Le fatture definitive non sono ancora attive per questa azienda'
    )
  })

  it('definitiveAttive assente nella risposta: trattato come spento', async () => {
    const d = dettaglio() as Partial<ElaborazioneDettaglio>
    delete d.definitiveAttive
    await crea('ADMIN', d as ElaborazioneDettaglio)
    expect(bottone('btn-definitiva')!.disabled).toBeTrue()
  })

  it('errore generale bloccante: pulsante disattivato; LEGAMI_SENZA_CONTRATTO non blocca', async () => {
    await crea(
      'ADMIN',
      dettaglio({ erroriGenerali: [{ codice: 'CEDENTE_INCOMPLETO', messaggio: 'x' }] })
    )
    expect(bottone('btn-definitiva')!.disabled).toBeTrue()
    fixture.destroy()
    TestBed.resetTestingModule()
    await crea(
      'ADMIN',
      dettaglio({ erroriGenerali: [{ codice: 'LEGAMI_SENZA_CONTRATTO', messaggio: 'x' }] })
    )
    expect(bottone('btn-definitiva')!.disabled).toBeFalse()
  })

  it('ANTEPRIMA_SUPERATA salvata: messaggio con le differenze e «Ricalcola»', async () => {
    await crea(
      'ADMIN',
      dettaglio({
        errore: {
          codice: 'ANTEPRIMA_SUPERATA',
          differenze: { nuovi: 2, cambiati: 1, fatturatiDaAltri: 3 },
        },
      })
    )
    expect(q('an-esito-messaggio')!.textContent).toContain('non è più aggiornata')
    expect(q('an-esito-differenze')!.textContent).toContain('2 nuovi, 1 cambiati, 3 già fatturati')
    expect(q('esito-ricalcola')).not.toBeNull()
  })

  it('FALLITA: messaggio senza dettagli tecnici', async () => {
    await crea(
      'ADMIN',
      dettaglio({
        stato: 'FALLITA',
        erroreTecnico: 'ECONNREFUSED 10.0.0.5:5432 stack',
        errore: null,
      })
    )
    const t = q('an-fallita')!.textContent!
    expect(t).toContain('non è riuscita')
    expect(t).not.toContain('ECONNREFUSED')
    expect(document.body.textContent).not.toContain('ECONNREFUSED')
    expect(q('an-riepilogo')).toBeNull()
  })

  it('VIEWER: nessuna azione (né barra, né escludi, né definitiva)', async () => {
    await crea('VIEWER')
    for (const id of ['btn-ricalcola', 'btn-scarta', 'btn-definitiva', 'escludi-d1']) {
      expect(q(id)).withContext(id).toBeNull()
    }
    expect(q('dettaglio-d1')).not.toBeNull()
  })

  it('errore di lettura: messaggio senza id e «Riprova»', async () => {
    await crea(
      'ADMIN',
      new Observable(o => o.error({ status: 500, error: { message: 'boom e1' } }))
    )
    expect(q('an-errore')!.textContent).toContain('Impossibile caricare l’elaborazione.')
    expect(q('an-errore')!.textContent).not.toContain('boom')
    expect(q('an-riprova')).not.toBeNull()
  })

  it('«Dettaglio» apre la finestra del documento', async () => {
    await crea('ADMIN')
    servizio.documento.and.returnValue(new Subject<never>())
    bottone('dettaglio-d1')!.click()
    fixture.detectChanges()
    expect(servizio.documento).toHaveBeenCalledWith('d1')
  })
})
