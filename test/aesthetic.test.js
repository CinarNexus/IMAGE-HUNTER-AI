import assert from 'node:assert/strict'
import { test } from 'node:test'
import { AESTHETIC_WEIGHTS, calculateAestheticScore, isPersonEligible, rankAestheticPhotos } from '../server/aesthetic.js'

function analysis(overrides = {}) {
  return {
    relevance: 80,
    clarity: 80,
    resolution: 80,
    lighting: 80,
    colors: 80,
    composition: 80,
    framing: 80,
    editSuitability: 80,
    ...overrides,
  }
}

test('estetik kriter ağırlıkları 100 eder ve her ölçüt puanı toplamı belirler', () => {
  assert.equal(Object.values(AESTHETIC_WEIGHTS).reduce((sum, weight) => sum + weight, 0), 100)
  assert.equal(calculateAestheticScore(analysis()), 80)
  assert.equal(calculateAestheticScore(analysis({ colors: 100 })), 82)
})

test('geçersiz kriter puanları puanlama hatası verir', () => {
  assert.throws(() => calculateAestheticScore(analysis({ lighting: Number.NaN })), /lighting/)
  assert.throws(() => calculateAestheticScore(analysis({ resolution: 101 })), /resolution/)
})

test('yalnızca güvenle eşleşen, farklı ve yeterli puanlı görseller otomatik seçilir', () => {
  const ranked = rankAestheticPhotos([
    { id: 'mismatch', score: 100, personCount: 1, personCountConfidence: 99, subjectMatch: 'mismatch', subjectConfidence: 99, faceVisible: true, faceRecognizable: true },
    { id: 'uncertain', score: 99, personCount: 1, personCountConfidence: 99, subjectMatch: 'uncertain', subjectConfidence: 45, faceVisible: true, faceRecognizable: true },
    { id: 'duplicate', score: 98, personCount: 1, personCountConfidence: 99, subjectMatch: 'match', subjectConfidence: 95, faceVisible: true, faceRecognizable: true, duplicateOf: 'best' },
    { id: 'low-confidence', score: 97, personCount: 1, personCountConfidence: 99, subjectMatch: 'match', subjectConfidence: 69, faceVisible: true, faceRecognizable: true },
    { id: 'best', score: 90, personCount: 1, personCountConfidence: 99, subjectMatch: 'match', subjectConfidence: 95, faceVisible: true, faceRecognizable: true },
    { id: 'second', score: 80, personCount: 1, personCountConfidence: 99, subjectMatch: 'match', subjectConfidence: 70, faceVisible: true, faceRecognizable: true },
    { id: 'third', score: 70, personCount: 1, personCountConfidence: 99, subjectMatch: 'match', subjectConfidence: 90, faceVisible: true, faceRecognizable: true },
  ], 2)

  assert.deepEqual(ranked.slice(0, 3).map((photo) => photo.id), ['mismatch', 'uncertain', 'duplicate'])
  assert.deepEqual(ranked.filter((photo) => photo.autoSelected).map((photo) => photo.id), ['best', 'second'])
})

test('otomatik seçim sonuç sırasına değil en yüksek puana göre yapılır', () => {
  const ranked = rankAestheticPhotos([
    { id: 'lower-first', score: 40, personCount: 1, personCountConfidence: 99, subjectMatch: 'match', subjectConfidence: 90, faceVisible: true, faceRecognizable: true },
    { id: 'highest', score: 95, personCount: 1, personCountConfidence: 99, subjectMatch: 'match', subjectConfidence: 90, faceVisible: true, faceRecognizable: true },
    { id: 'middle', score: 70, personCount: 1, personCountConfidence: 99, subjectMatch: 'match', subjectConfidence: 90, faceVisible: true, faceRecognizable: true },
    { id: 'mismatch', score: 100, personCount: 1, personCountConfidence: 99, subjectMatch: 'mismatch', subjectConfidence: 99, faceVisible: true, faceRecognizable: true },
  ], 2)

  assert.deepEqual(ranked.filter((photo) => photo.autoSelected).map((photo) => photo.id), ['highest', 'middle'])
  assert.deepEqual(ranked.slice(0, 2).map((photo) => photo.id), ['mismatch', 'highest'])
})

test('45 altı estetik puanı otomatik seçim için yetersiz sayılır', () => {
  const ranked = rankAestheticPhotos([
    { id: 'below-threshold', score: 44, personCount: 1, personCountConfidence: 99, subjectMatch: 'match', subjectConfidence: 100, faceVisible: true, faceRecognizable: true },
    { id: 'at-threshold', score: 45, personCount: 1, personCountConfidence: 99, subjectMatch: 'match', subjectConfidence: 100, faceVisible: true, faceRecognizable: true },
  ], 20)

  assert.deepEqual(ranked.filter((photo) => photo.autoSelected).map((photo) => photo.id), ['at-threshold'])
})

test('kişi filtresi tam bir kişiyi, doğru kimliği ve görünür/tanınabilir yüzü zorunlu tutar', () => {
  const valid = {
    personCount: 1,
    personCountConfidence: 95,
    subjectMatch: 'match',
    subjectConfidence: 90,
    faceVisible: true,
    faceRecognizable: true,
  }
  assert.equal(isPersonEligible(valid), true)
  assert.equal(isPersonEligible({ ...valid, personCount: 2 }), false)
  assert.equal(isPersonEligible({ ...valid, personCount: 0 }), false)
  assert.equal(isPersonEligible({ ...valid, personCountConfidence: 89 }), false)
  assert.equal(isPersonEligible({ ...valid, personCountConfidence: undefined }), false)
  const highScoreButUncertainCount = rankAestheticPhotos([{
    ...valid,
    id: 'uncertain-count',
    personCountConfidence: 52,
    score: 100,
  }], 20)
  assert.equal(highScoreButUncertainCount[0].autoSelected, false)
  assert.equal(isPersonEligible({ ...valid, subjectMatch: 'mismatch' }), false)
  assert.equal(isPersonEligible({ ...valid, faceVisible: false }), false)
  assert.equal(isPersonEligible({ ...valid, faceRecognizable: false }), false)
})
