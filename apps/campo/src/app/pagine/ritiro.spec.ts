import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';
import { ArchivioCoda } from '../core/archivio-coda';
import { ArchivioCodaMemoria } from '../core/archivio-coda.memoria';
import { ArchivioGiro } from '../core/archivio-giro';
import { ArchivioGiroMemoria } from '../core/archivio-giro.memoria';
import { CodaEventi } from '../core/coda-eventi';
import { GiroService } from '../core/giro.service';
import type { GiroVista } from '../core/modelli';
import { SessioneService } from '../core/sessione.service';
import { RitiroPagina } from './ritiro';

const jwt = (sub: string) =>
  `h.${btoa(JSON.stringify({ sub })).replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_')}.s`;

const giro: GiroVista = {
  data: '2026-12-01',
  autista: { id: 'a1', nome: 'Mario', cognome: 'Bianchi' },
  ritiri: [
    {
      id: 'r1',
      dataPrevista: '2026-12-01',
      fascia: 'MATTINA',
      ordineGiro: 1,
      produttore: { id: 'p', nome: 'Rossi Srl', sedeId: 's', indirizzo: 'Via Roma 1' },
      trasportatore: { id: 't', nome: 'Trasp' },
      destinatario: { id: 'd', nome: 'Impianto', sedeId: 'sd' },
      automezzo: null,
      autista: null,
      cerCode: '150102',
      descrizione: 'Imballaggi',
      quantitaPresunta: '120',
      unita: 'kg',
      stato: 'PROGRAMMATO',
      statoVisibile: 'DA_GENERARE',
      motivo: null,
      fir: null,
      versione: 1,
    },
  ],
};

describe('RitiroPagina: esito', () => {
  let http: HttpTestingController;
  let archivio: ArchivioCodaMemoria;
  const flush = () => new Promise<void>((r) => setTimeout(r, 0));

  const apri = async (cambia?: (g: GiroVista) => void) => {
    const g = structuredClone(giro);
    cambia?.(g);
    TestBed.inject(GiroService).impostaFresco(g, '2026-12-01T07:00:00.000Z');
    const f = TestBed.createComponent(RitiroPagina);
    f.componentRef.setInput('id', 'r1');
    f.detectChanges();
    await f.whenStable();
    return f;
  };
  const el = (f: { nativeElement: unknown }) => f.nativeElement as HTMLElement;
  const clic = async (f: Awaited<ReturnType<typeof apri>>, testid: string) => {
    (el(f).querySelector(`[data-testid="${testid}"]`) as HTMLElement).click();
    f.detectChanges();
    await f.whenStable();
    await flush();
    f.detectChanges();
  };
  const scrivi = (f: Awaited<ReturnType<typeof apri>>, testo: string) => {
    const t = el(f).querySelector('[data-testid="testo-esito"]') as HTMLTextAreaElement;
    t.value = testo;
    t.dispatchEvent(new Event('input'));
    f.detectChanges();
  };

  beforeEach(() => {
    localStorage.clear();
    archivio = new ArchivioCodaMemoria();
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: ArchivioCoda, useValue: archivio },
        { provide: ArchivioGiro, useValue: new ArchivioGiroMemoria() },
      ],
    });
    http = TestBed.inject(HttpTestingController);
    TestBed.inject(SessioneService).salvaDaFragment(`#accessToken=${jwt('u1')}&refreshToken=r`);
  });

  afterEach(() => {
    TestBed.inject(CodaEventi).ferma();
  });

  it('«Ritiro eseguito» con nota facoltativa: va in coda e parte l invio', async () => {
    const f = await apri();
    await clic(f, 'eseguito');
    scrivi(f, ' tutto ritirato ');
    await clic(f, 'conferma-esito');
    const req = http.expectOne('/api/v1/campo/eventi');
    expect(req.request.body).toMatchObject({
      ritiroId: 'r1',
      tipo: 'RITIRO_ESEGUITO',
      versioneVista: 1,
      dataVista: '2026-12-01',
      sedeVista: 's',
      dati: { nota: 'tutto ritirato' },
    });
    expect(el(f).querySelector('[data-testid="esito-stato"]')?.textContent).toContain(
      'in attesa di invio',
    );
    req.flush({ id: req.request.body.id, esito: 'APPLICATO', motivoConflitto: null });
    await flush();
    f.detectChanges();
    expect(el(f).querySelector('[data-testid="esito-stato"]')?.textContent).toContain(
      "inviato all'ufficio",
    );
    // Esito dato: i pulsanti non ci sono piu, niente doppio invio.
    expect(el(f).querySelector('[data-testid="eseguito"]')).toBeNull();
  });

  it('«Non eseguito» senza motivo: errore, nulla in coda', async () => {
    const f = await apri();
    await clic(f, 'non-eseguito');
    await clic(f, 'conferma-esito');
    expect(el(f).querySelector('[data-testid="esito-errore-form"]')?.textContent).toContain(
      'motivo',
    );
    http.expectNone('/api/v1/campo/eventi');
    expect(await archivio.tutti()).toEqual([]);
  });

  it('«Non eseguito» col motivo: invia il motivo e la versione vista', async () => {
    const f = await apri((g) => (g.ritiri[0] = { ...g.ritiri[0], ...{ id: 'r1' } }));
    await clic(f, 'non-eseguito');
    scrivi(f, 'Cliente assente');
    await clic(f, 'conferma-esito');
    const req = http.expectOne('/api/v1/campo/eventi');
    expect(req.request.body).toMatchObject({
      tipo: 'RITIRO_NON_ESEGUITO',
      dati: { motivo: 'Cliente assente' },
    });
    req.flush({
      id: req.request.body.id,
      esito: 'DA_RICONCILIARE',
      motivoConflitto: 'RITIRO_ANNULLATO',
    });
    await flush();
    f.detectChanges();
    const testo = el(f).querySelector('[data-testid="esito-stato"]')?.textContent ?? '';
    expect(testo).toContain("L'ufficio deve verificarlo");
    expect(testo).toContain('annullato in ufficio');
  });

  it('senza rete l esito resta «in attesa di invio» e l evento e salvato sul telefono', async () => {
    const f = await apri();
    await clic(f, 'eseguito');
    await clic(f, 'conferma-esito');
    http.expectOne('/api/v1/campo/eventi').error(new ProgressEvent('error'), { status: 0 });
    await flush();
    f.detectChanges();
    expect(el(f).querySelector('[data-testid="esito-stato"]')?.textContent).toContain(
      'in attesa di invio',
    );
    expect((await archivio.tutti()).map((e) => e.stato)).toEqual(['DA_INVIARE']);
    expect(el(f).querySelector('[data-testid="da-inviare"]')?.textContent).toContain(
      '1 esito da inviare',
    );
  });

  it('ritiro non piu programmato: nessun pulsante di esito', async () => {
    const f = await apri((g) => (g.ritiri[0].stato = 'NON_ESEGUITO'));
    expect(el(f).querySelector('[data-testid="eseguito"]')).toBeNull();
    expect(el(f).querySelector('[data-testid="esito"]')?.textContent).toContain(
      'non è più da fare',
    );
  });

  it('esito rifiutato dal server: il motivo e visibile e si puo scartare per riprovare', async () => {
    const f = await apri();
    await clic(f, 'eseguito');
    await clic(f, 'conferma-esito');
    http
      .expectOne('/api/v1/campo/eventi')
      .flush({ message: 'Ritiro non trovato.' }, { status: 404, statusText: 'x' });
    await flush();
    f.detectChanges();
    expect(el(f).querySelector('[data-testid="esito-rifiutato"]')?.textContent).toContain(
      'Ritiro non trovato.',
    );
    (el(f).querySelector('[data-testid="esito-rifiutato"] button') as HTMLElement).click();
    await flush();
    f.detectChanges();
    expect(el(f).querySelector('[data-testid="eseguito"]')).not.toBeNull();
  });
});
