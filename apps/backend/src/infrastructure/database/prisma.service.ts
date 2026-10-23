/**
 * Re-export di compatibilita': esiste UN SOLO PrismaService, quello di
 * `infrastructure/persistence` (client base + vista `db` con l'estensione RLS).
 * Due classi volevano dire due istanze e due pool di connessioni.
 */
export { PrismaService } from '../persistence/prisma.service'
