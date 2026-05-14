import {
  createFirestoreTodo,
  listFirestoreTodos,
  removeFirestoreTodo,
  updateFirestoreTodo
} from "./todos-firestore";
import { TodoRecord } from "./types";

export const todosApi = {
  list(
    token: string,
    query?: { status?: TodoRecord["status"]; assignee?: string; q?: string }
  ): Promise<{ todos: TodoRecord[] }> {
    return listFirestoreTodos(token, query).then((todos) => ({ todos }));
  },
  create(
    token: string,
    payload: { title: string; assignedTo?: string; status?: TodoRecord["status"]; dueDate?: string }
  ): Promise<{ todo: TodoRecord }> {
    return createFirestoreTodo(token, payload).then((todo) => ({ todo }));
  },
  update(
    token: string,
    todoId: string,
    payload: Partial<{ title: string; assignedTo: string; status: TodoRecord["status"]; dueDate?: string }>
  ): Promise<{ todo: TodoRecord }> {
    return updateFirestoreTodo(token, todoId, payload).then((todo) => ({ todo }));
  },
  remove(token: string, todoId: string): Promise<{ message: string }> {
    return removeFirestoreTodo(token, todoId).then(() => ({ message: "Todo deleted." }));
  }
};
