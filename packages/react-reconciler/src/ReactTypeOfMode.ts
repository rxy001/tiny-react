export type TypeOfMode = number

export const NoMode = /*                         */ 0b000000
// TODO: Remove ConcurrentMode by reading from the root tag instead
export const ConcurrentMode = /*                 */ 0b000001
export const ConcurrentUpdatesByDefaultMode = /* */ 0b100000
