export const MIN_SUBJECT_CONFIDENCE = 70
export const MIN_PERSON_COUNT_CONFIDENCE = 90

export function isPersonEligible(photo) {
  return photo.personCount === 1
    && Number.isFinite(photo.personCountConfidence)
    && photo.personCountConfidence >= MIN_PERSON_COUNT_CONFIDENCE
    && photo.faceVisible === true
    && photo.faceRecognizable === true
    && photo.subjectMatch === 'match'
    && Number.isFinite(photo.subjectConfidence)
    && photo.subjectConfidence >= MIN_SUBJECT_CONFIDENCE
}
