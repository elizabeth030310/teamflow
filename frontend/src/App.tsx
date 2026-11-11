
import { useEffect, useState } from 'react'

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
}

function App() {
  const [projects, setProjects] = useState<Project[]>([])
  const [tasks, setTasks] = useState<Task[]>([])

  // 프로젝트 생성
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')

  // 프로젝트 수정
  const [editingId, setEditingId] = useState<number | null>(null)
  const [editName, setEditName] = useState('')
  const [editDescription, setEditDescription] = useState('')

  // 작업 카드 생성
  const [taskProjectId, setTaskProjectId] = useState<number | null>(null)
  const [taskTitle, setTaskTitle] = useState('')
  const [taskDescription, setTaskDescription] = useState('')
  const [taskStatus, setTaskStatus] = useState('TODO')

  // 작업 카드 수정
  const [editingTaskId, setEditingTaskId] = useState<number | null>(null)
  const [editTaskTitle, setEditTaskTitle] = useState('')
  const [editTaskDescription, setEditTaskDescription] = useState('')

  // 작업 카드 처리 상태
  const [updatingTaskId, setUpdatingTaskId] = useState<number | null>(null)
  const [deletingTaskId, setDeletingTaskId] = useState<number | null>(null)
  const [savingTaskId, setSavingTaskId] = useState<number | null>(null)

  const [error, setError] = useState('')

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
      } catch (error) {
        console.error(error)
        setError('데이터를 불러오지 못했습니다.')
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
        headers: {
          'Content-Type': 'application/json',
        },
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
    } catch (error) {
      console.error(error)
      setError('프로젝트 생성에 실패했습니다.')
    }
  }

  // 프로젝트 수정 시작
  const handleStartEdit = (project: Project) => {
    setEditingId(project.id)
    setEditName(project.name)
    setEditDescription(project.description)
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
        headers: {
          'Content-Type': 'application/json',
        },
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
    } catch (error) {
      console.error(error)
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
    } catch (error) {
      console.error(error)
      setError('프로젝트 삭제에 실패했습니다.')
    }
  }

  // 작업 카드 생성 입력창 열기
  const handleStartTask = (projectId: number) => {
    setTaskProjectId(projectId)
    setTaskTitle('')
    setTaskDescription('')
    setTaskStatus('TODO')
    setError('')
  }

  // 작업 카드 생성 취소
  const handleCancelTask = () => {
    setTaskProjectId(null)
    setTaskTitle('')
    setTaskDescription('')
    setTaskStatus('TODO')
  }

  // 작업 카드 생성
  const handleCreateTask = async (projectId: number) => {
    if (!taskTitle.trim()) {
      alert('작업 제목을 입력해 주세요.')
      return
    }

    try {
      setError('')

      const response = await fetch('/api/tasks', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          projectId,
          title: taskTitle.trim(),
          description: taskDescription.trim(),
          status: taskStatus,
        }),
      })

      if (!response.ok) {
        throw new Error('작업 카드 생성 실패')
      }

      const newTask: Task = await response.json()

      setTasks((prev) => [...prev, newTask])
      handleCancelTask()
    } catch (error) {
      console.error(error)
      setError('작업 카드 생성에 실패했습니다.')
    }
  }

  // 작업 카드 수정 시작
  const handleStartEditTask = (task: Task) => {
    setEditingTaskId(task.id)
    setEditTaskTitle(task.title)
    setEditTaskDescription(task.description ?? '')
    setError('')
  }

  // 작업 카드 수정 취소
  const handleCancelEditTask = () => {
    setEditingTaskId(null)
    setEditTaskTitle('')
    setEditTaskDescription('')
  }

  // 작업 카드 수정 저장
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
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          title: editTaskTitle.trim(),
          description: editTaskDescription.trim(),
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
    } catch (error) {
      console.error(error)
      setError('작업 카드 수정에 실패했습니다.')
    } finally {
      setSavingTaskId(null)
    }
  }

  // 작업 카드 상태 변경
  const handleUpdateTaskStatus = async (
    taskId: number,
    newStatus: string
  ) => {
    try {
      setError('')
      setUpdatingTaskId(taskId)

      const response = await fetch(
        `/api/tasks/${taskId}/status`,
        {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            status: newStatus,
          }),
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
    } catch (error) {
      console.error(error)
      setError('작업 상태 변경에 실패했습니다.')
    } finally {
      setUpdatingTaskId(null)
    }
  }

  // 작업 카드 삭제
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
    } catch (error) {
      console.error(error)
      setError('작업 카드 삭제에 실패했습니다.')
    } finally {
      setDeletingTaskId(null)
    }
  }

  // 작업 상태 한글 변환
  const getStatusLabel = (status: string) => {
    switch (status) {
      case 'TODO':
        return '할 일'
      case 'IN_PROGRESS':
        return '진행 중'
      case 'DONE':
        return '완료'
      default:
        return status
    }
  }

  // 작업 상태별 색상
  const getStatusColor = (status: string) => {
    switch (status) {
      case 'TODO':
        return '#64748b'
      case 'IN_PROGRESS':
        return '#2563eb'
      case 'DONE':
        return '#16a34a'
      default:
        return '#64748b'
    }
  }

  return (
    <div
      style={{
        padding: '40px',
        maxWidth: '800px',
        margin: '0 auto',
      }}
    >
      <h1>TeamFlow</h1>

      <h2>새 프로젝트 만들기</h2>

      <input
        type="text"
        placeholder="프로젝트 이름"
        value={name}
        onChange={(e) => setName(e.target.value)}
        style={{
          padding: '10px',
          width: '100%',
          boxSizing: 'border-box',
        }}
      />

      <textarea
        placeholder="프로젝트 설명"
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        style={{
          padding: '10px',
          width: '100%',
          marginTop: '10px',
          boxSizing: 'border-box',
        }}
      />

      <button
        onClick={handleCreateProject}
        style={{
          marginTop: '10px',
          padding: '10px 16px',
          cursor: 'pointer',
        }}
      >
        프로젝트 추가
      </button>

      {error && <p style={{ color: 'red' }}>{error}</p>}

      <h2>내 프로젝트</h2>

      {projects.length === 0 && (
        <p>아직 생성된 프로젝트가 없습니다.</p>
      )}

      {projects.map((project) => {
        const projectTasks = tasks.filter(
          (task) => task.projectId === project.id
        )

        return (
          <div
            key={project.id}
            style={{
              border: '1px solid #ddd',
              borderRadius: '10px',
              padding: '20px',
              marginBottom: '20px',
            }}
          >
            {editingId === project.id ? (
              <>
                <input
                  type="text"
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  style={{
                    padding: '10px',
                    width: '100%',
                    boxSizing: 'border-box',
                  }}
                />

                <textarea
                  value={editDescription}
                  onChange={(e) => setEditDescription(e.target.value)}
                  style={{
                    padding: '10px',
                    width: '100%',
                    marginTop: '10px',
                    boxSizing: 'border-box',
                  }}
                />

                <div style={{ marginTop: '10px' }}>
                  <button
                    onClick={() => handleUpdateProject(project.id)}
                    style={{
                      backgroundColor: '#22c55e',
                      color: 'white',
                      border: 'none',
                      borderRadius: '6px',
                      padding: '8px 14px',
                      marginRight: '8px',
                      cursor: 'pointer',
                    }}
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
                <h3>{project.name}</h3>
                <p>{project.description}</p>

                <button
                  onClick={() => handleStartEdit(project)}
                  style={{
                    backgroundColor: '#3b82f6',
                    color: 'white',
                    border: 'none',
                    borderRadius: '6px',
                    padding: '8px 14px',
                    marginRight: '8px',
                    cursor: 'pointer',
                  }}
                >
                  수정
                </button>

                <button
                  onClick={() => handleDeleteProject(project.id)}
                  style={{
                    backgroundColor: '#ef4444',
                    color: 'white',
                    border: 'none',
                    borderRadius: '6px',
                    padding: '8px 14px',
                    cursor: 'pointer',
                  }}
                >
                  삭제
                </button>
              </>
            )}

            {/* 작업 카드 목록 */}
            <div
              style={{
                marginTop: '20px',
                paddingTop: '15px',
                borderTop: '1px solid #eee',
              }}
            >
              <h4>작업 카드 ({projectTasks.length})</h4>

              {projectTasks.length === 0 && (
                <p style={{ color: '#888' }}>
                  아직 등록된 작업이 없습니다.
                </p>
              )}

              {projectTasks.map((task) => (
                <div
                  key={task.id}
                  style={{
                    backgroundColor: '#f8fafc',
                    color: '#1e293b',
                    border: '1px solid #e2e8f0',
                    borderRadius: '8px',
                    padding: '15px',
                    marginBottom: '10px',
                  }}
                >
                  {editingTaskId === task.id ? (
                    // 작업 카드 수정 모드
                    <>
                      <h4>작업 카드 수정</h4>

                      <input
                        type="text"
                        value={editTaskTitle}
                        onChange={(e) =>
                          setEditTaskTitle(e.target.value)
                        }
                        style={{
                          padding: '10px',
                          width: '100%',
                          boxSizing: 'border-box',
                        }}
                      />

                      <textarea
                        value={editTaskDescription}
                        onChange={(e) =>
                          setEditTaskDescription(e.target.value)
                        }
                        style={{
                          padding: '10px',
                          width: '100%',
                          marginTop: '10px',
                          boxSizing: 'border-box',
                        }}
                      />

                      <div style={{ marginTop: '10px' }}>
                        <button
                          onClick={() => handleUpdateTask(task.id)}
                          disabled={savingTaskId === task.id}
                          style={{
                            backgroundColor: '#22c55e',
                            color: 'white',
                            border: 'none',
                            borderRadius: '6px',
                            padding: '8px 14px',
                            marginRight: '8px',
                            cursor: 'pointer',
                          }}
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
                    // 작업 카드 일반 모드
                    <>
                      <strong>{task.title}</strong>
                      <p>{task.description}</p>

                      <div
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          gap: '10px',
                          flexWrap: 'wrap',
                        }}
                      >
                        <span
                          style={{
                            display: 'inline-block',
                            backgroundColor: getStatusColor(task.status),
                            color: 'white',
                            padding: '4px 10px',
                            borderRadius: '20px',
                            fontSize: '12px',
                          }}
                        >
                          {getStatusLabel(task.status)}
                        </span>

                        <div
                          style={{
                            display: 'flex',
                            gap: '8px',
                            alignItems: 'center',
                          }}
                        >
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
                              padding: '8px',
                              borderRadius: '6px',
                              cursor: 'pointer',
                            }}
                          >
                            <option value="TODO">할 일</option>
                            <option value="IN_PROGRESS">진행 중</option>
                            <option value="DONE">완료</option>
                          </select>

                          <button
                            onClick={() => handleStartEditTask(task)}
                            disabled={
                              updatingTaskId === task.id ||
                              deletingTaskId === task.id
                            }
                            style={{
                              backgroundColor: '#3b82f6',
                              color: 'white',
                              border: 'none',
                              borderRadius: '6px',
                              padding: '8px 12px',
                              cursor: 'pointer',
                            }}
                          >
                            수정
                          </button>

                          <button
                            onClick={() => handleDeleteTask(task.id)}
                            disabled={
                              deletingTaskId === task.id ||
                              updatingTaskId === task.id
                            }
                            style={{
                              backgroundColor: '#ef4444',
                              color: 'white',
                              border: 'none',
                              borderRadius: '6px',
                              padding: '8px 12px',
                              cursor: 'pointer',
                            }}
                          >
                            {deletingTaskId === task.id
                              ? '삭제 중...'
                              : '삭제'}
                          </button>
                        </div>
                      </div>
                    </>
                  )}
                </div>
              ))}

              {/* 작업 카드 생성 영역 */}
              {taskProjectId === project.id ? (
                <div
                  style={{
                    marginTop: '15px',
                    padding: '15px',
                    border: '1px solid #ddd',
                    borderRadius: '8px',
                  }}
                >
                  <h4>새 작업 추가</h4>

                  <input
                    type="text"
                    placeholder="작업 제목"
                    value={taskTitle}
                    onChange={(e) => setTaskTitle(e.target.value)}
                    style={{
                      padding: '10px',
                      width: '100%',
                      boxSizing: 'border-box',
                    }}
                  />

                  <textarea
                    placeholder="작업 설명"
                    value={taskDescription}
                    onChange={(e) =>
                      setTaskDescription(e.target.value)
                    }
                    style={{
                      padding: '10px',
                      width: '100%',
                      marginTop: '10px',
                      boxSizing: 'border-box',
                    }}
                  />

                  <select
                    value={taskStatus}
                    onChange={(e) => setTaskStatus(e.target.value)}
                    style={{
                      padding: '10px',
                      width: '100%',
                      marginTop: '10px',
                    }}
                  >
                    <option value="TODO">할 일</option>
                    <option value="IN_PROGRESS">진행 중</option>
                    <option value="DONE">완료</option>
                  </select>

                  <div style={{ marginTop: '10px' }}>
                    <button
                      onClick={() => handleCreateTask(project.id)}
                      style={{
                        backgroundColor: '#2563eb',
                        color: 'white',
                        border: 'none',
                        borderRadius: '6px',
                        padding: '8px 14px',
                        marginRight: '8px',
                        cursor: 'pointer',
                      }}
                    >
                      작업 추가
                    </button>

                    <button onClick={handleCancelTask}>
                      취소
                    </button>
                  </div>
                </div>
              ) : (
                <button
                  onClick={() => handleStartTask(project.id)}
                  style={{
                    marginTop: '10px',
                    padding: '10px 16px',
                    cursor: 'pointer',
                  }}
                >
                  + 새 작업 추가
                </button>
              )}
            </div>
          </div>
        )
      })}
    </div>
  )
}

export default App
