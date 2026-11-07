import { ComponentFixture, TestBed } from '@angular/core/testing'
import { provideNoopAnimations } from '@angular/platform-browser/animations'
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router'
import { Subject, of, throwError } from 'rxjs'
import { AuthService } from '../../../core/services/auth.service'
import { DocumentoDettaglio } from '../fatturazione.model'
import { FatturazioneService, FileScaricato } from '../fatturazione.service'
import {
  DocumentoDettaglioComponent,
  MSG_DOCUMENTO_NON_CARICATO,
  MSG_PDF_NON_SCARICATO,
} from './documento-dettaglio.component'
import { dettaglioDocumento, erroreBlob, svuotaPromesse } from './documenti.fixture'

const q = <T extends HTMLElement = HTMLElement>(id: string): T | null =>
  document.body.querySelector<T>(`[data-testid="${id}"]`)

const bottone = (id: string): HTMLButtonElement | null =>
  q(id)?.querySelector('button') ?? (q(id) as HTMLButtonElement | null)

const file = (): FileScaricato => ({ blob: new Blob(['x']), nomeFile: 'IT1_00001.xml', saltati: 0 })

describe('DocumentoDettaglioComponent', () => {
  let fixture: ComponentFixture<DocumentoDettaglioComponent>
  let comp: DocumentoDettaglioComponent
  let servizio: jasmine.SpyObj<FatturazioneService>
  let salvati: string[]

  async function crea(
    ruolo = 'ADMIN',
    doc: DocumentoDettaglio = dettaglioDocumento(),
    query: Record<string, string> = {}
  ): Promise<void> {
    servizio = jasmine.createSpyObj('FatturazioneService', [
      'documento',
      'annulla',
      'storno',
      'segnaEmesso',
      'scaricaXml',
      'scaricaPdf',
    ])
    servizio.documento.and.returnValue(of(doc))
    servizio.scaricaXml.and.returnValue(of(file()))
    servizio.scaricaPdf.and.returnValue(of(file()))
    await TestBed.configureTestingModule({
      imports: [DocumentoDettaglioComponent],
      providers: [
        provideNoopAnimations(),
        provideRouter([]),
        { provide: FatturazioneService, useValue: servizio },
        {
          provide: ActivatedRoute,
          useValue: {
            snapshot: {
              paramMap: convertToParamMap({ id: 'd1' }),
              queryParamMap: convertToParamMap(query),
            },
          },
        },
        { provide: AuthService, useValue: { currentUser: () => ({ role: ruolo }) } },
      ],
    }).compileComponents()
    fixture = TestBed.createComponent(DocumentoDettaglioComponent)
    comp = fixture.componentInstance
    salvati = []
    comp.salva = (_f, nome) => void salvati.push(nome)
    fixture.detectChanges()
    await fixture.whenStable()
    fixture.detectChanges()
  }

  describe('lettura', () => {
    it('mostra numero, cliente, righe e totali', async () => {
      await crea()
      expect(q('dd-numero')?.textContent).toContain('15/A')
      expect(q('dd-testata')?.textContent).toContain('Cliente 1 Srl')
      expect(q('dd-righe')?.textContent).toContain('Smaltimento 170904')
      expect(q('dd-totale')?.textContent).toContain('1.220,00')
    })

    it('risposta tardiva: la lettura nuova annulla la pendente', async () => {
      await crea()
      const lenta = new Subject<DocumentoDettaglio>()
      servizio.documento.and.returnValues(lenta, of(dettaglioDocumento({ versione: 9 })))
      comp.carica()
      comp.carica()
      expect(comp.dettaglio()?.versione).toBe(9)
      lenta.next(dettaglioDocumento({ versione: 1 }))
      expect(comp.dettaglio()?.versione).toBe(9)
    })

    it('errore di lettura: messaggio fisso e «Riprova»', async () => {
      await crea()
      servizio.documento.and.returnValue(
        throwError(() => ({ status: 500, error: { message: 'boom' } }))
      )
      comp.carica()
      fixture.detectChanges()
      expect(q('dd-errore')?.textContent).toContain(MSG_DOCUMENTO_NON_CARICATO)
      expect(q('dd-errore')?.textContent).not.toContain('boom')
      expect(q('dd-riprova')).not.toBeNull()
    })
  })

  describe('permessi', () => {
    for (const ruolo of ['VIEWER', 'OPERATOR']) {
      it(`${ruolo}: solo il PDF, nessuna azione di scrittura`, async () => {
        await crea(ruolo)
        expect(q('dd-pdf')).not.toBeNull()
        for (const id of ['dd-xml', 'dd-annulla', 'dd-storno', 'dd-emesso']) {
          expect(q(id)).withContext(id).toBeNull()
        }
        expect(q('dd-motivo-annullo')).toBeNull()
      })
    }

    it('ADMIN: tutte le azioni di un definitivo non emesso', async () => {
      await crea('ADMIN')
      for (const id of ['dd-pdf', 'dd-xml', 'dd-annulla', 'dd-storno', 'dd-emesso']) {
        expect(q(id)).withContext(id).not.toBeNull()
      }
    })

    it('documento annullato: niente XML né storno', async () => {
      await crea(
        'ADMIN',
        dettaglioDocumento({ stato: 'ANNULLATO', annullabile: false, stornabile: false })
      )
      expect(q('dd-xml')).toBeNull()
      expect(q('dd-storno')).toBeNull()
      expect(q('dd-pdf')).not.toBeNull()
    })
  })

  describe('annullo', () => {
    it('«Annulla» disattivato con il motivo (motivoNonAnnullabile)', async () => {
      await crea(
        'ADMIN',
        dettaglioDocumento({ annullabile: false, motivoNonAnnullabile: 'NON_ULTIMO' })
      )
      expect(bottone('dd-annulla')?.disabled).toBeTrue()
      expect(q('dd-motivo-annullo')?.textContent).toContain("Si annulla solo l'ultimo numero")
    })

    it('già emesso: il motivo è quello dell’emissione e non c’è «Segna come emesso»', async () => {
      await crea(
        'ADMIN',
        dettaglioDocumento({
          annullabile: false,
          motivoNonAnnullabile: 'EMESSO',
          emessoIl: '2026-11-04T10:00:00.000Z',
        })
      )
      expect(bottone('dd-annulla')?.disabled).toBeTrue()
      expect(q('dd-motivo-annullo')?.textContent).toContain('già emesso')
      expect(q('dd-emesso')).toBeNull()
    })

    it('annullabile: apre il dialog e rimanda motivo e versione letta', async () => {
      await crea()
      const nuovo = dettaglioDocumento({ stato: 'ANNULLATO', versione: 4, annullabile: false })
      servizio.annulla.and.returnValue(of(nuovo))
      comp.apriAnnulla()
      fixture.detectChanges()
      expect(q('annulla-motivo')).not.toBeNull()
      comp.annulla('Errore di importo')
      expect(servizio.annulla).toHaveBeenCalledWith('d1', 'Errore di importo', 3)
      expect(comp.dettaglio()?.stato).toBe('ANNULLATO')
      expect(comp.annullaAperta()).toBeFalse()
    })

    it('doppio clic: una sola richiesta', async () => {
      await crea()
      servizio.annulla.and.returnValue(new Subject<DocumentoDettaglio>())
      comp.annulla('Motivo')
      comp.annulla('Motivo')
      expect(servizio.annulla).toHaveBeenCalledTimes(1)
    })

    it('VERSIONE_SUPERATA: messaggio del vocabolario e rilettura', async () => {
      await crea()
      servizio.annulla.and.returnValue(
        throwError(() => ({
          status: 409,
          error: { error: 'VERSIONE_SUPERATA', message: 'v 3 vs 5' },
        }))
      )
      comp.apriAnnulla()
      comp.annulla('Motivo')
      fixture.detectChanges()
      expect(comp.erroreDialog()).toContain('modificati da un altro utente')
      expect(comp.erroreDialog()).not.toContain('v 3')
      expect(servizio.documento).toHaveBeenCalledTimes(2)
      expect(comp.inAzione()).toBeFalse()
    })

    it('ANNULLO_NON_AMMESSO: messaggio dal vocabolario, il dialog resta aperto', async () => {
      await crea()
      servizio.annulla.and.returnValue(
        throwError(() => ({ status: 409, error: { error: 'ANNULLO_NON_AMMESSO', message: 'x' } }))
      )
      comp.apriAnnulla()
      comp.annulla('Motivo')
      expect(comp.erroreDialog()).toContain('annullo non è ammesso')
      expect(comp.annullaAperta()).toBeTrue()
    })
  })

  describe('storno', () => {
    it('manda motivo, data, rifatturabile e versione letta', async () => {
      await crea()
      servizio.storno.and.returnValue(of(dettaglioDocumento({ stornabile: false, stornoId: 'n1' })))
      comp.apriStorno(false)
      comp.storna({ motivo: 'Errore', dataDocumento: '2026-11-07', rifatturabile: true })
      expect(servizio.storno).toHaveBeenCalledWith('d1', {
        motivo: 'Errore',
        dataDocumento: '2026-11-07',
        rifatturabile: true,
        versione: 3,
      })
      expect(comp.stornoAperto()).toBeFalse()
    })

    it('STORNO_GIA_PRESENTE: messaggio dal vocabolario e rilettura', async () => {
      await crea()
      servizio.storno.and.returnValue(
        throwError(() => ({ status: 409, error: { error: 'STORNO_GIA_PRESENTE', message: 'n1' } }))
      )
      comp.storna({ motivo: 'E', dataDocumento: '2026-11-07', rifatturabile: false })
      expect(comp.erroreDialog()).toContain('esiste già una nota di credito')
      expect(servizio.documento).toHaveBeenCalledTimes(2)
    })

    it('?storno=1&rifatturabile=1 apre lo storno con «rifatturabile» acceso', async () => {
      await crea('ADMIN', dettaglioDocumento(), { storno: '1', rifatturabile: '1' })
      expect(comp.stornoAperto()).toBeTrue()
      expect(comp.rifatturabileIniziale()).toBeTrue()
      fixture.detectChanges()
      expect(q('storno-motivo')).not.toBeNull()
    })

    it('?storno=1 senza rifatturabile: dialog aperto con «rifatturabile» spento', async () => {
      await crea('ADMIN', dettaglioDocumento(), { storno: '1' })
      expect(comp.stornoAperto()).toBeTrue()
      expect(comp.rifatturabileIniziale()).toBeFalse()
    })

    it('?storno=1 su un documento non stornabile: non si apre nulla', async () => {
      await crea('ADMIN', dettaglioDocumento({ stornabile: false }), {
        storno: '1',
        rifatturabile: '1',
      })
      expect(comp.stornoAperto()).toBeFalse()
    })

    it('?storno=1 per un VIEWER: non si apre nulla', async () => {
      await crea('VIEWER', dettaglioDocumento(), { storno: '1', rifatturabile: '1' })
      expect(comp.stornoAperto()).toBeFalse()
    })

    it('senza parametri il dialog non si apre da solo', async () => {
      await crea()
      expect(comp.stornoAperto()).toBeFalse()
    })

    it('il parametro apre il dialog una volta sola (rilettura dopo chiusura)', async () => {
      await crea('ADMIN', dettaglioDocumento(), { storno: '1', rifatturabile: '1' })
      comp.chiudiDialog()
      comp.carica()
      expect(comp.stornoAperto()).toBeFalse()
    })
  })

  describe('segna come emesso', () => {
    it('chiede conferma e poi rimanda la versione letta', async () => {
      await crea()
      servizio.segnaEmesso.and.returnValue(
        of(dettaglioDocumento({ emessoIl: '2026-11-07T08:00:00.000Z', versione: 4 }))
      )
      comp.apriConferma('emesso')
      fixture.detectChanges()
      expect(servizio.segnaEmesso).not.toHaveBeenCalled()
      expect(q('conferma-emissione-testo')?.textContent).toContain(
        'La fattura diventerà emessa e non si potrà più annullare.'
      )
      comp.confermaEmissione()
      expect(servizio.segnaEmesso).toHaveBeenCalledWith('d1', 3)
      expect(comp.dettaglio()?.versione).toBe(4)
      expect(comp.conferma()).toBeNull()
    })

    it('già emesso: il pulsante non c’è', async () => {
      await crea('ADMIN', dettaglioDocumento({ emessoIl: '2026-11-04T10:00:00.000Z' }))
      expect(q('dd-emesso')).toBeNull()
    })
  })

  describe('XML', () => {
    it('non ancora emesso: conferma, poi scarica con confermaEmissione e rilegge', async () => {
      await crea()
      comp.scaricaXml()
      fixture.detectChanges()
      expect(servizio.scaricaXml).not.toHaveBeenCalled()
      expect(q('conferma-emissione-testo')).not.toBeNull()
      comp.confermaEmissione()
      expect(servizio.scaricaXml).toHaveBeenCalledWith('d1', true)
      expect(salvati).toEqual(['fattura.xml'])
      expect(servizio.documento).toHaveBeenCalledTimes(2)
    })

    it('già emesso: scarica subito, senza conferma né rilettura', async () => {
      await crea('ADMIN', dettaglioDocumento({ emessoIl: '2026-11-04T10:00:00.000Z' }))
      comp.scaricaXml()
      fixture.detectChanges()
      expect(comp.conferma()).toBeNull()
      expect(q('conferma-emissione-testo')).toBeNull()
      expect(servizio.scaricaXml).toHaveBeenCalledWith('d1', false)
      expect(servizio.documento).toHaveBeenCalledTimes(1)
    })

    it('doppio clic: una sola richiesta', async () => {
      await crea('ADMIN', dettaglioDocumento({ emessoIl: '2026-11-04T10:00:00.000Z' }))
      servizio.scaricaXml.and.returnValue(new Subject<FileScaricato>())
      comp.scaricaXml()
      comp.scaricaXml()
      expect(servizio.scaricaXml).toHaveBeenCalledTimes(1)
    })

    it('422 XML_NON_VALIDO: messaggio del vocabolario, senza dati', async () => {
      await crea('ADMIN', dettaglioDocumento({ emessoIl: '2026-11-04T10:00:00.000Z' }))
      servizio.scaricaXml.and.returnValue(
        throwError(() =>
          erroreBlob(422, {
            error: 'XML_NON_VALIDO',
            message: 'Rossi Mario fattura 15/A elemento CodiceFiscale',
          })
        )
      )
      comp.scaricaXml()
      await svuotaPromesse()
      fixture.detectChanges()
      const testo = q('dd-esito')?.textContent ?? ''
      expect(testo).toContain("L'XML generato non è valido")
      expect(testo).not.toContain('Rossi')
      expect(testo).not.toContain('15/A')
    })

    it('422 senza corpo (m3): messaggio fisso', async () => {
      await crea('ADMIN', dettaglioDocumento({ emessoIl: '2026-11-04T10:00:00.000Z' }))
      servizio.scaricaXml.and.returnValue(throwError(() => erroreBlob(422, {})))
      comp.scaricaXml()
      await svuotaPromesse()
      fixture.detectChanges()
      expect(q('dd-esito')?.textContent).toContain("L'XML generato non è valido")
    })

    it('errore con la conferma aperta: il messaggio resta nel dialog', async () => {
      await crea()
      servizio.scaricaXml.and.returnValue(throwError(() => erroreBlob(500, {})))
      comp.scaricaXml()
      comp.confermaEmissione()
      await svuotaPromesse()
      expect(comp.erroreDialog()).toContain("Impossibile scaricare l'XML")
      expect(comp.conferma()).toBe('xml')
      expect(comp.inAzione()).toBeFalse()
    })
  })

  describe('PDF', () => {
    it('lo scarica anche un VIEWER', async () => {
      await crea('VIEWER')
      comp.scaricaPdf()
      expect(servizio.scaricaPdf).toHaveBeenCalledWith('d1')
      expect(salvati).toEqual(['fattura.pdf'])
    })

    it('doppio clic: una sola richiesta', async () => {
      await crea('VIEWER')
      servizio.scaricaPdf.and.returnValue(new Subject<FileScaricato>())
      comp.scaricaPdf()
      comp.scaricaPdf()
      expect(servizio.scaricaPdf).toHaveBeenCalledTimes(1)
    })

    it('errore: messaggio fisso', async () => {
      await crea('VIEWER')
      servizio.scaricaPdf.and.returnValue(throwError(() => erroreBlob(500, { message: 'stack' })))
      comp.scaricaPdf()
      await svuotaPromesse()
      fixture.detectChanges()
      expect(q('dd-esito')?.textContent).toContain(MSG_PDF_NON_SCARICATO)
    })
  })

  describe('collegamenti', () => {
    it('la nota di storno e il documento di origine hanno un link', async () => {
      await crea('ADMIN', dettaglioDocumento({ documentoOrigineId: 'o1', stornoId: 's1' }))
      expect(q('dd-origine')?.getAttribute('href')).toBe('/fatturazione/documenti/o1')
      expect(q('dd-nota-storno')?.getAttribute('href')).toBe('/fatturazione/documenti/s1')
    })
  })
})
