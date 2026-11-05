export function normalizeSeatId(seat) {
  if (typeof seat !== 'string' || !seat.trim()) {
    throw new Error('A non-empty seat identifier is required')
  }
  const trimmed = seat.trim()
  if (
    /\s/.test(trimmed) ||
    trimmed.includes('..') ||
    trimmed.includes('/') ||
    trimmed.includes('\\')
  ) {
    throw new Error(`Invalid seat identifier: ${seat}`)
  }
  return trimmed
}
