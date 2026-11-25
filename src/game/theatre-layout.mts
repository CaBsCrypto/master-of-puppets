export const THEATRE_CENTER = { x: 16, y: 3, z: 16 } as const

export const THEATRE_COLUMN = {
  model: 'assets/Models/theatre-column.glb',
  collider: 'column_collider',
  halfWidth: .47,
  height: 8.7
} as const

// Keep the approach from the entrance to centre stage between the columns.
export const THEATRE_COLUMNS = Array.from({ length: 6 }, (_, index) => {
  const angle = index * Math.PI / 3
  return {
    name: `TheatreColumn${index + 1}`,
    position: {
      x: THEATRE_CENTER.x + Math.cos(angle) * 12.1,
      y: THEATRE_CENTER.y,
      z: THEATRE_CENTER.z + Math.sin(angle) * 12.1
    }
  }
})
