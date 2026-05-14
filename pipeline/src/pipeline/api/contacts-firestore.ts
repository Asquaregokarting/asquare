import { addDoc, collection, deleteDoc, doc, getDoc, getDocs, updateDoc } from 'firebase/firestore'
import type { UpdateData, DocumentData } from 'firebase/firestore'
import { initializeFirestore } from '../lib/firebase'
import { getFirestoreSessionUser, isPrivilegedRole } from './firestore-session'
import { nowIso, toOptionalString } from './firestore-utils'
import { ContactRecord } from './types'

const CONTACTS_COLLECTION = 'contacts'
const USE_FIRESTORE_CONTACTS = import.meta.env.VITE_USE_FIRESTORE_CONTACTS !== 'false'

const mapContactRecord = (id: string, data: Record<string, unknown>): ContactRecord => {
  const createdAt = String(data.createdAt ?? nowIso())
  const updatedAt = String(data.updatedAt ?? createdAt)
  return {
    id,
    name: String(data.name ?? 'Contact'),
    phone: String(data.phone ?? ''),
    email: toOptionalString(data.email),
    notes: toOptionalString(data.notes),
    createdBy: String(data.createdBy ?? ''),
    createdAt,
    updatedAt,
  }
}

const getContactsCollection = () => {
  if (!USE_FIRESTORE_CONTACTS) {
    return null
  }
  const firestore = initializeFirestore()
  if (!firestore) {
    return null
  }
  return collection(firestore, CONTACTS_COLLECTION)
}

const sortContacts = (contacts: ContactRecord[]): ContactRecord[] =>
  [...contacts].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))

export const isFirestoreContactsActive = (): boolean => Boolean(getContactsCollection())

export const listFirestoreContacts = async (
  token: string,
  query?: { q?: string },
): Promise<ContactRecord[]> => {
  const contactsCollection = getContactsCollection()
  if (!contactsCollection) {
    throw new Error('Firestore contacts is not configured.')
  }

  await getFirestoreSessionUser(token)
  const search = query?.q?.trim().toLowerCase() ?? ''
  const snapshot = await getDocs(contactsCollection)
  const contacts = snapshot.docs.map((item) =>
    mapContactRecord(item.id, item.data() as Record<string, unknown>),
  )
  const filtered = search
    ? contacts.filter((contact) =>
        `${contact.name} ${contact.phone} ${contact.email ?? ''}`.toLowerCase().includes(search),
      )
    : contacts

  return sortContacts(filtered)
}

export const createFirestoreContact = async (
  token: string,
  payload: { name: string; phone: string; email?: string; notes?: string },
): Promise<ContactRecord> => {
  const contactsCollection = getContactsCollection()
  if (!contactsCollection) {
    throw new Error('Firestore contacts is not configured.')
  }

  const user = await getFirestoreSessionUser(token)
  const name = payload.name.trim()
  const phone = payload.phone.trim()
  if (!name) {
    throw new Error('Contact name is required.')
  }
  if (!phone) {
    throw new Error('Contact phone is required.')
  }

  const createdAt = nowIso()
  const documentBody = {
    name,
    phone,
    email: toOptionalString(payload.email),
    notes: toOptionalString(payload.notes),
    createdBy: user.id,
    createdAt,
    updatedAt: createdAt,
  }
  const created = await addDoc(contactsCollection, documentBody)
  return mapContactRecord(created.id, documentBody)
}

export const updateFirestoreContact = async (
  token: string,
  contactId: string,
  payload: Partial<{ name: string; phone: string; email?: string; notes?: string }>,
): Promise<ContactRecord> => {
  const contactsCollection = getContactsCollection()
  if (!contactsCollection) {
    throw new Error('Firestore contacts is not configured.')
  }

  const user = await getFirestoreSessionUser(token)
  const contactRef = doc(contactsCollection, contactId)
  const snapshot = await getDoc(contactRef)
  if (!snapshot.exists()) {
    throw new Error('Contact not found.')
  }

  const current = mapContactRecord(snapshot.id, snapshot.data() as Record<string, unknown>)
  if (!isPrivilegedRole(user.role) && current.createdBy !== user.id) {
    throw new Error('You are not allowed to edit this contact.')
  }

  const updatePayload: Record<string, unknown> = {
    updatedAt: nowIso(),
  }
  if (payload.name !== undefined) updatePayload.name = payload.name.trim()
  if (payload.phone !== undefined) updatePayload.phone = payload.phone.trim()
  if (payload.email !== undefined) updatePayload.email = toOptionalString(payload.email)
  if (payload.notes !== undefined) updatePayload.notes = toOptionalString(payload.notes)

  await updateDoc(contactRef, updatePayload as UpdateData<DocumentData>)
  return {
    ...current,
    ...payload,
    name: payload.name !== undefined ? payload.name.trim() : current.name,
    phone: payload.phone !== undefined ? payload.phone.trim() : current.phone,
    email: payload.email !== undefined ? toOptionalString(payload.email) : current.email,
    notes: payload.notes !== undefined ? toOptionalString(payload.notes) : current.notes,
    updatedAt: String(updatePayload.updatedAt),
  }
}

export const removeFirestoreContact = async (token: string, contactId: string): Promise<void> => {
  const contactsCollection = getContactsCollection()
  if (!contactsCollection) {
    throw new Error('Firestore contacts is not configured.')
  }

  const user = await getFirestoreSessionUser(token)
  const contactRef = doc(contactsCollection, contactId)
  const snapshot = await getDoc(contactRef)
  if (!snapshot.exists()) {
    throw new Error('Contact not found.')
  }

  const current = mapContactRecord(snapshot.id, snapshot.data() as Record<string, unknown>)
  if (!isPrivilegedRole(user.role) && current.createdBy !== user.id) {
    throw new Error('You are not allowed to delete this contact.')
  }

  await deleteDoc(contactRef)
}
