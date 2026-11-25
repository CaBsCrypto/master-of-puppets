import type { Vec3 } from './game/types'

type ProjectileRole = 'mage' | 'archer'

const FRAMES_PER_SECOND = 30
const VALUES_PER_FRAME = 3

// Centroids of the skinned crystal gem and bow-string nock in hero-*.glb.
// SDK-local XYZ in millimetres above the feet, with X mirrored from the GLB.
// Sampled at 30 fps across the complete attack and ability clips.
const SOCKETS: Readonly<Record<ProjectileRole, { basic: readonly number[]; special: readonly number[] }>> = {
  mage: {
    basic: [
      -493, 1895, 216, -470, 1897, 229, -414, 1903, 246, -348, 1913, 241,
      -301, 1926, 206, -291, 1937, 157, -324, 1947, 121, -381, 1955, 92,
      -432, 1954, 52, -463, 1945, 11, -475, 1940, -5, -478, 1947, 11,
      -480, 1955, 43, -484, 1957, 86, -489, 1946, 133, -493, 1926, 176,
      -493, 1904, 205, -493, 1895, 216,
    ],
    special: [
      -493, 1895, 216, -499, 1891, 225, -512, 1879, 248, -525, 1865, 279,
      -536, 1851, 310, -541, 1842, 336, -544, 1839, 352, -545, 1844, 355,
      -539, 1862, 336, -526, 1892, 292, -505, 1926, 231, -479, 1959, 158,
      -451, 1985, 84, -424, 2003, 16, -400, 2015, -35, -382, 2024, -59,
      -376, 2026, -49, -384, 2017, -10, -404, 1997, 47, -431, 1968, 108,
      -461, 1935, 163, -484, 1907, 202, -493, 1895, 216,
    ],
  },
  archer: {
    basic: [
      186, 1226, 243, 178, 1202, 230, 162, 1149, 189, 152, 1094, 123,
      149, 1060, 56, 149, 1050, 26, 129, 1120, 186, 108, 1355, 329,
      129, 1485, 317, 140, 1475, 318, 149, 1451, 320, 157, 1417, 320,
      165, 1376, 315, 172, 1333, 303, 178, 1291, 286, 182, 1257, 266,
      185, 1234, 250, 186, 1226, 243,
    ],
    special: [
      186, 1226, 243, 182, 1214, 231, 175, 1184, 197, 175, 1152, 143,
      183, 1132, 78, 193, 1128, 17, 199, 1128, -19, 200, 1125, -36,
      202, 1125, -50, 203, 1124, -61, 203, 1125, -71, 204, 1125, -77,
      204, 1126, -82, 204, 1126, -86, 204, 1126, -88, 204, 1126, -89,
      204, 1126, -89, 204, 1126, -89, 199, 1112, -47, 182, 1104, 52,
      170, 1141, 156, 177, 1198, 222, 186, 1226, 243,
    ],
  },
}

export function heroProjectileSocket(role: ProjectileRole, special: boolean, clipSeconds: number): Vec3 {
  const points = SOCKETS[role][special ? 'special' : 'basic']
  const lastFrame = points.length / VALUES_PER_FRAME - 1
  const frame = Math.min(lastFrame, Math.max(0, Number.isNaN(clipSeconds) ? 0 : clipSeconds * FRAMES_PER_SECOND))
  const lowerFrame = Math.floor(frame)
  const upperFrame = Math.min(lowerFrame + 1, lastFrame)
  const fraction = frame - lowerFrame

  function axis(offset: number): number {
    const lower = points[lowerFrame * VALUES_PER_FRAME + offset]
    const upper = points[upperFrame * VALUES_PER_FRAME + offset]
    return (lower + (upper - lower) * fraction) / 1000
  }

  return { x: axis(0), y: axis(1), z: axis(2) }
}
