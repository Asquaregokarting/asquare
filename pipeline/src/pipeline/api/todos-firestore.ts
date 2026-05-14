import { addDoc, collection, deleteDoc, doc, getDoc, getDocs, updateDoc } from 'firebase/firestore'
import type { UpdateData, DocumentData } from 'firebase/firestore'
import { initializeFirestore } from '../lib/firebase'
import { getFirestoreSessionUser, isPrivilegedRole } from './firestore-session'
import { nowIso, toOptionalString } from './firestore-utils'
import { TodoRecord } from './types'

const TODOS_COLLECTION = 'todos'
const USE_FIRESTORE_TODOS = import.meta.env.VITE_USE_FIRESTORE_TODOS !== 'false'
const VALID_TODO_STATUS: TodoRecord['status'][] = ['Pending', 'Done']

const isTodoStatus = (value: unknown): value is TodoRecord['status'] =>
  typeof value === 'string' && VALID_TODO_STATUS.includes(value as TodoRecord['status'])

const mapTodoRecord = (id: string, data: Record<string, unknown>): TodoRecord => {
  const createdAt = String(data.createdAt ?? nowIso())
  const updatedAt = String(data.updatedAt ?? createdAt)
  return {
    id,
    title: String(data.title ?? 'Todo'),
    assignedTo: String(data.assignedTo ?? ''),
    status: isTodoStatus(data.status) ? data.status : 'Pending',
    dueDate: toOptionalString(data.dueDate),
    createdBy: String(data.createdBy ?? ''),
    createdAt,
    updatedAt,
  }
}

const getTodosCollection = () => {
  if (!USE_FIRESTORE_TODOS) {
    return null
  }
  const firestore = initializeFirestore()
  if (!firestore) {
    return null
  }
  return collection(firestore, TODOS_COLLECTION)
}

const sortTodos = (todos: TodoRecord[]): TodoRecord[] =>
  [...todos].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))

export const isFirestoreTodosActive = (): boolean => Boolean(getTodosCollection())

export const listFirestoreTodos = async (
  token: string,
  query?: { status?: TodoRecord['status']; assignee?: string; q?: string },
): Promise<TodoRecord[]> => {
  const todosCollection = getTodosCollection()
  if (!todosCollection) {
    throw new Error('Firestore todos is not configured.')
  }

  const user = await getFirestoreSessionUser(token)
  const search = query?.q?.trim().toLowerCase() ?? ''
  const requestedAssignee = query?.assignee?.trim()
  const effectiveAssignee = isPrivilegedRole(user.role) ? requestedAssignee : user.id

  const snapshot = await getDocs(todosCollection)
  const todos = snapshot.docs
    .map((item) => mapTodoRecord(item.id, item.data() as Record<string, unknown>))
    .filter((todo) => {
      if (query?.status && todo.status !== query.status) {
        return false
      }
      if (effectiveAssignee && todo.assignedTo !== effectiveAssignee) {
        return false
      }
      if (search && !todo.title.toLowerCase().includes(search)) {
        return false
      }
      return true
    })

  return sortTodos(todos)
}

export const createFirestoreTodo = async (
  token: string,
  payload: { title: string; assignedTo?: string; status?: TodoRecord['status']; dueDate?: string },
): Promise<TodoRecord> => {
  const todosCollection = getTodosCollection()
  if (!todosCollection) {
    throw new Error('Firestore todos is not configured.')
  }

  const user = await getFirestoreSessionUser(token)
  const title = payload.title.trim()
  if (!title) {
    throw new Error('Todo title is required.')
  }

  const requestedAssignee = payload.assignedTo?.trim()
  const assignedTo = isPrivilegedRole(user.role) ? requestedAssignee || user.id : user.id
  const createdAt = nowIso()
  const documentBody = {
    title,
    assignedTo,
    status: isTodoStatus(payload.status) ? payload.status : 'Pending',
    dueDate: toOptionalString(payload.dueDate),
    createdBy: user.id,
    createdAt,
    updatedAt: createdAt,
  }

  const created = await addDoc(todosCollection, documentBody)
  return mapTodoRecord(created.id, documentBody)
}

export const updateFirestoreTodo = async (
  token: string,
  todoId: string,
  payload: Partial<{
    title: string
    assignedTo: string
    status: TodoRecord['status']
    dueDate?: string
  }>,
): Promise<TodoRecord> => {
  const todosCollection = getTodosCollection()
  if (!todosCollection) {
    throw new Error('Firestore todos is not configured.')
  }

  const user = await getFirestoreSessionUser(token)
  const todoRef = doc(todosCollection, todoId)
  const snapshot = await getDoc(todoRef)
  if (!snapshot.exists()) {
    throw new Error('Todo not found.')
  }

  const current = mapTodoRecord(snapshot.id, snapshot.data() as Record<string, unknown>)
  const canMutate =
    isPrivilegedRole(user.role) || current.assignedTo === user.id || current.createdBy === user.id
  if (!canMutate) {
    throw new Error('You are not allowed to update this todo.')
  }

  const updatePayload: Record<string, unknown> = {
    updatedAt: nowIso(),
  }
  if (payload.title !== undefined) updatePayload.title = payload.title.trim()
  if (payload.status !== undefined)
    updatePayload.status = isTodoStatus(payload.status) ? payload.status : current.status
  if (payload.dueDate !== undefined) updatePayload.dueDate = toOptionalString(payload.dueDate)
  if (payload.assignedTo !== undefined) {
    updatePayload.assignedTo = isPrivilegedRole(user.role)
      ? payload.assignedTo.trim()
      : current.assignedTo
  }

  await updateDoc(todoRef, updatePayload as UpdateData<DocumentData>)
  return {
    ...current,
    ...payload,
    title: payload.title !== undefined ? payload.title.trim() : current.title,
    status:
      payload.status !== undefined && isTodoStatus(payload.status)
        ? payload.status
        : current.status,
    dueDate: payload.dueDate !== undefined ? toOptionalString(payload.dueDate) : current.dueDate,
    assignedTo:
      payload.assignedTo !== undefined && isPrivilegedRole(user.role)
        ? payload.assignedTo.trim()
        : current.assignedTo,
    updatedAt: String(updatePayload.updatedAt),
  }
}

export const removeFirestoreTodo = async (token: string, todoId: string): Promise<void> => {
  const todosCollection = getTodosCollection()
  if (!todosCollection) {
    throw new Error('Firestore todos is not configured.')
  }

  const user = await getFirestoreSessionUser(token)
  const todoRef = doc(todosCollection, todoId)
  const snapshot = await getDoc(todoRef)
  if (!snapshot.exists()) {
    throw new Error('Todo not found.')
  }

  const current = mapTodoRecord(snapshot.id, snapshot.data() as Record<string, unknown>)
  const canMutate =
    isPrivilegedRole(user.role) || current.assignedTo === user.id || current.createdBy === user.id
  if (!canMutate) {
    throw new Error('You are not allowed to delete this todo.')
  }

  await deleteDoc(todoRef)
}
