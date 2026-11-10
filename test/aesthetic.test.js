import assert from 'node:assert/strict'
import { test } from 'node:test'
import { AESTHETIC_WEIGHTS, calculateAestheticScore, rankAestheticPhotos } from '../server/aesthetic.js'

function analysis(overrides = {}) {
  return {
    relevance: 80,
    clarity: 80,
    resolution: 80,
    lighting: 80,
    colors: 80,
    composition: 80,
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
    { id: 'mismatch', score: 100, subjectMatch: 'mismatch', subjectConfidence: 99 },
    { id: 'uncertain', score: 99, subjectMatch: 'uncertain', subjectConfidence: 45 },
    { id: 'duplicate', score: 98, subjectMatch: 'match', subjectConfidence: 95, duplicateOf: 'best' },
    { id: 'low-confidence', score: 97, subjectMatch: 'match', subjectConfidence: 69 },
    { id: 'best', score: 90, subjectMatch: 'match', subjectConfidence: 95 },
    { id: 'second', score: 80, subjectMatch: 'match', subjectConfidence: 70 },
    { id: 'third', score: 70, subjectMatch: 'match', subjectConfidence: 90 },
  ], 2)

  assert.deepEqual(ranked.slice(0, 3).map((photo) => photo.id), ['mismatch', 'uncertain', 'duplicate'])
  assert.deepEqual(ranked.filter((photo) => photo.autoSelected).map((photo) => photo.id), ['best', 'second'])
})

test('otomatik seçim sonuç sırasına değil en yüksek puana göre yapılır', () => {
  const ranked = rankAestheticPhotos([
    { id: 'lower-first', score: 40, subjectMatch: 'match', subjectConfidence: 90 },
    { id: 'highest', score: 95, subjectMatch: 'match', subjectConfidence: 90 },
    { id: 'middle', score: 70, subjectMatch: 'match', subjectConfidence: 90 },
    { id: 'mismatch', score: 100, subjectMatch: 'mismatch', subjectConfidence: 99 },
  ], 2)

  assert.deepEqual(ranked.filter((photo) => photo.autoSelected).map((photo) => photo.id), ['highest', 'middle'])
  assert.deepEqual(ranked.slice(0, 2).map((photo) => photo.id), ['mismatch', 'highest'])
})
