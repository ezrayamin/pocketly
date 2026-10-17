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

  func resetData(config: DatasetSeed) throws -> Promise<Void> {
    var nowMillis: KotlinLong? = nil
    if let now = config.nowMillis {
      nowMillis = KotlinLong(value: try convert.toLongExact(value: now, field: "nowMillis"))
    }
    let kConfig = PocketlyShared.DatasetConfig(
      seed: try convert.toIntExact(value: config.seed, field: "seed"),
      transactionCount: try convert.toIntExact(value: config.transactionCount, field: "transactionCount"),
      nowMillis: nowMillis,
      extraTransactions: []
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
      seed: try convert.toIntExact(value: simulation.seed ?? 1, field: "seed"),
      writeTimeoutMs: try convert.toIntExact(value: simulation.writeTimeoutMs ?? 15_000, field: "writeTimeoutMs")
    ))
  }

  func getNetworkSimulation() throws -> NetworkSimulation {
    let s = core.getNetworkSimulation()
    return NetworkSimulation(
      mode: NetworkMode(fromString: s.mode.name)!,
      failureRatePercent: Double(s.failureRatePercent),
      normalLatencyMs: Double(s.normalLatencyMs),
      readTimeoutMs: Double(s.readTimeoutMs),
      writeTimeoutMs: Double(s.writeTimeoutMs),
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

  func formatMoney(minor: Double) throws -> String {
    return core.formatMoney(minor: try convert.toLongExact(value: minor, field: "amount"))
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

  // MARK: P2P transfer (F5, ADR-0014)

  func searchContacts(query: String) throws -> Promise<ContactSearch> {
    return Promise.async { [core] in
      let r = try await core.searchContacts(query: query)
      return ContactSearch(
        recent: r.recent.map { $0.toNitro() },
        contacts: r.contacts.map { $0.toNitro() },
        phoneLookup: r.phoneLookup.map { PhoneLookup(fromString: $0.name)! }
      )
    }
  }

  func startTransfer(recipientId: String) throws -> Promise<TransferDraft> {
    return Promise.async { [core] in
      let d = try await core.startTransfer(recipientId: recipientId)
      return TransferDraft(
        recipient: d.recipient.toNitro(),
        balance: Double(d.balance),
        dailyRemaining: Double(d.dailyRemaining),
        minAmount: Double(d.minAmount),
        maxAmount: Double(d.maxAmount)
      )
    }
  }

  func checkTransferAmount(text: String) throws -> AmountCheck {
    let c = try core.checkTransferAmount(text: text)
    return AmountCheck(
      ok: c.ok,
      minor: c.minorUnits.map { Double($0.int64Value) },
      reason: c.reason.map { AmountRejectReason(fromString: $0.name)! },
      acceptInput: c.acceptInput,
      remainingBalance: c.remainingBalanceMinor.map { Double($0.int64Value) }
    )
  }

  // Converted inside the promise: a bad value rejects (INVALID_ARGUMENT), as in jsCore.
  func reviewTransfer(amount: Double, note: String?) throws -> Promise<TransferReview> {
    return Promise.async { [core, convert] in
      let r = try await core.reviewTransfer(amount: try convert.toLongExact(value: amount, field: "amount"), note: note)
      return TransferReview(
        id: r.id,
        idempotencyKey: r.idempotencyKey,
        recipient: r.recipient.toNitro(),
        amount: Double(r.amount),
        fee: Double(r.fee),
        note: r.note,
        balanceAfter: Double(r.balanceAfter)
      )
    }
  }

  func confirmTransfer(id: String, auth: TransferAuth?) throws -> Promise<TransferResult> {
    let kAuth = auth.map { a in
      PocketlyShared.TransferAuth(
        method: PocketlyShared.TransferAuthMethod.entries.first { $0.name == a.method.stringValue }!,
        pin: a.pin,
        prompt: a.prompt.map { PocketlyShared.BiometricPromptText(title: $0.title, subtitle: $0.subtitle, cancel: $0.cancel) }
      )
    }
    return Promise.async { [core] in try await core.confirmTransfer(id: id, auth: kAuth).toNitro() }
  }

  func getTransferStatus(id: String) throws -> Promise<TransferResult> {
    return Promise.async { [core] in try await core.getTransferStatus(id: id).toNitro() }
  }

  func setDailyLimit(minor: Double) throws -> Promise<Void> {
    return Promise.async { [core, convert] in
      try await core.setDailyLimit(minor: try convert.toLongExact(value: minor, field: "dailyLimit"))
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

private extension PocketlyShared.Contact {
  func toNitro() -> Contact {
    Contact(userId: userId, name: name, phone: phone)
  }
}

private extension PocketlyShared.TransferResult {
  func toNitro() -> TransferResult {
    TransferResult(
      id: id,
      state: TransferState(fromString: state.name)!,
      auth: TransferAuthOutcome(fromString: auth.name)!,
      transaction: transaction?.toNitro(),
      failureReason: failureReason.map { ErrorCode(fromString: $0.name)! },
      retryable: retryable.map { $0.boolValue },
      attemptsLeft: attemptsLeft.map { Double($0.int32Value) },
      lockedUntil: lockedUntil.map { Double($0.int64Value) },
      balance: balanceMinor.map { Double($0.int64Value) }
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

private extension PocketlyShared.PriceTick {
  func toNitro() -> PriceTick {
    PriceTick(symbol: symbol, price: Double(price), changeBps: Double(changeBps), seq: Double(seq))
  }
}
