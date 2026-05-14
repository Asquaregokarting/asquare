import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useParams, useSearchParams, useNavigate } from 'react-router-dom'
import { motion } from 'framer-motion'
import { contactsApi } from '../../api/contacts'
import { tasksApi } from '../../api/tasks'
import {
  ContactRecord,
  Role,
  TaskRecord,
  TaskStatus,
  UserRecord,
  WorkspaceRecord,
} from '../../api/types'
import { usersApi } from '../../api/users'
import { ModulePageLayout } from '../../components/layout/ModulePageLayout'
import { AsyncContent } from '../../components/ui/AsyncContent'
import { DataTable } from '../../components/ui/DataTable'
import { DetailPanel } from '../../components/ui/DetailPanel'
import { FeedbackBannerStack } from '../../components/ui/FeedbackBanner'
import { FilterBar, FilterField } from '../../components/ui/FilterBar'
import { TaskNotificationCenter } from '../../components/ui/TaskNotificationCenter'
import { useAuth } from '../../features/auth/auth-context'
import { useLocations } from '../../hooks/useLocations'
import { useAsyncAction } from '../../features/shared/useAsyncAction'
import {
  buildTaskModuleUsers,
  dedupeTaskStatuses,
  defaultTaskStatuses,
  normalizeTaskStatusName,
  readWorkspaceCustomStatuses,
  readWorkspaceFavorites,
  readWorkspaceHiddenDefaultStatuses,
  resolveTaskUserName,
  taskStatusLabelMap,
  taskStatusToneMap,
} from '../../features/tasks/task-module-utils'
import { useTaskRealtimeChat } from '../../features/tasks/useTaskRealtimeChat'
import { useTaskUnreadCounts } from '../../features/tasks/useTaskUnreadCounts'
import { readSearchParam, updateSearchParams } from '../../lib/search-params'
import { fmtDateTimeFullIST, fmtDateIST } from '../../../lib/date-format'
import { TaskChatPanel } from '../../components/ui/TaskChatPanel'

export type WorkspacesView =
  | 'list'
  | 'detail'
  | 'contacts'
  | 'recycleBin'
  | 'taskDetail'
  | 'workReport'

const titleMap: Record<WorkspacesView, string> = {
  list: 'Workspace Boards',
  detail: 'Board Workspace',
  contacts: 'Contacts',
  recycleBin: 'Recycle Bin',
  taskDetail: 'Task View',
  workReport: 'Work Report',
}

const subtitleMap: Record<WorkspacesView, string> = {
  list: 'Unified workspaces and tasks in one board-first workflow.',
  detail: 'Plan, assign, and progress tasks directly inside a workspace board.',
  contacts: 'Persisted contact register for workspace-enabled roles.',
  recycleBin: 'Restore deleted tasks or permanently remove them from the system.',
  taskDetail: 'Full screen task context and collaboration.',
  workReport: 'Owner-only audit of tasks across a single workspace.',
}

const workReportStatusTabs = ['Todo', 'InProgress', 'Completed'] as const
type WorkReportStatusTab = (typeof workReportStatusTabs)[number]

const boardTabs = ['all', 'favorites', 'archived'] as const
type BoardTab = (typeof boardTabs)[number]

const priorityTone: Record<TaskRecord['priority'], string> = {
  Low: 'border border-muted/30 bg-muted/10 text-muted',
  Medium: 'bg-info/25 text-info border border-info/35',
  High: 'bg-warning/25 text-warning border border-warning/35',
  Urgent: 'bg-critical/25 text-critical border border-critical/35',
}

const TASK_ACTIVITY_PREFIX = '[[activity]] '
const toActivityComment = (value: string): string => `${TASK_ACTIVITY_PREFIX}${value}`
const URL_PATTERN = /(?:https?:\/\/|www\.)[^\s]+/i

type TaskChatFilter = 'all' | 'images' | 'links' | 'files' | 'polls'
type TaskDetailPanelTab = 'task' | 'chat' | 'activity'

const WorkspacesModule = ({ view }: { view: WorkspacesView }) => {
  const { session } = useAuth()
  const token = session?.token
  const navigate = useNavigate()
  const { workspaceId, taskId } = useParams<{ workspaceId: string; taskId: string }>()
  const [searchParams, setSearchParams] = useSearchParams()

  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)

  const [workspaces, setWorkspaces] = useState<WorkspaceRecord[]>([])
  const [deletedWorkspaces, setDeletedWorkspaces] = useState<WorkspaceRecord[]>([])
  const [workspace, setWorkspace] = useState<WorkspaceRecord | null>(null)
  const [allTasks, setAllTasks] = useState<TaskRecord[]>([])
  const [workspaceTasks, setWorkspaceTasks] = useState<TaskRecord[]>([])
  const [deletedTasks, setDeletedTasks] = useState<TaskRecord[]>([])
  const [users, setUsers] = useState<UserRecord[]>([])

  const [selectedReportWorkspaceId, setSelectedReportWorkspaceId] = useState<string>('')
  const [workReportTasks, setWorkReportTasks] = useState<TaskRecord[]>([])
  const [workReportLoading, setWorkReportLoading] = useState(false)
  const [workReportError, setWorkReportError] = useState<string | null>(null)
  const [workReportStatusTab, setWorkReportStatusTab] = useState<WorkReportStatusTab>('Todo')

  const [contacts, setContacts] = useState<ContactRecord[]>([])
  const [editingContactId, setEditingContactId] = useState<string | null>(null)
  const [contactName, setContactName] = useState('')
  const [contactPhone, setContactPhone] = useState('')
  const [contactEmail, setContactEmail] = useState('')
  const [contactNotes, setContactNotes] = useState('')

  const [favorites, setFavorites] = useState<Record<string, true>>(() => readWorkspaceFavorites())
  const [membersWorkspace, setMembersWorkspace] = useState<WorkspaceRecord | null>(null)
  const [columnMenuOpen, setColumnMenuOpen] = useState<string | null>(null)
  const [taskMenuOpen, setTaskMenuOpen] = useState<string | null>(null)

  const closeMenus = () => {
    setColumnMenuOpen(null)
    setTaskMenuOpen(null)
  }

  useEffect(() => {
    const handleOutsideClick = () => closeMenus()
    if (columnMenuOpen || taskMenuOpen) {
      window.addEventListener('click', handleOutsideClick)
    }
    return () => window.removeEventListener('click', handleOutsideClick)
  }, [columnMenuOpen, taskMenuOpen])
  const [memberToAddId, setMemberToAddId] = useState('')
  const [workspaceModalOpen, setWorkspaceModalOpen] = useState(false)
  const [boardCreationName, setBoardCreationName] = useState('')
  const [boardCreationRoles, setBoardCreationRoles] = useState<Set<Role>>(new Set())
  const [boardCreationMemberIds, setBoardCreationMemberIds] = useState<Set<string>>(new Set())
  const [boardCreationLocations, setBoardCreationLocations] = useState<Set<string>>(new Set())
  const { enabledLocations } = useLocations()
  const [taskModalOpen, setTaskModalOpen] = useState(false)
  const [viewTaskId, setViewTaskId] = useState<string | null>(null)
  const [dragTaskId, setDragTaskId] = useState<string | null>(null)
  const [taskChatFilter, setTaskChatFilter] = useState<TaskChatFilter>('all')
  const [taskDetailPanelTab, setTaskDetailPanelTab] = useState<TaskDetailPanelTab>('task')
  const [taskOverviewDraft, setTaskOverviewDraft] = useState('')
  const [newStatusName, setNewStatusName] = useState('')
  const [showStatusPopup, setShowStatusPopup] = useState(false)
  const [customStatuses, setCustomStatuses] = useState<TaskStatus[]>([])
  const [hiddenDefaultStatuses, setHiddenDefaultStatuses] = useState<TaskStatus[]>([])
  const [statusesInitialized, setStatusesInitialized] = useState(false)
  const [taskDraft, setTaskDraft] = useState({
    taskName: '',
    description: '',
    dueDate: '',
    assignedTo: '',
    priority: 'Medium' as TaskRecord['priority'],
    status: 'Todo' as TaskStatus,
  })

  const q = readSearchParam(searchParams, 'q')
  const boardTabCandidate = readSearchParam(searchParams, 'tab', 'all') as BoardTab
  const boardTab = boardTabs.includes(boardTabCandidate) ? boardTabCandidate : 'all'
  const patchSearchParams = (patch: Record<string, string | number | null | undefined>) => {
    setSearchParams(updateSearchParams(searchParams, patch))
  }
  const canCreateWorkspace = session
    ? session.user.role === 'Owner' || session.user.role === 'Admin'
    : false
  const canManageMembers = session
    ? session.user.role === 'Owner' || session.user.role === 'Admin'
    : false
  const canDeleteWorkspaceTasks = session
    ? session.user.role === 'Owner' ||
      session.user.role === 'Admin' ||
      session.user.role === 'Developer'
    : false
  const canViewWorkReport = session ? session.user.role === 'Owner' : false

  const subnav = useMemo(
    () => [
      { label: 'Boards', to: '/workspaces' },
      { label: 'Contacts', to: '/workspaces/contacts' },
      { label: 'Recycle Bin', to: '/workspaces/recycle-bin' },
      ...(canViewWorkReport ? [{ label: 'Work Report', to: '/workspaces/work-report' }] : []),
    ],
    [canViewWorkReport],
  )

  useEffect(() => {
    localStorage.setItem('pipeline-workspace-favorites', JSON.stringify(favorites))
  }, [favorites])

  useEffect(() => {
    if (!workspaceId) {
      setCustomStatuses([])
      setHiddenDefaultStatuses([])
      setStatusesInitialized(false)
      return
    }
    setCustomStatuses(readWorkspaceCustomStatuses(workspaceId))
    setHiddenDefaultStatuses(readWorkspaceHiddenDefaultStatuses(workspaceId))
    setStatusesInitialized(true)
  }, [workspaceId])

  useEffect(() => {
    if (!workspaceId || !statusesInitialized) return
    localStorage.setItem(
      `pipeline-workspace-custom-statuses:${workspaceId}`,
      JSON.stringify(customStatuses),
    )
  }, [workspaceId, customStatuses, statusesInitialized])

  useEffect(() => {
    if (!workspaceId || !statusesInitialized) return
    localStorage.setItem(
      `pipeline-workspace-hidden-default-statuses:${workspaceId}`,
      JSON.stringify(hiddenDefaultStatuses),
    )
  }, [workspaceId, hiddenDefaultStatuses, statusesInitialized])

  const loadContacts = async () => {
    if (!token) return
    const result = await contactsApi.list(token, { q: q || undefined })
    setContacts(result.contacts)
  }

  const loadBoards = async () => {
    if (!token || !session) return
    const [workspaceResult, taskResult, usersResult] = await Promise.all([
      tasksApi.listWorkspaces(token),
      tasksApi.listTasks(token),
      usersApi.list(token).catch(() => ({ users: [] as UserRecord[] })),
    ])
    setWorkspaces(workspaceResult.workspaces)
    setDeletedWorkspaces([])
    const visibleWorkspaceIds = new Set(
      workspaceResult.workspaces.map((workspaceItem) => workspaceItem.id),
    )
    setAllTasks(
      taskResult.tasks.filter(
        (task) => visibleWorkspaceIds.has(task.workspaceId) && !task.isDeleted,
      ),
    )
    setDeletedTasks([])
    setUsers(buildTaskModuleUsers(session, usersResult.users))
  }

  const loadWorkReport = async () => {
    if (!token || !session) return
    const [workspaceResult, usersResult] = await Promise.all([
      tasksApi.listWorkspaces(token),
      usersApi.list(token).catch(() => ({ users: [] as UserRecord[] })),
    ])
    setWorkspaces(workspaceResult.workspaces)
    setDeletedWorkspaces([])
    setAllTasks([])
    setDeletedTasks([])
    setUsers(buildTaskModuleUsers(session, usersResult.users))
  }

  const loadBoardDetail = async () => {
    if (!token || !workspaceId || !session) return

    const [workspaceResult, taskResult, usersResult] = await Promise.all([
      tasksApi.getWorkspace(token, workspaceId),
      tasksApi.listWorkspaceTasks(token, workspaceId),
      usersApi.list(token).catch(() => ({ users: [] as UserRecord[] })),
    ])

    setWorkspace(workspaceResult.workspace)
    setDeletedWorkspaces([])
    setWorkspaceTasks(taskResult.tasks.filter((task) => !task.isDeleted))
    setDeletedTasks([])
    setUsers(buildTaskModuleUsers(session, usersResult.users))
  }
  const loadRecycleBin = async () => {
    if (!token || !session) return
    const [workspaceResult, taskResult] = await Promise.all([
      tasksApi.listWorkspaces(token, { includeDeleted: true }),
      tasksApi.listTasks(token, { deletedOnly: true }),
    ])
    const activeWorkspaces = workspaceResult.workspaces.filter(
      (workspaceItem) => !workspaceItem.isDeleted,
    )
    const recycleBinWorkspaces = workspaceResult.workspaces.filter(
      (workspaceItem) => workspaceItem.isDeleted,
    )
    const visibleWorkspaceIds = new Set(
      workspaceResult.workspaces.map((workspaceItem) => workspaceItem.id),
    )
    setWorkspaces(activeWorkspaces)
    setDeletedWorkspaces(recycleBinWorkspaces)
    setWorkspace(null)
    setAllTasks([])
    setWorkspaceTasks([])
    setDeletedTasks(
      taskResult.tasks.filter(
        (task) => visibleWorkspaceIds.has(task.workspaceId) && task.isDeleted,
      ),
    )
  }
  const load = async () => {
    if (!token) return
    setLoading(true)
    setError(null)

    try {
      if (view === 'contacts') {
        await loadContacts()
      } else if (view === 'recycleBin') {
        await loadRecycleBin()
      } else if (view === 'workReport') {
        await loadWorkReport()
      } else if (view === 'detail' || view === 'taskDetail') {
        await loadBoardDetail()
      } else {
        await loadBoards()
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load workspace data.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, view, workspaceId, q])

  useEffect(() => {
    if (view !== 'workReport') return
    if (!canViewWorkReport || !token || !selectedReportWorkspaceId) {
      setWorkReportTasks([])
      return
    }
    let cancelled = false
    setWorkReportLoading(true)
    setWorkReportError(null)
    tasksApi
      .listWorkspaceTasks(token, selectedReportWorkspaceId)
      .then((result) => {
        if (cancelled) return
        setWorkReportTasks(result.tasks.filter((task) => !task.isDeleted))
      })
      .catch((err: unknown) => {
        if (cancelled) return
        setWorkReportError(err instanceof Error ? err.message : 'Failed to load work report.')
        setWorkReportTasks([])
      })
      .finally(() => {
        if (!cancelled) setWorkReportLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [view, canViewWorkReport, token, selectedReportWorkspaceId])

  const workReportTabCounts = useMemo(
    () => ({
      Todo: workReportTasks.filter((task) => task.status === 'Todo').length,
      InProgress: workReportTasks.filter((task) => task.status === 'InProgress').length,
      Completed: workReportTasks.filter((task) => task.status === 'Completed').length,
    }),
    [workReportTasks],
  )

  const filteredWorkReportTasks = useMemo(
    () => workReportTasks.filter((task) => task.status === workReportStatusTab),
    [workReportTasks, workReportStatusTab],
  )

  const run = useAsyncAction({
    setBusy: setLoading,
    setError,
    setSuccess,
  })

  const resetTaskDraft = (status: TaskStatus = statusOrder[0] ?? 'Todo') => {
    setTaskDraft({
      taskName: '',
      description: '',
      dueDate: '',
      assignedTo: session?.user.id ?? '',
      priority: 'Medium',
      status,
    })
  }

  const openTaskModal = (status: TaskStatus = statusOrder[0] ?? 'Todo') => {
    resetTaskDraft(status)
    setTaskModalOpen(true)
  }
  const handleTaskChatError = useCallback((message: string) => {
    setError(message)
  }, [])
  const unreadTasksScope = useMemo(() => {
    if (view === 'detail') return workspaceTasks
    if (view === 'list') return allTasks
    return []
  }, [allTasks, view, workspaceTasks])
  const { unreadByTaskId, totalUnread } = useTaskUnreadCounts({
    token,
    currentUserId: session?.user.id,
    tasks: unreadTasksScope,
    enabled: Boolean(token && session),
    onError: handleTaskChatError,
  })

  const taskCountByWorkspace = useMemo(() => {
    return allTasks.reduce<Record<string, number>>((accumulator, item) => {
      accumulator[item.workspaceId] = (accumulator[item.workspaceId] ?? 0) + 1
      return accumulator
    }, {})
  }, [allTasks])

  const unreadCountByWorkspace = useMemo(() => {
    return allTasks.reduce<Record<string, number>>((accumulator, item) => {
      accumulator[item.workspaceId] =
        (accumulator[item.workspaceId] ?? 0) + (unreadByTaskId[item.id] ?? 0)
      return accumulator
    }, {})
  }, [allTasks, unreadByTaskId])

  const filteredWorkspaces = useMemo(() => {
    const query = q.trim().toLowerCase()
    return workspaces.filter((workspaceItem) => {
      const matchesSearch = !query || workspaceItem.workspaceName.toLowerCase().includes(query)
      const isFavorite = Boolean(favorites[workspaceItem.id])
      if (!matchesSearch) return false
      if (boardTab === 'favorites') return isFavorite
      if (boardTab === 'archived') return false
      return true
    })
  }, [workspaces, q, favorites, boardTab])

  const boardSummary = useMemo(
    () => ({
      total: workspaces.length,
      favorites: Object.keys(favorites).length,
      tasks: allTasks.length,
      unread: totalUnread,
    }),
    [workspaces.length, favorites, allTasks.length, totalUnread],
  )
  const workspaceNameById = useMemo(() => {
    return [...workspaces, ...deletedWorkspaces].reduce<Record<string, string>>(
      (accumulator, item) => {
        accumulator[item.id] = item.workspaceName
        return accumulator
      },
      {},
    )
  }, [workspaces, deletedWorkspaces])
  const filteredDeletedWorkspaces = useMemo(() => {
    const query = q.trim().toLowerCase()
    if (!query) {
      return deletedWorkspaces
    }
    return deletedWorkspaces.filter((workspaceItem) =>
      workspaceItem.workspaceName.toLowerCase().includes(query),
    )
  }, [deletedWorkspaces, q])
  const filteredDeletedTasks = useMemo(() => {
    const query = q.trim().toLowerCase()
    if (!query) {
      return deletedTasks
    }
    return deletedTasks.filter((task) => {
      const taskName = task.taskName.toLowerCase()
      const workspaceName = (workspaceNameById[task.workspaceId] ?? 'Unknown Board').toLowerCase()
      return taskName.includes(query) || workspaceName.includes(query)
    })
  }, [deletedTasks, q, workspaceNameById])

  const statusOrder = useMemo(() => {
    const hiddenSet = new Set(hiddenDefaultStatuses.map((item) => item.toLowerCase()))
    const visibleDefaults = defaultTaskStatuses.filter(
      (status) => !hiddenSet.has(String(status).toLowerCase()),
    )
    const statusesFromTasks = workspaceTasks
      .map((task) => task.status)
      .filter((status) => !hiddenSet.has(String(status).toLowerCase()))
    return dedupeTaskStatuses([...visibleDefaults, ...customStatuses, ...statusesFromTasks])
  }, [customStatuses, hiddenDefaultStatuses, workspaceTasks])

  const statusColumns = useMemo(
    () =>
      statusOrder.map((status) => ({
        id: status,
        label: taskStatusLabelMap[status] ?? status,
        tone: taskStatusToneMap[status] ?? 'border-info/35 bg-info/10 text-info',
        tasks: workspaceTasks.filter((task) => task.status === status),
      })),
    [statusOrder, workspaceTasks],
  )

  const selectedTask = useMemo(() => {
    const id = view === 'taskDetail' ? taskId : viewTaskId
    return id ? (workspaceTasks.find((task) => task.id === id) ?? null) : null
  }, [view, taskId, viewTaskId, workspaceTasks])
  const taskChat = useTaskRealtimeChat({
    token,
    taskId: selectedTask?.id,
    currentUserId: session?.user.id,
    enabled: (view === 'detail' || view === 'taskDetail') && Boolean(selectedTask),
    panelVisible: (view === 'detail' || view === 'taskDetail') && Boolean(selectedTask),
    onError: handleTaskChatError,
  })

  const selectedTaskMessages = taskChat.messages
  const selectedTaskChatMessages = useMemo(() => {
    if (taskChatFilter === 'images') {
      return selectedTaskMessages.filter(
        (message) => message.messageType === 'image' && Boolean(message.imageUrl),
      )
    }
    if (taskChatFilter === 'files') {
      return selectedTaskMessages.filter(
        (message) => message.messageType === 'file' && Boolean(message.fileUrl),
      )
    }
    if (taskChatFilter === 'polls') {
      return selectedTaskMessages.filter(
        (message) => message.messageType === 'poll' || message.messageType === 'poll-vote',
      )
    }
    if (taskChatFilter === 'links') {
      return selectedTaskMessages.filter((message) => {
        const text = String(message.text ?? '').trim()
        const hasTextLink = URL_PATTERN.test(text)
        const hasFileLink = message.messageType === 'file' && Boolean(message.fileUrl)
        return hasTextLink || hasFileLink
      })
    }
    return selectedTaskMessages
  }, [selectedTaskMessages, taskChatFilter])
  const selectedTaskActivities = taskChat.activities
  useEffect(() => {
    setTaskOverviewDraft(selectedTask?.description ?? '')
  }, [selectedTask?.id, selectedTask?.description])
  useEffect(() => {
    setTaskChatFilter('all')
    setTaskDetailPanelTab('task')
  }, [selectedTask?.id])

  const resolveUserName = (userId: string): string =>
    resolveTaskUserName(userId, users, session, { fallbackLabel: 'Unassigned' })
  const resolveMember = (userId: string): UserRecord | null =>
    users.find((user) => user.id === userId) ?? null
  const canUserAccessBoard = (user: UserRecord, workspaceItem: WorkspaceRecord): boolean => {
    if ((workspaceItem.excludedMemberIds ?? []).includes(user.id)) return false
    if (user.role === 'Owner' || user.role === 'Admin') return true
    if ((workspaceItem.memberIds ?? []).includes(user.id)) return true
    if (workspaceItem.boardRoles && workspaceItem.boardRoles.length > 0) {
      return workspaceItem.boardRoles.includes(user.role as Role)
    }
    if (!workspaceItem.boardRole) return true
    return user.role === workspaceItem.boardRole
  }
  const accessibleMembersByWorkspace = useMemo(() => {
    const map: Record<
      string,
      Array<UserRecord | { id: string; name: string; email: string; role: string }>
    > = {}
    for (const workspaceItem of workspaces) {
      const bucket = new Map<
        string,
        UserRecord | { id: string; name: string; email: string; role: string }
      >()
      for (const user of users) {
        if (canUserAccessBoard(user, workspaceItem)) {
          bucket.set(user.id, user)
        }
      }
      for (const memberId of workspaceItem.memberIds) {
        if (!bucket.has(memberId)) {
          const knownMember = resolveMember(memberId)
          if (knownMember) {
            bucket.set(memberId, knownMember)
          } else {
            bucket.set(memberId, {
              id: memberId,
              name: 'Unknown user',
              email: memberId,
              role: 'Unknown',
            })
          }
        }
      }
      map[workspaceItem.id] = [...bucket.values()]
    }
    return map
  }, [workspaces, users])

  const ALL_ROLES: Role[] = [
    'Owner',
    'Admin',
    'Telecaller',
    'Cashier',
    'TrackMarshall',
    'Editor',
    'Developer',
    'Backend',
    'HR',
    'Accountant',
  ]

  const usersByRole = useMemo(() => {
    const map: Record<string, UserRecord[]> = {}
    for (const role of ALL_ROLES) {
      map[role] = []
    }
    for (const user of users) {
      if (map[user.role]) map[user.role].push(user)
    }
    return map as Record<Role, UserRecord[]>
  }, [users])

  const filteredUsersByRole = useMemo(() => {
    if (boardCreationLocations.size === 0) return usersByRole
    const map: Record<string, UserRecord[]> = {}
    for (const role of ALL_ROLES) {
      map[role] = (usersByRole[role] ?? []).filter((u) => {
        if (!u.allowedLocations || u.allowedLocations.length === 0) return true
        return u.allowedLocations.some((loc) => boardCreationLocations.has(loc))
      })
    }
    return map as Record<Role, UserRecord[]>
  }, [usersByRole, boardCreationLocations])

  const boardMembers = useMemo(() => {
    const nonThirdParty = users.filter((u) => u.role !== 'ThirdParty')
    if (!workspace) return nonThirdParty

    // Use canUserAccessBoard for consistent member resolution
    const memberIdSet = new Set<string>()
    for (const u of nonThirdParty) {
      if (canUserAccessBoard(u, workspace)) memberIdSet.add(u.id)
    }
    // Also include users already assigned to tasks on this board
    for (const task of workspaceTasks) {
      if (task.assignedTo) memberIdSet.add(task.assignedTo)
    }

    const filtered = nonThirdParty.filter((u) => memberIdSet.has(u.id))
    const result = filtered.length > 0 ? filtered : nonThirdParty
    const currentUserId = session?.user.id
    const roleOrder: Record<string, number> = {
      Owner: 0,
      Admin: 1,
      Telecaller: 2,
      Cashier: 3,
      TrackMarshall: 4,
      Editor: 5,
      Developer: 6,
      Backend: 7,
    }
    const sorted = [...result].sort((a, b) => (roleOrder[a.role] ?? 99) - (roleOrder[b.role] ?? 99))
    return currentUserId
      ? [
          ...sorted.filter((u) => u.id !== currentUserId),
          ...sorted.filter((u) => u.id === currentUserId),
        ]
      : sorted
  }, [workspace, users, workspaceTasks, session?.user.id])

  const resetBoardCreationState = () => {
    setBoardCreationName('')
    setBoardCreationRoles(new Set())
    setBoardCreationMemberIds(new Set())
    setBoardCreationLocations(new Set())
  }

  const toggleBoardCreationRole = (role: Role) => {
    setBoardCreationRoles((prev) => {
      const next = new Set(prev)
      if (next.has(role)) {
        next.delete(role)
        const roleUserIds = new Set((usersByRole[role] ?? []).map((u) => u.id))
        setBoardCreationMemberIds((prevMembers) => {
          const nextMembers = new Set(prevMembers)
          roleUserIds.forEach((id) => nextMembers.delete(id))
          return nextMembers
        })
      } else {
        next.add(role)
      }
      return next
    })
  }

  const toggleBoardCreationMember = (userId: string) => {
    setBoardCreationMemberIds((prev) => {
      const next = new Set(prev)
      if (next.has(userId)) next.delete(userId)
      else next.add(userId)
      return next
    })
  }

  const toggleAllForRole = (role: Role) => {
    const roleUserIds = (filteredUsersByRole[role] ?? []).map((u) => u.id)
    setBoardCreationMemberIds((prev) => {
      const next = new Set(prev)
      const allPresent = roleUserIds.every((id) => next.has(id))
      if (allPresent) {
        roleUserIds.forEach((id) => next.delete(id))
      } else {
        roleUserIds.forEach((id) => next.add(id))
      }
      return next
    })
  }

  const appendTaskActivity = async (taskId: string, message: string) => {
    if (!token) return
    await tasksApi.addComment(token, taskId, toActivityComment(message))
  }

  const handleCreateBoard = async () => {
    if (!token || !canCreateWorkspace) {
      setError('Only Owner or Admin can create boards.')
      return
    }
    const trimmedName = boardCreationName.trim()
    if (!trimmedName) {
      setError('Board name is required.')
      return
    }

    const finalMemberIds = [...new Set([session?.user.id ?? '', ...boardCreationMemberIds])].filter(
      Boolean,
    )
    const rolesArray = Array.from(boardCreationRoles)

    await run(
      () =>
        tasksApi.createWorkspace(token, {
          workspaceName: trimmedName,
          boardRole: rolesArray[0] ?? 'Telecaller',
          boardRoles: rolesArray.length > 0 ? rolesArray : undefined,
          memberIds: finalMemberIds,
        }),
      {
        successMessage: 'Board created.',
        fallbackError: 'Failed to create board.',
        onSuccess: load,
      },
    )

    setWorkspaceModalOpen(false)
    resetBoardCreationState()
  }

  const onCreateTask = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!token || !workspaceId || !session) return

    const fallbackDue = new Date(Date.now() + 86400000).toISOString()
    const dueDate = taskDraft.dueDate ? new Date(taskDraft.dueDate).toISOString() : fallbackDue

    await run(
      async () => {
        const result = await tasksApi.createTask(token, {
          workspaceId,
          taskName: taskDraft.taskName.trim(),
          description: taskDraft.description.trim() || 'No description',
          assignedTo: taskDraft.assignedTo || session.user.id,
          dueDate,
          priority: taskDraft.priority,
          status: taskDraft.status,
        })
        await appendTaskActivity(
          result.task.id,
          `Task created in ${taskStatusLabelMap[result.task.status] ?? result.task.status}.`,
        )
      },
      {
        successMessage: 'Task created.',
        fallbackError: 'Failed to create task.',
        onSuccess: load,
      },
    )

    setTaskModalOpen(false)
  }

  const onMoveTask = (task: TaskRecord, status: TaskStatus) => {
    if (!token || task.status === status) return
    const previous = taskStatusLabelMap[task.status] ?? task.status
    const next = taskStatusLabelMap[status] ?? status
    void run(
      async () => {
        await tasksApi.updateTask(token, task.id, { status })
        await appendTaskActivity(task.id, `Status changed from ${previous} to ${next}.`)
      },
      {
        successMessage: `Task moved to ${status}.`,
        fallbackError: 'Failed to update task status.',
        onSuccess: load,
      },
    )
  }
  const onUpdateTask = (task: TaskRecord, patch: Partial<TaskRecord>, message: string) => {
    if (!token) return
    const changes = Object.entries(patch)
      .map(([key, value]) => `${key}: ${String(value)}`)
      .join(', ')
    void run(
      async () => {
        await tasksApi.updateTask(token, task.id, patch)
        if (changes) {
          await appendTaskActivity(task.id, `Task updated (${changes}).`)
        }
      },
      {
        successMessage: message,
        fallbackError: 'Failed to update task.',
        onSuccess: load,
      },
    )
  }
  const onSaveTaskOverview = () => {
    if (!selectedTask) return
    const currentOverview = (selectedTask.description ?? '').trim()
    const nextOverview = taskOverviewDraft.trim()
    if (currentOverview === nextOverview) return
    onUpdateTask(
      selectedTask,
      { description: nextOverview || 'No description' },
      'Task overview updated.',
    )
  }
  const onDropTaskToStatus = (taskId: string, status: TaskStatus) => {
    const draggedTask = workspaceTasks.find((item) => item.id === taskId)
    if (!draggedTask) return
    onMoveTask(draggedTask, status)
  }
  const onDeleteTask = (task: TaskRecord) => {
    if (!token || !session) return
    if (!canDeleteWorkspaceTasks) {
      setError('Only Owner, Admin, or Developer can delete tasks.')
      return
    }
    void run(
      async () => {
        await tasksApi.updateTask(token, task.id, {
          isDeleted: true,
          deletedAt: new Date().toISOString(),
          deletedBy: session.user.id,
        })
        await appendTaskActivity(task.id, 'Task moved to Recycle Bin.')
      },
      {
        successMessage: 'Task moved to Recycle Bin.',
        fallbackError: 'Failed to move task to Recycle Bin.',
        onSuccess: load,
      },
    )
    if (viewTaskId === task.id) {
      setViewTaskId(null)
    }
  }
  const onRestoreTask = (task: TaskRecord) => {
    if (!token) return
    void run(
      async () => {
        await tasksApi.updateTask(token, task.id, { isDeleted: false })
        await appendTaskActivity(task.id, 'Task restored from Recycle Bin.')
      },
      {
        successMessage: 'Task restored.',
        fallbackError: 'Failed to restore task.',
        onSuccess: load,
      },
    )
  }
  const onDeleteTaskPermanently = (task: TaskRecord) => {
    if (!token) return
    void run(
      async () => {
        await tasksApi.removeTask(token, task.id)
      },
      {
        successMessage: 'Task permanently deleted.',
        fallbackError: 'Failed to permanently delete task.',
        onSuccess: load,
      },
    )
    if (viewTaskId === task.id) {
      setViewTaskId(null)
    }
  }
  const onAddStatus = () => {
    const normalized = normalizeTaskStatusName(newStatusName)
    if (!normalized) return
    const alreadyExists = statusOrder.some(
      (status) => status.toLowerCase() === normalized.toLowerCase(),
    )
    if (alreadyExists) {
      setError(`Status "${normalized}" already exists.`)
      return
    }
    setCustomStatuses((current) => [...current, normalized])
    setNewStatusName('')
    setError(null)
    setSuccess(`Status "${normalized}" added.`)
  }
  const onDeleteStatus = (status: TaskStatus) => {
    if (!token) return
    if (!canDeleteWorkspaceTasks) {
      setError('Only Owner, Admin, or Developer can delete columns.')
      return
    }
    const remainingStatuses = statusOrder.filter((item) => item !== status)
    if (remainingStatuses.length === 0) {
      setError('At least one status must remain.')
      return
    }
    const fallbackStatus = remainingStatuses[0]
    const tasksInStatus = workspaceTasks.filter((task) => task.status === status)
    void run(
      async () => {
        if (tasksInStatus.length > 0) {
          await Promise.all(
            tasksInStatus.map((task) =>
              tasksApi.updateTask(token, task.id, { status: fallbackStatus }),
            ),
          )
          for (const task of tasksInStatus) {
            await appendTaskActivity(
              task.id,
              `Status changed from ${taskStatusLabelMap[status] ?? status} to ${taskStatusLabelMap[fallbackStatus] ?? fallbackStatus}.`,
            )
          }
        }
        const statusKey = String(status).toLowerCase()
        if (defaultTaskStatuses.some((item) => item.toLowerCase() === statusKey)) {
          setHiddenDefaultStatuses((current) => dedupeTaskStatuses([...current, status]))
        } else {
          setCustomStatuses((current) => current.filter((item) => item.toLowerCase() !== statusKey))
        }
      },
      {
        successMessage: `Status "${taskStatusLabelMap[status] ?? status}" deleted.`,
        fallbackError: 'Failed to delete status.',
        onSuccess: load,
      },
    )
  }
  const resetContactForm = () => {
    setEditingContactId(null)
    setContactName('')
    setContactPhone('')
    setContactEmail('')
    setContactNotes('')
  }

  const fillContactForm = (contact: ContactRecord) => {
    setEditingContactId(contact.id)
    setContactName(contact.name)
    setContactPhone(contact.phone)
    setContactEmail(contact.email ?? '')
    setContactNotes(contact.notes ?? '')
  }

  const onSubmitContact = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!token) return

    const payload = {
      name: contactName.trim(),
      phone: contactPhone.trim(),
      email: contactEmail.trim() || undefined,
      notes: contactNotes.trim() || undefined,
    }

    await run(
      () =>
        editingContactId
          ? contactsApi.update(token, editingContactId, payload)
          : contactsApi.create(token, payload),
      {
        successMessage: editingContactId ? 'Contact updated.' : 'Contact created.',
        fallbackError: 'Failed to save contact.',
        onSuccess: load,
      },
    )

    resetContactForm()
  }

  const onDeleteContact = async (contactId: string) => {
    if (!token) return
    await run(() => contactsApi.remove(token, contactId), {
      successMessage: 'Contact deleted.',
      fallbackError: 'Failed to delete contact.',
      onSuccess: load,
    })
    if (editingContactId === contactId) {
      resetContactForm()
    }
  }
  const onLeaveMember = async (workspaceItem: WorkspaceRecord, memberId: string) => {
    if (!token || !canManageMembers) return
    const nextExcluded = [...new Set([...(workspaceItem.excludedMemberIds ?? []), memberId])]
    const targetUser = resolveMember(memberId)
    const targetRole = targetUser?.role ?? 'Unknown'
    const privilegedRoles = new Set<Role>(['Owner', 'Admin'])
    const targetIsPrivileged = targetRole === 'Owner' || targetRole === 'Admin'

    const canAccessWithExcludedSet = (user: UserRecord): boolean => {
      if (nextExcluded.includes(user.id)) return false
      if (user.role === 'Owner' || user.role === 'Admin') return true
      if ((workspaceItem.memberIds ?? []).includes(user.id)) return true
      if (!workspaceItem.boardRole) return true
      return user.role === workspaceItem.boardRole
    }

    const remainingPrivilegedMembers = users.filter(
      (user) => privilegedRoles.has(user.role) && canAccessWithExcludedSet(user),
    )

    if (session?.user.role === 'Owner' && memberId === session.user.id) {
      const remainingAdmins = users.filter(
        (user) => user.role === 'Admin' && canAccessWithExcludedSet(user),
      )
      if (remainingAdmins.length === 0) {
        setError('You cannot leave the board.')
        return
      }
    }

    if (targetIsPrivileged && remainingPrivilegedMembers.length === 0) {
      setError('You cannot leave the board.')
      return
    }

    await run(
      () => tasksApi.updateWorkspace(token, workspaceItem.id, { excludedMemberIds: nextExcluded }),
      {
        successMessage: 'Member removed from board.',
        fallbackError: 'Failed to remove member.',
        onSuccess: (result) => {
          setWorkspaces((current) =>
            current.map((item) => (item.id === result.workspace.id ? result.workspace : item)),
          )
          if (workspace?.id === result.workspace.id) {
            setWorkspace(result.workspace)
          }
          setMembersWorkspace(result.workspace)
        },
      },
    )
  }
  const onAddMember = async (workspaceItem: WorkspaceRecord) => {
    if (!token || !canManageMembers || !memberToAddId) return
    const nextMemberIds = [...new Set([...(workspaceItem.memberIds ?? []), memberToAddId])]
    const nextExcluded = (workspaceItem.excludedMemberIds ?? []).filter(
      (id) => id !== memberToAddId,
    )

    await run(
      () =>
        tasksApi.updateWorkspace(token, workspaceItem.id, {
          memberIds: nextMemberIds,
          excludedMemberIds: nextExcluded,
        }),
      {
        successMessage: 'Member added to board.',
        fallbackError: 'Failed to add member.',
        onSuccess: (result) => {
          setWorkspaces((current) =>
            current.map((item) => (item.id === result.workspace.id ? result.workspace : item)),
          )
          if (workspace?.id === result.workspace.id) {
            setWorkspace(result.workspace)
          }
          setMembersWorkspace(result.workspace)
          setMemberToAddId('')
        },
      },
    )
  }
  const onDeleteWorkspace = (workspaceItem: WorkspaceRecord) => {
    if (!token || !session || !canCreateWorkspace) {
      setError('Only Owner or Admin can delete boards.')
      return
    }
    void run(
      async () => {
        await tasksApi.updateWorkspace(token, workspaceItem.id, {
          isDeleted: true,
          deletedAt: new Date().toISOString(),
          deletedBy: session.user.id,
        })
        setFavorites((current) => {
          const next = { ...current }
          delete next[workspaceItem.id]
          return next
        })
      },
      {
        successMessage: 'Board moved to Recycle Bin.',
        fallbackError: 'Failed to move board to Recycle Bin.',
        onSuccess: load,
      },
    )
  }
  const onRestoreWorkspace = (workspaceItem: WorkspaceRecord) => {
    if (!token || !canCreateWorkspace) {
      setError('Only Owner or Admin can restore boards.')
      return
    }
    void run(
      async () => {
        await tasksApi.updateWorkspace(token, workspaceItem.id, { isDeleted: false })
      },
      {
        successMessage: 'Board restored.',
        fallbackError: 'Failed to restore board.',
        onSuccess: load,
      },
    )
  }
  const onDeleteWorkspacePermanently = (workspaceItem: WorkspaceRecord) => {
    if (!token || !canCreateWorkspace) {
      setError('Only Owner or Admin can permanently delete boards.')
      return
    }
    void run(
      async () => {
        await tasksApi.removeWorkspace(token, workspaceItem.id)
      },
      {
        successMessage: 'Board permanently deleted.',
        fallbackError: 'Failed to permanently delete board.',
        onSuccess: load,
      },
    )
  }

  if (!session || !token) {
    return null
  }

  return (
    <ModulePageLayout
      moduleTab="Workspaces"
      title={titleMap[view]}
      subtitle={subtitleMap[view]}
      breadcrumbs={[
        'Pipeline',
        'Workspaces',
        view === 'detail' || view === 'taskDetail'
          ? (workspace?.workspaceName ?? 'Board')
          : titleMap[view],
      ]}
      subnav={subnav}
      subnavActions={
        <TaskNotificationCenter
          token={token}
          currentUserId={session.user.id}
          notificationSettings={session.user.notificationSettings}
          onError={handleTaskChatError}
        />
      }
      hideHeader={view === 'taskDetail'}
    >
      <div className="mb-3 space-y-3">
        <FeedbackBannerStack error={error} success={success} />
      </div>
      {view === 'list' ? (
        <div className="space-y-8">
          <section className="relative overflow-hidden rounded-3xl border border-info/20 bg-panel/70 p-6 shadow-panel backdrop-blur-xl lg:p-8">
            {/* Background Decorative Element */}
            <div className="absolute -right-20 -top-20 h-64 w-64 rounded-full bg-info/5 blur-3xl" />

            <div className="relative flex flex-col items-start justify-between gap-6 lg:flex-row lg:items-center">
              <div className="max-w-2xl">
                <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-info/30 bg-info/10 px-3 py-1 text-[10px] font-bold uppercase tracking-widest text-info">
                  <span className="relative flex h-2 w-2">
                    <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-info opacity-75"></span>
                    <span className="relative inline-flex h-2 w-2 rounded-full bg-info"></span>
                  </span>
                  Workspace Hub
                </div>
                <h3 className="font-display text-4xl font-bold tracking-tight text-text lg:text-5xl">
                  Boards & Strategy
                </h3>
                <p className="mt-2 text-lg text-muted">
                  Orchestrate your team's workflow with precision and real-time collaboration.
                </p>

                <div className="mt-6 flex flex-wrap items-center gap-6">
                  <div className="flex flex-col">
                    <span className="text-2xl font-bold text-text">{boardSummary.total}</span>
                    <span className="text-xs uppercase tracking-wider text-muted">
                      Total Boards
                    </span>
                  </div>
                  <div className="h-8 w-px bg-border/40" />
                  <div className="flex flex-col">
                    <span className="text-2xl font-bold text-text">{boardSummary.tasks}</span>
                    <span className="text-xs uppercase tracking-wider text-muted">
                      Active Tasks
                    </span>
                  </div>
                  <div className="h-8 w-px bg-border/40" />
                  <div className="flex flex-col">
                    <span className="flex items-center gap-2 text-2xl font-bold text-critical">
                      {boardSummary.unread}
                      <span className="flex h-2 w-2 rounded-full bg-critical"></span>
                    </span>
                    <span className="text-xs uppercase tracking-wider text-muted">
                      Unread Alerts
                    </span>
                  </div>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-3">
                <Link to="/settings/preferences" className="ui-btn ui-btn-neutral h-11 px-5">
                  Settings
                </Link>
                {canCreateWorkspace && (
                  <button
                    type="button"
                    onClick={() => setWorkspaceModalOpen(true)}
                    className="ui-btn ui-btn-primary h-11 px-6 shadow-lg shadow-primary/20"
                  >
                    + Create New Board
                  </button>
                )}
              </div>
            </div>
          </section>

          <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
            <div className="flex items-center gap-1 rounded-2xl bg-surface/40 p-1.5 ring-1 ring-border/40">
              {boardTabs.map((tab) => (
                <button
                  key={tab}
                  type="button"
                  onClick={() => patchSearchParams({ tab })}
                  className={`relative flex h-9 items-center px-4 text-sm font-medium transition-all duration-200 ${
                    boardTab === tab
                      ? 'rounded-xl bg-info text-white shadow-md shadow-info/20'
                      : 'text-muted hover:text-text'
                  }`}
                >
                  {tab === 'all' ? `All Boards` : tab}
                  {tab === 'all' && (
                    <span
                      className={`ml-2 flex h-5 min-w-[20px] items-center justify-center rounded-lg px-1.5 text-[10px] font-bold ${
                        boardTab === tab ? 'bg-white/20 text-white' : 'bg-surface text-muted'
                      }`}
                    >
                      {workspaces.length}
                    </span>
                  )}
                </button>
              ))}
            </div>

            <div className="relative group">
              <input
                className="ui-field w-full min-w-[300px] h-11 pl-10 bg-surface/60 border-border/40 focus:bg-surface focus:ring-2 focus:ring-info/20"
                placeholder="🔍Search boards by name..."
                value={q}
                onChange={(event) => patchSearchParams({ q: event.target.value })}
              />
            </div>
          </div>
          <AsyncContent
            loading={loading && filteredWorkspaces.length === 0}
            error={!filteredWorkspaces.length ? error : null}
            isEmpty={!loading && !error && filteredWorkspaces.length === 0 && !canCreateWorkspace}
            emptyTitle="No boards found"
            emptyDescription="Create a board or broaden the current filters to see more workspaces."
            loadingTitle="Loading boards"
            loadingDescription="Refreshing boards, task counts, and unread activity."
            onRetry={() => void load()}
          >
            <section className="grid grid-cols-1 gap-6 md:grid-cols-2 2xl:grid-cols-3">
              {filteredWorkspaces.map((workspaceItem) => {
                const count = taskCountByWorkspace[workspaceItem.id] ?? 0
                const unreadCount = unreadCountByWorkspace[workspaceItem.id] ?? 0
                const isFavorite = Boolean(favorites[workspaceItem.id])
                const memberCount = accessibleMembersByWorkspace[workspaceItem.id]?.length ?? 0

                return (
                  <motion.article
                    key={workspaceItem.id}
                    whileHover={{ y: -4, scale: 1.01 }}
                    onClick={() => navigate(`/workspaces/${workspaceItem.id}`)}
                    className="group relative flex cursor-pointer flex-col overflow-hidden rounded-2xl border border-border/45 bg-panel p-5 shadow-sm transition-all duration-300 hover:border-info/30 hover:shadow-xl hover:shadow-info/5"
                  >
                    <div className="absolute inset-0 -z-10 bg-gradient-to-br from-info/5 via-transparent to-transparent opacity-0 transition-opacity duration-300 group-hover:opacity-100" />

                    <div className="flex items-start justify-between gap-4">
                      <div className="flex-1">
                        <h4 className="font-display text-2xl font-bold tracking-tight text-text group-hover:text-info transition-colors">
                          {workspaceItem.workspaceName}
                        </h4>
                        <p className="mt-1 line-clamp-2 text-sm text-muted">
                          {(workspaceItem.boardRoles?.length ?? 0) > 0
                            ? workspaceItem.boardRoles!.join(', ')
                            : (workspaceItem.boardRole ?? 'All roles')}{' '}
                          board with {memberCount} member{memberCount === 1 ? '' : 's'}. Unified
                          workspace for strategic board management.
                        </p>
                      </div>
                      <div className="flex shrink-0 items-center gap-1.5">
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation()
                            setFavorites((current) => {
                              const next = { ...current }
                              if (next[workspaceItem.id]) delete next[workspaceItem.id]
                              else next[workspaceItem.id] = true
                              return next
                            })
                          }}
                          className={`flex h-8 w-8 items-center justify-center rounded-lg transition-all ${
                            isFavorite
                              ? 'bg-warning/15 text-warning'
                              : 'bg-surface/50 text-muted hover:bg-surface hover:text-text'
                          }`}
                          title={isFavorite ? 'Unstar' : 'Star'}
                        >
                          {isFavorite ? '★' : '☆'}
                        </button>
                        {canCreateWorkspace && (
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation()
                              onDeleteWorkspace(workspaceItem)
                            }}
                            className="flex h-8 w-8 items-center justify-center rounded-lg bg-critical/10 text-critical transition-all hover:bg-critical hover:text-white"
                            title="Delete Board"
                          >
                            <span className="text-xs">🗑️</span>
                          </button>
                        )}
                      </div>
                    </div>

                    <div className="mt-6 flex flex-wrap items-center gap-3">
                      <div className="flex items-center gap-2 rounded-full border border-border/40 bg-surface/40 px-3 py-1 text-xs font-medium text-text">
                        <span className="text-info">📋</span> {count} Tasks
                      </div>
                      {unreadCount > 0 && (
                        <div className="flex items-center gap-2 rounded-full border border-critical/35 bg-critical/10 px-3 py-1 text-xs font-bold text-critical">
                          <span>🔔</span> {unreadCount} Unread
                        </div>
                      )}
                      <div className="flex items-center gap-2 rounded-full border border-border/40 bg-surface/40 px-3 py-1 text-xs font-medium text-muted">
                        <span>👥</span> {memberCount} Members
                      </div>
                    </div>

                    <div className="mt-auto pt-6">
                      <div className="flex items-center justify-between border-t border-border/40 pt-4">
                        <div className="flex -space-x-2">
                          {accessibleMembersByWorkspace[workspaceItem.id]
                            ?.slice(0, 3)
                            .map((member) => (
                              <div
                                key={member.id}
                                className="h-7 w-7 rounded-full border-2 border-panel bg-accent/20 text-[10px] font-bold text-accent flex items-center justify-center ring-1 ring-border/20"
                                title={member.name}
                              >
                                {member.name.substring(0, 2).toUpperCase()}
                              </div>
                            ))}
                          {memberCount > 3 && (
                            <div className="h-7 w-7 rounded-full border-2 border-panel bg-surface text-[9px] font-bold text-muted flex items-center justify-center ring-1 ring-border/20">
                              +{memberCount - 3}
                            </div>
                          )}
                        </div>

                        <div className="flex items-center gap-1">
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation()
                              setMembersWorkspace(workspaceItem)
                            }}
                            className="flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-xs font-medium text-info transition-colors hover:bg-info/10"
                          >
                            <span>Members</span>
                          </button>
                          {canManageMembers && (
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation()
                                setMembersWorkspace(workspaceItem)
                                setMemberToAddId('')
                              }}
                              className="flex h-8 w-8 items-center justify-center rounded-lg text-success transition-colors hover:bg-success/10"
                              title="Add Members"
                            >
                              <span className="text-lg">+</span>
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                  </motion.article>
                )
              })}

              {canCreateWorkspace && (
                <motion.button
                  type="button"
                  whileHover={{ y: -4, scale: 1.01 }}
                  onClick={() => setWorkspaceModalOpen(true)}
                  className="group relative flex min-h-[220px] flex-col items-center justify-center rounded-2xl border-2 border-dashed border-border/70 bg-panel/30 p-6 text-center transition-all duration-300 hover:border-info/40 hover:bg-info/5"
                >
                  <div className="flex h-14 w-14 items-center justify-center rounded-full bg-info/10 text-2xl text-info transition-all duration-300 group-hover:scale-110 group-hover:bg-info group-hover:text-white group-hover:shadow-lg group-hover:shadow-info/20">
                    +
                  </div>
                  <h4 className="mt-4 text-xl font-bold text-text">Create New Board</h4>
                  <p className="mt-1 text-sm text-muted">
                    Initialize a fresh workspace for your team.
                  </p>
                  <div className="absolute inset-0 -z-10 rounded-2xl bg-info/5 opacity-0 blur-xl transition-opacity duration-300 group-hover:opacity-100" />
                </motion.button>
              )}
            </section>
          </AsyncContent>
        </div>
      ) : null}

      {view === 'detail' ? (
        <div className="space-y-5">
          <section className="flex flex-wrap items-start justify-between gap-3 rounded-2xl border border-border/70 bg-panel/70 p-4">
            <div>
              <p className="text-sm text-muted">
                Workspace &gt; {workspace?.workspaceName ?? 'Board'}
              </p>
              <h3 className="mt-1 font-display text-3xl tracking-tight text-text">
                {workspace?.workspaceName ?? 'Workspace Board'}
              </h3>
            </div>
            <div className="flex flex-wrap items-center gap-2 relative">
              <div className="relative">
                <button
                  type="button"
                  onClick={() => setShowStatusPopup((v: boolean) => !v)}
                  className="ui-btn ui-btn-info"
                >
                  + Add Status
                </button>
                {showStatusPopup && (
                  <div className="absolute right-0 top-full z-50 mt-2 w-64 rounded-xl border border-border/70 bg-panel p-3 shadow-xl">
                    <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">
                      New Status
                    </p>
                    <input
                      value={newStatusName}
                      onChange={(event) => setNewStatusName(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter') {
                          onAddStatus()
                          setShowStatusPopup(false)
                        }
                      }}
                      className="ui-field w-full bg-surface"
                      placeholder="Status name"
                      // eslint-disable-next-line jsx-a11y/no-autofocus -- intentional: focus status name input on popup open
                      autoFocus
                    />
                    <div className="mt-2 flex items-center justify-end gap-2">
                      <button
                        type="button"
                        onClick={() => {
                          setShowStatusPopup(false)
                          setNewStatusName('')
                        }}
                        className="rounded-lg px-3 py-1.5 text-xs font-medium text-muted hover:bg-surface"
                      >
                        Cancel
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          onAddStatus()
                          setShowStatusPopup(false)
                        }}
                        className="rounded-lg bg-info px-3 py-1.5 text-xs font-medium text-white hover:bg-info/80"
                      >
                        Add
                      </button>
                    </div>
                  </div>
                )}
              </div>
              <button
                type="button"
                onClick={() => openTaskModal(statusOrder[0] ?? 'Todo')}
                className="ui-btn ui-btn-primary"
              >
                + Add Task
              </button>
            </div>
          </section>

          <AsyncContent
            loading={loading && statusColumns.length === 0}
            error={!statusColumns.length ? error : null}
            isEmpty={!loading && !error && statusColumns.length === 0}
            emptyTitle="No task columns available"
            emptyDescription="Add a status or create a task to populate this board."
            loadingTitle="Loading board tasks"
            loadingDescription="Refreshing status columns, tasks, and unread activity."
            onRetry={() => void load()}
          >
            <section className="flex gap-4 overflow-x-auto pb-4">
              {statusColumns.map((column) => (
                <div
                  key={column.id}
                  onDragOver={(event) => {
                    event.preventDefault()
                  }}
                  onDrop={(event) => {
                    event.preventDefault()
                    const droppedTaskId = event.dataTransfer.getData('text/plain') || dragTaskId
                    setDragTaskId(null)
                    if (!droppedTaskId) return
                    onDropTaskToStatus(droppedTaskId, column.id)
                  }}
                  className={`w-[280px] shrink-0 rounded-2xl border bg-panel/40 p-3 transition-colors ${
                    dragTaskId ? 'border-info/40 bg-info/5' : 'border-border/40'
                  }`}
                >
                  <div className="mb-3 flex items-center justify-between px-1">
                    <div className="flex items-center gap-2">
                      <h4 className="text-sm font-bold uppercase tracking-wider text-text">
                        {column.label}
                      </h4>
                      <span className="rounded-full bg-surface px-2 py-0.5 text-[10px] font-bold text-muted">
                        {column.tasks.length}
                      </span>
                    </div>
                    <div className="relative flex items-center gap-1">
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation()
                          openTaskModal(column.id)
                        }}
                        className="flex h-7 w-7 items-center justify-center rounded-lg text-muted transition hover:bg-surface hover:text-text"
                        title="Add task"
                      >
                        +
                      </button>
                      {canDeleteWorkspaceTasks ? (
                        <div className="relative">
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation()
                              setColumnMenuOpen(columnMenuOpen === column.id ? null : column.id)
                            }}
                            className="flex h-7 w-7 items-center justify-center rounded-lg text-muted transition hover:bg-surface hover:text-text"
                          >
                            &#8942;
                          </button>
                          {columnMenuOpen === column.id && (
                            <div className="absolute right-0 top-full z-20 mt-1 w-40 rounded-xl border border-border/70 bg-panel p-1 shadow-xl shadow-black/20">
                              <button
                                type="button"
                                onClick={() => {
                                  onDeleteStatus(column.id)
                                  closeMenus()
                                }}
                                className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-xs font-medium text-critical transition hover:bg-critical/10"
                              >
                                <span>🗑️</span> Delete Column
                              </button>
                            </div>
                          )}
                        </div>
                      ) : null}
                    </div>
                  </div>

                  <div className="min-h-[100px] space-y-3">
                    {column.tasks.map((task) => {
                      const ownerName = resolveUserName(task.assignedTo)
                      const unreadCount = unreadByTaskId[task.id] ?? 0

                      const lastComment = task.comments?.[task.comments.length - 1]
                      let commentPreview = ''
                      if (lastComment) {
                        const text = lastComment.comment
                        if (text.startsWith('[[activity]] ')) {
                          commentPreview = text.replace('[[activity]] ', '')
                        } else if (text.startsWith('[[message]] ')) {
                          try {
                            const payload = JSON.parse(text.replace('[[message]] ', ''))
                            commentPreview = payload.text || `Sent a ${payload.type}`
                          } catch {
                            commentPreview = 'New message'
                          }
                        } else {
                          commentPreview = text
                        }
                      }

                      return (
                        <article
                          key={task.id}
                          role="button"
                          tabIndex={0}
                          draggable
                          onDragStart={(event) => {
                            event.dataTransfer.effectAllowed = 'move'
                            event.dataTransfer.setData('text/plain', task.id)
                            setDragTaskId(task.id)
                          }}
                          onDragEnd={() => {
                            setDragTaskId(null)
                          }}
                          onClick={() => navigate(`/workspaces/${workspaceId}/task/${task.id}`)}
                          className="group relative cursor-pointer rounded-xl border border-border/40 bg-surface/40 p-3.5 shadow-sm transition-all duration-200 hover:border-info/30 hover:bg-surface/80 hover:shadow-md hover:shadow-info/5"
                        >
                          {/* Top: Task Name and Priority/Status Badge */}
                          <div className="mb-2 flex items-start justify-between gap-3">
                            <h4 className="flex-1 text-sm font-semibold leading-tight text-text group-hover:text-info transition-colors line-clamp-2">
                              {task.taskName}
                            </h4>
                            <div className="flex shrink-0 items-center gap-1.5">
                              <span
                                className={`rounded-lg px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider ${priorityTone[task.priority]}`}
                              >
                                {task.priority}
                              </span>
                              <div className="relative">
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation()
                                    setTaskMenuOpen(taskMenuOpen === task.id ? null : task.id)
                                  }}
                                  className="flex h-6 w-6 items-center justify-center rounded-md text-muted opacity-0 transition-opacity group-hover:opacity-100 hover:bg-panel hover:text-text"
                                >
                                  &#8942;
                                </button>
                                {taskMenuOpen === task.id && (
                                  <div className="absolute right-0 top-full z-20 mt-1 w-40 rounded-xl border border-border/70 bg-panel p-1 shadow-xl shadow-black/20">
                                    <button
                                      type="button"
                                      onClick={(e) => {
                                        e.stopPropagation()
                                        navigate(`/workspaces/${workspaceId}/task/${task.id}`)
                                        closeMenus()
                                      }}
                                      className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-xs font-medium text-text transition hover:bg-surface"
                                    >
                                      <span>👁️</span> View Details
                                    </button>
                                    {canDeleteWorkspaceTasks ? (
                                      <button
                                        type="button"
                                        onClick={(e) => {
                                          e.stopPropagation()
                                          onDeleteTask(task)
                                          closeMenus()
                                        }}
                                        className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-xs font-medium text-critical transition hover:bg-critical/10"
                                      >
                                        <span>🗑️</span> Delete Task
                                      </button>
                                    ) : null}
                                  </div>
                                )}
                              </div>
                            </div>
                          </div>

                          {/* Below: Due Date */}
                          <div className="mb-2 flex items-center gap-1.5 text-[10px] text-muted font-medium">
                            <span className="opacity-70">📅</span>
                            <span>{fmtDateIST(task.dueDate)}</span>
                          </div>

                          {/* Below: Description Preview */}
                          {task.description && task.description !== 'No description' && (
                            <p className="mb-3 text-[11px] leading-relaxed text-muted line-clamp-2 italic opacity-80">
                              {task.description}
                            </p>
                          )}

                          {/* Below: Recent Message Preview */}
                          {commentPreview && (
                            <div className="mb-3 flex items-start gap-2 rounded-lg bg-surface/30 p-2 border border-border/20">
                              <span className="mt-0.5 text-[10px] opacity-50">💬</span>
                              <p className="text-[10px] text-muted line-clamp-1 italic leading-tight">
                                {commentPreview}
                              </p>
                            </div>
                          )}

                          {/* Bottom: Assigned User */}
                          <div className="mt-2 flex items-center justify-between">
                            <div className="flex items-center gap-2">
                              <div
                                className="flex h-6 w-6 items-center justify-center rounded-full bg-accent/10 text-[10px] font-bold text-accent ring-1 ring-accent/20"
                                title={ownerName}
                              >
                                {ownerName.substring(0, 2).toUpperCase()}
                              </div>
                              <span className="text-[10px] font-medium text-muted">
                                {ownerName}
                              </span>
                            </div>
                            {unreadCount > 0 && (
                              <span className="flex h-5 min-w-[20px] items-center justify-center rounded-full bg-critical px-1 text-[9px] font-bold text-white shadow-sm shadow-critical/20">
                                {unreadCount}
                              </span>
                            )}
                          </div>
                        </article>
                      )
                    })}

                    {column.tasks.length === 0 ? (
                      <p className="rounded-xl border border-dashed border-border/70 bg-panel/50 px-3 py-4 text-center text-xs text-muted">
                        No tasks in {column.label.toLowerCase()}.
                      </p>
                    ) : null}
                  </div>
                </div>
              ))}
            </section>
          </AsyncContent>
        </div>
      ) : null}
      {view === 'recycleBin' ? (
        <div className="space-y-4">
          <section className="rounded-2xl border border-warning/25 bg-panel/60 p-4 shadow-panel backdrop-blur">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <p className="mb-2 inline-flex rounded-full border border-warning/40 bg-warning/15 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-warning">
                  Recovery
                </p>
                <h3 className="font-display text-3xl tracking-tight text-text md:text-4xl">
                  Recycle Bin
                </h3>
                <p className="mt-1 text-sm text-muted">
                  Deleted boards and tasks are stored here until you restore or permanently remove
                  them.
                </p>
                <p className="mt-3 text-xs text-muted">
                  {deletedWorkspaces.length} deleted board
                  {deletedWorkspaces.length === 1 ? '' : 's'} | {deletedTasks.length} deleted task
                  {deletedTasks.length === 1 ? '' : 's'}
                </p>
              </div>
              <input
                className="w-full max-w-xs rounded-lg border border-border/80 bg-surface px-3 py-2 text-sm text-text"
                placeholder="Search deleted boards or tasks..."
                value={q}
                onChange={(event) => patchSearchParams({ q: event.target.value })}
              />
            </div>
          </section>

          <section className="space-y-2">
            <h4 className="text-sm font-semibold uppercase tracking-wide text-muted">
              Deleted Boards
            </h4>
            <AsyncContent
              loading={loading && filteredDeletedWorkspaces.length === 0}
              error={!filteredDeletedWorkspaces.length ? error : null}
              isEmpty={!loading && !error && filteredDeletedWorkspaces.length === 0}
              emptyTitle="No deleted boards"
              emptyDescription="Deleted boards will appear here until they are restored or permanently removed."
              loadingTitle="Loading deleted boards"
              loadingDescription="Refreshing the board recovery queue."
              onRetry={() => void load()}
            >
              <DataTable
                columns={[
                  {
                    key: 'workspaceName',
                    header: 'Board',
                    render: (workspaceItem) => (
                      <span className="font-semibold text-text">{workspaceItem.workspaceName}</span>
                    ),
                  },
                  {
                    key: 'deletedAt',
                    header: 'Deleted On',
                    render: (workspaceItem) => {
                      return workspaceItem.deletedAt
                        ? fmtDateTimeFullIST(workspaceItem.deletedAt)
                        : 'Unknown'
                    },
                  },
                  {
                    key: 'actions',
                    header: 'Actions',
                    render: (workspaceItem) =>
                      canCreateWorkspace ? (
                        <div className="flex flex-wrap gap-2">
                          <button
                            type="button"
                            onClick={() => onRestoreWorkspace(workspaceItem)}
                            className="ui-btn ui-btn-success min-h-8 px-2 py-1 text-xs"
                          >
                            Restore
                          </button>
                          <button
                            type="button"
                            onClick={() => onDeleteWorkspacePermanently(workspaceItem)}
                            className="ui-btn ui-btn-danger min-h-8 px-2 py-1 text-xs"
                          >
                            Delete Permanently
                          </button>
                        </div>
                      ) : (
                        <span className="text-xs text-muted">Read-only</span>
                      ),
                  },
                ]}
                rows={filteredDeletedWorkspaces}
                rowKey={(workspaceItem) => workspaceItem.id}
                emptyMessage="No deleted boards."
              />
            </AsyncContent>
          </section>

          <section className="space-y-2">
            <h4 className="text-sm font-semibold uppercase tracking-wide text-muted">
              Deleted Tasks
            </h4>
            <AsyncContent
              loading={loading && filteredDeletedTasks.length === 0}
              error={!filteredDeletedTasks.length ? error : null}
              isEmpty={!loading && !error && filteredDeletedTasks.length === 0}
              emptyTitle="No deleted tasks"
              emptyDescription="Deleted tasks will appear here until they are restored or removed."
              loadingTitle="Loading deleted tasks"
              loadingDescription="Refreshing the task recovery queue."
              onRetry={() => void load()}
            >
              <DataTable
                columns={[
                  {
                    key: 'taskName',
                    header: 'Task',
                    render: (task) => (
                      <span className="font-semibold text-text">{task.taskName}</span>
                    ),
                  },
                  {
                    key: 'workspace',
                    header: 'Workspace',
                    render: (task) => workspaceNameById[task.workspaceId] ?? 'Unknown Board',
                  },
                  {
                    key: 'deletedAt',
                    header: 'Deleted On',
                    render: (task) => {
                      return task.deletedAt ? fmtDateTimeFullIST(task.deletedAt) : 'Unknown'
                    },
                  },
                  {
                    key: 'actions',
                    header: 'Actions',
                    render: (task) => (
                      <div className="flex flex-wrap gap-2">
                        <button
                          type="button"
                          onClick={() => onRestoreTask(task)}
                          className="ui-btn ui-btn-success min-h-8 px-2 py-1 text-xs"
                        >
                          Restore
                        </button>
                        <button
                          type="button"
                          onClick={() => onDeleteTaskPermanently(task)}
                          className="ui-btn ui-btn-danger min-h-8 px-2 py-1 text-xs"
                        >
                          Delete Permanently
                        </button>
                      </div>
                    ),
                  },
                ]}
                rows={filteredDeletedTasks}
                rowKey={(task) => task.id}
                emptyMessage="No deleted tasks."
              />
            </AsyncContent>
          </section>
        </div>
      ) : null}
      {view === 'contacts' ? (
        <>
          <FilterBar>
            <FilterField label="Search">
              <input
                className="ui-field min-h-10"
                value={q}
                placeholder="Name, phone, email"
                onChange={(event) => patchSearchParams({ q: event.target.value })}
              />
            </FilterField>
          </FilterBar>

          <div className="mt-4">
            <DetailPanel title={editingContactId ? 'Edit Contact' : 'Add Contact'}>
              <form className="grid grid-cols-1 gap-2 md:grid-cols-5" onSubmit={onSubmitContact}>
                <input
                  className="ui-field min-h-10"
                  placeholder="Name"
                  value={contactName}
                  onChange={(event) => setContactName(event.target.value)}
                  required
                />
                <input
                  className="ui-field min-h-10"
                  placeholder="Phone"
                  value={contactPhone}
                  onChange={(event) => setContactPhone(event.target.value)}
                  required
                />
                <input
                  className="ui-field min-h-10"
                  placeholder="Email"
                  value={contactEmail}
                  onChange={(event) => setContactEmail(event.target.value)}
                />
                <input
                  className="ui-field min-h-10"
                  placeholder="Notes"
                  value={contactNotes}
                  onChange={(event) => setContactNotes(event.target.value)}
                />
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="submit"
                    disabled={loading}
                    className="ui-btn ui-btn-primary disabled:opacity-70"
                  >
                    {editingContactId ? 'Update' : 'Create'}
                  </button>
                  {editingContactId ? (
                    <button
                      type="button"
                      onClick={resetContactForm}
                      className="rounded-lg border border-border bg-panel px-3 py-1.5 text-sm text-text"
                    >
                      Cancel
                    </button>
                  ) : null}
                </div>
              </form>
            </DetailPanel>
          </div>

          <div className="mt-4">
            <AsyncContent
              loading={loading && contacts.length === 0}
              error={!contacts.length ? error : null}
              isEmpty={!loading && !error && contacts.length === 0}
              emptyTitle="No contacts found"
              emptyDescription="Add a contact or broaden the current search to see more records."
              loadingTitle="Loading contacts"
              loadingDescription="Refreshing the workspace contact register."
              onRetry={() => void load()}
            >
              <DataTable
                columns={[
                  { key: 'name', header: 'Name', render: (contact) => contact.name },
                  { key: 'phone', header: 'Phone', render: (contact) => contact.phone },
                  { key: 'email', header: 'Email', render: (contact) => contact.email ?? '-' },
                  { key: 'notes', header: 'Notes', render: (contact) => contact.notes ?? '-' },
                  {
                    key: 'createdAt',
                    header: 'Created',
                    render: (contact) => fmtDateIST(contact.createdAt),
                  },
                  {
                    key: 'actions',
                    header: 'Actions',
                    render: (contact) => {
                      const canMutateContact =
                        session.user.role === 'Owner' ||
                        session.user.role === 'Admin' ||
                        contact.createdBy === session.user.id
                      return canMutateContact ? (
                        <div className="flex flex-wrap gap-2">
                          <button
                            type="button"
                            onClick={() => fillContactForm(contact)}
                            className="ui-btn ui-btn-info min-h-8 px-2 py-1 text-xs"
                          >
                            Edit
                          </button>
                          <button
                            type="button"
                            onClick={() => void onDeleteContact(contact.id)}
                            className="ui-btn ui-btn-danger min-h-8 px-2 py-1 text-xs"
                          >
                            Delete
                          </button>
                        </div>
                      ) : (
                        <span className="text-xs text-muted">Read-only</span>
                      )
                    },
                  },
                ]}
                rows={contacts}
                rowKey={(contact) => contact.id}
                emptyMessage="No contacts found."
              />
            </AsyncContent>
          </div>
        </>
      ) : null}
      {view === 'workReport' ? (
        !canViewWorkReport ? (
          <div className="mt-4">
            <AsyncContent
              loading={false}
              error="You do not have access to this page."
              isEmpty={false}
              emptyTitle=""
              emptyDescription=""
            >
              <></>
            </AsyncContent>
          </div>
        ) : (
          <>
            <FilterBar>
              <FilterField label="Select Workspace">
                <select
                  value={selectedReportWorkspaceId}
                  onChange={(event) => setSelectedReportWorkspaceId(event.target.value)}
                  className="min-w-[260px] flex-1 rounded-lg border border-border/80 bg-surface px-3 py-2 text-sm text-text"
                >
                  <option value="">-- Select a workspace --</option>
                  {workspaces
                    .filter((workspaceItem) => !workspaceItem.isDeleted)
                    .map((workspaceItem) => (
                      <option key={workspaceItem.id} value={workspaceItem.id}>
                        {workspaceItem.workspaceName}
                      </option>
                    ))}
                </select>
              </FilterField>
            </FilterBar>

            {!selectedReportWorkspaceId ? (
              <div className="mt-4">
                <AsyncContent
                  loading={false}
                  error={null}
                  isEmpty={true}
                  emptyTitle="Select a workspace"
                  emptyDescription="Choose a workspace from the dropdown above to generate its work report."
                >
                  <></>
                </AsyncContent>
              </div>
            ) : (
              <>
                <div className="mt-4 flex flex-wrap gap-2">
                  {workReportStatusTabs.map((status) => (
                    <button
                      key={status}
                      type="button"
                      onClick={() => setWorkReportStatusTab(status)}
                      className={`ui-btn h-9 px-4 text-xs ${
                        workReportStatusTab === status ? 'ui-btn-primary' : 'ui-btn-ghost'
                      }`}
                    >
                      {taskStatusLabelMap[status] ?? status} ({workReportTabCounts[status]})
                    </button>
                  ))}
                </div>

                <div className="mt-4">
                  <AsyncContent
                    loading={workReportLoading && workReportTasks.length === 0}
                    error={workReportError}
                    isEmpty={!workReportLoading && !workReportError && workReportTasks.length === 0}
                    emptyTitle="No tasks in this workspace"
                    emptyDescription="This workspace does not have any tasks yet."
                    loadingTitle="Loading work report"
                    loadingDescription="Fetching tasks for the selected workspace."
                    onRetry={() => setSelectedReportWorkspaceId((id) => id)}
                  >
                    <DataTable
                      columns={[
                        {
                          key: 'taskName',
                          header: 'Task Name',
                          render: (task) => (
                            <span className="font-medium text-text">{task.taskName}</span>
                          ),
                        },
                        {
                          key: 'assignedTo',
                          header: 'Assigned User',
                          render: (task) => resolveUserName(task.assignedTo),
                        },
                        {
                          key: 'dueDate',
                          header: 'Date',
                          render: (task) => fmtDateIST(task.dueDate),
                        },
                        {
                          key: 'priority',
                          header: 'Priority',
                          render: (task) => (
                            <span
                              className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ${priorityTone[task.priority]}`}
                            >
                              {task.priority}
                            </span>
                          ),
                        },
                        {
                          key: 'status',
                          header: 'Status',
                          render: (task) => (
                            <span
                              className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold ${
                                taskStatusToneMap[task.status] ?? taskStatusToneMap.Todo
                              }`}
                            >
                              {taskStatusLabelMap[task.status] ?? task.status}
                            </span>
                          ),
                        },
                      ]}
                      rows={filteredWorkReportTasks}
                      rowKey={(task) => task.id}
                      emptyMessage={`No ${taskStatusLabelMap[workReportStatusTab] ?? workReportStatusTab} tasks.`}
                    />
                  </AsyncContent>
                </div>
              </>
            )}
          </>
        )
      ) : null}

      {workspaceModalOpen ? (
        <div className="fixed inset-0 z-40 grid place-items-center bg-base/75 p-4 backdrop-blur-sm">
          <div
            className="flex w-full max-w-2xl flex-col rounded-2xl border border-border/80 bg-panel shadow-panel"
            style={{ maxHeight: '85vh' }}
          >
            <div className="flex items-center justify-between border-b border-border/70 px-5 py-4">
              <div>
                <h4 className="text-2xl font-semibold text-text">Create New Board</h4>
                <p className="text-sm text-muted">
                  Configure roles and select team members for this board.
                </p>
              </div>
              <button
                type="button"
                onClick={() => {
                  setWorkspaceModalOpen(false)
                  resetBoardCreationState()
                }}
                className="ui-btn ui-btn-neutral min-h-8 px-2 py-1 text-sm text-muted"
              >
                x
              </button>
            </div>

            <div className="flex-1 space-y-5 overflow-y-auto px-5 py-4">
              <div>
                <label className="mb-1 block text-sm text-muted" htmlFor="boardCreationName">
                  Board Name
                </label>
                <input
                  id="boardCreationName"
                  value={boardCreationName}
                  onChange={(e) => setBoardCreationName(e.target.value)}
                  className="ui-field w-full rounded-xl bg-surface"
                  placeholder="e.g., Product Launch"
                />
              </div>

              <div>
                <p className="mb-2 text-sm font-semibold text-text">Select Roles</p>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                  {ALL_ROLES.map((role) => {
                    const isChecked = boardCreationRoles.has(role)
                    const count = (filteredUsersByRole[role] ?? []).length
                    return (
                      <label
                        key={role}
                        className={`flex cursor-pointer items-center gap-2 rounded-xl border px-3 py-2 text-sm transition-colors ${
                          isChecked
                            ? 'border-info/50 bg-info/10 text-info font-medium'
                            : 'border-border/60 bg-surface/50 text-text hover:border-border'
                        }`}
                      >
                        <input
                          type="checkbox"
                          checked={isChecked}
                          onChange={() => toggleBoardCreationRole(role)}
                          className="accent-info"
                        />
                        <span>{role}</span>
                        <span className="ml-auto text-xs text-muted">({count})</span>
                      </label>
                    )
                  })}
                </div>
              </div>

              {/* Location Filter */}
              <div>
                <p className="mb-2 text-sm font-semibold text-text">Filter by Location</p>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                  {enabledLocations.map((loc) => {
                    const isChecked = boardCreationLocations.has(loc.slug)
                    return (
                      <label
                        key={loc.slug}
                        className={`flex cursor-pointer items-center gap-2 rounded-xl border px-3 py-2 text-sm transition-colors ${
                          isChecked
                            ? 'border-info/50 bg-info/10 text-info font-medium'
                            : 'border-border/60 bg-surface/50 text-text hover:border-border'
                        }`}
                      >
                        <input
                          type="checkbox"
                          checked={isChecked}
                          onChange={() => {
                            setBoardCreationLocations((prev) => {
                              const next = new Set(prev)
                              if (next.has(loc.slug)) next.delete(loc.slug)
                              else next.add(loc.slug)
                              return next
                            })
                          }}
                          className="accent-info"
                        />
                        <span>{loc.displayName}</span>
                      </label>
                    )
                  })}
                </div>
                {boardCreationLocations.size > 0 && (
                  <button
                    type="button"
                    onClick={() => setBoardCreationLocations(new Set())}
                    className="mt-1.5 text-xs text-muted hover:text-text transition-colors"
                  >
                    Clear location filter
                  </button>
                )}
              </div>

              {Array.from(boardCreationRoles).map((role) => {
                const roleUsers = filteredUsersByRole[role] ?? []
                const allSelected =
                  roleUsers.length > 0 && roleUsers.every((u) => boardCreationMemberIds.has(u.id))
                return (
                  <div key={role} className="rounded-xl border border-border/60 bg-surface/50 p-4">
                    <div className="mb-2 flex items-center justify-between">
                      <span className="text-sm font-semibold text-text">{role} Members</span>
                      {roleUsers.length > 0 && (
                        <label className="flex cursor-pointer items-center gap-1.5 text-xs text-muted">
                          <input
                            type="checkbox"
                            checked={allSelected}
                            onChange={() => toggleAllForRole(role)}
                            className="accent-info"
                          />
                          Select All ({roleUsers.length})
                        </label>
                      )}
                    </div>
                    {roleUsers.length === 0 ? (
                      <p className="text-xs text-muted">No users with the {role} role found.</p>
                    ) : (
                      <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
                        {roleUsers.map((user) => (
                          <label
                            key={user.id}
                            className={`flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 transition-colors ${
                              boardCreationMemberIds.has(user.id)
                                ? 'border-info/40 bg-info/5'
                                : 'border-border/40 bg-panel hover:border-border/60'
                            }`}
                          >
                            <input
                              type="checkbox"
                              checked={boardCreationMemberIds.has(user.id)}
                              onChange={() => toggleBoardCreationMember(user.id)}
                              className="accent-info"
                            />
                            <div className="min-w-0">
                              <span className="block truncate text-sm text-text">{user.name}</span>
                              <span className="block truncate text-xs text-muted">
                                {user.email}
                              </span>
                            </div>
                          </label>
                        ))}
                      </div>
                    )}
                  </div>
                )
              })}

              {boardCreationMemberIds.size > 0 && (
                <p className="text-sm text-muted">
                  {boardCreationMemberIds.size} member{boardCreationMemberIds.size !== 1 ? 's' : ''}{' '}
                  selected
                  {boardCreationRoles.size > 0 && (
                    <>
                      {' '}
                      across {boardCreationRoles.size} role
                      {boardCreationRoles.size !== 1 ? 's' : ''}
                    </>
                  )}
                </p>
              )}
            </div>

            <div className="flex justify-end gap-2 border-t border-border/70 px-5 py-4">
              <button
                type="button"
                onClick={() => {
                  setWorkspaceModalOpen(false)
                  resetBoardCreationState()
                }}
                className="ui-btn ui-btn-neutral"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void handleCreateBoard()}
                disabled={loading || !boardCreationName.trim()}
                className="ui-btn ui-btn-primary disabled:opacity-70"
              >
                Confirm &amp; Create Board
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {membersWorkspace ? (
        <div className="fixed inset-0 z-40 grid place-items-center bg-base/75 p-4 backdrop-blur-sm">
          {(() => {
            const accessibleMembers = accessibleMembersByWorkspace[membersWorkspace.id] ?? []
            const accessibleMemberIds = new Set(accessibleMembers.map((member) => member.id))
            const addableUsers = users.filter((user) => !accessibleMemberIds.has(user.id))
            return (
              <div className="w-full max-w-2xl rounded-2xl border border-border/80 bg-panel shadow-panel">
                <div className="flex items-center justify-between border-b border-border/70 px-5 py-4">
                  <div>
                    <h4 className="text-2xl font-semibold text-text">
                      {membersWorkspace.workspaceName} Members
                    </h4>
                    <p className="text-sm text-muted">
                      Access Roles:{' '}
                      {(membersWorkspace.boardRoles?.length ?? 0) > 0
                        ? membersWorkspace.boardRoles!.join(', ')
                        : (membersWorkspace.boardRole ?? 'All roles')}{' '}
                      | {accessibleMembers.length} member
                      {accessibleMembers.length === 1 ? '' : 's'}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setMembersWorkspace(null)}
                    className="ui-btn ui-btn-neutral min-h-8 px-2 py-1 text-sm text-muted"
                  >
                    x
                  </button>
                </div>

                <div className="space-y-2 px-5 py-4">
                  {canManageMembers ? (
                    <div className="rounded-xl border border-success/30 bg-success/5 p-3">
                      <p className="mb-2 text-sm font-semibold text-text">Add Member</p>
                      <div className="flex flex-wrap items-center gap-2">
                        <select
                          value={memberToAddId}
                          onChange={(event) => setMemberToAddId(event.target.value)}
                          className="min-w-[220px] flex-1 rounded-lg border border-border/80 bg-surface px-3 py-2 text-sm text-text"
                        >
                          <option value="">Select existing user</option>
                          {addableUsers.map((user) => (
                            <option key={user.id} value={user.id}>
                              {user.name} ({user.role})
                            </option>
                          ))}
                        </select>
                        <button
                          type="button"
                          onClick={() => void onAddMember(membersWorkspace)}
                          disabled={!memberToAddId}
                          className="rounded-lg border border-success/40 bg-success/10 px-3 py-2 text-sm font-semibold text-success disabled:opacity-50"
                        >
                          Add
                        </button>
                      </div>
                    </div>
                  ) : null}
                  {accessibleMembers.length === 0 ? (
                    <p className="rounded-xl border border-dashed border-border/70 bg-surface px-3 py-4 text-sm text-muted">
                      No members added to this board.
                    </p>
                  ) : (
                    accessibleMembers.map((member) => {
                      return (
                        <div
                          key={member.id}
                          className="rounded-xl border border-border/70 bg-surface px-3 py-2"
                        >
                          <div className="flex items-start justify-between gap-3">
                            <div>
                              <p className="text-sm font-semibold text-text">{member.name}</p>
                              <p className="text-xs text-muted">{member.email}</p>
                              <p className="text-xs text-info">{member.role}</p>
                            </div>
                            {canManageMembers ? (
                              <button
                                type="button"
                                onClick={() => void onLeaveMember(membersWorkspace, member.id)}
                                className="rounded-lg border border-critical/60 bg-critical/10 px-2 py-1 text-xs font-semibold text-critical"
                              >
                                Leave
                              </button>
                            ) : null}
                          </div>
                        </div>
                      )
                    })
                  )}
                </div>

                <div className="flex justify-end border-t border-border/70 px-5 py-4">
                  <button
                    type="button"
                    onClick={() => setMembersWorkspace(null)}
                    className="ui-btn ui-btn-neutral"
                  >
                    Close
                  </button>
                </div>
              </div>
            )
          })()}
        </div>
      ) : null}

      {taskModalOpen && view === 'detail' ? (
        <div className="fixed inset-0 z-40 overflow-y-auto bg-base/75 p-4 backdrop-blur-sm">
          <div className="mx-auto flex w-full max-w-3xl flex-col rounded-2xl border border-border/80 bg-panel shadow-panel md:my-6 md:max-h-[90vh]">
            <div className="flex items-center justify-between border-b border-border/70 px-6 py-5">
              <div>
                <h4 className="text-3xl font-semibold text-text">Create New Task</h4>
                <p className="text-base text-muted">Add a new task to your Pipeline workspace</p>
              </div>
              <button
                type="button"
                onClick={() => setTaskModalOpen(false)}
                className="ui-btn ui-btn-neutral min-h-8 px-2 py-1 text-sm text-muted"
              >
                x
              </button>
            </div>

            <form onSubmit={onCreateTask} className="space-y-4 overflow-y-auto px-6 py-5">
              <div>
                <label className="mb-1 block text-sm text-muted" htmlFor="task-name">
                  Task Name
                </label>
                <input
                  id="task-name"
                  required
                  value={taskDraft.taskName}
                  onChange={(event) =>
                    setTaskDraft((current) => ({ ...current, taskName: event.target.value }))
                  }
                  className="ui-field w-full rounded-xl bg-surface"
                  placeholder="e.g., Design System Update"
                />
              </div>

              <div>
                <label className="mb-1 block text-sm text-muted" htmlFor="task-description">
                  Description
                </label>
                <textarea
                  id="task-description"
                  rows={4}
                  value={taskDraft.description}
                  onChange={(event) =>
                    setTaskDraft((current) => ({ ...current, description: event.target.value }))
                  }
                  className="w-full resize-none rounded-xl border border-border/80 bg-surface px-3 py-2 text-sm text-text"
                  placeholder="Add a detailed description..."
                />
              </div>

              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <div>
                  <label className="mb-1 block text-sm text-muted" htmlFor="task-assignee">
                    Assignee
                  </label>
                  <select
                    id="task-assignee"
                    value={taskDraft.assignedTo}
                    onChange={(event) =>
                      setTaskDraft((current) => ({ ...current, assignedTo: event.target.value }))
                    }
                    className="ui-field w-full rounded-xl bg-surface"
                  >
                    <option value="">Select teammate</option>
                    {boardMembers.map((user) => (
                      <option key={user.id} value={user.id}>
                        {user.name} – {user.role}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="mb-1 block text-sm text-muted" htmlFor="task-due-date">
                    Due Date
                  </label>
                  <input
                    id="task-due-date"
                    type="date"
                    value={taskDraft.dueDate}
                    onChange={(event) =>
                      setTaskDraft((current) => ({ ...current, dueDate: event.target.value }))
                    }
                    className="ui-field w-full rounded-xl bg-surface"
                  />
                </div>

                <div>
                  <label className="mb-1 block text-sm text-muted" htmlFor="task-priority">
                    Priority
                  </label>
                  <select
                    id="task-priority"
                    value={taskDraft.priority}
                    onChange={(event) =>
                      setTaskDraft((current) => ({
                        ...current,
                        priority: event.target.value as TaskRecord['priority'],
                      }))
                    }
                    className="ui-field w-full rounded-xl bg-surface"
                  >
                    <option value="Low">Low</option>
                    <option value="Medium">Medium</option>
                    <option value="High">High</option>
                    <option value="Urgent">Urgent</option>
                  </select>
                </div>

                <div>
                  <label className="mb-1 block text-sm text-muted" htmlFor="task-status">
                    Status
                  </label>
                  <select
                    id="task-status"
                    value={taskDraft.status}
                    onChange={(event) =>
                      setTaskDraft((current) => ({
                        ...current,
                        status: event.target.value as TaskStatus,
                      }))
                    }
                    className="ui-field w-full rounded-xl bg-surface"
                  >
                    {statusOrder.map((status) => (
                      <option key={status} value={status}>
                        {taskStatusLabelMap[status] ?? status}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div>
                <p className="mb-1 block text-sm text-muted">Attachments</p>
                <label className="block rounded-xl border border-dashed border-border/70 bg-panel px-3 py-4 text-center text-sm text-muted">
                  Click to upload or drag and drop
                  <input type="file" multiple className="hidden" />
                </label>
              </div>

              <div className="flex justify-end gap-3 border-t border-border/70 pt-4">
                <button
                  type="button"
                  onClick={() => setTaskModalOpen(false)}
                  className="ui-btn ui-btn-neutral"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={loading}
                  className="ui-btn ui-btn-primary disabled:opacity-70"
                >
                  Create Task
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}

      {view === 'taskDetail' ? (
        <div className="flex h-screen flex-col bg-base overflow-hidden -mx-1 -my-1 lg:-mx-2 lg:-my-1">
          {/* Custom Task Header */}
          <div className="flex items-center justify-between border-b border-border/70 bg-panel px-6 py-4 shadow-sm">
            <div className="flex items-center gap-4">
              <button
                type="button"
                onClick={() => navigate(`/workspaces/${workspaceId}`)}
                className="flex h-9 w-9 items-center justify-center rounded-lg border border-border/50 bg-surface text-muted transition hover:bg-panel hover:text-text"
                title="Back to Board"
              >
                &larr;
              </button>
              <div>
                <h4 className="text-2xl font-bold tracking-tight text-text">
                  {selectedTask?.taskName ?? 'Task Details'}
                </h4>
                <p className="text-xs font-medium text-muted uppercase tracking-wider">
                  Workspace &gt; {workspace?.workspaceName ?? 'Board'}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={onSaveTaskOverview}
                disabled={
                  !selectedTask ||
                  (selectedTask.description ?? '').trim() === taskOverviewDraft.trim()
                }
                className="ui-btn ui-btn-info h-10 px-6 text-sm font-bold shadow-sm shadow-info/10 disabled:opacity-40"
              >
                Save Changes
              </button>
              <button
                type="button"
                onClick={() => navigate(`/workspaces/${workspaceId}`)}
                className="flex h-10 w-10 items-center justify-center rounded-xl border border-border/50 bg-surface text-muted transition hover:bg-panel hover:text-text"
                title="Close"
              >
                ✕
              </button>
            </div>
          </div>

          {selectedTask ? (
            <div className="flex flex-1 min-h-0 overflow-hidden bg-base/50 flex-col lg:flex-row">
              {/* Responsive Tabs Navigation (Mobile/Tablet Only) */}
              <div className="lg:hidden sticky top-0 z-20 flex border-b border-border/50 bg-panel/90 backdrop-blur p-1">
                {[
                  { id: 'task', label: 'Details', icon: '📝' },
                  { id: 'chat', label: 'Chat', icon: '💬' },
                  { id: 'activity', label: 'Activities', icon: '📋' },
                ].map((tab) => (
                  <button
                    key={tab.id}
                    type="button"
                    onClick={() => setTaskDetailPanelTab(tab.id as TaskDetailPanelTab)}
                    className={`flex-1 flex items-center justify-center gap-2 py-3 text-[11px] font-bold uppercase tracking-wider transition-all rounded-xl ${
                      taskDetailPanelTab === tab.id
                        ? 'bg-info text-white shadow-lg shadow-info/20'
                        : 'text-muted hover:text-text hover:bg-surface/50'
                    }`}
                  >
                    <span>{tab.icon}</span> {tab.label}
                  </button>
                ))}
              </div>

              {/* Left Column: Task Details (Desktop) / Conditional (Mobile) */}
              <div
                className={`flex-1 overflow-y-auto border-r border-border/50 p-6 lg:p-8 custom-scrollbar ${
                  taskDetailPanelTab === 'task' ? 'block' : 'hidden lg:block'
                }`}
              >
                <div className="max-w-4xl mx-auto space-y-8">
                  {/* Overview Section */}
                  <section className="space-y-4">
                    <div className="flex items-center gap-2">
                      <div className="h-4 w-1 rounded-full bg-accent" />
                      <h5 className="text-sm font-bold uppercase tracking-wider text-text">
                        Overview
                      </h5>
                    </div>
                    <div className="rounded-2xl border border-border/50 bg-panel/40 p-1 shadow-sm transition-all hover:bg-panel/60">
                      <textarea
                        value={taskOverviewDraft}
                        onChange={(event) => setTaskOverviewDraft(event.target.value)}
                        rows={6}
                        className="w-full resize-none border-none bg-transparent px-5 py-4 text-base leading-relaxed text-text placeholder:text-muted/50 focus:outline-none"
                        placeholder="Add a detailed description or overview for this task..."
                      />
                    </div>
                  </section>

                  {/* Metadata Section */}
                  <section className="space-y-4">
                    <div className="flex items-center gap-2">
                      <div className="h-4 w-1 rounded-full bg-info" />
                      <h5 className="text-sm font-bold uppercase tracking-wider text-text">
                        Task Details
                      </h5>
                    </div>
                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
                      <div className="space-y-2 rounded-2xl border border-border/40 bg-panel/30 p-4">
                        <label
                          className="text-[11px] font-bold uppercase tracking-tight text-muted"
                          htmlFor="task-view-status"
                        >
                          Status
                        </label>
                        <select
                          id="task-view-status"
                          value={selectedTask.status}
                          onChange={(event) =>
                            onMoveTask(selectedTask, event.target.value as TaskStatus)
                          }
                          className="w-full rounded-xl border border-border/60 bg-surface px-3 py-2 text-sm font-semibold text-text focus:border-info/50 focus:outline-none"
                        >
                          {statusOrder.map((status) => (
                            <option key={status} value={status}>
                              {taskStatusLabelMap[status] ?? status}
                            </option>
                          ))}
                        </select>
                      </div>

                      <div className="space-y-2 rounded-2xl border border-border/40 bg-panel/30 p-4">
                        <label
                          className="text-[11px] font-bold uppercase tracking-tight text-muted"
                          htmlFor="task-view-priority"
                        >
                          Priority
                        </label>
                        <select
                          id="task-view-priority"
                          value={selectedTask.priority}
                          onChange={(event) =>
                            onUpdateTask(
                              selectedTask,
                              { priority: event.target.value as TaskRecord['priority'] },
                              `Priority set to ${event.target.value}.`,
                            )
                          }
                          className="w-full rounded-xl border border-border/60 bg-surface px-3 py-2 text-sm font-semibold text-text focus:border-info/50 focus:outline-none"
                        >
                          <option value="Low">Low</option>
                          <option value="Medium">Medium</option>
                          <option value="High">High</option>
                          <option value="Urgent">Urgent</option>
                        </select>
                      </div>

                      <div className="space-y-2 rounded-2xl border border-border/40 bg-panel/30 p-4">
                        <label
                          className="text-[11px] font-bold uppercase tracking-tight text-muted"
                          htmlFor="task-view-assignee"
                        >
                          Assigned To
                        </label>
                        <select
                          id="task-view-assignee"
                          value={selectedTask.assignedTo}
                          onChange={(event) => {
                            const nextAssignee = event.target.value
                            if (nextAssignee === selectedTask.assignedTo) return
                            onUpdateTask(
                              selectedTask,
                              { assignedTo: nextAssignee },
                              `Assignee set to ${resolveUserName(nextAssignee)}.`,
                            )
                          }}
                          className="w-full rounded-xl border border-border/60 bg-surface px-3 py-2 text-sm font-semibold text-text focus:border-info/50 focus:outline-none"
                        >
                          {!boardMembers.some((user) => user.id === selectedTask.assignedTo) ? (
                            <option value={selectedTask.assignedTo}>
                              {resolveUserName(selectedTask.assignedTo)}
                            </option>
                          ) : null}
                          {boardMembers.map((user) => (
                            <option key={user.id} value={user.id}>
                              {user.name} – {user.role}
                            </option>
                          ))}
                        </select>
                      </div>

                      <div className="space-y-2 rounded-2xl border border-border/40 bg-panel/30 p-4">
                        <label className="text-[11px] font-bold uppercase tracking-tight text-muted">
                          Due Date
                        </label>
                        <div className="flex h-[38px] items-center rounded-xl border border-border/60 bg-surface px-3 text-sm font-semibold text-text">
                          📅 {fmtDateIST(selectedTask.dueDate)}
                        </div>
                      </div>
                    </div>
                  </section>

                  {/* Attachments Section */}
                  <section className="space-y-4">
                    <div className="flex items-center gap-2">
                      <div className="h-4 w-1 rounded-full bg-warning" />
                      <h5 className="text-sm font-bold uppercase tracking-wider text-text">
                        Attachments
                      </h5>
                    </div>
                    {selectedTask.attachments && selectedTask.attachments.length > 0 ? (
                      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
                        {/* Render attachments logic here */}
                        <p className="col-span-full text-xs text-muted">
                          {selectedTask.attachments.length} files attached.
                        </p>
                      </div>
                    ) : (
                      <div className="flex flex-col items-center justify-center rounded-3xl border-2 border-dashed border-border/50 bg-panel/20 py-12 text-center transition-colors hover:bg-panel/40">
                        <div className="mb-3 text-4xl opacity-20">📁</div>
                        <p className="text-base font-bold text-text">No attachments yet</p>
                        <p className="mt-1 text-sm text-muted">
                          Drag files here or upload from your computer
                        </p>
                        <button
                          type="button"
                          className="mt-6 rounded-xl bg-info/10 px-5 py-2 text-sm font-bold text-info transition hover:bg-info/20"
                        >
                          + Upload Files
                        </button>
                      </div>
                    )}
                  </section>
                </div>
              </div>

              {/* Right Column: Collaboration (Desktop) / Conditional (Mobile) */}
              <div
                className={`w-full lg:w-[450px] shrink-0 flex flex-col min-h-0 bg-panel/30 border-l border-border/50 ${
                  taskDetailPanelTab !== 'task' ? 'flex' : 'hidden lg:flex'
                }`}
              >
                {/* Desktop Tabs Header (Hidden on Mobile) */}
                <div className="hidden lg:flex border-b border-border/50 bg-panel/50 p-1">
                  <button
                    type="button"
                    onClick={() => setTaskDetailPanelTab('chat')}
                    className={`flex-1 flex items-center justify-center gap-2 py-3 text-xs font-bold uppercase tracking-wider transition-all rounded-xl ${
                      taskDetailPanelTab === 'chat'
                        ? 'bg-info text-white shadow-lg shadow-info/20'
                        : 'text-muted hover:text-text hover:bg-surface/50'
                    }`}
                  >
                    <span>💬</span> Task Chat
                    <span
                      className={`ml-1 rounded-full px-2 py-0.5 text-[10px] ${
                        taskDetailPanelTab === 'chat'
                          ? 'bg-white/20 text-white'
                          : 'bg-info/10 text-info'
                      }`}
                    >
                      {selectedTaskMessages.length}
                    </span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setTaskDetailPanelTab('activity')}
                    className={`flex-1 flex items-center justify-center gap-2 py-3 text-xs font-bold uppercase tracking-wider transition-all rounded-xl ${
                      taskDetailPanelTab === 'activity'
                        ? 'bg-info text-white shadow-lg shadow-info/20'
                        : 'text-muted hover:text-text hover:bg-surface/50'
                    }`}
                  >
                    <span>📋</span> Task Activities
                    <span
                      className={`ml-1 rounded-full px-2 py-0.5 text-[10px] ${
                        taskDetailPanelTab === 'activity'
                          ? 'bg-white/20 text-white'
                          : 'bg-muted/20 text-muted'
                      }`}
                    >
                      {selectedTaskActivities.length}
                    </span>
                  </button>
                </div>

                <div className="flex-1 flex flex-col min-h-0">
                  {taskDetailPanelTab === 'chat' ? (
                    <section className="flex flex-col flex-1 min-h-0">
                      {/* Chat Filters */}
                      <div className="flex items-center gap-1 px-4 py-3 border-b border-border/40 bg-panel/20 overflow-x-auto custom-scrollbar">
                        {[
                          { id: 'all', label: 'All' },
                          { id: 'images', label: 'Images' },
                          { id: 'files', label: 'Files' },
                          { id: 'polls', label: 'Polls' },
                          { id: 'links', label: 'Links' },
                        ].map((filter) => (
                          <button
                            key={filter.id}
                            type="button"
                            onClick={() => setTaskChatFilter(filter.id as TaskChatFilter)}
                            className={`shrink-0 rounded-lg px-2.5 py-1.5 text-[10px] font-bold transition-all ${
                              taskChatFilter === filter.id
                                ? 'bg-info/20 text-info ring-1 ring-info/30'
                                : 'text-muted hover:text-text hover:bg-surface/50'
                            }`}
                          >
                            {filter.label}
                          </button>
                        ))}
                      </div>

                      <div className="flex-1 min-h-0 p-4">
                        <TaskChatPanel
                          messages={selectedTaskChatMessages}
                          typing={taskChat.typing}
                          readReceipts={taskChat.readReceipts}
                          currentUserId={session.user.id}
                          resolveUserName={resolveUserName}
                          draft={taskChat.draft}
                          onDraftChange={taskChat.setDraft}
                          onSend={(event) => {
                            event.preventDefault()
                            void taskChat.sendMessage()
                          }}
                          onSendImage={(file) => {
                            void taskChat.sendImageMessage(file)
                          }}
                          onSendFile={(file) => {
                            void taskChat.sendFileMessage(file)
                          }}
                          onCreatePoll={(question, options) => {
                            void taskChat.createPollMessage(question, options)
                          }}
                          onVotePoll={(pollId, optionId) => {
                            void taskChat.votePollOption(pollId, optionId)
                          }}
                          onDeleteMessage={(message) => {
                            void taskChat.deleteMessage(message)
                          }}
                          isSending={taskChat.isSending}
                          deletingMessageId={taskChat.deletingMessageId}
                          sendError={taskChat.sendError}
                          placeholder="Write a task message..."
                          emptyMessage={
                            taskChatFilter === 'all'
                              ? 'No messages yet. Start a discussion for this task.'
                              : `No ${taskChatFilter} found in this task.`
                          }
                          disabled={!selectedTask}
                        />
                      </div>
                    </section>
                  ) : taskDetailPanelTab === 'activity' ? (
                    <section className="flex flex-col flex-1 min-h-0">
                      <div className="flex-1 min-h-0 overflow-y-auto p-6 space-y-6 custom-scrollbar">
                        {selectedTaskActivities.length > 0 ? (
                          <div className="relative space-y-8 before:absolute before:inset-y-0 before:left-2.5 before:w-px before:bg-border/60">
                            {selectedTaskActivities.map((entry) => (
                              <div key={entry.id} className="relative pl-9 group">
                                <div className="absolute left-0 top-1.5 h-5 w-5 rounded-full border-2 border-base bg-info shadow-sm shadow-info/20 z-10 transition-transform group-hover:scale-110" />

                                <div className="flex flex-col gap-1">
                                  <div className="flex items-center gap-2">
                                    <span className="text-xs font-bold text-text group-hover:text-info transition-colors">
                                      {resolveUserName(entry.userId)}
                                    </span>
                                    <span className="text-[10px] font-semibold text-muted bg-surface px-2 py-0.5 rounded-full ring-1 ring-border/30">
                                      {fmtDateTimeFullIST(entry.createdAt)}
                                    </span>
                                  </div>
                                  <div className="rounded-xl border border-border/40 bg-panel/40 p-3 shadow-sm group-hover:bg-panel/60 transition-colors">
                                    <p className="text-xs leading-relaxed text-muted font-medium">
                                      {entry.message}
                                    </p>
                                  </div>
                                </div>
                              </div>
                            ))}
                          </div>
                        ) : (
                          <div className="flex flex-col items-center justify-center py-20 text-center opacity-50">
                            <div className="mb-4 text-5xl">📋</div>
                            <h4 className="text-sm font-bold text-text">
                              No activity recorded yet
                            </h4>
                            <p className="mt-1 text-xs text-muted">
                              Updates to this task will appear here.
                            </p>
                          </div>
                        )}
                      </div>
                    </section>
                  ) : null}
                </div>
              </div>
            </div>
          ) : (
            <div className="flex flex-1 items-center justify-center bg-base/50">
              <div className="text-center">
                <div className="mb-4 text-5xl">🔍</div>
                <h4 className="text-xl font-bold text-text">Task no longer exists</h4>
                <p className="mt-2 text-sm text-muted">
                  This task might have been deleted or moved.
                </p>
                <button
                  type="button"
                  onClick={() => navigate(`/workspaces/${workspaceId}`)}
                  className="mt-6 ui-btn ui-btn-primary px-8"
                >
                  Return to Board
                </button>
              </div>
            </div>
          )}
        </div>
      ) : null}
    </ModulePageLayout>
  )
}

export default WorkspacesModule
