export function isDynamicModelDiscoveryEnabled(value: string | undefined): boolean {
  if (value === undefined || value.trim() === '') return true

  const normalized = value.trim().toLowerCase()
  return normalized === '1' || normalized === 'true' || normalized === 'yes'
}
