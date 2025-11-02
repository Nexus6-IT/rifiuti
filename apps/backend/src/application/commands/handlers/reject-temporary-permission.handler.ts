import { CommandHandler, ICommandHandler } from '@nestjs/cqrs';
import { Logger, Inject, NotFoundException } from '@nestjs/common';
import { RejectTemporaryPermissionCommand } from '../reject-temporary-permission.command';
import { TemporaryPermissionGrant } from '../../../domain/identity-access/temporary-permission-grant.entity';
import { TemporaryPermissionGrantRepository } from '../../../domain/identity-access/temporary-permission-grant.repository.interface';

/**
 * T204: Reject temporary permission grant handler
 */
@CommandHandler(RejectTemporaryPermissionCommand)
export class RejectTemporaryPermissionCommandHandler
  implements ICommandHandler<RejectTemporaryPermissionCommand>
{
  private readonly logger = new Logger(RejectTemporaryPermissionCommandHandler.name);

  constructor(
    @Inject('TemporaryPermissionGrantRepository')
    private readonly grantRepository: TemporaryPermissionGrantRepository,
  ) {}

  async execute(command: RejectTemporaryPermissionCommand): Promise<TemporaryPermissionGrant> {
    const grant = await this.grantRepository.findById(command.grantId, command.tenantId);
    if (!grant) {
      throw new NotFoundException('Permission grant not found');
    }

    grant.reject(command.rejectedBy, command.reason);
    const saved = await this.grantRepository.save(grant);

    this.logger.log(`✓ Rejected grant ${grant.id} for user ${grant.userId}: ${command.reason}`);
    return saved;
  }
}
