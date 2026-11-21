import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ArchivioGiro } from '../core/archivio-giro';
import { ArchivioGiroMemoria } from '../core/archivio-giro.memoria';
import { ArchivioRicevute } from '../core/archivio-ricevute';
import { ArchivioRicevuteMemoria } from '../core/archivio-ricevute.memoria';
import { CodaRicevute } from '../core/coda-ricevute';
import { FirmaPng } from '../core/firma-png';
import { GiroService } from '../core/giro.service';
import type { GiroVista } from '../core/modelli';
import { SessioneService } from '../core/sessione.service';
import { RicevutaPagina } from './ricevuta';

const jwt = (sub: string) =>
  `h.${btoa(JSON.stringify({ sub })).replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_')}.s`;

const URL_RICEVUTE = '/api/v1/campo/ricevute';
const URL_CONFIG = '/api/v1/campo/ricevute/configurazione';

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

describe('RicevutaPagina', () => {
  let http: HttpTestingController;
  let archivio: ArchivioRicevuteMemoria;
  const flush = () => new Promise<void>((r) => setTimeout(r, 0));
  const el = (f: { nativeElement: unknown }) => f.nativeElement as HTMLElement;
  const q = (f: { nativeElement: unknown }, id: string) =>
    el(f).querySelector(`[data-testid="${id}"]`) as HTMLElement | null;

  const apri = async (invioEmail = false) => {
    TestBed.inject(GiroService).impostaFresco(structuredClone(giro), '2026-12-01T07:00:00.000Z');
    const f = TestBed.createComponent(RicevutaPagina);
    f.componentRef.setInput('id', 'r1');
    f.detectChanges();
    http.expectOne(URL_CONFIG).flush({ invioEmail });
    await f.whenStable();
    f.detectChanges();
    return f;
  };
  const scrivi = (f: Awaited<ReturnType<typeof apri>>, id: string, testo: string) => {
    const i = q(f, id) as HTMLInputElement;
    i.value = testo;
    i.dispatchEvent(new Event('input'));
    f.detectChanges();
  };
  /** Disegna con il dito: la tela di jsdom non ha dimensioni, le diamo noi. */
  const firma = (f: Awaited<ReturnType<typeof apri>>, lunga = true) => {
    const t = q(f, 'tela-firma') as HTMLCanvasElement;
    t.getBoundingClientRect = () => ({ left: 0, top: 0, width: 600, height: 240 }) as DOMRect;
    const ev = (tipo: string, x: number, y: number) =>
      t.dispatchEvent(new MouseEvent(tipo, { clientX: x, clientY: y, bubbles: true }));
    ev('pointerdown', 20, 100);
    for (let x = 25; x <= (lunga ? 300 : 30); x += 5) ev('pointermove', x, 100 + (x % 20));
    ev('pointerup', 300, 100);
  };
  const clic = async (f: Awaited<ReturnType<typeof apri>>, id: string) => {
    q(f, id)?.click();
    f.detectChanges();
    await f.whenStable();
    await flush();
    f.detectChanges();
  };

  beforeEach(() => {
    localStorage.clear();
    // jsdom non ha canvas: la tela a schermo non disegna, l'esportazione e' finta.
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
    archivio = new ArchivioRicevuteMemoria();
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: ArchivioRicevute, useValue: archivio },
        { provide: ArchivioGiro, useValue: new ArchivioGiroMemoria() },
        { provide: FirmaPng, useValue: { esporta: () => 'iVBORw0KGgo=' } },
      ],
    });
    http = TestBed.inject(HttpTestingController);
    TestBed.inject(SessioneService).salvaDaFragment(`#accessToken=${jwt('u1')}&refreshToken=r`);
  });

  afterEach(() => {
    TestBed.inject(CodaRicevute).ferma();
    vi.restoreAllMocks();
  });

  it('dice onestamente che cos e: non sostituisce il FIR, firma semplice, non qualificata', async () => {
    const f = await apri();
    const t = q(f, 'avviso-valore')?.textContent ?? '';
    expect(t).toContain('Non sostituisce il FIR');
    expect(t).toContain('firma elettronica semplice');
    expect(t).toContain('Non è una firma qualificata');
    expect(q(f, 'riepilogo')?.textContent).toContain('Rossi Srl');
    expect(q(f, 'riepilogo')?.textContent).toContain('quantità presunta');
  });

  it('il campo email non c e se l invio al cliente e spento (default)', async () => {
    const f = await apri(false);
    expect(q(f, 'email-cliente')).toBeNull();
  });

  it('se la configurazione non risponde (offline) il campo email non compare', async () => {
    TestBed.inject(GiroService).impostaFresco(structuredClone(giro), '2026-12-01T07:00:00.000Z');
    const f = TestBed.createComponent(RicevutaPagina);
    f.componentRef.setInput('id', 'r1');
    f.detectChanges();
    http.expectOne(URL_CONFIG).error(new ProgressEvent('error'), { status: 0 });
    await f.whenStable();
    f.detectChanges();
    expect(q(f, 'email-cliente')).toBeNull();
    expect(q(f, 'conferma-firma')).not.toBeNull();
  });

  it('con l invio acceso compare il campo email', async () => {
    const f = await apri(true);
    expect(q(f, 'email-cliente')).not.toBeNull();
  });

  it('senza nome o senza firma (o con un puntino) non registra nulla', async () => {
    const f = await apri();
    await clic(f, 'conferma-firma');
    expect(q(f, 'errore-firma')?.textContent).toContain('nome');
    scrivi(f, 'nome-firmatario', 'Mario Rossi');
    await clic(f, 'conferma-firma');
    expect(q(f, 'errore-firma')?.textContent).toContain('firma');
    firma(f, false);
    await clic(f, 'conferma-firma');
    expect(q(f, 'errore-firma')?.textContent).toContain('troppo breve');
    http.expectNone(URL_RICEVUTE);
    expect(await archivio.tutte()).toEqual([]);
  });

  it('«Cancella la firma» svuota la tela', async () => {
    const f = await apri();
    scrivi(f, 'nome-firmatario', 'Mario Rossi');
    firma(f);
    await clic(f, 'cancella-firma');
    await clic(f, 'conferma-firma');
    expect(q(f, 'errore-firma')?.textContent).toContain('firma');
    http.expectNone(URL_RICEVUTE);
  });

  it('firma valida: registra sul telefono, invia e mostra l esito con l impronta', async () => {
    const f = await apri();
    scrivi(f, 'nome-firmatario', '  Mario   Rossi ');
    firma(f);
    await clic(f, 'conferma-firma');
    const req = http.expectOne(URL_RICEVUTE);
    expect(req.request.body).toMatchObject({
      ritiroId: 'r1',
      firmatarioNome: 'Mario Rossi',
      firmaPng: 'iVBORw0KGgo=',
    });
    expect(req.request.body.emailCliente).toBeUndefined();
    expect(q(f, 'stato-ricevuta')?.textContent).toContain('in attesa di invio');
    req.flush({
      id: req.request.body.id,
      ricevutoIl: '2026-12-01T09:00:00.000Z',
      pdfSha256: 'a'.repeat(64),
      contenutoSha256: 'b'.repeat(64),
      invio: 'NON_RICHIESTO',
    });
    await flush();
    f.detectChanges();
    expect(q(f, 'stato-ricevuta')?.textContent).toContain("Inviata all'ufficio e archiviata");
    expect(q(f, 'impronta')?.textContent).toContain('bbbbbbbbbbbbbbbb');
    // Il form di firma non c'e' piu: niente doppio invio.
    expect(q(f, 'conferma-firma')).toBeNull();
  });

  it('con l invio acceso e un indirizzo valido lo manda; uno non valido blocca', async () => {
    const f = await apri(true);
    scrivi(f, 'nome-firmatario', 'Mario Rossi');
    scrivi(f, 'email-cliente', 'non-una-mail');
    firma(f);
    await clic(f, 'conferma-firma');
    expect(q(f, 'errore-firma')?.textContent).toContain('email');
    http.expectNone(URL_RICEVUTE);
    scrivi(f, 'email-cliente', 'cliente@esempio.it');
    await clic(f, 'conferma-firma');
    const req = http.expectOne(URL_RICEVUTE);
    expect(req.request.body.emailCliente).toBe('cliente@esempio.it');
    req.flush({
      id: req.request.body.id,
      ricevutoIl: '2026-12-01T09:00:00.000Z',
      pdfSha256: 'a'.repeat(64),
      contenutoSha256: 'b'.repeat(64),
      invio: 'FALLITO',
    });
    await flush();
    f.detectChanges();
    expect(q(f, 'stato-ricevuta')?.textContent).toContain('non è partita');
  });

  it('rifiuto del server: lo dice col motivo, senza ritentare', async () => {
    const f = await apri();
    scrivi(f, 'nome-firmatario', 'Mario Rossi');
    firma(f);
    await clic(f, 'conferma-firma');
    http
      .expectOne(URL_RICEVUTE)
      .flush({ message: 'Il ritiro non è più assegnato a te.' }, { status: 409, statusText: 'x' });
    await flush();
    f.detectChanges();
    expect(q(f, 'stato-ricevuta')?.textContent).toContain('Non accettata dal server');
    expect(q(f, 'stato-ricevuta')?.textContent).toContain('non è più assegnato a te');
    http.expectNone(URL_RICEVUTE);
  });

  it('senza rete la ricevuta resta sul telefono (firma in archivio) e il form non si ripresenta', async () => {
    const f = await apri();
    scrivi(f, 'nome-firmatario', 'Mario Rossi');
    firma(f);
    await clic(f, 'conferma-firma');
    http.expectOne(URL_RICEVUTE).error(new ProgressEvent('error'), { status: 0 });
    await flush();
    f.detectChanges();
    expect(q(f, 'stato-ricevuta')?.textContent).toContain('in attesa di invio');
    const [r] = await archivio.tutte();
    expect(r).toMatchObject({ stato: 'DA_INVIARE', firmaPng: 'iVBORw0KGgo=', tentativi: 1 });
  });
});
