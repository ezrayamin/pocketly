package com.pocketly.shared.security

import kotlinx.cinterop.ExperimentalForeignApi
import kotlinx.cinterop.MemScope
import kotlinx.cinterop.addressOf
import kotlinx.cinterop.alloc
import kotlinx.cinterop.convert
import kotlinx.cinterop.memScoped
import kotlinx.cinterop.ptr
import kotlinx.cinterop.usePinned
import kotlinx.cinterop.value
import platform.CoreFoundation.CFDictionaryAddValue
import platform.CoreFoundation.CFDictionaryCreateMutable
import platform.CoreFoundation.CFDictionaryRef
import platform.CoreFoundation.CFRelease
import platform.CoreFoundation.CFStringRef
import platform.CoreFoundation.CFTypeRef
import platform.CoreFoundation.CFTypeRefVar
import platform.CoreFoundation.kCFBooleanTrue
import platform.CoreFoundation.kCFTypeDictionaryKeyCallBacks
import platform.CoreFoundation.kCFTypeDictionaryValueCallBacks
import platform.Foundation.CFBridgingRelease
import platform.Foundation.CFBridgingRetain
import platform.Foundation.NSData
import platform.Foundation.NSString
import platform.Foundation.create
import platform.Security.SecItemAdd
import platform.Security.SecItemCopyMatching
import platform.Security.SecItemDelete
import platform.Security.SecItemUpdate
import platform.Security.errSecItemNotFound
import platform.Security.errSecSuccess
import platform.Security.kSecAttrAccessible
import platform.Security.kSecAttrAccessibleWhenUnlockedThisDeviceOnly
import platform.Security.kSecAttrAccount
import platform.Security.kSecAttrService
import platform.Security.kSecClass
import platform.Security.kSecClassGenericPassword
import platform.Security.kSecMatchLimit
import platform.Security.kSecMatchLimitOne
import platform.Security.kSecReturnData
import platform.Security.kSecValueData
import platform.posix.memcpy

/**
 * kmpCore's secure storage on iOS (ADR-0010): generic-password Keychain items in service
 * `com.pocketly.secure`, readable only while the device is unlocked, on this device only
 * (`WhenUnlockedThisDeviceOnly`: never in backups that restore to another device), and never
 * synchronised to iCloud Keychain (no kSecAttrSynchronizable). Writes update in place, so a
 * value is never missing between a delete and an add.
 */
@OptIn(ExperimentalForeignApi::class)
class IosSecureStore(private val service: String = SERVICE) : SecureStore {

    override fun get(key: String): String? = memScoped {
        val query = dictionary(
            kSecClass to kSecClassGenericPassword,
            kSecAttrService to cf(service),
            kSecAttrAccount to cf(key),
            kSecReturnData to kCFBooleanTrue,
            kSecMatchLimit to kSecMatchLimitOne,
        )
        val result = alloc<CFTypeRefVar>()
        when (val status = SecItemCopyMatching(query, result.ptr)) {
            errSecSuccess -> (CFBridgingRelease(result.value) as NSData).toByteArray().decodeToString()
            errSecItemNotFound -> null
            // errSecInteractionNotAllowed (-25308): the device is locked (WhenUnlocked…). That and
            // anything else is temporary: throw, never delete (ADR-0010 §2.7).
            else -> error("Keychain read failed: $status")
        }
    }

    override fun put(key: String, value: String) = memScoped {
        val match = dictionary(kSecClass to kSecClassGenericPassword, kSecAttrService to cf(service), kSecAttrAccount to cf(key))
        val data = cf(value.encodeToByteArray().toNSData())
        var status = SecItemUpdate(match, dictionary(kSecValueData to data))
        if (status == errSecItemNotFound) {
            status = SecItemAdd(
                dictionary(
                    kSecClass to kSecClassGenericPassword,
                    kSecAttrService to cf(service),
                    kSecAttrAccount to cf(key),
                    kSecValueData to data,
                    kSecAttrAccessible to kSecAttrAccessibleWhenUnlockedThisDeviceOnly,
                ),
                null,
            )
        }
        check(status == errSecSuccess) { "Keychain write failed: $status" }
    }

    override fun remove(key: String) = memScoped {
        delete(dictionary(kSecClass to kSecClassGenericPassword, kSecAttrService to cf(service), kSecAttrAccount to cf(key)))
    }

    override fun clear() = memScoped {
        delete(dictionary(kSecClass to kSecClassGenericPassword, kSecAttrService to cf(service)))
    }

    private fun delete(query: CFDictionaryRef?) {
        val status = SecItemDelete(query)
        check(status == errSecSuccess || status == errSecItemNotFound) { "Keychain delete failed: $status" }
    }

    /** A CF dictionary released when the scope ends; it retains its own keys and values. */
    private fun MemScope.dictionary(vararg entries: Pair<CFStringRef?, CFTypeRef?>): CFDictionaryRef? {
        val dict = CFDictionaryCreateMutable(null, entries.size.convert(), kCFTypeDictionaryKeyCallBacks.ptr, kCFTypeDictionaryValueCallBacks.ptr)
        entries.forEach { (k, v) -> CFDictionaryAddValue(dict, k, v) }
        defer { CFRelease(dict) }
        return dict
    }

    /** A retained CF object for [value], released when the scope ends. */
    private fun MemScope.cf(value: Any): CFTypeRef? {
        val ref = CFBridgingRetain(if (value is String) NSString.create(string = value) else value)
        defer { CFRelease(ref) }
        return ref
    }

    companion object {
        const val SERVICE = "com.pocketly.secure"
    }
}

@OptIn(ExperimentalForeignApi::class)
private fun ByteArray.toNSData(): NSData =
    if (isEmpty()) NSData() else usePinned { NSData.create(bytes = it.addressOf(0), length = size.convert()) }

@OptIn(ExperimentalForeignApi::class)
private fun NSData.toByteArray(): ByteArray {
    val out = ByteArray(length.toInt())
    if (out.isNotEmpty()) out.usePinned { memcpy(it.addressOf(0), bytes, length) }
    return out
}
