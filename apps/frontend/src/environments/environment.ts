export const environment = {
  production: false,
  apiUrl: 'http://localhost:3000/api/v1',
  keycloakUrl: 'http://localhost:8080',
  keycloakRealm: 'wasteflow',
  keycloakClientId: 'wasteflow-frontend',
  enableDebugMode: true,
  logLevel: 'debug',
  // Error tracking: lascia vuoto in sviluppo (no-op). In produzione imposta
  // il DSN Bugsink nel file environment.prod.ts o iniettalo a build-time.
  sentryDsn: '',
};
