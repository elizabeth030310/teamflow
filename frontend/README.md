# React + TypeScript + Vite

## TeamFlow 프로젝트 문서 서식

- 193-D를 배포하려면 승인 후 `backend/db/193-d-project-page-content-format.sql`을 적용하고 백엔드와 프론트엔드를 순서대로 배포합니다. 마이그레이션은 기존 본문을 수정하지 않으며 기존 행의 형식을 `plain`으로 지정합니다. 편집 후에는 검증된 문서 구조를 `rich-v1` JSON으로 저장합니다. 193-B/C 화면은 서식 본문을 편집할 수 없으므로 배포 후 기존 탭을 새로고침합니다.
- 테스트 프로젝트의 문서 탭에서 기존 본문의 공백·줄바꿈을 확인합니다. 본문에서 ▾를 열어 블록 유형을 바꾸고, 텍스트를 선택하거나 편집 영역에 마우스를 올려 서식 도구를 확인합니다. Tab과 Enter 또는 Ctrl/⌘+B·I·U로도 서식을 적용할 수 있습니다. 입력을 멈춘 뒤 약 0.8초 후 자동 저장이 시작됩니다. 새로고침해 서식과 체크 상태를 확인합니다.
- 두 탭에서 같은 테스트 문서를 열고 한 탭의 편집이 자동 저장된 뒤 다른 탭에서 편집하면 충돌을 확인할 수 있습니다. 문서를 연 상태에서 개발자 도구로 저장 요청을 차단해 실패를 확인한 뒤, 차단을 해제하고 같은 탭을 새로고침해 초안을 확인합니다. 복원된 초안은 계속 편집하거나 Ctrl/⌘+S를 눌러 자동 저장을 다시 예약합니다.

## TeamFlow 작업 동기화

- 기본 Vite 개발 서버(HTTP/1.1)에서는 탭당 최대 두 프로젝트에 SSE를 연결하고, 나머지 프로젝트는 12초마다 작업 목록을 조회합니다. 같은 브라우저의 여러 탭이 연결 한도를 공유합니다.
- 운영에서는 브라우저에서 같은 출처의 화면과 `/api`에 HTTP/2 이상으로 접근하도록 구성하면 접근 가능한 프로젝트마다 SSE가 연결됩니다. 리버스 프록시에서 SSE 응답 버퍼링을 끄고 백엔드의 15초 하트비트보다 긴 유휴 제한을 설정합니다. 백엔드 인스턴스당 SSE 연결 한도는 128개입니다.

This template provides a minimal setup to get React working in Vite with HMR and some ESLint rules.

Currently, two official plugins are available:

- [@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react) uses [Oxc](https://oxc.rs)
- [@vitejs/plugin-react-swc](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react-swc) uses [SWC](https://swc.rs/)

## React Compiler

The React Compiler is not enabled on this template because of its impact on dev & build performances. To add it, see [this documentation](https://react.dev/learn/react-compiler/installation).

## Expanding the ESLint configuration

If you are developing a production application, we recommend updating the configuration to enable type-aware lint rules:

```js
export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      // Other configs...

      // Remove tseslint.configs.recommended and replace with this
      tseslint.configs.recommendedTypeChecked,
      // Alternatively, use this for stricter rules
      tseslint.configs.strictTypeChecked,
      // Optionally, add this for stylistic rules
      tseslint.configs.stylisticTypeChecked,

      // Other configs...
    ],
    languageOptions: {
      parserOptions: {
        project: ['./tsconfig.node.json', './tsconfig.app.json'],
        tsconfigRootDir: import.meta.dirname,
      },
      // other options...
    },
  },
])

```

You can also install [eslint-plugin-react-x](https://npmx.dev/package/eslint-plugin-react-x) and [eslint-plugin-react-dom](https://npmx.dev/package/eslint-plugin-react-dom) for React-specific lint rules:

```js
// eslint.config.js
import reactX from 'eslint-plugin-react-x'
import reactDom from 'eslint-plugin-react-dom'

export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      // Other configs...
      // Enable lint rules for React
      reactX.configs['recommended-typescript'],
      // Enable lint rules for React DOM
      reactDom.configs.recommended,
    ],
    languageOptions: {
      parserOptions: {
        project: ['./tsconfig.node.json', './tsconfig.app.json'],
        tsconfigRootDir: import.meta.dirname,
      },
      // other options...
    },
  },
])

```
