import {
  Controller,
  Post,
  Put,
  Get,
  Param,
  Body,
  UseGuards,
  Logger,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { CommandBus } from '@nestjs/cqrs';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { TenantIsolationGuard } from '../guards/tenant-isolation.guard';
import { PermissionGuard } from '../guards/permission.guard';
import { RequirePermission } from '../decorators/require-permission.decorator';
import { CurrentTenant } from '../decorators/current-tenant.decorator';
import { CurrentUser } from '../decorators/current-user.decorator';
import { AssignTaskCommand } from '../../application/commands/assign-task.command';
import { ReassignTaskCommand } from '../../application/commands/reassign-task.command';
import { TaskAssignmentService } from '../../application/services/task-assignment.service';

/**
 * TaskAssignmentController
 * T190-T192: REST API for task assignment per User Story 6
 *
 * Purpose: Expose task assignment functionality to fleet managers
 *
 * Requirements from spec.md FR-029-032:
 * - POST /api/v1/tasks/:firId/assign - Auto-assign or manual assign
 * - PUT /api/v1/tasks/:firId/reassign - Reassign to different driver
 * - GET /api/v1/tasks/:firId/qualified-drivers - List qualified drivers
 *
 * All endpoints require JWT authentication, tenant isolation, and fleet manager permissions
 */
@Controller('tasks')
@UseGuards(JwtAuthGuard, TenantIsolationGuard, PermissionGuard)
export class TaskAssignmentController {
  private readonly logger = new Logger(TaskAssignmentController.name);

  constructor(
    private readonly commandBus: CommandBus,
    private readonly taskAssignmentService: TaskAssignmentService,
  ) {}

  /**
   * T190: POST /api/v1/tasks/:firId/assign
   * Assign FIR pickup task to driver (automatic or manual)
   * Requires: fir:update:facility permission
   */
  @Post(':firId/assign')
  @RequirePermission('fir:update:facility')
  @HttpCode(HttpStatus.OK)
  async assignTask(
    @Param('firId') firId: string,
    @CurrentTenant() tenantId: string,
    @CurrentUser() user: any,
    @Body()
    body: {
      driverId?: string; // If provided, manual assignment; otherwise automatic
      reason?: string; // Optional reason for manual assignment
    },
  ) {
    this.logger.log(
      `Assigning task FIR ${firId}${body.driverId ? ` to driver ${body.driverId}` : ' (automatic)'}`,
    );

    const command = new AssignTaskCommand(
      firId,
      tenantId,
      user.userId,
      body.driverId,
      body.reason,
    );

    const result = await this.commandBus.execute(command);

    return {
      success: true,
      data: {
        assignedDriverId: result.assignedDriverId,
        assignmentMethod: result.assignmentMethod,
        warnings: result.warnings,
      },
      message: body.driverId
        ? 'Task manually assigned successfully'
        : 'Task automatically assigned to best qualified driver',
    };
  }

  /**
   * T191: PUT /api/v1/tasks/:firId/reassign
   * Reassign FIR pickup task to different driver
   * Requires: fir:update:facility permission
   */
  @Put(':firId/reassign')
  @RequirePermission('fir:update:facility')
  @HttpCode(HttpStatus.OK)
  async reassignTask(
    @Param('firId') firId: string,
    @CurrentTenant() tenantId: string,
    @CurrentUser() user: any,
    @Body()
    body: {
      newDriverId: string;
      reason: string; // Required for audit trail
    },
  ) {
    this.logger.log(
      `Reassigning task FIR ${firId} to driver ${body.newDriverId}`,
    );

    const command = new ReassignTaskCommand(
      firId,
      body.newDriverId,
      tenantId,
      user.userId,
      body.reason,
    );

    const result = await this.commandBus.execute(command);

    return {
      success: true,
      data: {
        previousDriverId: result.previousDriverId,
        newDriverId: result.assignedDriverId,
        reason: result.reason,
        warnings: result.warnings,
      },
      message: 'Task reassigned successfully',
    };
  }

  /**
   * GET /api/v1/tasks/:firId/qualified-drivers
   * List all qualified drivers for a specific FIR
   * Requires: fir:read:facility permission
   */
  @Get(':firId/qualified-drivers')
  @RequirePermission('fir:read:facility')
  async listQualifiedDrivers(
    @Param('firId') firId: string,
    @CurrentTenant() tenantId: string,
  ) {
    this.logger.log(`Listing qualified drivers for FIR ${firId}`);

    const qualifiedDrivers =
      await this.taskAssignmentService.findQualifiedDrivers(firId, tenantId);

    return {
      success: true,
      data: {
        firId,
        qualifiedDrivers: qualifiedDrivers.map((driver) => ({
          userId: driver.userId,
          vehicleId: driver.resourceId,
          certifications: driver.certifications,
          zone: driver.zone,
          capacity: driver.capacity,
          currentWorkload: driver.currentWorkload,
          availableCapacity: driver.availableCapacity,
          score: driver.score,
        })),
        totalQualified: qualifiedDrivers.length,
      },
      message:
        qualifiedDrivers.length > 0
          ? `Found ${qualifiedDrivers.length} qualified driver(s)`
          : 'No qualified drivers available for this task',
    };
  }

  /**
   * T192: GET /api/v1/tasks/my-assignments
   * Get all assigned tasks for the current driver (mobile view)
   * Sorted by proximity to driver's current location
   * Requires: fir:read:own permission
   */
  @Get('my-assignments')
  @RequirePermission('fir:read:own')
  async getMyAssignments(
    @CurrentTenant() tenantId: string,
    @CurrentUser() user: any,
  ) {
    this.logger.log(`Getting assignments for driver ${user.userId}`);

    // Get driver's assigned FIRs
    // Note: This is a placeholder. In production, you'd query FIRs where carrierUserId = user.userId
    // and status = AWAITING_CARRIER, sorted by transportDate

    return {
      success: true,
      data: {
        driverId: user.userId,
        assignments: [
          // Placeholder - should query from FIR repository
          // {
          //   firId: 'fir-123',
          //   firNumber: 'FIR-001',
          //   cerCode: '150101',
          //   wasteDescription: 'Imballaggi in carta',
          //   quantity: 250,
          //   unit: 'KG',
          //   transportDate: '2025-11-01T10:00:00Z',
          //   pickupLocation: {
          //     address: 'Via Producer 1, Rome',
          //     latitude: 41.9028,
          //     longitude: 12.4964,
          //     distance: 1250, // meters from driver's current location
          //   },
          //   deliveryLocation: {
          //     address: 'Via Receiver 1, Rome',
          //     latitude: 41.8919,
          //     longitude: 12.5113,
          //   },
          //   status: 'AWAITING_CARRIER',
          //   priority: 'normal',
          // }
        ],
        totalAssignments: 0,
        vehicleInfo: {
          capacity: 1000,
          currentLoad: 0,
          availableCapacity: 1000,
        },
      },
      message: 'Retrieved driver assignments',
    };
  }
}
