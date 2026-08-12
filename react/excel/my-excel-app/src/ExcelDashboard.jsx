import React, { useEffect, useMemo, useRef, useState } from 'react';
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
const ACTIVE_UPLOAD_STATE_KEY = 'excel_upload_active_state_v1';
const DETACHED_HEARTBEAT_STALE_MS = 9000;
const DETACHED_PROGRESS_POLL_MS = 2000;
const LOADER_PAGE_SIZE_OPTIONS = [5, 10, 20];

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
const parseAuditJson = (raw, fallback) => {
  if (!raw) return fallback;
  try { return JSON.parse(raw); } catch { return fallback; }
};

const Stat = ({ label, value, desc, tone = 'neutral' }) => (
  <div className={`itsm-stat ${tone}`}>
    <div className="itsm-stat-top">
      <div className="itsm-stat-label">{label}</div>
      <span className="itsm-stat-indicator" aria-hidden="true" />
    </div>
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
  const [loaderPage, setLoaderPage] = useState(1);
  const [loaderPageSize, setLoaderPageSize] = useState(20);
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
  const [changeModalOpen, setChangeModalOpen] = useState(false);
  const [changeLoadingId, setChangeLoadingId] = useState('');
  const [changeDetail, setChangeDetail] = useState(null);
  const [detachedUploadToast, setDetachedUploadToast] = useState(null);
  const [dismissedDetachedJobId, setDismissedDetachedJobId] = useState('');
  const [capacityAdmin, setCapacityAdmin] = useState(false);
  const [capacityModalOpen, setCapacityModalOpen] = useState(false);
  const [capacityLoading, setCapacityLoading] = useState(false);
  const [capacitySaving, setCapacitySaving] = useState(false);
  const [capacityError, setCapacityError] = useState('');
  const [capacityConfig, setCapacityConfig] = useState(null);
  const [capacityDraft, setCapacityDraft] = useState({ worker_count: 2, queue_capacity: 8 });
  const detachedPollLockRef = useRef(false);

  const isTestUser = (() => {
    try {
      return opener?.$egene?._user?.emp_test_yn == 1;
    } catch {
      return false;
    }
  })();

  const applyCapacityResponse = (res) => {
    setCapacityConfig(res);
    setCapacityDraft({
      worker_count: Number(res.worker_count) || 2,
      queue_capacity: Number(res.queue_capacity) || 8,
    });
  };

  const loadCapacityConfig = async (openModal = false) => {
    setCapacityLoading(true);
    setCapacityError('');
    try {
      const res = await post({ mode: 'get_upload_capacity' });
      const isAdmin = res.status === 'ok' && res.is_admin === true;
      setCapacityAdmin(isAdmin);
      if (isAdmin) {
        applyCapacityResponse(res);
        if (openModal) setCapacityModalOpen(true);
      } else if (openModal) {
        setCapacityError(res.msg || '관리자 권한을 확인할 수 없습니다.');
      }
    } catch (e) {
      if (openModal) setCapacityError(e.message || '설정을 불러오지 못했습니다.');
    } finally {
      setCapacityLoading(false);
    }
  };

  const saveCapacityConfig = async () => {
    setCapacitySaving(true);
    setCapacityError('');
    try {
      const res = await post({
        mode: 'save_upload_capacity',
        worker_count: String(capacityDraft.worker_count),
        queue_capacity: String(capacityDraft.queue_capacity),
      });
      if (res.status !== 'ok') {
        setCapacityError(res.msg || '설정을 저장하지 못했습니다.');
        return;
      }
      applyCapacityResponse(res);
      notify('ok', res.msg || '업로드 처리 설정을 저장했습니다.');
      setCapacityModalOpen(false);
    } catch (e) {
      setCapacityError(e.message || '설정 저장 중 오류가 발생했습니다.');
    } finally {
      setCapacitySaving(false);
    }
  };

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
    // 2026-08-12 이준혁: 서버가 확인한 관리자에게만 업로드 처리 설정 기능을 노출한다.
    loadCapacityConfig(false);
  }, []);

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

  const loaderTotalPages = Math.max(1, Math.ceil(filteredLoaders.length / loaderPageSize));
  const loaderPageStart = (loaderPage - 1) * loaderPageSize;
  const pagedLoaders = filteredLoaders.slice(loaderPageStart, loaderPageStart + loaderPageSize);
  const loaderVisibleStart = filteredLoaders.length === 0 ? 0 : loaderPageStart + 1;
  const loaderVisibleEnd = Math.min(filteredLoaders.length, loaderPageStart + loaderPageSize);

  useEffect(() => {
    setLoaderPage(1);
  }, [loaderQuery, loaderPageSize]);

  useEffect(() => {
    if (loaderPage > loaderTotalPages) setLoaderPage(loaderTotalPages);
  }, [loaderPage, loaderTotalPages]);

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
  const totalProcessed = totalSuccess + totalFail;
  const failPct = totalProcessed === 0 ? 0 : Number(((totalFail / totalProcessed) * 100).toFixed(1));
  const healthTone = totalRuns === 0 ? 'idle' : failPct >= 20 ? 'danger' : failPct > 0 ? 'warning' : 'ok';
  const healthLabel = totalRuns === 0 ? '이력 없음' : failPct >= 20 ? '점검 필요' : failPct > 0 ? '오류 발생' : '정상';

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

  const compareSelectedRows = useMemo(
    () => compareHistIds
      .map((id) => selectedHistory.find((h) => h.hist_id === id))
      .filter(Boolean),
    [compareHistIds, selectedHistory]
  );

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

  const loadChangeHistory = async (historyRow) => {
    setChangeLoadingId(historyRow.hist_id);
    const res = await post({
      mode: 'get_history_detail',
      hist_id: historyRow.hist_id,
      upload_id: historyRow.upload_id || selected?.upload_id || '',
    });
    setChangeLoadingId('');
    if (res.status !== 'ok' || !res.row) {
      notify('err', `변경 이력 조회 실패: ${res.msg || '서버 오류'}`);
      return;
    }
    setChangeDetail(res.row);
    setChangeModalOpen(true);
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

  const readSharedUploadState = () => {
    try {
      const raw = localStorage.getItem(ACTIVE_UPLOAD_STATE_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === 'object' ? parsed : null;
    } catch {
      return null;
    }
  };

  const writeSharedUploadState = (next) => {
    try {
      localStorage.setItem(ACTIVE_UPLOAD_STATE_KEY, JSON.stringify(next));
    } catch {}
  };

  const shouldShowDetachedToast = (state) => {
    if (!state?.job_id) return false;
    const status = String(state.status || '').toLowerCase();
    if (['ok', 'partial', 'err', 'cancelled', 'done'].includes(status)) return true;
    const hbTs = state.heartbeat_at ? new Date(state.heartbeat_at).getTime() : 0;
    const stale = !hbTs || (Date.now() - hbTs) > DETACHED_HEARTBEAT_STALE_MS;
    return state.uploader_alive === false || stale || status === 'detached';
  };

  const toDetachedToastView = (state) => {
    if (!state?.job_id) return null;
    const status = String(state.status || '').toLowerCase();
    const title = status === 'ok' || status === 'done'
      ? '엑셀 업로드 완료'
      : status === 'partial'
        ? '엑셀 업로드 부분 완료'
        : status === 'err'
          ? '엑셀 업로드 오류'
          : '엑셀 업로드 진행 중';
    return {
      title,
      status,
      uploadId: state.upload_id || '',
      jobName: state.job_name || '',
      fileName: state.file_name || '',
      current: Number(state.current) || 0,
      total: Number(state.total) || 0,
      percent: Math.max(0, Math.min(100, Number(state.percent) || 0)),
      lastLog: state.last_log || '',
    };
  };

  useEffect(() => {
    const syncToastState = () => {
      const state = readSharedUploadState();
      if (!shouldShowDetachedToast(state)) {
        setDetachedUploadToast(null);
        return;
      }
      if (dismissedDetachedJobId && state?.job_id === dismissedDetachedJobId) {
        setDetachedUploadToast(null);
        return;
      }
      if (dismissedDetachedJobId && state?.job_id && state.job_id !== dismissedDetachedJobId) {
        setDismissedDetachedJobId('');
      }
      setDetachedUploadToast(toDetachedToastView(state));
    };

    const onStorage = (e) => {
      if (e.key !== ACTIVE_UPLOAD_STATE_KEY) return;
      syncToastState();
    };

    syncToastState();
    window.addEventListener('storage', onStorage);
    const t = setInterval(syncToastState, 1000);
    return () => {
      window.removeEventListener('storage', onStorage);
      clearInterval(t);
    };
  }, [dismissedDetachedJobId]);

  useEffect(() => {
    const pollDetachedProgress = async () => {
      if (detachedPollLockRef.current) return;
      const state = readSharedUploadState();
      if (!state?.job_id) return;
      if (!shouldShowDetachedToast(state)) return;
      const status = String(state.status || '').toLowerCase();
      if (['ok', 'partial', 'err', 'cancelled', 'done'].includes(status)) return;

      detachedPollLockRef.current = true;
      try {
        const res = await post({ mode: 'progress', job_id: state.job_id });
        if (res.status === 'ok') {
          const logs = Array.isArray(res.logs) ? res.logs : [];
          const next = {
            ...state,
            hist_id: res.hist_id || state.hist_id || '',
            status: (Number(res.percent) || 0) >= 100 ? 'done' : 'running',
            uploader_alive: false,
            current: Number(res.current) || 0,
            total: Number(res.total) || 0,
            percent: Number(res.percent) || 0,
            last_log: logs.length ? logs[logs.length - 1] : (state.last_log || ''),
            updated_at: new Date().toISOString(),
          };
          writeSharedUploadState(next);
          setDetachedUploadToast(toDetachedToastView(next));
          return;
        }
        if (res.status === 'none') {
          const next = {
            ...state,
            status: 'done',
            uploader_alive: false,
            last_log: state.last_log || '업로드 작업이 종료되었습니다.',
            updated_at: new Date().toISOString(),
          };
          writeSharedUploadState(next);
          setDetachedUploadToast(toDetachedToastView(next));
        }
      } finally {
        detachedPollLockRef.current = false;
      }
    };

    pollDetachedProgress();
    const t = setInterval(pollDetachedProgress, DETACHED_PROGRESS_POLL_MS);
    return () => clearInterval(t);
  }, []);

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
        .itsm-wrap { min-height: 100vh; background: #eef2f5; color: #1f2937; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Apple SD Gothic Neo', 'Noto Sans KR', sans-serif; }
        .itsm-header { min-height: 68px; background: #ffffff; border-bottom: 1px solid #d8dee6; display: flex; align-items: center; justify-content: space-between; gap: 18px; padding: 12px 22px; box-shadow: 0 1px 0 rgba(15, 23, 42, 0.03); }
        .itsm-head-title { font-size: 19px; font-weight: 800; color: #0f172a; line-height: 1.25; }
        .itsm-head-sub { font-size: 12px; color: #64748b; margin-top: 3px; }
        .itsm-top-actions { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; justify-content: flex-end; }
        .itsm-count-pill { display: inline-flex; align-items: center; height: 30px; padding: 0 11px; border: 1px solid #dbe3ec; border-radius: 999px; background: #f8fafc; color: #475569; font-size: 12px; font-weight: 700; white-space: nowrap; }
        .itsm-btn { border: 1px solid #cbd5e1; border-radius: 6px; background: #fff; color: #334155; height: 34px; padding: 0 12px; font-size: 12px; font-weight: 700; cursor: pointer; transition: border-color .16s ease, box-shadow .16s ease, background .16s ease, transform .16s ease; }
        .itsm-btn:hover:not(:disabled) { border-color: #64748b; box-shadow: 0 2px 8px rgba(15, 23, 42, 0.08); }
        .itsm-btn:disabled { opacity: .55; cursor: not-allowed; }
        .itsm-btn.primary { background: #1d4ed8; border-color: #1d4ed8; color: #fff; box-shadow: 0 6px 14px rgba(29, 78, 216, .18); }
        .itsm-btn.primary:hover { background: #1e40af; border-color: #1e40af; }
        .itsm-layout { height: calc(100vh - 68px); display: grid; grid-template-columns: 304px 1fr; }
        .itsm-side { border-right: 1px solid #d8dee6; background: #fbfcfe; display: flex; flex-direction: column; min-width: 0; }
        .itsm-side-head { padding: 14px; border-bottom: 1px solid #e6ebf1; display: flex; flex-direction: column; gap: 9px; }
        .itsm-side-title { font-size: 12px; font-weight: 800; color: #334155; text-transform: uppercase; letter-spacing: .04em; }
        .itsm-search { width: 100%; height: 36px; border: 1px solid #cbd5e1; border-radius: 7px; padding: 0 11px; font-size: 13px; background: #fff; color: #0f172a; outline: none; }
        .itsm-search:focus, .itsm-filter-select:focus, .itsm-filter-input:focus { border-color: #2563eb; box-shadow: 0 0 0 3px rgba(37, 99, 235, .12); }
        .itsm-alert { margin: 10px 14px 0; border: 1px solid; border-radius: 7px; padding: 9px 10px; font-size: 12px; line-height: 1.5; font-weight: 600; }
        .itsm-alert.ok { background: #f0fdf4; border-color: #86efac; color: #166534; }
        .itsm-alert.err { background: #fef2f2; border-color: #fecaca; color: #991b1b; }
        .itsm-loader-list { overflow-y: auto; padding: 10px; display: flex; flex-direction: column; gap: 8px; }
        .itsm-loader-pager { border-top: 1px solid #e6ebf1; padding: 10px; background: #fff; display: flex; flex-direction: column; gap: 8px; }
        .itsm-loader-pager-meta { display: flex; align-items: center; justify-content: space-between; gap: 8px; font-size: 11px; color: #64748b; }
        .itsm-loader-pager-actions { display: grid; grid-template-columns: 1fr auto 1fr; align-items: center; gap: 8px; }
        .itsm-loader-page-btn { height: 30px; border: 1px solid #cbd5e1; border-radius: 6px; background: #fff; color: #334155; font-size: 11px; font-weight: 800; cursor: pointer; }
        .itsm-loader-page-btn:disabled { color: #94a3b8; background: #f8fafc; cursor: not-allowed; }
        .itsm-loader-page-now { min-width: 72px; text-align: center; color: #0f172a; font-size: 12px; font-weight: 800; }
        .itsm-loader-page-size { display: inline-flex; align-items: center; gap: 6px; white-space: nowrap; font-weight: 700; }
        .itsm-loader-page-size select { height: 28px; border: 1px solid #cbd5e1; border-radius: 6px; background: #fff; color: #334155; font-size: 11px; font-weight: 800; padding: 0 6px; outline: none; }
        .itsm-loader-page-size select:focus { border-color: #2563eb; box-shadow: 0 0 0 3px rgba(37, 99, 235, .12); }
        .itsm-loader-item { border: 1px solid #dfe6ee; border-radius: 8px; padding: 11px; cursor: pointer; background: #fff; box-shadow: 0 1px 2px rgba(15, 23, 42, 0.03); transition: border-color .16s ease, box-shadow .16s ease, background .16s ease; }
        .itsm-loader-item:hover { border-color: #94a3b8; box-shadow: 0 8px 18px rgba(15, 23, 42, 0.08); }
        .itsm-loader-item.active { border-color: #2563eb; background: #eff6ff; box-shadow: inset 3px 0 0 #2563eb, 0 8px 18px rgba(37, 99, 235, 0.10); }
        .itsm-loader-title { font-size: 13px; font-weight: 800; color: #0f172a; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .itsm-loader-meta { margin-top: 4px; font-size: 11px; color: #64748b; }
        .itsm-loader-actions { display: flex; gap: 6px; margin-top: 10px; }
        .itsm-mini-btn { flex: 1; height: 28px; border-radius: 6px; border: 1px solid #cbd5e1; background: #fff; font-size: 11px; font-weight: 700; color: #334155; cursor: pointer; }
        .itsm-mini-btn:hover { border-color: #64748b; }
        .itsm-mini-btn.danger { color: #b91c1c; border-color: #fecaca; background: #fff7f7; }
        .itsm-main { overflow-y: auto; padding: 20px; min-width: 0; }
        .itsm-empty { background: #fff; border: 1px dashed #cbd5e1; border-radius: 8px; padding: 52px 20px; text-align: center; color: #64748b; font-size: 14px; }
        .itsm-panel { background: #fff; border: 1px solid #dfe6ee; border-radius: 8px; padding: 16px; box-shadow: 0 1px 2px rgba(15, 23, 42, 0.04); }
        .itsm-hero-panel { border-top: 4px solid #1d4ed8; }
        .itsm-main-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 14px; }
        .itsm-title-row { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
        .itsm-main-title { font-size: 21px; font-weight: 800; color: #0f172a; line-height: 1.3; }
        .itsm-main-meta { margin-top: 5px; font-size: 12px; color: #64748b; }
        .itsm-health { display: inline-flex; align-items: center; height: 24px; border-radius: 999px; padding: 0 9px; font-size: 11px; font-weight: 800; border: 1px solid transparent; }
        .itsm-health.ok { background: #dcfce7; color: #166534; border-color: #bbf7d0; }
        .itsm-health.warning { background: #fff7ed; color: #9a3412; border-color: #fed7aa; }
        .itsm-health.danger { background: #fee2e2; color: #991b1b; border-color: #fecaca; }
        .itsm-health.idle { background: #f1f5f9; color: #475569; border-color: #e2e8f0; }
        .itsm-head-actions { display: flex; gap: 7px; flex-wrap: wrap; justify-content: flex-end; }
        .itsm-stats { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 12px; margin: 14px 0 12px; }
        .itsm-stat { border: 1px solid #dfe6ee; border-radius: 8px; padding: 13px; background: #fff; min-height: 104px; display: flex; flex-direction: column; justify-content: space-between; box-shadow: inset 0 3px 0 #cbd5e1; }
        .itsm-stat.success { box-shadow: inset 0 3px 0 #22c55e; }
        .itsm-stat.danger { box-shadow: inset 0 3px 0 #ef4444; }
        .itsm-stat.info { box-shadow: inset 0 3px 0 #2563eb; }
        .itsm-stat.warning { box-shadow: inset 0 3px 0 #f59e0b; }
        .itsm-stat-label { font-size: 12px; color: #64748b; font-weight: 700; }
        .itsm-stat-value { font-size: 25px; font-weight: 800; color: #0f172a; line-height: 1.1; }
        .itsm-stat-desc { font-size: 12px; color: #64748b; }
        .itsm-grid-2 { display: grid; grid-template-columns: minmax(0, 1fr) 360px; gap: 12px; margin-bottom: 12px; }
        .itsm-chart-title { font-size: 13px; font-weight: 800; color: #334155; margin-bottom: 10px; display: flex; align-items: center; gap: 8px; }
        .itsm-chart-title::before { content: ''; width: 6px; height: 18px; border-radius: 999px; background: #2563eb; display: inline-block; }
        .itsm-filter-row { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; margin-bottom: 12px; padding: 10px; border: 1px solid #e2e8f0; border-radius: 8px; background: #f8fafc; }
        .itsm-filter-select, .itsm-filter-input { height: 34px; border: 1px solid #cbd5e1; border-radius: 7px; padding: 0 10px; font-size: 12px; color: #334155; background: #fff; outline: none; }
        .itsm-filter-input { min-width: 210px; flex: 1; }
        .itsm-tip { background: #fff; border: 1px solid #cbd5e1; border-radius: 7px; padding: 8px 10px; font-size: 12px; box-shadow: 0 10px 24px rgba(15, 23, 42, 0.12); }
        .itsm-tip-title { font-weight: 700; margin-bottom: 6px; color: #111827; }
        .itsm-tip-row { display: flex; justify-content: space-between; gap: 8px; color: #4b5563; }
        .itsm-table-head { display: grid; grid-template-columns: 40px 1fr 84px 84px 110px 100px 86px; gap: 8px; padding: 9px 10px; border: 1px solid #e2e8f0; border-radius: 8px 8px 0 0; background: #f8fafc; font-size: 11px; color: #64748b; text-transform: uppercase; letter-spacing: .03em; font-weight: 800; }
        .itsm-table-body { max-height: 360px; overflow-y: auto; border: 1px solid #e2e8f0; border-top: 0; border-radius: 0 0 8px 8px; }
        .itsm-row { display: grid; grid-template-columns: 40px 1fr 84px 84px 110px 100px 86px; gap: 8px; align-items: center; padding: 10px; border-bottom: 1px solid #f1f5f9; background: #fff; }
        .itsm-row:hover { background: #f8fafc; }
        .itsm-row.compare-on { background: #f0f9ff; }
        .itsm-compare-guide { margin-bottom: 12px; border: 1px solid #bfdbfe; background: #eff6ff; border-radius: 8px; padding: 12px; font-size: 12px; color: #1e3a8a; display: flex; flex-direction: column; gap: 8px; }
        .itsm-compare-guide strong { font-size: 13px; color: #1e40af; }
        .itsm-compare-steps { display: flex; flex-wrap: wrap; gap: 8px; }
        .itsm-compare-step { display: inline-flex; align-items: center; gap: 6px; border: 1px solid #bfdbfe; background: #fff; border-radius: 999px; padding: 4px 9px; font-weight: 700; color: #1d4ed8; }
        .itsm-compare-step-num { display: inline-grid; place-items: center; width: 18px; height: 18px; border-radius: 50%; background: #2563eb; color: #fff; font-size: 10px; }
        .itsm-compare-selection { margin-bottom: 10px; display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; }
        .itsm-compare-selection-card { border: 1px solid #dbeafe; border-radius: 8px; background: #f8fbff; padding: 10px; min-height: 72px; }
        .itsm-compare-selection-label { font-size: 11px; font-weight: 800; color: #1d4ed8; margin-bottom: 4px; }
        .itsm-compare-selection-main { font-size: 12px; font-weight: 700; color: #0f172a; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .itsm-compare-selection-meta { margin-top: 3px; font-size: 11px; color: #64748b; }
        .itsm-snapshot-hash { display: inline-flex; justify-content: center; min-width: 74px; max-width: 100%; padding: 3px 7px; border-radius: 999px; background: #f1f5f9; color: #475569; font-size: 11px; font-weight: 700; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .itsm-compare-badges { display: flex; gap: 6px; flex-wrap: wrap; margin-top: 8px; }
        .itsm-compare-badge { border: 1px solid #93c5fd; background: #fff; color: #1d4ed8; border-radius: 999px; padding: 2px 8px; font-size: 11px; font-weight: 700; }
        .itsm-compare-result-note { border-radius: 8px; padding: 10px 12px; margin-bottom: 10px; font-size: 12px; font-weight: 700; }
        .itsm-compare-result-note.ok { border: 1px solid #bbf7d0; background: #f0fdf4; color: #166534; }
        .itsm-compare-result-note.warn { border: 1px solid #fed7aa; background: #fff7ed; color: #9a3412; }
        .itsm-modal-summary { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 8px; margin-bottom: 12px; }
        .itsm-modal-summary-card { border: 1px solid #e2e8f0; border-radius: 8px; padding: 10px; background: #f8fafc; }
        .itsm-modal-summary-label { font-size: 11px; color: #64748b; font-weight: 700; }
        .itsm-modal-summary-value { margin-top: 3px; font-size: 18px; color: #0f172a; font-weight: 800; }
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
        .itsm-change-list { display: flex; flex-direction: column; gap: 10px; }
        .itsm-change-card { border: 1px solid #dbeafe; border-radius: 8px; overflow: hidden; background: #fff; }
        .itsm-change-head { display: flex; justify-content: space-between; gap: 12px; padding: 9px 11px; background: #f8fafc; border-bottom: 1px solid #e2e8f0; font-size: 12px; }
        .itsm-change-meta { color: #64748b; font-size: 11px; margin-top: 3px; }
        .itsm-change-key { padding: 7px 11px; color: #475569; font-size: 11px; border-bottom: 1px solid #f1f5f9; word-break: break-all; }
        .itsm-change-row { display: grid; grid-template-columns: minmax(120px, .7fr) 1fr 28px 1fr; gap: 8px; align-items: center; padding: 8px 11px; border-bottom: 1px solid #f1f5f9; font-size: 12px; }
        .itsm-change-row:last-child { border-bottom: 0; }
        .itsm-change-column { color: #1d4ed8; font-weight: 800; word-break: break-all; }
        .itsm-change-value { padding: 5px 7px; border-radius: 5px; background: #f8fafc; color: #334155; word-break: break-all; white-space: pre-wrap; }
        .itsm-capacity-modal { width: min(620px, 94vw); }
        .itsm-capacity-grid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 8px; margin-bottom: 16px; }
        .itsm-capacity-stat { border: 1px solid #e2e8f0; border-radius: 8px; background: #f8fafc; padding: 11px; }
        .itsm-capacity-stat span { display: block; color: #64748b; font-size: 11px; font-weight: 700; }
        .itsm-capacity-stat strong { display: block; margin-top: 4px; color: #0f172a; font-size: 20px; }
        .itsm-capacity-fields { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
        .itsm-capacity-field { display: flex; flex-direction: column; gap: 6px; }
        .itsm-capacity-field label { color: #334155; font-size: 12px; font-weight: 800; }
        .itsm-capacity-field input { height: 40px; border: 1px solid #cbd5e1; border-radius: 7px; padding: 0 11px; font-size: 14px; }
        .itsm-capacity-field input:disabled { background: #f1f5f9; color: #64748b; }
        .itsm-capacity-help { margin-top: 6px; color: #64748b; font-size: 11px; line-height: 1.5; }
        .itsm-capacity-warning { margin-top: 14px; border: 1px solid #fde68a; border-radius: 7px; background: #fffbeb; color: #92400e; padding: 10px 12px; font-size: 12px; line-height: 1.5; }
        .itsm-capacity-error { margin-top: 12px; border: 1px solid #fecaca; border-radius: 7px; background: #fef2f2; color: #b91c1c; padding: 10px 12px; font-size: 12px; }
        .itsm-capacity-actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 18px; }
        .itsm-file { font-size: 13px; color: #1f2937; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .itsm-time { margin-top: 3px; font-size: 11px; color: #6b7280; }
        .itsm-history-upload-id { margin-top: 4px; display: inline-flex; max-width: 100%; align-items: center; gap: 4px; border: 1px solid #dbeafe; border-radius: 999px; background: #eff6ff; color: #1d4ed8; padding: 2px 7px; font-size: 11px; font-weight: 700; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; vertical-align: top; }
        .itsm-history-upload-id span { min-width: 0; overflow: hidden; text-overflow: ellipsis; }
        .itsm-badge { display: inline-flex; justify-content: center; min-width: 58px; padding: 3px 8px; border-radius: 999px; font-size: 11px; font-weight: 700; }
        .itsm-badge.ok { background: #dcfce7; color: #166534; }
        .itsm-badge.err { background: #fee2e2; color: #991b1b; }
        .itsm-badge.rollback { margin-top: 5px; min-width: 0; background: #fff7ed; color: #9a3412; border: 1px solid #fed7aa; }
        .itsm-badge.attempt { margin-top: 5px; min-width: 0; background: #eff6ff; color: #1d4ed8; border: 1px solid #bfdbfe; }
        .itsm-link { font-size: 12px; color: #2563eb; text-decoration: none; font-weight: 600; }
        .itsm-placeholder { color: #9ca3af; font-size: 12px; }
        .itsm-floating-progress { position: fixed; right: 20px; bottom: 20px; width: min(360px, calc(100vw - 24px)); background: #ffffff; border: 1px solid #cbd5e1; border-radius: 8px; box-shadow: 0 18px 36px rgba(15, 23, 42, 0.22); z-index: 3500; overflow: hidden; }
        .itsm-floating-progress-head { display: flex; justify-content: space-between; align-items: center; gap: 8px; padding: 10px 12px; border-bottom: 1px solid #e5e7eb; background: #f8fafc; }
        .itsm-floating-progress-title { font-size: 12px; font-weight: 700; color: #111827; }
        .itsm-floating-progress-close { border: 0; background: transparent; font-size: 14px; color: #64748b; cursor: pointer; line-height: 1; }
        .itsm-floating-progress-body { padding: 10px 12px; display: flex; flex-direction: column; gap: 6px; }
        .itsm-floating-progress-meta { font-size: 11px; color: #6b7280; }
        .itsm-floating-progress-percent { font-size: 15px; font-weight: 700; color: #111827; }
        .itsm-floating-progress-track { width: 100%; height: 8px; border-radius: 999px; background: #e5e7eb; overflow: hidden; }
        .itsm-floating-progress-fill { height: 100%; background: #2563eb; }
        .itsm-floating-progress-body.done .itsm-floating-progress-fill { background: #16a34a; }
        .itsm-floating-progress-body.err .itsm-floating-progress-fill { background: #dc2626; }
        @media (max-width: 1280px) {
          .itsm-layout { grid-template-columns: 250px 1fr; }
          .itsm-stats { grid-template-columns: repeat(2, 1fr); }
          .itsm-grid-2 { grid-template-columns: 1fr; }
        }
        @media (max-width: 860px) {
          .itsm-header { align-items: flex-start; flex-direction: column; }
          .itsm-top-actions { justify-content: flex-start; }
          .itsm-layout { height: auto; min-height: calc(100vh - 68px); grid-template-columns: 1fr; }
          .itsm-side { max-height: 320px; border-right: 0; border-bottom: 1px solid #d8dee6; }
          .itsm-main { padding: 14px; }
          .itsm-main-head { flex-direction: column; }
          .itsm-head-actions { justify-content: flex-start; }
          .itsm-stats { grid-template-columns: 1fr; }
          .itsm-compare-selection, .itsm-modal-summary { grid-template-columns: 1fr; }
          .itsm-table-head, .itsm-row { grid-template-columns: 34px minmax(160px, 1fr) 64px 64px 82px 86px 76px; min-width: 770px; }
          .itsm-table-body, .itsm-table-head { overflow: visible; }
        }
      `}</style>

      <style>{`
        :root {
          --dash-ink: #17202a;
          --dash-muted: #667085;
          --dash-line: #e4e7ec;
          --dash-soft: #f6f7f9;
          --dash-brand: #176b5b;
          --dash-brand-dark: #105247;
          --dash-brand-soft: #eaf6f2;
          --dash-coral: #dc664d;
          --dash-yellow: #e5a930;
        }
        .itsm-wrap { background: #f4f5f7; color: var(--dash-ink); }
        .itsm-header { min-height: 76px; padding: 0 28px; background: rgba(255,255,255,.96); border-bottom-color: var(--dash-line); box-shadow: none; position: relative; z-index: 5; }
        .itsm-brand { display: flex; align-items: center; gap: 12px; min-width: 0; }
        .itsm-brand-mark { width: 38px; height: 38px; flex: 0 0 auto; display: grid; place-items: center; border-radius: 8px; background: var(--dash-brand); color: #fff; font-size: 13px; font-weight: 900; letter-spacing: 0; box-shadow: 0 7px 16px rgba(23,107,91,.2); }
        .itsm-head-title { font-size: 17px; font-weight: 800; color: var(--dash-ink); letter-spacing: 0; }
        .itsm-head-sub { margin-top: 2px; color: #7b8492; font-size: 11px; }
        .itsm-count-pill { height: 34px; border-radius: 7px; background: var(--dash-soft); border-color: var(--dash-line); color: #525d6b; }
        .itsm-btn { height: 36px; border-radius: 7px; border-color: #d0d5dd; color: #344054; background: #fff; box-shadow: 0 1px 2px rgba(16,24,40,.04); }
        .itsm-btn:hover:not(:disabled) { border-color: #98a2b3; background: #fafafa; box-shadow: 0 2px 5px rgba(16,24,40,.08); transform: translateY(-1px); }
        .itsm-btn.primary { background: var(--dash-brand); border-color: var(--dash-brand); box-shadow: 0 5px 12px rgba(23,107,91,.16); }
        .itsm-btn.primary:hover { background: var(--dash-brand-dark); border-color: var(--dash-brand-dark); }
        .itsm-layout { height: calc(100vh - 76px); grid-template-columns: 300px minmax(0, 1fr); }
        .itsm-side { background: #fff; border-right-color: var(--dash-line); }
        .itsm-side-head { padding: 20px 16px 14px; border-bottom: 0; gap: 12px; }
        .itsm-side-heading { display: flex; justify-content: space-between; align-items: center; gap: 8px; }
        .itsm-side-title { color: var(--dash-ink); font-size: 13px; text-transform: none; letter-spacing: 0; }
        .itsm-side-count { min-width: 26px; height: 22px; padding: 0 7px; display: inline-grid; place-items: center; border-radius: 999px; background: var(--dash-brand-soft); color: var(--dash-brand); font-size: 11px; font-weight: 800; }
        .itsm-search-wrap { position: relative; }
        .itsm-search-wrap::before { content: ''; position: absolute; left: 12px; top: 50%; width: 12px; height: 12px; border: 1.8px solid #8b95a3; border-radius: 50%; transform: translateY(-58%); pointer-events: none; }
        .itsm-search-wrap::after { content: ''; position: absolute; left: 22px; top: 23px; width: 6px; height: 1.8px; border-radius: 2px; background: #8b95a3; transform: rotate(45deg); pointer-events: none; }
        .itsm-search { height: 40px; border-radius: 7px; border-color: #d0d5dd; background: #f9fafb; padding-left: 37px; }
        .itsm-search:focus, .itsm-filter-select:focus, .itsm-filter-input:focus { border-color: var(--dash-brand); box-shadow: 0 0 0 3px rgba(23,107,91,.12); background: #fff; }
        .itsm-loader-list { padding: 4px 10px 12px; gap: 4px; }
        .itsm-loader-item { position: relative; padding: 12px 12px 11px 14px; border: 1px solid transparent; border-radius: 7px; box-shadow: none; background: transparent; }
        .itsm-loader-item::before { content: ''; position: absolute; left: 0; top: 11px; bottom: 11px; width: 3px; border-radius: 3px; background: transparent; }
        .itsm-loader-item:hover { border-color: #e4e7ec; background: #f8f9fa; box-shadow: none; }
        .itsm-loader-item.active { border-color: #cce3dd; background: var(--dash-brand-soft); box-shadow: none; }
        .itsm-loader-item.active::before { background: var(--dash-brand); }
        .itsm-loader-title-row { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
        .itsm-loader-title { color: #27313c; font-size: 13px; }
        .itsm-loader-item.active .itsm-loader-title { color: var(--dash-brand-dark); }
        .itsm-loader-run { flex: 0 0 auto; color: #697586; font-size: 10px; font-weight: 700; }
        .itsm-loader-meta-row { display: flex; align-items: center; gap: 6px; margin-top: 7px; color: #7a8491; font-size: 10px; min-width: 0; }
        .itsm-loader-meta-row span { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .itsm-loader-meta-row i { width: 3px; height: 3px; flex: 0 0 auto; border-radius: 50%; background: #b8c0ca; }
        .itsm-loader-actions { max-height: 0; overflow: hidden; opacity: 0; margin-top: 0; transition: max-height .18s ease, opacity .18s ease, margin .18s ease; }
        .itsm-loader-item:hover .itsm-loader-actions, .itsm-loader-item.active .itsm-loader-actions { max-height: 30px; opacity: 1; margin-top: 9px; }
        .itsm-mini-btn { height: 27px; border-radius: 6px; background: rgba(255,255,255,.8); color: #475467; }
        .itsm-loader-pager { padding: 11px 12px 14px; border-top-color: var(--dash-line); }
        .itsm-loader-page-btn, .itsm-loader-page-size select { border-radius: 6px; border-color: #d0d5dd; }
        .itsm-main { padding: 24px 28px 40px; background: #f4f5f7; }
        .itsm-main > * { max-width: 1500px; margin-left: auto; margin-right: auto; }
        .itsm-panel { border-color: var(--dash-line); border-radius: 8px; box-shadow: 0 1px 2px rgba(16,24,40,.03); padding: 18px; }
        .itsm-hero-panel { position: relative; overflow: hidden; padding: 22px 24px; border-top: 1px solid var(--dash-line); background: #fff; }
        .itsm-hero-panel::before { content: ''; position: absolute; inset: 0 auto 0 0; width: 4px; background: var(--dash-brand); }
        .itsm-eyebrow { margin-bottom: 6px; color: var(--dash-brand); font-size: 10px; font-weight: 900; text-transform: uppercase; letter-spacing: .08em; }
        .itsm-main-title { font-size: 22px; color: var(--dash-ink); letter-spacing: 0; }
        .itsm-main-meta { color: #697586; }
        .itsm-health { gap: 6px; height: 26px; border-radius: 6px; padding: 0 9px; }
        .itsm-health::before { content: ''; width: 6px; height: 6px; border-radius: 50%; background: currentColor; }
        .itsm-health.ok { background: #eaf7ef; color: #177245; border-color: #cdebd9; }
        .itsm-health.warning { background: #fff7e8; color: #9a6700; border-color: #f4dfad; }
        .itsm-health.danger { background: #fff0ed; color: #b5422d; border-color: #f2d0c9; }
        .itsm-stats { gap: 10px; margin: 12px 0; }
        .itsm-stat { min-height: 116px; border-color: var(--dash-line); border-radius: 8px; padding: 15px 16px; box-shadow: none; }
        .itsm-stat-top { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
        .itsm-stat-label { color: #667085; font-size: 11px; }
        .itsm-stat-indicator { width: 8px; height: 8px; border-radius: 50%; background: #98a2b3; box-shadow: 0 0 0 4px #f2f4f7; }
        .itsm-stat.info .itsm-stat-indicator { background: #3976a8; box-shadow: 0 0 0 4px #eaf2f8; }
        .itsm-stat.success .itsm-stat-indicator { background: var(--dash-brand); box-shadow: 0 0 0 4px var(--dash-brand-soft); }
        .itsm-stat.danger .itsm-stat-indicator { background: var(--dash-coral); box-shadow: 0 0 0 4px #fff0ed; }
        .itsm-stat.warning .itsm-stat-indicator { background: var(--dash-yellow); box-shadow: 0 0 0 4px #fff7e8; }
        .itsm-stat-value { margin-top: 8px; font-size: 27px; letter-spacing: 0; }
        .itsm-stat-desc { color: #98a2b3; font-size: 10px; }
        .itsm-grid-2 { grid-template-columns: minmax(0, 1.55fr) minmax(300px, .65fr); gap: 10px; margin-bottom: 10px; }
        .itsm-chart-title { margin-bottom: 14px; color: #344054; font-size: 12px; }
        .itsm-chart-title::before { width: 3px; height: 14px; border-radius: 2px; background: var(--dash-brand); }
        .itsm-filter-row { padding: 10px 0 14px; margin-bottom: 0; border: 0; border-bottom: 1px solid #eef0f2; border-radius: 0; background: transparent; }
        .itsm-filter-select, .itsm-filter-input { border-radius: 6px; border-color: #d0d5dd; }
        .itsm-compare-guide { margin-top: 14px; border-color: #cce3dd; background: #f3faf7; color: #315f55; }
        .itsm-compare-guide strong { color: var(--dash-brand-dark); }
        .itsm-compare-step { border-color: #d5e9e4; color: var(--dash-brand); border-radius: 6px; }
        .itsm-compare-step-num { background: var(--dash-brand); }
        .itsm-table-head { background: #f7f8fa; border-color: var(--dash-line); color: #667085; letter-spacing: 0; }
        .itsm-table-body { border-color: var(--dash-line); }
        .itsm-row:hover { background: #fafbfb; }
        .itsm-row.compare-on { background: #f0f8f5; }
        .itsm-history-upload-id { border-color: #d7e9e5; background: #f1f8f6; color: var(--dash-brand); border-radius: 5px; }
        .itsm-badge { border-radius: 5px; }
        .itsm-badge.ok { background: #eaf7ef; color: #177245; }
        .itsm-badge.err { background: #fff0ed; color: #b5422d; }
        .itsm-snapshot-hash { border-radius: 5px; }
        .itsm-link { color: var(--dash-brand); }
        .itsm-empty { border-color: #d0d5dd; background: rgba(255,255,255,.7); }
        @media (max-width: 1280px) {
          .itsm-layout { grid-template-columns: 260px minmax(0, 1fr); }
          .itsm-main { padding: 20px; }
        }
        @media (max-width: 860px) {
          .itsm-header { padding: 12px 16px; min-height: 76px; }
          .itsm-layout { height: auto; }
          .itsm-side { max-height: 390px; }
          .itsm-main { padding: 14px 12px 28px; }
          .itsm-hero-panel { padding: 18px; }
          .itsm-stats { grid-template-columns: repeat(2, minmax(0, 1fr)); }
        }
        @media (max-width: 520px) {
          .itsm-top-actions { width: 100%; }
          .itsm-count-pill { display: none; }
          .itsm-top-actions .itsm-btn { flex: 1; }
          .itsm-stats { grid-template-columns: 1fr; }
        }
      `}</style>

      <header className="itsm-header">
        <div className="itsm-brand">
          <div className="itsm-brand-mark" aria-hidden="true">XL</div>
          <div>
            <div className="itsm-head-title">Excel Loader</div>
            <div className="itsm-head-sub">운영 현황과 실행 품질을 한눈에 확인하세요</div>
          </div>
        </div>
        <div className="itsm-top-actions">
          <span className="itsm-count-pill">로더 {fmt(loaders.length)}개 / 실행 {fmt(history.length)}회</span>
          {capacityAdmin && (
            <button className="itsm-btn" disabled={capacityLoading} onClick={() => loadCapacityConfig(true)}>
              ⚙ 업로드 처리 설정
            </button>
          )}
          <button className="itsm-btn primary" onClick={() => (window.location.href = '?admin=true')}>+ 새 로더</button>
        </div>
      </header>

      <section className="itsm-layout">
        <aside className="itsm-side">
          <div className="itsm-side-head">
            <div className="itsm-side-heading">
              <div className="itsm-side-title">로더 목록</div>
              <span className="itsm-side-count">{fmt(filteredLoaders.length)}</span>
            </div>
            <div className="itsm-search-wrap">
              <input
                className="itsm-search"
                value={loaderQuery}
                onChange={(e) => setLoaderQuery(e.target.value)}
                placeholder="작업명 또는 ID 검색"
              />
            </div>
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
              pagedLoaders.map((loader) => {
                const runCount = history.filter((h) => h.job_name === loader.job_name).length;
                const active = selected?.upload_id === loader.upload_id;
                return (
                  <div key={loader.upload_id} className={`itsm-loader-item ${active ? 'active' : ''}`} onClick={() => setSelected(loader)}>
                    <div className="itsm-loader-title-row">
                      <div className="itsm-loader-title">{loader.job_name || '(이름 없음)'}</div>
                      <span className="itsm-loader-run">{fmt(runCount)}회</span>
                    </div>
                    <div className="itsm-loader-meta-row">
                      <span>{dt(loader.reg_dttm)}</span>
                      <i aria-hidden="true" />
                      <span title={loader.upload_id}>ID {loader.upload_id?.substring(0, 10)}...</span>
                    </div>
                    <div className="itsm-loader-actions" onClick={(e) => e.stopPropagation()}>
                      <button className="itsm-mini-btn" onClick={() => handleCloneLoader(loader)}>복제</button>
                      {loader.can_delete === true && (
                        <button className="itsm-mini-btn danger" onClick={() => handleDeleteLoader(loader)}>삭제</button>
                      )}
                    </div>
                  </div>
                );
              })
            )}
          </div>
          {!loading && filteredLoaders.length > 0 && (
            <div className="itsm-loader-pager">
              <div className="itsm-loader-pager-meta">
                <span>{fmt(loaderVisibleStart)}-{fmt(loaderVisibleEnd)} 표시 / 전체 {fmt(filteredLoaders.length)}개</span>
                <label className="itsm-loader-page-size">
                  <span>보기</span>
                  <select
                    value={loaderPageSize}
                    onChange={(e) => setLoaderPageSize(Number(e.target.value))}
                    aria-label="로더 목록 페이지 표시 개수"
                  >
                    {LOADER_PAGE_SIZE_OPTIONS.map((size) => (
                      <option key={size} value={size}>{size}개씩</option>
                    ))}
                  </select>
                </label>
              </div>
              <div className="itsm-loader-pager-actions">
                <button
                  className="itsm-loader-page-btn"
                  onClick={() => setLoaderPage((p) => Math.max(1, p - 1))}
                  disabled={loaderPage <= 1}
                >
                  이전
                </button>
                <span className="itsm-loader-page-now">{loaderPage} / {loaderTotalPages}</span>
                <button
                  className="itsm-loader-page-btn"
                  onClick={() => setLoaderPage((p) => Math.min(loaderTotalPages, p + 1))}
                  disabled={loaderPage >= loaderTotalPages}
                >
                  다음
                </button>
              </div>
            </div>
          )}
        </aside>

        <main className="itsm-main">
          {!selected ? (
            <div className="itsm-empty">좌측에서 로더를 선택하세요.</div>
          ) : (
            <>
              <div className="itsm-panel itsm-hero-panel" style={{ marginBottom: 10 }}>
                <div className="itsm-main-head">
                  <div>
                    <div className="itsm-eyebrow">Selected loader</div>
                    <div className="itsm-title-row">
                      <div className="itsm-main-title">{selected.job_name || '(이름 없음)'}</div>
                      <span className={`itsm-health ${healthTone}`}>{healthLabel}</span>
                    </div>
                    <div className="itsm-main-meta">로더 ID: {selected.upload_id}</div>
                    <div className="itsm-main-meta">최근 실행: {dt(selectedHistory[0]?.reg_dttm)} / 실패율 {failPct}%</div>
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
                <Stat label="총 실행 횟수" value={fmt(totalRuns)} desc="선택 로더 기준" tone="info" />
                <Stat label="성공 건수" value={fmt(totalSuccess)} desc="누적 성공 처리" tone="success" />
                <Stat label="실패 건수" value={fmt(totalFail)} desc="오류 발생 건수" tone={totalFail > 0 ? 'danger' : 'neutral'} />
                <Stat label="성공률" value={`${successPct}%`} desc="성공/(성공+실패)" tone={failPct > 0 ? 'warning' : 'success'} />
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
                    {compareLoading ? '비교 중...' : '설정 변경 비교'}
                  </button>
                </div>
                <div className="itsm-compare-guide">
                  <strong>설정 변경 비교란?</strong>
                  <span>
                    서로 다른 두 실행 시점에 저장된 로더 설정을 비교합니다. 테이블 구조, 컬럼 매핑, 사전/행별/사후 SQL이 바뀌었는지 확인할 수 있습니다.
                  </span>
                  <div className="itsm-compare-steps">
                    <span className="itsm-compare-step"><span className="itsm-compare-step-num">1</span>이력 2개 선택</span>
                    <span className="itsm-compare-step"><span className="itsm-compare-step-num">2</span>설정 변경 비교 클릭</span>
                    <span className="itsm-compare-step"><span className="itsm-compare-step-num">3</span>변경 영역 확인</span>
                  </div>
                </div>
                {compareHistIds.length > 0 && (
                  <div className="itsm-compare-selection">
                    {[0, 1].map((slot) => {
                      const row = compareSelectedRows[slot];
                      return (
                        <div key={slot} className="itsm-compare-selection-card">
                          <div className="itsm-compare-selection-label">비교 기준 {slot === 0 ? 'A' : 'B'}</div>
                          {row ? (
                            <>
                              <div className="itsm-compare-selection-main">{row.file_name || '(파일명 없음)'}</div>
                              <div className="itsm-compare-selection-meta">{dt(row.reg_dttm)} / 성공 {fmt(row.success_cnt)} · 실패 {fmt(row.fail_cnt)}</div>
                              <div className="itsm-compare-selection-meta">스냅샷 {row.config_snapshot_hash ? String(row.config_snapshot_hash).substring(0, 10) : '없음'}</div>
                            </>
                          ) : (
                            <div className="itsm-compare-selection-meta">비교할 이력을 하나 더 선택하세요.</div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
                {selectedHistory.length === 0 ? (
                  <div className="itsm-empty" style={{ padding: 30 }}>이 로더의 실행 이력이 없습니다.</div>
                ) : (
                  <>
                    <div className="itsm-table-head">
                      <span style={{ textAlign: 'center' }}>비교</span>
                      <span>파일명 / 실행일시 / 로더 ID</span>
                      <span style={{ textAlign: 'center' }}>성공</span>
                      <span style={{ textAlign: 'center' }}>실패</span>
                      <span style={{ textAlign: 'center' }}>스냅샷</span>
                      <span style={{ textAlign: 'center' }}>오류파일</span>
                      <span style={{ textAlign: 'center' }}>변경이력</span>
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
                            <div className="itsm-history-upload-id" title={h.upload_id || selected.upload_id || ''}>
                              ID <span>{h.upload_id || selected.upload_id || '-'}</span>
                            </div>
                            {h.rolled_back_yn === 'Y' && <span className="itsm-badge rollback">전체 롤백</span>}
                            {h.rolled_back_yn === 'Y' && <span className="itsm-badge attempt">시도 성공 {fmt(h.attempt_success_cnt || 0)}</span>}
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
                            {h.config_snapshot_hash ? (
                              <span className="itsm-snapshot-hash" title={h.config_snapshot_hash}>
                                {String(h.config_snapshot_hash).substring(0, 10)}...
                              </span>
                            ) : (
                              <span className="itsm-placeholder">없음</span>
                            )}
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
                          <div style={{ textAlign: 'center' }}>
                            <button
                              className="itsm-modal-close"
                              disabled={changeLoadingId === h.hist_id}
                              onClick={() => loadChangeHistory(h)}
                            >
                              {changeLoadingId === h.hist_id ? '조회 중' : '보기'}
                            </button>
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

      {capacityModalOpen && capacityConfig && (
        <div className="itsm-modal-overlay" onClick={() => !capacitySaving && setCapacityModalOpen(false)}>
          <div className="itsm-modal itsm-capacity-modal" onClick={(e) => e.stopPropagation()}>
            <div className="itsm-modal-head">
              <div>
                <div className="itsm-modal-title">업로드 처리 설정</div>
                <div style={{ fontSize: 11, color: '#64748b', marginTop: 3 }}>Worker와 대기 Queue의 최대 수용량을 관리합니다.</div>
              </div>
              <button className="itsm-modal-close" disabled={capacitySaving} onClick={() => setCapacityModalOpen(false)}>닫기</button>
            </div>
            <div className="itsm-modal-body">
              <div className="itsm-capacity-grid">
                <div className="itsm-capacity-stat"><span>현재 실행</span><strong>{fmt(capacityConfig.active_workers)}</strong></div>
                <div className="itsm-capacity-stat"><span>현재 대기</span><strong>{fmt(capacityConfig.queue_size)}</strong></div>
                <div className="itsm-capacity-stat"><span>Worker</span><strong>{fmt(capacityConfig.worker_count)}</strong></div>
                <div className="itsm-capacity-stat"><span>최대 수용</span><strong>{fmt(capacityConfig.max_capacity)}</strong></div>
              </div>

              <div className="itsm-capacity-fields">
                <div className="itsm-capacity-field">
                  <label>Worker 수</label>
                  <input
                    type="number"
                    min="1"
                    max="32"
                    disabled={capacityConfig.worker_jvm_locked}
                    value={capacityDraft.worker_count}
                    onChange={(e) => setCapacityDraft((prev) => ({ ...prev, worker_count: Number(e.target.value) }))}
                  />
                  <div className="itsm-capacity-help">동시에 실행할 업로드 수 (1~32){capacityConfig.worker_jvm_locked ? ' · JVM 옵션으로 잠김' : ''}</div>
                </div>
                <div className="itsm-capacity-field">
                  <label>Queue 크기</label>
                  <input
                    type="number"
                    min="1"
                    max="100"
                    disabled={capacityConfig.queue_jvm_locked}
                    value={capacityDraft.queue_capacity}
                    onChange={(e) => setCapacityDraft((prev) => ({ ...prev, queue_capacity: Number(e.target.value) }))}
                  />
                  <div className="itsm-capacity-help">실행 전 대기할 업로드 수 (1~100){capacityConfig.queue_jvm_locked ? ' · JVM 옵션으로 잠김' : ''}</div>
                </div>
              </div>

              <div className="itsm-capacity-warning">
                실행 또는 대기 중인 업로드가 있으면 설정을 변경할 수 없습니다. JVM 옵션이 지정된 항목은 운영자 설정이 우선 적용됩니다.
              </div>
              {capacityError && <div className="itsm-capacity-error">{capacityError}</div>}

              <div className="itsm-capacity-actions">
                <button className="itsm-btn" disabled={capacitySaving} onClick={() => loadCapacityConfig(false)}>새로고침</button>
                <button
                  className="itsm-btn primary"
                  disabled={capacitySaving || Number(capacityConfig.active_workers) > 0 || Number(capacityConfig.queue_size) > 0}
                  onClick={saveCapacityConfig}
                >
                  {capacitySaving ? '저장 중...' : '저장 및 즉시 적용'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {detachedUploadToast && (
        <div className="itsm-floating-progress">
          <div className="itsm-floating-progress-head">
            <div className="itsm-floating-progress-title">{detachedUploadToast.title}</div>
            <button
              className="itsm-floating-progress-close"
              onClick={() => {
                try {
                  const state = readSharedUploadState();
                  if (state?.job_id) setDismissedDetachedJobId(state.job_id);
                } catch {}
                setDetachedUploadToast(null);
              }}
              title="닫기"
            >
              ×
            </button>
          </div>
          <div
            className={`itsm-floating-progress-body ${detachedUploadToast.status === 'err' ? 'err' : detachedUploadToast.status === 'ok' || detachedUploadToast.status === 'done' || detachedUploadToast.status === 'partial' ? 'done' : ''}`}
          >
            <div className="itsm-floating-progress-meta">
              {detachedUploadToast.jobName || detachedUploadToast.uploadId || '엑셀 업로드'}
            </div>
            {detachedUploadToast.fileName && (
              <div className="itsm-floating-progress-meta">파일: {detachedUploadToast.fileName}</div>
            )}
            <div className="itsm-floating-progress-percent">
              {detachedUploadToast.percent}% ({fmt(detachedUploadToast.current)} / {fmt(detachedUploadToast.total)})
            </div>
            <div className="itsm-floating-progress-track">
              <div className="itsm-floating-progress-fill" style={{ width: `${detachedUploadToast.percent}%` }} />
            </div>
            {detachedUploadToast.lastLog && (
              <div className="itsm-floating-progress-meta">{detachedUploadToast.lastLog}</div>
            )}
          </div>
        </div>
      )}

      {changeModalOpen && changeDetail && (
        <div className="itsm-modal-overlay" onClick={() => setChangeModalOpen(false)}>
          <div className="itsm-modal" onClick={(e) => e.stopPropagation()}>
            <div className="itsm-modal-head">
              <div>
                <div className="itsm-modal-title">UPDATE 변경 이력</div>
                <div style={{ fontSize: 12, color: '#6b7280', marginTop: 2 }}>
                  {changeDetail.file_name || '-'} · {dt(changeDetail.reg_dttm)} · {fmt(changeDetail.change_count)}건
                </div>
              </div>
              <button className="itsm-modal-close" onClick={() => setChangeModalOpen(false)}>닫기</button>
            </div>
            <div className="itsm-modal-body">
              {!Array.isArray(changeDetail.change_history) || changeDetail.change_history.length === 0 ? (
                <div className="itsm-empty" style={{ padding: 36 }}>이 실행에서 변경된 UPDATE 데이터가 없습니다.</div>
              ) : (
                <div className="itsm-change-list">
                  {changeDetail.change_history.map((item, index) => {
                    const before = parseAuditJson(item.before_json, {});
                    const after = parseAuditJson(item.after_json, {});
                    const keys = parseAuditJson(item.key_json, {});
                    const columns = parseAuditJson(item.changed_columns_json, Object.keys(after));
                    return (
                      <div className="itsm-change-card" key={item.change_id || index}>
                        <div className="itsm-change-head">
                          <div>
                            <strong>{item.table_name || '-'}</strong>
                            <div className="itsm-change-meta">엑셀 {fmt(item.excel_row_no)}행 · 수정자 {item.updated_emp_id || '-'}</div>
                          </div>
                          <div className="itsm-change-meta">{dt(String(item.updated_dttm || ''))}</div>
                        </div>
                        <div className="itsm-change-key">키: {JSON.stringify(keys)}</div>
                        {(Array.isArray(columns) ? columns : Object.keys(after)).map((column) => (
                          <div className="itsm-change-row" key={column}>
                            <div className="itsm-change-column">{column}</div>
                            <div className="itsm-change-value">{before[column] == null ? '(null)' : String(before[column])}</div>
                            <div style={{ textAlign: 'center', color: '#2563eb', fontWeight: 800 }}>→</div>
                            <div className="itsm-change-value">{after[column] == null ? '(null)' : String(after[column])}</div>
                          </div>
                        ))}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {compareModalOpen && compareResult && (
        <div className="itsm-modal-overlay" onClick={() => setCompareModalOpen(false)}>
          <div className="itsm-modal" onClick={(e) => e.stopPropagation()}>
            <div className="itsm-modal-head">
              <div>
                <div className="itsm-modal-title">설정 변경 비교 결과</div>
                <div style={{ fontSize: 12, color: '#6b7280', marginTop: 2 }}>
                  {compareResult.same_hash ? '두 실행은 같은 로더 설정으로 처리되었습니다.' : '두 실행 사이에 로더 설정 변경이 있습니다.'}
                </div>
              </div>
              <div style={{ display: 'flex', gap: 6 }}>
                <button className="itsm-modal-close" onClick={exportCompareCsv}>CSV 내보내기</button>
                <button className="itsm-modal-close" onClick={() => setCompareModalOpen(false)}>닫기</button>
              </div>
            </div>
            <div className="itsm-modal-body">
              <div className={`itsm-compare-result-note ${compareResult.same_hash ? 'ok' : 'warn'}`}>
                {compareResult.same_hash
                  ? '결과 차이가 있다면 로더 설정 변경보다 원본 엑셀 데이터나 DB 상태 차이를 먼저 확인하세요.'
                  : '변경된 설정 영역을 확인해 업로드 결과 차이가 설정 변경 때문인지 점검하세요.'}
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
                  <div className="itsm-modal-summary">
                    <div className="itsm-modal-summary-card">
                      <div className="itsm-modal-summary-label">기준 A 실행일</div>
                      <div className="itsm-modal-summary-value" style={{ fontSize: 13 }}>{dt(compareResult.left?.reg_dttm)}</div>
                    </div>
                    <div className="itsm-modal-summary-card">
                      <div className="itsm-modal-summary-label">기준 B 실행일</div>
                      <div className="itsm-modal-summary-value" style={{ fontSize: 13 }}>{dt(compareResult.right?.reg_dttm)}</div>
                    </div>
                    <div className="itsm-modal-summary-card">
                      <div className="itsm-modal-summary-label">추가/삭제</div>
                      <div className="itsm-modal-summary-value">{sum.added + sum.removed}건</div>
                    </div>
                    <div className="itsm-modal-summary-card">
                      <div className="itsm-modal-summary-label">값 변경</div>
                      <div className="itsm-modal-summary-value">{sum.changed}건</div>
                    </div>
                  </div>
                );
              })()}
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
