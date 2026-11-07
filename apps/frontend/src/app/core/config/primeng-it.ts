import { PrimeNGConfig, Translation } from 'primeng/api'

/**
 * Testi di PrimeNG in italiano (calendario, filtri, upload). Senza, `p-calendar` mostra
 * «November» e «Su Mo Tu» anche in un'app tutta italiana. Una sola configurazione globale,
 * applicata all'avvio con `APP_INITIALIZER` (vedi app.config.ts).
 */
export const TRADUZIONE_PRIMENG_IT: Translation = {
  firstDayOfWeek: 1,
  dayNames: ['domenica', 'lunedì', 'martedì', 'mercoledì', 'giovedì', 'venerdì', 'sabato'],
  dayNamesShort: ['dom', 'lun', 'mar', 'mer', 'gio', 'ven', 'sab'],
  dayNamesMin: ['D', 'L', 'M', 'M', 'G', 'V', 'S'],
  monthNames: [
    'gennaio',
    'febbraio',
    'marzo',
    'aprile',
    'maggio',
    'giugno',
    'luglio',
    'agosto',
    'settembre',
    'ottobre',
    'novembre',
    'dicembre',
  ],
  monthNamesShort: [
    'gen',
    'feb',
    'mar',
    'apr',
    'mag',
    'giu',
    'lug',
    'ago',
    'set',
    'ott',
    'nov',
    'dic',
  ],
  dateFormat: 'dd/mm/yy',
  today: 'Oggi',
  clear: 'Cancella',
  weekHeader: 'Sett.',
  accept: 'Sì',
  reject: 'No',
  choose: 'Scegli',
  upload: 'Carica',
  cancel: 'Annulla',
  emptyMessage: 'Nessun risultato',
  emptyFilterMessage: 'Nessun risultato',
}

export function applicaTraduzionePrimeng(config: PrimeNGConfig): void {
  config.setTranslation(TRADUZIONE_PRIMENG_IT)
}
