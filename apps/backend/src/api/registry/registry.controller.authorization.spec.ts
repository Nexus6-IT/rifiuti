import { RegistryController } from './registry.controller'

/**
 * L'elenco dei ruoli che possono scrivere le anagrafiche vive in DUE posti:
 * qui (`@Roles` sulle rotte di scrittura del `RegistryController`) e in
 * `apps/frontend/src/app/features/registry/registry-permissions.ts`
 * (`puoGestireAnagrafiche`), che decide se mostrare pulsanti e azioni di riga
 * senza poter interrogare il backend. Nulla li teneva allineati: un ruolo
 * aggiunto o tolto qui non faceva diventare rosso nulla, e l'interfaccia
 * diventava silenziosamente piu' restrittiva o piu' permissiva. Questo test
 * blocca esattamente quello scarto — se lo tocchi, aggiorna anche
 * `registry-permissions.ts` (o viceversa).
 *
 * Stesso metodo di `reference-data.controller.spec.ts`: si leggono i
 * metadati `@Roles` via `Reflect.getMetadata`, non si chiama l'endpoint.
 */
describe('RegistryController — autorizzazione allineata al frontend', () => {
  const rolesDelMetodo = (metodo: string): string[] | undefined =>
    Reflect.getMetadata(
      'roles',
      (RegistryController.prototype as unknown as Record<string, unknown>)[metodo] as object
    )

  const RUOLI_ATTESI = ['SUPER_ADMIN', 'ADMIN', 'OPERATOR']

  it.each([
    'createProduttore',
    'updateProduttore',
    'deleteProduttore',
    'createTrasportatore',
    'updateTrasportatore',
    'deleteTrasportatore',
    'createDestinatario',
    'updateDestinatario',
    'deleteDestinatario',
  ])('%s richiede esattamente SUPER_ADMIN, ADMIN, OPERATOR', metodo => {
    expect(rolesDelMetodo(metodo)).toEqual(RUOLI_ATTESI)
  })
})
