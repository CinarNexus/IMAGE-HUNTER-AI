import {
  arePaidProvidersEnabled,
  getStudioDailyBudgetUsd,
} from './config.js'

export class ProviderRegistry {
  #providers = new Map()
  #dailyReservations = new Map()
  #budgetUsd
  #now

  constructor({ budgetUsd = getStudioDailyBudgetUsd(), now = Date.now } = {}) {
    if (!Number.isFinite(budgetUsd) || budgetUsd < 0) {
      throw new Error('Günlük stüdyo bütçesi negatif olmayan geçerli bir sayı olmalı.')
    }
    this.#budgetUsd = budgetUsd
    this.#now = now
  }

  register(adapter) {
    if (!adapter || typeof adapter.id !== 'string' || !adapter.id.trim()
      || !Array.isArray(adapter.capabilities) || adapter.capabilities.length === 0
      || typeof adapter.estimate !== 'function'
      || typeof adapter.execute !== 'function') {
      throw new Error('Sağlayıcı adaptörü id, capabilities, estimate ve execute sağlamalı.')
    }
    if (this.#providers.has(adapter.id)) throw new Error(`Sağlayıcı zaten kayıtlı: ${adapter.id}`)
    this.#providers.set(adapter.id, Object.freeze({
      ...adapter,
      capabilities: Object.freeze([...adapter.capabilities]),
      paid: Boolean(adapter.paid),
      enabled: Boolean(adapter.enabled),
    }))
  }

  resolve(providerId, capability) {
    const adapter = this.#providers.get(providerId)
    if (!adapter || !adapter.capabilities.includes(capability)) {
      const error = new Error('Bu işlem için uygun sağlayıcı yapılandırılmamış.')
      error.statusCode = 503
      throw error
    }
    if (!adapter.enabled || (adapter.paid && !arePaidProvidersEnabled())) {
      const error = new Error('Bu sağlayıcı devre dışı. Ücretli işlemler açıkça etkinleştirilmelidir.')
      error.statusCode = 503
      throw error
    }
    return adapter
  }

  async execute(providerId, capability, input) {
    const adapter = this.resolve(providerId, capability)
    const estimate = await adapter.estimate(input)
    if (!estimate || !Number.isFinite(estimate.costUsd) || estimate.costUsd < 0
      || (adapter.paid && estimate.costUsd === 0)) {
      throw new Error('Sağlayıcı geçerli ve güvenli bir maliyet tahmini vermedi.')
    }

    const day = new Date(this.#now()).toISOString().slice(0, 10)
    for (const reservedDay of this.#dailyReservations.keys()) {
      if (reservedDay !== day) this.#dailyReservations.delete(reservedDay)
    }
    const spentUsd = this.#dailyReservations.get(day) || 0
    assertWithinDailyBudget({
      estimatedCostUsd: estimate.costUsd,
      spentUsd,
      budgetUsd: this.#budgetUsd,
    })
    this.#dailyReservations.set(day, spentUsd + estimate.costUsd)
    return adapter.execute(input, { estimate })
  }

  list() {
    return [...this.#providers.values()].map(({ id, capabilities, paid, enabled }) => ({
      id,
      capabilities: [...capabilities],
      paid,
      enabled: enabled && (!paid || arePaidProvidersEnabled()),
    }))
  }
}

export function assertWithinDailyBudget({ estimatedCostUsd, spentUsd, budgetUsd = getStudioDailyBudgetUsd() }) {
  for (const [key, value] of Object.entries({ estimatedCostUsd, spentUsd, budgetUsd })) {
    if (!Number.isFinite(value) || value < 0) {
      throw new Error(`${key} negatif olmayan geçerli bir sayı olmalı.`)
    }
  }
  if (spentUsd + estimatedCostUsd > budgetUsd) {
    const error = new Error('Günlük stüdyo kullanım bütçesi aşılıyor; işlem başlatılmadı.')
    error.statusCode = 429
    throw error
  }
}
