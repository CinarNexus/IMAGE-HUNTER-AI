export const AESTHETIC_WEIGHTS = Object.freeze({
  relevance: 20,
  clarity: 15,
  resolution: 15,
  lighting: 15,
  colors: 10,
  composition: 15,
  editSuitability: 10,
})

export function calculateAestheticScore(analysis) {
  const weightedTotal = Object.entries(AESTHETIC_WEIGHTS).reduce((total, [criterion, weight]) => {
    const score = Number(analysis[criterion])
    if (!Number.isFinite(score) || score < 0 || score > 100) {
      throw new Error(`AI yanıtında ${criterion} puanı geçersiz.`)
    }
    return total + score * weight
  }, 0)
  return Math.round(weightedTotal / 100)
}

export function rankAestheticPhotos(photos, bestCount) {
  let selectedCount = 0
  return photos.map((photo) => {
    const eligible = typeof photo.score === 'number'
      && !photo.duplicateOf
      && photo.subjectMatch === 'match'
      && photo.subjectConfidence >= 70
      && photo.score >= 45
      && selectedCount < bestCount
    if (eligible) selectedCount += 1
    return { ...photo, autoSelected: eligible, selected: eligible }
  }).sort((left, right) => (right.score ?? -1) - (left.score ?? -1))
}
