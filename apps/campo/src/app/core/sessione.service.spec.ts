import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { SessioneService, CHIAVE_SESSIONE } from './sessione.service';

describe('SessioneService', () => {
  let servizio: SessioneService;
  let http: HttpTestingController;

  beforeEach(() => {
    localStorage.clear();
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    servizio = TestBed.inject(SessioneService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('parte non autenticato', () => {
    expect(servizio.autenticato()).toBe(false);
    expect(servizio.accessToken()).toBeNull();
  });

  it('salva i token dal fragment del ritorno SPID e diventa autenticato', () => {
    const ok = servizio.salvaDaFragment('#accessToken=aaa&refreshToken=rrr&expiresIn=900');
    expect(ok).toBe(true);
    expect(servizio.autenticato()).toBe(true);
    expect(servizio.accessToken()).toBe('aaa');
    expect(JSON.parse(localStorage.getItem(CHIAVE_SESSIONE)!).refreshToken).toBe('rrr');
  });

  it.each(['', '#', '#accessToken=aaa', '#refreshToken=rrr', '#accessToken=&refreshToken='])(
    'rifiuta un fragment incompleto %p',
    (frammento) => {
      expect(servizio.salvaDaFragment(frammento)).toBe(false);
      expect(servizio.autenticato()).toBe(false);
    },
  );

  it('ripristina la sessione salvata (refresh di 30 giorni: sopravvive alla chiusura)', () => {
    servizio.salvaDaFragment('#accessToken=aaa&refreshToken=rrr&expiresIn=900');
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    expect(TestBed.inject(SessioneService).autenticato()).toBe(true);
  });

  it('ignora un contenuto salvato non valido', () => {
    localStorage.setItem(CHIAVE_SESSIONE, '{non json');
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    expect(TestBed.inject(SessioneService).autenticato()).toBe(false);
  });

  it('rinnova: una sola chiamata anche con richieste concorrenti', () => {
    servizio.salvaDaFragment('#accessToken=vecchio&refreshToken=rrr&expiresIn=900');
    const visti: string[] = [];
    servizio.rinnova().subscribe((t) => visti.push(t));
    servizio.rinnova().subscribe((t) => visti.push(t));
    const req = http.expectOne('/api/v1/auth/refresh');
    expect(req.request.body).toEqual({ refreshToken: 'rrr' });
    req.flush({ accessToken: 'nuovo', expiresIn: 900 });
    expect(visti).toEqual(['nuovo', 'nuovo']);
    expect(servizio.accessToken()).toBe('nuovo');
  });

  it('rinnova rifiutato (401): la sessione viene cancellata', () => {
    servizio.salvaDaFragment('#accessToken=a&refreshToken=r&expiresIn=900');
    let errore: unknown;
    servizio.rinnova().subscribe({ error: (e) => (errore = e) });
    http.expectOne('/api/v1/auth/refresh').flush({}, { status: 401, statusText: 'Unauthorized' });
    expect(errore).toBeTruthy();
    expect(servizio.autenticato()).toBe(false);
    expect(localStorage.getItem(CHIAVE_SESSIONE)).toBeNull();
  });

  it('rinnova senza rete (status 0): la sessione resta, per riprovare', () => {
    servizio.salvaDaFragment('#accessToken=a&refreshToken=r&expiresIn=900');
    servizio.rinnova().subscribe({ error: () => undefined });
    http.expectOne('/api/v1/auth/refresh').error(new ProgressEvent('error'));
    expect(servizio.autenticato()).toBe(true);
  });

  it('esci: chiama il logout col refresh token e cancella la sessione anche se fallisce', () => {
    servizio.salvaDaFragment('#accessToken=a&refreshToken=r&expiresIn=900');
    servizio.esci().subscribe();
    const req = http.expectOne('/api/v1/auth/logout');
    expect(req.request.body).toEqual({ refreshToken: 'r' });
    req.flush({}, { status: 500, statusText: 'KO' });
    expect(servizio.autenticato()).toBe(false);
    expect(localStorage.getItem(CHIAVE_SESSIONE)).toBeNull();
  });
});
