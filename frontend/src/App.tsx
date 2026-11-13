
import { useEffect, useState } from 'react'
import type { DragEvent } from 'react'
import './TeamFlow.css'

type Project = {
  id: number
  name: string
  description: string
}

type Task = {
  id: number
  projectId: number
  title: string
  description: string
  status: string
  priority: string | null
  dueDate: string | null
}

const columns = [
  { status: 'TODO', label: '할 일', color: '#64748b' },
  { status: 'IN_PROGRESS', label: '진행 중', color: '#2563eb' },
  { status: 'DONE', label: '완료', color: '#15803d' },
]

const priorities = [
  { value: 'HIGH', label: '높음', color: '#dc2626', background: '#fee2e2' },
  { value: 'MEDIUM', label: '보통', color: '#b45309', background: '#fef3c7' },
  { value: 'LOW', label: '낮음', color: '#15803d', background: '#dcfce7' },
]

const dueDateAlerts = {
  overdue: { label: '기한 초과', color: '#991b1b', background: '#fee2e2' },
  today: { label: '오늘 마감', color: '#9a3412', background: '#ffedd5' },
  upcoming: { label: '마감 임박', color: '#854d0e', background: '#fef9c3' },
}

const millisecondsPerDay = 86_400_000

const getLocalCalendarDay = (date: Date) =>
  Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / millisecondsPerDay

const getDueDateAlert = (task: Task, today: number): keyof typeof dueDateAlerts | null => {
  if (task.status === 'DONE' || !task.dueDate || !/^\d{4}-\d{2}-\d{2}$/.test(task.dueDate)) {
    return null
  }

  const dueDate = new Date(`${task.dueDate}T00:00:00Z`)
  if (Number.isNaN(dueDate.getTime()) || dueDate.toISOString().slice(0, 10) !== task.dueDate) {
    return null
  }

  const daysRemaining = dueDate.getTime() / millisecondsPerDay - today
  if (daysRemaining < 0) return 'overdue'
  if (daysRemaining === 0) return 'today'
  if (daysRemaining <= 3) return 'upcoming'
  return null
}

const getPriority = (priority: string | null) =>
  priorities.find((item) => item.value === priority) ?? priorities[1]

function App() {
  const [projects, setProjects] = useState<Project[]>([])
  const [projectSearch, setProjectSearch] = useState('')
  const [tasks, setTasks] = useState<Task[]>([])
  const [taskSearch, setTaskSearch] = useState('')
  const [taskStatusFilter, setTaskStatusFilter] = useState('ALL')
  const [taskPriorityFilter, setTaskPriorityFilter] = useState('ALL')

  // 프로젝트 생성
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')

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
  const [today, setToday] = useState(() => getLocalCalendarDay(new Date()))

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
    const loadData = async () => {
      try {
        setError('')

        const projectResponse = await fetch('/api/projects')

        if (!projectResponse.ok) {
          throw new Error('프로젝트 조회 실패')
        }

        const projectData: Project[] = await projectResponse.json()
        setProjects(projectData)

        const taskLists = await Promise.all(
          projectData.map(async (project) => {
            const response = await fetch(
              `/api/tasks/project/${project.id}`
            )

            if (!response.ok) {
              throw new Error('작업 카드 조회 실패')
            }

            return (await response.json()) as Task[]
          })
        )

        setTasks(taskLists.flat())
        setDashboardStatus('ready')
      } catch (err) {
        console.error(err)
        setError('데이터를 불러오지 못했습니다.')
        setDashboardStatus('error')
      }
    }

    loadData()
  }, [])

  // 프로젝트 생성
  const handleCreateProject = async () => {
    if (!name.trim()) {
      alert('프로젝트 이름을 입력해 주세요.')
      return
    }

    try {
      setError('')

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
      setName('')
      setDescription('')
    } catch (err) {
      console.error(err)
      setError('프로젝트 생성에 실패했습니다.')
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

      setProjects((prev) =>
        prev.filter((project) => project.id !== id)
      )

      setTasks((prev) =>
        prev.filter((task) => task.projectId !== id)
      )

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

      setTasks((prev) => [...prev, newTask])
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

      setTasks((prev) =>
        prev.map((task) =>
          task.id === taskId ? updatedTask : task
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

      setTasks((prev) =>
        prev.map((task) =>
          task.id === taskId ? updatedTask : task
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

      setTasks((prev) =>
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
  const renderTaskCard = (task: Task) => {
    const currentColumn = columns.find(
      (column) => column.status === task.status
    )

    const isDragging = draggingTaskId === task.id
    const isEditing = editingTaskId === task.id
    const dueDateAlert = alertsByTaskId.get(task.id)
    const dueDateBadge = dueDateAlert ? dueDateAlerts[dueDateAlert] : null

    return (
      <div
        key={task.id}
        className="tf-task-card"
        data-dragging={isDragging}
        draggable={
          !isEditing &&
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

            <div
              style={{
                display: 'flex',
                gap: '8px',
                marginTop: '12px',
              }}
            >
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

              <span
                aria-hidden="true"
                title="카드를 드래그해서 이동하세요"
                style={{
                  color: '#94a3b8',
                  fontSize: '18px',
                  cursor: 'grab',
                }}
              >
                ⠿
              </span>
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

            <select
              aria-label={`${task.title} 상태 변경`}
              value={task.status}
              disabled={
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
            </div>
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

  const searchTerm = projectSearch.trim().toLocaleLowerCase()
  const filteredProjects = projects.filter((project) =>
    project.name.toLocaleLowerCase().includes(searchTerm),
  )
  const taskSearchTerm = taskSearch.trim().toLocaleLowerCase()
  const filteredTasks = tasks.filter((task) =>
    task.title.toLocaleLowerCase().includes(taskSearchTerm) &&
    (taskStatusFilter === 'ALL' || task.status === taskStatusFilter) &&
    (taskPriorityFilter === 'ALL' || task.priority === taskPriorityFilter),
  )
  const hasTaskFilter = Boolean(taskSearchTerm) ||
    taskStatusFilter !== 'ALL' || taskPriorityFilter !== 'ALL'

  return (
    <main className="tf-app">
      <header className="tf-hero">
        <h1>
          TeamFlow
        </h1>

        <p>
          팀 프로젝트와 작업을 한눈에 관리하세요.
        </p>
        <nav aria-label="워크스페이스 바로가기">
          <a href="#dashboard-title">대시보드</a>
          <a href="#projects-title">내 프로젝트</a>
        </nav>
      </header>

      <section
        className="tf-dashboard"
        aria-labelledby="dashboard-title"
      >
        <h2 id="dashboard-title" style={{ marginTop: 0 }}>대시보드</h2>
        {dashboardStatus === 'loading' && <p role="status">통계를 불러오는 중입니다.</p>}
        {dashboardStatus === 'error' && <p role="status">통계를 불러오지 못했습니다.</p>}
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
                        backgroundColor: '#e2e8f0',
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
      </section>

      {/* 프로젝트 생성 */}
      <div className="tf-tools">
        <section className="tf-panel" aria-labelledby="create-project-title">
          <h2 id="create-project-title">
            새 프로젝트 만들기
          </h2>

          <label htmlFor="project-name">프로젝트 이름</label>
          <input
            id="project-name"
            type="text"
            placeholder="프로젝트 이름"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />

          <label htmlFor="project-description">프로젝트 설명</label>
          <textarea
            id="project-description"
            placeholder="프로젝트 설명"
            value={description}
            onChange={(e) =>
              setDescription(e.target.value)
            }
          />

          <button
            onClick={handleCreateProject}
            className="tf-primary"
          >
            + 프로젝트 추가
          </button>
        </section>

        <section className="tf-panel" aria-labelledby="task-filter-title">
          <h2 id="task-filter-title">작업 검색 및 필터</h2>
          <label htmlFor="task-search">작업 제목 검색</label>
          <input
            id="task-search"
            type="search"
            placeholder="작업 제목 검색..."
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
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginTop: '12px' }}>
              <span role="status">검색 결과 {filteredTasks.length}개</span>
              <button
                type="button"
                onClick={() => {
                  setTaskSearch('')
                  setTaskStatusFilter('ALL')
                  setTaskPriorityFilter('ALL')
                }}
              >
                필터 초기화
              </button>
            </div>
          )}
        </section>
      </div>

      {error && <p className="tf-error" role="alert">{error}</p>}

      <section aria-labelledby="projects-title">
        <div className="tf-projects-heading">
          <h2 id="projects-title">내 프로젝트 <span>{projects.length}</span></h2>

          <div className="tf-project-search">
            <label htmlFor="project-search">프로젝트 이름 검색</label>
            <input
              id="project-search"
              type="search"
              placeholder="프로젝트 이름 검색..."
              value={projectSearch}
              onChange={(event) => setProjectSearch(event.target.value)}
            />
          </div>
        </div>

        {projectSearch.trim() && (
          <p role="status">검색 결과 {filteredProjects.length}개</p>
        )}

        {projects.length === 0 ? (
          <p className="tf-empty">아직 생성된 프로젝트가 없습니다.</p>
        ) : filteredProjects.length === 0 ? (
          <p className="tf-empty">검색 결과가 없습니다.</p>
        ) : null}

        {filteredProjects.map((project) => {
          const projectTasks = filteredTasks
            .filter((task) => task.projectId === project.id)
            .sort((a, b) => a.id - b.id)

          return (
            <section
              key={project.id}
              className="tf-project"
              aria-label={project.name}
            >
              {/* 프로젝트 정보 */}
              {editingId === project.id ? (
                <>
                  <input
                    type="text"
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

                  <div
                    style={{
                      display: 'flex',
                      gap: '8px',
                      marginTop: '10px',
                    }}
                  >
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
                  <h3 style={{ marginTop: 0 }}>
                    {project.name}
                  </h3>

                  <p style={{ color: '#64748b' }}>
                    {project.description}
                  </p>

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
                </>
              )}

              {/* 칸반 보드 */}
              <div
                style={{
                  marginTop: '24px',
                  paddingTop: '20px',
                  borderTop: '1px solid #e2e8f0',
                }}
              >
                <h3>
                  작업 보드 ({projectTasks.length})
                </h3>

                <div className="tf-board">
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

                        {columnTasks.length === 0 && (
                          <p className="tf-column-empty">
                            작업이 없습니다.
                          </p>
                        )}

                        {columnTasks.map((task) =>
                          renderTaskCard(task)
                        )}

                        <button
                          className="tf-add-task"
                          aria-label={`${column.label} 열에 새 작업 추가`}
                          onClick={() =>
                            handleStartTask(
                              project.id,
                              column.status
                            )
                          }
                        >
                          + 새 작업 추가
                        </button>
                      </div>
                    )
                  })}
                </div>

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
                      value={taskDueDate}
                      onChange={(e) =>
                        setTaskDueDate(e.target.value)
                      }
                    />

                    <div
                      style={{
                        display: 'flex',
                        gap: '8px',
                        marginTop: '12px',
                      }}
                    >
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
                        onClick={handleCancelTask}
                        disabled={creatingTask}
                      >
                        취소
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </section>
          )
        })}
      </section>
    </main>
  )
}

export default App

