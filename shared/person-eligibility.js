export const MIN_SUBJECT_CONFIDENCE = 70
export const MIN_PERSON_COUNT_CONFIDENCE = 90

export function getPersonEligibilityReason(photo) {
  if (photo.analysisError) return `AI doğrulaması tamamlanamadı: ${photo.analysisError}`
  if (!Number.isInteger(photo.personCount)) return 'AI fotoğraftaki kişi sayısını doğrulayamadı.'
  if (photo.personCount === 0) return 'Fotoğrafta kişi bulunamadı.'
  if (photo.personCount > 1) return `Fotoğrafta ${photo.personCount} kişi var; yalnızca tek kişi kabul edilir.`
  if (!Number.isFinite(photo.personCountConfidence)
    || photo.personCountConfidence < MIN_PERSON_COUNT_CONFIDENCE) {
    return 'Kişi sayımı yeterince kesin değil.'
  }
  if (photo.subjectMatch === 'mismatch') return 'Fotoğraftaki kişinin kimliği aranan kişiyle eşleşmiyor.'
  if (photo.subjectMatch !== 'match') return 'Aranan kişinin kimliği doğrulanamadı.'
  if (!Number.isFinite(photo.subjectConfidence)
    || photo.subjectConfidence < MIN_SUBJECT_CONFIDENCE) {
    return 'Kimlik eşleşmesinin güveni yeterli değil.'
  }
  if (photo.faceVisible !== true) return 'Yüz görünmüyor veya kimlik doğrulaması için yeterince açık değil.'
  if (photo.faceRecognizable !== true) return 'Yüz görünse de kimliği doğrulayacak kadar tanınabilir değil.'
  return ''
}

export function isPersonEligible(photo) {
  return getPersonEligibilityReason(photo) === ''
}
