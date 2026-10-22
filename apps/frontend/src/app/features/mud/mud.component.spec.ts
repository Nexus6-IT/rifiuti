import { ComponentFixture, TestBed } from '@angular/core/testing'
import { HttpErrorResponse, HttpHeaders, HttpResponse } from '@angular/common/http'
import { ActivatedRoute, convertToParamMap } from '@angular/router'
import { NoopAnimationsModule } from '@angular/platform-browser/animations'
import { of, throwError } from 'rxjs'
import { MudComponent } from './mud.component'
import {
  IntegrazioniMud,
  MudControllo,
  MudMovimentoSegnalato,
  MudRiepilogo,
  MudService,
  ObbligoMud,
  StatoPresentazioneMud,
} from './mud.service'
import { ToastService } from '../../core/services/toast.service'

const AVVISO_SCARICO: MudControllo = {
  codice: 'SCARICO_SENZA_FIR',
  gravita: 'AVVISO',
  messaggio: 'Scarico n. 5/2025 senza FIR',
  movimenti: [
    {
      numero: 5,
      anno: 2025,
      cerCode: '17 04 05',
      quantita: 1234.5,
      unita: 'kg',
      kg: 1234.5,
      incluso: false,
    },
  ],
}
const AVVISO_INFO: MudControllo = {
  codice: 'CAUSALE_ESCLUSA',
  gravita: 'AVVISO',
  messaggio: 'Causale esclusa',
}

const riepilogo = (r: Partial<MudRiepilogo> = {}): MudRiepilogo => ({
  year: 2025,
  wasteProduced: [],
  totals: { produced: 0, recovery: 0, disposal: 0, recyclingRate: 0 },
  controlli: [],
  riepilogoAvvisi: {
    kgInMeno: 0,
    kgInPiu: 0,
    movimentiNonQuantificati: 0,
    voci: [],
    testo: '',
    cambianoQuantita: false,
  },
  mudNonDovuto: false,
  ruoloEffettivo: 'ADMIN',
  ...r,
})

const conAvvisi = (r: Partial<MudRiepilogo> = {}) =>
  riepilogo({
    controlli: [AVVISO_SCARICO, AVVISO_INFO],
    riepilogoAvvisi: {
      kgInMeno: 1234.5,
      kgInPiu: 0,
      movimentiNonQuantificati: 0,
      voci: [
        { codice: 'SCARICO_SENZA_FIR', casi: 1, movimenti: 1, kgEsclusi: 1234.5, kgAggiunti: 0 },
        { codice: 'CAUSALE_ESCLUSA', casi: 1, movimenti: 0, kgEsclusi: 0, kgAggiunti: 0 },
      ],
      testo: 'Il file dichiara 1.234,5 kg in meno del registro per i motivi elencati sotto.',
      cambianoQuantita: true,
    },
    ...r,
  })

const stato = (s: Partial<StatoPresentazioneMud> = {}): StatoPresentazioneMud => ({
  year: 2025,
  status: 'DRAFT',
  submittedAt: null,
  datiModificatiDopoPresentazione: false,
  fileTracciato: null,
  esportazioni: [],
  ...s,
})

const OBBLIGO: ObbligoMud = {
  mudNonDovuto: false,
  motivo: null,
  impostatoIl: null,
  impostatoDa: null,
  puoModificare: true,
}

const INTEGRAZIONI_VUOTE: IntegrazioniMud = {
  destinatari: {},
  destinatariMovimento: {},
  trasportatori: {},
  pesiSpecifici: {},
  aggiornateIl: null,
  aggiornateDa: null,
  codiciAzienda: ['01234567897'],
}

const movimentoLitri = (quantita: number): MudMovimentoSegnalato => ({
  numero: 3,
  anno: 2025,
  cerCode: '17 04 05',
  quantita,
  unita: 'litri',
  kg: null,
  incluso: false,
})

/** Bloccanti che chiedono un'integrazione, uno per tipo. */
const BLOCCANTI_INTEGRAZIONE: MudControllo[] = [
  {
    codice: 'DESTINATARIO_SENZA_CF',
    gravita: 'BLOCCANTE',
    messaggio: 'Manca il CF di Ecologia Srl',
    integrazione: {
      tipo: 'CF_DESTINATARIO',
      chiave: 'ECOLOGIA SRL',
      ragioneSociale: 'Ecologia Srl',
    },
  },
  {
    codice: 'DESTINATARIO_NON_INDICATO',
    gravita: 'BLOCCANTE',
    messaggio: 'Movimento n. 5/2025 senza destinatario',
    integrazione: { tipo: 'DESTINATARIO_MOVIMENTO', chiave: '2025/5', numero: 5, anno: 2025 },
  },
  {
    codice: 'TRASPORTATORE_SENZA_CF',
    gravita: 'BLOCCANTE',
    messaggio: 'Manca il CF di Trasporti Srl',
    integrazione: {
      tipo: 'CF_TRASPORTATORE',
      chiave: 'TRASPORTI SRL',
      ragioneSociale: 'Trasporti Srl',
    },
  },
  {
    codice: 'UNITA_NON_DI_MASSA',
    gravita: 'BLOCCANTE',
    messaggio: 'CER 17 04 05 in litri',
    movimenti: [movimentoLitri(1000), movimentoLitri(500)],
    integrazione: {
      tipo: 'PESO_SPECIFICO',
      chiave: '170405|LITRI',
      cerCode: '170405',
      unita: 'LITRI',
    },
  },
]

/** Errore HTTP come lo restituisce HttpClient per una risposta blob. */
const erroreBlob = (status: number, body: object) =>
  new HttpErrorResponse({ status, error: new Blob([JSON.stringify(body)]) })

/** Lascia completare le letture asincrone dei corpi Blob. */
const attendi = async () => {
  for (let i = 0; i < 5; i++) await new Promise(r => setTimeout(r, 0))
}

describe('MudComponent', () => {
  let fixture: ComponentFixture<MudComponent>
  let component: MudComponent
  let mud: jasmine.SpyObj<MudService>
  let toast: jasmine.SpyObj<ToastService>
  let anno: string | null

  const testo = () => (fixture.nativeElement as HTMLElement).textContent ?? ''

  function crea() {
    TestBed.configureTestingModule({
      imports: [MudComponent, NoopAnimationsModule],
      providers: [
        { provide: MudService, useValue: mud },
        { provide: ToastService, useValue: toast },
        {
          provide: ActivatedRoute,
          useValue: { snapshot: { queryParamMap: convertToParamMap(anno ? { anno } : {}) } },
        },
      ],
    })
    fixture = TestBed.createComponent(MudComponent)
    component = fixture.componentInstance
    // il download vero non parte: niente clic sull'ancora del file
    spyOn(HTMLAnchorElement.prototype, 'click')
    fixture.detectChanges()
  }

  beforeEach(() => {
    anno = null
    mud = jasmine.createSpyObj<MudService>('MudService', [
      'getVersions',
      'getReport',
      'downloadExport',
      'getPresentazione',
      'segnaPresentato',
      'annullaPresentazione',
      'getObbligo',
      'impostaObbligo',
      'getIntegrazioni',
      'salvaIntegrazioni',
    ])
    mud.getIntegrazioni.and.returnValue(of(INTEGRAZIONI_VUOTE))
    mud.salvaIntegrazioni.and.returnValue(of(INTEGRAZIONI_VUOTE))
    mud.getVersions.and.returnValue(
      of({
        versions: [
          { year: 2025, version: '6.04/25' },
          { year: 2024, version: '6.04/24' },
        ],
      })
    )
    mud.getReport.and.returnValue(of(riepilogo()))
    mud.getPresentazione.and.returnValue(of(stato()))
    mud.getObbligo.and.returnValue(of(OBBLIGO))
    mud.downloadExport.and.returnValue(
      of(new HttpResponse({ body: new Blob(['XX;']), headers: new HttpHeaders() }))
    )
    toast = jasmine.createSpyObj<ToastService>('ToastService', ['success', 'error', 'warn', 'info'])
  })

  describe('anno dei dati', () => {
    it('etichetta e voci del selettore', () => {
      crea()
      expect(testo()).toContain('Anno dei dati')
      expect(component.years().map(y => y.label)).toEqual(['2025 (MUD 2026)', '2024 (MUD 2025)'])
    })

    it('legge ?anno= (link dei promemoria) e carica la presentazione di quell anno', () => {
      anno = '2024'
      crea()
      expect(component.selectedYear).toBe(2024)
      expect(mud.getPresentazione).toHaveBeenCalledWith(2024)
    })

    it('un ?anno= non disponibile lascia l anno di default', () => {
      anno = '1999'
      crea()
      expect(component.selectedYear).toBe(2025)
      expect(mud.getPresentazione).toHaveBeenCalledWith(2025)
    })

    it('al cambio d anno ricarica la presentazione e toglie il riepilogo dell altro anno', () => {
      crea()
      component.loadReport()
      component.selectedYear = 2024
      component.onYearChange()
      expect(mud.getPresentazione).toHaveBeenCalledWith(2024)
      expect(component.report()).toBeNull()
    })
  })

  describe('riepilogo', () => {
    it('colonna dei movimenti, controlli raggruppati e numeri in formato italiano', () => {
      mud.getReport.and.returnValue(
        of(
          conAvvisi({
            controlli: [
              { codice: 'DESTINATARIO_SENZA_CF', gravita: 'BLOCCANTE', messaggio: 'Manca il CF' },
              AVVISO_SCARICO,
              AVVISO_INFO,
            ],
          })
        )
      )
      crea()
      component.loadReport()
      fixture.detectChanges()

      const t = testo()
      expect(t).toContain('N. movimenti')
      expect(t).not.toContain('N. FIR')
      expect(t).toContain('Da correggere')
      expect(t).toContain('Manca il CF')
      expect(t).toContain(
        'Il file dichiara 1.234,5 kg in meno del registro per i motivi elencati sotto.'
      )
      expect(t).toContain('1 casi · 1.234,5 kg esclusi')
      expect(t).toContain('1 casi · informativo')
      expect(t).toContain('n. 5/2025 · CER 17 04 05 · 1.234,5 kg · escluso')
      expect(t).toContain(
        "I rifiuti prodotti fuori dall'unità locale (cantieri, manutenzioni: modulo RE) non sono distinti: il file li attribuisce all'unità locale."
      )
    })

    it('azienda non tenuta al MUD', () => {
      mud.getReport.and.returnValue(of(riepilogo({ mudNonDovuto: true })))
      crea()
      component.loadReport()
      fixture.detectChanges()
      expect(testo()).toContain('Azienda segnata come non tenuta al MUD')
    })
  })

  describe('download con avvisi', () => {
    it('chi non è amministratore non vede il download se gli avvisi cambiano le quantità', () => {
      mud.getReport.and.returnValue(of(conAvvisi({ ruoloEffettivo: 'VIEWER' })))
      crea()
      component.loadReport()
      fixture.detectChanges()

      expect(testo()).toContain(
        'Il file ha avvisi da confermare: chiedi a un amministratore di generarlo.'
      )
      expect(fixture.nativeElement.querySelector('[data-testid="mud-download"]')).toBeNull()
    })

    it('chi non è amministratore vede il download se gli avvisi sono solo informativi', () => {
      const r = conAvvisi({ ruoloEffettivo: 'VIEWER' })
      r.riepilogoAvvisi.cambianoQuantita = false
      mud.getReport.and.returnValue(of(r))
      crea()
      component.loadReport()
      fixture.detectChanges()

      expect(fixture.nativeElement.querySelector('[data-testid="mud-download"]')).not.toBeNull()
    })

    it('senza riepilogo lo carica prima, e se il file è riservato agli amministratori si ferma', () => {
      mud.getReport.and.returnValue(of(conAvvisi({ ruoloEffettivo: 'VIEWER' })))
      crea()
      component.download()

      expect(mud.getReport).toHaveBeenCalledWith(2025)
      expect(component.dialogo()).toBeNull()
      expect(mud.downloadExport).not.toHaveBeenCalled()
    })

    it('apre la conferma e scarica con i codici degli avvisi solo dopo la casella', () => {
      mud.getReport.and.returnValue(of(conAvvisi()))
      crea()
      component.loadReport()
      component.download()
      fixture.detectChanges()

      expect(component.dialogo()).toBe('download')
      expect(testo()).toContain('Conferma degli avvisi')
      expect(testo()).toContain(
        'Confermo di generare il file con 1.234,5 kg in meno rispetto al registro.'
      )
      expect(mud.downloadExport).not.toHaveBeenCalled()
      expect(component.puoConfermare()).toBeFalse()

      component.confermaSpuntata = true
      expect(component.puoConfermare()).toBeTrue()
      component.conferma()

      expect(mud.downloadExport).toHaveBeenCalledWith(2025, [
        'CAUSALE_ESCLUSA',
        'SCARICO_SENZA_FIR',
      ])
    })

    it('senza avvisi e senza presentazione scarica subito', () => {
      crea()
      component.download()
      expect(component.dialogo()).toBeNull()
      expect(mud.downloadExport).toHaveBeenCalledWith(2025, [])
    })

    it('con il MUD presentato la conferma dice che il file sostituisce la dichiarazione', () => {
      mud.getPresentazione.and.returnValue(
        of(stato({ status: 'SUBMITTED', submittedAt: '2026-06-30T10:00:00.000Z' }))
      )
      crea()
      component.download()
      fixture.detectChanges()

      expect(component.dialogo()).toBe('download')
      expect(testo()).toContain('Il file sostituisce la dichiarazione presentata il 30/06/2026.')
      expect(component.puoConfermare()).toBeTrue()
    })

    it('422 avvisi cambiati: toast e riepilogo ricaricato', async () => {
      mud.downloadExport.and.returnValue(
        throwError(() =>
          erroreBlob(422, { message: 'x', error: 'MUD_AVVISI_DA_CONFERMARE', details: {} })
        )
      )
      crea()
      component.download()
      await attendi()

      expect(toast.warn).toHaveBeenCalledWith(
        'Gli avvisi sono cambiati: rileggili e conferma di nuovo.'
      )
      expect(mud.getReport).toHaveBeenCalledTimes(2)
    })

    it('422 non generabile: toast e riepilogo ricaricato', async () => {
      mud.downloadExport.and.returnValue(
        throwError(() => erroreBlob(422, { message: 'x', error: 'MUD_NON_GENERABILE' }))
      )
      crea()
      component.download()
      await attendi()

      expect(toast.error).toHaveBeenCalledWith(
        'Il file MUD non può essere generato: correggi gli errori elencati nel riepilogo.'
      )
      expect(mud.getReport).toHaveBeenCalledTimes(2)
    })

    it('403 riservata agli amministratori: toast con il messaggio della risposta', async () => {
      mud.downloadExport.and.returnValue(
        throwError(() =>
          erroreBlob(403, {
            message:
              'Il file MUD ha avvisi da confermare: chiedi a un amministratore di generarlo.',
            error: 'MUD_CONFERMA_RISERVATA_AMMINISTRATORI',
          })
        )
      )
      crea()
      component.download()
      await attendi()

      expect(toast.error).toHaveBeenCalledWith(
        'Il file MUD ha avvisi da confermare: chiedi a un amministratore di generarlo.'
      )
    })
  })

  describe('presentazione', () => {
    const esportazioni = [
      {
        generatoIl: '2026-04-01T08:00:00.000Z',
        versione: '6.04/25',
        avvisiConfermati: [],
        kgInMeno: 0,
        kgInPiu: 0,
      },
      {
        generatoIl: '2026-04-02T08:00:00.000Z',
        versione: '6.04/25',
        avvisiConfermati: ['SCARICO_SENZA_FIR'],
        kgInMeno: 350,
        kgInPiu: 0,
      },
    ]

    it('tag della presentazione, dei dati modificati e del file non tracciato', () => {
      mud.getPresentazione.and.returnValue(
        of(
          stato({
            status: 'SUBMITTED',
            submittedAt: '2026-06-30T10:00:00.000Z',
            datiModificatiDopoPresentazione: true,
            fileTracciato: false,
          })
        )
      )
      crea()
      fixture.detectChanges()

      const t = testo()
      expect(t).toContain('Presentato il 30/06/2026')
      expect(t).toContain(
        'Dati modificati dopo la presentazione: se serve, genera la dichiarazione sostitutiva.'
      )
      expect(t).toContain(
        "Presentazione dichiarata dall'utente: il file non è stato generato da questa versione dell'applicazione."
      )
    })

    it('segna come presentato legandolo all ultima esportazione, con la conferma del file', () => {
      mud.getPresentazione.and.returnValue(of(stato({ esportazioni })))
      mud.segnaPresentato.and.returnValue(of(stato({ status: 'SUBMITTED' })))
      crea()
      component.apriSegnatura()
      fixture.detectChanges()

      expect(component.esportazioneScelta).toBe('2026-04-02T08:00:00.000Z')
      expect(testo()).toContain(
        'Confermo di segnare il MUD come presentato con 350 kg in meno rispetto al registro.'
      )
      expect(component.puoConfermare()).toBeFalse()
      component.confermaSpuntata = true
      component.dataPresentazione = '2026-06-30'
      component.conferma()

      expect(mud.segnaPresentato).toHaveBeenCalledWith(
        2025,
        '2026-06-30',
        '2026-04-02T08:00:00.000Z'
      )
      expect(toast.success).toHaveBeenCalledWith(
        'MUD segnato come presentato: i promemoria si fermano.'
      )
      expect(component.presentazione()?.status).toBe('SUBMITTED')
    })

    it('senza esportazioni dichiara il file non tracciato e non chiede conferme', () => {
      mud.segnaPresentato.and.returnValue(of(stato({ status: 'SUBMITTED' })))
      crea()
      component.apriSegnatura()
      fixture.detectChanges()

      expect(testo()).toContain(
        "Presentazione dichiarata dall'utente: il file non è stato generato da questa versione dell'applicazione."
      )
      expect(component.puoConfermare()).toBeTrue()
      component.dataPresentazione = '2026-06-30'
      component.conferma()
      expect(mud.segnaPresentato).toHaveBeenCalledWith(2025, '2026-06-30', undefined)
    })

    it('403 sulla segnatura', () => {
      mud.segnaPresentato.and.returnValue(
        throwError(() => new HttpErrorResponse({ status: 403, error: { error: 'X' } }))
      )
      crea()
      component.apriSegnatura()
      component.conferma()
      expect(toast.error).toHaveBeenCalledWith(
        'Solo un amministratore può segnare la presentazione.'
      )
    })

    it('409 già presentato: toast con il messaggio della risposta', async () => {
      mud.segnaPresentato.and.returnValue(
        throwError(
          () =>
            new HttpErrorResponse({
              status: 409,
              error: { message: 'Il MUD risulta già presentato.', error: 'MUD_GIA_PRESENTATO' },
            })
        )
      )
      crea()
      component.apriSegnatura()
      component.conferma()
      await attendi()
      expect(toast.error).toHaveBeenCalledWith('Il MUD risulta già presentato.')
    })

    it('annulla la presentazione con il motivo scelto', () => {
      mud.getPresentazione.and.returnValue(
        of(stato({ status: 'SUBMITTED', submittedAt: '2026-06-30T10:00:00.000Z' }))
      )
      mud.annullaPresentazione.and.returnValue(of(stato()))
      crea()
      component.apriAnnullamento()
      expect(component.puoConfermare()).toBeFalse()
      component.motivoAnnullamento = 'DICHIARAZIONE_DA_SOSTITUIRE'
      component.conferma()

      expect(mud.annullaPresentazione).toHaveBeenCalledWith(2025, 'DICHIARAZIONE_DA_SOSTITUIRE')
      expect(toast.success).toHaveBeenCalledWith(
        'Presentazione annullata: la segnatura precedente resta nello storico.'
      )
    })

    it('i pulsanti della presentazione li vede solo un amministratore effettivo', () => {
      mud.getReport.and.returnValue(of(riepilogo({ ruoloEffettivo: 'VIEWER' })))
      mud.getObbligo.and.returnValue(of({ ...OBBLIGO, puoModificare: false }))
      crea()
      component.loadReport()
      fixture.detectChanges()
      expect(testo()).not.toContain('Segna come presentato')
    })
  })

  describe('obbligo del MUD', () => {
    it('l amministratore segna l azienda come non tenuta, con il motivo', () => {
      mud.impostaObbligo.and.returnValue(of({ ...OBBLIGO, mudNonDovuto: true }))
      crea()
      fixture.detectChanges()
      expect(testo()).toContain('Questa azienda non è tenuta a presentare il MUD')

      component.obbligoNonDovuto = true
      expect(component.obbligoValido()).toBeFalse()
      component.obbligoMotivo = 'Meno di 10 dipendenti'
      component.salvaObbligo()

      expect(mud.impostaObbligo).toHaveBeenCalledWith(true, 'Meno di 10 dipendenti')
      expect(toast.success).toHaveBeenCalledWith(
        'Impostazione salvata: promemoria e scadenze del MUD sono disattivati.'
      )
    })

    it('chi non può modificarlo non vede l interruttore', () => {
      mud.getObbligo.and.returnValue(of({ ...OBBLIGO, puoModificare: false }))
      crea()
      fixture.detectChanges()
      expect(testo()).not.toContain('Questa azienda non è tenuta a presentare il MUD')
    })

    it('riattivare l obbligo non chiede il motivo', () => {
      mud.getObbligo.and.returnValue(of({ ...OBBLIGO, mudNonDovuto: true, motivo: 'm' }))
      mud.impostaObbligo.and.returnValue(of(OBBLIGO))
      crea()
      component.loadReport()
      component.obbligoNonDovuto = false
      component.salvaObbligo()

      expect(mud.impostaObbligo).toHaveBeenCalledWith(false, null)
      expect(toast.success).toHaveBeenCalledWith(
        'Impostazione salvata: promemoria e scadenze del MUD sono di nuovo attivi.'
      )
      expect(mud.getReport).toHaveBeenCalledTimes(2)
    })
  })

  describe('integrazioni', () => {
    const elemento = (sel: string) =>
      (fixture.nativeElement as HTMLElement).querySelector(sel) as HTMLElement | null

    function conBloccanti(ruoloEffettivo = 'ADMIN') {
      mud.getReport.and.returnValue(
        of(riepilogo({ controlli: BLOCCANTI_INTEGRAZIONE, ruoloEffettivo }))
      )
      crea()
      component.loadReport()
      fixture.detectChanges()
    }

    it('sezione con id mud-integrazioni: una riga per ogni bloccante, testo fisso', () => {
      conBloccanti()
      expect(mud.getIntegrazioni).toHaveBeenCalledWith(2025)
      const sezione = elemento('#mud-integrazioni')
      expect(sezione).not.toBeNull()
      const t = sezione!.textContent ?? ''
      expect(t).toContain('Integrazioni 2025')
      expect(t).toContain(
        "Questi dati completano il MUD dell'anno senza modificare il registro, che resta com'è."
      )
      expect(t).toContain('Ecologia Srl')
      expect(t).toContain('Movimento n. 5/2025')
      expect(t).toContain('Destinatario')
      expect(t).toContain('Trasporti Srl (trasportatore)')
      expect(t).toContain('CER 170405 – LITRI')
      expect(t).toContain('kg per LITRI')
      expect(t).toContain('Intervallo consueto: 0,1–3 kg per LITRI')
      expect(t).toContain('Salva integrazioni')
    })

    it('niente sezione senza bloccanti né voci salvate', () => {
      crea()
      component.loadReport()
      fixture.detectChanges()
      expect(elemento('#mud-integrazioni')).toBeNull()
    })

    it('peso specifico: totale convertito in tempo reale e conferma fuori intervallo', () => {
      conBloccanti()
      const peso = component.righe.find(r => r.tipo === 'PESO_SPECIFICO')!
      peso.kgPerUnita = 1.1
      fixture.detectChanges()
      expect(testo()).toContain('1.500 LITRI → 1.650 kg')
      expect(testo()).not.toContain(
        "Confermo questo peso specifico, anche se è fuori dall'intervallo consueto"
      )

      peso.kgPerUnita = 1100 // kg/m³ scritto in una riga in litri
      fixture.detectChanges()
      expect(testo()).toContain(
        "Confermo questo peso specifico, anche se è fuori dall'intervallo consueto"
      )
    })

    it('CF della propria azienda: compare la conferma; destinatario estero: la nazione', () => {
      conBloccanti()
      const destinatario = component.righe.find(r => r.tipo === 'CF_DESTINATARIO')!
      destinatario.codiceFiscale = 'IT01234567897'
      fixture.detectChanges()
      expect(testo()).toContain('Confermo: il destinatario è un impianto della nostra azienda')

      destinatario.estero = true
      fixture.detectChanges()
      expect(testo()).toContain('Nazione')
      expect(testo()).not.toContain('Confermo: il destinatario è un impianto della nostra azienda')
    })

    it('il trasportatore con il codice dell azienda non chiede conferma', () => {
      conBloccanti()
      component.righe.find(r => r.tipo === 'CF_TRASPORTATORE')!.codiceFiscale = '01234567897'
      fixture.detectChanges()
      expect(testo()).not.toContain('Confermo: il destinatario è un impianto della nostra azienda')
    })

    it('salva tutte le voci con la chiave del backend, poi ricarica il riepilogo', () => {
      conBloccanti()
      const [destinatario, movimento, trasportatore, peso] = component.righe
      destinatario.codiceFiscale = '12345678903'
      movimento.ragioneSociale = 'Ecologia Srl'
      movimento.codiceFiscale = '12345678903'
      trasportatore.codiceFiscale = '12345678903'
      peso.kgPerUnita = 1.1

      component.salvaIntegrazioni()

      expect(mud.salvaIntegrazioni).toHaveBeenCalledWith(2025, {
        destinatari: [{ ragioneSociale: 'Ecologia Srl', codiceFiscale: '12345678903' }],
        destinatariMovimento: [
          { anno: 2025, numero: 5, ragioneSociale: 'Ecologia Srl', codiceFiscale: '12345678903' },
        ],
        trasportatori: [{ ragioneSociale: 'Trasporti Srl', codiceFiscale: '12345678903' }],
        pesiSpecifici: [{ cerCode: '170405', unita: 'LITRI', kgPerUnita: 1.1 }],
      })
      expect(toast.success).toHaveBeenCalledWith(
        'Integrazioni salvate: il riepilogo è stato ricalcolato.'
      )
      expect(mud.getReport).toHaveBeenCalledTimes(2)
    })

    it('errore del salvataggio: toast con il messaggio della risposta', async () => {
      mud.salvaIntegrazioni.and.returnValue(
        throwError(
          () =>
            new HttpErrorResponse({
              status: 400,
              error: { message: 'Codice fiscale o partita IVA "1" di "X" non valido' },
            })
        )
      )
      conBloccanti()
      component.salvaIntegrazioni()
      await attendi()
      expect(toast.error).toHaveBeenCalledWith('Codice fiscale o partita IVA "1" di "X" non valido')
    })

    it('chi non è amministratore effettivo vede le righe ma non il pulsante', () => {
      conBloccanti('OPERATOR')
      expect(elemento('#mud-integrazioni')).not.toBeNull()
      expect(testo()).not.toContain('Salva integrazioni')
    })

    it('al cambio d anno le righe dell anno precedente spariscono', () => {
      conBloccanti()
      component.selectedYear = 2024
      component.onYearChange()
      expect(component.righe).toEqual([])
    })
  })
})
