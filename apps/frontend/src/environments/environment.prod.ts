export const environment = {
  production: true,
  apiUrl: '/api/v1',
  keycloakUrl: '', // Set via environment variable in deployment
  keycloakRealm: 'wasteflow',
  keycloakClientId: 'wasteflow-frontend',
  enableDebugMode: false,
  logLevel: 'error',
  // Error tracking Bugsink (progetto `wasteflow`, id 5). Il DSN di un SDK
  // browser e' pubblico per natura: finisce comunque nel bundle servito e la
  // chiave consente solo di INVIARE eventi, non di leggerli. Passa da nginx
  // (error.ignicraft.com) perche' il browser non vede la rete Docker interna;
  // il dominio e' ammesso in `connect-src` della CSP (apps/frontend/nginx.conf).
  sentryDsn: 'https://2984d941301d407880591312845e7049@error.ignicraft.com/5',
}
