import { TaskAssignmentController } from './task-assignment.controller'
import { AssignTaskCommand } from '../../application/commands/assign-task.command'
import { ReassignTaskCommand } from '../../application/commands/reassign-task.command'

// Il JWT strategy popola req.user.id (non userId): le assegnazioni devono usare quello.
describe('TaskAssignmentController: utente dal token', () => {
  const commandBus = { execute: jest.fn() }
  let controller: TaskAssignmentController
  const utente = {
    id: 'utente-1',
    tenantId: 't-1',
    email: 'a@b.it',
    role: 'OPERATOR',
    permissions: [],
  }

  beforeEach(() => {
    jest.clearAllMocks()
    commandBus.execute.mockResolvedValue({ assignedDriverId: 'd-1' })
    controller = new TaskAssignmentController(commandBus as any, {} as any)
  })

  it('assignTask passa user.id come assignedBy', async () => {
    await controller.assignTask('fir-1', 't-1', utente, { driverId: 'd-1' })
    const cmd = commandBus.execute.mock.calls[0][0] as AssignTaskCommand
    expect(cmd).toBeInstanceOf(AssignTaskCommand)
    expect(cmd.assignedBy).toBe('utente-1')
  })

  it('reassignTask passa user.id', async () => {
    await controller.reassignTask('fir-1', 't-1', utente, { newDriverId: 'd-2', reason: 'x' })
    const cmd = commandBus.execute.mock.calls[0][0] as ReassignTaskCommand
    expect(cmd).toBeInstanceOf(ReassignTaskCommand)
    expect(Object.values(cmd)).toContain('utente-1')
    expect(Object.values(cmd)).not.toContain(undefined)
  })

  it('getMyAssignments restituisce user.id come driverId', async () => {
    const r: any = await controller.getMyAssignments('t-1', utente)
    expect(r.data.driverId).toBe('utente-1')
  })
})
