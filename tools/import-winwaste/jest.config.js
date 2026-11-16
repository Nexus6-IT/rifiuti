module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/test'],
  testMatch: ['**/*.test.ts'],
  // Il test d'integrazione avvia SQL Server in un container: parte solo con
  // WASTEFLOW_TEST_MSSQL=1 (vedi README). Il timeout copre l'avvio (~60-90 s).
  testTimeout: 300000,
  moduleNameMapper: {
    '^@azure/(identity|keyvault-keys)$': '<rootDir>/test/stub/azure-vuoto.js',
  },
}
