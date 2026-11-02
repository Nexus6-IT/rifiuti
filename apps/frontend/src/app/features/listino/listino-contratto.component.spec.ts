import { ComponentFixture, TestBed } from '@angular/core/testing'
import { provideNoopAnimations } from '@angular/platform-browser/animations'
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router'
import { MessageService } from 'primeng/api'
import { Subject, of, throwError } from 'rxjs'
import { AuthService } from '../../core/services/auth.service'
import { ToastService } from '../../core/services/toast.service'
import { ClientiService } from '../clienti/clienti.service'
import { accettaConferma, bottone, q, stabilizza } from '../clienti/tabelle/tabelle-test-utils'
import { ElencoAddebiti, ElenchiContratto, RigaAddebito, StatoContratto } from './listino.model'
import { ListinoService } from './listino.service'
import {
  ListinoContrattoComponent,
  elencoValidoIl,
  importoItaliano,
  oggiIso,
  totaleFissiAnnuo,
} from './listino-contratto.component'

const CONTRATTO = 'cc1'

const elenco = (id: string, over: Partial<ElencoAddebiti> = {}): ElencoAddebiti => ({
  id,
  contrattoId: CONTRATTO,
  codice: id.toUpperCase(),
  descrizione: `Elenco ${id}`,
  nota1: null,
  nota2: null,
  validoDal: null,
  validoAl: null,
  predefinito: false,
  codiceCig: null,
  codiceCup: null,
  idDocumentoPa: null,
  dataDocumentoPa: null,
  righe: 2,
  versione: 3,
  modificabile: true,
  eliminabile: true,
  allegati: [],
  ...over,
})

const riga = (id: string, over: Partial<RigaAddebito> = {}): RigaAddebito =>
  ({
    id,
    elencoId: 'e1',
    tipo: 'CER',
    etichettaTipo: 'Riga CER',
    famiglia: 'CER',
    cerCode: '20 03 01',
    addebito: null,
    riferimento: 'R1',
    descrizione: 'Rifiuti urbani misti',
    tipoQuantita: 'PESO_NETTO',
    quantitaFissa: null,
    unitaMisura: 'KG',
    prezzo: '0.120000',
    prezzoSpeciale: false,
    sconto: '10',
    codiceIva: { id: 'i1', codice: '22', descrizione: 'Ordinaria' },
    provvigione: '5',
    tipoProvvigione: 'SCONTATO',
    categoria: { id: 'cat', codice: '001', descrizione: 'Urbani' },
    centroRicavo: null,
    scaglioni: [],
    condizione: 2,
    minimoFatturabile: '15.00',
    minimoPerCategoria: false,
    scadenze: [],
    cerProposta: [],
    addebitiProposti: [],
    appunti: 'ritiro il lunedì',
    notaUsoInterno: null,
    versione: 1,
    ...over,
  }) as unknown as RigaAddebito

const risposta = (
  stato: StatoContratto = 'ATTIVO',
  elenchi: ElencoAddebiti[] = [elenco('e1', { predefinito: true }), elenco('e2')],
  principale: { id: string; numero: string } | null = null
): ElenchiContratto => ({
  contesto: {
    contratto: {
      id: CONTRATTO,
      numero: 'CC-2026-001',
      stato,
      clienteId: 'cl1',
      contrattoPrincipale: principale,
      dataInizio: '2026-01-01',
      dataFine: null,
    },
  },
  elenchi,
})

describe('funzioni pure della pagina del listino', () => {
  it('elenco valido: senza date sempre, con le date estremi compresi', () => {
    const e = { validoDal: '2026-03-01', validoAl: '2026-03-31' }
    expect(elencoValidoIl({ validoDal: null, validoAl: null }, '2030-01-01')).toBeTrue()
    expect(elencoValidoIl(e, '2026-03-01')).toBeTrue()
    expect(elencoValidoIl(e, '2026-03-31')).toBeTrue()
    expect(elencoValidoIl(e, '2026-04-01')).toBeFalse()
    expect(elencoValidoIl(e, '2026-02-28')).toBeFalse()
  })

  it('oggiIso è la data locale', () => {
    expect(oggiIso(new Date(2026, 0, 5, 23, 59))).toBe('2026-01-05')
  })

  it('importo italiano con il separatore delle migliaia', () => {
    expect(importoItaliano('0.00')).toBe('0,00')
    expect(importoItaliano('999.99')).toBe('999,99')
    expect(importoItaliano('1234.50')).toBe('1.234,50')
    expect(importoItaliano('1234567.05')).toBe('1.234.567,05')
  })

  it('totale fissi: solo scadenze ogni anno, quantità vuota = 1, zero = non fatturare', () => {
    const ogni = { ordine: 1, giorno: 1, mese: 1, anno: null }
    const una = { ordine: 2, giorno: 1, mese: 7, anno: 2026 }
    const f = (quantitaFissa: string | null, prezzo: string | null, scadenze = [ogni, una]) => ({
      tipo: 'F',
      quantitaFissa,
      prezzo,
      scadenze,
    })
    expect(totaleFissiAnnuo([])).toBe('0.00')
    expect(totaleFissiAnnuo([f(null, '100.50')])).toBe('100.50')
    expect(totaleFissiAnnuo([f('2', '10.005')])).toBe('20.01')
    expect(totaleFissiAnnuo([f('0', '100')])).toBe('0.00')
    expect(totaleFissiAnnuo([f(null, '10', [ogni, { ...ogni, ordine: 3, mese: 6 }])])).toBe('20.00')
    expect(totaleFissiAnnuo([f(null, '10', [una])])).toBe('0.00')
    expect(
      totaleFissiAnnuo([
        f(null, '10'),
        f(null, '5.25'),
        { ...f(null, '99'), tipo: 'V' },
        f(null, null),
      ])
    ).toBe('15.25')
  })
})

describe('ListinoContrattoComponent', () => {
  let fixture: ComponentFixture<ListinoContrattoComponent>
  let delContratto: jasmine.Spy
  let prossimoCodice: jasmine.Spy
  let crea: jasmine.Spy
  let modifica: jasmine.Spy
  let eliminaElenco: jasmine.Spy
  let righeList: jasmine.Spy
  let contrattoGet: jasmine.Spy
  let toast: jasmine.SpyObj<ToastService>

  async function apri(
    role = 'ADMIN',
    r: ElenchiContratto = risposta()
  ): Promise<ListinoContrattoComponent> {
    delContratto.and.returnValue(of(r))
    TestBed.overrideProvider(AuthService, { useValue: { currentUser: () => ({ role }) } })
    fixture = TestBed.createComponent(ListinoContrattoComponent)
    await stabilizza(fixture)
    return fixture.componentInstance
  }

  async function scegli(id: string) {
    bottone(`listino-scegli-${id}`)!.click()
    await stabilizza(fixture)
  }

  const testo = (id: string) => q(id)?.textContent?.replace(/\s+/g, ' ').trim() ?? ''

  beforeEach(() => {
    delContratto = jasmine.createSpy('delContratto')
    prossimoCodice = jasmine.createSpy('prossimoCodice').and.returnValue(of('003'))
    crea = jasmine.createSpy('crea').and.returnValue(of(elenco('e3')))
    modifica = jasmine.createSpy('modifica').and.returnValue(of(elenco('e1')))
    eliminaElenco = jasmine.createSpy('elimina').and.returnValue(of(undefined))
    righeList = jasmine.createSpy('list').and.returnValue(of([riga('r1')]))
    contrattoGet = jasmine
      .createSpy('get')
      .and.returnValue(of({ cliente: { ragioneSociale: 'Verdi Servizi S.r.l.' } }))
    toast = jasmine.createSpyObj('ToastService', ['error', 'success', 'info', 'warn'])
    TestBed.configureTestingModule({
      imports: [ListinoContrattoComponent],
      providers: [
        provideNoopAnimations(),
        provideRouter([]),
        MessageService,
        { provide: ToastService, useValue: toast },
        { provide: AuthService, useValue: { currentUser: () => ({ role: 'ADMIN' }) } },
        {
          provide: ActivatedRoute,
          useValue: { snapshot: { paramMap: convertToParamMap({ id: CONTRATTO }) } },
        },
        { provide: ClientiService, useValue: { contratti: { get: contrattoGet } } },
        {
          provide: ListinoService,
          useValue: {
            elenchi: { delContratto, prossimoCodice, crea, modifica, elimina: eliminaElenco },
            righe: { list: righeList },
          },
        },
      ],
    })
  })
  afterEach(() => fixture?.destroy())

  describe('intestazione', () => {
    it('numero, cliente e stato; legge elenchi e cliente del contratto della rotta', async () => {
      await apri()
      expect(delContratto).toHaveBeenCalledOnceWith(CONTRATTO)
      expect(contrattoGet).toHaveBeenCalledOnceWith(CONTRATTO)
      expect(testo('listino-intestazione')).toContain('CC-2026-001')
      expect(testo('listino-cliente')).toBe('Verdi Servizi S.r.l.')
      expect(testo('listino-stato')).toContain('Attivo')
      expect(q('listino-allegato-a')).toBeNull()
      expect(q('listino-sola-lettura')).toBeNull()
    })

    it('contratto allegato: "Allegato al contratto …"', async () => {
      await apri('ADMIN', risposta('ATTIVO', [], { id: 'p1', numero: 'CC-2025-100' }))
      expect(testo('listino-allegato-a')).toBe('Allegato al contratto CC-2025-100')
    })

    it('il cliente che non si legge non blocca la pagina', async () => {
      contrattoGet.and.returnValue(throwError(() => ({ status: 500 })))
      await apri()
      expect(q('listino-cliente')).toBeNull()
      expect(q('listino-intestazione')).toBeTruthy()
    })

    it('errore di caricamento: messaggio del backend e "Ricarica" che rilegge', async () => {
      delContratto.and.returnValue(
        throwError(() => ({ status: 404, error: { message: 'Contratto non trovato.' } }))
      )
      fixture = TestBed.createComponent(ListinoContrattoComponent)
      await stabilizza(fixture)
      expect(testo('listino-errore')).toContain('Contratto non trovato.')
      expect(q('listino-intestazione')).toBeNull()
      delContratto.and.returnValue(of(risposta()))
      bottone('listino-ricarica')!.click()
      await stabilizza(fixture)
      expect(q('listino-errore')).toBeNull()
      expect(q('listino-intestazione')).toBeTruthy()
    })
  })

  describe('elenchi', () => {
    it('mostra codice e descrizione; il predefinito è evidenziato', async () => {
      await apri()
      expect(testo('listino-elenco-e1')).toContain('E1')
      expect(testo('listino-elenco-e1')).toContain('Elenco e1')
      expect(q('listino-predefinito-e1')).toBeTruthy()
      expect(q('listino-predefinito-e2')).toBeNull()
    })

    it('elenco con date: mostra la validità in italiano', async () => {
      await apri(
        'ADMIN',
        risposta('ATTIVO', [elenco('e1', { validoDal: '2026-03-01', validoAl: '2026-03-31' })])
      )
      expect(testo('listino-elenco-e1')).toContain('dal 01/03/2026 al 31/03/2026')
    })

    it('"Solo validi oggi" nasconde gli elenchi fuori validità', async () => {
      const oggi = new Date()
      const anno = oggi.getFullYear()
      await apri(
        'ADMIN',
        risposta('ATTIVO', [
          elenco('e1'),
          elenco('e2', { validoDal: `${anno - 2}-01-01`, validoAl: `${anno - 2}-12-31` }),
          elenco('e3', { validoDal: `${anno - 1}-01-01`, validoAl: `${anno + 1}-12-31` }),
        ])
      )
      expect(q('listino-elenco-e2')).toBeTruthy()
      const spunta = q('listino-solo-validi')!.querySelector<HTMLElement>('.p-checkbox-box')!
      spunta.click()
      await stabilizza(fixture)
      expect(q('listino-elenco-e1')).toBeTruthy()
      expect(q('listino-elenco-e3')).toBeTruthy()
      expect(q('listino-elenco-e2')).toBeNull()
    })

    it('nessun elenco: messaggio', async () => {
      await apri('ADMIN', risposta('ATTIVO', []))
      expect(q('listino-nessun-elenco')).toBeTruthy()
    })

    it("scegliere un elenco legge le sue righe; l'ultima scelta vince", async () => {
      const prima = new Subject<RigaAddebito[]>()
      righeList.and.callFake((id: string) => (id === 'e1' ? prima : of([riga('r9')])))
      await apri()
      await scegli('e1')
      await scegli('e2')
      prima.next([riga('vecchia')])
      await stabilizza(fixture)
      expect(q('listino-riga-r9')).toBeTruthy()
      expect(q('listino-riga-vecchia')).toBeNull()
    })

    describe('nuovo, modifica, elimina', () => {
      it('nuovo: propone il codice, salva con i dati puliti e rilegge', async () => {
        const c = await apri()
        bottone('listino-nuovo-elenco')!.click()
        await stabilizza(fixture)
        expect(prossimoCodice).toHaveBeenCalledOnceWith(CONTRATTO)
        expect(document.body.querySelector<HTMLInputElement>('#el-codice')!.value).toBe('003')
        const descr = document.body.querySelector<HTMLInputElement>('#el-descrizione')!
        descr.value = '  Rifiuti speciali  '
        descr.dispatchEvent(new Event('input'))
        await stabilizza(fixture)
        delContratto.calls.reset()
        bottone('listino-elenco-salva')!.click()
        await stabilizza(fixture)
        expect(crea).toHaveBeenCalledTimes(1)
        const [id, dati] = crea.calls.mostRecent().args
        expect(id).toBe(CONTRATTO)
        expect(dati.descrizione).toBe('Rifiuti speciali')
        expect(dati.codice).toBe('003')
        expect(dati.nota1).toBeNull()
        expect(dati.validoDal).toBeNull()
        expect(dati.predefinito).toBeFalse()
        expect(delContratto).toHaveBeenCalledTimes(1)
        expect(c.elencoDialogAperto()).toBeFalse()
      })

      it('senza descrizione il salvataggio è disabilitato', async () => {
        await apri()
        bottone('listino-nuovo-elenco')!.click()
        await stabilizza(fixture)
        expect(bottone('listino-elenco-salva')!.disabled).toBeTrue()
      })

      it("modifica: precompila e manda la versione dell'elenco", async () => {
        await apri()
        bottone('listino-modifica-e1')!.click()
        await stabilizza(fixture)
        expect(prossimoCodice).not.toHaveBeenCalled()
        expect(document.body.querySelector<HTMLInputElement>('#el-descrizione')!.value).toBe(
          'Elenco e1'
        )
        bottone('listino-elenco-salva')!.click()
        await stabilizza(fixture)
        expect(modifica).toHaveBeenCalledTimes(1)
        const [id, dati] = modifica.calls.mostRecent().args
        expect(id).toBe('e1')
        expect(dati.versione).toBe(3)
        expect(dati.predefinito).toBeTrue()
      })

      it('errore del backend nel dialog (409 codice duplicato): messaggio e dialog aperto', async () => {
        crea.and.returnValue(
          throwError(() => ({ status: 409, error: { message: 'Il codice è già usato.' } }))
        )
        const c = await apri()
        bottone('listino-nuovo-elenco')!.click()
        await stabilizza(fixture)
        const descr = document.body.querySelector<HTMLInputElement>('#el-descrizione')!
        descr.value = 'X'
        descr.dispatchEvent(new Event('input'))
        await stabilizza(fixture)
        bottone('listino-elenco-salva')!.click()
        await stabilizza(fixture)
        expect(testo('listino-elenco-errore')).toBe('Il codice è già usato.')
        expect(c.elencoDialogAperto()).toBeTrue()
        expect(c.inCorso()).toBeFalse()
      })

      it('elimina: chiede conferma, poi DELETE con la versione e rilegge', async () => {
        await apri()
        bottone('listino-elimina-e2')!.click()
        await stabilizza(fixture)
        expect(eliminaElenco).not.toHaveBeenCalled()
        expect(document.body.textContent).toContain('Eliminare l’elenco E2')
        accettaConferma()
        await stabilizza(fixture)
        expect(eliminaElenco).toHaveBeenCalledOnceWith('e2', 3)
        expect(delContratto).toHaveBeenCalledTimes(2)
      })

      it('elimina con 409: messaggio con "Ricarica" e nessuna rilettura nascosta', async () => {
        eliminaElenco.and.returnValue(
          throwError(() => ({
            status: 409,
            error: { message: "L'elenco è stato modificato da un altro utente." },
          }))
        )
        await apri()
        bottone('listino-elimina-e2')!.click()
        await stabilizza(fixture)
        accettaConferma()
        await stabilizza(fixture)
        expect(testo('listino-errore')).toContain('modificato da un altro utente')
        expect(bottone('listino-ricarica')).toBeTruthy()
        expect(delContratto).toHaveBeenCalledTimes(1)
        bottone('listino-ricarica')!.click()
        await stabilizza(fixture)
        expect(delContratto).toHaveBeenCalledTimes(2)
        expect(q('listino-errore')).toBeNull()
      })

      it('elimina fallito per altro motivo: toast e rilettura', async () => {
        eliminaElenco.and.returnValue(
          throwError(() => ({ status: 500, error: { message: 'Errore.' } }))
        )
        await apri()
        bottone('listino-elimina-e2')!.click()
        await stabilizza(fixture)
        accettaConferma()
        await stabilizza(fixture)
        expect(toast.error).toHaveBeenCalledWith('Errore.')
        expect(delContratto).toHaveBeenCalledTimes(2)
      })

      it("eliminare l'elenco scelto svuota la tavola", async () => {
        await apri()
        await scegli('e2')
        expect(q('listino-riga-r1')).toBeTruthy()
        delContratto.and.returnValue(of(risposta('ATTIVO', [elenco('e1')])))
        bottone('listino-elimina-e2')!.click()
        await stabilizza(fixture)
        accettaConferma()
        await stabilizza(fixture)
        expect(q('listino-riga-r1')).toBeNull()
        expect(q('listino-scegli-un-elenco')).toBeTruthy()
      })
    })
  })

  describe('tavola delle righe', () => {
    it('prima della scelta: invito a scegliere un elenco', async () => {
      await apri()
      expect(q('listino-scegli-un-elenco')).toBeTruthy()
      expect(righeList).not.toHaveBeenCalled()
    })

    it('le colonne di D28', async () => {
      await apri()
      await scegli('e1')
      const intest = Array.from(document.body.querySelectorAll('th')).map(t =>
        t.textContent!.trim()
      )
      expect(intest).toEqual([
        'Tipo',
        'CER / addebito',
        'Rif.',
        'Descrizione',
        'U.M.',
        'Quantità',
        'Prezzo',
        'Sconto',
        'IVA',
        'Provvigione',
        'Cond.',
        'Minimo',
        'Categoria',
        'Appunti',
      ])
    })

    it('la riga mostra i dati leggibili e mai gli id', async () => {
      await apri()
      await scegli('e1')
      const t = testo('listino-riga-r1')
      for (const atteso of [
        'CER',
        '20 03 01',
        'R1',
        'Rifiuti urbani misti',
        'KG',
        'PESO_NETTO',
        '0.120000',
        '10',
        '22',
        '5',
        '2',
        '15.00',
        'Urbani',
        'ritiro il lunedì',
      ])
        expect(t).withContext(atteso).toContain(atteso)
      for (const id of ['i1', 'cat', 'e1']) expect(t.split(' ')).not.toContain(id)
    })

    it("riga con addebito d'archivio e prezzo speciale", async () => {
      righeList.and.returnValue(
        of([
          riga('r2', {
            tipo: 'V',
            cerCode: null,
            addebito: { id: 'a1', codice: '00010', descrizione: 'Nolo cassone' },
            descrizione: null,
            prezzo: null,
            prezzoSpeciale: true,
          }),
        ])
      )
      await apri()
      await scegli('e1')
      const t = testo('listino-riga-r2')
      expect(t).toContain('00010')
      expect(t).toContain('Nolo cassone')
      expect(t).toContain('speciale')
    })

    it('riga fissa: quantità fissa (vuota = 1) e totale dei fissi annuo', async () => {
      const ogni = { ordine: 1, giorno: 1, mese: 1, anno: null, fatturabileNelContratto: true }
      righeList.and.returnValue(
        of([
          riga('f1', {
            tipo: 'F',
            cerCode: null,
            quantitaFissa: '2',
            prezzo: '50',
            scadenze: [ogni],
          }),
          riga('f2', {
            tipo: 'F',
            cerCode: null,
            quantitaFissa: null,
            prezzo: '10.5',
            scadenze: [ogni],
          }),
          riga('v1'),
        ])
      )
      await apri()
      await scegli('e1')
      expect(testo('listino-totale-fissi')).toBe('Totale fissi: 110,50')
    })

    it('elenco senza righe: messaggio e totale zero', async () => {
      righeList.and.returnValue(of([]))
      await apri()
      await scegli('e1')
      expect(document.body.textContent).toContain('Nessuna riga.')
      expect(testo('listino-totale-fissi')).toBe('Totale fissi: 0,00')
    })

    it('errore nel leggere le righe: messaggio sotto la tavola, elenchi intatti', async () => {
      righeList.and.returnValue(
        throwError(() => ({ status: 500, error: { message: 'Righe non disponibili.' } }))
      )
      await apri()
      await scegli('e1')
      expect(testo('listino-errore-righe')).toBe('Righe non disponibili.')
      expect(q('listino-elenco-e1')).toBeTruthy()
    })

    it('doppio clic apre la riga (il dialog arriva con il Task 27)', async () => {
      const c = await apri()
      await scegli('e1')
      q('listino-riga-r1')!.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))
      expect(c.rigaAperta()?.id).toBe('r1')
    })
  })

  describe('sola lettura', () => {
    const SCRITTURE = [
      'listino-nuovo-elenco',
      'listino-modifica-e1',
      'listino-elimina-e1',
      'listino-modifica-e2',
      'listino-elimina-e2',
    ]

    it('VIEWER: legge elenchi e righe, nessun pulsante di scrittura', async () => {
      await apri('VIEWER')
      for (const id of SCRITTURE) expect(q(id)).withContext(id).toBeNull()
      expect(testo('listino-sola-lettura')).toBe('Hai accesso in sola lettura.')
      await scegli('e1')
      expect(q('listino-riga-r1')).toBeTruthy()
    })

    it('contratto annullato: sola lettura anche per ADMIN, con il motivo', async () => {
      await apri('ADMIN', risposta('ANNULLATO'))
      for (const id of SCRITTURE) expect(q(id)).withContext(id).toBeNull()
      expect(testo('listino-sola-lettura')).toBe(
        'Il listino di un contratto annullato non si modifica.'
      )
      expect(testo('listino-stato')).toContain('Annullato')
    })

    it('apriElenco e salvaElenco non scrivono in sola lettura', async () => {
      const c = await apri('VIEWER')
      c.apriElenco(null)
      expect(c.elencoDialogAperto()).toBeFalse()
      c.modulo.descrizione = 'X'
      c.salvaElenco()
      expect(crea).not.toHaveBeenCalled()
    })

    it('un elenco non modificabile non mostra modifica ed elimina', async () => {
      await apri('ADMIN', risposta('ATTIVO', [elenco('e1', { modificabile: false })]))
      expect(q('listino-modifica-e1')).toBeNull()
      expect(q('listino-elimina-e1')).toBeNull()
    })
  })
})
