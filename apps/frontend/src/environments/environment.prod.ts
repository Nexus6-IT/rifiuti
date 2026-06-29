export const environment = {
  production: true,
  apiUrl: '/api/v1',
  keycloakUrl: '',  // Set via environment variable in deployment
  keycloakRealm: 'wasteflow',
  keycloakClientId: 'wasteflow-frontend',
  enableDebugMode: false,
  logLevel: 'error',
  // Error tracking Bugsink: sostituire con DSN reale al build-time.
  // ATTIVARE: sed -i "s|sentryDsn: ''|sentryDsn: 'http://...@bugsink:8000/N'|" prima di ng build.
  sentryDsn: '',
};
