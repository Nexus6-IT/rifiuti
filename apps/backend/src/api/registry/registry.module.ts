/**
 * Registry Module
 * Provides Registry functionality (Produttori, Trasportatori, Destinatari)
 */

import { Module } from '@nestjs/common'
import { RegistryController } from './registry.controller'
import { PrismaModule } from '../../infrastructure/persistence/prisma.module'

// Produttori Use Cases
import { CreateProduttoreUseCase } from '../../application/registry/use-cases/create-produttore.use-case'
import { ListProduttoriUseCase } from '../../application/registry/use-cases/list-produttori.use-case'
import { GetProduttoreUseCase } from '../../application/registry/use-cases/get-produttore.use-case'
import { UpdateProduttoreUseCase } from '../../application/registry/use-cases/update-produttore.use-case'
import { DeleteProduttoreUseCase } from '../../application/registry/use-cases/delete-produttore.use-case'

// Trasportatori Use Cases
import { CreateTrasportatoreUseCase } from '../../application/registry/use-cases/create-trasportatore.use-case'
import { ListTrasportatoriUseCase } from '../../application/registry/use-cases/list-trasportatori.use-case'
import { GetTrasportatoreUseCase } from '../../application/registry/use-cases/get-trasportatore.use-case'
import { UpdateTrasportatoreUseCase } from '../../application/registry/use-cases/update-trasportatore.use-case'
import { DeleteTrasportatoreUseCase } from '../../application/registry/use-cases/delete-trasportatore.use-case'

// Destinatari Use Cases
import { CreateDestinatarioUseCase } from '../../application/registry/use-cases/create-destinatario.use-case'
import { ListDestinatariUseCase } from '../../application/registry/use-cases/list-destinatari.use-case'
import { GetDestinatarioUseCase } from '../../application/registry/use-cases/get-destinatario.use-case'
import { UpdateDestinatarioUseCase } from '../../application/registry/use-cases/update-destinatario.use-case'
import { DeleteDestinatarioUseCase } from '../../application/registry/use-cases/delete-destinatario.use-case'

// Repositories
import { ProduttorePrismaRepository } from '../../infrastructure/persistence/produttore-prisma.repository'
import { TrasportatorePrismaRepository } from '../../infrastructure/persistence/trasportatore-prisma.repository'
import { DestinatarioPrismaRepository } from '../../infrastructure/persistence/destinatario-prisma.repository'
import { PRODUTTORE_REPOSITORY } from '../../domain/registry/repositories/produttore.repository'
import { TRASPORTATORE_REPOSITORY } from '../../domain/registry/repositories/trasportatore.repository'
import { DESTINATARIO_REPOSITORY } from '../../domain/registry/repositories/destinatario.repository'

@Module({
  imports: [PrismaModule],
  controllers: [RegistryController],
  providers: [
    // Produttori Use Cases
    CreateProduttoreUseCase,
    ListProduttoriUseCase,
    GetProduttoreUseCase,
    UpdateProduttoreUseCase,
    DeleteProduttoreUseCase,

    // Trasportatori Use Cases
    CreateTrasportatoreUseCase,
    ListTrasportatoriUseCase,
    GetTrasportatoreUseCase,
    UpdateTrasportatoreUseCase,
    DeleteTrasportatoreUseCase,

    // Destinatari Use Cases
    CreateDestinatarioUseCase,
    ListDestinatariUseCase,
    GetDestinatarioUseCase,
    UpdateDestinatarioUseCase,
    DeleteDestinatarioUseCase,

    // Repositories
    {
      provide: PRODUTTORE_REPOSITORY,
      useClass: ProduttorePrismaRepository,
    },
    {
      provide: TRASPORTATORE_REPOSITORY,
      useClass: TrasportatorePrismaRepository,
    },
    {
      provide: DESTINATARIO_REPOSITORY,
      useClass: DestinatarioPrismaRepository,
    },
  ],
})
export class RegistryModule {}
