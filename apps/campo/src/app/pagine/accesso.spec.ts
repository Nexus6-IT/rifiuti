import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { Router, provideRouter } from '@angular/router';
import { AccessoPagina } from './accesso';
import { SessioneService } from '../core/sessione.service';

describe('AccessoPagina (ritorno SPID/CIE)', () => {
  let naviga: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    localStorage.clear();
    TestBed.configureTestingModule({
      providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting()],
    });
    naviga = vi.spyOn(TestBed.inject(Router), 'navigateByUrl').mockResolvedValue(true);
  });

  it('con i token nel fragment salva la sessione e va al giro', () => {
    history.replaceState(null, '', '/#accessToken=aaa&refreshToken=rrr&expiresIn=900');
    TestBed.createComponent(AccessoPagina);
    expect(TestBed.inject(SessioneService).accessToken()).toBe('aaa');
    expect(naviga).toHaveBeenCalledWith('/', { replaceUrl: true });
    expect(location.hash).toBe('');
  });

  it('senza fragment valido torna al login', () => {
    history.replaceState(null, '', '/');
    TestBed.createComponent(AccessoPagina);
    expect(TestBed.inject(SessioneService).autenticato()).toBe(false);
    expect(naviga).toHaveBeenCalledWith('/login', { replaceUrl: true });
  });
});
