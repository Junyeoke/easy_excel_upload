import React, { useState, useEffect, useCallback } from 'react';
import {
  AreaChart, Area, BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, Cell, PieChart, Pie, Legend
} from 'recharts';

const API_URL = "/api/excel/engine";

// ── 공통 fetch 래퍼 (form-urlencoded 방식 - 멀티파트 파싱 오류 방지) ──
const post = async (params) => {
  const body = new URLSearchParams();
  Object.entries(params).forEach(([k, v]) => body.append(k, v));
  const headers = { 'Content-Type': 'application/x-www-form-urlencoded' };
  const csrfToken  = document.querySelector("meta[name='_csrf']")?.getAttribute("content");
  const csrfHeader = document.querySelector("meta[name='_csrf_header']")?.getAttribute("content");
  if (csrfToken && csrfHeader) headers[csrfHeader] = csrfToken;
  try {
    const res = await fetch(API_URL, { method: 'POST', headers, body });
    const txt = await res.text();
    const cleaned = txt.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, (c) =>
      '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0')
    );
    return JSON.parse(cleaned);
  } catch (e) {
    console.error('[Dashboard] fetch/JSON 오류:', e);
    return { status: 'err', msg: e.message };
  }
};

// ── 숫자 포맷 ─────────────────────────────────────────────────
const fmt = (n) => (n ?? 0).toLocaleString();
const pct = (s, f) => { const t = (s ?? 0) + (f ?? 0); return t === 0 ? '0' : ((s / t) * 100).toFixed(1); };

// ── 날짜 포맷 ─────────────────────────────────────────────────
const fmtDate = (str) => {
  if (!str || str === 'null') return '-';
  return str.substring(0, 16).replace('T', ' ');
};
const fmtDateShort = (str) => {
  if (!str || str === 'null') return '';
  return str.substring(5, 10); // MM-DD
};

// ── 커스텀 툴팁 ───────────────────────────────────────────────
const CustomTooltip = ({ active, payload, label }) => {
  if (!active || !payload?.length) return null;
  return (
    <div style={{
      background: '#0D1B2A', border: '1px solid #1E3A5F',
      borderRadius: '8px', padding: '10px 14px', fontSize: '0.8rem'
    }}>
      <div style={{ color: '#64B5F6', marginBottom: '6px', fontWeight: 700 }}>{label}</div>
      {payload.map((p, i) => (
        <div key={i} style={{ color: p.color, display: 'flex', gap: '8px', justifyContent: 'space-between' }}>
          <span>{p.name}</span><span style={{ fontWeight: 700 }}>{fmt(p.value)}</span>
        </div>
      ))}
    </div>
  );
};

// ── 통계 카드 ─────────────────────────────────────────────────
const StatCard = ({ label, value, sub, color, icon }) => (
  <div style={{
    background: 'linear-gradient(135deg, #0D1B2A 0%, #112233 100%)',
    border: `1px solid ${color}33`, borderRadius: '12px',
    padding: '20px 24px', position: 'relative', overflow: 'hidden'
  }}>
    <div style={{
      position: 'absolute', right: '-10px', top: '-10px',
      fontSize: '4rem', opacity: 0.07, userSelect: 'none'
    }}>{icon}</div>
    <div style={{ fontSize: '0.72rem', color: '#64748b', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: '8px' }}>{label}</div>
    <div style={{ fontSize: '2rem', fontWeight: 800, color, fontFamily: "'IBM Plex Mono', monospace", lineHeight: 1 }}>{value}</div>
    {sub && <div style={{ fontSize: '0.75rem', color: '#475569', marginTop: '6px' }}>{sub}</div>}
  </div>
);

// ══════════════════════════════════════════════════════════════
// 메인 대시보드 컴포넌트
// ══════════════════════════════════════════════════════════════
export default function ExcelDashboard() {
  const [loaders, setLoaders]     = useState([]);
  const [history, setHistory]     = useState([]);
  const [selected, setSelected]   = useState(null);
  const [loading, setLoading]     = useState(true);
  const [error, setError]         = useState(null);
  const [actionMsg, setActionMsg] = useState(null); // { type: 'ok'|'err', text: string }

  // ── 테스트 사용자 여부 (emp_test_yn === 1 이면 설정 열기 버튼 표시) ──
  const isTestUser = (() => {
    try { return opener?.$egene?._user?.emp_test_yn == 1; }
    catch { return false; }
  })();

  // ── 초기 데이터 로드 ────────────────────────────────────────
  useEffect(() => {
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const [listRes, histRes] = await Promise.all([
          post({ mode: 'get_list' }),
          post({ mode: 'get_history' }),
        ]);

        if (listRes.status === 'err') {
          setError('로더 목록을 불러오는데 실패했습니다: ' + (listRes.msg || '서버 오류'));
        }

        const loaderList = Array.isArray(listRes.list) ? listRes.list : [];
        const histList   = Array.isArray(histRes.list) ? histRes.list : [];
        setLoaders(loaderList);
        setHistory(histList);
        if (loaderList.length > 0) setSelected(loaderList[0]);
      } catch (e) {
        console.error('[Dashboard] 초기 로드 오류:', e);
        setError('데이터 로드 중 오류가 발생했습니다: ' + e.message);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  // ── 선택된 로더의 이력 필터링 ───────────────────────────────
  const filteredHistory = selected
    ? history.filter(h => h.job_name === selected.job_name)
    : [];

  // ── 통계 계산 ───────────────────────────────────────────────
  const totalSuccess = filteredHistory.reduce((a, h) => a + (h.success_cnt ?? 0), 0);
  const totalFail    = filteredHistory.reduce((a, h) => a + (h.fail_cnt    ?? 0), 0);
  const totalRuns    = filteredHistory.length;
  const successRate  = pct(totalSuccess, totalFail);
  const lastRun      = filteredHistory[0]?.reg_dttm ?? null;

  // ── 차트 데이터 ─────────────────────────────────────────────
  const timelineData = [...filteredHistory]
    .slice(0, 15).reverse()
    .map((h, i) => ({
      name: fmtDateShort(h.reg_dttm) || `#${i + 1}`,
      성공: h.success_cnt ?? 0,
      실패: h.fail_cnt ?? 0,
    }));

  const pieData = [
    { name: '성공', value: totalSuccess, color: '#10B981' },
    { name: '실패', value: totalFail,    color: '#EF4444' },
  ].filter(d => d.value > 0);

  const loaderBarData = loaders.map(l => ({
    name: l.job_name?.length > 10 ? l.job_name.substring(0, 10) + '…' : (l.job_name ?? '-'),
    fullName: l.job_name,
    횟수: history.filter(h => h.job_name === l.job_name).length,
  })).sort((a, b) => b.횟수 - a.횟수).slice(0, 8);

  const handleDeleteLoader = async (loader) => {
    if (!window.confirm(`"${loader.job_name}" 로더를 삭제하시겠습니까?\n삭제 후 복구할 수 없습니다.`)) return;
    setActionMsg(null);
    const res = await post({ mode: 'delete', upload_id: loader.upload_id });
    if (res.status === 'ok') {
      const newLoaders = loaders.filter(l => l.upload_id !== loader.upload_id);
      setLoaders(newLoaders);
      setSelected(newLoaders.length > 0 ? newLoaders[0] : null);
      setActionMsg({ type: 'ok', text: `"${loader.job_name}" 삭제 완료` });
    } else {
      setActionMsg({ type: 'err', text: '삭제 실패: ' + (res.msg || '서버 오류') });
    }
    setTimeout(() => setActionMsg(null), 3000);
  };

  const handleCloneLoader = async (loader) => {
    setActionMsg(null);
    const res = await post({ mode: 'clone', upload_id: loader.upload_id });
    if (res.status === 'ok') {
      setActionMsg({ type: 'ok', text: `"${loader.job_name}" 복제 완료! 편집 화면으로 이동합니다.` });
      setTimeout(() => { window.location.href = `?admin=true&upload_id=${res.new_upload_id}`; }, 1500);
    } else {
      setActionMsg({ type: 'err', text: '복제 실패: ' + (res.msg || '서버 오류') });
      setTimeout(() => setActionMsg(null), 3000);
    }
  };

  const goToLoader = (loader) => {
    window.location.href = `?admin=true&upload_id=${loader.upload_id}`;
  };

  const goToUpload = (loader) => {
    window.location.href = `?upload_id=${loader.upload_id}`;
  };

  const cardStyle = {
    background: 'linear-gradient(135deg, #0D1B2A 0%, #0F2236 100%)',
    border: '1px solid #1E3A5F',
    borderRadius: '14px',
    padding: '20px 24px',
  };

  return (
    <div style={{
      minHeight: '100vh',
      background: '#060D17',
      color: '#CBD5E1',
      fontFamily: "'DM Sans', 'Noto Sans KR', sans-serif",
      padding: '0',
    }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700;800&family=IBM+Plex+Mono:wght@400;600;700&family=Noto+Sans+KR:wght@400;500;700&display=swap');
        * { box-sizing: border-box; }
        .loader-card {
          cursor: pointer; border-radius: 10px; padding: 14px 18px;
          border: 1px solid transparent; transition: all 0.18s ease;
          background: transparent; text-align: left; width: 100%;
        }
        .loader-card:hover { background: #0D1B2A; border-color: #1E3A5F; }
        .loader-card.active { background: #0F2A47; border-color: #1976D2; box-shadow: 0 0 0 1px #1976D222; }
        .loader-card .loader-name { font-size: 0.88rem; font-weight: 700; color: #E2E8F0; margin-bottom: 4px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .loader-card.active .loader-name { color: #64B5F6; }
        .loader-card .loader-meta { font-size: 0.72rem; color: #475569; }
        .hist-row { display: grid; grid-template-columns: 1fr 80px 80px 100px; gap: 8px; padding: 10px 0; border-bottom: 1px solid #1E3A5F22; align-items: center; font-size: 0.82rem; }
        .hist-row:last-child { border-bottom: none; }
        .badge-success { background: #10B98122; color: #10B981; border: 1px solid #10B98133; padding: 2px 8px; border-radius: 20px; font-size: 0.72rem; font-weight: 700; font-family: 'IBM Plex Mono', monospace; }
        .badge-fail { background: #EF444422; color: #EF4444; border: 1px solid #EF444433; padding: 2px 8px; border-radius: 20px; font-size: 0.72rem; font-weight: 700; font-family: 'IBM Plex Mono', monospace; }
        .go-btn { background: none; border: 1px solid #1976D2; color: #64B5F6; border-radius: 6px; padding: 3px 10px; font-size: 0.72rem; cursor: pointer; font-family: inherit; transition: all 0.15s; }
        .go-btn:hover { background: #1976D2; color: white; }
        .section-title { font-size: 0.7rem; letter-spacing: 0.12em; text-transform: uppercase; color: #475569; font-weight: 700; margin-bottom: 14px; display: flex; align-items: center; gap: 8px; }
        .section-title::after { content: ''; flex: 1; height: 1px; background: #1E3A5F; }
        ::-webkit-scrollbar { width: 4px; height: 4px; }
        ::-webkit-scrollbar-track { background: transparent; }
        ::-webkit-scrollbar-thumb { background: #1E3A5F; border-radius: 4px; }
      `}</style>

      {/* ── 헤더 ── */}
      <div style={{ borderBottom: '1px solid #1E3A5F', padding: '16px 32px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: '#08111C' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
          <div style={{ width: '36px', height: '36px', background: 'linear-gradient(135deg, #1976D2, #0D47A1)', borderRadius: '8px', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '1.1rem', boxShadow: '0 0 16px #1976D244' }}>📊</div>
          <div>
            <div style={{ fontSize: '1.1rem', fontWeight: 800, color: '#E2E8F0', letterSpacing: '-0.3px' }}>Excel Loader Dashboard</div>
            <div style={{ fontSize: '0.72rem', color: '#475569', marginTop: '1px' }}>업로드 현황 모니터링</div>
          </div>
        </div>
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
          <span style={{ fontSize: '0.72rem', color: '#475569' }}>로더 {loaders.length}개 · 총 {history.length}회 실행</span>
          <button onClick={() => window.location.href = '?admin=true'} style={{ background: '#1976D2', color: 'white', border: 'none', borderRadius: '7px', padding: '7px 16px', fontSize: '0.8rem', fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>+ 새 로더 생성</button>
        </div>
      </div>

      {/* ── 본문 레이아웃 ── */}
      <div style={{ display: 'flex', height: 'calc(100vh - 69px)' }}>

        {/* ── 좌측 사이드바 ── */}
        <div style={{ width: '260px', flexShrink: 0, borderRight: '1px solid #1E3A5F', overflowY: 'auto', background: '#08111C', padding: '20px 12px' }}>
          <div className="section-title">로더 목록</div>

          {/* 액션 메시지 배너 */}
          {actionMsg && (
            <div style={{ background: actionMsg.type === 'ok' ? '#0A2A1A' : '#1A0A0A', border: `1px solid ${actionMsg.type === 'ok' ? '#10B98144' : '#EF444444'}`, borderRadius: '8px', padding: '8px 12px', marginBottom: '10px', fontSize: '0.75rem', color: actionMsg.type === 'ok' ? '#10B981' : '#EF4444', lineHeight: 1.5 }}>
              {actionMsg.type === 'ok' ? '✅ ' : '❌ '}{actionMsg.text}
            </div>
          )}

          {/* 에러 배너 */}
          {error && (
            <div style={{ background: '#1A0A0A', border: '1px solid #EF444444', borderRadius: '8px', padding: '10px 12px', marginBottom: '12px', fontSize: '0.75rem', color: '#EF4444', lineHeight: 1.5 }}>
              ⚠️ {error}
              <div style={{ marginTop: '6px' }}>
                <button onClick={() => window.location.reload()} style={{ background: '#EF4444', color: 'white', border: 'none', borderRadius: '5px', padding: '3px 10px', fontSize: '0.7rem', cursor: 'pointer', fontFamily: 'inherit' }}>새로고침</button>
              </div>
            </div>
          )}

          {loading ? (
            <div style={{ color: '#475569', fontSize: '0.8rem', textAlign: 'center', padding: '30px 0' }}>
              <div style={{ fontSize: '1.5rem', marginBottom: '8px', opacity: 0.5 }}>⏳</div>
              로딩 중...
            </div>
          ) : loaders.length === 0 ? (
            <div style={{ color: '#475569', fontSize: '0.8rem', textAlign: 'center', padding: '30px 0' }}>
              <div style={{ fontSize: '1.5rem', marginBottom: '8px', opacity: 0.3 }}>📂</div>
              등록된 로더가 없습니다.
              <div style={{ marginTop: '10px' }}>
                <button onClick={() => window.location.href = '?admin=true'} style={{ background: '#1976D2', color: 'white', border: 'none', borderRadius: '6px', padding: '6px 12px', fontSize: '0.72rem', cursor: 'pointer', fontFamily: 'inherit', fontWeight: 600 }}>+ 새 로더 생성</button>
              </div>
            </div>
          ) : loaders.map(loader => {
            const runCount = history.filter(h => h.job_name === loader.job_name).length;
            const isActive = selected?.upload_id === loader.upload_id;
            return (
              <button key={loader.upload_id} className={`loader-card ${isActive ? 'active' : ''}`} onClick={() => setSelected(loader)}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '6px' }}>
                  <div className="loader-name">{loader.job_name || '(이름 없음)'}</div>
                  {runCount > 0 && (
                    <span style={{ background: '#1E3A5F', color: '#64B5F6', fontSize: '0.65rem', fontWeight: 700, padding: '1px 6px', borderRadius: '10px', flexShrink: 0, fontFamily: 'IBM Plex Mono, monospace' }}>{runCount}</span>
                  )}
                </div>
                <div className="loader-meta">ID: {loader.upload_id?.substring(0, 12)}…</div>
                <div className="loader-meta" style={{ marginTop: '2px' }}>{fmtDate(loader.reg_dttm)}</div>
                {/* 복제 / 삭제 버튼 — 호버 시 표시 */}
                <div className="loader-actions" style={{ display: 'flex', gap: '4px', marginTop: '8px' }} onClick={e => e.stopPropagation()}>
                  <button
                    onClick={() => handleCloneLoader(loader)}
                    style={{ flex: 1, padding: '3px 0', borderRadius: '5px', border: '1px solid #1E3A5F', background: 'transparent', color: '#64B5F6', fontSize: '0.68rem', cursor: 'pointer', fontFamily: 'inherit', fontWeight: 600, transition: 'all 0.15s' }}
                    onMouseEnter={e => { e.currentTarget.style.background = '#1E3A5F'; }}
                    onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; }}
                  >📋 복제</button>
                  <button
                    onClick={() => handleDeleteLoader(loader)}
                    style={{ flex: 1, padding: '3px 0', borderRadius: '5px', border: '1px solid #3A1E1E', background: 'transparent', color: '#EF4444', fontSize: '0.68rem', cursor: 'pointer', fontFamily: 'inherit', fontWeight: 600, transition: 'all 0.15s' }}
                    onMouseEnter={e => { e.currentTarget.style.background = '#3A1E1E'; }}
                    onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; }}
                  >🗑️ 삭제</button>
                </div>
              </button>
            );
          })}
        </div>

        {/* ── 우측 메인 ── */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '28px 32px' }}>
          {!selected ? (
            <div style={{ textAlign: 'center', padding: '80px 0', color: '#475569' }}>
              <div style={{ fontSize: '3rem', marginBottom: '12px', opacity: 0.3 }}>📂</div>
              <div>좌측에서 로더를 선택하세요.</div>
            </div>
          ) : (
            <>
              {/* 로더 헤더 */}
              <div style={{ marginBottom: '28px', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
                    <div style={{ fontSize: '1.7rem', fontWeight: 800, color: '#E2E8F0', letterSpacing: '-0.5px', lineHeight: 1.2 }}>
                      {selected.job_name || '(이름 없음)'}
                    </div>
                    {/* 설정 열기 버튼 — emp_test_yn === 1 인 경우에만 표시 */}
                    {isTestUser && (
                      <button
                        onClick={() => goToLoader(selected)}
                        style={{ background: 'none', border: '1px solid #1976D2', borderRadius: '6px', padding: '4px 12px', cursor: 'pointer', color: '#1976D2', fontSize: '0.85rem', fontWeight: 600, fontFamily: 'inherit', transition: 'all 0.15s', display: 'flex', alignItems: 'center', gap: '4px' }}
                        onMouseEnter={e => { e.currentTarget.style.background = '#1976D2'; e.currentTarget.style.color = 'white'; }}
                        onMouseLeave={e => { e.currentTarget.style.background = 'none'; e.currentTarget.style.color = '#1976D2'; }}
                      >
                        ⚙ 설정 열기
                      </button>
                    )}
                    {/* 업로드 화면 버튼 */}
                    <button
                      onClick={() => goToUpload(selected)}
                      style={{ background: 'none', border: '1px solid #10B981', borderRadius: '6px', padding: '4px 12px', cursor: 'pointer', color: '#10B981', fontSize: '0.85rem', fontWeight: 600, fontFamily: 'inherit', transition: 'all 0.15s', display: 'flex', alignItems: 'center', gap: '4px' }}
                      onMouseEnter={e => { e.currentTarget.style.background = '#10B981'; e.currentTarget.style.color = 'white'; }}
                      onMouseLeave={e => { e.currentTarget.style.background = 'none'; e.currentTarget.style.color = '#10B981'; }}
                    >
                      📤 업로드 화면
                    </button>
                  </div>
                  <div style={{ fontSize: '0.78rem', color: '#475569', marginTop: '6px', fontFamily: 'IBM Plex Mono, monospace' }}>ID: {selected.upload_id}</div>
                </div>
                <div style={{ fontSize: '0.75rem', color: '#475569', textAlign: 'right' }}>
                  <div>최근 실행</div>
                  <div style={{ color: '#94A3B8', fontFamily: 'IBM Plex Mono, monospace', marginTop: '2px' }}>{fmtDate(lastRun) || '없음'}</div>
                </div>
              </div>

              {/* 통계 카드 4개 */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '14px', marginBottom: '24px' }}>
                <StatCard label="총 실행 횟수"  value={fmt(totalRuns)}    sub="업로드 시도"           color="#64B5F6" icon="🔄" />
                <StatCard label="성공 건수"     value={fmt(totalSuccess)} sub="누적 처리 완료"        color="#10B981" icon="✅" />
                <StatCard label="실패 건수"     value={fmt(totalFail)}    sub="오류 발생"            color="#EF4444" icon="❌" />
                <StatCard label="성공률"        value={`${successRate}%`} sub={`${totalRuns}회 기준`} color="#F59E0B" icon="📈" />
              </div>

              {/* 차트 2열 */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 300px', gap: '16px', marginBottom: '20px' }}>
                <div style={cardStyle}>
                  <div className="section-title">최근 업로드 추이 (최대 15회)</div>
                  {timelineData.length === 0 ? (
                    <div style={{ textAlign: 'center', color: '#475569', padding: '40px 0', fontSize: '0.85rem' }}>업로드 이력이 없습니다.</div>
                  ) : (
                    <ResponsiveContainer width="100%" height={200}>
                      <AreaChart data={timelineData} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
                        <defs>
                          <linearGradient id="gSuccess" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%"  stopColor="#10B981" stopOpacity={0.3} />
                            <stop offset="95%" stopColor="#10B981" stopOpacity={0} />
                          </linearGradient>
                          <linearGradient id="gFail" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%"  stopColor="#EF4444" stopOpacity={0.3} />
                            <stop offset="95%" stopColor="#EF4444" stopOpacity={0} />
                          </linearGradient>
                        </defs>
                        <CartesianGrid strokeDasharray="3 3" stroke="#1E3A5F" />
                        <XAxis dataKey="name" tick={{ fill: '#475569', fontSize: 11 }} axisLine={false} tickLine={false} />
                        <YAxis tick={{ fill: '#475569', fontSize: 11 }} axisLine={false} tickLine={false} />
                        <Tooltip content={<CustomTooltip />} />
                        <Area type="monotone" dataKey="성공" stroke="#10B981" fill="url(#gSuccess)" strokeWidth={2} />
                        <Area type="monotone" dataKey="실패" stroke="#EF4444" fill="url(#gFail)"    strokeWidth={2} />
                      </AreaChart>
                    </ResponsiveContainer>
                  )}
                </div>
                <div style={{ ...cardStyle, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
                  <div className="section-title" style={{ width: '100%' }}>성공 / 실패 비율</div>
                  {pieData.length === 0 ? (
                    <div style={{ textAlign: 'center', color: '#475569', padding: '30px 0', fontSize: '0.85rem' }}>데이터 없음</div>
                  ) : (
                    <ResponsiveContainer width="100%" height={180}>
                      <PieChart>
                        <Pie data={pieData} cx="50%" cy="50%" innerRadius={52} outerRadius={78} paddingAngle={3} dataKey="value">
                          {pieData.map((entry, index) => <Cell key={index} fill={entry.color} />)}
                        </Pie>
                        <Tooltip formatter={(value, name) => [fmt(value) + '건', name]} contentStyle={{ background: '#0D1B2A', border: '1px solid #1E3A5F', borderRadius: '8px', fontSize: '0.8rem' }} itemStyle={{ color: '#CBD5E1' }} />
                        <Legend formatter={(value) => <span style={{ color: '#94A3B8', fontSize: '0.78rem' }}>{value}</span>} />
                      </PieChart>
                    </ResponsiveContainer>
                  )}
                  {pieData.length > 0 && (
                    <div style={{ textAlign: 'center', marginTop: '-8px' }}>
                      <div style={{ fontSize: '1.6rem', fontWeight: 800, color: '#10B981', fontFamily: 'IBM Plex Mono, monospace' }}>{successRate}%</div>
                      <div style={{ fontSize: '0.72rem', color: '#475569' }}>성공률</div>
                    </div>
                  )}
                </div>
              </div>

              {/* 로더별 실행 횟수 바 차트 */}
              <div style={{ ...cardStyle, marginBottom: '20px' }}>
                <div className="section-title">로더별 총 실행 횟수</div>
                {loaderBarData.length === 0 ? (
                  <div style={{ textAlign: 'center', color: '#475569', padding: '30px 0', fontSize: '0.85rem' }}>데이터 없음</div>
                ) : (
                  <ResponsiveContainer width="100%" height={160}>
                    <BarChart data={loaderBarData} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#1E3A5F" />
                      <XAxis dataKey="name" tick={{ fill: '#475569', fontSize: 11 }} axisLine={false} tickLine={false} />
                      <YAxis tick={{ fill: '#475569', fontSize: 11 }} axisLine={false} tickLine={false} allowDecimals={false} />
                      <Tooltip formatter={(value, name, props) => [value + '회', props.payload.fullName]} contentStyle={{ background: '#0D1B2A', border: '1px solid #1E3A5F', borderRadius: '8px', fontSize: '0.8rem' }} itemStyle={{ color: '#CBD5E1' }} />
                      <Bar dataKey="횟수" radius={[4, 4, 0, 0]}>
                        {loaderBarData.map((entry, index) => <Cell key={index} fill={entry.fullName === selected?.job_name ? '#1976D2' : '#1E3A5F'} />)}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                )}
              </div>

              {/* 상세 이력 테이블 */}
              <div style={cardStyle}>
                <div className="section-title">상세 업로드 이력</div>
                {filteredHistory.length === 0 ? (
                  <div style={{ textAlign: 'center', color: '#475569', padding: '30px 0', fontSize: '0.85rem' }}>이 로더의 업로드 이력이 없습니다.</div>
                ) : (
                  <>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 80px 80px 100px', gap: '8px', padding: '6px 0 10px', borderBottom: '1px solid #1E3A5F', fontSize: '0.68rem', color: '#475569', textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 700 }}>
                      <span>파일명 · 실행일시</span>
                      <span style={{ textAlign: 'center' }}>성공</span>
                      <span style={{ textAlign: 'center' }}>실패</span>
                      <span style={{ textAlign: 'center' }}>오류 리포트</span>
                    </div>
                    <div style={{ maxHeight: '300px', overflowY: 'auto' }}>
                      {filteredHistory.map((h, i) => (
                        <div key={i} className="hist-row">
                          <div>
                            <div style={{ fontSize: '0.82rem', color: '#CBD5E1', fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{h.file_name || '-'}</div>
                            <div style={{ fontSize: '0.7rem', color: '#475569', marginTop: '2px', fontFamily: 'IBM Plex Mono, monospace' }}>{fmtDate(h.reg_dttm)}</div>
                          </div>
                          <div style={{ textAlign: 'center' }}><span className="badge-success">{fmt(h.success_cnt)}</span></div>
                          <div style={{ textAlign: 'center' }}>
                            {(h.fail_cnt ?? 0) > 0
                              ? <span className="badge-fail">{fmt(h.fail_cnt)}</span>
                              : <span style={{ color: '#475569', fontSize: '0.75rem' }}>0</span>
                            }
                          </div>
                          <div style={{ textAlign: 'center' }}>
                            {h.error_file ? (
                              <a href={`${API_URL}?mode=download_error&error_file=${h.error_file}`} style={{ color: '#F59E0B', fontSize: '0.72rem', textDecoration: 'none', fontWeight: 700 }}>📥 다운로드</a>
                            ) : (
                              <span style={{ color: '#1E3A5F', fontSize: '0.72rem' }}>—</span>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  </>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}