import { CommandHandler, ICommandHandler } from '@nestjs/cqrs'
import { Logger, Inject, BadRequestException } from '@nestjs/common'
import { RequestTemporaryPermissionCommand } from '../request-temporary-permission.command'
import { TemporaryPermissionGrant } from '../../../domain/identity-access/temporary-permission-grant.entity'
import { TemporaryPermissionGrantRepository } from '../../../domain/identity-access/temporary-permission-grant.repository.interface'

/**
 * RequestTemporaryPermissionCommandHandler
 * T200: Handler for User Story 7 - Temporary Permission Requests
 */
@CommandHandler(RequestTemporaryPermissionCommand)
export class RequestTemporaryPermissionCommandHandler
  implements ICommandHandler<RequestTemporaryPermissionCommand>
{
  private readonly logger = new Logger(RequestTemporaryPermissionCommandHandler.name)

  constructor(
    @Inject('TemporaryPermissionGrantRepository')
    private readonly grantRepository: TemporaryPermissionGrantRepository
  ) {}

  async execute(command: RequestTemporaryPermissionCommand): Promise<TemporaryPermissionGrant> {
    this.logger.log(
      `User ${command.userId} requesting ${command.permissions.length} temporary permissions`
    )

    // Check for overlapping grants
    const hasOverlap = await this.grantRepository.hasOverlappingGrant(
      command.userId,
      command.tenantId,
      command.permissions,
      command.startTime,
      command.endTime
    )

    if (hasOverlap) {
      throw new BadRequestException(
        'You already have an overlapping permission grant for this time period'
      )
    }

    // Create grant
    const grant = TemporaryPermissionGrant.create({
      userId: command.userId,
      tenantId: command.tenantId,
      permissions: command.permissions,
      startTime: command.startTime,
      endTime: command.endTime,
      justification: command.justification,
      requestedBy: command.userId,
    })

    // Save
    const saved = await this.grantRepository.save(grant)

    this.logger.log(`✓ Permission grant ${saved.id} created - status: pending`)

    return saved
  }
}
