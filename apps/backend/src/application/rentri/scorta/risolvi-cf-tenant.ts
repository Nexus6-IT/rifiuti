import { PrismaService } from '../../../infrastructure/persistence/prisma.service'
import { DomainException } from '../../../domain/shared/domain-exception'

/**
 * Risolve il codice fiscale del tenant, obbligatorio per interrogare
 * `vidimazione-formulari` (`identificativo`/`identificativo_soggetto`).
 * Stesso pattern fail-closed già in uso in
 * `GetAzioniDisponibiliUseCase`/`CercaFormulariRENTRIUseCase`: non
 * duplicato lì, riusato qui per i nuovi use case della scorta (R6).
 */
export async function risolviCfTenant(prisma: PrismaService, tenantId: string): Promise<string> {
  const tenant = await prisma.tenant.findUnique({
    where: { id: tenantId },
    select: { codiceFiscale: true },
  })

  if (!tenant?.codiceFiscale) {
    throw DomainException.businessRuleViolation(
      'CF_TENANT_MANCANTE',
      "Codice fiscale dell'azienda non configurato: impossibile interrogare i blocchi virtuali RENTRI. " +
        'Configuralo nei dati anagrafici del tenant.'
    )
  }

  return tenant.codiceFiscale
}
