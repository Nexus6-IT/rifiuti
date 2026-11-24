import { formattaAggiornamento } from './formato';

describe('formattaAggiornamento', () => {
  it('mostra giorno e ora locali', () => {
    const iso = new Date(2026, 10, 20, 7, 5).toISOString();
    expect(formattaAggiornamento(iso)).toBe('20/11 07:05');
  });
  it('data non valida: trattino', () => {
    expect(formattaAggiornamento('boh')).toBe('—');
  });
});
