package com.pocketly.shared.data

import com.pocketly.shared.domain.Contact
import com.pocketly.shared.domain.PhoneLookup
import com.pocketly.shared.security.PhonePolicy

data class DirectoryMatch(val contacts: List<Contact>, val phoneLookup: PhoneLookup?)

/**
 * FR-TRF-01 (ADR-0014): find contacts by name or phone. Cases in fixtures/transfer.json →
 * search. The fake server matches its directory with [match]; the core adds what only it knows
 * (the user's own phone) with [search]. Mirrors packages/core-js/src/data/contactSearch.ts.
 */
object ContactSearch {
    private val PHONE_LIKE = Regex("""^\+?[0-9 -]+$""")
    private val COUNTRY_DIGITS = PhonePolicy.COUNTRY_CODE.removePrefix("+")

    /** Sealed result of reading a query as a phone number. */
    private sealed interface Digits {
        data object NotPhone : Digits
        data object Foreign : Digits
        data class National(val digits: String) : Digits
    }

    /** The national digits of a phone-like query, with one leading 0 dropped ("" matches everyone). */
    private fun nationalDigits(query: String): Digits {
        if (!PHONE_LIKE.matches(query)) return Digits.NotPhone
        var digits = query.filter { it in '0'..'9' }
        if (query.startsWith("+")) {
            if (!digits.startsWith(COUNTRY_DIGITS)) return Digits.Foreign
            digits = digits.removePrefix(COUNTRY_DIGITS)
        }
        return Digits.National(digits.removePrefix("0"))
    }

    /** The E.164 number when the query is a complete phone number PhonePolicy accepts. */
    fun queryPhone(query: String): String? {
        val digits = nationalDigits(query.trim()) as? Digits.National ?: return null
        return PhonePolicy.check(digits.digits).e164
    }

    /** Contacts matching the query, sorted by name then id. An empty query matches everyone. */
    fun match(query: String, directory: List<Contact>): List<Contact> {
        val q = query.trim()
        val matches = if (q.isEmpty()) {
            directory
        } else {
            when (val digits = nationalDigits(q)) {
                Digits.Foreign -> emptyList()
                is Digits.National -> directory.filter { it.phone.removePrefix(PhonePolicy.COUNTRY_CODE).contains(digits.digits) }
                Digits.NotPhone -> {
                    val needle = q.lowercase()
                    directory.filter { it.name.lowercase().contains(needle) }
                }
            }
        }
        return matches.sortedWith(compareBy<Contact> { it.name }.thenBy { it.userId })
    }

    /** What searchContacts returns, minus the recent list: never [selfPhone], plus the lookup. */
    fun search(query: String, directory: List<Contact>, selfPhone: String?): DirectoryMatch {
        val contacts = match(query, directory).filter { it.phone != selfPhone }
        val phone = queryPhone(query) ?: return DirectoryMatch(contacts, null)
        val lookup = when {
            phone == selfPhone -> PhoneLookup.SELF
            contacts.any { it.phone == phone } -> PhoneLookup.FOUND
            else -> PhoneLookup.NOT_FOUND
        }
        return DirectoryMatch(contacts, lookup)
    }
}
