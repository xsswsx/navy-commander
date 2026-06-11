// server/logic/rules/hitResolution.ts
// 舰炮命中判定

export type AdjacentFn = (compId: string, offset: number) => string | null

export function resolveNavalGunHit(
  d8: number,
  targetCompId: string,
  hasAfterburner: boolean,
  adjacentComp: AdjacentFn
): string | null {
  if (hasAfterburner) {
    if (d8 === 4 || d8 === 5) return targetCompId
    if (d8 === 3) return adjacentComp(targetCompId, -1)
    if (d8 === 6) return adjacentComp(targetCompId, 1)
    return null
  }
  if (d8 >= 3 && d8 <= 6) return targetCompId
  if (d8 === 2) return adjacentComp(targetCompId, -1)
  if (d8 === 7) return adjacentComp(targetCompId, 1)
  return null
}

export function resolveBlindfireHit(d8: number): boolean {
  return d8 >= 3 && d8 <= 6
}
