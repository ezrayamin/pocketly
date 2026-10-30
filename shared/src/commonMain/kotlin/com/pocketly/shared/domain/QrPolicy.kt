package com.pocketly.shared.domain

/**
 * QR codes (FR-QR-02, ADR-0016 §3): strict parsing of `pocketly://pay/v1?m=…[&r=…]` and
 * `pocketly://user/v1?u=…`. Total: every input gets a QrCode, nothing throws (NFR-REL-02). Cases
 * in fixtures/qr.json. Mirrors packages/core-js/src/domain/qrPolicy.ts.
 */
object QrPolicy {
    /** Longest code read, in UTF-16 code units (QR_MAX_LENGTH). */
    const val MAX_LENGTH = 256

    /** Merchant, payment request and user ids. Full matches only: `$` alone would allow a final line break. */
    private val ID = Regex("""[A-Za-z0-9-]{1,32}""")
    private val HEAD = Regex("""^pocketly://([a-z]+)/""")
    private val VERSION = Regex("""^v([0-9]+)\?""")
    private val PAIR = Regex("""([a-z]+)=(.*)""", RegexOption.DOT_MATCHES_ALL)

    private class Spec(val kind: QrKind, val required: List<String>, val optional: List<String>)

    private val KINDS = mapOf(
        "pay" to Spec(QrKind.MERCHANT, listOf("m"), listOf("r")),
        "user" to Spec(QrKind.USER, listOf("u"), emptyList()),
    )

    private val MALFORMED = QrCode(QrRejectReason.MALFORMED)

    fun parse(text: String): QrCode {
        if (text.length > MAX_LENGTH) return QrCode(QrRejectReason.TOO_LONG)
        val head = HEAD.find(text) ?: return MALFORMED
        val spec = KINDS[head.groupValues[1]] ?: return QrCode(QrRejectReason.UNKNOWN_KIND)
        val rest = text.substring(head.value.length)
        val version = VERSION.find(rest) ?: return MALFORMED
        if (version.groupValues[1] != "1") return QrCode(QrRejectReason.UNSUPPORTED_VERSION)

        val params = mutableMapOf<String, String>()
        for (pair in rest.substring(version.value.length).split('&')) {
            val match = PAIR.matchEntire(pair) ?: return MALFORMED
            val (name, value) = match.destructured
            val known = name in spec.required || name in spec.optional
            if (!known || name in params || !ID.matches(value)) return MALFORMED
            params[name] = value
        }
        if (!spec.required.all { it in params }) return MALFORMED

        return when (spec.kind) {
            QrKind.USER -> QrCode(kind = QrKind.USER, userId = params.getValue("u"))
            QrKind.MERCHANT -> QrCode(kind = QrKind.MERCHANT, merchantId = params.getValue("m"), requestId = params["r"])
        }
    }

    /** F8: the code My QR shows for this account's user id. */
    fun userPayload(userId: String): String = "pocketly://user/v1?u=$userId"
}
