import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ArchivioRicevute } from './archivio-ricevute';
import { ArchivioRicevuteMemoria } from './archivio-ricevute.memoria';
import { CodaRicevute } from './coda-ricevute';
import { SessioneService } from './sessione.service';

const jwt = (sub: string) =>
  `h.${btoa(JSON.stringify({ sub })).replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_')}.s`;

const URL_RICEVUTE = '/api/v1/campo/ricevute';
const nuova = (ritiroId = 'r1', extra: Record<string, unknown> = {}) => ({
  ritiroId,
  firmatarioNome: 'Mario Rossi',
  firmaPng: 'iVBORw0KGgo=',
  emailCliente: null,
  ...extra,
});
const ok = (id: string, invio = 'NON_RICHIESTO') => ({
  id,
  ricevutoIl: '2026-12-01T09:00:00.000Z',
  pdfSha256: 'a'.repeat(64),
  contenutoSha256: 'b'.repeat(64),
  invio,
});

describe('CodaRicevute (coda di uscita delle ricevute)', () => {
  let archivio: ArchivioRicevuteMemoria;
  let http: HttpTestingController;
  let coda: CodaRicevute;
  let sessione: SessioneService;

  const accedi = (utente: string) =>
    sessione.salvaDaFragment(`#accessToken=${jwt(utente)}&refreshToken=r`);
  const flush = () => new Promise<void>((r) => setTimeout(r, 0));
  const rispondi = async (fn: (req: ReturnType<HttpTestingController['expectOne']>) => void) => {
    fn(http.expectOne(URL_RICEVUTE));
    await flush();
  };
  const senzaRete = (req: { error: (e: ProgressEvent, o: { status: number }) => void }) =>
    req.error(new ProgressEvent('error'), { status: 0 });
  const conStato =
    (status: number, body: unknown = {}) =>
    (req: { flush: (b: unknown, o: { status: number; statusText: string }) => void }) =>
      req.flush(body, { status, statusText: 'x' });

  beforeEach(() => {
    localStorage.clear();
    archivio = new ArchivioRicevuteMemoria();
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: ArchivioRicevute, useValue: archivio },
      ],
    });
    http = TestBed.inject(HttpTestingController);
    coda = TestBed.inject(CodaRicevute);
    sessione = TestBed.inject(SessioneService);
  });

  afterEach(() => {
    coda.ferma();
    http.verify();
  });

  it('scrive sul telefono PRIMA di inviare e spedisce nome, ora e firma (mai utente o dati del ritiro)', async () => {
    accedi('u1');
    const r = await coda.registra(nuova());
    expect(r).toMatchObject({ utenteId: 'u1', stato: 'DA_INVIARE', firmaPng: 'iVBORw0KGgo=' });
    expect(r.id).toMatch(/^[0-9a-f-]{36}$/);
    expect((await archivio.tutte()).map((x) => x.id)).toEqual([r.id]);
    const req = http.expectOne(URL_RICEVUTE);
    expect(req.request.body).toEqual({
      id: r.id,
      ritiroId: 'r1',
      firmatarioNome: 'Mario Rossi',
      firmatoIl: r.firmatoIl,
      firmaPng: 'iVBORw0KGgo=',
    });
    req.flush(ok(r.id));
    await flush();
  });

  it('arrivata: CONFERMATO con le impronte del server e senza firma ne email sul telefono', async () => {
    accedi('u1');
    const r = await coda.registra(nuova('r1', { emailCliente: 'c@esempio.it' }));
    const req = http.expectOne(URL_RICEVUTE);
    expect(req.request.body.emailCliente).toBe('c@esempio.it');
    req.flush(ok(r.id, 'INVIATO'));
    await flush();
    const [x] = coda.mie();
    expect(x).toMatchObject({
      stato: 'CONFERMATO',
      firmaPng: null,
      emailCliente: null,
      pdfSha256: 'a'.repeat(64),
      contenutoSha256: 'b'.repeat(64),
      invio: 'INVIATO',
    });
    const [inArchivio] = await archivio.tutte();
    expect(inArchivio.firmaPng).toBeNull();
    expect(inArchivio.emailCliente).toBeNull();
    expect(coda.daInviare()).toBe(0);
    await coda.invia();
    http.expectNone(URL_RICEVUTE);
  });

  it('senza rete resta in coda e riparte con LO STESSO uuid; la firma resta finche non e arrivata', async () => {
    accedi('u1');
    const r = await coda.registra(nuova());
    await rispondi(senzaRete);
    expect(coda.mie()[0]).toMatchObject({ stato: 'DA_INVIARE', tentativi: 1, firmaPng: 'iVBORw0KGgo=' });
    void coda.invia();
    const req = http.expectOne(URL_RICEVUTE);
    expect(req.request.body.id).toBe(r.id);
    req.flush(ok(r.id));
    await flush();
    expect(coda.mie()).toHaveLength(1);
    expect(coda.daInviare()).toBe(0);
  });

  it('rifiuto definitivo (400/404/409/413/422): RIFIUTATO col messaggio, firma liberata, nessun ritentativo', async () => {
    accedi('u1');
    for (const status of [400, 404, 409, 413, 422]) {
      const r = await coda.registra(nuova(`r${status}`));
      await rispondi(conStato(status, { message: `No ${status}` }));
      const x = coda.mie().find((y) => y.id === r.id);
      expect(x).toMatchObject({ stato: 'RIFIUTATO', errore: `No ${status}`, firmaPng: null });
    }
    expect(coda.rifiutate()).toBe(5);
    await coda.invia();
    http.expectNone(URL_RICEVUTE);
    await coda.scarta(coda.mie()[0].id);
    expect(coda.rifiutate()).toBe(4);
    expect(await archivio.tutte()).toHaveLength(4);
  });

  it('un 5xx, un 401 o un 429 NON rifiutano: restano da inviare', async () => {
    accedi('u1');
    await coda.registra(nuova());
    await rispondi(conStato(503));
    expect(coda.mie()[0].stato).toBe('DA_INVIARE');
    void coda.invia();
    await rispondi(conStato(401));
    void coda.invia();
    await rispondi(conStato(429));
    expect(coda.mie()[0]).toMatchObject({ stato: 'DA_INVIARE', tentativi: 3 });
  });

  it('403 ferma i tentativi automatici; «Invia ora» riprova una volta', async () => {
    accedi('u1');
    await coda.registra(nuova());
    await rispondi(conStato(403, { message: 'Non sei collegato a un autista.' }));
    expect(coda.bloccata()).toBe('Non sei collegato a un autista.');
    window.dispatchEvent(new Event('online'));
    await flush();
    http.expectNone(URL_RICEVUTE);
    void coda.invia();
    await rispondi(conStato(403, { message: 'Non sei collegato a un autista.' }));
    expect(coda.bloccata()).not.toBeNull();
  });

  it('invia in ordine, una alla volta', async () => {
    accedi('u1');
    const a = await coda.registra(nuova('r1'));
    const b = await coda.registra(nuova('r2'));
    const prima = http.expectOne(URL_RICEVUTE);
    expect(prima.request.body.id).toBe(a.id);
    prima.flush(ok(a.id));
    await flush();
    const seconda = http.expectOne(URL_RICEVUTE);
    expect(seconda.request.body.id).toBe(b.id);
    seconda.flush(ok(b.id));
    await flush();
    expect(coda.daInviare()).toBe(0);
  });

  it('e per utente: quelle di un altro utente non partono col token di chi e entrato', async () => {
    accedi('u1');
    await coda.registra(nuova());
    await rispondi(senzaRete);
    sessione.salvaDaFragment(`#accessToken=${jwt('u2')}&refreshToken=r`);
    expect(coda.mie()).toHaveLength(0);
    expect(coda.diAltriUtenti()).toBe(1);
    await coda.invia();
    http.expectNone(URL_RICEVUTE);
    await coda.scartaDiAltriUtenti();
    expect(await archivio.tutte()).toHaveLength(0);
  });

  it('senza sessione non registra', async () => {
    await expect(coda.registra(nuova())).rejects.toThrow(/Nessuna sessione/);
  });

  it('ripristina dall archivio all avvio e riprende l invio', async () => {
    accedi('u1');
    const r = await coda.registra(nuova());
    await rispondi(senzaRete);
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: ArchivioRicevute, useValue: archivio },
      ],
    });
    http = TestBed.inject(HttpTestingController);
    sessione = TestBed.inject(SessioneService);
    coda = TestBed.inject(CodaRicevute);
    accedi('u1');
    await coda.avvia();
    const req = http.expectOne(URL_RICEVUTE);
    expect(req.request.body.id).toBe(r.id);
    req.flush(ok(r.id));
    await flush();
    expect(coda.daInviare()).toBe(0);
  });

  it('perRitiro elenca solo le ricevute di quel ritiro', async () => {
    accedi('u1');
    await coda.registra(nuova('r1'));
    await coda.registra(nuova('r2'));
    expect(coda.perRitiro('r1')).toHaveLength(1);
    expect(coda.perRitiro('r3')).toHaveLength(0);
    http.match(URL_RICEVUTE);
  });
});
