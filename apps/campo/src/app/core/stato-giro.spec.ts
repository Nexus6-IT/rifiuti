import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { ArchivioGiro } from './archivio-giro';
import { ArchivioGiroMemoria } from './archivio-giro.memoria';
import { StatoGiro } from './stato-giro';
import { GiroService } from './giro.service';

describe('StatoGiro (indicatore)', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: ArchivioGiro, useValue: new ArchivioGiroMemoria() },
      ],
    });
  });

  it('mostra sempre l ultimo aggiornamento e, se i dati sono dello snapshot, il banner offline', () => {
    const g = TestBed.inject(GiroService);
    g.impostaDaArchivio(
      { data: 'd', autista: { id: 'a', nome: 'M', cognome: 'B' }, ritiri: [] },
      new Date(2026, 10, 20, 7, 5).toISOString(),
    );
    const f = TestBed.createComponent(StatoGiro);
    f.detectChanges();
    const el = f.nativeElement as HTMLElement;
    expect(el.querySelector('[data-testid="aggiornato"]')?.textContent).toContain('20/11 07:05');
    expect(el.querySelector('[data-testid="offline"]')?.textContent).toContain(
      'server non raggiungibile',
    );
  });

  it('senza rete del browser il banner dice Offline', () => {
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    const f = TestBed.createComponent(StatoGiro);
    f.detectChanges();
    expect(
      (f.nativeElement as HTMLElement).querySelector('[data-testid="offline"]')?.textContent,
    ).toContain('Offline');
    vi.restoreAllMocks();
  });

  it('con dati freschi: nessun banner offline, ora visibile', () => {
    const g = TestBed.inject(GiroService);
    g.impostaFresco(
      { data: 'd', autista: { id: 'a', nome: 'M', cognome: 'B' }, ritiri: [] },
      new Date(2026, 10, 20, 9, 30).toISOString(),
    );
    const f = TestBed.createComponent(StatoGiro);
    f.detectChanges();
    const el = f.nativeElement as HTMLElement;
    expect(el.querySelector('[data-testid="offline"]')).toBeNull();
    expect(el.querySelector('[data-testid="aggiornato"]')?.textContent).toContain('20/11 09:30');
  });
});
