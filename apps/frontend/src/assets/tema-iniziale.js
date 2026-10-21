/*
 * Applica il tema chiaro/scuro PRIMA che Angular parta, per evitare che chi
 * usa la modalità scura veda un lampo di pagina chiara a ogni caricamento.
 * Stessa regola di src/app/core/services/tema.service.ts (chiave `wf_tema`,
 * file `tema-primeng-<chiaro|scuro>.css`): se cambi l'una, cambia l'altro.
 * File esterno e non inline perché la CSP ha `script-src 'self'`.
 */
;(function () {
  var preferenza = null
  try {
    preferenza = localStorage.getItem('wf_tema')
  } catch (e) {
    // storage non disponibile: si segue il sistema
  }
  var scuro =
    preferenza === 'scuro' ||
    (preferenza !== 'chiaro' &&
      !!window.matchMedia &&
      window.matchMedia('(prefers-color-scheme: dark)').matches)
  document.documentElement.setAttribute('data-theme', scuro ? 'dark' : 'light')
  var link = document.getElementById('tema-primeng')
  if (link) link.setAttribute('href', scuro ? 'tema-primeng-scuro.css' : 'tema-primeng-chiaro.css')
})()
