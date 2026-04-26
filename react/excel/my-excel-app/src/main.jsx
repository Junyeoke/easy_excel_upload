import React, { lazy, Suspense } from 'react'
import ReactDOM from 'react-dom/client'
import './App.css'

const ExcelApp = lazy(() => import('./ExcelApp.jsx'))
const ExcelDashboard = lazy(() => import('./ExcelDashboard.jsx'))

/**
 * URL 파라미터 기반 라우팅
 *
 *  ?view=dashboard              → 대시보드 (로더 목록 + 통계 시각화)
 *  ?admin=true                  → ExcelApp 관리자 모드 (신규 로더 생성)
 *  ?admin=true&upload_id=xxx    → ExcelApp 관리자 모드 (기존 로더 수정)
 *  ?upload_id=xxx               → ExcelApp 일반 사용자 모드 (업로드 실행)
 *  (파라미터 없음)               → ExcelApp 일반 사용자 모드
 */
const params = new URLSearchParams(window.location.search)
const view   = params.get('view')

const Root = view === 'dashboard' ? ExcelDashboard : ExcelApp

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <Suspense fallback={<div style={{ padding: '24px', fontSize: '14px', color: '#475569' }}>화면을 불러오는 중...</div>}>
      <Root />
    </Suspense>
  </React.StrictMode>,
)
