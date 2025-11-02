import { HttpInterceptorFn } from '@angular/common/http';
import { finalize } from 'rxjs/operators';

/**
 * Loading Interceptor
 *
 * Shows global loading indicator for HTTP requests using PrimeNG BlockUI.
 * Automatically increments/decrements request counter to handle concurrent requests.
 */

// Counter for active requests (module-level state)
let activeRequests = 0;
let blocked = false;

function showLoading(): void {
  // Emit loading start event (handled by app component with BlockUI)
  window.dispatchEvent(new CustomEvent('loading-start'));
}

function hideLoading(): void {
  // Emit loading end event
  window.dispatchEvent(new CustomEvent('loading-end'));
}

export const loadingInterceptor: HttpInterceptorFn = (req, next) => {
  // Skip loading indicator for specific endpoints
  const skipLoadingEndpoints = ['/metrics', '/health', '/notifications'];
  const shouldSkip = skipLoadingEndpoints.some(endpoint => req.url.includes(endpoint));

  if (shouldSkip) {
    return next(req);
  }

  // Increment active requests and show loading
  activeRequests++;
  if (!blocked) {
    blocked = true;
    showLoading();
  }

  return next(req).pipe(
    finalize(() => {
      // Decrement active requests and hide loading if no more active
      activeRequests--;
      if (activeRequests === 0) {
        blocked = false;
        hideLoading();
      }
    })
  );
};
