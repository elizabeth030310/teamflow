
import { useCallback, useEffect, useRef, useState } from 'react'
import type { DragEvent } from 'react'
import AdSidebar from './AdSidebar'
import type { AdSidebarProps } from './AdSidebar'
import { InvitationInbox, ProjectCollaboration } from './Collaboration'
import type { Member } from './Collaboration'
import { getProjectStreamLimit, loadProjectTasks, startProjectTaskSync } from './projectTaskSync'
import type { Task } from './projectTaskSync'
import ProjectActivities from './ProjectActivities'
import TaskComments from './TaskComments'
import type { CommentFocusTarget } from './taskCommentThreads'
import TaskChecklist from './TaskChecklist'
import TaskAttachments from './TaskAttachments'
import TaskCalendar from './TaskCalendar'
import ProjectStats from './ProjectStats'
import ProjectPages from './ProjectPages'
import NotificationCenter from './NotificationCenter'
import ScrollRegion from './ScrollRegion'
import type { NotificationItem } from './notificationSync'
import { columns, getPriority, priorities } from './projectTaskStats'
import { createSearchMatcher } from './search'
import { dueDateAlerts, getDueDateAlert, getLocalCalendarDay, showDatePicker } from './taskDates'
import { dashboardHref, myTasksHref, projectHref, projectTabHref, projectTabs, readWorkspaceRoute } from './workspaceRoute'
import './TeamFlow.css'

const compactWorkspaceQuery = '(max-width: 760px)'
const workspaceAds: AdSidebarProps = { enabled: false, ad: null }

type Project = {
  id: number
  name: string
  description: string
}

const statusLabels = new Map(columns.map(({ status, label }) => [status, label]))

function App({ userId, onSessionExpired }: {
  userId: number
  onSessionExpired: () => void
}) {
  const [projects, setProjects] = useState<Project[]>([])
  const [workspaceHash, setWorkspaceHash] = useState(() => window.location.hash)
  const [compactWorkspace, setCompactWorkspace] = useState(() => window.matchMedia(compactWorkspaceQuery).matches)
  const [desktopSidebarOpen, setDesktopSidebarOpen] = useState(true)
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false)
  const sidebarOpen = compactWorkspace ? mobileSidebarOpen : desktopSidebarOpen
  const sidebarToggle = useRef<HTMLButtonElement>(null)
  const workspaceContent = useRef<HTMLElement>(null)
  const [pageWorkspace, setPageWorkspace] = useState<HTMLDivElement | null>(null)
  const [openDocumentProjects, setOpenDocumentProjects] = useState(new Map<number, boolean>())
  const favoriteStorageKey = `teamflow:project-favorites:${userId}`
  const [favoriteProjectIds, setFavoriteProjectIds] = useState(() => readFavoriteProjects(favoriteStorageKey))
  const route = readWorkspaceRoute(workspaceHash)
  const isDashboard = route.page === 'dashboard'
  const isMyTasks = route.page === 'my-tasks'
  const projectTab = route.page === 'project' ? route.tab : null
  const selectedProject = projects.find(({ id }) => id === route.projectId)
  const liveTasks = useRef(new Map<number, ReturnType<typeof startProjectTaskSync>>())
  const [syncErrors, setSyncErrors] = useState(new Set<number>())
  const [memberRefreshes, setMemberRefreshes] = useState(new Map<number, number>())
  const [activityRefreshes, setActivityRefreshes] = useState(new Map<number, number>())
  const [openComments, setOpenComments] = useState<{
    taskId: number
    revision: number
    focusTarget?: CommentFocusTarget
  } | null>(null)
  const [openChecklist, setOpenChecklist] = useState<{ taskId: number; revision: number } | null>(null)
  const [openAttachments, setOpenAttachments] = useState<{ taskId: number; revision: number } | null>(null)
  const [projectSearch, setProjectSearch] = useState('')
  const [tasks, setTasks] = useState<Task[]>([])
  const [taskSearch, setTaskSearch] = useState('')
  const [taskStatusFilter, setTaskStatusFilter] = useState('ALL')
  const [taskPriorityFilter, setTaskPriorityFilter] = useState('ALL')
  const [assigneeFilters, setAssigneeFilters] = useState(new Map<number, string>())
  const pendingAssignments = useRef(new Set<number>())
  const [assignmentStatus, setAssignmentStatus] = useState(new Map<number, string | null>())

  // 프로젝트 생성
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [creatingProject, setCreatingProject] = useState(false)
  const [projectFormError, setProjectFormError] = useState('')

  // 프로젝트 수정
  const [editingId, setEditingId] = useState<number | null>(null)
  const [editName, setEditName] = useState('')
  const [editDescription, setEditDescription] = useState('')

  // 작업 생성
  const [taskProjectId, setTaskProjectId] = useState<number | null>(null)
  const [taskTitle, setTaskTitle] = useState('')
  const [taskDescription, setTaskDescription] = useState('')
  const [taskStatus, setTaskStatus] = useState('TODO')
  const [taskPriority, setTaskPriority] = useState('MEDIUM')
  const [taskDueDate, setTaskDueDate] = useState('')
  const taskDueDateInput = useRef<HTMLInputElement>(null)
  const addTaskTrigger = useRef<HTMLButtonElement | null>(null)

  // 작업 수정
  const [editingTaskId, setEditingTaskId] = useState<number | null>(null)
  const [editTaskTitle, setEditTaskTitle] = useState('')
  const [editTaskDescription, setEditTaskDescription] = useState('')
  const [editTaskPriority, setEditTaskPriority] = useState('MEDIUM')
  const [editTaskDueDate, setEditTaskDueDate] = useState('')

  // API 처리 상태
  const [updatingTaskId, setUpdatingTaskId] = useState<number | null>(null)
  const [deletingTaskId, setDeletingTaskId] = useState<number | null>(null)
  const [savingTaskId, setSavingTaskId] = useState<number | null>(null)
  const [creatingTask, setCreatingTask] = useState(false)

  // 드래그 앤 드롭
  const [draggingTaskId, setDraggingTaskId] = useState<number | null>(null)
  const [dragOverColumn, setDragOverColumn] = useState<string | null>(null)

  const [error, setError] = useState('')
  const [dashboardStatus, setDashboardStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [workspaceAttempt, setWorkspaceAttempt] = useState(0)
  const [today, setToday] = useState(() => getLocalCalendarDay(new Date()))

  useEffect(() => {
    const updateRoute = () => {
      setWorkspaceHash(window.location.hash)
      setMobileSidebarOpen(false)
    }
    window.addEventListener('hashchange', updateRoute)
    return () => window.removeEventListener('hashchange', updateRoute)
  }, [])

  useEffect(() => {
    const media = window.matchMedia(compactWorkspaceQuery)
    const updateLayout = () => {
      setCompactWorkspace(media.matches)
      setMobileSidebarOpen(false)
    }
    media.addEventListener('change', updateLayout)
    return () => media.removeEventListener('change', updateLayout)
  }, [])

  useEffect(() => {
    try {
      window.localStorage.setItem(favoriteStorageKey, JSON.stringify([...favoriteProjectIds]))
    } catch {
      return
    }
  }, [favoriteProjectIds, favoriteStorageKey])

  const routedTask = tasks.find((task) => task.id === route.taskId && task.projectId === route.projectId)
  const visibleRoutedTaskId = selectedProject ? routedTask?.id : undefined

  useEffect(() => {
    if (visibleRoutedTaskId !== undefined) focusTask(visibleRoutedTaskId)
    else window.scrollTo(0, 0)
  }, [route.page, route.projectId, route.taskId, visibleRoutedTaskId])

  const openNotificationTask = async (item: NotificationItem) => {
    const response = await fetch(`/api/projects/${item.projectId}`, {
      credentials: 'include',
      cache: 'no-store',
      signal: AbortSignal.timeout(15_000),
    })
    if (response.status === 401) onSessionExpired()
    if (!response.ok) throw new Error('프로젝트를 열 수 없습니다.')

    const project: Project = await response.json()
    const projectTasks = await loadProjectTasks(project.id)
    if (!projectTasks.some((task) => task.id === item.taskId)) throw new Error('작업을 찾을 수 없습니다.')

    setProjects((previous) => previous.some(({ id }) => id === project.id) ? previous : [...previous, project])
    setTasks((previous) => [...previous.filter((task) => task.projectId !== project.id), ...projectTasks])
    setProjectSearch('')
    setTaskSearch('')
    setTaskStatusFilter('ALL')
    setTaskPriorityFilter('ALL')
    setAssigneeFilters((previous) => {
      const filters = new Map(previous)
      filters.delete(project.id)
      return filters
    })
    if (item.kind === 'COMMENT' || item.kind === 'COMMENT_REPLY') {
      setOpenComments({
        taskId: item.taskId,
        revision: 0,
        focusTarget: item.kind === 'COMMENT_REPLY' && item.parentCommentId != null
          ? { parentCommentId: item.parentCommentId, replyCommentId: item.replyCommentId ?? null }
          : undefined,
      })
    }
    const href = projectHref(project.id, item.taskId)
    if (window.location.hash === href) focusTask(item.taskId)
    else window.location.hash = href
  }

  useEffect(() => {
    let timer: number

    const updateToday = () => {
      window.clearTimeout(timer)
      const now = new Date()
      setToday(getLocalCalendarDay(now))
      const nextMidnight = new Date(now)
      nextMidnight.setHours(24, 0, 0, 0)
      timer = window.setTimeout(updateToday, nextMidnight.getTime() - now.getTime())
    }

    updateToday()
    window.addEventListener('focus', updateToday)
    return () => {
      window.clearTimeout(timer)
      window.removeEventListener('focus', updateToday)
    }
  }, [])

  // 최초 데이터 조회
  useEffect(() => {
    const controller = new AbortController()
    const { signal } = controller

    const loadData = async () => {
      try {
        const projectResponse = await fetch('/api/projects', { credentials: 'include', signal })

        if (signal.aborted) return
        if (projectResponse.status === 401) {
          onSessionExpired()
          return
        }

        if (!projectResponse.ok) {
          throw new Error('프로젝트 조회 실패')
        }

        const projectData: Project[] = await projectResponse.json()
        if (signal.aborted) return
        const taskLists = await Promise.allSettled(
          projectData.map((project) => loadProjectTasks(project.id, signal))
        )

        if (signal.aborted) return
        const initialErrors = new Set<number>()
        const initialTasks = taskLists.flatMap((result, index) => {
          if (result.status === 'fulfilled') return result.value
          initialErrors.add(projectData[index].id)
          return []
        })
        setProjects(projectData)
        setTasks(initialTasks)
        setSyncErrors(initialErrors)
        setDashboardStatus('ready')
      } catch (err) {
        if (signal.aborted) return
        console.error(err)
        setDashboardStatus('error')
      }
    }

    loadData()
    return () => controller.abort()
  }, [onSessionExpired, workspaceAttempt])

  const removeProject = useCallback((projectId: number) => {
    liveTasks.current.get(projectId)?.close()
    liveTasks.current.delete(projectId)
    setProjects((previous) => previous.filter((project) => project.id !== projectId))
    setTasks((previous) => previous.filter((task) => task.projectId !== projectId))
    setActivityRefreshes((previous) => {
      if (!previous.has(projectId)) return previous
      const updated = new Map(previous)
      updated.delete(projectId)
      return updated
    })
    setAssigneeFilters((previous) => {
      const updated = new Map(previous)
      updated.delete(projectId)
      return updated
    })
  }, [])

  useEffect(() => {
    const subscriptions = liveTasks.current
    return () => {
      subscriptions.forEach((subscription) => subscription.close())
      subscriptions.clear()
    }
  }, [])

  const liveTasksReady = dashboardStatus === 'ready'

  useEffect(() => {
    if (!liveTasksReady) return

    const subscriptions = liveTasks.current
    const projectIds = projects.map(({ id }) => id).sort((first, second) => first - second)
    const activeIds = new Set(projectIds)
    const streamLimit = getProjectStreamLimit()

    for (const [projectId, subscription] of subscriptions) {
      if (activeIds.has(projectId)) continue
      subscription.close()
      subscriptions.delete(projectId)
    }

    projectIds.forEach((projectId, index) => {
      const streaming = index < streamLimit
      const existing = subscriptions.get(projectId)
      if (existing?.streaming === streaming) return
      existing?.close()

      subscriptions.set(projectId, startProjectTaskSync(projectId, streaming, {
        onTasks: (projectTasks) => {
          setTasks((previous) => [
            ...previous.filter((task) => task.projectId !== projectId),
            ...projectTasks,
          ])
        },
        onOpen: () => {
          setMemberRefreshes((previous) =>
            new Map(previous).set(projectId, (previous.get(projectId) ?? 0) + 1))
        },
        onCommentChange: (taskId) => {
          setOpenComments((previous) => previous?.taskId === taskId
            ? { ...previous, revision: previous.revision + 1 }
            : previous)
        },
        onChecklistChange: (taskId) => {
          setOpenChecklist((previous) => previous?.taskId === taskId
            ? { taskId, revision: previous.revision + 1 }
            : previous)
        },
        onAttachmentChange: (taskId) => {
          setOpenAttachments((previous) => previous?.taskId === taskId
            ? { taskId, revision: previous.revision + 1 }
            : previous)
        },
        onActivityRefresh: () => {
          setActivityRefreshes((previous) =>
            new Map(previous).set(projectId, (previous.get(projectId) ?? 0) + 1))
        },
        onError: (failed) => {
          setSyncErrors((previous) => {
            if (previous.has(projectId) === failed) return previous
            const updated = new Set(previous)
            if (failed) updated.add(projectId)
            else updated.delete(projectId)
            return updated
          })
        },
        onAccessError: (status) => {
          if (status === 401) {
            onSessionExpired()
          } else {
            removeProject(projectId)
            setError('접근할 수 없는 프로젝트를 목록에서 제거했습니다.')
          }
        },
      }))
    })
  }, [liveTasksReady, projects, onSessionExpired, removeProject])

  const updateTasksAfterMutation = (projectId: number, update: (previous: Task[]) => Task[]) => {
    const subscription = liveTasks.current.get(projectId)
    if (!subscription) return
    subscription.invalidate()
    setTasks(update)
  }

  const handleUpdateAssignee = async (task: Task, assigneeId: number | null) => {
    if ((task.assigneeId ?? null) === assigneeId || pendingAssignments.current.has(task.id)) return
    if (updatingTaskId === task.id || deletingTaskId === task.id || savingTaskId === task.id) return

    pendingAssignments.current.add(task.id)
    setAssignmentStatus((previous) => new Map(previous).set(task.id, null))
    let failure = ''

    try {
      const response = await fetch(`/api/tasks/${task.id}/assignee`, {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ assigneeId }),
      })
      if (!response.ok) {
        if (response.status === 401) {
          failure = '로그인 세션이 만료되었습니다. 다시 로그인해 주세요.'
        } else if (response.status === 403) {
          failure = '담당자를 변경할 권한이 없습니다.'
        } else if (response.status === 400) {
          failure = '선택한 사용자를 배정할 수 없습니다. 멤버 목록을 새로고침해 주세요.'
        }
        throw new Error('담당자 변경 실패')
      }

      const updatedTask: Task = await response.json()
      updateTasksAfterMutation(task.projectId, (previous) =>
        previous.map((item) => item.id === task.id
          ? { ...item, assigneeId: updatedTask.assigneeId }
          : item)
      )
    } catch {
      failure ||= '담당자를 저장하지 못했습니다. 멤버 목록을 확인하고 다시 시도해 주세요.'
    } finally {
      pendingAssignments.current.delete(task.id)
      setAssignmentStatus((previous) => {
        const next = new Map(previous)
        if (failure) next.set(task.id, failure)
        else next.delete(task.id)
        return next
      })
    }
  }

  const handleAcceptInvitation = async (projectId: number) => {
    if (projects.some((project) => project.id === projectId)) return

    const response = await fetch('/api/projects', { credentials: 'include' })
    if (!response.ok) throw new Error('공유 프로젝트 조회 실패')

    const availableProjects: Project[] = await response.json()
    const acceptedProject = availableProjects.find((project) => project.id === projectId)
    if (!acceptedProject) throw new Error('공유 프로젝트를 찾을 수 없습니다.')

    const acceptedTasks = await loadProjectTasks(projectId)
    setProjects((previous) => previous.some((project) => project.id === projectId)
      ? previous
      : [...previous, acceptedProject])
    setTasks((previous) => [...previous.filter((task) => task.projectId !== projectId), ...acceptedTasks])
  }

  // 프로젝트 생성
  const handleCreateProject = async () => {
    if (creatingProject || dashboardStatus === 'loading') return
    if (!name.trim()) {
      setProjectFormError('프로젝트 이름을 입력해 주세요.')
      return
    }

    setCreatingProject(true)
    setProjectFormError('')
    try {
      const response = await fetch('/api/projects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(),
          description: description.trim(),
        }),
      })

      if (!response.ok) {
        throw new Error('프로젝트 생성 실패')
      }

      const newProject: Project = await response.json()

      setProjects((prev) => [...prev, newProject])
      if (readWorkspaceRoute(window.location.hash).page === 'dashboard') {
        window.location.hash = projectHref(newProject.id)
      }
      setName('')
      setDescription('')
    } catch (err) {
      console.error(err)
      setProjectFormError('프로젝트를 만들지 못했습니다. 다시 시도해 주세요.')
    } finally {
      setCreatingProject(false)
    }
  }

  // 프로젝트 수정 시작
  const handleStartEdit = (project: Project) => {
    setEditingId(project.id)
    setEditName(project.name)
    setEditDescription(project.description ?? '')
    setError('')
  }

  // 프로젝트 수정 취소
  const handleCancelEdit = () => {
    setEditingId(null)
    setEditName('')
    setEditDescription('')
  }

  // 프로젝트 수정 저장
  const handleUpdateProject = async (id: number) => {
    if (!editName.trim()) {
      alert('프로젝트 이름을 입력해 주세요.')
      return
    }

    try {
      setError('')

      const response = await fetch(`/api/projects/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: editName.trim(),
          description: editDescription.trim(),
        }),
      })

      if (!response.ok) {
        throw new Error('프로젝트 수정 실패')
      }

      const updatedProject: Project = await response.json()

      setProjects((prev) =>
        prev.map((project) =>
          project.id === id ? updatedProject : project
        )
      )

      handleCancelEdit()
    } catch (err) {
      console.error(err)
      setError('프로젝트 수정에 실패했습니다.')
    }
  }

  // 프로젝트 삭제
  const handleDeleteProject = async (id: number) => {
    const confirmed = window.confirm(
      '정말 이 프로젝트를 삭제하시겠습니까?'
    )

    if (!confirmed) return

    try {
      setError('')

      const response = await fetch(`/api/projects/${id}`, {
        method: 'DELETE',
      })

      if (!response.ok) {
        throw new Error('프로젝트 삭제 실패')
      }

      removeProject(id)

      if (taskProjectId === id) {
        handleCancelTask()
      }

      if (editingId === id) {
        handleCancelEdit()
      }

      if (
        tasks.some(
          (task) =>
            task.projectId === id &&
            task.id === editingTaskId
        )
      ) {
        handleCancelEditTask()
      }
    } catch (err) {
      console.error(err)
      setError('프로젝트 삭제에 실패했습니다.')
    }
  }

  // 작업 생성 입력창 열기
  const handleStartTask = (
    projectId: number,
    status = 'TODO'
  ) => {
    setTaskProjectId(projectId)
    setTaskTitle('')
    setTaskDescription('')
    setTaskStatus(status)
    setTaskPriority('MEDIUM')
    setTaskDueDate('')
    setError('')
  }

  // 작업 생성 취소
  const handleCancelTask = () => {
    setTaskProjectId(null)
    setTaskTitle('')
    setTaskDescription('')
    setTaskStatus('TODO')
    setTaskPriority('MEDIUM')
    setTaskDueDate('')
  }

  // 작업 생성
  const handleCreateTask = async (projectId: number) => {
    if (!taskTitle.trim()) {
      alert('작업 제목을 입력해 주세요.')
      return
    }

    try {
      setError('')
      setCreatingTask(true)

      const response = await fetch('/api/tasks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectId,
          title: taskTitle.trim(),
          description: taskDescription.trim(),
          status: taskStatus,
          priority: taskPriority,
          dueDate: taskDueDate || null,
        }),
      })

      if (!response.ok) {
        throw new Error('작업 카드 생성 실패')
      }

      const newTask: Task = await response.json()

      updateTasksAfterMutation(newTask.projectId, (prev) => [
        ...prev.filter((task) => task.id !== newTask.id),
        newTask,
      ])
      handleCancelTask()
    } catch (err) {
      console.error(err)
      setError('작업 카드 생성에 실패했습니다.')
    } finally {
      setCreatingTask(false)
    }
  }

  // 작업 수정 시작
  const handleStartEditTask = (task: Task) => {
    setEditingTaskId(task.id)
    setEditTaskTitle(task.title)
    setEditTaskDescription(task.description ?? '')
    setEditTaskPriority(task.priority || 'MEDIUM')
    setEditTaskDueDate(task.dueDate || '')
    setError('')
  }

  // 작업 수정 취소
  const handleCancelEditTask = () => {
    setEditingTaskId(null)
    setEditTaskTitle('')
    setEditTaskDescription('')
    setEditTaskPriority('MEDIUM')
    setEditTaskDueDate('')
  }

  // 작업 수정 저장
  // 마감일을 비우면 null을 전달하여 기존 마감일 삭제
  const handleUpdateTask = async (taskId: number) => {
    if (!editTaskTitle.trim()) {
      alert('작업 제목을 입력해 주세요.')
      return
    }

    try {
      setError('')
      setSavingTaskId(taskId)

      const response = await fetch(`/api/tasks/${taskId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: editTaskTitle.trim(),
          description: editTaskDescription.trim(),
          priority: editTaskPriority,
          dueDate: editTaskDueDate || null,
        }),
      })

      if (!response.ok) {
        throw new Error('작업 카드 수정 실패')
      }

      const updatedTask: Task = await response.json()

      updateTasksAfterMutation(updatedTask.projectId, (prev) =>
        prev.map((task) =>
          task.id === taskId ? { ...task, ...updatedTask } : task
        )
      )

      handleCancelEditTask()
    } catch (err) {
      console.error(err)
      setError('작업 카드 수정에 실패했습니다.')
    } finally {
      setSavingTaskId(null)
    }
  }

  // 작업 상태 변경
  const handleUpdateTaskStatus = async (
    taskId: number,
    newStatus: string
  ) => {
    const currentTask = tasks.find(
      (task) => task.id === taskId
    )

    if (!currentTask) return
    if (pendingAssignments.current.has(taskId)) return
    if (currentTask.status === newStatus) return
    if (updatingTaskId !== null) return

    try {
      setError('')
      setUpdatingTaskId(taskId)

      const response = await fetch(
        `/api/tasks/${taskId}/status`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ status: newStatus }),
        }
      )

      if (!response.ok) {
        throw new Error('작업 상태 변경 실패')
      }

      const updatedTask: Task = await response.json()

      updateTasksAfterMutation(updatedTask.projectId, (prev) =>
        prev.map((task) =>
          task.id === taskId ? { ...task, ...updatedTask } : task
        )
      )
    } catch (err) {
      console.error(err)
      setError('작업 상태 변경에 실패했습니다.')
    } finally {
      setUpdatingTaskId(null)
    }
  }

  // 작업 삭제
  const handleDeleteTask = async (taskId: number) => {
    if (pendingAssignments.current.has(taskId)) return
    const projectId = tasks.find((task) => task.id === taskId)?.projectId
    if (projectId === undefined) return

    const confirmed = window.confirm(
      '정말 이 작업 카드를 삭제하시겠습니까?'
    )

    if (!confirmed) return

    try {
      setError('')
      setDeletingTaskId(taskId)

      const response = await fetch(`/api/tasks/${taskId}`, {
        method: 'DELETE',
      })

      if (!response.ok) {
        throw new Error('작업 카드 삭제 실패')
      }

      updateTasksAfterMutation(projectId, (prev) =>
        prev.filter((task) => task.id !== taskId)
      )

      if (editingTaskId === taskId) {
        handleCancelEditTask()
      }
    } catch (err) {
      console.error(err)
      setError('작업 카드 삭제에 실패했습니다.')
    } finally {
      setDeletingTaskId(null)
    }
  }

  // 드래그 시작
  const handleDragStart = (
    event: DragEvent<HTMLDivElement>,
    taskId: number
  ) => {
    if (
      updatingTaskId !== null ||
      pendingAssignments.current.has(taskId) ||
      deletingTaskId === taskId ||
      savingTaskId === taskId
    ) {
      event.preventDefault()
      return
    }

    setDraggingTaskId(taskId)
    event.dataTransfer.effectAllowed = 'move'
    event.dataTransfer.setData('text/plain', String(taskId))
  }

  // 드래그 중
  const handleDragOver = (
    event: DragEvent<HTMLDivElement>,
    projectId: number,
    status: string
  ) => {
    const draggingTask = tasks.find(
      (task) => task.id === draggingTaskId
    )

    if (
      !draggingTask ||
      draggingTask.projectId !== projectId
    ) {
      return
    }

    event.preventDefault()
    event.dataTransfer.dropEffect = 'move'

    const columnKey = `${projectId}-${status}`

    if (dragOverColumn !== columnKey) {
      setDragOverColumn(columnKey)
    }
  }

  // 카드를 다른 열에 놓기
  const handleDrop = async (
    event: DragEvent<HTMLDivElement>,
    projectId: number,
    status: string
  ) => {
    event.preventDefault()

    const transferredId = Number(
      event.dataTransfer.getData('text/plain')
    )

    const taskId = draggingTaskId ?? transferredId

    const draggedTask = tasks.find(
      (task) => task.id === taskId
    )

    setDraggingTaskId(null)
    setDragOverColumn(null)

    if (!draggedTask) return
    if (draggedTask.projectId !== projectId) return
    if (draggedTask.status === status) return

    await handleUpdateTaskStatus(taskId, status)
  }

  // 드래그 종료
  const handleDragEnd = () => {
    setDraggingTaskId(null)
    setDragOverColumn(null)
  }

  // 우선순위 배지
  const renderPriorityBadge = (priority: string | null) => {
    const item = getPriority(priority)

    return (
      <span
        className="tf-badge"
        style={{
          backgroundColor: item.background,
          color: item.color,
        }}
      >
        {item.label}
      </span>
    )
  }

  // 작업 카드 UI
  const renderTaskCard = (task: Task, members: Member[], memberStatus: 'loading' | 'ready' | 'error') => {
    const currentColumn = columns.find(
      (column) => column.status === task.status
    )

    const isDragging = draggingTaskId === task.id
    const isEditing = editingTaskId === task.id
    const commentPanel = openComments?.taskId === task.id ? openComments : null
    const checklistPanel = openChecklist?.taskId === task.id ? openChecklist : null
    const attachmentPanel = openAttachments?.taskId === task.id ? openAttachments : null
    const checklistTotal = task.checklistTotal ?? 0
    const checklistCompleted = task.checklistCompleted ?? 0
    const checklistPercent = checklistTotal ? Math.round(checklistCompleted * 100 / checklistTotal) : 0
    const dueDateAlert = alertsByTaskId.get(task.id)
    const dueDateBadge = dueDateAlert ? dueDateAlerts[dueDateAlert] : null
    const assignee = members.find((member) => member.userId === task.assigneeId)
    const assigneeValue = task.assigneeId == null ? '' : String(task.assigneeId)
    const assignment = assignmentStatus.get(task.id)
    const assigning = assignment === null

    return (
      <div
        key={task.id}
        id={`task-${task.id}`}
        tabIndex={-1}
        className="tf-task-card"
        data-dragging={isDragging}
        draggable={
          !isEditing &&
          !commentPanel &&
          !attachmentPanel &&
          !assigning &&
          updatingTaskId === null &&
          deletingTaskId !== task.id &&
          savingTaskId !== task.id
        }
        onDragStart={(event) =>
          handleDragStart(event, task.id)
        }
        onDragEnd={handleDragEnd}
        style={{ borderInlineStartColor: currentColumn?.color }}
      >
        {isEditing ? (
          <>
            <h4 style={{ marginTop: 0 }}>
              작업 카드 수정
            </h4>

            <label
              htmlFor={`edit-title-${task.id}`}
              style={{
                display: 'block',
                marginBottom: '6px',
              }}
            >
              작업 제목
            </label>

            <input
              id={`edit-title-${task.id}`}
              type="text"
              autoFocus
              value={editTaskTitle}
              onChange={(e) =>
                setEditTaskTitle(e.target.value)
              }
            />

            <label
              htmlFor={`edit-description-${task.id}`}
              style={{
                display: 'block',
                marginTop: '12px',
                marginBottom: '6px',
              }}
            >
              작업 설명
            </label>

            <textarea
              id={`edit-description-${task.id}`}
              value={editTaskDescription}
              onChange={(e) =>
                setEditTaskDescription(e.target.value)
              }
            />

            <label
              htmlFor={`edit-priority-${task.id}`}
              style={{
                display: 'block',
                marginTop: '12px',
                marginBottom: '6px',
              }}
            >
              우선순위
            </label>

            <select
              id={`edit-priority-${task.id}`}
              value={editTaskPriority}
              onChange={(e) =>
                setEditTaskPriority(e.target.value)
              }
            >
              {priorities.map((priority) => (
                <option
                  key={priority.value}
                  value={priority.value}
                >
                  {priority.label}
                </option>
              ))}
            </select>

            <label
              htmlFor={`edit-date-${task.id}`}
              style={{
                display: 'block',
                marginTop: '12px',
                marginBottom: '6px',
              }}
            >
              마감일 (비워두면 삭제)
            </label>

            <input
              id={`edit-date-${task.id}`}
              type="date"
              value={editTaskDueDate}
              onChange={(e) =>
                setEditTaskDueDate(e.target.value)
              }
            />

            <div className="tf-actions">
              <button
                onClick={() => handleUpdateTask(task.id)}
                disabled={savingTaskId === task.id}
                className="tf-primary"
              >
                {savingTaskId === task.id
                  ? '저장 중...'
                  : '저장'}
              </button>

              <button
                onClick={handleCancelEditTask}
                disabled={savingTaskId === task.id}
              >
                취소
              </button>
            </div>
          </>
        ) : (
          <>
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: '8px',
                marginBottom: '8px',
              }}
            >
              <strong
                style={{
                  overflowWrap: 'anywhere',
                }}
              >
                {task.title}
              </strong>

              {!commentPanel && <span
                aria-hidden="true"
                title="카드를 드래그해서 이동하세요"
                style={{
                  color: 'var(--tf-muted)',
                  fontSize: '18px',
                  cursor: 'grab',
                }}
              >
                ⠿
              </span>}
            </div>

            {task.description && (
              <p className="tf-task-description">{task.description}</p>
            )}

            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                flexWrap: 'wrap',
                marginBottom: '12px',
              }}
            >
              {renderPriorityBadge(task.priority)}

              {task.dueDate && (
                <time className="tf-date" dateTime={task.dueDate}>
                  마감 {task.dueDate}
                </time>
              )}
              {dueDateBadge && (
                <span
                  className="tf-badge"
                  style={{
                    backgroundColor: dueDateBadge.background,
                    color: dueDateBadge.color,
                  }}
                >
                  {dueDateBadge.label}
                </span>
              )}
            </div>

            <div className="tf-task-assignee">
              <label htmlFor={`assignee-${task.id}`}>담당자</label>
              <select
                id={`assignee-${task.id}`}
                aria-label={`${task.title} 담당자`}
                aria-describedby={assignment ? `assignee-error-${task.id}` : undefined}
                value={assigneeValue}
                disabled={memberStatus !== 'ready' || assigning || updatingTaskId === task.id || deletingTaskId === task.id}
                onChange={(event) => {
                  const value = event.target.value
                  void handleUpdateAssignee(task, value === '' ? null : Number(value))
                }}
              >
                <option value="">미배정</option>
                {assigneeValue && !assignee && (
                  <option value={assigneeValue} disabled>
                    {memberStatus === 'loading' ? '담당자 확인 중' : '담당자 이름 확인 불가'}
                  </option>
                )}
                {members.map((member) => (
                  <option key={member.userId} value={member.userId}>{member.name}</option>
                ))}
              </select>
              {assigning && <span role="status">담당자 저장 중…</span>}
              {assignment && <p id={`assignee-error-${task.id}`} className="tf-error" role="alert">{assignment}</p>}
            </div>

            <label htmlFor={`task-move-${task.id}`}>상태 변경</label>
            <select
              id={`task-move-${task.id}`}
              aria-label={`${task.title} 상태 변경`}
              value={task.status}
              disabled={
                assigning ||
                updatingTaskId === task.id ||
                deletingTaskId === task.id
              }
              onChange={(e) =>
                handleUpdateTaskStatus(
                  task.id,
                  e.target.value
                )
              }
              style={{
                marginBottom: '12px',
                cursor: 'pointer',
              }}
            >
              <option value="TODO">할 일</option>
              <option value="IN_PROGRESS">진행 중</option>
              <option value="DONE">완료</option>
            </select>

            <div
              style={{
                display: 'flex',
                gap: '8px',
                flexWrap: 'wrap',
              }}
            >
              <button
                onClick={() => handleStartEditTask(task)}
                disabled={
                  assigning ||
                  updatingTaskId === task.id ||
                  deletingTaskId === task.id
                }
                aria-label={`${task.title} 수정`}
              >
                수정
              </button>

              <button
                onClick={() => handleDeleteTask(task.id)}
                disabled={
                  assigning ||
                  deletingTaskId === task.id ||
                  updatingTaskId === task.id
                }
                className="tf-danger"
                aria-label={`${task.title} 삭제`}
              >
                {deletingTaskId === task.id
                  ? '삭제 중...'
                  : '삭제'}
              </button>

              <button
                type="button"
                aria-expanded={commentPanel !== null}
                aria-controls={commentPanel ? `task-comments-${task.id}` : undefined}
                onClick={() => setOpenComments(commentPanel ? null : { taskId: task.id, revision: 0 })}
              >
                {commentPanel ? '댓글 닫기' : '댓글'}
              </button>
              <button
                type="button"
                aria-expanded={checklistPanel !== null}
                aria-controls={checklistPanel ? `task-checklist-${task.id}` : undefined}
                onClick={() => setOpenChecklist(checklistPanel ? null : { taskId: task.id, revision: 0 })}
              >
                체크리스트 {checklistCompleted}/{checklistTotal} ({checklistPercent}%)
              </button>
              <button
                type="button"
                aria-expanded={attachmentPanel !== null}
                aria-controls={attachmentPanel ? `task-attachments-${task.id}` : undefined}
                onClick={() => setOpenAttachments(attachmentPanel ? null : { taskId: task.id, revision: 0 })}
              >
                {attachmentPanel ? '첨부파일 닫기' : '첨부파일'}
              </button>
            </div>
            {checklistPanel && (
              <TaskChecklist
                key={task.id}
                taskId={task.id}
                revision={checklistPanel.revision}
                connectionRevision={memberRefreshes.get(task.projectId) ?? 0}
                onSessionExpired={onSessionExpired}
                onChanged={() => liveTasks.current.get(task.projectId)?.invalidate()}
              />
            )}
            {commentPanel && (
              <TaskComments
                key={task.id}
                taskId={task.id}
                userId={userId}
                revision={commentPanel.revision}
                focusTarget={commentPanel.focusTarget}
                connectionRevision={memberRefreshes.get(task.projectId) ?? 0}
                onSessionExpired={onSessionExpired}
              />
            )}
            {attachmentPanel && (
              <TaskAttachments
                key={task.id}
                taskId={task.id}
                userId={userId}
                revision={attachmentPanel.revision}
                connectionRevision={memberRefreshes.get(task.projectId) ?? 0}
                onSessionExpired={onSessionExpired}
              />
            )}
          </>
        )}
      </div>
    )
  }

  const totalTasks = tasks.length
  const statusCounts = columns.map((column) => ({
    ...column,
    count: tasks.filter((task) => task.status === column.status).length,
  }))
  const completedTasks = statusCounts.find((column) => column.status === 'DONE')?.count ?? 0
  const completionRate = totalTasks === 0
    ? 0
    : Math.round((completedTasks / totalTasks) * 100)
  const alertsByTaskId = new Map<number, keyof typeof dueDateAlerts>()
  let overdueTasks = 0
  let upcomingTasks = 0
  for (const task of tasks) {
    const alert = getDueDateAlert(task, today)
    if (!alert) continue
    alertsByTaskId.set(task.id, alert)
    if (alert === 'overdue') {
      overdueTasks += 1
    } else {
      upcomingTasks += 1
    }
  }

  const dashboardTotals = [
    { label: '전체 프로젝트', value: `${projects.length}개` },
    { label: '전체 작업', value: `${totalTasks}개` },
    { label: '작업 완료율', value: `${completionRate}%` },
    { label: '기한 초과 작업', value: `${overdueTasks}개` },
    { label: '3일 이내 마감 예정 (오늘 포함)', value: `${upcomingTasks}개` },
  ]

  const matchesProjectSearch = createSearchMatcher(projectSearch)
  const filteredProjects = projects.filter((project) => matchesProjectSearch(project.name))
  const favoriteProjects = filteredProjects.filter(({ id }) => favoriteProjectIds.has(id))
  const taskSearchTerm = taskSearch.trim()
  const matchesTaskSearch = createSearchMatcher(taskSearchTerm)
  const visibleProjectNames = new Map(
    (isDashboard || isMyTasks ? projects : selectedProject ? [selectedProject] : []).map(({ id, name }) => [id, name]),
  )
  const filteredTasks = tasks.filter((task) => {
    const projectName = visibleProjectNames.get(task.projectId)
    if (projectName === undefined || (isDashboard && !matchesProjectSearch(projectName))) return false

    const assignee = assigneeFilters.get(task.projectId) ?? 'ALL'
    const matchesAssignee = isMyTasks
      ? task.assigneeId === userId
      : assignee === 'ALL' ||
        (assignee === 'UNASSIGNED' ? task.assigneeId == null : String(task.assigneeId) === assignee)
    const matchesSearch = matchesTaskSearch(task.title) || matchesTaskSearch(task.description)

    return matchesSearch && matchesAssignee &&
      (taskStatusFilter === 'ALL' || task.status === taskStatusFilter) &&
      (taskPriorityFilter === 'ALL' || getPriority(task.priority).value === taskPriorityFilter)
  })
  const hasGlobalTaskFilter = taskStatusFilter !== 'ALL' || taskPriorityFilter !== 'ALL'
  const hasTaskFilter = Boolean(taskSearch) || hasGlobalTaskFilter ||
    (isDashboard ? assigneeFilters.size > 0 : selectedProject && assigneeFilters.has(selectedProject.id))
  const workspaceTitle = isDashboard ? '대시보드' : isMyTasks ? '내 업무' : '프로젝트'
  const project = selectedProject
  const allProjectTasks = project ? tasks.filter((task) => task.projectId === project.id) : []
  const projectTasks = (routedTask && !filteredTasks.some((task) => task.id === routedTask.id)
    ? [...filteredTasks, routedTask]
    : [...filteredTasks]).sort((first, second) => first.id - second.id)
  const assignedIds = [...new Set(allProjectTasks.flatMap((task) =>
    task.assigneeId == null ? [] : [task.assigneeId]
  ))].sort()
  const calendar = (
    <TaskCalendar
      today={today}
      tasks={filteredTasks}
      projectNames={visibleProjectNames}
      alertsByTaskId={alertsByTaskId}
      status={dashboardStatus}
      onTaskClick={(task) => {
        if (visibleRoutedTaskId === task.id) focusTask(task.id)
      }}
    />
  )

  function followSidebarLink() {
    if (!compactWorkspace) return
    setMobileSidebarOpen(false)
    workspaceContent.current?.focus()
  }

  function openProjectPages(projectId: number) {
    const href = projectTabHref(projectId, 'pages')
    if (window.location.hash !== href) window.location.assign(href)
    followSidebarLink()
  }

  return (
    <div className="tf-app tf-workspace" data-sidebar-open={sidebarOpen}>
      <header className="tf-workspace-bar">
        <a className="tf-skip-link" href="#workspace-content" onClick={(event) => {
          event.preventDefault()
          workspaceContent.current?.focus()
        }}>본문으로 건너뛰기</a>
        <button
          ref={sidebarToggle}
          type="button"
          className="tf-sidebar-toggle"
          aria-controls="workspace-sidebar"
          aria-expanded={sidebarOpen}
          aria-label={sidebarOpen ? '사이드바 접기' : '사이드바 펼치기'}
          onClick={() => compactWorkspace
            ? setMobileSidebarOpen((previous) => !previous)
            : setDesktopSidebarOpen((previous) => !previous)}
        >
          <span className="tf-sidebar-icon" aria-hidden="true" />
        </button>
        <a className="tf-brand" href={dashboardHref}>
          <span aria-hidden="true">T</span>
          TeamFlow
        </a>
        <NotificationCenter key={userId} onOpenTask={openNotificationTask} onSessionExpired={onSessionExpired} />
      </header>
      <nav id="workspace-sidebar" className="tf-sidebar" aria-label="워크스페이스" hidden={!sidebarOpen} onKeyDown={(event) => {
        if (event.key !== 'Escape' || event.defaultPrevented || !event.currentTarget.contains(event.target as Node)) return
        event.preventDefault()
        if (compactWorkspace) setMobileSidebarOpen(false)
        else setDesktopSidebarOpen(false)
        sidebarToggle.current?.focus()
      }}>
        <h2>워크스페이스</h2>
        <a href={dashboardHref} aria-current={isDashboard ? 'page' : undefined} onClick={followSidebarLink}>
          대시보드
        </a>
        <a href={myTasksHref} aria-current={isMyTasks ? 'page' : undefined} onClick={followSidebarLink}>
          내 업무
        </a>
        <h2 id="sidebar-projects-title">프로젝트 <span>{projects.length}</span></h2>
        <label htmlFor="project-search">프로젝트 이름 검색</label>
        <input
          id="project-search"
          type="search"
          placeholder="프로젝트 이름 검색..."
          value={projectSearch}
          onChange={(event) => setProjectSearch(event.target.value)}
        />
        {dashboardStatus === 'loading' && <p className="tf-status" role="status">프로젝트를 불러오는 중입니다.</p>}
        {dashboardStatus === 'ready' && projects.length === 0 && <p className="tf-empty">아직 프로젝트가 없습니다.</p>}
        {dashboardStatus === 'ready' && projects.length > 0 && projectSearch.trim() && (
          <p className="tf-status" role="status">검색 결과 {filteredProjects.length}개</p>
        )}
        {favoriteProjects.length > 0 && (
          <>
            <h3 id="sidebar-favorites-title">즐겨찾기</h3>
            <ul aria-labelledby="sidebar-favorites-title">
              {favoriteProjects.map((project) => (
                <li key={project.id}>
                  <a
                    href={projectHref(project.id)}
                    onClick={followSidebarLink}
                  >
                    {project.name}
                  </a>
                </li>
              ))}
            </ul>
          </>
        )}
        <ul aria-labelledby="sidebar-projects-title">
          {projects.map((project) => {
            const current = project.id === route.projectId
            const active = current && projectTab === 'pages'
            const open = openDocumentProjects.get(project.id) ?? current
            const treeId = `tf-project-pages-${project.id}`
            return (
              <li key={project.id} className="tf-sidebar-project" hidden={!matchesProjectSearch(project.name)}>
                <a
                  href={projectHref(project.id)}
                  aria-current={project.id === route.projectId && projectTab !== 'pages' ? 'page' : undefined}
                  onClick={followSidebarLink}
                >
                  {project.name}
                </a>
                <button
                  type="button"
                  className="tf-favorite-toggle"
                  aria-label={`${project.name} 즐겨찾기`}
                  aria-pressed={favoriteProjectIds.has(project.id)}
                  onClick={() => setFavoriteProjectIds((previous) => {
                    const next = new Set(previous)
                    if (next.has(project.id)) next.delete(project.id)
                    else next.add(project.id)
                    return next
                  })}
                >
                  <span aria-hidden="true">{favoriteProjectIds.has(project.id) ? '★' : '☆'}</span>
                </button>
                <div className="tf-sidebar-documents">
                  <button type="button" className="tf-page-tree-toggle" aria-label={`${project.name} 문서`}
                    aria-expanded={open} aria-controls={treeId}
                    onClick={() => setOpenDocumentProjects((previous) => new Map(previous).set(project.id, !open))}>
                    <span aria-hidden="true">{open ? '▾' : '▸'}</span> 문서
                  </button>
                  <div id={treeId} hidden={!open}>
                    {(open || active) && (
                      <ProjectPages projectId={project.id} userId={userId} active={active}
                        workspace={active ? pageWorkspace : null}
                        onOpen={() => openProjectPages(project.id)} onSessionExpired={onSessionExpired} />
                    )}
                  </div>
                </div>
              </li>
            )
          })}
        </ul>
      </nav>
      <main id="workspace-content" className="tf-workspace-content" ref={workspaceContent} tabIndex={-1}>
      <header className="tf-hero">
        {project && <a href={dashboardHref}>워크스페이스</a>}
        <h1>{project?.name ?? workspaceTitle}</h1>
      </header>

      {(isDashboard || dashboardStatus !== 'ready') && <section
        className="tf-dashboard"
        aria-labelledby="dashboard-title"
      >
        <h2 id="dashboard-title">{isDashboard ? '업무 현황' : '워크스페이스 상태'}</h2>
        {dashboardStatus === 'loading' && <p className="tf-status" role="status">워크스페이스를 불러오는 중입니다.</p>}
        {dashboardStatus === 'error' && (
          <>
            <p className="tf-error" role="alert">워크스페이스를 불러오지 못했습니다.</p>
            <button type="button" disabled={creatingProject} onClick={() => {
              setDashboardStatus('loading')
              setWorkspaceAttempt((attempt) => attempt + 1)
            }}>다시 불러오기</button>
          </>
        )}
        {dashboardStatus === 'ready' && (
          <>
            <dl className="tf-metrics">
              {dashboardTotals.map(({ label, value }) => (
                <div
                  key={label}
                >
                  <dt>{label}</dt>
                  <dd>
                    {value}
                  </dd>
                </div>
              ))}
            </dl>

            <div className="tf-chart">
              <h3>작업 상태별 현황</h3>
              <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: '12px' }}>
                {statusCounts.map(({ status, label, color, count }) => (
                  <li key={status}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: '12px' }}>
                      <span>{label}</span>
                      <strong>{count}개</strong>
                    </div>
                    <div
                      aria-hidden="true"
                      style={{
                        height: '10px',
                        marginTop: '6px',
                        borderRadius: '6px',
                        backgroundColor: 'var(--tf-track)',
                        overflow: 'hidden',
                      }}
                    >
                      <div
                        style={{
                          width: `${totalTasks === 0 ? 0 : (count / totalTasks) * 100}%`,
                          height: '100%',
                          backgroundColor: color,
                        }}
                      />
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          </>
        )}
      </section>}

      {isDashboard && <InvitationInbox
        workspaceReady={dashboardStatus !== 'loading'}
        onAccept={handleAcceptInvitation}
      />}

      {/* 프로젝트 생성 */}
      {(isDashboard || selectedProject || (isMyTasks && dashboardStatus === 'ready')) && <div className={isDashboard ? 'tf-tools' : undefined}>
        {isDashboard && <section className="tf-panel" aria-labelledby="create-project-title">
          <h2 id="create-project-title">
            새 프로젝트 만들기
          </h2>

          <form className="tf-project-form" onSubmit={(event) => {
            event.preventDefault()
            void handleCreateProject()
          }}>
            <div>
              <label htmlFor="project-name">프로젝트 이름</label>
              <input
                id="project-name"
                value={name}
                onChange={(event) => setName(event.target.value)}
                required
              />
            </div>
            <div>
              <label htmlFor="project-description">프로젝트 설명</label>
              <textarea
                id="project-description"
                value={description}
                onChange={(event) => setDescription(event.target.value)}
              />
            </div>
            {projectFormError && <p className="tf-error" role="alert">{projectFormError}</p>}
            {creatingProject && <p className="tf-status" role="status">프로젝트를 만드는 중입니다.</p>}
            <button type="submit" className="tf-primary" disabled={creatingProject || dashboardStatus === 'loading'}>
              + 프로젝트 추가
            </button>
          </form>
        </section>}

        <section className="tf-panel" aria-labelledby="task-filter-title">
          <h2 id="task-filter-title">{isMyTasks ? '내 업무' : '작업 검색 및 필터'}</h2>
          {isMyTasks && projects.some(({ id }) => syncErrors.has(id)) && (
            <p className="tf-status" role="status">일부 프로젝트의 작업을 불러오는 중입니다.</p>
          )}
          <label htmlFor="task-search">작업 제목·설명 검색</label>
          <input
            id="task-search"
            type="search"
            placeholder="제목 또는 설명 입력"
            value={taskSearch}
            onChange={(event) => setTaskSearch(event.target.value)}
          />
          <div className="tf-filters">
            <div>
              <label htmlFor="task-status-filter">상태</label>
              <select
                id="task-status-filter"
                value={taskStatusFilter}
                onChange={(event) => setTaskStatusFilter(event.target.value)}
              >
                <option value="ALL">전체</option>
                {columns.map((column) => (
                  <option key={column.status} value={column.status}>{column.label}</option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="task-priority-filter">우선순위</label>
              <select
                id="task-priority-filter"
                value={taskPriorityFilter}
                onChange={(event) => setTaskPriorityFilter(event.target.value)}
              >
                <option value="ALL">전체</option>
                {priorities.map((priority) => (
                  <option key={priority.value} value={priority.value}>{priority.label}</option>
                ))}
              </select>
            </div>
          </div>
          {hasTaskFilter && (
            <div className="tf-actions">
              <span role="status">검색 결과 {filteredTasks.length}개</span>
              <button
                type="button"
                onClick={() => {
                  setTaskSearch('')
                  setTaskStatusFilter('ALL')
                  setTaskPriorityFilter('ALL')
                  if (!isMyTasks) setAssigneeFilters(new Map())
                }}
              >
                필터 초기화
              </button>
            </div>
          )}
          {(isMyTasks || hasTaskFilter) && dashboardStatus === 'ready' && (
            filteredTasks.length > 0 ? (
              <ul className="tf-task-search-results" role="list" aria-label={isMyTasks ? '내게 배정된 작업' : '작업 검색 결과'}>
                {filteredTasks.map((task) => (
                  <li key={task.id}>
                    <a href={projectHref(task.projectId, task.id)} onClick={() => {
                      if (visibleRoutedTaskId === task.id) focusTask(task.id)
                    }}>
                      {task.title}
                      <small>{visibleProjectNames.get(task.projectId)}</small>
                      {isMyTasks && (
                        <small>
                          {statusLabels.get(task.status) ?? task.status}
                          {task.dueDate && <> · 마감 <time dateTime={task.dueDate}>{task.dueDate}</time></>}
                        </small>
                      )}
                    </a>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="tf-empty">
                {isMyTasks && !hasTaskFilter ? '내게 배정된 작업이 없습니다.' : '검색 조건에 맞는 작업이 없습니다.'}
              </p>
            )
          )}
        </section>
      </div>}

      {error && <p className="tf-error" role="alert">{error}</p>}

      {(isDashboard || (isMyTasks && dashboardStatus === 'ready')) && calendar}

      {route.page === 'project' && !selectedProject && dashboardStatus === 'ready' && (
        <section className="tf-panel">
          <h2>프로젝트를 열 수 없습니다</h2>
          <p>프로젝트가 삭제되었거나 접근 권한이 없습니다.</p>
          <a href={dashboardHref}>대시보드로 이동</a>
        </section>
      )}
        {project && (
            <section
              key={project.id}
              className="tf-project"
              aria-label={project.name}
            >
              {syncErrors.has(project.id) && (
                <p className="tf-status" role="status">작업 동기화를 다시 시도하고 있습니다.</p>
              )}
              <ProjectCollaboration
                projectId={project.id}
                userId={userId}
                refreshKey={`${memberRefreshes.get(project.id) ?? 0}:${assignedIds.join(',')}`}
                showMembers={projectTab === 'members'}
                renderHeader={(isOwner) => (
                  <>
                    {isOwner && editingId === project.id ? (
                      <>
                        <input
                          type="text"
                          autoFocus
                          aria-label="프로젝트 이름 수정"
                          value={editName}
                          onChange={(e) =>
                            setEditName(e.target.value)
                          }
                        />

                        <textarea
                          aria-label="프로젝트 설명 수정"
                          value={editDescription}
                          onChange={(e) =>
                            setEditDescription(e.target.value)
                          }
                          style={{
                            marginTop: '10px',
                          }}
                        />

                        <div className="tf-actions">
                          <button
                            onClick={() =>
                              handleUpdateProject(project.id)
                            }
                            className="tf-primary"
                          >
                            저장
                          </button>

                          <button onClick={handleCancelEdit}>
                            취소
                          </button>
                        </div>
                      </>
                    ) : (
                      <>
                        {project.description && <p className="tf-project-description">{project.description}</p>}

                        {isOwner && (
                          <div
                            style={{
                              display: 'flex',
                              gap: '8px',
                              flexWrap: 'wrap',
                            }}
                          >
                            <button
                              onClick={() =>
                                handleStartEdit(project)
                              }
                            >
                              프로젝트 수정
                            </button>
        
                            <button
                              onClick={() =>
                                handleDeleteProject(project.id)
                              }
                              className="tf-danger"
                            >
                              프로젝트 삭제
                            </button>
                          </div>
                        )}
                      </>
                    )}
                    <nav className="tf-project-tabs" aria-label="프로젝트 보기">
                      {projectTabs.map(({ id, label }) => (
                        <a key={id} href={projectTabHref(project.id, id)}
                          aria-current={projectTab === id ? 'page' : undefined}>
                          {label}
                        </a>
                      ))}
                    </nav>
                  </>
                )}
              >
                {(memberState) => {
                  const members = memberState.status === 'ready' ? memberState.items : []
                  const selectedAssignee = assigneeFilters.get(project.id) ?? 'ALL'
                  const hasMissingAssignee = selectedAssignee !== 'ALL' && selectedAssignee !== 'UNASSIGNED' &&
                    !members.some((member) => String(member.userId) === selectedAssignee)
                  const projectHasTaskFilter = Boolean(taskSearchTerm) || hasGlobalTaskFilter ||
                    selectedAssignee !== 'ALL'

                  return (
                    <>
                      <div hidden={projectTab !== 'calendar'}>{calendar}</div>
                      {projectTab === 'pages' && (
                        <div ref={setPageWorkspace} data-project-id={project.id} />
                      )}
                      <div hidden={projectTab !== 'stats'}>
                        {dashboardStatus === 'ready' && (
                          <ProjectStats project={project} tasks={allProjectTasks} members={members} today={today} />
                        )}
                        <ProjectActivities
                          projectId={project.id}
                          refreshKey={activityRefreshes.get(project.id) ?? 0}
                          members={members}
                          statusLabels={statusLabels}
                          onSessionExpired={onSessionExpired}
                        />
                      </div>

                      {/* 칸반 보드 */}
                      <div
                        hidden={projectTab !== 'kanban'}
                        style={{
                          marginTop: '24px',
                          paddingTop: '20px',
                          borderTop: '1px solid var(--tf-track)',
                        }}
                      >
                        <h3 id={`board-title-${project.id}`}>
                          {project.name} 작업 보드 ({projectTasks.length})
                        </h3>
                        <div className="tf-assignee-filter">
                          <label htmlFor={`assignee-filter-${project.id}`}>담당자 필터</label>
                          <select
                            id={`assignee-filter-${project.id}`}
                            aria-label={`${project.name} 담당자 필터`}
                            value={selectedAssignee}
                            onChange={(event) => {
                              const value = event.target.value
                              setAssigneeFilters((previous) => {
                                const updated = new Map(previous)
                                if (value === 'ALL') updated.delete(project.id)
                                else updated.set(project.id, value)
                                return updated
                              })
                            }}
                          >
                            <option value="ALL">전체</option>
                            <option value="UNASSIGNED">미배정</option>
                            {hasMissingAssignee && (
                              <option value={selectedAssignee}>사용자 #{selectedAssignee}</option>
                            )}
                            {members.map((member) => (
                              <option key={member.userId} value={member.userId}>{member.name}</option>
                            ))}
                          </select>
                        </div>

                        {!syncErrors.has(project.id) && projectHasTaskFilter && projectTasks.length === 0 && (
                          <p className="tf-empty">검색 조건에 맞는 작업이 없습니다.</p>
                        )}

                        <ScrollRegion kind="board" labelId={`board-title-${project.id}`}>
                          {columns.map((column) => {
                            const columnTasks = projectTasks.filter(
                              (task) =>
                                task.status === column.status
                            )

                            const columnKey =
                              `${project.id}-${column.status}`

                            const isDragOver =
                              dragOverColumn === columnKey

                            return (
                              <div
                                key={column.status}
                                className="tf-column"
                                data-status={column.status}
                                data-drop-target={isDragOver}
                                onDragOver={(event) =>
                                  handleDragOver(
                                    event,
                                    project.id,
                                    column.status
                                  )
                                }
                                onDrop={(event) =>
                                  handleDrop(
                                    event,
                                    project.id,
                                    column.status
                                  )
                                }
                              >
                                <div
                                  style={{
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'space-between',
                                    marginBottom: '18px',
                                  }}
                                >
                                  <h4
                                    className="tf-column-title"
                                    style={{
                                      margin: 0,
                                      color: column.color,
                                    }}
                                  >
                                    {column.label}
                                  </h4>

                                  <span
                                    className="tf-badge tf-count"
                                  >
                                    {columnTasks.length}
                                  </span>
                                </div>

                                {!syncErrors.has(project.id) && columnTasks.length === 0 && (
                                  <p className="tf-column-empty">
                                    작업이 없습니다.
                                  </p>
                                )}

                                {columnTasks.map((task) =>
                                  renderTaskCard(task, members, memberState.status)
                                )}

                                <button
                                  className="tf-add-task"
                                  aria-label={`${column.label} 열에 새 작업 추가`}
                                  onClick={(event) => {
                                    addTaskTrigger.current = event.currentTarget
                                    handleStartTask(
                                      project.id,
                                      column.status
                                    )
                                  }}
                                >
                                  + 새 작업 추가
                                </button>
                              </div>
                            )
                          })}
                        </ScrollRegion>

                        {/* 작업 카드 생성 입력창 */}
                        {taskProjectId === project.id && (
                          <div className="tf-task-form">
                            <h4 style={{ marginTop: 0 }}>
                              새 작업 추가
                            </h4>

                            <label
                              htmlFor={`task-title-${project.id}`}
                              style={{
                                display: 'block',
                                marginBottom: '6px',
                              }}
                            >
                              작업 제목
                            </label>

                            <input
                              id={`task-title-${project.id}`}
                              type="text"
                              autoFocus
                              placeholder="작업 제목"
                              value={taskTitle}
                              onChange={(e) =>
                                setTaskTitle(e.target.value)
                              }
                            />

                            <label
                              htmlFor={`task-description-${project.id}`}
                              style={{
                                display: 'block',
                                marginTop: '12px',
                                marginBottom: '6px',
                              }}
                            >
                              작업 설명
                            </label>

                            <textarea
                              id={`task-description-${project.id}`}
                              placeholder="작업 설명"
                              value={taskDescription}
                              onChange={(e) =>
                                setTaskDescription(e.target.value)
                              }
                            />

                            <label
                              htmlFor={`task-status-${project.id}`}
                              style={{
                                display: 'block',
                                marginTop: '12px',
                                marginBottom: '6px',
                              }}
                            >
                              작업 상태
                            </label>

                            <select
                              id={`task-status-${project.id}`}
                              value={taskStatus}
                              onChange={(e) =>
                                setTaskStatus(e.target.value)
                              }
                            >
                              <option value="TODO">할 일</option>
                              <option value="IN_PROGRESS">진행 중</option>
                              <option value="DONE">완료</option>
                            </select>

                            <label
                              htmlFor={`task-priority-${project.id}`}
                              style={{
                                display: 'block',
                                marginTop: '12px',
                                marginBottom: '6px',
                              }}
                            >
                              우선순위
                            </label>

                            <select
                              id={`task-priority-${project.id}`}
                              value={taskPriority}
                              onChange={(e) =>
                                setTaskPriority(e.target.value)
                              }
                            >
                              {priorities.map((priority) => (
                                <option
                                  key={priority.value}
                                  value={priority.value}
                                >
                                  {priority.label}
                                </option>
                              ))}
                            </select>

                            <label
                              htmlFor={`task-date-${project.id}`}
                              style={{
                                display: 'block',
                                marginTop: '12px',
                                marginBottom: '6px',
                              }}
                            >
                              마감일 (선택 사항)
                            </label>

                            <input
                              id={`task-date-${project.id}`}
                              type="date"
                              ref={taskDueDateInput}
                              value={taskDueDate}
                              onClick={() => showDatePicker(taskDueDateInput.current)}
                              onChange={(e) =>
                                setTaskDueDate(e.target.value)
                              }
                            />

                            <div className="tf-actions">
                              <button
                                onClick={() =>
                                  handleCreateTask(project.id)
                                }
                                disabled={creatingTask}
                                className="tf-primary"
                              >
                                {creatingTask
                                  ? '추가 중...'
                                  : '작업 추가'}
                              </button>

                              <button
                                onClick={() => {
                                  handleCancelTask()
                                  addTaskTrigger.current?.focus()
                                }}
                                disabled={creatingTask}
                              >
                                취소
                              </button>
                            </div>
                          </div>
                        )}
                      </div>
                    </>
                  )
                }}
              </ProjectCollaboration>
            </section>
        )}
      </main>
      <AdSidebar {...workspaceAds} />
    </div>
  )
}

function readFavoriteProjects(storageKey: string) {
  try {
    const ids: unknown = JSON.parse(window.localStorage.getItem(storageKey) ?? '[]')
    if (Array.isArray(ids)) {
      return new Set(ids.filter((id): id is number => typeof id === 'number' && Number.isSafeInteger(id) && id > 0))
    }
  } catch {
    return new Set<number>()
  }
  return new Set<number>()
}

function focusTask(taskId: number) {
  const card = document.getElementById(`task-${taskId}`)
  card?.focus({ preventScroll: true })
  card?.scrollIntoView({ block: 'center', inline: 'nearest' })
}

export default App

