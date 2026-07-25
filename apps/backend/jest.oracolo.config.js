const base = require('./jest.config')

/**
 * Configurazione per i test di INTEGRAZIONE contro la fake API RENTRI
 * (`tools/rentri-fake`), esclusi dalla suite unitaria.
 *
 * Perche' separati: fanno require del sorgente della fake, quindi hanno
 * bisogno delle sue dipendenze (fastify, jose, node-forge, jszip). `tools/*`
 * non e' un workspace npm, percio' `npm ci` alla radice non le installa: in
 * CI quelle suite non partirebbero affatto. Vanno eseguite in un passo
 * dedicato, dopo aver installato la fake.
 *
 * Niente soglia di coverage qui: la misura di riferimento resta quella della
 * suite unitaria.
 */
module.exports = {
  ...base,
  testPathIgnorePatterns: [],
  testRegex: '.*\\.oracolo\\.spec\\.ts$',
  coverageThreshold: undefined,
}
