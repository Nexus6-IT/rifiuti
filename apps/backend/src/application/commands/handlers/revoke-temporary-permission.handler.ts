import { CommandHandler, ICommandHandler } from '@nestjs/cqrs';
import { Logger, Inject, NotFoundException } from '@nestjs/common';
import { RevokeTemporaryPermissionCommand } from '../revoke-temporary-permission.command';
import { TemporaryPermissionGrant } from '../../../domain/identity-access/temporary-permission-grant.entity';
import { TemporaryPermissionGrantRepository } from '../../../domain/identity-access/temporary-permission-grant.repository.interface';

/**
 * T206: Revoke temporary permission grant handler
 */
@CommandHandler(RevokeTemporaryPermissionCommand)
export class RevokeTemporaryPermissionCommandHandler
  implements ICommandHandler<RevokeTemporaryPermissionCommand>
{
  private readonly logger = new Logger(RevokeTemporaryPermissionCommandHandler.name);

  constructor(
    @Inject('TemporaryPermissionGrantRepository')
    private readonly grantRepository: TemporaryPermissionGrantRepository,
  ) {}

  async execute(command: RevokeTemporaryPermissionCommand): Promise<TemporaryPermissionGrant> {
    const grant = await this.grantRepository.findById(command.grantId, command.tenantId);
    if (!grant) {
      throw new NotFoundException('Permission grant not found');
    }

    grant.revoke(command.revokedBy, command.reason);
    const saved = await this.grantRepository.save(grant);

    this.logger.log(`✓ Revoked grant ${grant.id} for user ${grant.userId}: ${command.reason}`);
    return saved;
  }
}
