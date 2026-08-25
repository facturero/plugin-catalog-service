export interface ErrorDetail {
  field: string;
  message: string;
}

export abstract class AppError extends Error {
  abstract readonly code: string;
  abstract readonly httpStatus: number;
  readonly details?: ErrorDetail[];

  constructor(message: string, details?: ErrorDetail[]) {
    super(message);
    this.name = new.target.name;
    this.details = details;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export class ValidationError extends AppError {
  readonly code = 'VALIDATION_ERROR';
  readonly httpStatus = 422;
  constructor(details: ErrorDetail[], message = 'La petición no es válida.') {
    super(message, details);
  }
}

export class OrganizationContextRequiredError extends AppError {
  readonly code = 'ORG_CONTEXT_REQUIRED';
  readonly httpStatus = 401;
  constructor(message = 'Falta el contexto de organización.') { super(message); }
}

export class ForbiddenError extends AppError {
  readonly code = 'FORBIDDEN';
  readonly httpStatus = 403;
  constructor(message = 'Permiso insuficiente.') { super(message); }
}

export class PluginNotFoundError extends AppError {
  readonly code = 'PLUGIN_NOT_FOUND';
  readonly httpStatus = 404;
  constructor(message = 'Plugin no encontrado.') { super(message); }
}

/** Un plugin privado de otra organización se trata como inexistente (no revela cross-org). */
export class PluginNotVisibleToOrganizationError extends AppError {
  readonly code = 'PLUGIN_NOT_FOUND';
  readonly httpStatus = 404;
  constructor(message = 'Plugin no encontrado.') { super(message); }
}

export class PluginNotAvailableError extends AppError {
  readonly code = 'PLUGIN_NOT_AVAILABLE';
  readonly httpStatus = 422;
  constructor(readonly buildStatus: string, message = 'El plugin no está disponible para activación.') {
    super(message);
  }
}

export class PluginAlreadyActiveError extends AppError {
  readonly code = 'PLUGIN_ALREADY_ACTIVE';
  readonly httpStatus = 409;
  constructor(message = 'El plugin ya está activo para esta organización.') { super(message); }
}

export class MissingDependenciesError extends AppError {
  readonly code = 'MISSING_DEPENDENCIES';
  readonly httpStatus = 422;
  constructor(readonly missing: string[], message = 'Faltan dependencias por activar primero.') {
    super(message, missing.map((code) => ({ field: 'dependencies', message: code })));
  }
}

export class BlockingDependentsError extends AppError {
  readonly code = 'BLOCKING_DEPENDENTS';
  readonly httpStatus = 422;
  constructor(readonly blocking: string[], message = 'Hay plugins activos que dependen de este; desactívalos primero.') {
    super(message, blocking.map((code) => ({ field: 'dependents', message: code })));
  }
}

export class CustomRequestNotFoundError extends AppError {
  readonly code = 'CUSTOM_REQUEST_NOT_FOUND';
  readonly httpStatus = 404;
  constructor(message = 'Solicitud de plugin a medida no encontrada.') { super(message); }
}

export class InvalidCustomRequestStateError extends AppError {
  readonly code = 'INVALID_CUSTOM_REQUEST_STATE';
  readonly httpStatus = 422;
  constructor(message = 'La solicitud ya está en un estado final (created/rejected).') { super(message); }
}

/** Integridad del grafo de dependencias: un ciclo nunca debería existir si el seed viene bien armado. */
export class PluginDependencyCycleError extends AppError {
  readonly code = 'PLUGIN_DEPENDENCY_CYCLE';
  readonly httpStatus = 500;
  constructor(message = 'Se detectó un ciclo en el grafo de dependencias de plugins.') { super(message); }
}
