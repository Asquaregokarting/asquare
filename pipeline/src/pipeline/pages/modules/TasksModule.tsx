import { FormEvent, useEffect, useMemo, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { tasksApi } from "../../api/tasks";
import { todosApi } from "../../api/todos";
import { TaskRecord, TaskStatus, TodoRecord, UserRecord, WorkspaceRecord } from "../../api/types";
import { usersApi } from "../../api/users";
import { ModulePageLayout } from "../../components/layout/ModulePageLayout";
import { AsyncContent } from "../../components/ui/AsyncContent";
import { DataTable } from "../../components/ui/DataTable";
import { DetailPanel } from "../../components/ui/DetailPanel";
import { FeedbackBannerStack } from "../../components/ui/FeedbackBanner";
import { FilterBar, FilterField } from "../../components/ui/FilterBar";
import { SummaryCards } from "../../components/ui/SummaryCards";
import { useAuth } from "../../features/auth/auth-context";
import { useAsyncAction } from "../../features/shared/useAsyncAction";
import { buildTaskModuleUsers, defaultTaskStatuses, resolveTaskUserName } from "../../features/tasks/task-module-utils";
import { useTaskRealtimeChat } from "../../features/tasks/useTaskRealtimeChat";
import { readSearchParam, updateSearchParams } from "../../lib/search-params";
import { useTaskUnreadCounts } from "../../features/tasks/useTaskUnreadCounts";
import { TaskChatPanel } from "../../components/ui/TaskChatPanel";
import { fmtDateTimeFullIST, fmtDateIST } from "../../../lib/date-format";

export type TasksView = "my" | "board" | "overdue" | "detail" | "todos";

const subnav = [
  { label: "My Tasks", to: "/tasks/my" },
  { label: "Task Board", to: "/tasks/board" },
  { label: "Overdue", to: "/tasks/overdue" },
  { label: "Todos", to: "/tasks/todos" }
];

const titleMap: Record<TasksView, string> = {
  my: "My Tasks",
  board: "Task Board",
  overdue: "Overdue Tasks",
  detail: "Task Detail",
  todos: "Todos"
};

const subtitleMap: Record<TasksView, string> = {
  my: "Track tasks assigned to you.",
  board: "Manage workspace-wide task status and assignment.",
  overdue: "Prioritize late tasks and recovery actions.",
  detail: "Review full task context and threaded comments.",
  todos: "Capture quick operational tasks and follow-through."
};

const isPrivilegedTodoRole = (role: string): boolean => role === "Owner" || role === "Admin";
const taskStatusOrder: TaskStatus[] = defaultTaskStatuses;

const TasksModule = ({ view }: { view: TasksView }) => {
  const { session } = useAuth();
  const token = session?.token;
  const { taskId } = useParams<{ taskId: string }>();
  const [searchParams, setSearchParams] = useSearchParams();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [tasks, setTasks] = useState<TaskRecord[]>([]);
  const [task, setTask] = useState<TaskRecord | null>(null);
  const [workspaces, setWorkspaces] = useState<WorkspaceRecord[]>([]);
  const [users, setUsers] = useState<UserRecord[]>([]);
  const [todos, setTodos] = useState<TodoRecord[]>([]);

  const workspaceFilter = readSearchParam(searchParams, "workspaceId");
  const statusFilter = (readSearchParam(searchParams, "status") as TaskStatus | "") || "";
  const assignedToFilter = readSearchParam(searchParams, "assignedTo");
  const todoSearch = readSearchParam(searchParams, "q");
  const todoStatusFilter = (readSearchParam(searchParams, "todoStatus") as TodoRecord["status"] | "") || "";
  const todoAssigneeFilter = readSearchParam(searchParams, "todoAssignee");

  const privileged = session ? isPrivilegedTodoRole(session.user.role) : false;
  const patchSearchParams = (patch: Record<string, string | number | null | undefined>) => {
    setSearchParams(updateSearchParams(searchParams, patch));
  };

  const loadBoardContext = async () => {
    if (!token || !session) return;

    const workspaceResult = await tasksApi.listWorkspaces(token);
    setWorkspaces(workspaceResult.workspaces);

    if (privileged) {
      const usersResult = await usersApi.list(token);
      setUsers(buildTaskModuleUsers(session, usersResult.users));
    } else {
      setUsers(buildTaskModuleUsers(session, []));
    }
  };

  const loadTasks = async () => {
    if (!token || !session || view === "todos") return;

    setLoading(true);
    setError(null);
    try {
      if (view === "detail" && taskId) {
        const result = await tasksApi.getTask(token, taskId);
        setTask(result.task);
        await loadBoardContext();
      } else {
        const result = await tasksApi.listTasks(token, {
          workspaceId: workspaceFilter || undefined,
          status: statusFilter || undefined,
          assignedTo: view === "my" ? session.user.id : assignedToFilter || undefined
        });
        const now = Date.now();
        const filtered =
          view === "overdue"
            ? result.tasks.filter((item) => item.status !== "Completed" && new Date(item.dueDate).getTime() < now)
            : result.tasks;
        setTasks(filtered);
        await loadBoardContext();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load tasks.");
    } finally {
      setLoading(false);
    }
  };

  const loadTodos = async () => {
    if (!token || !session || view !== "todos") return;

    setLoading(true);
    setError(null);
    try {
      const query = {
        status: todoStatusFilter || undefined,
        assignee: privileged ? todoAssigneeFilter || undefined : session.user.id,
        q: todoSearch || undefined
      };

      const todoPromise = todosApi.list(token, query);
      if (privileged) {
        const [todoResult, usersResult] = await Promise.all([todoPromise, usersApi.list(token)]);
        setTodos(todoResult.todos);
        setUsers(buildTaskModuleUsers(session, usersResult.users));
      } else {
        const [todoResult, workspaceResult] = await Promise.all([todoPromise, tasksApi.listWorkspaces(token)]);
        setTodos(todoResult.todos);
        setWorkspaces(workspaceResult.workspaces);
        setUsers(buildTaskModuleUsers(session, []));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load todos.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (view === "todos") {
      void loadTodos();
      return;
    }
    void loadTasks();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    token,
    view,
    taskId,
    workspaceFilter,
    statusFilter,
    assignedToFilter,
    todoStatusFilter,
    todoSearch,
    todoAssigneeFilter,
    session?.user.id
  ]);

  const reloadCurrentView = async () => {
    if (view === "todos") {
      await loadTodos();
    } else {
      await loadTasks();
    }
  };

  const run = useAsyncAction({
    setBusy: setLoading,
    setError,
    setSuccess
  });
  const onShiftTask = (item: TaskRecord, direction: "prev" | "next") => {
    if (!token) return;
    const index = taskStatusOrder.indexOf(item.status);
    if (index < 0) return;
    const targetIndex = direction === "prev" ? index - 1 : index + 1;
    const nextStatus = taskStatusOrder[targetIndex];
    if (!nextStatus) return;
    void run(
      () => tasksApi.updateTask(token, item.id, { status: nextStatus }),
      {
        successMessage: `Task moved to ${nextStatus}.`,
        fallbackError: "Failed to move task.",
        onSuccess: reloadCurrentView
      }
    );
  };

  const overdueCount = useMemo(
    () => tasks.filter((item) => item.status !== "Completed" && new Date(item.dueDate).getTime() < Date.now()).length,
    [tasks]
  );

  const todoSummary = useMemo(
    () => ({
      total: todos.length,
      pending: todos.filter((todo) => todo.status === "Pending").length,
      done: todos.filter((todo) => todo.status === "Done").length,
      mine: session ? todos.filter((todo) => todo.assignedTo === session.user.id).length : 0
    }),
    [todos, session]
  );

  const resolveUserName = (userId: string): string => {
    return resolveTaskUserName(userId, users, session, { annotateCurrentUser: true });
  };

  const taskChat = useTaskRealtimeChat({
    token,
    taskId: task?.id,
    currentUserId: session?.user.id,
    enabled: view === "detail" && Boolean(task),
    panelVisible: view === "detail" && Boolean(task),
    onError: (message) => setError(message)
  });
  const unreadScopeTasks = useMemo(() => (view === "detail" && task ? [task] : tasks), [task, tasks, view]);
  const { unreadByTaskId, totalUnread } = useTaskUnreadCounts({
    token,
    currentUserId: session?.user.id,
    tasks: unreadScopeTasks,
    enabled: view !== "todos",
    onError: (message) => setError(message)
  });

  if (!session || !token) {
    return null;
  }

  return (
    <ModulePageLayout
      moduleTab="Tasks"
      title={titleMap[view]}
      subtitle={subtitleMap[view]}
      breadcrumbs={["Pipeline", "Tasks", titleMap[view]]}
      subnav={subnav}
    >
      <div className="mb-3 space-y-3">
        <FeedbackBannerStack error={error} success={success} />
      </div>

      {view !== "detail" && view !== "todos" ? (
        <SummaryCards
          items={[
            { id: "total", label: "Visible Tasks", value: String(tasks.length), tone: "info" },
            {
              id: "progress",
              label: "In Progress",
              value: String(tasks.filter((item) => item.status === "InProgress").length),
              tone: "warning"
            },
            {
              id: "blocked",
              label: "Blocked",
              value: String(tasks.filter((item) => item.status === "Blocked").length),
              tone: "critical"
            },
            { id: "overdue", label: "Overdue", value: String(overdueCount), tone: "critical" },
            { id: "unread", label: "Unread Messages", value: String(totalUnread), tone: "warning" }
          ]}
        />
      ) : null}

      {view === "todos" ? (
        <SummaryCards
          items={[
            { id: "total", label: "Visible Todos", value: String(todoSummary.total), tone: "info" },
            { id: "pending", label: "Pending", value: String(todoSummary.pending), tone: "warning" },
            { id: "done", label: "Done", value: String(todoSummary.done), tone: "success" },
            { id: "mine", label: "Assigned To Me", value: String(todoSummary.mine), tone: "muted" }
          ]}
        />
      ) : null}

      {view !== "detail" && view !== "todos" ? (
        <FilterBar>
          <FilterField label="Workspace">
            <select
              className="ui-field min-h-10"
              value={workspaceFilter}
              onChange={(event) => {
                patchSearchParams({ workspaceId: event.target.value });
              }}
            >
              <option value="">All</option>
              {workspaces.map((workspace) => (
                <option key={workspace.id} value={workspace.id}>
                  {workspace.workspaceName}
                </option>
              ))}
            </select>
          </FilterField>
          <FilterField label="Status">
            <select
              className="ui-field min-h-10"
              value={statusFilter}
              onChange={(event) => {
                patchSearchParams({ status: event.target.value });
              }}
            >
              <option value="">All</option>
              <option value="Todo">Todo</option>
              <option value="InProgress">In Progress</option>
              <option value="Completed">Completed</option>
              <option value="Blocked">Blocked</option>
            </select>
          </FilterField>
          {view === "board" ? (
            <FilterField label="Assigned To">
              <select
                className="ui-field min-h-10"
                value={assignedToFilter}
                onChange={(event) => {
                  patchSearchParams({ assignedTo: event.target.value });
                }}
              >
                <option value="">All</option>
                {users.map((user) => (
                  <option key={user.id} value={user.id}>
                    {user.name}
                  </option>
                ))}
              </select>
            </FilterField>
          ) : null}
        </FilterBar>
      ) : null}

      {view === "todos" ? (
        <>
          <FilterBar>
            <FilterField label="Status">
              <select
                className="ui-field min-h-10"
                value={todoStatusFilter}
                onChange={(event) => {
                  patchSearchParams({ todoStatus: event.target.value });
                }}
              >
                <option value="">All</option>
                <option value="Pending">Pending</option>
                <option value="Done">Done</option>
              </select>
            </FilterField>
            {privileged ? (
              <FilterField label="Assignee">
                <select
                  className="ui-field min-h-10"
                  value={todoAssigneeFilter}
                  onChange={(event) => {
                    patchSearchParams({ todoAssignee: event.target.value });
                  }}
                >
                  <option value="">All</option>
                  {users.map((user) => (
                    <option key={user.id} value={user.id}>
                      {user.name}
                    </option>
                  ))}
                </select>
              </FilterField>
            ) : null}
            <FilterField label="Search">
              <input
                className="ui-field min-h-10"
                value={todoSearch}
                placeholder="Search todos by title"
                onChange={(event) => {
                  patchSearchParams({ q: event.target.value });
                }}
              />
            </FilterField>
          </FilterBar>

          <div>
            <DetailPanel title="Create Todo">
              <form
                className="grid grid-cols-1 gap-2 md:grid-cols-5"
                onSubmit={(event: FormEvent<HTMLFormElement>) => {
                  event.preventDefault();
                  const form = event.currentTarget;
                  const formData = new FormData(form);
                  const assignee = privileged
                    ? (String(formData.get("assignedTo") ?? "") || session.user.id)
                    : session.user.id;
                  void run(
                    () =>
                      todosApi.create(token, {
                        title: String(formData.get("title") ?? ""),
                        assignedTo: assignee,
                        status: "Pending",
                        dueDate: String(formData.get("dueDate") ?? "") || undefined
                      }),
                    {
                      successMessage: "Todo created.",
                      fallbackError: "Failed to create todo.",
                      onSuccess: reloadCurrentView
                    }
                  );
                  form.reset();
                }}
              >
                <input className="ui-field min-h-10" name="title" placeholder="Todo title" required />
                <input className="ui-field min-h-10" name="dueDate" type="date" />
                {privileged ? (
                  <select className="ui-field min-h-10" name="assignedTo" defaultValue="">
                    <option value="">Assign to me</option>
                    {users.map((user) => (
                      <option key={user.id} value={user.id}>
                        {user.name}
                      </option>
                    ))}
                  </select>
                ) : (
                  <input
                    className="ui-field min-h-10 text-muted"
                    value={session.user.name}
                    readOnly
                    aria-label="Assigned to"
                  />
                )}
                <button type="submit" disabled={loading} className="ui-btn ui-btn-primary disabled:opacity-70">
                  Add Todo
                </button>
              </form>
            </DetailPanel>
          </div>

          <div>
            <AsyncContent
              loading={loading && todos.length === 0}
              error={!todos.length ? error : null}
              isEmpty={!loading && !error && todos.length === 0}
              emptyTitle="No todos found"
              emptyDescription="Create a todo or broaden the filters to see more work items."
              loadingTitle="Loading todos"
              loadingDescription="Refreshing todo assignments and statuses."
              onRetry={() => void reloadCurrentView()}
            >
              <DataTable
                columns={[
                  { key: "title", header: "Title", render: (todo) => todo.title },
                  { key: "assignee", header: "Assignee", render: (todo) => resolveUserName(todo.assignedTo) },
                  { key: "status", header: "Status", render: (todo) => todo.status },
                  { key: "due", header: "Due", render: (todo) => (todo.dueDate ? fmtDateIST(todo.dueDate) : "-") },
                  {
                    key: "actions",
                    header: "Actions",
                    render: (todo) => (
                      <div className="flex flex-wrap gap-2">
                        <button
                          type="button"
                          onClick={() =>
                            void run(() => todosApi.update(token, todo.id, { status: todo.status === "Done" ? "Pending" : "Done" }), {
                              successMessage: todo.status === "Done" ? "Todo marked pending." : "Todo marked done.",
                              fallbackError: "Failed to update todo.",
                              onSuccess: reloadCurrentView
                            })
                          }
                          disabled={loading}
                          className="ui-btn ui-btn-success min-h-8 px-2 py-1 text-xs disabled:opacity-70"
                        >
                          {todo.status === "Done" ? "Mark Pending" : "Mark Done"}
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            void run(() => todosApi.remove(token, todo.id), {
                              successMessage: "Todo deleted.",
                              fallbackError: "Failed to delete todo.",
                              onSuccess: reloadCurrentView
                            })
                          }
                          disabled={loading}
                          className="ui-btn ui-btn-danger min-h-8 px-2 py-1 text-xs disabled:opacity-70"
                        >
                          Delete
                        </button>
                      </div>
                    )
                  }
                ]}
                rows={todos}
                rowKey={(todo) => todo.id}
                emptyMessage="No todos found."
              />
            </AsyncContent>
          </div>
        </>
      ) : null}

      {view === "board" ? (
        <DetailPanel title="Create Task">
          <form
            className="grid grid-cols-1 gap-2 md:grid-cols-4"
            onSubmit={(event: FormEvent<HTMLFormElement>) => {
              event.preventDefault();
              const form = event.currentTarget;
              const formData = new FormData(form);
              void run(
                () =>
                  tasksApi.createTask(token, {
                    workspaceId: String(formData.get("workspaceId") ?? ""),
                    taskName: String(formData.get("taskName") ?? ""),
                    description: String(formData.get("description") ?? ""),
                    dueDate: new Date(String(formData.get("dueDate") ?? new Date().toISOString())).toISOString(),
                    assignedTo: String(formData.get("assignedTo") ?? ""),
                    priority: String(formData.get("priority") ?? "Medium") as TaskRecord["priority"],
                    status: "Todo"
                  }),
                {
                  successMessage: "Task created.",
                  fallbackError: "Failed to create task.",
                  onSuccess: reloadCurrentView
                }
              );
              form.reset();
            }}
          >
            <select className="ui-field min-h-10" name="workspaceId" required>
              <option value="">Workspace</option>
              {workspaces.map((workspace) => (
                <option key={workspace.id} value={workspace.id}>
                  {workspace.workspaceName}
                </option>
              ))}
            </select>
            <input className="ui-field min-h-10" name="taskName" placeholder="Task name" required />
            <input className="ui-field min-h-10" name="description" placeholder="Description" required />
            <input className="ui-field min-h-10" name="dueDate" type="datetime-local" required />
            <select className="ui-field min-h-10" name="assignedTo" required>
              <option value="">Assignee</option>
              {users.map((user) => (
                <option key={user.id} value={user.id}>
                  {user.name}
                </option>
              ))}
            </select>
            <select className="ui-field min-h-10" name="priority" defaultValue="Medium">
              <option value="Low">Low</option>
              <option value="Medium">Medium</option>
              <option value="High">High</option>
              <option value="Urgent">Urgent</option>
            </select>
            <button type="submit" disabled={loading} className="ui-btn ui-btn-primary disabled:opacity-70">
              Create Task
            </button>
          </form>
        </DetailPanel>
      ) : null}

      {view !== "detail" && view !== "todos" ? (
        <div>
          <AsyncContent
            loading={loading && tasks.length === 0}
            error={!tasks.length ? error : null}
            isEmpty={!loading && !error && tasks.length === 0}
            emptyTitle="No tasks found"
            emptyDescription="Adjust the filters or create a new task to populate this view."
            loadingTitle="Loading tasks"
            loadingDescription="Fetching task assignments, unread counts, and due dates."
            onRetry={() => void reloadCurrentView()}
          >
            <DataTable
              columns={[
                { key: "task", header: "Task", render: (item) => item.taskName },
                { key: "priority", header: "Priority", render: (item) => item.priority },
                { key: "status", header: "Status", render: (item) => item.status },
                {
                  key: "unread",
                  header: "Unread",
                  render: (item) => {
                    const unreadCount = unreadByTaskId[item.id] ?? 0;
                    return unreadCount > 0 ? (
                      <span className="inline-flex rounded-full border border-critical/55 bg-critical px-2 py-0.5 text-xs font-semibold text-white">
                        {unreadCount}
                      </span>
                    ) : (
                      <span className="text-muted">0</span>
                    );
                  }
                },
                { key: "due", header: "Due", render: (item) => fmtDateIST(item.dueDate) },
                {
                  key: "actions",
                  header: "Actions",
                  render: (item) => {
                    const unreadCount = unreadByTaskId[item.id] ?? 0;
                    const statusIndex = taskStatusOrder.indexOf(item.status);
                    return (
                      <div className="flex flex-wrap gap-2">
                        <Link to={`/tasks/${item.id}`} className="ui-btn ui-btn-neutral relative min-h-8 px-2 py-1 text-xs">
                          View
                          {unreadCount > 0 ? (
                            <span className="absolute -right-2 -top-2 inline-flex min-w-5 items-center justify-center rounded-full border border-critical/60 bg-critical px-1 text-[10px] font-semibold text-white">
                              {unreadCount}
                            </span>
                          ) : null}
                        </Link>
                        <button
                          type="button"
                          onClick={() => onShiftTask(item, "prev")}
                          disabled={loading || statusIndex <= 0}
                          title="Move to previous status"
                          aria-label="Move to previous status"
                          className="ui-btn ui-btn-neutral min-h-8 px-2 py-1 text-sm disabled:opacity-40"
                        >
                          &larr;
                        </button>
                        <button
                          type="button"
                          onClick={() => onShiftTask(item, "next")}
                          disabled={loading || statusIndex === -1 || statusIndex >= taskStatusOrder.length - 1}
                          title="Move to next status"
                          aria-label="Move to next status"
                          className="ui-btn ui-btn-neutral min-h-8 px-2 py-1 text-sm disabled:opacity-40"
                        >
                          &rarr;
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            void run(() => tasksApi.updateTask(token, item.id, { status: "Completed" }), {
                              successMessage: "Task marked completed.",
                              fallbackError: "Failed to update task.",
                              onSuccess: reloadCurrentView
                            })
                          }
                          disabled={loading}
                          className="ui-btn ui-btn-success min-h-8 px-2 py-1 text-xs disabled:opacity-70"
                        >
                          Complete
                        </button>
                      </div>
                    );
                  }
                }
              ]}
              rows={tasks}
              rowKey={(item) => item.id}
              emptyMessage="No tasks found."
            />
          </AsyncContent>
        </div>
      ) : null}

      {view === "detail" ? (
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
          <DetailPanel title={task?.taskName ?? "Task"}>
            <AsyncContent
              loading={loading && !task}
              error={!task ? error : null}
              isEmpty={!loading && !error && !task}
              emptyTitle="Task not found"
              emptyDescription="The selected task is unavailable or you no longer have access to it."
              loadingTitle="Loading task"
              loadingDescription="Retrieving task details, status, and assignee context."
              onRetry={() => void reloadCurrentView()}
            >
              <div className="space-y-2 text-sm text-text">
                <p>Status: {task?.status}</p>
                <p>Priority: {task?.priority}</p>
                <p>Due: {task ? fmtDateTimeFullIST(task.dueDate) : "-"}</p>
                <p>
                  Unread:{" "}
                  <span className="inline-flex min-w-6 items-center justify-center rounded-full border border-critical/55 bg-critical px-2 py-0.5 text-xs font-semibold text-white">
                    {task ? (unreadByTaskId[task.id] ?? 0) : 0}
                  </span>
                </p>
                <p>Description: {task?.description ?? "-"}</p>
                <button
                  type="button"
                  onClick={() =>
                    task
                      ? void run(() => tasksApi.updateTask(token, task.id, { status: "InProgress" }), {
                          successMessage: "Task moved to in-progress.",
                          fallbackError: "Failed to update task.",
                          onSuccess: reloadCurrentView
                        })
                      : undefined
                  }
                  disabled={loading || !task}
                  className="ui-btn ui-btn-info min-h-8 px-2 py-1 text-xs disabled:opacity-70"
                >
                  Move to In Progress
                </button>
              </div>
            </AsyncContent>
          </DetailPanel>

          <DetailPanel title="Task Chat">
            <TaskChatPanel
              messages={taskChat.messages}
              typing={taskChat.typing}
              readReceipts={taskChat.readReceipts}
              currentUserId={session.user.id}
              resolveUserName={resolveUserName}
              draft={taskChat.draft}
              onDraftChange={taskChat.setDraft}
              onSend={(event) => {
                event.preventDefault();
                void taskChat.sendMessage();
              }}
              onSendImage={(file) => {
                void taskChat.sendImageMessage(file);
              }}
              onSendFile={(file) => {
                void taskChat.sendFileMessage(file);
              }}
              onCreatePoll={(question, options) => {
                void taskChat.createPollMessage(question, options);
              }}
              onVotePoll={(pollId, optionId) => {
                void taskChat.votePollOption(pollId, optionId);
              }}
              onDeleteMessage={(message) => {
                void taskChat.deleteMessage(message);
              }}
              isSending={taskChat.isSending}
              deletingMessageId={taskChat.deletingMessageId}
              sendError={taskChat.sendError}
              placeholder="Write a task message..."
              emptyMessage="No chat messages yet."
              disabled={!task}
            />

            <div className="mt-3 rounded-xl border border-border/70 bg-surface/80 p-4 shadow-sm">
              <div className="mb-3 flex items-center justify-between">
                <h5 className="text-base font-semibold text-text">Task Activities</h5>
                <span className="text-xs text-muted">{taskChat.activities.length} records</span>
              </div>
              <div className="max-h-72 space-y-3 overflow-y-auto pr-1">
                {taskChat.activities.length > 0 ? (
                  taskChat.activities.map((entry) => (
                    <div key={entry.id} className="rounded-lg border border-border/70 bg-panel px-3 py-2.5 text-sm">
                      <p className="text-[11px] text-muted">
                        {resolveUserName(entry.userId)} | {fmtDateTimeFullIST(entry.createdAt)}
                      </p>
                      <p className="mt-1 text-text">{entry.message}</p>
                    </div>
                  ))
                ) : (
                  <p className="text-sm text-muted">No activity recorded yet for this task.</p>
                )}
              </div>
            </div>
          </DetailPanel>
        </div>
      ) : null}
    </ModulePageLayout>
  );
};

export default TasksModule;
