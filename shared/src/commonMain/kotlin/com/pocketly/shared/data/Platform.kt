package com.pocketly.shared.data

import com.pocketly.shared.domain.OffsetAt

/** The platform's tz data for an IANA zone id, or null if the platform doesn't know it. */
internal expect fun platformOffsetAt(zoneId: String): OffsetAt?

/** Device clock, UTC epoch milliseconds. */
internal expect fun currentTimeMillis(): Long
