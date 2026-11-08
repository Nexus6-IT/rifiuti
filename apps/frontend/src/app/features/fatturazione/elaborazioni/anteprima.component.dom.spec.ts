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

  it('errori del periodo (motivi reali): etichette leggibili e link con periodo, stato e contratto', async () => {
    await crea(
      'ADMIN',
      dettaglio({
        erroriPeriodo: [
          { motivo: 'DA_COLLEGARE', quanti: 4, contrattoId: null },
          {
            motivo: 'DA_RIALLINEARE',
            quanti: 2,
            contrattoId: 'k1',
            contrattoNumero: 'CC-2026-001',
          },
          { motivo: 'DA_RIALLINEARE', quanti: 3, contrattoId: 'k2' },
          {
            motivo: 'Nell’intervallo terminano più periodi del contratto: restringi le date.',
            quanti: 1,
            contrattoId: 'k3',
          },
        ],
      })
    )
    const gruppi = tutti('errori-gruppo')
    expect(gruppi.length).toBe(3)
    const titoli = gruppi.map(g => g.querySelector('[data-testid="errori-motivo"]')!.textContent!)
    expect(titoli[0]).toContain('Movimenti da collegare a un contratto')
    expect(titoli[1]).toContain('Movimenti da riallineare')
    expect(titoli.join(' ')).not.toContain('DA_COLLEGARE')
    expect(titoli.join(' ')).not.toContain('DA_RIALLINEARE')
    expect(titoli[2]).toContain('restringi le date')

    // Senza contratto il link c'è lo stesso, con stato e periodo.
    const senza = gruppi[0].querySelectorAll<HTMLAnchorElement>('[data-testid="errori-link"]')
    expect(senza.length).toBe(1)
    const h0 = senza[0].getAttribute('href')!
    expect(h0).toContain('/legami/da-collegare')
    expect(h0).toContain('stato=DA_COLLEGARE')
    expect(h0).toContain('dal=2026-10-01')
    expect(h0).toContain('al=2026-10-31')
    expect(h0).not.toContain('contrattoId')
    expect(senza[0].textContent).toContain('senza contratto')

    // Con più contratti: due link, testi distinti, contratto nel filtro.
    const con = gruppi[1].querySelectorAll<HTMLAnchorElement>('[data-testid="errori-link"]')
    expect(con.length).toBe(2)
    expect(con[0].getAttribute('href')).toContain('contrattoId=k1')
    expect(con[1].getAttribute('href')).toContain('contrattoId=k2')
    expect(con[0].textContent).toContain('contratto CC-2026-001 (2)')
    // Riepilogo salvato prima del campo: testo generico, senza indice.
    expect(con[1].textContent).toContain('di un contratto (3)')
    expect(con[1].textContent).not.toMatch(/contratto \d/)
    expect(con[0].textContent).not.toBe(con[1].textContent)
    expect(gruppi[1].querySelector('[data-testid="errori-quanti"]')!.textContent).toContain('5')

    // Periodo ambiguo: nessun link verso «da collegare».
    expect(gruppi[2].querySelector('[data-testid="errori-link"]')).toBeNull()
  })

  it('la scheda dei problemi non finali si chiama «Segnalazioni del periodo», non «Errori»', async () => {
    await crea('ADMIN')
    const intestazioni = Array.from(
      document.body.querySelectorAll<HTMLElement>('.p-tabview-nav-link')
    ).map(e => e.textContent ?? '')
    expect(intestazioni.some(t => t.includes('Segnalazioni del periodo ('))).toBeTrue()
    expect(intestazioni.some(t => t.includes('Errori del periodo'))).toBeFalse()
  })

  it('dopo la definitiva (o se scartata) la scheda «Numerazione prevista» non compare', async () => {
    await crea('ADMIN', dettaglio({ stato: 'DEFINITIVA' }))
    expect(q('tab-numerazione')).toBeNull()
    expect(q('tab-documenti')).not.toBeNull()
    fixture.destroy()
    TestBed.resetTestingModule()
    await crea('ADMIN', dettaglio({ stato: 'SCARTATA' }))
    expect(q('tab-numerazione')).toBeNull()
  })

  it("titolo: «Anteprima» finche` e` un'anteprima, poi «Elaborazione definitiva»", async () => {
    await crea('ADMIN')
    expect(q('an-titolo')!.textContent).toContain('Anteprima')
    fixture.destroy()
    TestBed.resetTestingModule()
    await crea('ADMIN', dettaglio({ stato: 'DEFINITIVA' }))
    expect(q('an-titolo')!.textContent).toContain('Elaborazione definitiva')
    expect(q('an-titolo')!.textContent).not.toContain('Anteprima')
  })

  it('dopo la definitiva: non dice «emesse», mostra i numeri assegnati e il link ai documenti filtrati', async () => {
    await crea(
      'ADMIN',
      dettaglio({
        stato: 'DEFINITIVA',
        numerazionePrevista: [
          { registroIvaId: 'r1', codiceRegistro: 'A', da: '100/A', a: '101/A', quanti: 2 },
        ],
      }),
      [
        documentoRiga(1, { stato: 'DEFINITIVO', numeroTesto: '100/A' }),
        documentoRiga(2, { stato: 'DEFINITIVO', numeroTesto: '101/A' }),
        documentoRiga(3, { stato: 'BOZZA', esclusoDaDefinitiva: true }),
      ]
    )
    const testo = q('an-definitiva')!.textContent!
    expect(testo).not.toContain('emesse')
    expect(testo).toContain('definitive')
    expect(q('an-definitiva-numeri')!.textContent).toContain('2 documenti')
    expect(q('an-definitiva-numeri')!.textContent).toContain('da 100/A a 101/A')
    const vai = q<HTMLAnchorElement>('an-vai-documenti')!
    expect(vai.getAttribute('href')).toContain('/fatturazione/documenti')
    expect(vai.getAttribute('href')).toContain('elaborazione=e1')
    // Colonna «Numero» e «Dettaglio» verso il documento (non per le bozze escluse).
    expect(tutti('doc-numero').map(x => x.textContent!.trim())).toEqual(['100/A', '101/A', '—'])
    expect(q<HTMLAnchorElement>('dettaglio-d1')!.getAttribute('href')).toBe(
      '/fatturazione/documenti/d1'
    )
    expect(q('dettaglio-d3')!.tagName).not.toBe('A')
  })

  it('numerazione prevista «da 15/A a 42/A»', async () => {
    await crea('ADMIN')
    expect(q('numerazione-r1')!.textContent).toContain('da 15/A a 42/A')
    expect(q('numerazione-r1')!.textContent).toContain('12.345,60')
  })

  it('dopo «Escludi» la conferma usa il numero riletto dal backend (quanti), non quello vecchio', async () => {
    await crea('ADMIN')
    servizio.escludi.and.returnValue(of(documentoRiga(1, { esclusoDaDefinitiva: true })))
    servizio.dettaglio.and.returnValue(
      of(
        dettaglio({
          versione: 3,
          numerazionePrevista: [
            { registroIvaId: 'r1', codiceRegistro: 'A', da: '15/A', a: '41/A', quanti: 27 },
          ],
        })
      )
    )
    bottone('escludi-d1')!.click()
    fixture.detectChanges()
    bottone('btn-definitiva')!.click()
    fixture.detectChanges()
    await fixture.whenStable()
    fixture.detectChanges()
    expect(q('conferma-testo')!.textContent).toContain(
      'Verranno emessi 27 documenti, numeri da 15/A a 41/A del registro A'
    )
  })

  it('tutti esclusi (numerazione vuota): «Rendi definitiva» disattivato con il motivo, visibile come testo', async () => {
    await crea('ADMIN', dettaglio({ numerazionePrevista: [] }))
    expect(bottone('btn-definitiva')!.disabled).toBeTrue()
    expect(q('motivo-definitiva')!.textContent).toContain(
      'Non c’è nessun documento da rendere definitivo'.replace('’', "'")
    )
  })

  it('anteprima già superata (esito salvato): «Rendi definitiva» disattivato, «Ricalcola» resta', async () => {
    await crea(
      'ADMIN',
      dettaglio({
        errore: {
          codice: 'ANTEPRIMA_SUPERATA',
          differenze: { nuovi: 1, cambiati: 0, fatturatiDaAltri: 0 },
        },
      })
    )
    expect(bottone('btn-definitiva')!.disabled).toBeTrue()
    expect(q('motivo-definitiva')!.textContent).toContain('non è più aggiornata')
    expect(q('esito-ricalcola')).not.toBeNull()
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
