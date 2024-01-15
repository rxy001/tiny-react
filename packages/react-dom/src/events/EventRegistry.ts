import type { DOMEventName } from "./DOMEventNames"

export const allNativeEvents: Set<DOMEventName> = new Set()

/**
 * Mapping from registration name to event name
 */
export const registrationNameDependencies: Record<string, any> = {}

/**
 * Mapping from lowercase registration names to the properly cased version,
 * used to warn in the case of missing event handlers. Available
 * only in __DEV__.
 * @type {Object}
 */
export const possibleRegistrationNames = null
// Trust the developer to only use possibleRegistrationNames in __DEV__

export function registerTwoPhaseEvent(
  registrationName: string,
  dependencies: Array<DOMEventName>,
): void {
  registerDirectEvent(registrationName, dependencies)
  registerDirectEvent(`${registrationName}Capture`, dependencies)
}

export function registerDirectEvent(
  registrationName: string,
  dependencies: Array<DOMEventName>,
) {
  registrationNameDependencies[registrationName] = dependencies

  for (let i = 0; i < dependencies.length; i++) {
    allNativeEvents.add(dependencies[i])
  }
}
