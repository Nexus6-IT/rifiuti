/**
 * Re-export di compatibilita': il PrismaModule globale e' uno solo, quello di
 * `infrastructure/persistence`. Importarlo da qui o da li' da' lo stesso modulo
 * e quindi la stessa istanza di PrismaService.
 */
export { PrismaModule } from '../persistence/prisma.module'
