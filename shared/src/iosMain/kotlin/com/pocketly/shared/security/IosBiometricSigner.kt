package com.pocketly.shared.security

import com.pocketly.shared.domain.BiometricKind
import com.pocketly.shared.domain.BiometricPromptText
import com.pocketly.shared.domain.BiometricUnavailableReason
import kotlinx.cinterop.BetaInteropApi
import kotlinx.cinterop.CPointer
import kotlinx.cinterop.ExperimentalForeignApi
import kotlinx.cinterop.MemScope
import kotlinx.cinterop.ObjCObjectVar
import kotlinx.cinterop.addressOf
import kotlinx.cinterop.alloc
import kotlinx.cinterop.convert
import kotlinx.cinterop.get
import kotlinx.cinterop.memScoped
import kotlinx.cinterop.ptr
import kotlinx.cinterop.reinterpret
import kotlinx.cinterop.usePinned
import kotlinx.cinterop.value
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.IO
import kotlinx.coroutines.withContext
import platform.CoreFoundation.CFDataCreate
import platform.CoreFoundation.CFDataGetBytePtr
import platform.CoreFoundation.CFDataGetLength
import platform.CoreFoundation.CFDataRef
import platform.CoreFoundation.CFDictionaryAddValue
import platform.CoreFoundation.CFDictionaryCreateMutable
import platform.CoreFoundation.CFDictionaryRef
import platform.CoreFoundation.CFErrorGetCode
import platform.CoreFoundation.CFErrorRefVar
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
import platform.Foundation.NSError
import platform.Foundation.NSUserDefaults
import platform.Foundation.base64EncodedStringWithOptions
import platform.Foundation.create
import platform.LocalAuthentication.LABiometryTypeFaceID
import platform.LocalAuthentication.LABiometryTypeOpticID
import platform.LocalAuthentication.LABiometryTypeTouchID
import platform.LocalAuthentication.LAContext
import platform.LocalAuthentication.LAErrorBiometryLockout
import platform.LocalAuthentication.LAErrorBiometryNotAvailable
import platform.LocalAuthentication.LAErrorBiometryNotEnrolled
import platform.LocalAuthentication.LAErrorPasscodeNotSet
import platform.LocalAuthentication.LAErrorSystemCancel
import platform.LocalAuthentication.LAErrorUserCancel
import platform.LocalAuthentication.LAErrorUserFallback
import platform.LocalAuthentication.LAErrorAppCancel
import platform.LocalAuthentication.LAPolicyDeviceOwnerAuthenticationWithBiometrics
import platform.Security.SecAccessControlCreateWithFlags
import platform.Security.SecItemCopyMatching
import platform.Security.SecItemDelete
import platform.Security.SecKeyCopyExternalRepresentation
import platform.Security.SecKeyCopyPublicKey
import platform.Security.SecKeyCreateRandomKey
import platform.Security.SecKeyCreateSignature
import platform.Security.SecKeyRef
import platform.Security.errSecItemNotFound
import platform.Security.errSecSuccess
import platform.Security.errSecUserCanceled
import platform.Security.kSecAccessControlBiometryCurrentSet
import platform.Security.kSecAccessControlPrivateKeyUsage
import platform.Security.kSecAttrAccessControl
import platform.Security.kSecAttrAccessibleWhenPasscodeSetThisDeviceOnly
import platform.Security.kSecAttrApplicationTag
import platform.Security.kSecAttrIsPermanent
import platform.Security.kSecAttrKeySizeInBits
import platform.Security.kSecAttrKeyType
import platform.Security.kSecAttrKeyTypeECSECPrimeRandom
import platform.Security.kSecAttrTokenID
import platform.Security.kSecAttrTokenIDSecureEnclave
import platform.Security.kSecClass
import platform.Security.kSecClassKey
import platform.Security.kSecKeyAlgorithmECDSASignatureMessageX962SHA256
import platform.Security.kSecPrivateKeyAttrs
import platform.Security.kSecReturnRef
import platform.Security.kSecUseAuthenticationContext

/**
 * kmpCore's biometric key on iOS (ADR-0012). EC P-256 created in the Secure Enclave, usable only
 * with the currently enrolled biometrics (`.biometryCurrentSet`) for each signature
 * (`.privateKeyUsage`), only while a passcode is set and only on this device
 * (`WhenPasscodeSetThisDeviceOnly`). The system shows Face ID / Touch ID when the key signs;
 * there's no passcode fallback (the policy is biometrics-only; the cancel button leads to our PIN).
 *
 * A changed biometric set makes the key refuse to sign; to tell that apart from other failures,
 * the policy's domain state is saved when the key is made and compared before each signature,
 * as Apple suggests. Written without a run on a device yet (2026-10-13).
 */
@OptIn(ExperimentalForeignApi::class, BetaInteropApi::class)
class IosBiometricSigner(private val tag: String = TAG) : BiometricSigner {

    override suspend fun hardware(): SignerHardware = memScoped {
        val context = LAContext()
        val error = alloc<ObjCObjectVar<NSError?>>()
        if (context.canEvaluatePolicy(LAPolicyDeviceOwnerAuthenticationWithBiometrics, error.ptr)) {
            val kind = when (context.biometryType) {
                LABiometryTypeTouchID -> BiometricKind.FINGERPRINT
                LABiometryTypeFaceID -> BiometricKind.FACE
                LABiometryTypeOpticID -> BiometricKind.IRIS
                else -> BiometricKind.OTHER
            }
            return@memScoped SignerHardware(available = true, kind = kind)
        }
        val reason = when (error.value?.code) {
            LAErrorBiometryNotEnrolled, LAErrorPasscodeNotSet -> BiometricUnavailableReason.NOT_ENROLLED
            LAErrorBiometryNotAvailable -> BiometricUnavailableReason.NO_HARDWARE
            LAErrorBiometryLockout -> BiometricUnavailableReason.TEMPORARILY_UNAVAILABLE
            else -> BiometricUnavailableReason.TEMPORARILY_UNAVAILABLE
        }
        SignerHardware(available = false, reason = reason)
    }

    override suspend fun createKey(): ByteArray = withContext(Dispatchers.IO) {
        deleteKeyNow()
        memScoped {
            val error = alloc<CFErrorRefVar>()
            val access = SecAccessControlCreateWithFlags(
                null,
                kSecAttrAccessibleWhenPasscodeSetThisDeviceOnly,
                kSecAccessControlBiometryCurrentSet or kSecAccessControlPrivateKeyUsage,
                error.ptr,
            ) ?: error("access control: ${error.value?.let(::CFErrorGetCode)}")
            defer { CFRelease(access) }
            val privateAttrs = dictionary(
                kSecAttrIsPermanent to kCFBooleanTrue,
                kSecAttrApplicationTag to cf(tag.encodeToByteArray()),
                kSecAttrAccessControl to access,
            )
            val attrs = dictionary(
                kSecAttrKeyType to kSecAttrKeyTypeECSECPrimeRandom,
                kSecAttrKeySizeInBits to cf(256),
                kSecAttrTokenID to kSecAttrTokenIDSecureEnclave,
                kSecPrivateKeyAttrs to privateAttrs,
            )
            val privateKey = SecKeyCreateRandomKey(attrs, error.ptr) ?: error("Secure Enclave key: ${error.value?.let(::CFErrorGetCode)}")
            defer { CFRelease(privateKey) }
            val publicKey = SecKeyCopyPublicKey(privateKey) ?: error("no public key")
            defer { CFRelease(publicKey) }
            val raw = SecKeyCopyExternalRepresentation(publicKey, error.ptr) ?: error("public key export")
            defer { CFRelease(raw) }
            saveDomainState()
            P256_SPKI_HEADER + raw.toByteArray() // X.509 SubjectPublicKeyInfo DER
        }
    }

    override suspend fun sign(message: ByteArray, prompt: BiometricPromptText): SignResult = withContext(Dispatchers.IO) {
        if (domainStateChanged()) return@withContext SignResult.Invalidated
        memScoped {
            val context = LAContext().apply {
                localizedReason = prompt.title
                localizedCancelTitle = prompt.cancel
                localizedFallbackTitle = "" // no "Enter Passcode" button: the fallback is our PIN
            }
            val query = dictionary(
                kSecClass to kSecClassKey,
                kSecAttrApplicationTag to cf(tag.encodeToByteArray()),
                kSecAttrKeyType to kSecAttrKeyTypeECSECPrimeRandom,
                kSecReturnRef to kCFBooleanTrue,
                kSecUseAuthenticationContext to cf(context),
            )
            val found = alloc<CFTypeRefVar>()
            when (val status = SecItemCopyMatching(query, found.ptr)) {
                errSecSuccess -> Unit
                errSecItemNotFound -> return@memScoped SignResult.Invalidated // e.g. the passcode was removed
                else -> error("key lookup failed: $status") // temporary (e.g. device locked)
            }
            val key: SecKeyRef = found.value!!.reinterpret()
            defer { CFRelease(key) }
            val error = alloc<CFErrorRefVar>()
            // Blocks until the user answers Face ID / Touch ID: we're on Dispatchers.IO.
            val signature = SecKeyCreateSignature(key, kSecKeyAlgorithmECDSASignatureMessageX962SHA256, cf(message)?.reinterpret(), error.ptr)
            if (signature != null) {
                defer { CFRelease(signature) }
                return@memScoped SignResult.Signed(signature.toByteArray())
            }
            when (val code = error.value?.let(::CFErrorGetCode)?.toLong()) {
                LAErrorUserCancel, LAErrorSystemCancel, LAErrorAppCancel, LAErrorUserFallback, errSecUserCanceled.toLong() -> SignResult.Cancelled
                LAErrorBiometryLockout -> SignResult.LockedOut
                LAErrorBiometryNotEnrolled -> SignResult.Invalidated
                else -> error("signing failed: $code") // temporary
            }
        }
    }

    override suspend fun deleteKey() = withContext(Dispatchers.IO) { deleteKeyNow() }

    private fun deleteKeyNow() = memScoped {
        SecItemDelete(dictionary(kSecClass to kSecClassKey, kSecAttrApplicationTag to cf(tag.encodeToByteArray())))
        NSUserDefaults.standardUserDefaults.removeObjectForKey(domainStateKey)
    }

    // ── enrolled-biometrics fingerprint (LAContext.evaluatedPolicyDomainState) ──────────────

    private val domainStateKey get() = "$tag.domainState"

    private fun currentDomainState(): String? {
        val context = LAContext()
        context.canEvaluatePolicy(LAPolicyDeviceOwnerAuthenticationWithBiometrics, null)
        return context.evaluatedPolicyDomainState?.base64EncodedStringWithOptions(0u)
    }

    private fun saveDomainState() {
        NSUserDefaults.standardUserDefaults.setObject(currentDomainState(), domainStateKey)
    }

    /** True if biometrics were enrolled or removed since the key was made. */
    private fun domainStateChanged(): Boolean {
        val saved = NSUserDefaults.standardUserDefaults.stringForKey(domainStateKey) ?: return false
        val now = currentDomainState() ?: return true // no biometrics enrolled any more
        return saved != now
    }

    // ── CF plumbing ─────────────────────────────────────────────────────────────────────────

    /** A CF dictionary released when the scope ends; it retains its own keys and values. */
    private fun MemScope.dictionary(vararg entries: Pair<CFStringRef?, CFTypeRef?>): CFDictionaryRef? {
        val dict = CFDictionaryCreateMutable(null, entries.size.convert(), kCFTypeDictionaryKeyCallBacks.ptr, kCFTypeDictionaryValueCallBacks.ptr)
        entries.forEach { (k, v) -> CFDictionaryAddValue(dict, k, v) }
        defer { CFRelease(dict) }
        return dict
    }

    /** A retained CF object (NSData, NSNumber, LAContext…) released when the scope ends. */
    private fun MemScope.cf(value: Any): CFTypeRef? {
        val ref = CFBridgingRetain(if (value is ByteArray) value.toNSData() else value)
        defer { CFRelease(ref) }
        return ref
    }

    private companion object {
        const val TAG = "com.pocketly.biometric.v1"

        /** SPKI DER for P-256 = this fixed 26-byte header + the 65-byte uncompressed point. */
        val P256_SPKI_HEADER = byteArrayOf(
            0x30, 0x59, 0x30, 0x13, 0x06, 0x07, 0x2a, 0x86.toByte(), 0x48, 0xce.toByte(), 0x3d, 0x02, 0x01,
            0x06, 0x08, 0x2a, 0x86.toByte(), 0x48, 0xce.toByte(), 0x3d, 0x03, 0x01, 0x07, 0x03, 0x42, 0x00,
        )
    }
}

@OptIn(ExperimentalForeignApi::class)
private fun CFDataRef.toByteArray(): ByteArray {
    val length = CFDataGetLength(this).toInt()
    val bytes = CFDataGetBytePtr(this) ?: return ByteArray(0)
    return ByteArray(length) { bytes[it].toByte() }
}

@OptIn(ExperimentalForeignApi::class, BetaInteropApi::class)
private fun ByteArray.toNSData(): NSData =
    if (isEmpty()) NSData() else usePinned { NSData.create(bytes = it.addressOf(0), length = size.convert()) }
