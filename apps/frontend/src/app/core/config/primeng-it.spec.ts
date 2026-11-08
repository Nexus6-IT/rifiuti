import { TestBed } from '@angular/core/testing'
import { PrimeNGConfig } from 'primeng/api'
import { TRADUZIONE_PRIMENG_IT, applicaTraduzionePrimeng } from './primeng-it'

describe('traduzione italiana di PrimeNG', () => {
  it('ha mesi, giorni e testi del calendario in italiano, con la settimana che inizia di lunedi', () => {
    expect(TRADUZIONE_PRIMENG_IT.monthNames?.[10]).toBe('novembre')
    expect(TRADUZIONE_PRIMENG_IT.monthNames?.length).toBe(12)
    expect(TRADUZIONE_PRIMENG_IT.dayNamesMin).toEqual(['D', 'L', 'M', 'M', 'G', 'V', 'S'])
    expect(TRADUZIONE_PRIMENG_IT.dayNames?.[1]).toBe('lunedì')
    expect(TRADUZIONE_PRIMENG_IT.firstDayOfWeek).toBe(1)
    expect(TRADUZIONE_PRIMENG_IT.today).toBe('Oggi')
    expect(TRADUZIONE_PRIMENG_IT.clear).toBe('Cancella')
    expect(TRADUZIONE_PRIMENG_IT.dateFormat).toBe('dd/mm/yy')
  })

  it("applicaTraduzionePrimeng la imposta sulla configurazione dell'app", () => {
    const config = TestBed.inject(PrimeNGConfig)
    applicaTraduzionePrimeng(config)
    expect(config.getTranslation('monthNames')[0]).toBe('gennaio')
    expect(config.getTranslation('firstDayOfWeek')).toBe(1)
  })

  it('non lascia nessuna etichetta ARIA, del calendario o del paginatore, in inglese', () => {
    const config = TestBed.inject(PrimeNGConfig)
    applicaTraduzionePrimeng(config)
    const t = config.translation
    // Ogni chiave `aria` che PrimeNG ha di serie ha la sua versione italiana, diversa dall'originale.
    const predefinite = new PrimeNGConfig().translation.aria ?? {}
    const aria = t.aria ?? {}
    for (const chiave of Object.keys(predefinite) as (keyof typeof predefinite)[]) {
      expect(aria[chiave]).withContext(`aria.${chiave}`).toBeTruthy()
      if (!/^\{[a-zA-Z]+\}$/.test(predefinite[chiave] ?? '')) {
        expect(aria[chiave]).withContext(`aria.${chiave}`).not.toBe(predefinite[chiave])
      }
    }
    expect(t.chooseDate).toBe('Scegli la data')
    expect(t.prevMonth).toBe('Mese precedente')
    expect(t.nextMonth).toBe('Mese successivo')
    expect(aria.firstPageLabel).toBe('Prima pagina')
    expect(aria.rowsPerPageLabel).toBe('Righe per pagina')
    expect(aria.close).toBe('Chiudi')
    expect(aria.pageLabel).toBe('Pagina {page}')
  })
})
