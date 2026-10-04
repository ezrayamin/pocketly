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
  private let core = PocketlyShared.PocketlyCore.companion.create(dataset: PocketlyShared.DatasetConfig.companion.LIVE)
  private let convert = PocketlyShared.BridgeConversions.shared

  func resetData(config: DatasetConfig) throws -> Promise<Void> {
    var nowMillis: KotlinLong? = nil
    if let now = config.nowMillis {
      nowMillis = KotlinLong(value: try convert.toLongExact(value: now, field: "nowMillis"))
    }
    let kConfig = PocketlyShared.DatasetConfig(
      seed: try convert.toIntExact(value: config.seed, field: "seed"),
      transactionCount: try convert.toIntExact(value: config.transactionCount, field: "transactionCount"),
      nowMillis: nowMillis
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

  func setTimeZone(zoneId: String) throws {
    try core.setTimeZone(zoneId: zoneId)
  }

  func computeSpendingSummary(month: String) throws -> Promise<SpendingSummary> {
    return Promise.async { [core] in try await core.computeSpendingSummary(month: month).toNitro() }
  }

  func ingestTransactions(json: String) throws -> Promise<IngestResult> {
    return Promise.async { [core] in try await core.ingestTransactions(json: json).toNitro() }
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

private extension PocketlyShared.Wallet {
  func toNitro() -> Wallet {
    Wallet(
      id: id,
      balance: Double(balance),
      dailyLimit: Double(dailyLimit),
      usedToday: Double(usedToday),
      updatedAt: Double(updatedAt)
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
    TransactionPage(items: items.map { $0.toNitro() }, nextCursor: nextCursor)
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
