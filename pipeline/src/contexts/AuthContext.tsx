/* eslint-disable react-refresh/only-export-components -- idiomatic context: provider component + useAuth hook co-located */
import { createContext, useContext, useState, useEffect, useMemo, useCallback } from 'react'
import type { ReactNode } from 'react'
import type { User } from '../types'
import { auth, db } from '../lib/firebase'
import { storage } from '../lib/storage'
import {
  onAuthStateChanged,
  RecaptchaVerifier,
  signInWithPhoneNumber,
  GoogleAuthProvider,
  signInWithPopup,
  type ConfirmationResult,
} from 'firebase/auth'
import { doc, onSnapshot, getDoc } from 'firebase/firestore'
import { logger } from '../lib/logger'
import { getErrorMessage, getErrorCode } from '../lib/utils'
import { userService } from '../services/userService'
import { normalizePhone } from '../services/userMerge'

interface AuthContextType {
  user: User | null
  loading: boolean
  error: string | null
  signInWithGoogle: () => Promise<void>
  signInWithPhone: (phoneNumber: string) => Promise<void>
  loginWithPhone: (phoneNumber: string) => Promise<void>
  loginAsGuest: (phoneNumber: string) => Promise<void>
  sendOTP: (phoneNumber: string, recaptchaContainerId?: string) => Promise<void>
  verifyOTP: (otp: string) => Promise<void>
  logout: () => Promise<void>
  updateUserProfile: (data: Partial<User>) => Promise<void>
  clearError: () => void
}

const AuthContext = createContext<AuthContextType | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Firebase auth state observer - DOES NOT call API on every reload
  // Only loads stored user data from storage
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
      if (firebaseUser) {
        // User is signed in to Firebase - check if we have stored user data
        try {
          const storedUser = await storage.get('mock_user')
          if (storedUser) {
            // Use stored user data - DO NOT call API again
            setUser(JSON.parse(storedUser))
            logger.debug('auth.user.loaded_from_storage')
          } else {
            // No stored user but Firebase has auth - this shouldn't happen often
            // Only call API if we have phone number and no stored data
            if (firebaseUser.phoneNumber) {
              await syncUserWithAPI(firebaseUser.phoneNumber)
            }
          }
        } catch (e) {
          logger.error('auth.storage_load_failed', e)
          // Fallback: try to sync if phone available
          if (firebaseUser.phoneNumber) {
            try {
              await syncUserWithAPI(firebaseUser.phoneNumber)
            } catch (syncErr) {
              logger.error('auth.sync_fallback_failed', syncErr)
            }
          }
        }
      } else {
        storage.remove('mock_user').catch(() => {})
        setUser(null)
      }
      setLoading(false)
    })

    return () => unsubscribe()
  }, [])

  // Sync user data from Firestore — called during login.
  //
  // All id decisions funnel through userService.resolveOrCreateUserDoc so
  // the phoneToUid index stays the single source of truth. Before this
  // rewire, each auth path picked its own id (firebaseUid OR cleanPhone OR
  // offline_<phone>) and wrote straight to users/{x}, which is how phone
  // 9985590477 ended up owning five different docs.
  const syncUserWithAPI = async (phoneNumber: string) => {
    try {
      const cleanPhone = normalizePhone(phoneNumber)
      const { canonicalId } = await userService.resolveOrCreateUserDoc({
        firebaseUid: auth.currentUser?.uid ?? null,
        phone: phoneNumber,
        displayName: auth.currentUser?.displayName ?? undefined,
        email: auth.currentUser?.email ?? undefined,
      })

      const userRef = doc(db, 'users', canonicalId)
      const userSnap = await getDoc(userRef)

      if (userSnap.exists()) {
        const data = userSnap.data()

        // Blacklisted customers cannot use the app at all.
        if (data.blacklisted === true) {
          await auth.signOut()
          await storage.remove('mock_user')
          setUser(null)
          setError('Your account has been suspended. Contact support.')
          setLoading(false)
          return
        }

        const userObj: User = {
          id: canonicalId,
          email: data.email || auth.currentUser?.email || '',
          displayName: data.displayName || data.name || auth.currentUser?.displayName || 'Guest',
          phone: data.phone || cleanPhone,
          tires: data.tires || 0,
          walletBalance: data.walletBalance || 0,
          tier: (data.tier?.toLowerCase() as string | undefined) || 'bronze',
          referralCode: data.referralCode || 'USER' + canonicalId.slice(-6).toUpperCase(),
          createdAt: data.createdAt?.toDate?.() || new Date(),
          updatedAt: data.updatedAt?.toDate?.() || new Date(),
          isVerified: data.isVerified || false,
          referredBy: data.referredBy || '',
          locked: data.locked || false,
        }

        // Cross-doc enrichment: when a staff member (custom uid like
        // `ironman`, role:Admin) logs in via the same phone as their
        // personal customer account, `canonicalId` resolves to the
        // staff doc — which never had isVerified, tires, or
        // walletBalance set. The customer doc lives under the
        // Firebase-Auth uid that phoneToUid points at, and that one
        // does carry the verified flag and the wallet/tires history.
        // Merge the customer-side fields into the in-memory user
        // object so Profile shows the right state. Non-destructive
        // — no Firestore writes, just an in-memory union for this
        // session.
        try {
          const ptuSnap = await getDoc(doc(db, 'phoneToUid', cleanPhone))
          if (ptuSnap.exists()) {
            const ptuUid = String((ptuSnap.data() ?? {}).uid ?? '')
            if (ptuUid && ptuUid !== canonicalId) {
              const altSnap = await getDoc(doc(db, 'users', ptuUid))
              if (altSnap.exists()) {
                const alt = altSnap.data()
                if (!userObj.isVerified && alt.isVerified === true) {
                  userObj.isVerified = true
                }
                if ((!userObj.tires || userObj.tires === 0) && typeof alt.tires === 'number') {
                  userObj.tires = alt.tires
                }
                if (
                  (!userObj.walletBalance || userObj.walletBalance === 0) &&
                  typeof alt.walletBalance === 'number'
                ) {
                  userObj.walletBalance = alt.walletBalance
                }
                if (userObj.tier === 'bronze' && typeof alt.tier === 'string') {
                  userObj.tier = alt.tier.toLowerCase()
                }
                if (
                  (!userObj.displayName || userObj.displayName === 'Guest') &&
                  typeof alt.displayName === 'string' &&
                  alt.displayName
                ) {
                  userObj.displayName = alt.displayName
                }
                if (!userObj.email && typeof alt.email === 'string' && alt.email) {
                  userObj.email = alt.email
                }
                if (!userObj.referralCode?.startsWith('USER') && alt.referralCode) {
                  userObj.referralCode = String(alt.referralCode)
                }
                logger.info('auth.cross_doc_enrichment_applied', {
                  canonicalId,
                  enrichedFromUid: ptuUid,
                  appliedVerified: alt.isVerified === true,
                })
              }
            }
          }
        } catch (enrichErr) {
          logger.error('auth.cross_doc_enrichment_failed', enrichErr, { canonicalId })
        }

        setUser(userObj)
        storage
          .set('mock_user', JSON.stringify(userObj))
          .catch((e) => logger.error('auth.storage_set_failed', e))
      } else {
        // resolveOrCreateUserDoc already wrote the doc, but the read can
        // race during high-latency first logins. Seed local state and the
        // next real-time subscription will fill in the canonical profile.
        const minimalUser: User = {
          id: canonicalId,
          displayName: auth.currentUser?.displayName || 'Guest',
          phone: cleanPhone,
          tires: 0,
          walletBalance: 0,
          tier: 'bronze',
          referralCode: 'NEW',
          createdAt: new Date(),
          updatedAt: new Date(),
          isVerified: false,
        }
        setUser(minimalUser)
      }
    } catch (e) {
      logger.error('auth.sync_failed', e)
      throw e
    }
  }

  // Persist user to storage whenever it changes (backup)
  useEffect(() => {
    // Don't sync internal state to storage while we are still loading/verifying
    // This prevents wiping storage if 'user' is null during initial load
    if (loading) return

    if (user) {
      storage
        .set('mock_user', JSON.stringify(user))
        .catch((e) => logger.error('auth.storage_persist_failed', e))
    } else {
      storage.remove('mock_user').catch((e) => logger.error('auth.storage_remove_failed', e))
    }
  }, [user, loading])

  // Real-time Firestore sync for wallet balance + selected profile fields.
  // Previously this was two separate useEffect blocks, and the wallet effect
  // re-subscribed on every wallet balance change because `user.walletBalance`
  // was in its dependency array — causing a teardown/resubscribe storm any
  // time the user spent or earned wallet credit. We now key both subscriptions
  // off `user?.id` only and rely on a functional setUser to compare fields.
  const userId = user?.id
  useEffect(() => {
    if (!userId) return

    const walletRef = doc(db, 'users', userId, 'wallet', 'data')
    const userDocRef = doc(db, 'users', userId)

    const unsubWallet = onSnapshot(
      walletRef,
      (snapshot) => {
        if (!snapshot.exists()) return
        const data = snapshot.data()
        if (data.balance === undefined) return
        setUser((prev) => {
          if (!prev || prev.walletBalance === data.balance) return prev
          return { ...prev, walletBalance: data.balance }
        })
      },
      (err) => logger.error('auth.wallet.sync_failed', err),
    )

    const unsubProfile = onSnapshot(
      userDocRef,
      (snapshot) => {
        if (!snapshot.exists()) return
        const data = snapshot.data()

        // If the Owner blacklists this user in real time, force sign-out.
        if (data.blacklisted === true) {
          auth.signOut()
          storage.remove('mock_user').catch(() => {})
          setUser(null)
          setError('Your account has been suspended. Contact support.')
          return
        }

        setUser((prev) => {
          if (!prev) return null
          const updates: Partial<User> = {}
          if (data.referralCode && data.referralCode !== prev.referralCode)
            updates.referralCode = data.referralCode
          if (data.referredBy && data.referredBy !== prev.referredBy)
            updates.referredBy = data.referredBy
          if (data.locked !== undefined && data.locked !== prev.locked) updates.locked = data.locked
          if (Object.keys(updates).length === 0) return prev
          return { ...prev, ...updates }
        })
      },
      (err) => logger.error('auth.profile.sync_failed', err),
    )

    return () => {
      unsubWallet()
      unsubProfile()
    }
  }, [userId])

  const signInWithGoogle = async () => {
    setLoading(true)
    setError(null)
    try {
      const provider = new GoogleAuthProvider()
      const result = await signInWithPopup(auth, provider)
      const firebaseUser = result.user

      if (firebaseUser) {
        // If they logged in with Google, we check if we can sync
        // Note: Google sign-in might not provide a phone number
        if (firebaseUser.phoneNumber) {
          await syncUserWithAPI(firebaseUser.phoneNumber)
        } else {
          // Google without phone: still route through the helper so the
          // Firestore doc at users/{firebaseUid} is created consistently.
          await userService.resolveOrCreateUserDoc({
            firebaseUid: firebaseUser.uid,
            phone: null,
            displayName: firebaseUser.displayName ?? undefined,
            email: firebaseUser.email ?? undefined,
          })
          const minimalUser: User = {
            id: firebaseUser.uid,
            displayName: firebaseUser.displayName || 'Google User',
            email: firebaseUser.email || '',
            phone: '',
            tires: 0,
            walletBalance: 0,
            tier: 'bronze',
            referralCode: 'G' + firebaseUser.uid.slice(-4),
            createdAt: new Date(),
            updatedAt: new Date(),
            photoURL: firebaseUser.photoURL || undefined,
          }
          setUser(minimalUser)
        }
      }
    } catch (err: unknown) {
      logger.error('auth.google_signin_failed', err)
      setError(getErrorMessage(err, 'Failed to sign in with Google'))
      throw err
    } finally {
      setLoading(false)
    }
  }

  // Firebase confirmation result for OTP verification
  const [confirmationResult, setConfirmationResult] = useState<ConfirmationResult | null>(null)
  const [pendingPhone, setPendingPhone] = useState<string | null>(null)

  const [verifier, setVerifier] = useState<RecaptchaVerifier | null>(null)

  const sendOTP = async (
    phoneNumber: string,
    recaptchaContainerId: string = 'recaptcha-container',
  ) => {
    setError(null)
    try {
      // Validate phone number format (must start with +)
      if (!phoneNumber.startsWith('+')) {
        throw new Error('Phone number must include country code (e.g. +91)')
      }

      // Store phone for later use
      setPendingPhone(phoneNumber)

      // Clean up existing verifier if any
      if (verifier) {
        try {
          verifier.clear()
        } catch (e) {
          logger.warn('auth.recaptcha_clear_failed', { error: e })
        }
      }

      // Ensure the container exists
      const container = document.getElementById(recaptchaContainerId)
      if (!container) {
        throw new Error(`ReCAPTCHA container '#${recaptchaContainerId}' not found in DOM`)
      }

      // Create invisible reCAPTCHA verifier
      // Using the (auth, container, params) signature for Firebase v9+
      const newVerifier = new RecaptchaVerifier(auth, recaptchaContainerId, {
        size: 'invisible',
        callback: () => {
          logger.debug('auth.recaptcha_solved')
        },
        'expired-callback': () => {
          logger.warn('auth.recaptcha_expired')
          setError('Verification expired. Please try again.')
        },
      })

      setVerifier(newVerifier)

      // Send OTP via Firebase
      logger.debug('auth.otp.requesting')
      const result = await signInWithPhoneNumber(auth, phoneNumber, newVerifier)
      setConfirmationResult(result)
      logger.info('auth.otp.sent')
    } catch (err: unknown) {
      logger.error('auth.send_otp_failed', err)
      // Special handling for argument-error to provide more info
      if (getErrorCode(err) === 'auth/argument-error') {
        setError('Authentication configuration error. Please check your browser or try again.')
      } else {
        setError(getErrorMessage(err, 'Failed to send OTP'))
      }
      throw err
    }
  }

  const verifyOTP = async (otp: string) => {
    setLoading(true)
    setError(null)
    try {
      if (!confirmationResult) {
        throw new Error('Please request an OTP first')
      }

      // Verify OTP with Firebase
      const result = await confirmationResult.confirm(otp)

      // Sync with your API. syncUserWithAPI calls setUser internally,
      // so by the time the await returns the in-memory user reflects
      // the canonical doc (with the cross-doc enrichment merged in).
      const phoneFromResult = result.user?.phoneNumber || ''
      const phoneToVerify = phoneFromResult || pendingPhone || user?.phone || ''
      if (phoneToVerify) {
        await syncUserWithAPI(phoneToVerify)
      }

      // Flip the in-memory verified flag using the FUNCTIONAL form so
      // we layer onto the post-sync state instead of clobbering it
      // with a stale closure value of `user`. Two failure modes the
      // closure variant had:
      //   - pre-OTP `user` was null (Admin not yet logged into the
      //     customer app) → `if (user) { ... }` skipped the setUser
      //     entirely and "Verify Now" stuck around until reload.
      //   - pre-OTP `user` was the Admin doc (no wallet, no tier) →
      //     setUser({...user, isVerified: true}) overwrote the
      //     enriched customer-side fields the sync had just merged in.
      setUser((prev) => (prev ? { ...prev, isVerified: true } : prev))

      // Persist the flag on whichever doc resolveOrCreateUserDoc says
      // is canonical for this phone. Previously this fell back to
      // writing users/{cleanPhone} directly when no session user was
      // set — that was one of the five duplicate-creation paths.
      if (phoneToVerify) {
        try {
          const { canonicalId } = await userService.resolveOrCreateUserDoc({
            firebaseUid: auth.currentUser?.uid ?? null,
            phone: phoneToVerify,
          })
          await userService.mergeUserDoc(canonicalId, { isVerified: true })
        } catch (mergeErr) {
          logger.error('auth.verify_otp_persist_failed', mergeErr, { phoneToVerify })
        }
      }

      setPendingPhone(null)
      setConfirmationResult(null)
    } catch (err: unknown) {
      logger.error('auth.verify_otp_failed', err)
      setError('Invalid OTP code. Please try again.')
      throw err
    } finally {
      setLoading(false)
    }
  }

  const signInWithPhone = async (phoneNumber: string) => {
    await sendOTP(phoneNumber)
  }

  const loginAsGuest = async (phoneNumber: string) => {
    setLoading(true)
    setError(null)
    try {
      await syncUserWithAPI(phoneNumber)
    } catch (err: unknown) {
      logger.error('auth.guest_login_failed', err)
      setError(getErrorMessage(err, 'Failed to login as guest'))
      // Fallback create minimal user if sync fails
      const minimalUser: User = {
        id: 'guest-' + Date.now(),
        displayName: 'Guest User',
        phone: phoneNumber,
        tires: 0,
        walletBalance: 0,
        tier: 'bronze',
        referralCode: 'GUEST',
        createdAt: new Date(),
        updatedAt: new Date(),
      }
      setUser(minimalUser)
    } finally {
      setLoading(false)
    }
  }

  const loginWithPhone = async (phoneNumber: string) => {
    setLoading(true)
    setError(null)
    try {
      await syncUserWithAPI(phoneNumber)
    } catch (err: unknown) {
      logger.error('auth.phone_login_failed', err)
      setError(getErrorMessage(err, 'Failed to login'))

      // Use clean phone as ID fallback
      const cleanPhone = phoneNumber.replace(/\D/g, '').slice(-10)

      // Fallback create minimal user if sync fails
      const minimalUser: User = {
        id: cleanPhone,
        displayName: 'Guest User',
        phone: cleanPhone,
        tires: 0,
        walletBalance: 0,
        tier: 'bronze',
        referralCode: 'GUEST',
        createdAt: new Date(),
        updatedAt: new Date(),
        isVerified: false,
      }

      // Fallback-only: this entire minimalUser is disposable client state.
      // The previous code tried to read users/{cleanPhone} here to preserve
      // isVerified, but that path was one of the duplicate-creation sources
      // and the doc is gone post-dedup. On the next successful login the
      // canonical doc (via resolveOrCreateUserDoc) will restore isVerified.
      setUser(minimalUser)
      storage
        .set('mock_user', JSON.stringify(minimalUser))
        .catch((e) => logger.error('auth.storage_fallback_failed', e))
    } finally {
      setLoading(false)
    }
  }

  const logout = async () => {
    try {
      await auth.signOut()
    } catch (e) {
      logger.error('auth.signout_failed', e)
    }
    await storage.remove('mock_user')
    setUser(null)
    window.location.reload()
  }

  const updateUserProfile = async (updateData: Partial<User>) => {
    if (!user) return
    setLoading(true)
    setError(null)
    try {
      const name = updateData.displayName || user.displayName
      const email = updateData.email || user.email || ''
      const mobile = (updateData.phone || user.phone || '').replace(/\D/g, '').slice(-10)

      if (!mobile) {
        throw new Error('Mobile number is required for update')
      }

      // Route profile updates through userService so every `users/{id}`
      // write goes through one choke point (same rule as logins).
      await userService.mergeUserDoc(user.id, {
        displayName: name,
        name,
        email,
        phone: mobile,
      })

      setUser({
        ...user,
        displayName: name || user.displayName,
        email: email || user.email,
        updatedAt: new Date(),
      })
    } catch (err: unknown) {
      logger.error('auth.profile_update_failed', err)
      setError(getErrorMessage(err, 'Failed to update profile'))
      throw err
    } finally {
      setLoading(false)
    }
  }

  const clearError = useCallback(() => setError(null), [])

  // Memoize the provider value so consumers (Profile, Cart, Header, MyBookings,
  // Checkout, etc.) only re-render when user/loading/error change. Without this
  // every wallet snapshot fired a new value object identity and cascaded a full
  // tree re-render across the whole customer app. Action methods are listed in
  // deps for completeness; most are recreated each render but the dominant
  // re-render driver in practice is `user` state.
  const value = useMemo<AuthContextType>(
    () => ({
      user,
      loading,
      error,
      signInWithGoogle,
      signInWithPhone,
      loginAsGuest,
      sendOTP,
      verifyOTP,
      logout,
      updateUserProfile,
      clearError,
      loginWithPhone,
    }),
    // Action methods are intentionally omitted: they are recreated on every
    // render, but they close over component state and including them would
    // defeat the memo. Consumers calling them at click-time still get the
    // current closure. The dominant identity changes are user/loading/error.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [user, loading, error, clearError],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const context = useContext(AuthContext)
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider')
  }
  return context
}
