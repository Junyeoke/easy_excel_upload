import React, { useEffect, useMemo, useState } from 'react';
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

const API_URL = '/api/excel/engine';

const post = async (params) => {
  const body = new URLSearchParams();
  Object.entries(params).forEach(([k, v]) => body.append(k, v));
  const headers = { 'Content-Type': 'application/x-www-form-urlencoded' };
  const csrfToken = document.querySelector("meta[name='_csrf']")?.getAttribute('content');
  const csrfHeader = document.querySelector("meta[name='_csrf_header']")?.getAttribute('content');
  if (csrfToken && csrfHeader) headers[csrfHeader] = csrfToken;

  try {
    const res = await fetch(API_URL, { method: 'POST', headers, body });
    const txt = await res.text();
    const cleaned = txt.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, (c) =>
      `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`
    );
    return JSON.parse(cleaned);
  } catch (e) {
    return { status: 'err', msg: e.message };
  }
};

const fmt = (n) => (n ?? 0).toLocaleString();
const rate = (success, fail) => {
  const total = (success ?? 0) + (fail ?? 0);
  return total === 0 ? '0.0' : ((success / total) * 100).toFixed(1);
};
const dt = (raw) => (!raw || raw === 'null' ? '-' : raw.substring(0, 16).replace('T', ' '));
const dtShort = (raw) => (!raw || raw === 'null' ? '-' : raw.substring(5, 10));

const Stat = ({ label, value, desc }) => (
  <div className="itsm-stat">
    <div className="itsm-stat-label">{label}</div>
    <div className="itsm-stat-value">{value}</div>
    <div className="itsm-stat-desc">{desc}</div>
  </div>
);

const LightTooltip = ({ active, payload, label }) => {
  if (!active || !payload?.length) return null;
  return (
    <div className="itsm-tip">
      <div className="itsm-tip-title">{label}</div>
      {payload.map((p, i) => (
        <div key={i} className="itsm-tip-row">
          <span>{p.name}</span>
          <strong>{fmt(p.value)}</strong>
        </div>
      ))}
    </div>
  );
};

export default function ExcelDashboard() {
  const [loaders, setLoaders] = useState([]);
  const [history, setHistory] = useState([]);
  const [selected, setSelected] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [actionMsg, setActionMsg] = useState(null);
  const [loaderQuery, setLoaderQuery] = useState('');
  const [histPeriod, setHistPeriod] = useState('all');
  const [histStatus, setHistStatus] = useState('all');
  const [histKeyword, setHistKeyword] = useState('');
  const [compareHistIds, setCompareHistIds] = useState([]);
  const [compareResult, setCompareResult] = useState(null);
  const [compareModalOpen, setCompareModalOpen] = useState(false);
  const [compareLoading, setCompareLoading] = useState(false);
  const [compareDiffTypeFilter, setCompareDiffTypeFilter] = useState('all');
  const [compareSearch, setCompareSearch] = useState('');
  const [compareCollapsed, setCompareCollapsed] = useState({});

  const isTestUser = (() => {
    try {
      return opener?.$egene?._user?.emp_test_yn == 1;
    } catch {
      return false;
    }
  })();

  const loadAll = async () => {
    setLoading(true);
    setError('');
    try {
      const [listRes, histRes] = await Promise.all([
        post({ mode: 'get_list' }),
        post({
          mode: 'get_history',
          period: histPeriod,
          result_status: histStatus,
          keyword: histKeyword.trim(),
        }),
      ]);
      const loaderList = Array.isArray(listRes.list) ? listRes.list : [];
      const histList = Array.isArray(histRes.list) ? histRes.list : [];

      if (listRes.status === 'err') setError(listRes.msg || '로더 목록 조회 실패');

      setLoaders(loaderList);
      setHistory(histList);
      setSelected((prev) => loaderList.find((l) => l.upload_id === prev?.upload_id) || loaderList[0] || null);
    } catch (e) {
      setError(`데이터 로드 중 오류: ${e.message}`);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadAll();
  }, [histPeriod, histStatus, histKeyword]);

  useEffect(() => {
    setCompareHistIds([]);
    setCompareResult(null);
  }, [selected?.upload_id]);

  const filteredLoaders = useMemo(() => {
    const q = loaderQuery.trim().toLowerCase();
    if (!q) return loaders;
    return loaders.filter((l) =>
      [l.job_name || '', l.upload_id || ''].join(' ').toLowerCase().includes(q)
    );
  }, [loaders, loaderQuery]);

  const parseFailTypeJson = (raw) => {
    if (!raw || typeof raw !== 'string') return {};
    try {
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === 'object' ? parsed : {};
    } catch {
      return {};
    }
  };

  const sectionLabelMap = {
    struct_json: '구조(테이블 계층)',
    mapping_json: '컬럼 매핑',
    pre_sql_json: '사전 SQL',
    post_sql_json: '사후 SQL',
    row_sql_json: '행 단위 SQL',
  };

  const diffTypeLabelMap = {
    added: '추가',
    removed: '삭제',
    changed: '변경',
  };

  const prettyPath = (p) => (p || '').replace(/^\$\./, '').replace(/^\$/, '루트');

  const selectedHistory = useMemo(
    () => (selected
      ? history.filter((h) => {
          if (h.upload_id && selected.upload_id) return h.upload_id === selected.upload_id;
          return h.job_name === selected.job_name;
        })
      : []),
    [history, selected]
  );

  const totalSuccess = selectedHistory.reduce((a, h) => a + (h.success_cnt ?? 0), 0);
  const totalFail = selectedHistory.reduce((a, h) => a + (h.fail_cnt ?? 0), 0);
  const totalRuns = selectedHistory.length;
  const successPct = rate(totalSuccess, totalFail);

  const timelineData = [...selectedHistory]
    .slice(0, 15)
    .reverse()
    .map((h, i) => ({
      label: dtShort(h.reg_dttm) || `#${i + 1}`,
      성공: h.success_cnt ?? 0,
      실패: h.fail_cnt ?? 0,
    }));

  const ratioData = [
    { name: '성공', value: totalSuccess, color: '#16a34a' },
    { name: '실패', value: totalFail, color: '#dc2626' },
  ].filter((d) => d.value > 0);

  const topLoaderData = useMemo(
    () =>
      loaders
        .map((l) => ({
          name: (l.job_name || '-').length > 12 ? `${(l.job_name || '-').substring(0, 12)}…` : (l.job_name || '-'),
          fullName: l.job_name || '-',
          횟수: history.filter((h) => h.job_name === l.job_name).length,
        }))
        .sort((a, b) => b.횟수 - a.횟수)
        .slice(0, 8),
    [history, loaders]
  );

  const failTypeStats = useMemo(() => {
    const acc = {};
    selectedHistory.forEach((h) => {
      const map = parseFailTypeJson(h.fail_type_json);
      Object.entries(map).forEach(([k, v]) => {
        const n = Number(v) || 0;
        if (!n) return;
        acc[k] = (acc[k] || 0) + n;
      });
    });
    return Object.entries(acc)
      .map(([name, value]) => ({ name, value }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 8);
  }, [selectedHistory]);

  const loadHistoryCompare = async () => {
    if (compareHistIds.length !== 2) return;
    setCompareLoading(true);
    const [leftId, rightId] = compareHistIds;
    const res = await post({ mode: 'get_history_compare', left_hist_id: leftId, right_hist_id: rightId });
    if (res.status === 'ok') {
      setCompareResult(res);
      setCompareModalOpen(true);
      setCompareLoading(false);
      return;
    }
    setCompareLoading(false);
    notify('err', `스냅샷 비교 실패: ${res.msg || '서버 오류'}`);
  };

  const toggleCompareId = (histId) => {
    setCompareResult(null);
    setCompareModalOpen(false);
    setCompareDiffTypeFilter('all');
    setCompareSearch('');
    setCompareCollapsed({});
    setCompareHistIds((prev) => {
      if (prev.includes(histId)) return prev.filter((id) => id !== histId);
      if (prev.length >= 2) return [prev[1], histId];
      return [...prev, histId];
    });
  };

  const exportCompareCsv = () => {
    if (!compareResult?.section_diffs) return;
    const rows = [['섹션', '유형', '경로', '이전값', '이후값']];
    Object.entries(compareResult.section_diffs).forEach(([section, diff]) => {
      const sectionName = sectionLabelMap[section] || section;
      const items = Array.isArray(diff?.items) ? diff.items : [];
      items.forEach((it) => {
        const typeName = diffTypeLabelMap[it.type] || it.type;
        rows.push([sectionName, typeName, prettyPath(it.path), it.left || '', it.right || '']);
      });
    });
    const csv = rows
      .map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(','))
      .join('\n');
    const blob = new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8;' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `snapshot_diff_${Date.now()}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const notify = (type, text) => {
    setActionMsg({ type, text });
    setTimeout(() => setActionMsg(null), 3000);
  };

  const handleDeleteLoader = async (loader) => {
    if (!window.confirm(`"${loader.job_name}" 로더를 삭제하시겠습니까?\n삭제 후 복구할 수 없습니다.`)) return;
    const res = await post({ mode: 'delete', upload_id: loader.upload_id });
    if (res.status === 'ok') {
      notify('ok', `"${loader.job_name}" 삭제 완료`);
      await loadAll();
      return;
    }
    notify('err', `삭제 실패: ${res.msg || '서버 오류'}`);
  };

  const handleCloneLoader = async (loader) => {
    const res = await post({ mode: 'clone', upload_id: loader.upload_id });
    if (res.status === 'ok') {
      notify('ok', `"${loader.job_name}" 복제 완료`);
      setTimeout(() => {
        window.location.href = `?admin=true&upload_id=${res.new_upload_id}`;
      }, 1000);
      return;
    }
    notify('err', `복제 실패: ${res.msg || '서버 오류'}`);
  };

  return (
    <div className="itsm-wrap">
      <style>{`
        * { box-sizing: border-box; }
        .itsm-wrap { min-height: 100vh; background: #f4f6f8; color: #1f2937; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Apple SD Gothic Neo', 'Noto Sans KR', sans-serif; }
        .itsm-header { height: 64px; background: #fff; border-bottom: 1px solid #e5e7eb; display: flex; align-items: center; justify-content: space-between; padding: 0 20px; }
        .itsm-head-title { font-size: 18px; font-weight: 700; color: #111827; }
        .itsm-head-sub { font-size: 12px; color: #6b7280; margin-top: 2px; }
        .itsm-top-actions { display: flex; gap: 8px; align-items: center; }
        .itsm-btn { border: 1px solid #d1d5db; border-radius: 6px; background: #fff; color: #374151; height: 34px; padding: 0 12px; font-size: 12px; font-weight: 600; cursor: pointer; }
        .itsm-btn.primary { background: #2563eb; border-color: #2563eb; color: #fff; }
        .itsm-layout { height: calc(100vh - 64px); display: grid; grid-template-columns: 290px 1fr; }
        .itsm-side { border-right: 1px solid #e5e7eb; background: #fff; display: flex; flex-direction: column; }
        .itsm-side-head { padding: 14px; border-bottom: 1px solid #f0f2f4; display: flex; flex-direction: column; gap: 8px; }
        .itsm-side-title { font-size: 12px; font-weight: 700; color: #4b5563; text-transform: uppercase; letter-spacing: .04em; }
        .itsm-search { width: 100%; height: 34px; border: 1px solid #d1d5db; border-radius: 6px; padding: 0 10px; font-size: 13px; }
        .itsm-alert { margin: 10px 14px 0; border: 1px solid; border-radius: 6px; padding: 8px 10px; font-size: 12px; line-height: 1.5; }
        .itsm-alert.ok { background: #f0fdf4; border-color: #86efac; color: #166534; }
        .itsm-alert.err { background: #fef2f2; border-color: #fecaca; color: #991b1b; }
        .itsm-loader-list { overflow-y: auto; padding: 8px; display: flex; flex-direction: column; gap: 6px; }
        .itsm-loader-item { border: 1px solid #e5e7eb; border-radius: 6px; padding: 10px; cursor: pointer; background: #fff; }
        .itsm-loader-item:hover { border-color: #9ca3af; }
        .itsm-loader-item.active { border-color: #2563eb; background: #eff6ff; }
        .itsm-loader-title { font-size: 13px; font-weight: 700; color: #111827; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .itsm-loader-meta { margin-top: 3px; font-size: 11px; color: #6b7280; }
        .itsm-loader-actions { display: flex; gap: 6px; margin-top: 8px; }
        .itsm-mini-btn { flex: 1; height: 26px; border-radius: 5px; border: 1px solid #d1d5db; background: #fff; font-size: 11px; color: #374151; cursor: pointer; }
        .itsm-mini-btn.danger { color: #b91c1c; border-color: #fecaca; background: #fff5f5; }
        .itsm-main { overflow-y: auto; padding: 18px; }
        .itsm-empty { background: #fff; border: 1px solid #e5e7eb; border-radius: 8px; padding: 60px 20px; text-align: center; color: #6b7280; font-size: 14px; }
        .itsm-panel { background: #fff; border: 1px solid #e5e7eb; border-radius: 8px; padding: 14px; }
        .itsm-main-head { display: flex; align-items: flex-start; justify-content: space-between; margin-bottom: 12px; gap: 10px; }
        .itsm-main-title { font-size: 20px; font-weight: 700; color: #111827; line-height: 1.3; }
        .itsm-main-meta { margin-top: 4px; font-size: 12px; color: #6b7280; }
        .itsm-head-actions { display: flex; gap: 6px; flex-wrap: wrap; }
        .itsm-stats { display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; margin-bottom: 12px; }
        .itsm-stat { border: 1px solid #e5e7eb; border-radius: 8px; padding: 12px; background: #fff; min-height: 96px; display: flex; flex-direction: column; justify-content: space-between; }
        .itsm-stat-label { font-size: 12px; color: #6b7280; }
        .itsm-stat-value { font-size: 24px; font-weight: 700; color: #111827; line-height: 1.1; }
        .itsm-stat-desc { font-size: 12px; color: #6b7280; }
        .itsm-grid-2 { display: grid; grid-template-columns: 1fr 340px; gap: 10px; margin-bottom: 10px; }
        .itsm-chart-title { font-size: 13px; font-weight: 700; color: #374151; margin-bottom: 8px; }
        .itsm-filter-row { display: flex; gap: 8px; flex-wrap: wrap; margin-bottom: 10px; }
        .itsm-filter-select, .itsm-filter-input { height: 32px; border: 1px solid #d1d5db; border-radius: 6px; padding: 0 10px; font-size: 12px; color: #374151; background: #fff; }
        .itsm-filter-input { min-width: 180px; }
        .itsm-tip { background: #fff; border: 1px solid #d1d5db; border-radius: 6px; padding: 8px 10px; font-size: 12px; }
        .itsm-tip-title { font-weight: 700; margin-bottom: 6px; color: #111827; }
        .itsm-tip-row { display: flex; justify-content: space-between; gap: 8px; color: #4b5563; }
        .itsm-table-head { display: grid; grid-template-columns: 40px 1fr 84px 84px 110px 100px; gap: 8px; padding: 8px 0; border-bottom: 1px solid #e5e7eb; font-size: 11px; color: #6b7280; text-transform: uppercase; letter-spacing: .03em; font-weight: 700; }
        .itsm-table-body { max-height: 320px; overflow-y: auto; }
        .itsm-row { display: grid; grid-template-columns: 40px 1fr 84px 84px 110px 100px; gap: 8px; align-items: center; padding: 9px 0; border-bottom: 1px solid #f3f4f6; }
        .itsm-row.compare-on { background: #f0f9ff; }
        .itsm-compare-panel { margin-top: 10px; border: 1px solid #bfdbfe; background: #eff6ff; border-radius: 8px; padding: 10px; font-size: 12px; color: #1e3a8a; }
        .itsm-compare-badges { display: flex; gap: 6px; flex-wrap: wrap; margin-top: 8px; }
        .itsm-compare-badge { border: 1px solid #93c5fd; background: #fff; color: #1d4ed8; border-radius: 999px; padding: 2px 8px; font-size: 11px; font-weight: 700; }
        .itsm-diff-list { margin-top: 8px; max-height: 220px; overflow-y: auto; border: 1px solid #bfdbfe; border-radius: 6px; background: #fff; }
        .itsm-diff-row { display: grid; grid-template-columns: 70px 1fr 1fr; gap: 8px; padding: 6px 8px; border-bottom: 1px solid #dbeafe; font-size: 11px; color: #1f2937; }
        .itsm-diff-row:last-child { border-bottom: none; }
        .itsm-diff-type { font-weight: 700; color: #1d4ed8; text-transform: uppercase; }
        .itsm-diff-cell { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .itsm-modal-overlay { position: fixed; inset: 0; background: rgba(15,23,42,0.45); display: flex; align-items: center; justify-content: center; z-index: 3000; padding: 20px; }
        .itsm-modal { width: min(1200px, 96vw); max-height: 88vh; overflow: hidden; background: #fff; border-radius: 10px; border: 1px solid #dbeafe; display: flex; flex-direction: column; }
        .itsm-modal-head { padding: 12px 14px; border-bottom: 1px solid #e5e7eb; display: flex; align-items: center; justify-content: space-between; gap: 8px; }
        .itsm-modal-title { font-size: 15px; font-weight: 700; color: #111827; }
        .itsm-modal-body { padding: 12px 14px; overflow: auto; }
        .itsm-modal-close { height: 30px; padding: 0 10px; border: 1px solid #d1d5db; border-radius: 6px; background: #fff; color: #374151; cursor: pointer; font-size: 12px; font-weight: 700; }
        .itsm-file { font-size: 13px; color: #1f2937; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .itsm-time { margin-top: 3px; font-size: 11px; color: #6b7280; }
        .itsm-badge { display: inline-flex; justify-content: center; min-width: 58px; padding: 3px 8px; border-radius: 999px; font-size: 11px; font-weight: 700; }
        .itsm-badge.ok { background: #dcfce7; color: #166534; }
        .itsm-badge.err { background: #fee2e2; color: #991b1b; }
        .itsm-link { font-size: 12px; color: #2563eb; text-decoration: none; font-weight: 600; }
        .itsm-placeholder { color: #9ca3af; font-size: 12px; }
        @media (max-width: 1280px) {
          .itsm-layout { grid-template-columns: 250px 1fr; }
          .itsm-stats { grid-template-columns: repeat(2, 1fr); }
          .itsm-grid-2 { grid-template-columns: 1fr; }
        }
      `}</style>

      <header className="itsm-header">
        <div>
          <div className="itsm-head-title">Excel Loader 운영 대시보드</div>
          <div className="itsm-head-sub">ITSM 배치 업로드 현황 모니터링</div>
        </div>
        <div className="itsm-top-actions">
          <span style={{ fontSize: 12, color: '#6b7280' }}>로더 {fmt(loaders.length)}개 / 실행 {fmt(history.length)}회</span>
          <button className="itsm-btn primary" onClick={() => (window.location.href = '?admin=true')}>+ 새 로더</button>
        </div>
      </header>

      <section className="itsm-layout">
        <aside className="itsm-side">
          <div className="itsm-side-head">
            <div className="itsm-side-title">로더 목록</div>
            <input
              className="itsm-search"
              value={loaderQuery}
              onChange={(e) => setLoaderQuery(e.target.value)}
              placeholder="작업명 또는 ID 검색"
            />
          </div>

          {actionMsg && (
            <div className={`itsm-alert ${actionMsg.type}`}>
              {actionMsg.type === 'ok' ? '완료: ' : '오류: '}
              {actionMsg.text}
            </div>
          )}
          {error && <div className="itsm-alert err">{error}</div>}

          <div className="itsm-loader-list">
            {loading ? (
              <div className="itsm-empty" style={{ padding: 40 }}>로딩 중...</div>
            ) : filteredLoaders.length === 0 ? (
              <div className="itsm-empty" style={{ padding: 40 }}>조회된 로더가 없습니다.</div>
            ) : (
              filteredLoaders.map((loader) => {
                const runCount = history.filter((h) => h.job_name === loader.job_name).length;
                const active = selected?.upload_id === loader.upload_id;
                return (
                  <div key={loader.upload_id} className={`itsm-loader-item ${active ? 'active' : ''}`} onClick={() => setSelected(loader)}>
                    <div className="itsm-loader-title">{loader.job_name || '(이름 없음)'}</div>
                    <div className="itsm-loader-meta">실행 {fmt(runCount)}회</div>
                    <div className="itsm-loader-meta">등록 {dt(loader.reg_dttm)}</div>
                    <div className="itsm-loader-meta">ID {loader.upload_id?.substring(0, 14)}...</div>
                    <div className="itsm-loader-actions" onClick={(e) => e.stopPropagation()}>
                      <button className="itsm-mini-btn" onClick={() => handleCloneLoader(loader)}>복제</button>
                      <button className="itsm-mini-btn danger" onClick={() => handleDeleteLoader(loader)}>삭제</button>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </aside>

        <main className="itsm-main">
          {!selected ? (
            <div className="itsm-empty">좌측에서 로더를 선택하세요.</div>
          ) : (
            <>
              <div className="itsm-panel" style={{ marginBottom: 10 }}>
                <div className="itsm-main-head">
                  <div>
                    <div className="itsm-main-title">{selected.job_name || '(이름 없음)'}</div>
                    <div className="itsm-main-meta">로더 ID: {selected.upload_id}</div>
                    <div className="itsm-main-meta">최근 실행: {dt(selectedHistory[0]?.reg_dttm)}</div>
                  </div>
                  <div className="itsm-head-actions">
                    {isTestUser && (
                      <button className="itsm-btn" onClick={() => (window.location.href = `?admin=true&upload_id=${selected.upload_id}`)}>
                        설정 열기
                      </button>
                    )}
                    <button className="itsm-btn" onClick={() => (window.location.href = `?upload_id=${selected.upload_id}`)}>
                      업로드 화면
                    </button>
                  </div>
                </div>
              </div>

              <div className="itsm-stats">
                <Stat label="총 실행 횟수" value={fmt(totalRuns)} desc="선택 로더 기준" />
                <Stat label="성공 건수" value={fmt(totalSuccess)} desc="누적 성공 처리" />
                <Stat label="실패 건수" value={fmt(totalFail)} desc="오류 발생 건수" />
                <Stat label="성공률" value={`${successPct}%`} desc="성공/(성공+실패)" />
              </div>

              <div className="itsm-grid-2">
                <div className="itsm-panel">
                  <div className="itsm-chart-title">최근 실행 추이 (최대 15회)</div>
                  {timelineData.length === 0 ? (
                    <div className="itsm-empty" style={{ padding: 30 }}>이력이 없습니다.</div>
                  ) : (
                    <ResponsiveContainer width="100%" height={220}>
                      <AreaChart data={timelineData} margin={{ top: 8, right: 8, left: -20, bottom: 0 }}>
                        <defs>
                          <linearGradient id="okFill" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%" stopColor="#16a34a" stopOpacity={0.25} />
                            <stop offset="95%" stopColor="#16a34a" stopOpacity={0.02} />
                          </linearGradient>
                          <linearGradient id="errFill" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%" stopColor="#dc2626" stopOpacity={0.2} />
                            <stop offset="95%" stopColor="#dc2626" stopOpacity={0.02} />
                          </linearGradient>
                        </defs>
                        <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                        <XAxis dataKey="label" tick={{ fill: '#6b7280', fontSize: 11 }} axisLine={false} tickLine={false} />
                        <YAxis tick={{ fill: '#6b7280', fontSize: 11 }} axisLine={false} tickLine={false} />
                        <Tooltip content={<LightTooltip />} />
                        <Area type="monotone" dataKey="성공" stroke="#16a34a" strokeWidth={2} fill="url(#okFill)" />
                        <Area type="monotone" dataKey="실패" stroke="#dc2626" strokeWidth={2} fill="url(#errFill)" />
                      </AreaChart>
                    </ResponsiveContainer>
                  )}
                </div>

                <div className="itsm-panel">
                  <div className="itsm-chart-title">성공/실패 비율</div>
                  {ratioData.length === 0 ? (
                    <div className="itsm-empty" style={{ padding: 30 }}>이력이 없습니다.</div>
                  ) : (
                    <>
                      <ResponsiveContainer width="100%" height={180}>
                        <PieChart>
                          <Pie data={ratioData} dataKey="value" cx="50%" cy="50%" innerRadius={50} outerRadius={72} paddingAngle={3}>
                            {ratioData.map((d, i) => (
                              <Cell key={i} fill={d.color} />
                            ))}
                          </Pie>
                          <Tooltip formatter={(value, name) => [`${fmt(value)}건`, name]} />
                          <Legend />
                        </PieChart>
                      </ResponsiveContainer>
                      <div style={{ textAlign: 'center', marginTop: -6 }}>
                        <div style={{ fontSize: 22, fontWeight: 700 }}>{successPct}%</div>
                        <div style={{ fontSize: 12, color: '#6b7280' }}>성공률</div>
                      </div>
                    </>
                  )}
                </div>
              </div>

              <div className="itsm-panel" style={{ marginBottom: 10 }}>
                <div className="itsm-chart-title">로더별 실행 빈도 (상위 8개)</div>
                {topLoaderData.length === 0 ? (
                  <div className="itsm-empty" style={{ padding: 30 }}>데이터가 없습니다.</div>
                ) : (
                  <ResponsiveContainer width="100%" height={180}>
                    <BarChart data={topLoaderData} margin={{ top: 8, right: 8, left: -20, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                      <XAxis dataKey="name" tick={{ fill: '#6b7280', fontSize: 11 }} axisLine={false} tickLine={false} />
                      <YAxis tick={{ fill: '#6b7280', fontSize: 11 }} axisLine={false} tickLine={false} allowDecimals={false} />
                      <Tooltip formatter={(value, _n, p) => [`${value}회`, p.payload.fullName]} />
                      <Bar dataKey="횟수" radius={[4, 4, 0, 0]}>
                        {topLoaderData.map((row, i) => (
                          <Cell key={i} fill={row.fullName === selected.job_name ? '#2563eb' : '#93c5fd'} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                )}
              </div>

              <div className="itsm-panel" style={{ marginBottom: 10 }}>
                <div className="itsm-chart-title">실패 원인 통계 (유형별)</div>
                {failTypeStats.length === 0 ? (
                  <div className="itsm-empty" style={{ padding: 24 }}>실패 유형 통계 데이터가 없습니다.</div>
                ) : (
                  <ResponsiveContainer width="100%" height={180}>
                    <BarChart data={failTypeStats} margin={{ top: 8, right: 8, left: -10, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                      <XAxis dataKey="name" tick={{ fill: '#6b7280', fontSize: 11 }} axisLine={false} tickLine={false} />
                      <YAxis tick={{ fill: '#6b7280', fontSize: 11 }} axisLine={false} tickLine={false} allowDecimals={false} />
                      <Tooltip formatter={(value) => [`${fmt(value)}건`, '실패건수']} />
                      <Bar dataKey="value" radius={[4, 4, 0, 0]}>
                        {failTypeStats.map((_, i) => (
                          <Cell key={i} fill={i % 2 === 0 ? '#f97316' : '#fb923c'} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                )}
              </div>

              <div className="itsm-panel">
                <div className="itsm-chart-title">상세 실행 이력</div>
                <div className="itsm-filter-row">
                  <select className="itsm-filter-select" value={histPeriod} onChange={(e) => setHistPeriod(e.target.value)}>
                    <option value="all">전체 기간</option>
                    <option value="today">오늘</option>
                    <option value="7d">최근 7일</option>
                    <option value="30d">최근 30일</option>
                  </select>
                  <select className="itsm-filter-select" value={histStatus} onChange={(e) => setHistStatus(e.target.value)}>
                    <option value="all">전체 결과</option>
                    <option value="success">성공만</option>
                    <option value="fail">실패만</option>
                  </select>
                  <input
                    className="itsm-filter-input"
                    value={histKeyword}
                    onChange={(e) => setHistKeyword(e.target.value)}
                    placeholder="작업명/파일명 검색"
                  />
                  <button className="itsm-btn" onClick={() => { setHistPeriod('all'); setHistStatus('all'); setHistKeyword(''); }}>
                    필터 초기화
                  </button>
                  <button className="itsm-btn" onClick={loadHistoryCompare} disabled={compareHistIds.length !== 2 || compareLoading}>
                    {compareLoading ? '비교 중...' : '스냅샷 비교 보기'}
                  </button>
                </div>
                {compareHistIds.length > 0 && (
                  <div style={{ marginBottom: 8, fontSize: 12, color: '#4b5563' }}>
                    비교 선택: {compareHistIds.length}/2
                  </div>
                )}
                {selectedHistory.length === 0 ? (
                  <div className="itsm-empty" style={{ padding: 30 }}>이 로더의 실행 이력이 없습니다.</div>
                ) : (
                  <>
                    <div className="itsm-table-head">
                      <span style={{ textAlign: 'center' }}>비교</span>
                      <span>파일명 / 실행일시</span>
                      <span style={{ textAlign: 'center' }}>성공</span>
                      <span style={{ textAlign: 'center' }}>실패</span>
                      <span style={{ textAlign: 'center' }}>스냅샷</span>
                      <span style={{ textAlign: 'center' }}>오류파일</span>
                    </div>
                    <div className="itsm-table-body">
                      {selectedHistory.map((h, idx) => (
                        <div className={`itsm-row ${compareHistIds.includes(h.hist_id) ? 'compare-on' : ''}`} key={idx}>
                          <div style={{ textAlign: 'center' }}>
                            <input
                              type="checkbox"
                              checked={compareHistIds.includes(h.hist_id)}
                              onChange={() => toggleCompareId(h.hist_id)}
                            />
                          </div>
                          <div>
                            <div className="itsm-file">{h.file_name || '-'}</div>
                            <div className="itsm-time">{dt(h.reg_dttm)}</div>
                          </div>
                          <div style={{ textAlign: 'center' }}>
                            <span className="itsm-badge ok">{fmt(h.success_cnt)}</span>
                          </div>
                          <div style={{ textAlign: 'center' }}>
                            {(h.fail_cnt ?? 0) > 0 ? (
                              <span className="itsm-badge err">{fmt(h.fail_cnt)}</span>
                            ) : (
                              <span className="itsm-placeholder">0</span>
                            )}
                          </div>
                          <div style={{ textAlign: 'center', fontSize: 11, color: '#4b5563' }}>
                            {h.config_snapshot_hash ? `${String(h.config_snapshot_hash).substring(0, 10)}...` : '-'}
                          </div>
                          <div style={{ textAlign: 'center' }}>
                            {h.error_file ? (
                              <a className="itsm-link" href={`${API_URL}?mode=download_error&error_file=${h.error_file}`}>
                                다운로드
                              </a>
                            ) : (
                              <span className="itsm-placeholder">-</span>
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
        </main>
      </section>

      {compareModalOpen && compareResult && (
        <div className="itsm-modal-overlay" onClick={() => setCompareModalOpen(false)}>
          <div className="itsm-modal" onClick={(e) => e.stopPropagation()}>
            <div className="itsm-modal-head">
              <div>
                <div className="itsm-modal-title">스냅샷 비교 결과</div>
                <div style={{ fontSize: 12, color: '#6b7280', marginTop: 2 }}>
                  {compareResult.same_hash ? '두 실행의 스냅샷이 동일합니다.' : '두 실행의 스냅샷에 변경이 있습니다.'}
                </div>
              </div>
              <div style={{ display: 'flex', gap: 6 }}>
                <button className="itsm-modal-close" onClick={exportCompareCsv}>CSV 내보내기</button>
                <button className="itsm-modal-close" onClick={() => setCompareModalOpen(false)}>닫기</button>
              </div>
            </div>
            <div className="itsm-modal-body">
              <div style={{ fontSize: 12, color: '#374151', marginBottom: 10 }}>
                기준 A: {dt(compareResult.left?.reg_dttm)} / 기준 B: {dt(compareResult.right?.reg_dttm)}
              </div>
              <div style={{ display: 'flex', gap: 8, marginBottom: 10, flexWrap: 'wrap' }}>
                <select
                  value={compareDiffTypeFilter}
                  onChange={(e) => setCompareDiffTypeFilter(e.target.value)}
                  className="itsm-filter-select"
                >
                  <option value="all">전체 유형</option>
                  <option value="added">추가</option>
                  <option value="removed">삭제</option>
                  <option value="changed">변경</option>
                </select>
                <input
                  className="itsm-filter-input"
                  value={compareSearch}
                  onChange={(e) => setCompareSearch(e.target.value)}
                  placeholder="경로/값 검색"
                />
              </div>
              {(() => {
                const sec = compareResult.section_diffs || {};
                const sum = { added: 0, removed: 0, changed: 0 };
                Object.values(sec).forEach((d) => {
                  sum.added += Number(d?.added_cnt || 0);
                  sum.removed += Number(d?.removed_cnt || 0);
                  sum.changed += Number(d?.changed_cnt || 0);
                });
                return (
                  <div style={{ marginBottom: 10, fontSize: 12, color: '#334155' }}>
                    변경 요약: 추가 {sum.added}건 · 삭제 {sum.removed}건 · 변경 {sum.changed}건
                  </div>
                );
              })()}

              {(compareResult.changed_sections || []).length > 0 && (
                <div className="itsm-compare-badges" style={{ marginBottom: 10 }}>
                  {(compareResult.changed_sections || []).map((s) => (
                    <span key={s} className="itsm-compare-badge">변경 섹션: {sectionLabelMap[s] || s}</span>
                  ))}
                </div>
              )}

              {Object.entries(compareResult.section_diffs || {}).map(([section, diff]) => {
                const items = (Array.isArray(diff?.items) ? diff.items : []).filter((it) => {
                  if (compareDiffTypeFilter !== 'all' && it.type !== compareDiffTypeFilter) return false;
                  if (!compareSearch.trim()) return true;
                  const q = compareSearch.trim().toLowerCase();
                  return `${it.path || ''} ${it.left || ''} ${it.right || ''}`.toLowerCase().includes(q);
                });
                return (
                  <div key={section} style={{ marginBottom: 14 }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 6 }}>
                      <div style={{ fontWeight: 700, color: '#1e3a8a' }}>
                        {sectionLabelMap[section] || section} · 변경 {diff?.total_changes ?? 0}건
                      </div>
                      <button className="itsm-modal-close" onClick={() => setCompareCollapsed(prev => ({ ...prev, [section]: !prev[section] }))}>
                        {compareCollapsed[section] ? '펼치기' : '접기'}
                      </button>
                    </div>
                    {diff?.available === false ? (
                      <div style={{ fontSize: 12, color: '#6b7280' }}>{diff?.msg || '스냅샷 데이터 없음'}</div>
                    ) : compareCollapsed[section] ? (
                      <div style={{ fontSize: 12, color: '#6b7280' }}>접힘</div>
                    ) : items.length === 0 ? (
                      <div style={{ fontSize: 12, color: '#6b7280' }}>변경 항목이 없습니다.</div>
                    ) : (
                      <div className="itsm-diff-list">
                        <div className="itsm-diff-row" style={{ fontWeight: 700, background: '#f8fafc' }}>
                          <div>유형</div>
                          <div>변경 경로 / 이전값</div>
                          <div>이후값</div>
                        </div>
                        {items.slice(0, 120).map((it, i) => (
                          <div className="itsm-diff-row" key={`${section}_${i}`}>
                            <div className="itsm-diff-type">{diffTypeLabelMap[it.type] || it.type}</div>
                            <div className="itsm-diff-cell" title={`${prettyPath(it.path)} | ${it.left}`}>
                              {prettyPath(it.path)}: {it.left || '-'}
                            </div>
                            <div className="itsm-diff-cell" title={it.right}>
                              {it.right || '-'}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
