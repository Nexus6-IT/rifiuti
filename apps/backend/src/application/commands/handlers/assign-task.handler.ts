import { CommandHandler, ICommandHandler } from '@nestjs/cqrs'
import { Logger, Inject } from '@nestjs/common'
import { AssignTaskCommand } from '../assign-task.command'
import { TaskAssignmentService } from '../../services/task-assignment.service'
import { AssignmentResult } from '../../services/task-assignment.service'

/**
 * AssignTaskCommandHandler
 * T187: Handler for User Story 6 - Task Assignment Automation
 *
 * Purpose: Execute task assignment (automatic or manual)
 *
 * Requirements from spec.md FR-029-032:
 * - Automatically route to best qualified driver
 * - Allow manual override with warnings
 * - Create audit trail
 * - Handle assignment errors gracefully
 *
 * Requirements from plan.md:
 * - <10ms assignment decision time
 * - Emit domain events for notifications
 * - Log all assignments for compliance
 */
@CommandHandler(AssignTaskCommand)
export class AssignTaskCommandHandler implements ICommandHandler<AssignTaskCommand> {
  private readonly logger = new Logger(AssignTaskCommandHandler.name)

  constructor(
    @Inject(TaskAssignmentService)
    private readonly taskAssignmentService: TaskAssignmentService
  ) {}

  async execute(command: AssignTaskCommand): Promise<AssignmentResult> {
    this.logger.log(`Assigning FIR ${command.firId} for tenant ${command.tenantId}`)

    let result: AssignmentResult

    if (command.driverId) {
      // Manual assignment
      this.logger.log(
        `Manual assignment to driver ${command.driverId}${command.reason ? `: ${command.reason}` : ''}`
      )

      result = await this.taskAssignmentService.manualAssignTask(
        command.firId,
        command.driverId,
        command.tenantId,
        command.assignedBy
      )

      if (result.warnings && result.warnings.length > 0) {
        this.logger.warn(`Assignment completed with warnings: ${result.warnings.join(', ')}`)
      }
    } else {
      // Automatic assignment
      this.logger.log('Automatic assignment - finding best qualified driver')

      result = await this.taskAssignmentService.autoAssignTask(
        command.firId,
        command.tenantId,
        command.assignedBy
      )

      this.logger.log(`✓ Auto-assigned to driver ${result.assignedDriverId}`)
    }

    // TODO: Emit domain event for notifications
    // await this.eventBus.publish(new TaskAssignedEvent(command.firId, result.assignedDriverId));

    return result
  }
}
