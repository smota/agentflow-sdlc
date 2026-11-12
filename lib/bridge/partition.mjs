// Which delivery rigs an item is offered to (#586). Several delivery rigs may work one project; a
// partition narrows the offers so one slice goes to one rig (or a small set), and the source claim
// decides among the rigs that were offered the item. Pure: the work item is already read.
//
// Partition (adapters.openrig.bridge.partition):
//   { key: 'mission', map: { '<partOf>': ['<rig>', …] } }
//   { key: 'area', prefix: 'area:', map: { '<area>': ['<rig>', …] } }   area = label after prefix
// An item the map does not name is offered to every delivery rig. Rigs in the map that are not
// delivery rigs are ignored here and reported by partitionProblems.
export const PARTITION_KEYS = Object.freeze(['mission', 'area'])
export const DEFAULT_AREA_PREFIX = 'area:'

function isRigList(value) {
  return Array.isArray(value) && value.every((rig) => typeof rig === 'string' && rig.length > 0)
}

// Configuration problems as strings; [] when the partition is absent or valid.
export function partitionProblems(partition, deliveryRigs) {
  if (partition === null || partition === undefined) return []
  if (typeof partition !== 'object' || Array.isArray(partition)) return ['must be an object']
  const problems = []
  if (!PARTITION_KEYS.includes(partition.key)) {
    problems.push(`key must be one of ${PARTITION_KEYS.join(', ')}`)
  }
  if (
    partition.prefix !== undefined &&
    (typeof partition.prefix !== 'string' || !partition.prefix)
  ) {
    problems.push('prefix must be a non-empty string')
  }
  const map = partition.map ?? {}
  if (typeof map !== 'object' || Array.isArray(map)) {
    problems.push('map must be an object of rig lists')
    return problems
  }
  for (const [value, rigs] of Object.entries(map)) {
    if (!isRigList(rigs) || rigs.length === 0) {
      problems.push(`map.${value} must be a non-empty list of rig names`)
      continue
    }
    for (const rig of rigs) {
      if (!deliveryRigs.includes(rig))
        problems.push(`map.${value} names ${rig}, not a delivery rig`)
    }
  }
  return problems
}

function partitionValues(workItem, partition) {
  if (partition.key === 'mission') {
    return workItem.partOf === null || workItem.partOf === undefined
      ? []
      : [String(workItem.partOf)]
  }
  const prefix = partition.prefix ?? DEFAULT_AREA_PREFIX
  return (workItem.labels ?? [])
    .filter((label) => typeof label === 'string' && label.startsWith(prefix))
    .map((label) => label.slice(prefix.length))
}

// → the delivery rigs to offer the item to, in delivery-rig order.
export function partitionTargets({ workItem, partition, deliveryRigs }) {
  const rigs = [...(deliveryRigs ?? [])]
  if (!partition || !partition.map) return rigs
  const named = new Set(
    partitionValues(workItem, partition).flatMap((value) =>
      Object.hasOwn(partition.map, value) ? partition.map[value] : [],
    ),
  )
  if (named.size === 0) return rigs
  const targets = rigs.filter((rig) => named.has(rig))
  return targets.length ? targets : rigs
}
