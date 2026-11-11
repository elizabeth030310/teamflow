
import { useEffect, useState } from 'react'

type Project = {
  id: number
  name: string
  description: string
}

function App() {
  // 프로젝트 목록
  const [projects, setProjects] = useState<Project[]>([])

  // 프로젝트 생성 입력값
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')

  // 수정 중인 프로젝트 ID
  const [editingId, setEditingId] = useState<number | null>(null)

  // 프로젝트 수정 입력값
  const [editName, setEditName] = useState('')
  const [editDescription, setEditDescription] = useState('')

  // 오류 메시지
  const [error, setError] = useState('')

  // 프로젝트 목록 조회
  useEffect(() => {
    fetch('/api/projects')
      .then((response) => {
        if (!response.ok) {
          throw new Error('프로젝트 조회 실패')
        }
        return response.json()
      })
      .then((data: Project[]) => {
        setProjects(data)
      })
      .catch((error) => {
        console.error(error)
        setError('프로젝트 목록을 불러오지 못했습니다.')
      })
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

  // 수정 모드 시작
  const handleStartEdit = (project: Project) => {
    setEditingId(project.id)
    setEditName(project.name)
    setEditDescription(project.description)
    setError('')
  }

  // 수정 취소
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

    if (!confirmed) {
      return
    }

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
    } catch (error) {
      console.error(error)
      setError('프로젝트 삭제에 실패했습니다.')
    }
  }

  return (
    <div
      style={{
        padding: '40px',
        maxWidth: '700px',
        margin: '0 auto',
      }}
    >
      <h1>TeamFlow</h1>

      {/* 프로젝트 생성 */}
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

      {/* 오류 메시지 */}
      {error && <p style={{ color: 'red' }}>{error}</p>}

      {/* 프로젝트 목록 */}
      <h2>내 프로젝트</h2>

      {projects.length === 0 && (
        <p>아직 생성된 프로젝트가 없습니다.</p>
      )}

      {projects.map((project) => (
        <div
          key={project.id}
          style={{
            border: '1px solid #ddd',
            borderRadius: '10px',
            padding: '20px',
            marginBottom: '15px',
          }}
        >
          {editingId === project.id ? (
            // 수정 모드
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

                <button
                  onClick={handleCancelEdit}
                  style={{
                    padding: '8px 14px',
                    cursor: 'pointer',
                  }}
                >
                  취소
                </button>
              </div>
            </>
          ) : (
            // 일반 모드
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
        </div>
      ))}
    </div>
  )
}

export default App
