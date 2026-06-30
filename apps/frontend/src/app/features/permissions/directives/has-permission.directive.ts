import {
  Directive,
  Input,
  TemplateRef,
  ViewContainerRef,
  OnInit,
  OnDestroy,
  inject,
  effect,
} from '@angular/core'
import { PermissionStore } from '../../../core/state/permission.store'
import { TempPermissionStore } from '../../../core/state/temp-permission.store'

/**
 * *hasPermission Structural Directive
 * Conditionally renders template if user has required permission
 *
 * Usage:
 * <div *hasPermission="'fir:create:facility'">
 *   <button>Create FIR</button>
 * </div>
 *
 * Multiple permissions (OR logic):
 * <div *hasPermission="['fir:create:facility', 'fir:create:all']">
 *   <button>Create FIR</button>
 * </div>
 *
 * Multiple permissions (AND logic):
 * <div *hasPermission="['fir:create:facility', 'fir:read:facility']; requireAll: true">
 *   <button>Create & Read FIR</button>
 * </div>
 *
 * Include temporary permissions:
 * <div *hasPermission="'fir:delete:facility'; includeTemp: true">
 *   <button>Delete FIR</button>
 * </div>
 */
@Directive({
  selector: '[hasPermission]',
  standalone: true,
})
export class HasPermissionDirective implements OnInit, OnDestroy {
  private readonly permissionStore = inject(PermissionStore)
  private readonly tempPermissionStore = inject(TempPermissionStore)
  private readonly templateRef = inject(TemplateRef<any>)
  private readonly viewContainer = inject(ViewContainerRef)

  @Input('hasPermission') requiredPermission!: string | string[]
  @Input('hasPermissionRequireAll') requireAll = false // If true, all permissions must match (AND logic)
  @Input('hasPermissionIncludeTemp') includeTemp = false // If true, check temp permissions too

  private hasView = false

  constructor() {
    // React to permission changes using effect
    effect(() => {
      this.updateView()
    })
  }

  ngOnInit(): void {
    // Ensure permissions are loaded
    this.permissionStore.ensurePermissionsLoaded()

    if (this.includeTemp) {
      // Load temp permissions if requested
      this.tempPermissionStore.loadGrants()
    }

    this.updateView()
  }

  ngOnDestroy(): void {
    this.viewContainer.clear()
  }

  private updateView(): void {
    const hasPermission = this.checkPermission()

    if (hasPermission && !this.hasView) {
      // User has permission and view is not created - create it
      this.viewContainer.createEmbeddedView(this.templateRef)
      this.hasView = true
    } else if (!hasPermission && this.hasView) {
      // User lacks permission and view exists - remove it
      this.viewContainer.clear()
      this.hasView = false
    }
  }

  private checkPermission(): boolean {
    const permissions = Array.isArray(this.requiredPermission)
      ? this.requiredPermission
      : [this.requiredPermission]

    // Get permission checker from store
    const hasPermissionFn = this.permissionStore.hasPermission()

    if (this.requireAll) {
      // AND logic: user must have ALL permissions
      const hasPermanentPermissions = permissions.every(perm => hasPermissionFn(perm))

      if (!this.includeTemp) {
        return hasPermanentPermissions
      }

      // Check temp permissions too
      const hasTempPermissionFn = this.tempPermissionStore.hasTempPermission()
      return hasPermanentPermissions || permissions.every(perm => hasTempPermissionFn(perm))
    } else {
      // OR logic: user must have ANY permission
      const hasPermanentPermission = permissions.some(perm => hasPermissionFn(perm))

      if (!this.includeTemp) {
        return hasPermanentPermission
      }

      // Check temp permissions too
      const hasTempPermissionFn = this.tempPermissionStore.hasTempPermission()
      return hasPermanentPermission || permissions.some(perm => hasTempPermissionFn(perm))
    }
  }
}
