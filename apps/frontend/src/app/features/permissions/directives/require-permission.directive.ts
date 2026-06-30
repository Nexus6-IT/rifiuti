import {
  Directive,
  Input,
  ElementRef,
  OnInit,
  OnDestroy,
  inject,
  effect,
  Renderer2,
} from '@angular/core'
import { PermissionStore } from '../../../core/state/permission.store'
import { TempPermissionStore } from '../../../core/state/temp-permission.store'

/**
 * requirePermission Attribute Directive
 * Disables element if user lacks required permission
 * Optionally hides element instead of disabling
 *
 * Usage:
 * <button [requirePermission]="'fir:delete:facility'">Delete FIR</button>
 *
 * Hide instead of disable:
 * <button [requirePermission]="'fir:delete:facility'" [rpHideIfUnauthorized]="true">
 *   Delete FIR
 * </button>
 *
 * Multiple permissions (OR logic):
 * <button [requirePermission]="['fir:create:facility', 'fir:create:all']">
 *   Create FIR
 * </button>
 *
 * Multiple permissions (AND logic):
 * <button [requirePermission]="['fir:create:facility', 'fir:read:facility']" [rpRequireAll]="true">
 *   Create & Read FIR
 * </button>
 *
 * Include temporary permissions:
 * <button [requirePermission]="'fir:delete:facility'" [rpIncludeTemp]="true">
 *   Delete FIR
 * </button>
 */
@Directive({
  selector: '[requirePermission]',
  standalone: true,
})
export class RequirePermissionDirective implements OnInit, OnDestroy {
  private readonly permissionStore = inject(PermissionStore)
  private readonly tempPermissionStore = inject(TempPermissionStore)
  private readonly el = inject(ElementRef)
  private readonly renderer = inject(Renderer2)

  @Input('requirePermission') requiredPermission!: string | string[]
  @Input('rpRequireAll') requireAll = false // If true, all permissions must match (AND logic)
  @Input('rpIncludeTemp') includeTemp = false // If true, check temp permissions too
  @Input('rpHideIfUnauthorized') hideIfUnauthorized = false // If true, hide element instead of disabling
  @Input('rpCustomClass') customClass = 'unauthorized' // CSS class to add when unauthorized

  private originalDisplay: string | null = null

  constructor() {
    // React to permission changes using effect
    effect(() => {
      this.updateElement()
    })
  }

  ngOnInit(): void {
    // Store original display style
    this.originalDisplay = this.el.nativeElement.style.display || null

    // Ensure permissions are loaded
    this.permissionStore.ensurePermissionsLoaded()

    if (this.includeTemp) {
      this.tempPermissionStore.loadGrants()
    }

    this.updateElement()
  }

  ngOnDestroy(): void {
    // Cleanup: restore element to enabled state
    this.renderer.removeAttribute(this.el.nativeElement, 'disabled')
    this.renderer.removeClass(this.el.nativeElement, this.customClass)
    if (this.originalDisplay !== null) {
      this.renderer.setStyle(this.el.nativeElement, 'display', this.originalDisplay)
    }
  }

  private updateElement(): void {
    const hasPermission = this.checkPermission()

    if (hasPermission) {
      // User has permission - enable and show element
      this.renderer.removeAttribute(this.el.nativeElement, 'disabled')
      this.renderer.removeClass(this.el.nativeElement, this.customClass)
      if (this.hideIfUnauthorized && this.originalDisplay !== null) {
        this.renderer.setStyle(this.el.nativeElement, 'display', this.originalDisplay)
      }
    } else {
      // User lacks permission - disable or hide element
      if (this.hideIfUnauthorized) {
        this.renderer.setStyle(this.el.nativeElement, 'display', 'none')
      } else {
        this.renderer.setAttribute(this.el.nativeElement, 'disabled', 'true')
        this.renderer.addClass(this.el.nativeElement, this.customClass)

        // Set ARIA attributes for accessibility
        this.renderer.setAttribute(this.el.nativeElement, 'aria-disabled', 'true')
        this.renderer.setAttribute(
          this.el.nativeElement,
          'title',
          'You do not have permission to perform this action'
        )
      }
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
