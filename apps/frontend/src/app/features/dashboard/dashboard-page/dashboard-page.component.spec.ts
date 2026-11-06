import { ComponentFixture, TestBed } from '@angular/core/testing'
import { provideHttpClient } from '@angular/common/http'
import { provideHttpClientTesting } from '@angular/common/http/testing'
import { provideRouter } from '@angular/router'
import { MessageService } from 'primeng/api'
import { NEVER, of, throwError } from 'rxjs'
import { AuthService } from '../../../core/services/auth.service'
import { DashboardData, DashboardService } from '../../../core/services/dashboard.service'
import { FeatureFlagsService } from '../../../core/services/feature-flags.service'
import { FIR, FIRStato } from '../../../shared/models/fir.model'
import { FirService } from '../../fir/fir.service'
import { GiacenzeService } from '../../giacenze/giacenze.service'
import { AndamentoMensileVoce, AndamentoService } from '../andamento.service'
import { AttenzioneService, VoceAttenzione } from '../attenzione.service'
import { DashboardPageComponent } from './dashboard-page.component'
import {
  LOCALE_IT,
  dashboardFixture,
  dashboardSenzaFir,
  depositoFixture,
  registroFixture,
} from './dashboard-fixture'

const MESI_NOMI = [
  'gennaio',
  'febbraio',
  'marzo',
  'aprile',
  'maggio',
  'giugno',
  'luglio',
  'agosto',
  'settembre',
  'ottobre',
  'novembre',
  'dicembre',
]

function mesiSerie(): AndamentoMensileVoce[] {
  const valori = [134, 131, 122, 128, 141, 137, 149, 152, 160, 88, 32, 41]
  const oggi = new Date()
  return valori.map((conteggio, i) => {
    const d = new Date(Date.UTC(oggi.getUTCFullYear(), oggi.getUTCMonth() - (11 - i), 1))
    return {
      mese: `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`,
      conteggio,
    }
  })
}

function firRecente(n: number): FIR {
  return {
    id: `f${n}`,
    numeroProgressivo: `DLVQ 00125${n} XC`,
    anno: 2026,
    stato: FIRStato.EMESSO,
    produttoreId: 'p',
    trasportatoreId: 't',
    destinatarioId: 'd',
    produttore: { ragioneSociale: 'Acciaierie Valdelsa', partitaIva: '01234567890' },
    rifiuto: { cerCode: '12 01 01', quantita: 8600, unitaMisura: 'kg' },
    createdAt: new Date().toISOString(),
  }
}

describe('DashboardPageComponent', () => {
  let fixture: ComponentFixture<DashboardPageComponent>
  let dashboardService: jasmine.SpyObj<DashboardService>
  let attenzioneService: jasmine.SpyObj<AttenzioneService>
  let andamentoService: jasmine.SpyObj<AndamentoService>
  let giacenzeService: jasmine.SpyObj<GiacenzeService>
  let firService: jasmine.SpyObj<FirService>

  interface Opzioni {
    ruolo?: string
    feature?: string[]
    dati?: DashboardData
    voci?: VoceAttenzione[]
    deposito?: ReturnType<typeof depositoFixture>
    erroreAndamento?: boolean
  }

  function setup(o: Opzioni = {}): HTMLElement {
    dashboardService = jasmine.createSpyObj('DashboardService', ['getDashboard', 'downloadExport'])
    dashboardService.getDashboard.and.returnValue(of(o.dati ?? dashboardFixture()))
    attenzioneService = jasmine.createSpyObj('AttenzioneService', ['getAttenzione'])
    attenzioneService.getAttenzione.and.returnValue(of({ voci: o.voci ?? [] }))
    andamentoService = jasmine.createSpyObj('AndamentoService', ['getAndamento'])
    andamentoService.getAndamento.and.returnValue(
      o.erroreAndamento ? throwError(() => new Error('boom')) : of({ mesi: mesiSerie() })
    )
    giacenzeService = jasmine.createSpyObj('GiacenzeService', ['getDepositoTemporaneo'])
    giacenzeService.getDepositoTemporaneo.and.returnValue(of(o.deposito ?? depositoFixture()))
    firService = jasmine.createSpyObj('FirService', ['getFIRList'])
    firService.getFIRList.and.returnValue(
      of({ items: [1, 2, 3, 4, 5].map(firRecente), total: 5, page: 1, limit: 5, totalPages: 1 })
    )

    TestBed.configureTestingModule({
      imports: [DashboardPageComponent],
      providers: [
        LOCALE_IT,
        provideRouter([]),
        provideHttpClient(),
        provideHttpClientTesting(),
        MessageService,
        { provide: DashboardService, useValue: dashboardService },
        { provide: AttenzioneService, useValue: attenzioneService },
        { provide: AndamentoService, useValue: andamentoService },
        { provide: GiacenzeService, useValue: giacenzeService },
        { provide: FirService, useValue: firService },
        {
          provide: AuthService,
          useValue: {
            currentUser: () => ({ id: 'u1', email: 'u@x.it', role: o.ruolo ?? 'ADMIN' }),
          },
        },
      ],
    })
    TestBed.inject(FeatureFlagsService).features.set(o.feature ?? ['fir', 'giacenze'])
    fixture = TestBed.createComponent(DashboardPageComponent)
    // Il primo giro lancia gli effect delle feature, il secondo disegna i dati arrivati.
    fixture.detectChanges()
    fixture.detectChanges()
    return fixture.nativeElement as HTMLElement
  }

  it('ha un solo h1 «Panoramica» e la data con la risposta del giorno', () => {
    const el = setup({
      voci: [
        { chiave: 'a', gravita: 'critico', titolo: 'Uno', dettaglio: '' },
        { chiave: 'b', gravita: 'avviso', titolo: 'Due', dettaglio: '' },
      ],
    })
    const h1 = el.querySelectorAll('h1')
    expect(h1.length).toBe(1)
    expect(h1[0].textContent?.trim()).toBe('Panoramica')
    const sotto =
      el
        .querySelector('[data-testid="panoramica-sottotitolo"]')
        ?.textContent?.replace(/\s+/g, ' ') ?? ''
    expect(sotto).toContain('2 cose da fare oggi, 1 urgente')
    expect(sotto).toContain(String(new Date().getFullYear()))
    expect(sotto).toContain(MESI_NOMI[new Date().getMonth()])
  })

  it('gli avvisi del deposito entrano in «Da fare oggi» e nel conteggio', () => {
    const el = setup({
      deposito: depositoFixture([
        registroFixture({
          avvisi: [
            {
              tipo: 'DURATA',
              livello: 'SUPERATO',
              cerCode: '08 01 11*',
              valore: 95,
              soglia: 92,
              unita: 'giorni',
              giornoPiuVecchio: '2026-08-01',
              scadenza: '2026-11-01',
              messaggio: 'Il 08 01 11* è in deposito da 95 giorni',
            },
          ],
        }),
      ]),
    })
    expect(
      el.querySelector('[data-testid="attenzione-voce-deposito-durata"]')?.textContent
    ).toContain('in deposito da 95 giorni')
    expect(el.querySelector('[data-testid="panoramica-sottotitolo"]')?.textContent).toContain(
      '1 cosa da fare oggi, 1 urgente'
    )
  })

  it("«Nuovo FIR» c'è per ADMIN con la feature fir, è l'unico .wf-primario e porta a /fir?nuovo=1", () => {
    const el = setup()
    const nuovo = el.querySelector('[data-testid="panoramica-nuovo-fir"]') as HTMLAnchorElement
    expect(nuovo).toBeTruthy()
    expect(nuovo.textContent).toContain('Nuovo FIR')
    expect(nuovo.getAttribute('href')).toBe('/fir?nuovo=1')
    expect(el.querySelectorAll('.wf-primario').length).toBe(1)
    expect(nuovo.classList).toContain('wf-primario')
  })

  it('«Nuovo FIR» manca per un VIEWER e senza la feature fir', () => {
    expect(
      setup({ ruolo: 'VIEWER' }).querySelector('[data-testid="panoramica-nuovo-fir"]')
    ).toBeNull()
    TestBed.resetTestingModule()
    const el = setup({ feature: ['giacenze'] })
    expect(el.querySelector('[data-testid="panoramica-nuovo-fir"]')).toBeNull()
    expect(el.querySelectorAll('.wf-primario').length).toBe(0)
  })

  it("«Esporta CSV» chiama l'export", () => {
    const el = setup()
    ;(el.querySelector('.esporta button') as HTMLButtonElement).click()
    expect(dashboardService.downloadExport).toHaveBeenCalledWith('csv')
  })

  it("getDashboard è chiamato una volta, con l'intervallo del mese corrente", () => {
    setup()
    expect(dashboardService.getDashboard).toHaveBeenCalledTimes(1)
    const { startDate, endDate } = dashboardService.getDashboard.calls.mostRecent().args[0]!
    const oggi = new Date()
    expect(startDate.getTime()).toBe(new Date(oggi.getFullYear(), oggi.getMonth(), 1).getTime())
    expect(Math.abs(endDate.getTime() - oggi.getTime())).toBeLessThan(60_000)
  })

  it('«FIR di <mese>» conta gli stati come la lista FIR e il totale è la somma delle celle', () => {
    const el = setup()
    const titolo = el
      .querySelector('app-fir-mese-stati h2')
      ?.textContent?.replace(/\s+/g, ' ')
      .trim()
    // 3+1 bozze, 6 emessi, 9 in transito, 20+1 consegnati, 1 annullato
    expect(titolo).toBe(`FIR di ${MESI_NOMI[new Date().getMonth()]} · 41`)
    const cifre = Array.from(el.querySelectorAll('app-fir-mese-stati .cella__v')).map(c =>
      c.textContent?.trim()
    )
    expect(cifre).toEqual(['4', '6', '9', '21', '1'])
  })

  it("la sezione «Analisi dell'azienda» ha la striscia e i quattro riquadri", () => {
    const el = setup()
    const sezione = el.querySelector('[data-testid="analisi-azienda"]') as HTMLElement
    expect(sezione.querySelector('h2')?.textContent?.trim()).toBe("Analisi dell'azienda")
    expect(sezione.textContent).toContain("Tutti i formulari dell'azienda")
    expect(sezione.querySelector('app-analisi-sintesi')).toBeTruthy()
    const titoli = Array.from(sezione.querySelectorAll('h3')).map(h => h.textContent?.trim())
    expect(titoli).toEqual([
      'Destinazione',
      'Top 10 codici CER',
      'Produttori più frequenti',
      'Trasportatori più frequenti',
    ])
    expect(sezione.querySelectorAll('[data-testid^="analisi-"]').length).toBeGreaterThanOrEqual(5)
  })

  it('niente chiavi inglesi, «0.0», «0h» né canvas nel DOM (bug 1, 4, 6)', () => {
    const el = setup()
    const testo = el.textContent ?? ''
    for (const proibito of [
      'COMPLETED',
      'DRAFT',
      'AWAITING_',
      'EXCELLENT',
      'CRITICAL',
      '0.0',
      '0h',
    ]) {
      expect(testo).not.toContain(proibito)
    }
    expect(el.querySelector('canvas')).toBeNull()
  })

  it('con 0 FIR nessun «20%» né «Critica» (bug 5) e tutte le celle in «—»', () => {
    const el = setup({ dati: dashboardSenzaFir() })
    const testo = el.textContent ?? ''
    expect(testo).not.toContain('20%')
    expect(testo).not.toContain('Critica')
    const valori = Array.from(el.querySelectorAll('app-analisi-sintesi .cella__v')).map(v =>
      v.textContent?.trim()
    )
    expect(valori.slice(0, 3)).toEqual(['—', '—', '—'])
  })

  it("Andamento «questo mese» è il valore dell'ultima barra (M8), non trends.monthOverMonth", () => {
    const el = setup({
      dati: dashboardFixture({
        trends: {
          monthOverMonth: { current: 999, previous: 1, percentage: 9 },
          prediction: { nextMonth: null },
        },
      }),
    })
    const ultima = Array.from(el.querySelectorAll('app-barre-mensili rect')).pop() as SVGRectElement
    expect(ultima.classList).toContain('barra--corrente')
    const ultimaColonna = Array.from(el.querySelectorAll('app-barre-mensili .colonna__v'))
      .pop()
      ?.textContent?.trim()
    const andamento = el.querySelector('[data-testid="analisi-andamento"]')?.textContent ?? ''
    expect(andamento).toContain(`${ultimaColonna} questo mese`)
    expect(andamento).not.toContain('999')
    expect(andamento).toContain('previsione —')
  })

  it('i nomi delle ditte vengono dal backend, la P. IVA sotto', () => {
    const el = setup()
    const classifica = el.querySelector('app-classifica-ditte') as HTMLElement
    expect(classifica.textContent).toContain('Acciaierie Valdelsa S.p.A.')
    expect(classifica.textContent).toContain('01234567890')
  })

  it('un errore di getAndamento spegne solo il blocco dei mesi', () => {
    const el = setup({ erroreAndamento: true })
    expect(el.querySelector('[data-testid="andamento-errore"]')).toBeTruthy()
    expect(el.querySelector('app-fir-mese-stati .cella__v')).toBeTruthy()
    expect(el.querySelector('app-fir-recenti li')).toBeTruthy()
    expect(el.querySelector('app-deposito-sintesi [role="progressbar"]')).toBeTruthy()
    expect(el.querySelector('app-analisi-sintesi .cella__v')).toBeTruthy()
    expect(el.querySelector('[data-testid="analisi-errore"]')).toBeNull()
  })

  it('un errore di getAttenzione mostra «verifica fallita» e non dichiara nessuna scadenza', () => {
    setup()
    attenzioneService.getAttenzione.and.returnValue(throwError(() => new Error('boom')))
    fixture.componentInstance['caricaAttenzione']()
    fixture.detectChanges()
    const el = fixture.nativeElement as HTMLElement
    expect(el.querySelector('[data-testid="attenzione-voce-verifica-fallita"]')).toBeTruthy()
    expect(el.querySelector('[data-testid="panoramica-sottotitolo"]')?.textContent).not.toContain(
      'Nessuna scadenza'
    )
  })

  it("un errore di getDashboard lascia il resto e chiede di riprovare solo l'analisi", () => {
    setup()
    dashboardService.getDashboard.and.returnValue(throwError(() => new Error('boom')))
    fixture.componentInstance['caricaDashboard']()
    fixture.detectChanges()
    const el = fixture.nativeElement as HTMLElement
    expect(el.querySelector('[data-testid="analisi-errore"]')).toBeTruthy()
    expect(el.querySelector('app-fir-recenti li')).toBeTruthy()
    expect(el.querySelector('app-barre-mensili rect')).toBeTruthy()
  })

  it("gli stati vuoti sono righe di testo, mai .empty-state con l'icona grande (bug 8)", () => {
    const el = setup({
      dati: dashboardSenzaFir(),
      deposito: depositoFixture([]),
      voci: [],
    })
    firService.getFIRList.and.returnValue(
      of({ items: [], total: 0, page: 1, limit: 5, totalPages: 0 })
    )
    const blocchi = Array.from(el.querySelectorAll<HTMLElement>('.griglia, .analisi'))
    for (const blocco of blocchi) expect(blocco.querySelector('.empty-state, .pi')).toBeNull()
    for (const card of Array.from(el.querySelectorAll<HTMLElement>('.card'))) {
      expect(card.querySelector('h2, h3')).toBeTruthy()
    }
  })

  it('durante il caricamento ogni blocco ha titolo e cornice e nessun «0» provvisorio', () => {
    dashboardService = jasmine.createSpyObj('DashboardService', ['getDashboard', 'downloadExport'])
    dashboardService.getDashboard.and.returnValue(NEVER)
    attenzioneService = jasmine.createSpyObj('AttenzioneService', ['getAttenzione'])
    attenzioneService.getAttenzione.and.returnValue(NEVER)
    andamentoService = jasmine.createSpyObj('AndamentoService', ['getAndamento'])
    andamentoService.getAndamento.and.returnValue(NEVER)
    giacenzeService = jasmine.createSpyObj('GiacenzeService', ['getDepositoTemporaneo'])
    giacenzeService.getDepositoTemporaneo.and.returnValue(NEVER)
    firService = jasmine.createSpyObj('FirService', ['getFIRList'])
    firService.getFIRList.and.returnValue(NEVER)
    TestBed.configureTestingModule({
      imports: [DashboardPageComponent],
      providers: [
        LOCALE_IT,
        provideRouter([]),
        provideHttpClient(),
        provideHttpClientTesting(),
        MessageService,
        { provide: DashboardService, useValue: dashboardService },
        { provide: AttenzioneService, useValue: attenzioneService },
        { provide: AndamentoService, useValue: andamentoService },
        { provide: GiacenzeService, useValue: giacenzeService },
        { provide: FirService, useValue: firService },
        { provide: AuthService, useValue: { currentUser: () => ({ role: 'ADMIN' }) } },
      ],
    })
    TestBed.inject(FeatureFlagsService).features.set(['fir', 'giacenze'])
    fixture = TestBed.createComponent(DashboardPageComponent)
    fixture.detectChanges()
    const el = fixture.nativeElement as HTMLElement

    const titoli = Array.from(el.querySelectorAll('h2, h3')).map(h =>
      h.textContent?.replace(/\s+/g, ' ').trim()
    )
    for (const atteso of [
      'Da fare oggi',
      'Deposito temporaneo',
      'FIR recenti',
      'Formulari per mese',
      "Analisi dell'azienda",
      'Destinazione',
      'Top 10 codici CER',
    ]) {
      expect(titoli).toContain(atteso)
    }
    expect(titoli.some(t => t?.startsWith('FIR di '))).toBeTrue()
    const corpo = Array.from(el.querySelectorAll('.griglia, .analisi'))
      .map(n => n.textContent)
      .join(' ')
    expect(corpo).not.toMatch(/\b0\b/)
    expect(el.querySelectorAll('.card, .striscia').length).toBeGreaterThanOrEqual(8)
  })

  it('senza la feature giacenze non chiama getDepositoTemporaneo e senza fir non chiama getFIRList', () => {
    const el = setup({ feature: [] })
    expect(giacenzeService.getDepositoTemporaneo).not.toHaveBeenCalled()
    expect(firService.getFIRList).not.toHaveBeenCalled()
    expect(el.querySelector('app-deposito-sintesi')).toBeNull()
    expect(el.querySelector('app-fir-recenti')).toBeNull()
  })

  it('le sorgenti opzionali partono quando la feature si attiva, una sola volta', () => {
    setup({ feature: [] })
    const ff = TestBed.inject(FeatureFlagsService)
    ff.features.set(['giacenze'])
    fixture.detectChanges()
    ff.features.set(['giacenze', 'fir'])
    fixture.detectChanges()
    fixture.detectChanges()
    expect(giacenzeService.getDepositoTemporaneo).toHaveBeenCalledTimes(1)
    expect(firService.getFIRList).toHaveBeenCalledOnceWith(1, 5)
  })
})
