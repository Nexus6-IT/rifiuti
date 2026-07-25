module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/test'],
  testMatch: ['**/*.test.ts'],
  clearMocks: true,
  // Ogni token di prova comporta la generazione di una coppia RSA 2048 (la CA
  // e' memoizzata, i certificati foglia no): con il timeout Jest di default a
  // 5 s la suite passa in locale ma cede sotto carico. Un audit ha osservato
  // 3 fallimenti su 62 per timeout in una esecuzione a freddo: il verde non
  // e' prova se dipende dalla velocita' della macchina.
  testTimeout: 30000,
}
