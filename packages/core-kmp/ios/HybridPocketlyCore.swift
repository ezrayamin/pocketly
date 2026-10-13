//
//  HybridPocketlyCore.swift
//  PocketlyCoreKmp
//
//  Nitro adapter over the KMP facade (`PocketlyShared.PocketlyCore`). Same role as
//  android/.../HybridPocketlyCore.kt: convert arguments and map types, nothing else.
//
//  Unqualified struct names (Wallet, Transaction, …) are the Nitro-generated structs;
//  `PocketlyShared.*` are the Kotlin domain types.
//

import Foundation
import NitroModules
import PocketlyShared

final class HybridPocketlyCore: HybridPocketlyCoreSpec {
  private let core = PocketlyShared.PocketlyCore.companion.create(
    drivers: PocketlyShared.IosDatabaseDrivers(),
    secureStore: PocketlyShared.IosSecureStore(service: PocketlyShared.IosSecureStore.companion.SERVICE),
    dataset: PocketlyShared.DatasetConfig.companion.LIVE,
    biometricSigner: PocketlyShared.IosBiometricSigner(tag: "com.pocketly.biometric.v1")
  )
  private let convert = PocketlyShared.BridgeConversions.shared

  func resetData(config: DatasetSeed, extraTransactions: [Transaction]) throws -> Promise<Void> {
    var nowMillis: KotlinLong? = nil
    if let now = config.nowMillis {
      nowMillis = KotlinLong(value: try convert.toLongExact(value: now, field: "nowMillis"))
    }
    let kConfig = PocketlyShared.DatasetConfig(
      seed: try convert.toIntExact(value: config.seed, field: "seed"),
      transactionCount: try convert.toIntExact(value: config.transactionCount, field: "transactionCount"),
      nowMillis: nowMillis,
      extraTransactions: try extraTransactions.map { try $0.toDomain(convert) }
    )
    return Promise.async { [core] in try await core.resetData(config: kConfig) }
  }

  func getWallet() throws -> Promise<Wallet> {
    return Promise.async { [core] in try await core.getWallet().toNitro() }
  }

  func getTransactions(cursor: String?, limit: Double, filter: TxFilter?) throws -> Promise<TransactionPage> {
    let kLimit = try convert.toIntExact(value: limit, field: "limit")
    let kFilter = filter.map { f in
      PocketlyShared.TxFilter(
        types: f.types?.map { t in PocketlyShared.TransactionType.entries.first { $0.name == t.stringValue }! },
        statuses: f.statuses?.map { s in PocketlyShared.TransactionStatus.entries.first { $0.name == s.stringValue }! }
      )
    }
    return Promise.async { [core] in
      try await core.getTransactions(cursor: cursor, limit: kLimit, filter: kFilter).toNitro()
    }
  }

  func getTransaction(id: String) throws -> Promise<Transaction> {
    return Promise.async { [core] in try await core.getTransaction(id: id).toNitro() }
  }

  func setNetworkSimulation(simulation: NetworkSimulation) throws {
    let mode = PocketlyShared.NetworkMode.entries.first { $0.name == simulation.mode.stringValue }!
    try core.setNetworkSimulation(simulation: PocketlyShared.NetworkSimulation(
      mode: mode,
      failureRatePercent: try convert.toIntExact(value: simulation.failureRatePercent, field: "failureRatePercent"),
      normalLatencyMs: try convert.toIntExact(value: simulation.normalLatencyMs ?? 0, field: "normalLatencyMs"),
      readTimeoutMs: try convert.toIntExact(value: simulation.readTimeoutMs ?? 10_000, field: "readTimeoutMs"),
      seed: try convert.toIntExact(value: simulation.seed ?? 1, field: "seed")
    ))
  }

  func getNetworkSimulation() throws -> NetworkSimulation {
    let s = core.getNetworkSimulation()
    return NetworkSimulation(
      mode: NetworkMode(fromString: s.mode.name)!,
      failureRatePercent: Double(s.failureRatePercent),
      normalLatencyMs: Double(s.normalLatencyMs),
      readTimeoutMs: Double(s.readTimeoutMs),
      seed: Double(s.seed)
    )
  }

  func simulateIncomingTransfer() throws -> Promise<Transaction> {
    return Promise.async { [core] in try await core.simulateIncomingTransfer().toNitro() }
  }

  func setTimeZone(zoneId: String) throws {
    try core.setTimeZone(zoneId: zoneId)
  }

  func computeSpendingSummary(month: String) throws -> Promise<SpendingSummary> {
    return Promise.async { [core] in try await core.computeSpendingSummary(month: month).toNitro() }
  }

  func ingestTransactions(json: String) throws -> Promise<IngestResult> {
    return Promise.async { [core] in try await core.ingestTransactions(json: json).toNitro() }
  }

  func stageIngestPayload(json: String) throws -> Promise<Void> {
    core.stageIngestPayload(json: json)
    return Promise.resolved()
  }

  func ingestStaged() throws -> Promise<IngestResult> {
    return Promise.async { [core] in try await core.ingestStaged().toNitro() }
  }

  func echo(value: Double) throws -> Double {
    return core.echo(value: value)
  }

  func formatMoney(minor: Double) throws -> String {
    return core.formatMoney(minor: try convert.toLongExact(value: minor, field: "amount"))
  }

  func formatMoneyBatch(minors: [Double]) throws -> [String] {
    let array = KotlinLongArray(size: Int32(minors.count))
    for (i, value) in minors.enumerated() {
      array.set(index: Int32(i), value: try convert.toLongExact(value: value, field: "amount"))
    }
    return core.formatMoneyBatch(minors: array)
  }

  func checkPin(pin: String) throws -> PinCheck {
    let r = core.checkPin(pin: pin)
    return PinCheck(ok: r.ok, reason: r.reason.map { PinRejectReason(fromString: $0.name)! })
  }

  func setPin(pin: String) throws -> Promise<Void> {
    return Promise.async { [core] in try await core.setPin(pin: pin) }
  }

  func verifyPin(pin: String) throws -> Promise<UnlockResult> {
    return Promise.async { [core] in
      let r = try await core.verifyPin(pin: pin)
      return UnlockResult(
        outcome: UnlockOutcome(fromString: r.outcome.name)!,
        attemptsLeft: Double(r.attemptsLeft),
        lockedUntil: r.lockedUntil.map { Double($0.int64Value) }
      )
    }
  }

  func getAuthState() throws -> Promise<AuthState> {
    return Promise.async { [core] in
      let r = try await core.getAuthState()
      return AuthState(
        phone: r.phone,
        pinSet: r.pinSet,
        failedAttempts: Double(r.failedAttempts),
        lockedUntil: r.lockedUntil.map { Double($0.int64Value) }
      )
    }
  }

  func checkPhone(nationalNumber: String) throws -> PhoneCheck {
    let c = core.checkPhone(nationalNumber: nationalNumber)
    return PhoneCheck(ok: c.ok, e164: c.e164, reason: c.reason.map { PhoneRejectReason(fromString: $0.name)! })
  }

  func requestOtp(phone: String) throws -> Promise<OtpSendResult> {
    return Promise.async { [core] in
      let r = try await core.requestOtp(phone: phone)
      return OtpSendResult(outcome: OtpSendOutcome(fromString: r.outcome.name)!, resendAt: Double(r.resendAt))
    }
  }

  func verifyOtp(phone: String, code: String) throws -> Promise<OtpVerifyResult> {
    return Promise.async { [core] in
      let r = try await core.verifyOtp(phone: phone, code: code)
      return OtpVerifyResult(
        outcome: OtpVerifyOutcome(fromString: r.outcome.name)!,
        attemptsLeft: r.attemptsLeft.map { Double($0.int32Value) },
        retryAt: r.retryAt.map { Double($0.int64Value) }
      )
    }
  }

  func resetAuth() throws -> Promise<Void> {
    return Promise.async { [core] in try await core.resetAuth() }
  }

  func logout() throws -> Promise<Void> {
    return Promise.async { [core] in try await core.logout() }
  }

  func getAutoLockTimeout() throws -> Promise<Double> {
    return Promise.async { [core] in Double(try await core.getAutoLockTimeout().int64Value) }
  }

  func getBiometricStatus() throws -> Promise<BiometricStatus> {
    return Promise.async { [core] in
      let s = try await core.getBiometricStatus()
      return BiometricStatus(
        available: s.available,
        reason: s.reason.map { BiometricUnavailableReason(fromString: $0.name)! },
        kind: s.kind.map { BiometricKind(fromString: $0.name)! },
        enabled: s.enabled
      )
    }
  }

  func enableBiometrics(pin: String, prompt: BiometricPromptText) throws -> Promise<BiometricEnableResult> {
    let kPrompt = PocketlyShared.BiometricPromptText(title: prompt.title, subtitle: prompt.subtitle, cancel: prompt.cancel)
    return Promise.async { [core] in
      let r = try await core.enableBiometrics(pin: pin, prompt: kPrompt)
      return BiometricEnableResult(
        outcome: BiometricEnableOutcome(fromString: r.outcome.name)!,
        attemptsLeft: r.attemptsLeft.map { Double($0.int32Value) },
        lockedUntil: r.lockedUntil.map { Double($0.int64Value) }
      )
    }
  }

  func disableBiometrics() throws -> Promise<Void> {
    return Promise.async { [core] in try await core.disableBiometrics() }
  }

  func unlockWithBiometrics(prompt: BiometricPromptText) throws -> Promise<BiometricUnlockResult> {
    let kPrompt = PocketlyShared.BiometricPromptText(title: prompt.title, subtitle: prompt.subtitle, cancel: prompt.cancel)
    return Promise.async { [core] in
      let r = try await core.unlockWithBiometrics(prompt: kPrompt)
      return BiometricUnlockResult(outcome: BiometricUnlockOutcome(fromString: r.outcome.name)!, pinLockedOut: r.pinLockedOut)
    }
  }

  // Converted inside the promise: a bad value rejects (INVALID_ARGUMENT), as in jsCore.
  func setAutoLockTimeout(ms: Double) throws -> Promise<Void> {
    return Promise.async { [core, convert] in
      try await core.setAutoLockTimeout(ms: try convert.toLongExact(value: ms, field: "ms"))
    }
  }

  func parseMoney(input: String) throws -> MoneyParseResult {
    let r = core.parseMoney(input: input)
    return MoneyParseResult(
      ok: r.ok,
      minor: r.minorUnits.map { Double($0.int64Value) },
      error: r.error.map { MoneyParseError(fromString: $0.name)! }
    )
  }

  func subscribePrices(
    symbols: [String],
    intervalMs: Double,
    seed: Double,
    onTicks: @escaping (_ ticks: [PriceTick]) -> Void
  ) throws -> (any HybridPriceSubscriptionSpec) {
    let cancellable = core.subscribePrices(
      symbols: symbols,
      intervalMs: try convert.toLongExact(value: intervalMs, field: "intervalMs"),
      seed: try convert.toIntExact(value: seed, field: "seed"),
      onTicks: { ticks in onTicks(ticks.map { $0.toNitro() }) }
    )
    return HybridPriceSubscription(cancellable: cancellable)
  }

  func lastComputeMs() throws -> Double {
    return core.lastComputeMs()
  }

  func lastStorageMs() throws -> Double {
    return core.lastStorageMs()
  }
}

final class HybridPriceSubscription: HybridPriceSubscriptionSpec {
  private let cancellable: PocketlyShared.Cancellable

  init(cancellable: PocketlyShared.Cancellable) {
    self.cancellable = cancellable
  }

  func unsubscribe() throws {
    cancellable.cancel()
  }
}

// MARK: - Nitro structs → Kotlin domain

private extension Transaction {
  /// Shape only: the fake server validates the values like ingest input (INVALID_ARGUMENT).
  func toDomain(_ convert: PocketlyShared.BridgeConversions) throws -> PocketlyShared.Transaction {
    PocketlyShared.Transaction(
      id: id,
      idempotencyKey: idempotencyKey,
      type: PocketlyShared.TransactionType.entries.first { $0.name == type.stringValue }!,
      category: PocketlyShared.Category.entries.first { $0.name == category.stringValue }!,
      amount: try convert.toLongExact(value: amount, field: "amount"),
      counterparty: counterparty.map { c in
        PocketlyShared.Counterparty(
          kind: PocketlyShared.CounterpartyKind.entries.first { $0.name == c.kind.stringValue }!,
          id: c.id,
          name: c.name,
          phone: c.phone
        )
      },
      note: note,
      status: PocketlyShared.TransactionStatus.entries.first { $0.name == status.stringValue }!,
      failureReason: failureReason.map { r in PocketlyShared.ErrorCode.entries.first { $0.name == r.stringValue }! },
      createdAt: try convert.toLongExact(value: createdAt, field: "createdAt"),
      updatedAt: try convert.toLongExact(value: updatedAt, field: "updatedAt")
    )
  }
}

// MARK: - Kotlin domain → Nitro structs

private extension PocketlyShared.StaleInfo {
  func toNitro() -> StaleInfo {
    StaleInfo(reason: ErrorCode(fromString: reason.name)!, cachedAt: Double(cachedAt))
  }
}

private extension PocketlyShared.Wallet {
  func toNitro() -> Wallet {
    Wallet(
      id: id,
      balance: Double(balance),
      dailyLimit: Double(dailyLimit),
      usedToday: Double(usedToday),
      updatedAt: Double(updatedAt),
      stale: stale?.toNitro()
    )
  }
}

private extension PocketlyShared.Transaction {
  func toNitro() -> Transaction {
    Transaction(
      id: id,
      idempotencyKey: idempotencyKey,
      type: TransactionType(fromString: type.name)!,
      category: Category(fromString: category.name)!,
      amount: Double(amount),
      counterparty: counterparty.map { c in
        Counterparty(kind: CounterpartyKind(fromString: c.kind.name)!, id: c.id, name: c.name, phone: c.phone)
      },
      note: note,
      status: TransactionStatus(fromString: status.name)!,
      failureReason: failureReason.map { ErrorCode(fromString: $0.name)! },
      createdAt: Double(createdAt),
      updatedAt: Double(updatedAt)
    )
  }
}

private extension PocketlyShared.TransactionPage {
  func toNitro() -> TransactionPage {
    TransactionPage(items: items.map { $0.toNitro() }, nextCursor: nextCursor, stale: stale?.toNitro())
  }
}

private extension PocketlyShared.SpendingSummary {
  func toNitro() -> SpendingSummary {
    SpendingSummary(
      month: month,
      totalSpent: Double(totalSpent),
      totalIncome: Double(totalIncome),
      net: Double(net),
      transactionCount: Double(transactionCount),
      byCategory: byCategory.map {
        CategoryTotal(category: Category(fromString: $0.category.name)!, total: Double($0.total), count: Double($0.count))
      },
      byDay: byDay.map { DayTotal(date: $0.date, spent: Double($0.spent), income: Double($0.income)) },
      balanceCheck: BalanceCheck(
        ledgerBalance: Double(balanceCheck.ledgerBalance),
        walletBalance: Double(balanceCheck.walletBalance),
        consistent: balanceCheck.consistent
      )
    )
  }
}

private extension PocketlyShared.IngestResult {
  func toNitro() -> IngestResult {
    IngestResult(
      accepted: Double(accepted),
      rejected: Double(rejected),
      duplicates: Double(duplicates),
      errors: errors.map { IngestError(index: Double($0.index), reason: IngestRejectReason(fromString: $0.reason.name)!) }
    )
  }
}

private extension PocketlyShared.PriceTick {
  func toNitro() -> PriceTick {
    PriceTick(symbol: symbol, price: Double(price), changeBps: Double(changeBps), seq: Double(seq))
  }
}
