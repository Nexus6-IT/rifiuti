import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { Router, provideRouter } from '@angular/router';
import { AccessoPagina } from './accesso';
import { SessioneService } from '../core/sessione.service';
import { generaNonceAccesso } from '../core/nonce-accesso';

describe('AccessoPagina (ritorno SPID/CIE)', () => {
  let naviga: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    localStorage.clear();
    TestBed.configureTestingModule({
      providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting()],
    });
    naviga = vi.spyOn(TestBed.inject(Router), 'navigateByUrl').mockResolvedValue(true);
  });

  it('con i token e il nonce giusto nel fragment salva la sessione e va al giro', () => {
    const nonce = generaNonceAccesso();
    history.replaceState(
      null,
      '',
      `/#accessToken=aaa&refreshToken=rrr&expiresIn=900&nonce=${nonce}`,
    );
    TestBed.createComponent(AccessoPagina);
    expect(TestBed.inject(SessioneService).accessToken()).toBe('aaa');
    expect(naviga).toHaveBeenCalledWith('/', { replaceUrl: true });
    expect(location.hash).toBe('');
  });

  it.each([
    ['senza nonce nel fragment', ''],
    ['con un nonce sbagliato (link di un malintenzionato)', '&nonce=AAAAAAAAAAAAAAAAAAAAAA'],
  ])('%s: nessuna sessione, torna al login', (_n, extra) => {
    generaNonceAccesso();
    history.replaceState(null, '', `/#accessToken=aaa&refreshToken=rrr&expiresIn=900${extra}`);
    TestBed.createComponent(AccessoPagina);
    expect(TestBed.inject(SessioneService).autenticato()).toBe(false);
    expect(localStorage.getItem('wasteflow.campo.sessione')).toBeNull();
    expect(naviga).toHaveBeenCalledWith('/login', { replaceUrl: true });
    expect(location.hash).toBe('');
  });

  it('senza aver mai passato dal login (nessun nonce ricordato) il link non apre nessuna sessione', () => {
    history.replaceState(
      null,
      '',
      '/#accessToken=aaa&refreshToken=rrr&expiresIn=900&nonce=AbC_def-1234567890xyz1',
    );
    TestBed.createComponent(AccessoPagina);
    expect(TestBed.inject(SessioneService).autenticato()).toBe(false);
  });

  it('il nonce vale una volta: lo stesso link ripetuto non entra', () => {
    const nonce = generaNonceAccesso();
    const frammento = `/#accessToken=aaa&refreshToken=rrr&expiresIn=900&nonce=${nonce}`;
    history.replaceState(null, '', frammento);
    TestBed.createComponent(AccessoPagina);
    TestBed.inject(SessioneService).pulisci();
    history.replaceState(null, '', frammento);
    TestBed.createComponent(AccessoPagina);
    expect(TestBed.inject(SessioneService).autenticato()).toBe(false);
  });

  it('senza fragment valido torna al login', () => {
    history.replaceState(null, '', '/');
    TestBed.createComponent(AccessoPagina);
    expect(TestBed.inject(SessioneService).autenticato()).toBe(false);
    expect(naviga).toHaveBeenCalledWith('/login', { replaceUrl: true });
  });
});
