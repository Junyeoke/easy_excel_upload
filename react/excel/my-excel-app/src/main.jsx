import React from 'react'
import ReactDOM from 'react-dom/client'
import ExcelApp from './ExcelApp.jsx'
import ExcelDashboard from './ExcelDashboard.jsx'
import './App.css'

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
    <Root />
  </React.StrictMode>,
)
