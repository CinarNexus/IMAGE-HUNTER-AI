export const AESTHETIC_WEIGHTS = Object.freeze({
  relevance: 15,
  clarity: 15,
  resolution: 10,
  lighting: 15,
  colors: 10,
  composition: 15,
  framing: 10,
  editSuitability: 10,
})

export const MIN_AUTO_SELECT_SCORE = 45
export const MIN_SUBJECT_CONFIDENCE = 70
export const MIN_PERSON_COUNT_CONFIDENCE = 90

export function isPersonEligible(photo) {
  return photo.personCount === 1
    && Number.isFinite(photo.personCountConfidence)
    && photo.personCountConfidence >= MIN_PERSON_COUNT_CONFIDENCE
    && photo.faceVisible === true
    && photo.faceRecognizable === true
    && photo.subjectMatch === 'match'
    && photo.subjectConfidence >= MIN_SUBJECT_CONFIDENCE
}

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
  return [...photos].sort((left, right) => (right.score ?? -1) - (left.score ?? -1)).map((photo) => {
    const eligible = typeof photo.score === 'number'
      && !photo.duplicateOf
      && isPersonEligible(photo)
      && photo.score >= MIN_AUTO_SELECT_SCORE
      && selectedCount < bestCount
    if (eligible) selectedCount += 1
    return { ...photo, autoSelected: eligible, selected: eligible }
  })
}
