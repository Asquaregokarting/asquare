import {
  createFirestoreContact,
  listFirestoreContacts,
  removeFirestoreContact,
  updateFirestoreContact
} from "./contacts-firestore";
import { ContactRecord } from "./types";

export const contactsApi = {
  list(token: string, query?: { q?: string }): Promise<{ contacts: ContactRecord[] }> {
    return listFirestoreContacts(token, query).then((contacts) => ({ contacts }));
  },
  create(
    token: string,
    payload: { name: string; phone: string; email?: string; notes?: string }
  ): Promise<{ contact: ContactRecord }> {
    return createFirestoreContact(token, payload).then((contact) => ({ contact }));
  },
  update(
    token: string,
    contactId: string,
    payload: Partial<{ name: string; phone: string; email?: string; notes?: string }>
  ): Promise<{ contact: ContactRecord }> {
    return updateFirestoreContact(token, contactId, payload).then((contact) => ({ contact }));
  },
  remove(token: string, contactId: string): Promise<{ message: string }> {
    return removeFirestoreContact(token, contactId).then(() => ({ message: "Contact deleted." }));
  }
};
