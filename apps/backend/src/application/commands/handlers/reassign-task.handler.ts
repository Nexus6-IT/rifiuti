import { CommandHandler, ICommandHandler } from '@nestjs/cqrs'
import { Logger, Inject, BadRequestException } from '@nestjs/common'
import { ReassignTaskCommand } from '../reassign-task.command'
import { TaskAssignmentService } from '../../services/task-assignment.service'
import { AssignmentResult } from '../../services/task-assignment.service'

/**
 * ReassignTaskCommandHandler
 * T189: Handler for User Story 6 - Task Assignment Automation
 *
 * Purpose: Execute task reassignment with audit trail
 *
 * Requirements from spec.md FR-029-032:
 * - Validate reason is provided
 * - Check new driver qualifications
 * - Create audit trail with previous driver info
 * - Emit events for notifications
 *
 * Requirements from plan.md:
 * - Prevent reassignment to same driver
 * - Update workload calculations
 * - Log reassignment for compliance
 */
@CommandHandler(ReassignTaskCommand)
export class ReassignTaskCommandHandler implements ICommandHandler<ReassignTaskCommand> {
  private readonly logger = new Logger(ReassignTaskCommandHandler.name)

  constructor(
    @Inject(TaskAssignmentService)
    private readonly taskAssignmentService: TaskAssignmentService
  ) {}

  async execute(command: ReassignTaskCommand): Promise<AssignmentResult> {
    // Validate reason is provided
    if (!command.reason || command.reason.trim() === '') {
      throw new BadRequestException('Reason is required for task reassignment')
    }

    this.logger.log(
      `Reassigning FIR ${command.firId} to driver ${command.newDriverId}: ${command.reason}`
    )

    const result = await this.taskAssignmentService.reassignTask(
      command.firId,
      command.newDriverId,
      command.tenantId,
      command.reassignedBy,
      command.reason
    )

    this.logger.log(
      `✓ Reassigned from driver ${result.previousDriverId} to ${result.assignedDriverId}`
    )

    if (result.warnings && result.warnings.length > 0) {
      this.logger.warn(`Reassignment completed with warnings: ${result.warnings.join(', ')}`)
    }

    // TODO: Emit domain events for notifications
    // await this.eventBus.publish(new TaskReassignedEvent(
    //   command.firId,
    //   result.previousDriverId,
    //   result.assignedDriverId,
    //   command.reason
    // ));

    return result
  }
}
