import {
  ComponentFixture,
  TestBed,
  fakeAsync,
  tick,
  discardPeriodicTasks,
} from '@angular/core/testing'
import { HttpErrorResponse } from '@angular/common/http'
import { provideNoopAnimations } from '@angular/platform-browser/animations'
import { of, throwError } from 'rxjs'
import { FeatureFlagsService } from '../../core/services/feature-flags.service'
import { FatturazioneService, FileScaricato } from '../fatturazione/fatturazione.service'
import {
  INTERVALLO_POLLING_CRONOLOGIA_MS,
  MSG_SDI_NON_CARICATO,
  SdiCronologiaComponent,
} from './sdi-cronologia.component'
import { NotificaSdi, StatoSdiDocumento, TrasmissioneSdi } from './sdi.model'

const q = <T extends HTMLElement = HTMLElement>(id: string): T | null =>
  document.body.querySelector<T>(`[data-testid="${id}"]`)

const notifica = (extra: Partial<NotificaSdi> = {}): NotificaSdi => ({
  id: 'n1',
  tipo: 'RC',
  esitoCommittente: null,
  codiciErrore: [],
  dataRicezioneSdi: '2026-11-19T10:00:00.000Z',
  ricevutaIl: '2026-11-19T10:00:05.000Z',
  fonte: 'WEBHOOK',
  haFile: false,
  ...extra,
})

const trasmissione = (extra: Partial<TrasmissioneSdi> = {}): TrasmissioneSdi => ({
  id: 't1',
  stato: 'CONSEGNATA',
  esitoFiscale: 'EMESSA',
  provider: 'fake',
  ambiente: 'SANDBOX',
  nomeFile: 'IT01234567890_00001.xml',
  creataIl: '2026-11-19T09:59:00.000Z',
  inviataIl: '2026-11-19T10:00:00.000Z',
  chiusaIl: null,
  tentativi: 1,
  ultimoErroreCodice: null,
  ultimoErroreMessaggio: null,
  avvisi: [],
  notifiche: [notifica()],
  ...extra,
})

const stato = (...t: TrasmissioneSdi[]): StatoSdiDocumento => ({ trasmissioni: t })

describe('SdiCronologiaComponent', () => {
  let fixture: ComponentFixture<SdiCronologiaComponent>
  let comp: SdiCronologiaComponent
  let servizio: jasmine.SpyObj<FatturazioneService>
  let moduloSdi: boolean

  async function crea(risposte: StatoSdiDocumento[], modulo = true): Promise<void> {
    moduloSdi = modulo
    servizio = jasmine.createSpyObj('FatturazioneService', ['statoSdi', 'scaricaRicevutaSdi'])
    let i = 0
    servizio.statoSdi.and.callFake(() => of(risposte[Math.min(i++, risposte.length - 1)]))
    await TestBed.configureTestingModule({
      imports: [SdiCronologiaComponent],
      providers: [
        provideNoopAnimations(),
        { provide: FatturazioneService, useValue: servizio },
        {
          provide: FeatureFlagsService,
          useValue: { has: (k: string) => moduloSdi && k === 'sdi' },
        },
      ],
    }).compileComponents()
    fixture = TestBed.createComponent(SdiCronologiaComponent)
    comp = fixture.componentInstance
    comp.documentoId = 'd1'
    comp.ngOnChanges()
    fixture.detectChanges()
  }

  it('senza il modulo sdi non mostra nulla e non chiama il backend', async () => {
    await crea([stato(trasmissione())], false)
    expect(q('sc')).toBeNull()
    expect(servizio.statoSdi).not.toHaveBeenCalled()
  })

  it('mostra badge «Consegnata», esito fiscale e la riga della notifica con fonte e data', async () => {
    await crea([stato(trasmissione())])
    expect(q('sc-stato')?.textContent).toContain('Consegnata')
    expect(q('sc-esito-fiscale')?.textContent).toContain('Fattura emessa')
    expect(q('sc-notifiche')?.textContent).toContain('Ricevuta di consegna')
    expect(q('sc-notifiche')?.textContent).toContain('Webhook')
    expect(q('sc-notifiche')?.textContent).toContain('19/11/2026')
  })

  it('NS: codici di errore con la descrizione italiana e l’avviso del duplicato', async () => {
    await crea([
      stato(
        trasmissione({
          stato: 'SCARTATA',
          esitoFiscale: 'NON_EMESSA',
          avvisi: ['PROBABILMENTE_GIA_INVIATA'],
          notifiche: [
            notifica({
              tipo: 'NS',
              codiciErrore: [{ codice: '00404', descrizione: 'Fattura duplicata' }],
            }),
          ],
        })
      ),
    ])
    expect(q('sc-stato')?.textContent).toContain('Scartata')
    expect(q('sc-notifiche')?.textContent).toContain('00404')
    expect(q('sc-notifiche')?.textContent).toContain('Fattura duplicata')
    expect(q('sc-avvisi')?.textContent).toContain('già stato inviato da un altro canale')
  })

  it('NE: mostra l’esito del committente', async () => {
    await crea([
      stato(
        trasmissione({
          stato: 'RIFIUTATA',
          esitoFiscale: 'RIFIUTATA_DAL_COMMITTENTE',
          notifiche: [notifica({ tipo: 'NE', esitoCommittente: 'EC02' })],
        })
      ),
    ])
    expect(q('sc-notifiche')?.textContent).toContain('Esito del committente')
    expect(q('sc-notifiche')?.textContent).toContain('Rifiutata')
    expect(q('sc-esito-fiscale')?.textContent).toContain('nota di credito')
  })

  it('documento mai inviato: messaggio dedicato', async () => {
    await crea([stato()])
    expect(q('sc-vuoto')).not.toBeNull()
  })

  it('il pulsante XML compare solo per le notifiche con file e scarica la ricevuta', async () => {
    await crea([stato(trasmissione({ notifiche: [notifica({ haFile: true })] }))])
    const file: FileScaricato = { blob: new Blob(['x']), nomeFile: 'r.xml', saltati: 0 }
    servizio.scaricaRicevutaSdi.and.returnValue(of(file))
    const salvati: string[] = []
    comp.salva = (_f, nome) => void salvati.push(nome)
    q('sc-ricevuta')!.querySelector('button')!.click()
    expect(servizio.scaricaRicevutaSdi).toHaveBeenCalledWith('d1', 'n1')
    expect(salvati).toEqual(['ricevuta-RC.xml'])
  })

  it('senza file della ricevuta non c’è il pulsante di download', async () => {
    await crea([stato(trasmissione())])
    expect(q('sc-ricevuta')).toBeNull()
  })

  it('errore di lettura: messaggio e nessun polling infinito', async () => {
    servizio = jasmine.createSpyObj('FatturazioneService', ['statoSdi'])
    servizio.statoSdi.and.returnValue(throwError(() => new HttpErrorResponse({ status: 500 })))
    await TestBed.configureTestingModule({
      imports: [SdiCronologiaComponent],
      providers: [
        provideNoopAnimations(),
        { provide: FatturazioneService, useValue: servizio },
        { provide: FeatureFlagsService, useValue: { has: () => true } },
      ],
    }).compileComponents()
    fixture = TestBed.createComponent(SdiCronologiaComponent)
    fixture.componentInstance.documentoId = 'd1'
    fixture.componentInstance.ngOnChanges()
    fixture.detectChanges()
    expect(q('sc-errore')?.textContent).toContain(MSG_SDI_NON_CARICATO)
  })

  it('polling: finche’ la trasmissione è INVIATA si rilegge, alla ricevuta si ferma', fakeAsync(() => {
    servizio = jasmine.createSpyObj('FatturazioneService', ['statoSdi'])
    const sequenza = [
      stato(trasmissione({ stato: 'INVIATA', esitoFiscale: 'IN_CORSO', notifiche: [] })),
      stato(trasmissione({ stato: 'INVIATA', esitoFiscale: 'IN_CORSO', notifiche: [] })),
      stato(trasmissione()),
    ]
    let i = 0
    servizio.statoSdi.and.callFake(() => of(sequenza[Math.min(i++, sequenza.length - 1)]))
    TestBed.configureTestingModule({
      imports: [SdiCronologiaComponent],
      providers: [
        provideNoopAnimations(),
        { provide: FatturazioneService, useValue: servizio },
        { provide: FeatureFlagsService, useValue: { has: () => true } },
      ],
    })
    fixture = TestBed.createComponent(SdiCronologiaComponent)
    fixture.componentInstance.documentoId = 'd1'
    fixture.componentInstance.ngOnChanges()
    fixture.detectChanges()
    expect(q('sc-in-attesa')).not.toBeNull()
    tick(INTERVALLO_POLLING_CRONOLOGIA_MS)
    tick(INTERVALLO_POLLING_CRONOLOGIA_MS)
    fixture.detectChanges()
    expect(servizio.statoSdi).toHaveBeenCalledTimes(3)
    expect(q('sc-stato')?.textContent).toContain('Consegnata')
    // Fermo: nessuna lettura ulteriore.
    tick(INTERVALLO_POLLING_CRONOLOGIA_MS * 5)
    expect(servizio.statoSdi).toHaveBeenCalledTimes(3)
    discardPeriodicTasks()
  }))
})
