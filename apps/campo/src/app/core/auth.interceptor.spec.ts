import { TestBed } from '@angular/core/testing';
import { HttpClient, provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { Router, provideRouter } from '@angular/router';
import { authInterceptor } from './auth.interceptor';
import { SessioneService } from './sessione.service';

describe('authInterceptor', () => {
  let http: HttpClient;
  let ctrl: HttpTestingController;
  let sessione: SessioneService;
  let router: Router;

  beforeEach(() => {
    localStorage.clear();
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        provideHttpClient(withInterceptors([authInterceptor])),
        provideHttpClientTesting(),
      ],
    });
    http = TestBed.inject(HttpClient);
    ctrl = TestBed.inject(HttpTestingController);
    sessione = TestBed.inject(SessioneService);
    router = TestBed.inject(Router);
    sessione.salvaDaFragment('#accessToken=aaa&refreshToken=rrr&expiresIn=900');
  });
  afterEach(() => ctrl.verify());

  it('aggiunge il Bearer alle chiamate /api/', () => {
    http.get('/api/v1/campo/giro').subscribe();
    expect(ctrl.expectOne('/api/v1/campo/giro').request.headers.get('Authorization')).toBe(
      'Bearer aaa',
    );
  });

  it('non aggiunge il Bearer fuori da /api/ né sul refresh', () => {
    http.get('/altro').subscribe();
    expect(ctrl.expectOne('/altro').request.headers.has('Authorization')).toBe(false);
    http.post('/api/v1/auth/refresh', {}).subscribe();
    expect(ctrl.expectOne('/api/v1/auth/refresh').request.headers.has('Authorization')).toBe(false);
  });

  it('su 401 rinnova il token e ritenta una volta', () => {
    let esito: unknown;
    http.get('/api/v1/campo/giro').subscribe((r) => (esito = r));
    ctrl.expectOne('/api/v1/campo/giro').flush({}, { status: 401, statusText: 'No' });
    ctrl.expectOne('/api/v1/auth/refresh').flush({ accessToken: 'bbb', expiresIn: 900 });
    const ritento = ctrl.expectOne('/api/v1/campo/giro');
    expect(ritento.request.headers.get('Authorization')).toBe('Bearer bbb');
    ritento.flush({ ok: 1 });
    expect(esito).toEqual({ ok: 1 });
  });

  it('se anche il ritento è 401 (sessione superata da un altro accesso) esce e va al login', () => {
    const naviga = vi.spyOn(router, 'navigate').mockResolvedValue(true);
    let errore: unknown;
    http.get('/api/v1/campo/giro').subscribe({ error: (e) => (errore = e) });
    ctrl.expectOne('/api/v1/campo/giro').flush({}, { status: 401, statusText: 'No' });
    ctrl.expectOne('/api/v1/auth/refresh').flush({ accessToken: 'bbb', expiresIn: 900 });
    ctrl.expectOne('/api/v1/campo/giro').flush({}, { status: 401, statusText: 'No' });
    expect(errore).toBeTruthy();
    expect(sessione.autenticato()).toBe(false);
    expect(naviga).toHaveBeenCalledWith(['/login']);
  });

  it('se il refresh è rifiutato va al login', () => {
    const naviga = vi.spyOn(router, 'navigate').mockResolvedValue(true);
    http.get('/api/v1/campo/giro').subscribe({ error: () => undefined });
    ctrl.expectOne('/api/v1/campo/giro').flush({}, { status: 401, statusText: 'No' });
    ctrl.expectOne('/api/v1/auth/refresh').flush({}, { status: 401, statusText: 'No' });
    expect(naviga).toHaveBeenCalledWith(['/login']);
  });

  it('gli altri errori (403, 500) passano senza rinnovo', () => {
    let stato = 0;
    http.get('/api/v1/campo/giro').subscribe({ error: (e) => (stato = e.status) });
    ctrl.expectOne('/api/v1/campo/giro').flush({}, { status: 403, statusText: 'No' });
    expect(stato).toBe(403);
    expect(sessione.autenticato()).toBe(true);
  });
});
