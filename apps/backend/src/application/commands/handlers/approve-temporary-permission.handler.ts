import { CommandHandler, ICommandHandler } from '@nestjs/cqrs'
import { Logger, Inject, NotFoundException } from '@nestjs/common'
import { ApproveTemporaryPermissionCommand } from '../approve-temporary-permission.command'
import { TemporaryPermissionGrant } from '../../../domain/identity-access/temporary-permission-grant.entity'
import { TemporaryPermissionGrantRepository } from '../../../domain/identity-access/temporary-permission-grant.repository.interface'

@CommandHandler(ApproveTemporaryPermissionCommand)
export class ApproveTemporaryPermissionCommandHandler
  implements ICommandHandler<ApproveTemporaryPermissionCommand>
{
  private readonly logger = new Logger(ApproveTemporaryPermissionCommandHandler.name)

  constructor(
    @Inject('TemporaryPermissionGrantRepository')
    private readonly grantRepository: TemporaryPermissionGrantRepository
  ) {}

  async execute(command: ApproveTemporaryPermissionCommand): Promise<TemporaryPermissionGrant> {
    const grant = await this.grantRepository.findById(command.grantId, command.tenantId)
    if (!grant) {
      throw new NotFoundException('Permission grant not found')
    }

    grant.approve(command.approvedBy, command.reason)
    const saved = await this.grantRepository.save(grant)

    this.logger.log(`✓ Approved grant ${grant.id} for user ${grant.userId}`)
    return saved
  }
}
