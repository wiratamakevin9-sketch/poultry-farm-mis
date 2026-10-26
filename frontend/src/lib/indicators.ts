/** Hen-day production: eggs / live birds x 100. */
export function hdp(totalEggs: number, liveBirds: number): number {
  return liveBirds > 0 ? (totalEggs / liveBirds) * 100 : 0
}

/** Feed per bird in grams. */
export function feedPerBirdGrams(feedKg: number, liveBirds: number): number {
  return liveBirds > 0 ? (feedKg * 1000) / liveBirds : 0
}
