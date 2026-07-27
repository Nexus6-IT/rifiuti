// Configurazione Karma esplicita.
//
// PERCHE' ESISTE QUESTO FILE: la configurazione inline in `angular.json` usa i
// timeout predefiniti di Karma, che su una macchina carica non bastano. Il
// sintomo osservato il 2026-07-27 e' stato «ChromeHeadless … Disconnected …
// ping timeout»: il browser si aggancia e poi viene dichiarato morto perche'
// non risponde entro 2 secondi — non perche' un test fallisca, ma perche' il
// processo non ha ricevuto CPU abbastanza a lungo.
//
// E' una diagnosi che costa tempo, perche' si presenta travestita da difetto
// del codice appena scritto. I valori sotto danno al browser un margine
// realistico su una macchina che sta anche compilando e girando altre suite.
module.exports = function (config) {
  config.set({
    basePath: '',
    frameworks: ['jasmine', '@angular-devkit/build-angular'],
    plugins: [
      require('karma-jasmine'),
      require('karma-chrome-launcher'),
      require('karma-jasmine-html-reporter'),
      require('karma-coverage'),
      require('@angular-devkit/build-angular/plugins/karma'),
    ],
    client: {
      jasmine: {},
      clearContext: false,
    },
    reporters: ['progress', 'kjhtml'],
    browsers: ['ChromeHeadless'],
    restartOnFileChange: true,

    // --- Margini sui tempi (v. commento di testata) ---
    /** Quanto attendere che il browser si agganci dopo il lancio. Default 60s. */
    captureTimeout: 180000,
    /** Silenzio tollerato durante l'esecuzione prima di dichiarare il browser morto. Default 30s. */
    browserNoActivityTimeout: 180000,
    /** Attesa di risposta al ping. Il default di 2s e' la causa diretta dei "ping timeout". */
    pingTimeout: 60000,
    /** Attesa della disconnessione pulita prima di considerarla un errore. */
    browserDisconnectTimeout: 30000,
    /** Quante disconnessioni tollerare prima di arrendersi. */
    browserDisconnectTolerance: 2,
  })
}
