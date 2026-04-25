import React, { useState, useEffect, useRef } from 'react';
import Select from 'react-select';
import { ToastContainer, toast } from 'react-toastify';
import 'react-toastify/dist/ReactToastify.css';
import Swal from 'sweetalert2';
import './App.css';

import CodeMirror from '@uiw/react-codemirror';
import { sql } from '@codemirror/lang-sql';

const API_URL = "/api/excel/engine";

// ─────────────────────────────────────────────
// 공통 서브 컴포넌트
// ─────────────────────────────────────────────

const SqlEditor = ({ title, sqls, setSqls, tooltip }) => (
  <div style={{ marginBottom: '20px' }}>
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
      <span style={{ fontWeight: 700, fontSize: '0.9rem', color: '#1e293b', display: 'flex', alignItems: 'center', gap: '6px' }}>
        {title}
        <span title={tooltip} style={{ cursor: 'help', background: '#cbd5e1', color: 'white', borderRadius: '50%', width: '16px', height: '16px', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: '10px' }}>?</span>
      </span>
      <button className="btn btn-mini btn-add" onClick={() => setSqls([...sqls, { sql: '' }])}>+ 추가</button>
    </div>
    {sqls.map((s, i) => (
      <div key={i} style={{ display: 'flex', gap: '8px', marginBottom: '10px', alignItems: 'flex-start' }}>
        <div style={{ flex: 1, border: '1px solid #e2e8f0', borderRadius: '8px', overflow: 'hidden' }}>
          <CodeMirror value={s.sql} height="100px" extensions={[sql()]}
            onChange={v => { const n = [...sqls]; n[i].sql = v; setSqls(n); }}
            placeholder="SQL 문을 작성하세요..." style={{ fontSize: '0.85rem' }} />
        </div>
        <button className="btn btn-mini btn-del" onClick={() => setSqls(sqls.filter((_, idx) => idx !== i))} style={{ height: '32px' }}>삭제</button>
      </div>
    ))}
  </div>
);

const MySelect = ({ options = [], value, onChange, placeholder, isDisabled }) => {
  const fmt = options.map(o => typeof o === 'string' ? { value: o, label: o } : o);
  const sel = fmt.find(o => o.value === value) || null;
  return (
    <Select options={fmt} value={sel} onChange={o => onChange(o ? o.value : null)}
      placeholder={placeholder} isClearable isDisabled={isDisabled} menuPortalTarget={document.body}
      styles={{ menuPortal: b => ({ ...b, zIndex: 9999 }), control: b => ({ ...b, minHeight: '40px', borderRadius: '8px', borderColor: '#e2e8f0', fontSize: '0.88rem', boxShadow: 'none', '&:hover': { borderColor: '#6366f1' } }) }} />
  );
};

const MyMultiSelect = ({ options = [], value = [], onChange, placeholder, isDisabled }) => {
  const fmt = options.map(o => typeof o === 'string' ? { value: o, label: o } : o);
  const sel = fmt.filter(o => (value || []).includes(o.value));
  return (
    <Select isMulti options={fmt} value={sel} onChange={opts => onChange(opts ? opts.map(o => o.value) : [])}
      placeholder={placeholder} isClearable isDisabled={isDisabled} menuPortalTarget={document.body}
      styles={{ menuPortal: b => ({ ...b, zIndex: 9999 }), control: b => ({ ...b, minHeight: '40px', borderRadius: '8px', borderColor: '#e2e8f0', fontSize: '0.88rem', boxShadow: 'none', '&:hover': { borderColor: '#f59e0b' } }), multiValue: b => ({ ...b, background: '#fef3c7', borderRadius: '4px' }), multiValueLabel: b => ({ ...b, color: '#92400e', fontWeight: 600 }) }} />
  );
};

// ─────────────────────────────────────────────
// 스텝 인디케이터
// ─────────────────────────────────────────────
const StepIndicator = ({ steps, current }) => (
  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: '40px', padding: '0 20px' }}>
    {steps.map((s, i) => {
      const isDone = i < current;
      const isActive = i === current;
      return (
        <React.Fragment key={i}>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '8px', minWidth: '80px' }}>
            <div style={{
              width: '40px', height: '40px', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '1rem', fontWeight: 700, transition: 'all 0.3s',
              background: isDone ? '#10b981' : isActive ? '#6366f1' : '#f1f5f9',
              color: isDone || isActive ? 'white' : '#94a3b8',
              boxShadow: isActive ? '0 0 0 4px rgba(99,102,241,0.15)' : 'none',
              border: isDone ? '2px solid #10b981' : isActive ? '2px solid #6366f1' : '2px solid #e2e8f0',
            }}>
              {isDone ? '✓' : i + 1}
            </div>
            <span style={{ fontSize: '0.72rem', fontWeight: isActive ? 700 : 500, color: isActive ? '#6366f1' : isDone ? '#10b981' : '#94a3b8', textAlign: 'center', whiteSpace: 'nowrap' }}>
              {s}
            </span>
          </div>
          {i < steps.length - 1 && (
            <div style={{ flex: 1, height: '2px', margin: '0 4px', marginBottom: '22px', background: isDone ? '#10b981' : '#e2e8f0', transition: 'background 0.3s' }} />
          )}
        </React.Fragment>
      );
    })}
  </div>
);

// ─────────────────────────────────────────────
// 메인 컴포넌트
// ─────────────────────────────────────────────
function ExcelApp() {
  const queryParams = new URLSearchParams(window.location.search);
  const isAdmin = queryParams.get('admin') === 'true';

  const adminSteps = ['기본 설정', '테이블 구조', '컬럼 매핑', '저장 완료'];
  const userSteps  = ['안내 확인', '파일 선택 및 업로드'];
  const steps = isAdmin ? adminSteps : userSteps;

  const [currentStep, setCurrentStep] = useState(0);
  const [tableList, setTableList] = useState([]);
  const [colsCache, setColsCache] = useState({});
  const [uploadId, setUploadId] = useState('');
  const [jobName, setJobName] = useState('');
  const [headerRow, setHeaderRow] = useState(1);
  const [structs, setStructs] = useState([{ alias: 'ROOT', table: '', pk_col: '', parent: '', fk: '', ent_id: '', upsert_keys: [] }]);
  const [activeAlias, setActiveAlias] = useState('ROOT');
  const [mapping, setMapping] = useState({ ROOT: {} });
  const [preSqls, setPreSqls] = useState([{ sql: '' }]);
  const [postSqls, setPostSqls] = useState([{ sql: '' }]);
  const [rowSqls, setRowSqls] = useState([{ sql: '' }]);
  const [searchTerm, setSearchTerm] = useState('');
  const [file, setFile] = useState(null);
  const [excelHeaders, setExcelHeaders] = useState([]);
  const [previewData, setPreviewData] = useState([]);
  const [totalRows, setTotalRows] = useState(0);
  const [previewPage, setPreviewPage] = useState(1);
  const [previewTotalPages, setPreviewTotalPages] = useState(1);
  const [previewPageSize] = useState(20);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [editedCells, setEditedCells] = useState({});
  const [failedRows, setFailedRows] = useState({}); // { '3': '오류메시지', ... }
  const [uploading, setUploading] = useState(false);
  const [showOnlyFailedRows, setShowOnlyFailedRows] = useState(false);
  const [selectedErrorRow, setSelectedErrorRow] = useState(null);
  const [showDetailedUploadLogs, setShowDetailedUploadLogs] = useState(false);
  const [debugDetailEnabled, setDebugDetailEnabled] = useState(false);
  const [debugRowLimit, setDebugRowLimit] = useState(20);
  const MAPPING_PAGE_SIZE = 10;
  const [mappingPage, setMappingPage] = useState(1);
  const [progress, setProgress] = useState({ current: 0, total: 0, percent: 0 });
  const [historyList, setHistoryList] = useState([]);
  const [uploadLogs, setUploadLogsRaw] = useState([]);
  const setUploadLogs = (updater) => {
    setUploadLogsRaw(prev => {
      const next = typeof updater === 'function' ? updater(prev) : updater;
      uploadLogsRef.current = next;
      return next;
    });
  };
  const [uploadResult, setUploadResult] = useState(null);
  const logEndRef = useRef(null);
  const esRef     = useRef(null);  // SSE EventSource 참조 (cleanup용)
  const uploadLogsRef = useRef([]); // 로그 실시간 참조용
  const sseCompletedRef = useRef(false); // SSE done 수신 여부 추적 (JEUS 타임아웃 대응)
  const [isDragging, setIsDragging] = useState(false);
  const [sampleFile, setSampleFile] = useState(null);
  const [sampleFileName, setSampleFileName] = useState('');
  const [sampleFileDownloadName, setSampleFileDownloadName] = useState('');
  const [instructions, setInstructions] = useState('');
  const [loaderList, setLoaderList] = useState([]);
  const [showLoaderPanel, setShowLoaderPanel] = useState(false);
  const [loaderPanelLoading, setLoaderPanelLoading] = useState(false);

  const formatFileSize = b => !b ? '' : b < 1024 ? b + ' B' : b < 1024*1024 ? (b/1024).toFixed(1)+' KB' : (b/(1024*1024)).toFixed(2)+' MB';
  const encodeSafeBase64 = str => btoa(encodeURIComponent(str || '').replace(/%([0-9A-F]{2})/g, (m, p1) => String.fromCharCode('0x' + p1)));

  const post = async (url, formData) => {
    const headers = {};
    const tok = document.querySelector("meta[name='_csrf']")?.getAttribute('content');
    const hdr = document.querySelector("meta[name='_csrf_header']")?.getAttribute('content');
    if (tok && hdr) headers[hdr] = tok;
    try {
      const res = await fetch(url, { method: 'POST', headers, body: formData });
      const txt = await res.text();
      try { return JSON.parse(txt); }
      catch { console.error('서버 원본 에러:', txt); return { status: 'err', msg: `[HTTP ${res.status}] 서버 오류 — F12 Console 확인` }; }
    } catch { return { status: 'err', msg: '네트워크 오류' }; }
  };

  const getParams = obj => { const fd = new FormData(); for (const k in obj) if (obj[k] !== undefined && obj[k] !== null) fd.append(k, obj[k]); return fd; };
  const safeJsonParse = (str, fb) => { if (!str || str.trim() === '' || str.trim() === 'null') return fb; try { return JSON.parse(str); } catch { return fb; } };

  useEffect(() => { if (logEndRef.current) logEndRef.current.scrollIntoView({ behavior: 'smooth' }); }, [uploadLogs]);
  useEffect(() => { setMappingPage(1); }, [searchTerm, activeAlias]);

  useEffect(() => {
    if (isAdmin) post(API_URL, getParams({ mode: 'get_tables' })).then(d => setTableList(Array.isArray(d) ? d : []));
    const uId = new URLSearchParams(window.location.search).get('upload_id');
    if (uId) loadConfiguration(uId);
    loadHistory();
  }, []);

  const loadHistory = async () => { const res = await post(API_URL, getParams({ mode: 'get_history' })); if (res.status === 'ok') setHistoryList(res.list || []); };

  const loadLoaderList = async () => {
    setLoaderPanelLoading(true);
    const res = await post(API_URL, getParams({ mode: 'get_list' }));
    if (res.status === 'ok') setLoaderList(res.list || []);
    setLoaderPanelLoading(false);
  };

  const handleDeleteLoader = async (id, name) => {
    if (!window.confirm(`"${name}" 로더를 삭제하시겠습니까?\n삭제 후 복구할 수 없습니다.`)) return;
    const tid = toast.loading('삭제 중...');
    const res = await post(API_URL, getParams({ mode: 'delete', upload_id: id }));
    if (res.status === 'ok') {
      toast.update(tid, { render: '✅ 삭제 완료', type: 'success', isLoading: false, autoClose: 2000 });
      if (uploadId === id) { setTimeout(() => { window.location.href = window.location.pathname + '?admin=true'; }, 1500); }
      await loadLoaderList();
    } else {
      toast.update(tid, { render: '❌ ' + (res.msg || '삭제 실패'), type: 'error', isLoading: false, autoClose: 3000 });
    }
  };

  const handleCloneLoader = async (id, name) => {
    const tid = toast.loading(`"${name}" 복제 중...`);
    const res = await post(API_URL, getParams({ mode: 'clone', upload_id: id }));
    if (res.status === 'ok') {
      toast.update(tid, { render: '✅ 복제 완료! 새 로더로 이동합니다.', type: 'success', isLoading: false, autoClose: 2000 });
      setTimeout(() => { window.location.href = `?admin=true&upload_id=${res.new_upload_id}`; }, 1500);
    } else {
      toast.update(tid, { render: '❌ ' + (res.msg || '복제 실패'), type: 'error', isLoading: false, autoClose: 3000 });
    }
  };

  const loadConfiguration = async id => {
    const tid = toast.loading('설정을 불러오는 중...');
    try {
      const res = await post(API_URL, getParams({ mode: 'get_detail', upload_id: id }));
      if (res.status === 'ok') {
        setUploadId(id); setJobName(res.job_name || ''); setHeaderRow(res.header_row || 1);
        const s = safeJsonParse(res.struct_json, [{ alias: 'ROOT', table: '', pk_col: '', parent: '', fk: '', ent_id: '', upsert_keys: [] }]);
        const m = safeJsonParse(res.mapping_json, { ROOT: {} });
        setStructs(s); setMapping(m);
        setPreSqls(safeJsonParse(res.pre_sql_json, [{ sql: '' }]));
        setPostSqls(safeJsonParse(res.post_sql_json, [{ sql: '' }]));
        setRowSqls(safeJsonParse(res.row_sql_json, [{ sql: '' }]));
        setSampleFileName(res.sample_file_name || '');
        setSampleFileDownloadName(res.sample_file_org_name || '');
        setInstructions(res.instructions || '');
        await Promise.all(s.map(item => item.table ? loadCols(item.table) : Promise.resolve()));
        toast.update(tid, { render: '✅ 로드 완료', type: 'success', isLoading: false, autoClose: 2000 });
      } else toast.update(tid, { render: '❌ ' + (res.msg || '실패'), type: 'error', isLoading: false, autoClose: 3000 });
    } catch(e) { toast.update(tid, { render: '❌ ' + e.message, type: 'error', isLoading: false, autoClose: 3000 }); }
  };

  const loadCols = async tbl => {
    if (!tbl) return [];
    const d = await post(API_URL, getParams({ mode: 'get_columns', table_name: tbl }));
    const cols = Array.isArray(d) ? d : [];
    setColsCache(prev => ({ ...prev, [tbl]: cols }));
    return cols;
  };

  const handleSave = async () => {
    const tid = toast.loading('💾 저장 중...');
    const fd = new FormData();
    fd.append('mode', 'save'); fd.append('upload_id', uploadId); fd.append('job_name', jobName); fd.append('header_row', headerRow);
    fd.append('struct_json_b64', encodeSafeBase64(JSON.stringify(structs)));
    fd.append('mapping_json_b64', encodeSafeBase64(JSON.stringify(mapping)));
    fd.append('pre_sql_json_b64', encodeSafeBase64(JSON.stringify(preSqls)));
    fd.append('post_sql_json_b64', encodeSafeBase64(JSON.stringify(postSqls)));
    fd.append('row_sql_json_b64', encodeSafeBase64(JSON.stringify(rowSqls)));
    fd.append('instructions_b64', encodeSafeBase64(instructions));
    if (sampleFile) fd.append('sample_file', sampleFile);
    if (sampleFileDownloadName?.trim()) fd.append('sample_file_download_name', sampleFileDownloadName.trim());
    try {
      const res = await post(API_URL, fd);
      if (res.status === 'ok') {
        setUploadId(res.upload_id);
        if (sampleFile) { setSampleFileName(sampleFile.name); setSampleFile(null); }
        toast.update(tid, { render: '💾 저장 완료!', type: 'success', isLoading: false, autoClose: 2000 });
        return true;
      } else { toast.update(tid, { render: '❌ ' + res.msg, type: 'error', isLoading: false, autoClose: 3000 }); return false; }
    } catch { toast.update(tid, { render: '❌ 서버 오류', type: 'error', isLoading: false, autoClose: 3000 }); return false; }
  };

  const fetchPreviewPage = (f, page, hr, tid) => {
    setPreviewLoading(true);
    const fd = new FormData();
    fd.append('mode', 'preview'); fd.append('file', f); fd.append('header_row', hr || headerRow);
    fd.append('page', page); fd.append('page_size', previewPageSize);
    post(API_URL, fd).then(res => {
      setPreviewLoading(false);
      if (res.status === 'ok') {
        setExcelHeaders(res.headers.map((h, i) => ({ value: String(i), label: h })));
        setPreviewData(res.preview); setTotalRows(res.total_rows ?? 0);
        setPreviewTotalPages(res.total_pages ?? 1); setPreviewPage(res.page ?? 1);
        if (tid) toast.update(tid, { render: '✅ 로드 완료', type: 'success', isLoading: false, autoClose: 2000 });
      } else if (tid) toast.update(tid, { render: '❌ ' + res.msg, type: 'error', isLoading: false, autoClose: 3000 });
    }).catch(() => { setPreviewLoading(false); if (tid) toast.update(tid, { render: '❌ 서버 오류', type: 'error', isLoading: false, autoClose: 3000 }); });
  };

  const processSelectedFile = f => {
    if (!f) return;
    setFile(f); setEditedCells({}); setPreviewPage(1);
    fetchPreviewPage(f, 1, headerRow, toast.loading('엑셀 파일 분석 중...'));
  };

  const downloadSampleFile = () => {
    if (!uploadId) { Swal.fire({ icon: 'warning', title: '알림', text: '설정을 먼저 저장해주세요.', confirmButtonColor: '#6366f1' }); return; }
    const a = document.createElement('a');
    a.href = `${API_URL}?mode=download_sample&upload_id=${uploadId}`;
    a.download = sampleFileDownloadName || 'sample.xlsx';
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    toast.success('📥 샘플 파일 다운로드 시작');
  };

  const downloadErrorReport = errFile => {
    if (!errFile) return;
    const a = document.createElement('a');
    a.href = `${API_URL}?mode=download_error&error_file=${errFile}`;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
  };

  const translateError = msg => {
    if (!msg) return { friendlyMsg: '알 수 없는 오류', solution: '관리자에게 문의해주세요.' };
    const rowMatch = msg.match(/엑셀 \[ (\d+) 번째 행 \]/);
    const rowInfo = rowMatch ? `${rowMatch[1]}번째 행에서 ` : '';
    if (msg.includes('cannot be null')) return { friendlyMsg: `${rowInfo}필수 데이터가 비어있습니다.`, solution: '빈 칸이 있는지 확인해주세요.' };
    if (msg.includes('Duplicate entry') || msg.includes('unique constraint')) return { friendlyMsg: `${rowInfo}중복 데이터가 존재합니다.`, solution: '이미 등록된 데이터와 겹칩니다.' };
    if (msg.includes('Data too long') || msg.includes('value too large')) return { friendlyMsg: `${rowInfo}데이터 길이가 초과했습니다.`, solution: '해당 셀 내용을 줄여주세요.' };
    return { friendlyMsg: `${rowInfo}데이터 저장에 실패했습니다.`, solution: '관리자에게 시스템 에러 원문을 전달해주세요.' };
  };

  const getKnownFailedRowNumbers = () => Object.keys(failedRows)
    .filter(key => key !== '__unknown__')
    .map(Number)
    .filter(Number.isFinite)
    .sort((a, b) => a - b);

  const moveToFirstFailedRow = () => {
    const knownFailedRows = getKnownFailedRowNumbers();
    if (!knownFailedRows.length) {
      toast.info('이동 가능한 실패 행 번호가 없습니다.');
      return;
    }
    const firstFail = knownFailedRows[0];
    setSelectedErrorRow(firstFail);
    const pg = Math.ceil(firstFail / previewPageSize);
    if (pg !== previewPage) {
      setPreviewPage(pg);
      fetchPreviewPage(file, pg, headerRow, null);
    }
  };

  const moveToErrorRow = (rowNum) => {
    if (!Number.isFinite(rowNum) || rowNum <= 0) return;
    setSelectedErrorRow(rowNum);
    const pg = Math.ceil(rowNum / previewPageSize);
    if (pg !== previewPage) {
      setPreviewPage(pg);
      fetchPreviewPage(file, pg, headerRow, null);
    }
  };

  const moveBetweenFailedRows = (direction) => {
    const knownFailedRows = getKnownFailedRowNumbers();
    if (!knownFailedRows.length) {
      toast.info('이동 가능한 실패 행 번호가 없습니다.');
      return;
    }
    const currentBase = selectedErrorRow && knownFailedRows.includes(selectedErrorRow)
      ? selectedErrorRow
      : knownFailedRows[0];
    const currentIndex = knownFailedRows.indexOf(currentBase);
    const nextIndex = Math.min(Math.max(currentIndex + direction, 0), knownFailedRows.length - 1);
    if (nextIndex === currentIndex) {
      toast.info(direction > 0 ? '마지막 오류 행입니다.' : '첫 번째 오류 행입니다.');
      return;
    }
    moveToErrorRow(knownFailedRows[nextIndex]);
  };

  const resetCorrectionState = () => {
    setFailedRows({});
    setEditedCells({});
    setSelectedErrorRow(null);
    setShowOnlyFailedRows(false);
  };

  const clearSelectedFile = (inputId = 'fileInput') => {
    setFile(null);
    setExcelHeaders([]);
    setPreviewData([]);
    setTotalRows(0);
    resetCorrectionState();
    const el = document.getElementById(inputId);
    if (el) el.value = '';
  };

  const getUploadStageInfo = () => {
    if (!uploading) return { key: 'ready', label: '업로드 준비', desc: '파일과 데이터를 점검하고 있습니다.' };
    if (progress.percent >= 100) return { key: 'done', label: '결과 정리', desc: '업로드 결과를 마무리하고 있습니다.' };
    if (progress.percent >= 75) return { key: 'saving', label: 'DB 저장', desc: '검증된 데이터를 저장하고 있습니다.' };
    if (progress.percent >= 35) return { key: 'validate', label: '데이터 검증', desc: '행별 데이터와 매핑 규칙을 확인하고 있습니다.' };
    return { key: 'analyze', label: '파일 분석', desc: '헤더와 업로드 구조를 분석하고 있습니다.' };
  };

  const renderDebugUploadOptions = (compact = false) => (
    <div style={{
      padding: compact ? '10px 12px' : '12px 14px',
      borderRadius: '10px',
      border: '1px solid #dbeafe',
      background: debugDetailEnabled ? '#eff6ff' : '#f8fafc',
      minWidth: compact ? '260px' : '320px'
    }}>
      <label style={{ display: 'flex', alignItems: 'center', gap: '10px', cursor: 'pointer' }}>
        <input
          type="checkbox"
          checked={debugDetailEnabled}
          onChange={(e) => setDebugDetailEnabled(e.target.checked)}
          style={{ width: '16px', height: '16px', accentColor: '#4f46e5' }}
        />
        <span style={{ fontWeight: 700, color: '#1e293b', fontSize: compact ? '0.82rem' : '0.86rem' }}>
          디버깅 모드
        </span>
        <span style={{
          fontSize: '0.68rem',
          fontWeight: 700,
          color: debugDetailEnabled ? '#1d4ed8' : '#64748b',
          background: debugDetailEnabled ? '#dbeafe' : '#e2e8f0',
          padding: '2px 8px',
          borderRadius: '999px'
        }}>
          {debugDetailEnabled ? 'ON' : 'OFF'}
        </span>
      </label>
      <div style={{ color: '#64748b', fontSize: compact ? '0.72rem' : '0.75rem', marginTop: '6px', lineHeight: 1.5 }}>
        켜면 업로드 로그 창에 행별 매핑값, 예상 SQL, row-sql 치환 결과를 자세히 보여줍니다.
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginTop: '10px', flexWrap: 'wrap' }}>
        <span style={{ fontSize: compact ? '0.75rem' : '0.78rem', color: '#334155', fontWeight: 600 }}>상세 로그 행 수</span>
        <input
          type="number"
          min="1"
          max="200"
          value={debugRowLimit}
          onChange={(e) => setDebugRowLimit(e.target.value)}
          disabled={!debugDetailEnabled}
          style={{
            width: '84px',
            padding: '7px 10px',
            borderRadius: '8px',
            border: '1px solid #cbd5e1',
            background: debugDetailEnabled ? 'white' : '#f1f5f9',
            color: debugDetailEnabled ? '#0f172a' : '#94a3b8',
            fontWeight: 700,
            fontFamily: 'inherit'
          }}
        />
        <span style={{ fontSize: '0.72rem', color: '#64748b' }}>1 ~ 200, 기본 20</span>
      </div>
    </div>
  );

  // 오류 메시지에서 DB 컬럼명(들) 추출 → 매핑으로 엑셀 컬럼 인덱스 역조회 (다중 컬럼 지원)
  const parseFailedColsFromMsg = (msg) => {
    if (!msg) return [];
    const results = [];

    // ── [MULTI_COL] 형식 (사전 검증 결과) ──────────────────────────
    // 형식: "[MULTI_COL] COL1:길이초과(최대N자,입력M자)|COL2:필수값누락"
    const multiMatch = msg.match(/\[MULTI_COL\]\s*(.+)/);
    if (multiMatch) {
      multiMatch[1].split('|').forEach(entry => {
        const colonIdx = entry.indexOf(':');
        const dbCol  = (colonIdx >= 0 ? entry.substring(0, colonIdx) : entry).trim().toLowerCase();
        const errRaw = (colonIdx >= 0 ? entry.substring(colonIdx + 1) : '').trim();
        const errType = errRaw.includes('길이초과') ? '값 길이 초과'
                      : errRaw.includes('필수값') ? '필수값 누락' : '저장 오류';
        // 역매핑: DB 컬럼 → 엑셀 컬럼 인덱스
        let colIdx = null, colLabel = null;
        for (const aliasMap of Object.values(mapping)) {
          for (const [dbColKey, excelIdxVal] of Object.entries(aliasMap)) {
            if (dbColKey.toLowerCase() === dbCol) {
              const idx = parseInt(excelIdxVal);
              if (!isNaN(idx)) { colIdx = idx; colLabel = excelHeaders[idx]?.label || dbColKey; }
            }
          }
        }
        results.push({ dbCol, errType, colIdx, colLabel });
      });
      return results;
    }

    // ── fallback: DB 원문 오류 메시지에서 단일 컬럼 추출 ──────────
    const patterns = [
      /[Cc]olumn['\s`"]+([a-zA-Z0-9_]+)/,
      /field['\s`"]+([a-zA-Z0-9_]+)/i,
      /for column '([^']+)'/i,
      /컬럼['\s`"]+([a-zA-Z0-9_가-힣]+)/,
    ];
    let dbCol = null;
    for (const p of patterns) {
      const m = msg.match(p);
      if (m) { dbCol = m[1].toLowerCase(); break; }
    }
    if (!dbCol) return [];
    let colIdx = null, colLabel = null;
    for (const aliasMap of Object.values(mapping)) {
      for (const [dbColKey, excelIdxVal] of Object.entries(aliasMap)) {
        if (dbColKey.toLowerCase() === dbCol) {
          const idx = parseInt(excelIdxVal);
          if (!isNaN(idx)) { colIdx = idx; colLabel = excelHeaders[idx]?.label || dbColKey; }
        }
      }
    }
    const errType = msg.includes('too long') || msg.includes('value too large') ? '값 길이 초과'
                  : msg.includes('cannot be null') || msg.includes('NULL') ? '필수값 누락' : '저장 오류';
    return [{ dbCol, errType, colIdx, colLabel }];
  };

  // 하위 호환: 기존 parseFailedColIdxFromMsg 참조 → 첫 번째 컬럼 반환
  const parseFailedColIdxFromMsg = (msg) => {
    const cols = parseFailedColsFromMsg(msg);
    if (!cols.length) return null;
    return { colIdx: cols[0].colIdx, dbCol: cols[0].dbCol };
  };

  // 오류 메시지를 사람이 읽기 쉬운 한국어로 변환
  const friendlyFailMsg = (msg) => {
    if (!msg) return '오류';
    if (msg.startsWith('[MULTI_COL]')) {
      const errTypes = new Set(
        msg.replace('[MULTI_COL]', '').trim().split('|').map(e => {
          const t = e.split(':').slice(1).join(':');
          if (t.includes('길이초과')) return '값 길이 초과';
          if (t.includes('필수값')) return '필수값 누락';
          return 'DB 저장 실패';
        })
      );
      return [...errTypes].join(' / ');
    }
    if (msg.includes('cannot be null') || msg.includes('NULL')) return '필수값 누락';
    if (msg.includes('Duplicate entry') || msg.includes('unique constraint') || msg.includes('ORA-00001')) return '중복값';
    if (msg.includes('Data too long') || msg.includes('value too large')) return '값 길이 초과';
    if (msg.includes('배치 선행 오류')) return '연쇄 실패';
    if (msg.includes('배치') || msg.includes('INSERT') || msg.includes('UPDATE')) return 'DB 저장 실패';
    return '저장 오류';
  };

  const handleUpload = async () => {
    if (!file) return;
    const cr = await Swal.fire({ title: '데이터 업로드 실행', html: '데이터를 서버로 전송하시겠습니까?<br><small style="color:#ef4444">대량 데이터는 수 분이 소요될 수 있습니다.</small>', icon: 'question', showCancelButton: true, confirmButtonColor: '#6366f1', cancelButtonColor: '#94a3b8', confirmButtonText: '🚀 진행', cancelButtonText: '취소', reverseButtons: true });
    if (!cr.isConfirmed) return;

    setUploading(true); setProgress({ current: 0, total: 0, percent: 0 }); setUploadLogs(['🚀 파일 전송을 시작합니다...']); setUploadResult(null);
    sseCompletedRef.current = false; // SSE 완료 플래그 초기화
    const jobId = 'JOB_' + Date.now();

    // ── SSE 스트리밍 시작 ────────────────────────────────────────────
    // EventSource는 GET 전용이므로 jobId를 쿼리 파라미터로 전달합니다.
    // 기존 setInterval 폴링 방식 대비:
    //   ✅ 서버 → 클라이언트 push (불필요한 요청 없음)
    //   ✅ 세션 타임아웃에 무관 (ProgressStore 인메모리)
    //   ✅ 로그 중복 없음 (서버에서 새 로그만 전송)
    const es = new EventSource(`${API_URL}/stream?job_id=${encodeURIComponent(jobId)}`);
    esRef.current = es;

    es.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);

        if (data.type === 'progress') {
          setProgress({ current: data.current, total: data.total, percent: data.percent });
          if (data.logs?.length > 0) {
            setUploadLogs(prev => [...prev, ...data.logs].slice(-100));
          }
        } else if (data.type === 'done') {
          // 업로드 완료 — SSE 스트림 닫기 (fetch 응답 처리는 아래에서)
          sseCompletedRef.current = true; // JEUS 타임아웃으로 fetch가 끊겨도 성공 처리하기 위한 플래그
          es.close(); esRef.current = null;
        } else if (data.type === 'error') {
          setUploadLogs(prev => [...prev, `💣 오류: ${data.msg}`]);
          es.close(); esRef.current = null;
        }
        // type === 'waiting' 은 무시 (업로드 요청 도달 전 대기 상태)
      } catch { /* JSON 파싱 실패 무시 */ }
    };

    es.onerror = () => {
      // 연결 오류 — EventSource는 자동 재연결을 시도하므로
      // 업로드가 완전히 끝난 경우에만 닫기
      if (esRef.current && esRef.current.readyState === EventSource.CLOSED) {
        esRef.current = null;
      }
    };

    const fd = new FormData();
    fd.append('mode', 'upload'); fd.append('job_id', jobId); fd.append('file', file);
    fd.append('header_row', headerRow); fd.append('job_name', jobName || '직접 업로드'); fd.append('file_name', file.name);
    fd.append('struct_json_b64', encodeSafeBase64(JSON.stringify(structs)));
    fd.append('mapping_json_b64', encodeSafeBase64(JSON.stringify(mapping)));
    fd.append('pre_sql_json_b64', encodeSafeBase64(JSON.stringify(preSqls)));
    fd.append('post_sql_json_b64', encodeSafeBase64(JSON.stringify(postSqls)));
    fd.append('row_sql_json_b64', encodeSafeBase64(JSON.stringify(rowSqls)));
    if (debugDetailEnabled) {
      fd.append('debug_detail', 'Y');
      fd.append('debug_row_limit', String(Math.min(Math.max(Number(debugRowLimit) || 20, 1), 200)));
    }
    if (Object.keys(editedCells).length > 0) fd.append('edited_rows_b64', encodeSafeBase64(JSON.stringify(editedCells)));

    const tid = toast.loading('🚀 서버 전송 중...', { position: 'top-left' });
    try {
      const res = await post(API_URL, fd);
      // ── SSE 스트림 정리 ──
      if (esRef.current) { esRef.current.close(); esRef.current = null; }
      setUploading(false);
      if (res.status === 'ok' || res.status === 'partial') {
        setProgress(p => ({ ...p, current: p.total, percent: 100 }));
        setUploadLogs(prev => [...prev, '🎉 업로드 완료!']);
        loadHistory();

        if (res.status === 'partial') {
          // partial: 파일/미리보기 항상 유지, 실패 행 강조
          let failedMsgs = (res.failed_row_msgs && Object.keys(res.failed_row_msgs).length > 0)
            ? res.failed_row_msgs : {};

          // ── 폴백: failed_row_msgs 없으면 uploadLogs에서 파싱 ──────────────
          // 서버 로그 형식: "❌ N행 오류: 메시지"  (N = currentRowForLog = 1-based 시트행)
          // 데이터행 변환: dataRow = currentRowForLog - headerRow
          //   (failed_row_msgs의 key = row.getRowNum() - headerIdx = 같은 값)
          if (Object.keys(failedMsgs).length === 0) {
            const logFailedMsgs = {};
            const hRow = parseInt(headerRow) || 1;
            uploadLogsRef.current.forEach(log => {
              const m = log.match(/❌\s*(\d+)행\s*(?:개별\s*)?오류[:\s]+(.+)/);
              if (m) {
                const sheetRow1based = parseInt(m[1]);          // 로그의 행 번호
                const dataRow = sheetRow1based - hRow;          // 미리보기 _rowNum 기준으로 변환
                if (dataRow > 0) logFailedMsgs[String(dataRow)] = m[2].trim();
              }
            });
            console.log('[ExcelUpload] 로그 폴백 결과:', logFailedMsgs, '/ headerRow:', hRow);
            if (Object.keys(logFailedMsgs).length > 0) failedMsgs = logFailedMsgs;
          }

          // failed_row_msgs도 로그도 없으면: fail_cnt만큼 placeholder 생성 (행 특정 불가 → 경고용)
          if (Object.keys(failedMsgs).length === 0 && res.fail_cnt > 0) {
            failedMsgs = { '__unknown__': `${res.fail_cnt}건 실패 (행 특정 불가 - 오류 리포트를 확인하세요)` };
          }

          console.log('[ExcelUpload] 최종 failedMsgs:', failedMsgs, '/ res.failed_row_msgs:', res.failed_row_msgs);
          setFailedRows(failedMsgs);
          // uploadResult에도 failedMsgs 병합 (버튼에서 사용)
          setUploadResult({ ...res, failed_row_msgs: failedMsgs });
          toast.update(tid, { render: `⚠️ ${res.fail_cnt}건 실패 — 미리보기에서 수정 후 재업로드`, type: 'warning', isLoading: false, autoClose: 5000 });
          // 첫 번째 실패 행 페이지로 자동 이동
          if (Object.keys(failedMsgs).length > 0 && file) {
            const firstFailedRowNum = Math.min(...Object.keys(failedMsgs).map(Number));
            const failedPage = Math.ceil(firstFailedRowNum / previewPageSize);
            if (failedPage !== previewPage && failedPage >= 1) {
              setPreviewPage(failedPage);
              fetchPreviewPage(file, failedPage, headerRow, null);
            }
          }
        } else {
          // ok: 완전 성공 → 결과 화면으로
          setFailedRows({});
          setUploadResult(res);
          toast.update(tid, { render: '🎉 완료', type: 'success', isLoading: false, autoClose: 3000 });
          setFile(null); setPreviewData([]); setEditedCells({});
          const el = document.getElementById('fileInput'); if (el) el.value = '';
          const el2 = document.getElementById('adminUploadFileInput'); if (el2) el2.value = '';
        }
      } else {
        // err: 파일 유지, 오류 메시지 + 행 강조
        toast.update(tid, { render: '❌ 실패', type: 'error', isLoading: false, autoClose: 3000 });
        const { friendlyMsg, solution } = translateError(res.msg);
        setUploadResult({ ...res, friendlyMsg, solution });
        const rowMatch = res.msg?.match(/엑셀 \[ (\d+) 번째 행 \]/);
        if (rowMatch && file) {
          const errRowNum = parseInt(rowMatch[1]);
          const dataRowNum = errRowNum - parseInt(headerRow);
          if (dataRowNum > 0) {
            setFailedRows({ [String(dataRowNum)]: res.msg });
            const failedPage = Math.ceil(dataRowNum / previewPageSize);
            if (failedPage !== previewPage && failedPage >= 1) {
              setPreviewPage(failedPage);
              fetchPreviewPage(file, failedPage, headerRow, null);
            }
          }
        }
      }
    } catch {
      if (esRef.current) { esRef.current.close(); esRef.current = null; }

      // ── JEUS 타임아웃 대응 ─────────────────────────────────────────
      // SSE로 'done' 신호를 이미 받은 경우 → 서버는 정상 완료됨
      // fetch만 JEUS 타임아웃으로 끊긴 것이므로 성공으로 처리
      if (sseCompletedRef.current) {
        setUploading(false);
        setProgress(p => ({ ...p, percent: 100 }));
        setUploadLogs(prev => [...prev, '🎉 업로드 완료!']);
        toast.update(tid, { render: '🎉 업로드 완료', type: 'success', isLoading: false, autoClose: 3000 });
        setFailedRows({});
        setUploadResult({ status: 'ok' });
        setFile(null); setPreviewData([]); setEditedCells({});
        const el = document.getElementById('fileInput'); if (el) el.value = '';
        const el2 = document.getElementById('adminUploadFileInput'); if (el2) el2.value = '';
        loadHistory();
        return;
      }

      // SSE 완료 신호도 없이 끊긴 경우 → 진짜 통신 오류
      setUploading(false);
      toast.update(tid, { render: '❌ 통신 오류', type: 'error', isLoading: false, autoClose: 3000 });
    }
  };

  const updateMappingVal = (dbCol, val) => setMapping(prev => ({ ...prev, [activeAlias]: { ...prev[activeAlias], [dbCol]: val || '' } }));

  const handleReplaceSetup = async (dbCol, currentMapVal) => {
    let baseIdx = currentMapVal, currentRules = '';
    if (currentMapVal.startsWith('_REPLACE_:')) { const p = currentMapVal.split(':'); baseIdx = p[1]; currentRules = p.slice(2).join(':').replace(/\|\|/g, '\n').replace(/==/g, '='); }
    else if (currentMapVal.startsWith('_UNIQUE_:')) baseIdx = currentMapVal.split(':')[1];
    const { value: fv } = await Swal.fire({
      title: '🔀 데이터 치환 규칙', html: `<div style="text-align:left;font-size:0.9rem;color:#64748b;margin-bottom:10px"><b>기존값=변경값</b> 형식 (예: 진행중=01)</div><textarea id="swal-rr" class="swal2-textarea" style="margin:0;width:100%;height:100px">${currentRules}</textarea>`,
      showCancelButton: true, confirmButtonColor: '#10b981', confirmButtonText: '적용', cancelButtonText: '초기화', preConfirm: () => document.getElementById('swal-rr').value,
    });
    if (fv !== undefined) {
      if (!fv.trim()) updateMappingVal(dbCol, baseIdx);
      else { const rs = fv.trim().split('\n').filter(l => l.trim()).map(l => { const p = l.split('='); return p.length >= 2 ? `${p[0].trim()}==${p.slice(1).join('=').trim()}` : l.trim(); }).join('||'); updateMappingVal(dbCol, `_REPLACE_:${baseIdx}:${rs}`); }
    }
  };

  const activeTable = structs.find(s => s.alias === activeAlias)?.table;
  const currentDbCols = colsCache[activeTable] || [];
  const currentAliasMapping = mapping[activeAlias] || {};
  const filteredCols = currentDbCols.filter(c => c.label.toLowerCase().includes(searchTerm.toLowerCase())).sort((a, b) => { const ac = !!currentAliasMapping[a.value], bc = !!currentAliasMapping[b.value]; return ac === bc ? 0 : ac ? -1 : 1; });
  const mappingTotalPages = Math.ceil(filteredCols.length / MAPPING_PAGE_SIZE);
  const pagedCols = filteredCols.slice((mappingPage - 1) * MAPPING_PAGE_SIZE, mappingPage * MAPPING_PAGE_SIZE);

  // ─── 스텝 이동 ──────────────────────────────
  const goNext = async () => {
    if (isAdmin && currentStep === 2) { const ok = await handleSave(); if (ok) setCurrentStep(3); }
    else setCurrentStep(s => s + 1);
  };
  const goPrev = () => setCurrentStep(s => Math.max(0, s - 1));

  const canGoNext = () => {
    if (isAdmin) { if (currentStep === 0) return !!jobName.trim(); if (currentStep === 1) return !!structs[0].table; return true; }
    return true; // 사용자는 항상 다음 버튼 활성 (STEP 1은 hideNextBtn으로 숨김)
  };

  // ─── 렌더: 관리자 STEP 0 ─────────────────────
  const renderAdminStep0 = () => (
    <div className="wizard-panel">
      <div className="wizard-panel-title">⚙️ 기본 설정</div>
      <div className="wizard-panel-desc">업로드 작업의 기본 정보와 사용자 안내 내용을 설정합니다.</div>
      <div className="wiz-grid-2" style={{ marginTop: '28px' }}>
        <div className="wiz-field-group">
          <label className="wiz-label">작업명 <span style={{ color: '#ef4444' }}>*</span></label>
          <input type="text" value={jobName} onChange={e => setJobName(e.target.value)} placeholder="예: 직원 정보 일괄 등록" className="wiz-input" />
        </div>
        <div className="wiz-field-group">
          <label className="wiz-label">헤더 행 번호</label>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <input type="number" value={headerRow} onChange={e => setHeaderRow(e.target.value)} min="1" className="wiz-input" style={{ width: '90px', textAlign: 'center', fontSize: '1.1rem', fontWeight: 700 }} />
            <span style={{ fontSize: '0.82rem', color: '#64748b' }}>헤더가 위치한 행 번호</span>
          </div>
        </div>
      </div>
      <div className="wiz-section">
        <div className="wiz-section-title">📎 샘플 파일 등록</div>
        <div style={{ display: 'flex', gap: '12px', alignItems: 'center', flexWrap: 'wrap' }}>
          <input type="file" id="sampleFileInput" accept=".xls,.xlsx" onChange={e => { const f = e.target.files[0]; if (f) { setSampleFile(f); setSampleFileName(f.name); setSampleFileDownloadName(prev => prev?.trim() ? prev : f.name); } }} style={{ flex: 1, padding: '8px', border: '1px solid #e2e8f0', borderRadius: '8px', background: 'white', fontSize: '0.88rem' }} />
          {uploadId && sampleFileName && <button className="btn btn-mini btn-add" onClick={downloadSampleFile}>테스트 다운로드</button>}
        </div>
        {(sampleFile || sampleFileName) && <div style={{ marginTop: '6px', fontSize: '0.8rem', color: '#64748b' }}>{sampleFile ? `📄 업로드 대기: ${sampleFile.name}` : `💾 서버 보관: ${sampleFileName}`}</div>}
        <input type="text" value={sampleFileDownloadName} onChange={e => setSampleFileDownloadName(e.target.value)} placeholder="사용자에게 보일 다운로드 파일명 (예: 직원등록양식.xlsx)" className="wiz-input" style={{ marginTop: '10px' }} />
      </div>
      <div className="wiz-section">
        <div className="wiz-section-title">📢 사용자 안내 및 주의사항</div>
        <textarea value={instructions} onChange={e => setInstructions(e.target.value)} placeholder="일반 사용자가 업로드 시 참고할 주의사항을 입력하세요." className="wiz-textarea" style={{ minHeight: '100px' }} />
      </div>
    </div>
  );

  // ─── 렌더: 관리자 STEP 1 ─────────────────────
  const renderAdminStep1 = () => (
    <div className="wizard-panel">
      <div className="wizard-panel-title">🗄️ 테이블 구조 & SQL 설정</div>
      <div className="wizard-panel-desc">데이터를 삽입할 테이블과 전/후 처리 SQL을 설정합니다.</div>
      <div className="wiz-section" style={{ marginTop: '28px' }}>
        <div className="wiz-section-title">테이블 구조</div>
        <div style={{ overflowX: 'auto' }}>
          <table className="data-table" style={{ fontSize: '0.82rem' }}>
            <thead><tr><th>Alias</th><th>Table</th><th>Entity ID</th><th>PK Column</th><th>Parent</th><th>FK Column</th><th>업데이트 키 (UPSERT)</th><th width="50">삭제</th></tr></thead>
            <tbody>
              {structs.map((s, i) => (
                <tr key={i}>
                  <td>{i === 0 ? <b style={{ color: '#6366f1' }}>ROOT</b> : <input type="text" value={s.alias} onChange={e => { const n=[...structs]; n[i].alias=e.target.value; setStructs(n); }} className="wiz-input-sm" />}</td>
                  <td style={{ minWidth: '200px' }}><MySelect options={tableList} value={s.table} onChange={v => { const n=[...structs]; n[i].table=v; setStructs(n); if(v) loadCols(v); }} placeholder="테이블 선택" /></td>
                  <td style={{ minWidth: '90px' }}><input type="text" value={s.ent_id||''} onChange={e => { const n=[...structs]; n[i].ent_id=e.target.value.toUpperCase(); setStructs(n); }} placeholder="예: CM" className="wiz-input-sm" style={{ textTransform: 'uppercase' }} /></td>
                  <td style={{ minWidth: '180px' }}><MySelect options={colsCache[s.table]||[]} value={s.pk_col} onChange={v => { const n=[...structs]; n[i].pk_col=v; setStructs(n); }} placeholder="PK 선택" /></td>
                  <td style={{ minWidth: '150px' }}>{i>0 && <MySelect options={structs.map(x=>x.alias)} value={s.parent} onChange={v => { const n=[...structs]; n[i].parent=v; setStructs(n); }} placeholder="부모" />}</td>
                  <td style={{ minWidth: '130px' }}>{i>0 && <input type="text" value={s.fk} onChange={e => { const n=[...structs]; n[i].fk=e.target.value; setStructs(n); }} placeholder="FK 컬럼" className="wiz-input-sm" />}</td>
                  <td style={{ minWidth: '240px' }}>
                    <MyMultiSelect options={colsCache[s.table]||[]} value={s.upsert_keys||[]} onChange={v => { const n=[...structs]; n[i].upsert_keys=v; setStructs(n); }} placeholder={s.table ? '키 선택 (없으면 INSERT 전용)' : '테이블 먼저 선택'} isDisabled={!s.table} />
                    {s.upsert_keys?.length > 0 && <div style={{ marginTop: '3px', fontSize: '0.7rem', color: '#92400e', background: '#fef9c3', padding: '2px 6px', borderRadius: '4px' }}>🔄 UPSERT 모드</div>}
                  </td>
                  <td style={{ textAlign: 'center' }}>{i>0 && <button className="btn btn-mini btn-del" onClick={() => setStructs(structs.filter((_, idx) => idx !== i))}>삭제</button>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <button className="btn btn-mini btn-add" onClick={() => { const a='T'+structs.length; setStructs([...structs, {alias:a,table:'',pk_col:'',parent:'ROOT',fk:'',upsert_keys:[]}]); setMapping(p=>({...p,[a]:{}})); }} style={{ marginTop: '12px' }}>+ 하위 테이블 추가</button>
      </div>
      <div className="wiz-section">
        <div className="wiz-section-title">SQL 설정</div>
        <div className="wiz-grid-2">
          <SqlEditor title="⚡ Pre-SQL" sqls={preSqls} setSqls={setPreSqls} tooltip="업로드 전 1회 실행" />
          <SqlEditor title="✅ Post-SQL" sqls={postSqls} setSqls={setPostSqls} tooltip="업로드 후 1회 실행" />
        </div>
        <SqlEditor title="🔁 Row-SQL (행마다 실행)" sqls={rowSqls} setSqls={setRowSqls} tooltip="각 행이 처리될 때마다 실행됩니다. SQL 안에 ${토큰명} 형식으로 값을 동적으로 삽입할 수 있습니다." />

        {/* ── Row-SQL 토큰 가이드 ── */}
        <div style={{ marginTop: '4px', borderRadius: '12px', border: '1px solid #e0e7ff', background: 'linear-gradient(135deg, #f8f9ff 0%, #faf5ff 100%)', overflow: 'hidden' }}>
          {/* 헤더 */}
          <div style={{ padding: '10px 16px', background: 'linear-gradient(90deg, #6366f1, #8b5cf6)', display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span style={{ fontSize: '14px' }}>🔖</span>
            <span style={{ fontWeight: 700, fontSize: '0.82rem', color: 'white' }}>Row-SQL 토큰 사용 가이드</span>
            <span style={{ marginLeft: 'auto', fontSize: '0.72rem', color: 'rgba(255,255,255,0.75)', fontStyle: 'italic' }}>{'${토큰명}'} 형식으로 SQL 내 어디서든 사용</span>
          </div>

          <div style={{ padding: '14px 16px' }}>
            {/* 기본 토큰 */}
            <div style={{ marginBottom: '10px' }}>
              <div style={{ fontSize: '0.72rem', fontWeight: 700, color: '#6366f1', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '8px' }}>📌 기본 제공 토큰</div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: '6px' }}>
                {[
                  { token: '${NEW_ID}',    badge: '필수',  badgeColor: '#ef4444', desc: '현재 행에 채번된 신규 PK 값',             ex: 'UPDATE log SET ref_id = ${NEW_ID}' },
                  { token: '${PARENT_ID}', badge: '계층',  badgeColor: '#f59e0b', desc: '부모 테이블의 PK 값 (하위 테이블에서 사용)', ex: 'WHERE parent_key = ${PARENT_ID}' },
                  { token: '${PK_COL}',   badge: '메타',  badgeColor: '#64748b', desc: '현재 테이블의 PK 컬럼명 (문자열)',            ex: '-- PK 컬럼명: ${PK_COL}' },
                  { token: '${ALIAS}',    badge: '메타',  badgeColor: '#64748b', desc: '현재 처리 중인 테이블 Alias (예: ROOT)',      ex: '-- Alias: ${ALIAS}' },
                  { token: '${TABLE}',    badge: '메타',  badgeColor: '#64748b', desc: '현재 처리 중인 실제 테이블명',                ex: '-- Table: ${TABLE}' },
                ].map(({ token, badge, badgeColor, desc, ex }) => (
                  <div key={token} style={{ background: 'white', border: '1px solid #e8ecf0', borderRadius: '8px', padding: '9px 11px', display: 'flex', flexDirection: 'column', gap: '4px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
                      <code style={{ fontSize: '0.8rem', fontWeight: 700, color: '#6366f1', background: '#eef2ff', padding: '2px 7px', borderRadius: '5px', fontFamily: 'monospace' }}>{token}</code>
                      <span style={{ fontSize: '0.65rem', fontWeight: 700, color: 'white', background: badgeColor, borderRadius: '4px', padding: '1px 6px' }}>{badge}</span>
                    </div>
                    <div style={{ fontSize: '0.76rem', color: '#475569' }}>{desc}</div>
                    <div style={{ fontSize: '0.71rem', color: '#94a3b8', fontFamily: 'monospace', wordBreak: 'break-all' }}>예) {ex}</div>
                  </div>
                ))}
              </div>
            </div>

            {/* 엑셀 컬럼 토큰 */}
            <div style={{ marginBottom: '10px' }}>
              <div style={{ fontSize: '0.72rem', fontWeight: 700, color: '#059669', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '8px' }}>📊 엑셀 원본값 토큰</div>
              <div style={{ background: 'white', border: '1px solid #e8ecf0', borderRadius: '8px', padding: '10px 14px', display: 'flex', gap: '16px', flexWrap: 'wrap', alignItems: 'flex-start' }}>
                <div style={{ flex: 1, minWidth: '220px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '5px' }}>
                    <code style={{ fontSize: '0.8rem', fontWeight: 700, color: '#059669', background: '#ecfdf5', padding: '2px 8px', borderRadius: '5px', fontFamily: 'monospace' }}>{'${COL_0}'}</code>
                    <code style={{ fontSize: '0.8rem', fontWeight: 700, color: '#059669', background: '#ecfdf5', padding: '2px 8px', borderRadius: '5px', fontFamily: 'monospace' }}>{'${COL_1}'}</code>
                    <code style={{ fontSize: '0.8rem', fontWeight: 500, color: '#94a3b8', background: '#f1f5f9', padding: '2px 8px', borderRadius: '5px', fontFamily: 'monospace' }}>...</code>
                  </div>
                  <div style={{ fontSize: '0.76rem', color: '#475569', marginBottom: '3px' }}>
                    엑셀 열 번호(0부터 시작)에 해당하는 <strong>원본 셀 값</strong>을 그대로 삽입합니다.
                  </div>
                  <div style={{ fontSize: '0.71rem', color: '#94a3b8', fontFamily: 'monospace' }}>
                    예) A열 = {'${COL_0}'} &nbsp;|&nbsp; B열 = {'${COL_1}'} &nbsp;|&nbsp; C열 = {'${COL_2}'}
                  </div>
                </div>
                <div style={{ background: '#f0fdf4', border: '1px solid #a7f3d0', borderRadius: '7px', padding: '8px 12px', fontSize: '0.76rem', color: '#065f46', minWidth: '200px' }}>
                  <strong>💡 Tip:</strong> 컬럼 매핑에서 확인한 열 순서(0-based)를 그대로 사용하세요.<br />
                  헤더행이 2행이면 데이터는 3행부터 시작합니다.
                </div>
              </div>
            </div>

            {/* DB 컬럼 토큰 */}
            <div style={{ marginBottom: '10px' }}>
              <div style={{ fontSize: '0.72rem', fontWeight: 700, color: '#d97706', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '8px' }}>🗄️ DB 컬럼값 토큰</div>
              <div style={{ background: 'white', border: '1px solid #e8ecf0', borderRadius: '8px', padding: '10px 14px', display: 'flex', gap: '16px', flexWrap: 'wrap', alignItems: 'flex-start' }}>
                <div style={{ flex: 1, minWidth: '220px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '5px', flexWrap: 'wrap' }}>
                    <code style={{ fontSize: '0.8rem', fontWeight: 700, color: '#d97706', background: '#fef3c7', padding: '2px 8px', borderRadius: '5px', fontFamily: 'monospace' }}>{'${컬럼명}'}</code>
                  </div>
                  <div style={{ fontSize: '0.76rem', color: '#475569', marginBottom: '3px' }}>
                    <strong>컬럼 매핑에서 설정한 DB 컬럼명</strong>을 그대로 토큰으로 사용합니다.<br />
                    해당 행에 실제 저장된 값(치환·고정값 포함)이 삽입됩니다.
                  </div>
                  <div style={{ fontSize: '0.71rem', color: '#94a3b8', fontFamily: 'monospace' }}>
                    예) {'${EMP_NM}'} &nbsp;|&nbsp; {'${DEPT_CD}'} &nbsp;|&nbsp; {'${REG_DT}'}
                  </div>
                </div>
                <div style={{ background: '#fffbeb', border: '1px solid #fde68a', borderRadius: '7px', padding: '8px 12px', fontSize: '0.76rem', color: '#92400e', minWidth: '200px' }}>
                  <strong>⚠ 주의:</strong> 컬럼명은 <strong>대소문자를 정확히</strong> 입력해야 합니다.<br />
                  매핑되지 않은 컬럼은 빈 문자열로 치환됩니다.
                </div>
              </div>
            </div>

            {/* 사용 예시 */}
            <div>
              <div style={{ fontSize: '0.72rem', fontWeight: 700, color: '#475569', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '8px' }}>✏️ 실제 사용 예시</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                {[
                  { label: '감사 로그 기록', sql: "INSERT INTO audit_log (ref_id, tbl_nm, reg_dttm) VALUES ('${NEW_ID}', '${TABLE}', SYSDATE)" },
                  { label: '부모-자식 연결 후처리', sql: "UPDATE child_tbl SET parent_ref = '${PARENT_ID}' WHERE id = '${NEW_ID}'" },
                  { label: '엑셀 원본값으로 코드 변환', sql: "UPDATE emp SET dept_nm = (SELECT nm FROM dept WHERE cd = '${COL_2}') WHERE emp_id = '${NEW_ID}'" },
                  { label: '매핑된 DB 컬럼값 활용', sql: "CALL update_summary('${DEPT_CD}', '${EMP_NM}', '${NEW_ID}')" },
                ].map(({ label, sql }) => (
                  <div key={label} style={{ background: '#1e293b', borderRadius: '8px', overflow: 'hidden' }}>
                    <div style={{ padding: '4px 12px', background: '#334155', fontSize: '0.7rem', color: '#94a3b8', fontWeight: 600 }}>{label}</div>
                    <div style={{ padding: '8px 12px', fontFamily: 'monospace', fontSize: '0.76rem', color: '#7dd3fc', lineHeight: 1.6, whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>{sql}</div>
                  </div>
                ))}
              </div>
            </div>

            {/* 주석 처리 안내 */}
            <div style={{ marginTop: '10px', padding: '8px 12px', background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '8px', fontSize: '0.75rem', color: '#64748b', display: 'flex', gap: '8px', alignItems: 'flex-start' }}>
              <span style={{ fontSize: '14px', flexShrink: 0 }}>💬</span>
              <span><strong>주석 처리:</strong> SQL이 <code style={{ background: '#e2e8f0', padding: '1px 5px', borderRadius: '3px' }}>--</code> 로 시작하면 해당 줄은 실행되지 않습니다. 토큰을 확인하는 용도로 활용할 수 있습니다.</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );

  // ─── 렌더: 관리자 STEP 2 ─────────────────────
  const renderAdminStep2 = () => (
    <div className="wizard-panel">
      <div className="wizard-panel-title">🔗 컬럼 매핑</div>
      <div className="wizard-panel-desc">엑셀 파일을 선택하여 DB 컬럼과 매핑합니다. 다음 단계에서 자동으로 저장됩니다.</div>
      <div className="wiz-section" style={{ marginTop: '28px' }}>
        <div className="wiz-section-title" style={{ marginBottom: '10px' }}>샘플 엑셀 파일 선택 (헤더 파악용)</div>
        <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
          <label htmlFor="mappingFileInput" style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '10px 20px', background: '#f8fafc', border: '1.5px dashed #cbd5e1', borderRadius: '10px', cursor: 'pointer', fontSize: '0.88rem', color: '#475569', flex: 1 }}>
            📂 {file ? <span style={{ fontWeight: 600, color: '#059669' }}>{file.name} ({formatFileSize(file.size)})</span> : <span>엑셀 파일을 선택하세요 (.xls, .xlsx)</span>}
          </label>
          <input id="mappingFileInput" type="file" accept=".xls,.xlsx" style={{ display: 'none' }} onChange={e => { const f = e.target.files[0]; if (f) processSelectedFile(f); }} />
          {file && <span style={{ fontSize: '0.8rem', color: '#10b981', fontWeight: 600, whiteSpace: 'nowrap' }}>헤더 {excelHeaders.length}개 인식</span>}
        </div>
      </div>
      {structs[0].table && (
        <div className="wiz-section">
          <div style={{ display: 'flex', gap: '8px', marginBottom: '16px', flexWrap: 'wrap' }}>
            {structs.map(s => (
              <button key={s.alias} onClick={() => setActiveAlias(s.alias)} style={{ padding: '8px 20px', borderRadius: '8px', border: '1px solid', cursor: 'pointer', fontSize: '0.85rem', fontWeight: activeAlias === s.alias ? 700 : 500, transition: 'all 0.15s', borderColor: activeAlias === s.alias ? 'transparent' : '#e2e8f0', background: activeAlias === s.alias ? '#6366f1' : 'white', color: activeAlias === s.alias ? 'white' : '#64748b' }}>
                {s.alias} 테이블
              </button>
            ))}
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px', flexWrap: 'wrap', gap: '8px' }}>
            <span style={{ fontSize: '0.82rem', color: '#64748b' }}>총 <b style={{ color: '#1e293b' }}>{filteredCols.length}</b>개 컬럼 <span style={{ marginLeft: '6px', color: '#6366f1', fontWeight: 600 }}>(매핑됨: {filteredCols.filter(c => currentAliasMapping[c.value]).length}개)</span></span>
            <input type="text" placeholder="컬럼 검색..." value={searchTerm} onChange={e => setSearchTerm(e.target.value)} style={{ padding: '8px 12px', border: '1px solid #e2e8f0', borderRadius: '8px', fontSize: '0.85rem', width: '200px' }} />
          </div>
          <div style={{ overflowX: 'auto' }}>
            <table className="data-table" style={{ fontSize: '0.82rem' }}>
              <thead><tr><th width="60" style={{ textAlign: 'center' }}>사용</th><th>DB 컬럼</th><th width="50" style={{ textAlign: 'center' }}>상태</th><th>매핑 설정</th></tr></thead>
              <tbody>
                {pagedCols.map(col => {
                  const mapVal = currentAliasMapping[col.value] || '';
                  const isChecked = !!mapVal;
                  const isFixed = mapVal.startsWith('_FIXED_:');
                  const isReplace = mapVal.startsWith('_REPLACE_:');
                  const isUnique = mapVal.startsWith('_UNIQUE_:');
                  let selectValue = mapVal, fixedText = '';
                  if (isFixed) { selectValue = '_FIXED_'; fixedText = mapVal.substring(8); }
                  else if (isReplace) selectValue = mapVal.split(':')[1];
                  else if (isUnique) selectValue = mapVal.split(':')[1];
                  return (
                    <tr key={col.value} style={{ opacity: isChecked ? 1 : 0.45, background: isChecked ? '#f0fdfa' : 'transparent' }}>
                      <td style={{ textAlign: 'center' }}>
                        <input type="checkbox" checked={isChecked} onChange={() => { setMapping(prev => { const m = { ...prev[activeAlias] }; if (isChecked) delete m[col.value]; else m[col.value] = '_AUTO_SEQ_'; return { ...prev, [activeAlias]: m }; }); }} style={{ transform: 'scale(1.2)', cursor: 'pointer', accentColor: '#10b981' }} />
                      </td>
                      <td><b style={{ color: isChecked ? '#065f46' : '#475569' }}>{col.label}</b><br /><small style={{ color: '#94a3b8' }}>{col.value}</small></td>
                      <td style={{ textAlign: 'center', fontSize: '1rem' }}>{isChecked ? (isFixed ? '📌' : isReplace ? '🔀' : isUnique ? '🔢' : '➡️') : '↔️'}</td>
                      <td style={{ padding: '6px 12px' }}>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                          <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                            <div style={{ flex: 1 }}>
                              <MySelect options={[{ value: '_AUTO_SEQ_', label: '✨ 자동 채번' }, { value: '_FIXED_', label: '📌 고정값' }, ...excelHeaders]} value={selectValue} onChange={v => { if (v === '_FIXED_') updateMappingVal(col.value, '_FIXED_:'); else updateMappingVal(col.value, v); }} isDisabled={!isChecked} placeholder="매핑 선택..." />
                            </div>
                            {isChecked && selectValue && selectValue !== '_AUTO_SEQ_' && selectValue !== '_FIXED_' && (
                              <div style={{ display: 'flex', gap: '4px' }}>
                                <button className="btn btn-mini" onClick={() => handleReplaceSetup(col.value, mapVal)} style={{ height: '38px', padding: '0 10px', background: isReplace ? '#10b981' : '#f8fafc', color: isReplace ? 'white' : '#475569', border: isReplace ? 'none' : '1px solid #e2e8f0' }}>{isReplace ? '🔀 ON' : '🔀'}</button>
                                <button className="btn btn-mini" onClick={() => isUnique ? updateMappingVal(col.value, selectValue) : updateMappingVal(col.value, `_UNIQUE_:${selectValue}`)} style={{ height: '38px', padding: '0 10px', background: isUnique ? '#3b82f6' : '#f8fafc', color: isUnique ? 'white' : '#475569', border: isUnique ? 'none' : '1px solid #e2e8f0' }}>{isUnique ? '🔢 ON' : '🔢'}</button>
                              </div>
                            )}
                          </div>
                          {isFixed && isChecked && <input type="text" value={fixedText} onChange={e => updateMappingVal(col.value, '_FIXED_:' + e.target.value)} placeholder="고정값 입력" style={{ padding: '8px 12px', borderRadius: '6px', border: '1px dashed #6366f1', background: '#eef2ff', color: '#4338ca', fontSize: '0.88rem', fontWeight: 600, outline: 'none' }} />}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {mappingTotalPages > 1 && (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '4px', marginTop: '12px' }}>
              {[['«',1],['‹',mappingPage-1],...Array.from({length:Math.min(5,mappingTotalPages)},(_,i)=>{let p;if(mappingTotalPages<=5)p=i+1;else if(mappingPage<=3)p=i+1;else if(mappingPage>=mappingTotalPages-2)p=mappingTotalPages-4+i;else p=mappingPage-2+i;return[p,p];}),...[['›',mappingPage+1],['»',mappingTotalPages]]].map(([label,pg],i) => (
                <button key={i} onClick={() => { if(pg>=1&&pg<=mappingTotalPages) setMappingPage(pg); }} disabled={pg<1||pg>mappingTotalPages}
                  style={{ minWidth:'30px',height:'30px',padding:'0 6px',borderRadius:'6px',border:'1px solid',borderColor:pg===mappingPage?'#6366f1':'#e2e8f0',background:pg===mappingPage?'#6366f1':'white',color:pg===mappingPage?'white':(pg<1||pg>mappingTotalPages)?'#d1d5db':'#374151',fontWeight:pg===mappingPage?700:400,fontSize:'0.78rem',cursor:pg<1||pg>mappingTotalPages?'not-allowed':'pointer' }}>
                  {label}
                </button>
              ))}
              <span style={{ marginLeft:'6px',fontSize:'0.75rem',color:'#94a3b8' }}>{mappingPage} / {mappingTotalPages}</span>
            </div>
          )}
        </div>
      )}
    </div>
  );

  // ─── 렌더: 관리자 STEP 3 ─────────────────────
  const renderAdminStep3 = () => (
    <div className="wizard-panel">
      {/* 저장 완료 요약 */}
      <div style={{ textAlign: 'center', paddingBottom: '24px', borderBottom: '1px solid #f1f5f9' }}>
        <div style={{ fontSize: '3rem', marginBottom: '10px' }}>🎉</div>
        <div className="wizard-panel-title">설정 저장 완료</div>
        <div className="wizard-panel-desc" style={{ marginBottom: '20px' }}>설정이 저장되었습니다. 아래에서 바로 데이터를 업로드할 수 있습니다.</div>
        {uploadId && (
          <div style={{ background: '#f0fdf4', border: '1px solid #a7f3d0', borderRadius: '10px', padding: '12px 20px', display: 'inline-block' }}>
            <span style={{ fontSize: '0.78rem', color: '#059669', fontWeight: 600 }}>로더 ID: </span>
            <span style={{ fontSize: '1rem', fontWeight: 700, color: '#065f46', fontFamily: 'monospace' }}>{uploadId}</span>
            <span style={{ fontSize: '0.72rem', color: '#64748b', marginLeft: '10px' }}>| 사용자 URL: ?upload_id={uploadId}</span>
          </div>
        )}
        <div style={{ display: 'flex', gap: '8px', justifyContent: 'center', marginTop: '16px', flexWrap: 'wrap' }}>
          <button onClick={() => setCurrentStep(0)} style={{ padding: '9px 18px', borderRadius: '8px', border: '1px solid #e2e8f0', background: 'white', color: '#475569', fontWeight: 600, cursor: 'pointer', fontSize: '0.85rem' }}>← 설정 처음으로</button>
          <button onClick={handleSave} style={{ padding: '9px 18px', borderRadius: '8px', border: 'none', background: '#10b981', color: 'white', fontWeight: 700, cursor: 'pointer', fontSize: '0.85rem' }}>💾 다시 저장</button>
        </div>
      </div>

      {/* 데이터 업로드 섹션 */}
      <div style={{ marginTop: '28px' }}>
        <div className="wiz-section-title" style={{ marginBottom: '16px' }}>🚀 데이터 업로드 (테스트 / 직접 실행)</div>

        {uploadResult ? (
          /* 결과 화면 */
          <div>
            {uploadResult.status === 'ok' && (
              <div style={{ textAlign: 'center', padding: '28px', background: '#f0fdf4', border: '1px solid #a7f3d0', borderRadius: '14px' }}>
                <div style={{ fontSize: '2.8rem', marginBottom: '10px' }}>✅</div>
                <div style={{ fontSize: '1.1rem', fontWeight: 700, color: '#065f46', marginBottom: '5px' }}>업로드 완료!</div>
                <div style={{ color: '#059669', fontSize: '0.88rem' }}>{uploadResult.msg}</div>
              </div>
            )}
            {uploadResult.status === 'partial' && (
              <div style={{ padding: '22px', background: '#fffbeb', border: '1px solid #fde68a', borderRadius: '14px', textAlign: 'center' }}>
                <div style={{ fontSize: '2.2rem', marginBottom: '8px' }}>⚠️</div>
                <div style={{ fontWeight: 700, color: '#92400e', marginBottom: '10px' }}>일부 실패</div>
                <div style={{ display: 'flex', gap: '10px', justifyContent: 'center', flexWrap: 'wrap', marginBottom: '12px' }}>
                  <span style={{ background: '#d1fae5', color: '#065f46', padding: '3px 12px', borderRadius: '20px', fontWeight: 700, fontSize: '0.88rem' }}>✅ {uploadResult.success_cnt?.toLocaleString()}건 성공</span>
                  <span style={{ background: '#fee2e2', color: '#991b1b', padding: '3px 12px', borderRadius: '20px', fontWeight: 700, fontSize: '0.88rem' }}>❌ {uploadResult.fail_cnt?.toLocaleString()}건 실패</span>
                </div>
                {uploadResult.error_file && <button onClick={() => downloadErrorReport(uploadResult.error_file)} style={{ padding: '8px 16px', borderRadius: '8px', border: 'none', background: '#ef4444', color: 'white', fontWeight: 700, cursor: 'pointer', fontSize: '0.85rem', marginBottom: '8px' }}>🚨 오류 리포트 다운로드</button>}
                <div style={{ marginTop: '10px' }}>
                  <button onClick={() => {
                    if (uploadResult.failed_row_msgs && Object.keys(uploadResult.failed_row_msgs).length > 0) {
                      setFailedRows(uploadResult.failed_row_msgs);
                      const firstFail = Math.min(...Object.keys(uploadResult.failed_row_msgs).map(Number));
                      const pg = Math.ceil(firstFail / previewPageSize);
                      if (pg !== previewPage && file) { setPreviewPage(pg); fetchPreviewPage(file, pg, headerRow, null); }
                    }
                    setUploadResult(null);
                  }} style={{ padding: '9px 20px', borderRadius: '8px', border: 'none', background: '#ef4444', color: 'white', fontWeight: 700, cursor: 'pointer', fontSize: '0.85rem', width: '100%' }}>
                    ✏ 미리보기에서 실패 행 직접 수정하기
                  </button>
                </div>
              </div>
            )}
            {uploadResult.status === 'err' && (
              <div style={{ padding: '18px', background: '#fff1f2', border: '1px solid #fecdd3', borderRadius: '14px' }}>
                <div style={{ fontWeight: 700, color: '#e11d48', marginBottom: '6px' }}>❌ 오류 발생</div>
                <div style={{ color: '#9f1239', fontSize: '0.85rem', marginBottom: '8px' }} dangerouslySetInnerHTML={{ __html: uploadResult.friendlyMsg || uploadResult.msg }} />
                {/* 디버그용 — 원인 파악 후 제거 */}
<div style={{ marginTop: '8px', fontSize: '0.75rem', color: '#64748b', 
              background: '#f1f5f9', padding: '8px', borderRadius: '6px',
              fontFamily: 'monospace', wordBreak: 'break-all' }}>
  🔍 원문: {uploadResult.msg}
</div>
                {uploadResult.solution && <div style={{ color: '#166534', background: '#f0fdf4', padding: '9px 12px', borderRadius: '8px', fontSize: '0.83rem' }}>💡 {uploadResult.solution}</div>}
                <button onClick={() => setUploadResult(null)}
                  style={{ marginTop: '10px', padding: '9px 18px', borderRadius: '8px', border: '1px solid #fca5a5', background: 'white', color: '#e11d48', fontWeight: 700, cursor: 'pointer', fontSize: '0.83rem', width: '100%' }}>
                  ✏ 미리보기에서 직접 수정하기
                </button>
              </div>
            )}
            <div style={{ textAlign: 'center', marginTop: '14px' }}>
              <button onClick={() => { setUploadResult(null); setUploadLogs([]); setProgress({current:0,total:0,percent:0}); setFailedRows({}); setFile(null); setPreviewData([]); const el=document.getElementById('adminUploadFileInput'); if(el) el.value=''; }}
                style={{ padding: '9px 20px', borderRadius: '8px', border: '1px solid #e2e8f0', background: 'white', color: '#475569', fontWeight: 600, cursor: 'pointer', fontSize: '0.88rem' }}>
                ↩ 다시 업로드
              </button>
            </div>
          </div>
        ) : uploading ? (
          /* 진행 화면 */
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '6px' }}>
              <span style={{ fontSize: '0.85rem', fontWeight: 600, color: '#1e293b' }}>진행 상황</span>
              <span style={{ fontSize: '0.85rem', fontWeight: 700, color: '#6366f1' }}>{progress.percent}%</span>
            </div>
            <div style={{ height: '10px', background: '#e2e8f0', borderRadius: '100px', overflow: 'hidden' }}>
              <div style={{ height: '100%', borderRadius: '100px', background: 'linear-gradient(90deg,#6366f1,#8b5cf6)', width: `${progress.percent}%`, transition: 'width 0.4s ease' }} />
            </div>
            <div style={{ marginTop: '4px', fontSize: '0.76rem', color: '#64748b', textAlign: 'right' }}>{progress.current.toLocaleString()} / {progress.total.toLocaleString()} 건</div>
            <div style={{ marginTop: '12px', background: '#0f172a', borderRadius: '10px', padding: '12px 14px', maxHeight: '180px', overflowY: 'auto', fontFamily: 'monospace', fontSize: '0.75rem' }}>
              {uploadLogs.map((log, i) => (
                <div key={i} style={{ marginBottom: '2px', color: log.includes('❌') ? '#f87171' : log.includes('🎉') ? '#fbbf24' : '#4ade80', paddingBottom: '2px', borderBottom: '1px solid rgba(255,255,255,0.05)' }}>{log}</div>
              ))}
              <div ref={logEndRef} />
            </div>
          </div>
        ) : (
          /* 파일 선택 + 업로드 */
          <>
            {file ? (
              <div style={{ background: '#f0fdf4', border: '1.5px solid #6ee7a0', borderRadius: '12px', padding: '12px 16px', display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '12px' }}>
                <div style={{ width: '38px', height: '38px', borderRadius: '9px', background: 'white', border: '1px solid #a7f3d0', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '1.2rem', flexShrink: 0 }}>📊</div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 700, color: '#065f46', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: '0.9rem' }}>{file.name}</div>
                  <div style={{ display: 'flex', gap: '5px', marginTop: '3px', flexWrap: 'wrap' }}>
                    {[formatFileSize(file.size), `총 ${totalRows.toLocaleString()}건`].map(t => (
                      <span key={t} style={{ fontSize: '0.68rem', background: 'white', border: '1px solid #a7f3d0', color: '#059669', padding: '1px 7px', borderRadius: '20px', fontWeight: 600 }}>{t}</span>
                    ))}
                  </div>
                </div>
                <button onClick={() => { setFile(null); setPreviewData([]); setTotalRows(0); setEditedCells({}); setFailedRows({}); const el=document.getElementById('adminUploadFileInput'); if(el) el.value=''; }}
                  style={{ height: '28px', padding: '0 10px', borderRadius: '7px', border: '1px solid #fca5a5', background: 'white', color: '#ef4444', fontSize: '0.76rem', fontWeight: 700, cursor: 'pointer' }}>✕</button>
              </div>
            ) : (
              <label htmlFor="adminUploadFileInput"
                onDragOver={e => { e.preventDefault(); setIsDragging(true); }}
                onDragLeave={e => { e.preventDefault(); setIsDragging(false); }}
                onDrop={e => { e.preventDefault(); setIsDragging(false); const f=e.dataTransfer.files[0]; if(f&&(f.name.endsWith('.xlsx')||f.name.endsWith('.xls'))) processSelectedFile(f); else if(f) toast.error('❌ .xls/.xlsx만 가능합니다.'); }}
                style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '16px 20px', borderRadius: '12px', cursor: 'pointer', border: isDragging ? '2px solid #6366f1' : '2px dashed #cbd5e1', background: isDragging ? '#eef2ff' : '#f9fafb', transition: 'all 0.18s', marginBottom: '12px' }}>
                <input id="adminUploadFileInput" type="file" accept=".xls,.xlsx" style={{ display: 'none' }} onChange={e => { const f=e.target.files[0]; if(f) processSelectedFile(f); }} />
                <div style={{ width: '40px', height: '40px', borderRadius: '10px', background: isDragging ? '#6366f1' : 'white', border: isDragging ? 'none' : '1.5px solid #e5e8eb', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '1.3rem', flexShrink: 0 }}>{isDragging ? '📂' : '📤'}</div>
                <div>
                  <div style={{ fontWeight: 700, color: isDragging ? '#6366f1' : '#333d4b', fontSize: '0.9rem' }}>{isDragging ? '여기에 놓아주세요!' : '업로드할 엑셀 파일을 드래그하거나 클릭하여 선택'}</div>
                  <div style={{ marginTop: '3px', display: 'flex', gap: '5px' }}>
                    {['.xls', '.xlsx'].map(ext => <span key={ext} style={{ background: '#eef2ff', color: '#6366f1', fontSize: '0.68rem', fontWeight: 700, padding: '1px 7px', borderRadius: '4px' }}>{ext}</span>)}
                  </div>
                </div>
              </label>
            )}

            {/* 미리보기 (직접 수정 가능) */}
            {previewData.length > 0 && (
              <div style={{ border: `1px solid ${Object.keys(failedRows).length > 0 ? '#fecdd3' : '#e5e8eb'}`, borderRadius: '10px', overflow: 'hidden', marginBottom: '14px' }}>
                {/* 실패 행 배너 */}
                {Object.keys(failedRows).length > 0 && (
                  <div style={{ background: '#fff1f2', borderBottom: '1px solid #fecdd3', padding: '8px 14px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '6px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '7px' }}>
                      <span>🚨</span>
                      <span style={{ fontWeight: 700, color: '#e11d48', fontSize: '0.82rem' }}>
                      {failedRows['__unknown__'] ? `${uploadResult?.fail_cnt ?? '일부'}건 실패` : `${Object.keys(failedRows).length}행 실패`}
                    </span>
                    <span style={{ color: '#9f1239', fontSize: '0.75rem' }}>
                      {failedRows['__unknown__'] ? '오류 리포트를 다운로드하거나 수정 후 재업로드하세요.' : '빨간 행을 수정 후 재업로드하세요.'}
                    </span>
                    </div>
                    <div style={{ display: 'flex', gap: '5px' }}>
                      <button onClick={moveToFirstFailedRow}
                        style={{ fontSize: '0.7rem', padding: '2px 9px', borderRadius: '5px', border: '1px solid #fca5a5', background: 'white', color: '#e11d48', cursor: 'pointer', fontWeight: 600 }}>🔴 실패 행으로</button>
                      <button onClick={() => setFailedRows({})} style={{ fontSize: '0.7rem', padding: '2px 8px', borderRadius: '5px', border: '1px solid #e2e8f0', background: 'white', color: '#64748b', cursor: 'pointer' }}>✕</button>
                    </div>
                  </div>
                )}
                <div style={{ background: '#f9fafb', padding: '8px 14px', borderBottom: '1px solid #e5e8eb', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '6px' }}>
                  <span style={{ fontWeight: 700, fontSize: '0.82rem', color: '#191f28', display: 'flex', alignItems: 'center', gap: '6px' }}>
                    📋 미리보기
                    {Object.keys(failedRows).length > 0 && <span style={{ color: '#e11d48', fontSize: '0.73rem' }}>· 🚨 {Object.keys(failedRows).length}행 실패</span>}
                    {Object.keys(editedCells).length > 0 && <span style={{ color: '#e67e22', fontSize: '0.73rem' }}>· ✏ {Object.keys(editedCells).length}행 수정됨</span>}
                  </span>
                  <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                    {Object.keys(editedCells).length > 0 && (
                      <button onClick={() => setEditedCells({})} style={{ fontSize: '0.7rem', padding: '2px 8px', borderRadius: '5px', border: '1px solid #fca5a5', background: 'white', color: '#ef4444', cursor: 'pointer' }}>↩ 수정 초기화</button>
                    )}
                    <span style={{ fontSize: '0.73rem', fontWeight: 700, color: '#3182f6', background: '#ebf3ff', padding: '2px 8px', borderRadius: '20px' }}>총 {totalRows.toLocaleString()}건</span>
                  </div>
                </div>
                <div style={{ overflowX: 'auto', maxHeight: '280px', position: 'relative' }}>
                  {previewLoading && <div style={{ position: 'absolute', inset: 0, background: 'rgba(255,255,255,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 2, fontWeight: 600, color: '#3182f6', fontSize: '0.85rem' }}>로딩 중...</div>}
                  <table className="data-table" style={{ margin: 0, whiteSpace: 'nowrap', border: 'none', fontSize: '0.78rem' }}>
                    <thead style={{ position: 'sticky', top: 0, zIndex: 1 }}>
                      <tr>
                        <th style={{ width: '40px', textAlign: 'center', color: '#8b95a1', background: '#f2f4f6' }}>No.</th>
                        {excelHeaders.map((h, i) => <th key={i}>{h.label}</th>)}
                      </tr>
                    </thead>
                    <tbody>
                      {previewData.map((row, rIdx) => {
                        const rowNum = row._rowNum ?? ((previewPage-1)*previewPageSize+rIdx+1);
                        const rowEdits = editedCells[rowNum] || {};
                        const isEdited = Object.keys(rowEdits).length > 0;
                        const isFailed = failedRows[String(rowNum)] !== undefined && !failedRows['__unknown__'];
                        const failMsg = failedRows[String(rowNum)] || '';
                        const failedColInfos = isFailed ? parseFailedColsFromMsg(failMsg) : [];
                        const failedColIdxSet = new Set(failedColInfos.filter(c => c.colIdx !== null).map(c => c.colIdx));
                        const friendlyMsg = isFailed ? friendlyFailMsg(failMsg) : '';
                        return (
                          <React.Fragment key={rIdx}>
                            <tr style={{ background: isFailed ? '#fff1f2' : isEdited ? '#fffbeb' : undefined, boxShadow: isFailed ? 'inset 3px 0 0 #ef4444' : undefined }}>
                              <td style={{ textAlign: 'center', color: isFailed ? '#e11d48' : '#b0b8c1', background: isFailed ? '#fee2e2' : isEdited ? '#fef9c3' : '#f9fafb', fontWeight: 700, borderRight: '1px solid #e5e8eb', fontSize: '0.73rem', minWidth: '40px', verticalAlign: 'middle' }}>
                                {rowNum}
                                {isFailed && <span style={{ display: 'block', fontSize: '0.62rem', color: '#e11d48' }}>❌</span>}
                                {!isFailed && isEdited && <span style={{ color: '#e67e22' }}>✏</span>}
                              </td>
                              {excelHeaders.map((_, cIdx) => {
                                const orig = Array.isArray(row) ? (row[cIdx]||'') : (row[String(cIdx)]||'');
                                const disp = rowEdits[cIdx] !== undefined ? rowEdits[cIdx] : orig;
                                const isCE = rowEdits[cIdx] !== undefined && rowEdits[cIdx] !== orig;
                                const isErrCol = isFailed && failedColIdxSet.has(cIdx);
                                return (
                                  <td key={cIdx} style={{ padding: 0, position: 'relative' }}>
                                    {isErrCol && (
                                      <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: '2px', background: '#ef4444', zIndex: 1 }} />
                                    )}
                                    <input
                                      value={disp}
                                      onChange={e => { const nv=e.target.value; setEditedCells(prev => { const pr=prev[rowNum]||{}; if(nv===orig){const {[cIdx]:_,...rest}=pr;if(!Object.keys(rest).length){const {[rowNum]:__,...rr}=prev;return rr;}return {...prev,[rowNum]:rest};}return {...prev,[rowNum]:{...pr,[cIdx]:nv}};}); }}
                                      style={{ width:'100%', boxSizing:'border-box', padding:'6px 9px', border:'none', outline: isErrCol ? '2px solid #ef4444' : 'none', outlineOffset: '-2px', background: isCE ? '#fef3c7' : isErrCol ? '#fee2e2' : isFailed ? '#fff8f8' : 'transparent', fontSize:'0.78rem', fontFamily:'inherit', color:'#191f28', fontWeight: isErrCol ? 700 : 400 }}
                                      onFocus={e => { e.target.style.background = '#f0f7ff'; }}
                                      onBlur={e => { e.target.style.background = isCE ? '#fef3c7' : isErrCol ? '#fee2e2' : isFailed ? '#fff8f8' : 'transparent'; }}
                                    />
                                  </td>
                                );
                              })}
                            </tr>
                            {/* 오류 메시지 행 */}
                            {isFailed && (
                              <tr style={{ background: '#fff1f2' }}>
                                <td style={{ background: '#fee2e2', borderRight: '1px solid #fecdd3', borderBottom: '2px solid #fca5a5' }} />
                                <td colSpan={excelHeaders.length} style={{ padding: '5px 10px 7px', borderBottom: '2px solid #fca5a5', background: '#fff1f2' }}>
                                  <div style={{ display: 'flex', alignItems: 'flex-start', gap: '8px', flexWrap: 'wrap' }}>
                                    <span style={{ background: '#fee2e2', color: '#e11d48', fontWeight: 700, fontSize: '0.7rem', padding: '2px 7px', borderRadius: '4px', whiteSpace: 'nowrap', flexShrink: 0 }}>
                                      ❌ {friendlyMsg}
                                    </span>
                                    {failedColInfos.filter(c => c.colLabel).map((c, i) => (
                                      <span key={i} style={{ background: '#fef3c7', color: '#92400e', fontWeight: 600, fontSize: '0.7rem', padding: '2px 7px', borderRadius: '4px', whiteSpace: 'nowrap', flexShrink: 0 }}>
                                        📌 {c.colLabel} 컬럼
                                      </span>
                                    ))}
                                    <span style={{ color: '#9f1239', fontSize: '0.68rem', lineHeight: 1.4, wordBreak: 'break-all' }}>
                                      {failMsg}
                                    </span>
                                  </div>
                                </td>
                              </tr>
                            )}
                          </React.Fragment>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                {previewTotalPages > 1 && (
                  <div style={{ padding: '6px 12px', borderTop: '1px solid #e5e8eb', display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: '#f9fafb', flexWrap: 'wrap', gap: '5px' }}>
                    <span style={{ fontSize: '0.72rem', color: '#8b95a1' }}>{((previewPage-1)*previewPageSize+1).toLocaleString()} ~ {Math.min(previewPage*previewPageSize,totalRows).toLocaleString()}행 / 전체 {totalRows.toLocaleString()}건</span>
                    <div style={{ display: 'flex', gap: '3px' }}>
                      {[['«',1],['‹',previewPage-1],...Array.from({length:Math.min(5,previewTotalPages)},(_,i)=>{let p;if(previewTotalPages<=5)p=i+1;else if(previewPage<=3)p=i+1;else if(previewPage>=previewTotalPages-2)p=previewTotalPages-4+i;else p=previewPage-2+i;return[p,p];}),...[['›',previewPage+1],['»',previewTotalPages]]].map(([label,pg],i) => (
                        <button key={i} onClick={() => { if(pg>=1&&pg<=previewTotalPages){setPreviewPage(pg);fetchPreviewPage(file,pg,headerRow,null);}}} disabled={pg<1||pg>previewTotalPages||previewLoading}
                          style={{ minWidth:'26px',height:'26px',padding:'0 4px',borderRadius:'4px',border:'1px solid',borderColor:pg===previewPage?'#3182f6':'#e5e8eb',background:pg===previewPage?'#3182f6':'white',color:pg===previewPage?'white':(pg<1||pg>previewTotalPages||previewLoading)?'#d1d5db':'#333',fontWeight:pg===previewPage?700:400,fontSize:'0.72rem',cursor:pg<1||pg>previewTotalPages?'not-allowed':'pointer' }}>
                          {label}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* 업로드 실행 버튼 */}
            {file && (() => {
              const hasFailed = Object.keys(failedRows).length > 0;
              return (
                <div style={{ padding: '16px 20px', background: hasFailed ? 'linear-gradient(135deg,#fff1f2,#fef2f2)' : 'linear-gradient(135deg,#eef2ff,#f5f3ff)', borderRadius: '12px', border: hasFailed ? '1px solid #fecdd3' : '1px solid #e0e7ff', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px', flexWrap: 'wrap' }}>
                  <div>
                    <div style={{ fontWeight: 700, color: '#1e293b', fontSize: '0.9rem' }}>
                      {hasFailed ? `🚨 ${Object.keys(failedRows).length}건 실패 — 수정 후 재업로드` : '업로드 준비 완료'}
                    </div>
                    <div style={{ color: '#64748b', fontSize: '0.78rem', marginTop: '2px' }}>
                      {previewLoading ? '데이터 분석 중...' : hasFailed ? '빨간 행의 셀을 클릭해 직접 수정하세요.' : `총 ${totalRows.toLocaleString()}건을 전송합니다`}
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
                    {isAdmin && renderDebugUploadOptions(true)}
                    {hasFailed && (
                      <button onClick={() => { setFailedRows({}); setEditedCells({}); }} style={{ padding: '9px 16px', borderRadius: '9px', border: '1px solid #e2e8f0', background: 'white', color: '#64748b', fontWeight: 600, cursor: 'pointer', fontSize: '0.82rem' }}>초기화</button>
                    )}
                    <button onClick={handleUpload} disabled={previewLoading}
                      style={{ padding: '11px 28px', borderRadius: '10px', border: 'none', background: previewLoading ? '#e2e8f0' : hasFailed ? 'linear-gradient(135deg,#ef4444,#dc2626)' : 'linear-gradient(135deg,#6366f1,#8b5cf6)', color: previewLoading ? '#94a3b8' : 'white', fontWeight: 800, cursor: previewLoading ? 'not-allowed' : 'pointer', fontSize: '0.9rem', display: 'inline-flex', alignItems: 'center', gap: '7px', boxShadow: previewLoading ? 'none' : hasFailed ? '0 4px 14px rgba(239,68,68,0.3)' : '0 4px 14px rgba(99,102,241,0.3)', whiteSpace: 'nowrap' }}>
                      {hasFailed ? '🔄 수정 후 재업로드' : '🚀 업로드 실행'}
                    </button>
                  </div>
                </div>
              );
            })()}
          </>
        )}
      </div>
    </div>
  );

  // ─── 렌더: 사용자 STEP 0 ─────────────────────
  const renderUserStep0 = () => (
    <div className="wizard-panel">
      <div style={{ textAlign: 'center', marginBottom: '28px' }}>
        <div style={{ fontSize: '2.8rem', marginBottom: '10px' }}>📋</div>
        <div className="wizard-panel-title">{jobName || 'Excel 업로드'}</div>
        <div className="wizard-panel-desc">시작 전 아래 안내 사항을 확인해주세요.</div>
      </div>
      {instructions && (
        <div style={{ background: '#EBF3FF', border: '1px solid #BDDCFF', borderRadius: '12px', padding: '18px 22px', marginBottom: '18px' }}>
          <div style={{ fontWeight: 700, color: '#1B6CF2', fontSize: '0.85rem', marginBottom: '6px' }}>📢 관리자 안내 및 주의사항</div>
          <div style={{ color: '#1B4FBF', fontSize: '0.88rem', lineHeight: 1.7, whiteSpace: 'pre-wrap' }}>{instructions}</div>
        </div>
      )}
      {sampleFileName && (
        <div style={{ background: '#f0fdf4', border: '1px solid #a7f3d0', borderRadius: '12px', padding: '18px 22px', marginBottom: '18px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '16px', flexWrap: 'wrap' }}>
          <div>
            <div style={{ fontWeight: 700, color: '#065f46', fontSize: '0.95rem' }}>📥 샘플 양식 파일</div>
            <div style={{ color: '#059669', fontSize: '0.82rem', marginTop: '3px' }}>양식에 맞게 작성한 후 업로드해주세요.</div>
          </div>
          <button onClick={downloadSampleFile} style={{ padding: '10px 18px', borderRadius: '10px', border: 'none', background: '#10b981', color: 'white', fontWeight: 700, cursor: 'pointer', fontSize: '0.85rem', whiteSpace: 'nowrap' }}>⬇️ 양식 다운로드</button>
        </div>
      )}
      <div style={{ background: '#fff8ed', border: '1px solid #fed7aa', borderRadius: '12px', padding: '14px 18px' }}>
        <div style={{ fontWeight: 700, color: '#c2410c', marginBottom: '6px', fontSize: '0.85rem' }}>⚠️ 공통 주의사항</div>
        <ul style={{ margin: 0, paddingLeft: '18px', color: '#9a3412', fontSize: '0.83rem', lineHeight: 1.8 }}>
          <li>.xls 또는 .xlsx 형식만 지원합니다.</li>
          <li>DRM(보안) 해제된 파일만 업로드 가능합니다.</li>
          <li>업로드 완료 전 브라우저를 닫지 마세요.</li>
        </ul>
      </div>
    </div>
  );



  // ─── 렌더: 사용자 STEP 1 (파일선택 + 작업대 + 결과) ─
  const renderUserStep1 = () => {
    const hasFile = !!file;
    const hasPreview = previewData.length > 0;
    const knownFailedRows = getKnownFailedRowNumbers();
    const hasKnownFailedRows = knownFailedRows.length > 0;
    const hasUnknownFailedRows = !!failedRows.__unknown__;
    const failedRowCount = hasUnknownFailedRows ? (uploadResult?.fail_cnt || Object.keys(failedRows).length) : knownFailedRows.length;
    const editedRowCount = Object.keys(editedCells).length;
    const currentSelectedErrorIndex = selectedErrorRow ? knownFailedRows.indexOf(selectedErrorRow) : -1;
    const displayedUploadLogs = showDetailedUploadLogs ? uploadLogs : uploadLogs.slice(-8);
    const stageInfo = getUploadStageInfo();
    const validationTone = !hasFile ? 'idle' : previewLoading ? 'loading' : hasKnownFailedRows || hasUnknownFailedRows ? 'warning' : hasPreview ? 'ready' : 'idle';
    const validationSummaryText = !hasFile
      ? '업로드할 엑셀 파일을 선택하면 사전 점검 결과와 작업 화면이 준비됩니다.'
      : previewLoading
        ? '파일 구조를 분석하고 미리보기 데이터를 불러오는 중입니다.'
        : hasUnknownFailedRows
          ? '실패 건은 확인됐지만 정확한 행을 특정하지 못했습니다. 오류 리포트를 함께 확인해 주세요.'
          : hasKnownFailedRows
            ? `${failedRowCount}개 행에 오류가 있습니다. 수정 후 다시 업로드하면 됩니다.`
            : hasPreview
              ? '업로드 가능한 상태입니다. 필요한 값만 검토하고 바로 전송할 수 있습니다.'
              : '파일 정보를 기다리고 있습니다.';
    const stageSteps = [
      { key: 'analyze', label: '파일 분석' },
      { key: 'validate', label: '데이터 검증' },
      { key: 'saving', label: 'DB 저장' },
      { key: 'done', label: '결과 정리' },
    ];
    const uploadReadyLabel = hasKnownFailedRows || hasUnknownFailedRows ? '수정 후 재업로드 준비' : '업로드 준비 완료';
    const uploadReadyDesc = previewLoading
      ? '데이터 분석이 끝나면 전송 버튼이 활성 흐름으로 전환됩니다.'
      : hasUnknownFailedRows
        ? '오류 리포트를 확인하거나 데이터를 보정한 뒤 다시 시도해 주세요.'
        : hasKnownFailedRows
          ? '빨간 행과 강조된 셀을 수정한 뒤 다시 업로드해 주세요.'
          : `총 ${totalRows.toLocaleString()}건을 업로드합니다.`;
    const filteredPreviewData = showOnlyFailedRows
      ? previewData.filter(row => {
          const originalIndex = previewData.indexOf(row);
          const rowNum = row._rowNum ?? ((previewPage - 1) * previewPageSize + originalIndex + 1);
          return failedRows[String(rowNum)] !== undefined && !failedRows.__unknown__;
        })
      : previewData;

    const openCorrectionWorkbench = () => {
      if (uploadResult?.failed_row_msgs && Object.keys(uploadResult.failed_row_msgs).length > 0) {
        setFailedRows(uploadResult.failed_row_msgs);
        const validKeys = Object.keys(uploadResult.failed_row_msgs).filter(k => k !== '__unknown__');
        if (validKeys.length > 0) {
          const firstFail = Math.min(...validKeys.map(Number));
          setSelectedErrorRow(firstFail);
          const pg = Math.ceil(firstFail / previewPageSize);
          if (pg !== previewPage && pg >= 1) {
            setPreviewPage(pg);
            fetchPreviewPage(file, pg, headerRow, null);
          }
        }
      }
      setUploadResult(null);
    };

    return (
      <div className="wizard-panel">
        <div className="wizard-panel-title">📂 파일 업로드 작업대</div>
        <div className="wizard-panel-desc">
          {uploading
            ? '현재 업로드가 진행 중입니다. 단계별 진행 상황과 로그를 확인할 수 있습니다.'
            : uploadResult
              ? '업로드 결과를 확인하고, 필요하면 바로 후속 작업을 이어서 진행하세요.'
              : '파일 점검부터 오류 수정, 업로드 실행까지 한 화면에서 이어서 진행합니다.'}
        </div>

        {uploadResult ? (
          <div className="upload-flow-stack">
            <div className={`result-hero result-${uploadResult.status === 'ok' ? 'ok' : uploadResult.status === 'partial' ? 'partial' : 'err'}`}>
              <div className="result-hero-icon">{uploadResult.status === 'ok' ? '✅' : uploadResult.status === 'partial' ? '⚠️' : '❌'}</div>
              <div className="result-hero-content">
                <div className="result-hero-title">
                  {uploadResult.status === 'ok' ? '업로드가 정상적으로 완료되었습니다.' : uploadResult.status === 'partial' ? '일부 행 업로드에 실패했습니다.' : '업로드 중 오류가 발생했습니다.'}
                </div>
                <div className="result-hero-desc">
                  {uploadResult.status === 'ok'
                    ? (uploadResult.msg || '데이터 저장이 완료되었습니다.')
                    : uploadResult.status === 'partial'
                      ? '실패한 행만 다시 점검해 재업로드하거나, 오류 리포트를 내려받아 원인을 확인할 수 있습니다.'
                      : (uploadResult.friendlyMsg || uploadResult.msg)}
                </div>
              </div>
            </div>

            <div className="upload-stats-grid">
              <div className="upload-stat-card">
                <div className="upload-stat-label">성공 건수</div>
                <div className="upload-stat-value success">{uploadResult.success_cnt?.toLocaleString?.() || 0}</div>
              </div>
              <div className="upload-stat-card">
                <div className="upload-stat-label">실패 건수</div>
                <div className="upload-stat-value danger">{uploadResult.fail_cnt?.toLocaleString?.() || 0}</div>
              </div>
              <div className="upload-stat-card">
                <div className="upload-stat-label">다음 액션</div>
                <div className="upload-stat-note">
                  {uploadResult.status === 'ok' ? '새 파일 업로드 또는 최근 이력 확인' : '실패 행 수정 또는 오류 리포트 확인'}
                </div>
              </div>
            </div>

            {uploadResult.status === 'partial' && uploadResult.failed_row_msgs && Object.keys(uploadResult.failed_row_msgs).filter(k => k !== '__unknown__').length > 0 && (
              <div className="result-list-card">
                <div className="result-list-title">오류 발생 행 요약</div>
                <div className="result-list-wrap">
                  <table className="result-list-table">
                    <thead>
                      <tr>
                        <th>행 번호</th>
                        <th>오류 내용</th>
                      </tr>
                    </thead>
                    <tbody>
                      {Object.entries(uploadResult.failed_row_msgs)
                        .filter(([k]) => k !== '__unknown__')
                        .sort(([a], [b]) => Number(a) - Number(b))
                        .map(([rowNum, errMsg]) => {
                          const translated = translateError(errMsg);
                          return (
                            <tr key={rowNum}>
                              <td>{rowNum}행</td>
                              <td>
                                {translated.friendlyMsg}
                                {translated.solution && <div className="result-list-tip">💡 {translated.solution}</div>}
                              </td>
                            </tr>
                          );
                        })}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {uploadResult.status === 'err' && (
              <div className="result-list-card result-list-card-error">
                <div className="result-list-title">상세 원인</div>
                <div className="result-error-raw">{uploadResult.msg}</div>
                {uploadResult.solution && <div className="result-list-tip">💡 {uploadResult.solution}</div>}
              </div>
            )}

            <div className="result-action-grid">
              {uploadResult.status !== 'ok' && file && (
                <button className="result-action-card action-primary" onClick={openCorrectionWorkbench}>
                  <span className="result-action-title">미리보기에서 바로 수정</span>
                  <span className="result-action-desc">실패 행을 다시 불러와서 빨간 셀만 수정합니다.</span>
                </button>
              )}
              {uploadResult.error_file && (
                <button className="result-action-card action-danger" onClick={() => downloadErrorReport(uploadResult.error_file)}>
                  <span className="result-action-title">오류 리포트 다운로드</span>
                  <span className="result-action-desc">엑셀 또는 운영 확인용으로 상세 오류 내역을 내려받습니다.</span>
                </button>
              )}
              <button className="result-action-card action-neutral" onClick={() => { setUploadResult(null); setUploadLogs([]); setProgress({ current: 0, total: 0, percent: 0 }); resetCorrectionState(); clearSelectedFile(); }}>
                <span className="result-action-title">다른 파일 업로드</span>
                <span className="result-action-desc">현재 결과를 닫고 새 파일로 다시 시작합니다.</span>
              </button>
            </div>

            {historyList.length > 0 && (
              <div style={{ marginTop: '8px' }}>
                <div className="wiz-section-title" style={{ marginBottom: '10px' }}>📜 최근 업로드 이력</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', maxHeight: '200px', overflowY: 'auto' }}>
                  {historyList.slice(0, 5).map((h, i) => (
                    <div key={i} className="history-item">
                      <div className="history-item-header"><span className="history-item-job">{h.job_name}</span><span className="history-item-time">{h.reg_dttm?.substring(0, 16)}</span></div>
                      <div className="history-item-file">📁 {h.file_name}</div>
                      <div className="history-item-stats">
                        <span className="stat-chip success">✅ {h.success_cnt?.toLocaleString()}건 성공</span>
                        {(h.fail_cnt > 0 || h.error_file) && <span className="stat-chip fail" onClick={() => downloadErrorReport(h.error_file)}>🚨 {h.fail_cnt?.toLocaleString() || 0}건 실패</span>}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        ) : uploading ? (
          <div className="upload-flow-stack">
            <div className="progress-hero-card">
              <div className="progress-hero-top">
                <div>
                  <div className="progress-hero-title">{stageInfo.label}</div>
                  <div className="progress-hero-desc">{stageInfo.desc}</div>
                </div>
                <div className="progress-hero-percent">{progress.percent}%</div>
              </div>
              <div className="progress-stage-strip">
                {stageSteps.map((step, idx) => {
                  const activeIndex = stageSteps.findIndex(s => s.key === stageInfo.key);
                  const isDone = idx < activeIndex || progress.percent >= 100;
                  const isActive = idx === activeIndex && progress.percent < 100;
                  return (
                    <div key={step.key} className={`progress-stage-item ${isDone ? 'done' : ''} ${isActive ? 'active' : ''}`}>
                      <div className="progress-stage-dot">{isDone ? '✓' : idx + 1}</div>
                      <div className="progress-stage-label">{step.label}</div>
                    </div>
                  );
                })}
              </div>
              <div className="progress-bar-shell">
                <div className="progress-bar-shell-fill" style={{ width: `${progress.percent}%` }} />
              </div>
              <div className="progress-meta-row">
                <span>{progress.current.toLocaleString()} / {progress.total.toLocaleString()} 건</span>
                <span>창을 닫지 말고 완료 메시지를 기다려주세요.</span>
              </div>
            </div>

            <div className="upload-workspace-grid">
              <div className="workspace-card workspace-card-terminal">
                <div className="workspace-card-title">실시간 업로드 로그</div>
                <div className="workspace-card-desc">현재 단계에서 처리된 내용이 순서대로 표시됩니다.</div>
                <div className="log-toolbar">
                  <span className="log-toolbar-note">{showDetailedUploadLogs ? '전체 로그를 보고 있습니다.' : '최근 로그 8개만 간단히 표시 중입니다.'}</span>
                  <button className="inline-control-btn" onClick={() => setShowDetailedUploadLogs(prev => !prev)}>
                    {showDetailedUploadLogs ? '간단히 보기' : '전체 로그 보기'}
                  </button>
                </div>
                <div className="terminal-log" style={{ marginTop: '14px', height: showDetailedUploadLogs ? '260px' : '190px' }}>
                  {displayedUploadLogs.map((log, i) => (
                    <div key={i} style={{ marginBottom: '2px', color: log.includes('❌') ? '#f87171' : log.includes('🎉') ? '#fbbf24' : '#4ade80', paddingBottom: '2px', borderBottom: '1px solid rgba(255,255,255,0.05)' }}>{log}</div>
                  ))}
                  <div ref={logEndRef} />
                </div>
              </div>

              <div className="workspace-side-stack">
                <div className="workspace-card">
                  <div className="workspace-card-title">현재 작업 상태</div>
                  <div className="summary-chip-list" style={{ marginTop: '14px' }}>
                    <span className="summary-chip">파일: {file?.name || '-'}</span>
                    <span className="summary-chip">예상 건수: {totalRows.toLocaleString()}</span>
                    <span className="summary-chip">헤더: {excelHeaders.length}개</span>
                  </div>
                </div>
                <div className="workspace-card workspace-card-guide">
                  <div className="workspace-card-title">안내</div>
                  <div className="workspace-guide-list">
                    <div>업로드가 끝나면 결과 화면에서 바로 수정 또는 재업로드를 선택할 수 있습니다.</div>
                    <div>브라우저를 새로고침하면 진행 로그가 사라질 수 있으니 완료 후 이동해 주세요.</div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        ) : (
          <div className="upload-flow-stack">
            <div className="upload-overview-grid">
              <div className={`overview-card overview-card-${validationTone}`}>
                <div className="overview-card-label">검증 상태</div>
                <div className="overview-card-title">{!hasFile ? '파일 대기' : previewLoading ? '파일 분석 중' : hasKnownFailedRows || hasUnknownFailedRows ? '수정 필요' : '업로드 가능'}</div>
                <div className="overview-card-desc">{validationSummaryText}</div>
              </div>
              <div className="overview-card">
                <div className="overview-card-label">파일 정보</div>
                <div className="overview-card-title">{hasFile ? file.name : '선택된 파일 없음'}</div>
                <div className="summary-chip-list">
                  {hasFile ? (
                    <>
                      <span className="summary-chip">{formatFileSize(file.size)}</span>
                      <span className="summary-chip">헤더 {excelHeaders.length}개</span>
                      <span className="summary-chip">총 {totalRows.toLocaleString()}건</span>
                    </>
                  ) : (
                    <>
                      <span className="summary-chip">.xls / .xlsx</span>
                      <span className="summary-chip">DRM 해제 필요</span>
                    </>
                  )}
                </div>
              </div>
              <div className="overview-card">
                <div className="overview-card-label">작업 메모</div>
                <div className="overview-card-title">{hasKnownFailedRows ? `${failedRowCount}개 행 점검 필요` : editedRowCount > 0 ? `${editedRowCount}개 행 수정 완료` : '업로드 전 최종 점검'}</div>
                <div className="overview-card-desc">
                  {hasUnknownFailedRows
                    ? '실패 행 번호를 특정하지 못한 경우 오류 리포트를 우선 확인해 주세요.'
                    : hasKnownFailedRows
                      ? '실패 행 이동 버튼으로 바로 문제 구간으로 갈 수 있습니다.'
                      : editedRowCount > 0
                        ? '수정한 값이 반영된 상태로 업로드됩니다.'
                        : '샘플 양식과 헤더 수를 한 번 더 확인하면 좋습니다.'}
                </div>
              </div>
            </div>

            {!hasFile ? (
              <div className="upload-workspace-grid">
                <div className="workspace-card workspace-card-drop">
                  <div className="workspace-card-title">파일 업로드</div>
                  <div className="workspace-card-desc">양식에 맞는 엑셀 파일을 선택하면 사전 점검과 작업 화면이 바로 열립니다.</div>
                  <label
                    htmlFor="fileInput"
                    className={`redesign-dropzone ${isDragging ? 'dragging' : ''}`}
                    onDragOver={e => { e.preventDefault(); setIsDragging(true); }}
                    onDragLeave={e => { e.preventDefault(); setIsDragging(false); }}
                    onDrop={e => { e.preventDefault(); setIsDragging(false); const f = e.dataTransfer.files[0]; if (f && (f.name.endsWith('.xlsx') || f.name.endsWith('.xls'))) processSelectedFile(f); else if (f) toast.error('❌ .xls/.xlsx만 가능합니다.'); }}
                  >
                    <input type="file" id="fileInput" accept=".xls,.xlsx" style={{ display: 'none' }} onChange={e => { const f = e.target.files[0]; if (f) processSelectedFile(f); }} />
                    <div className="redesign-dropzone-icon">{isDragging ? '📂' : '📤'}</div>
                    <div className="redesign-dropzone-title">{isDragging ? '여기에 놓아주세요' : '파일을 드래그하거나 클릭해 선택하세요'}</div>
                    <div className="redesign-dropzone-desc">업로드 전 자동으로 헤더와 데이터 건수를 점검합니다.</div>
                    <div className="summary-chip-list centered">
                      <span className="summary-chip">.xls</span>
                      <span className="summary-chip">.xlsx</span>
                      <span className="summary-chip">DRM 해제</span>
                    </div>
                  </label>
                </div>

                <div className="workspace-side-stack">
                  {sampleFileName && (
                    <div className="workspace-card workspace-card-guide">
                      <div className="workspace-card-title">양식 먼저 확인</div>
                      <div className="workspace-guide-list">
                        <div>관리자가 제공한 샘플 양식으로 작성하면 오류를 크게 줄일 수 있습니다.</div>
                        <div>대표 컬럼 형식과 입력 규칙을 먼저 확인해 두세요.</div>
                      </div>
                      <button className="side-action-btn side-action-btn-green" onClick={downloadSampleFile}>⬇️ 샘플 양식 다운로드</button>
                    </div>
                  )}
                  <div className="workspace-card">
                    <div className="workspace-card-title">업로드 전 체크</div>
                    <div className="workspace-guide-list">
                      <div>헤더 줄 위치가 실제 양식과 맞는지 확인합니다.</div>
                      <div>빈 칸, 중복값, 길이 초과 가능성이 큰 컬럼을 먼저 살펴보세요.</div>
                      <div>대량 업로드 중에는 브라우저를 닫지 않는 것이 안전합니다.</div>
                    </div>
                  </div>
                </div>
              </div>
            ) : (
              <>
                <div className="upload-workspace-grid">
                  <div className="workspace-main-stack">
                    <div className="workspace-card">
                      <div className="workspace-card-head">
                        <div>
                          <div className="workspace-card-title">업로드 대상 파일</div>
                          <div className="workspace-card-desc">파일 분석이 끝나면 아래 작업대에서 바로 수정과 점검을 진행할 수 있습니다.</div>
                        </div>
                        <button className="side-action-btn side-action-btn-danger" onClick={() => clearSelectedFile()}>파일 제거</button>
                      </div>
                      <div className="summary-chip-list">
                        <span className="summary-chip strong">{file.name}</span>
                        <span className="summary-chip">{formatFileSize(file.size)}</span>
                        <span className="summary-chip">헤더 {excelHeaders.length}개</span>
                        <span className="summary-chip">데이터 {totalRows.toLocaleString()}건</span>
                      </div>
                    </div>

                    <div className="workspace-card">
                      <div className="workspace-card-head">
                        <div>
                          <div className="workspace-card-title">오류 수정 작업대</div>
                          <div className="workspace-card-desc">오류가 있는 행은 빨간색, 수정한 행은 노란색으로 표시됩니다.</div>
                        </div>
                        <div className="summary-chip-list">
                          {hasKnownFailedRows && <span className="summary-chip danger">오류 {failedRowCount}행</span>}
                          {editedRowCount > 0 && <span className="summary-chip warning">수정 {editedRowCount}행</span>}
                          <span className="summary-chip">전체 {totalRows.toLocaleString()}건</span>
                        </div>
                      </div>

                      {Object.keys(failedRows).length > 0 && (
                        <div className="error-banner-redesign">
                          <div>
                            <div className="error-banner-title">{hasUnknownFailedRows ? `${uploadResult?.fail_cnt ?? failedRowCount}건 실패` : `${failedRowCount}개 행에 오류가 있습니다.`}</div>
                            <div className="error-banner-desc">{hasUnknownFailedRows ? '정확한 행 번호를 특정하지 못했습니다. 오류 리포트와 원문 로그를 함께 확인해 주세요.' : '실패 행 이동으로 첫 문제 구간으로 이동한 뒤, 빨간 셀만 수정하면 됩니다.'}</div>
                          </div>
                          <div className="error-banner-actions">
                            {hasKnownFailedRows && <button className="side-action-btn side-action-btn-danger" onClick={moveToFirstFailedRow}>첫 실패 행으로 이동</button>}
                            <button className="side-action-btn" onClick={resetCorrectionState}>표시 초기화</button>
                          </div>
                        </div>
                      )}

                      {hasPreview && (
                        <>
                          <div className="workbench-toolbar">
                            <div className="workbench-toolbar-left">
                              <button
                                className={`inline-control-btn ${showOnlyFailedRows ? 'active' : ''}`}
                                onClick={() => setShowOnlyFailedRows(prev => !prev)}
                                disabled={!hasKnownFailedRows}
                              >
                                {showOnlyFailedRows ? '전체 행 보기' : '오류 행만 보기'}
                              </button>
                              {editedRowCount > 0 && (
                                <button className="inline-control-btn" onClick={() => setEditedCells({})}>
                                  수정한 행 초기화
                                </button>
                              )}
                            </div>
                            {hasKnownFailedRows && (
                              <div className="error-nav-cluster">
                                <span className="error-nav-status">
                                  {currentSelectedErrorIndex >= 0
                                    ? `오류 ${currentSelectedErrorIndex + 1} / ${knownFailedRows.length}`
                                    : `오류 ${knownFailedRows.length}건`}
                                </span>
                                <button className="inline-control-btn" onClick={() => moveBetweenFailedRows(-1)}>이전 오류</button>
                                <button className="inline-control-btn" onClick={() => moveBetweenFailedRows(1)}>다음 오류</button>
                              </div>
                            )}
                          </div>

                          {showOnlyFailedRows && filteredPreviewData.length === 0 && hasKnownFailedRows && (
                            <div className="table-empty-state">
                              <div className="table-empty-title">현재 페이지에는 오류 행이 없습니다.</div>
                              <div className="table-empty-desc">다음 오류 버튼을 누르면 오류가 있는 페이지로 바로 이동할 수 있습니다.</div>
                            </div>
                          )}

                          <div style={{ overflowX: 'auto', maxHeight: '360px', position: 'relative', border: '1px solid #e5e8eb', borderRadius: '14px' }}>
                            {previewLoading && <div style={{ position: 'absolute', inset: 0, background: 'rgba(255,255,255,0.72)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 2, fontWeight: 700, color: '#3182f6' }}>미리보기 갱신 중...</div>}
                            <table className="data-table" style={{ margin: 0, whiteSpace: 'nowrap', border: 'none' }}>
                              <thead style={{ position: 'sticky', top: 0, zIndex: 1 }}>
                                <tr>
                                  <th style={{ width: '46px', textAlign: 'center', color: '#8b95a1', background: '#f2f4f6' }}>No.</th>
                                  {excelHeaders.map((h, i) => <th key={i}>{h.label}</th>)}
                                </tr>
                              </thead>
                              <tbody>
                                {filteredPreviewData.map((row, rIdx) => {
                                  const originalIndex = previewData.indexOf(row);
                                  const rowNum = row._rowNum ?? ((previewPage - 1) * previewPageSize + originalIndex + 1);
                                  const rowEdits = editedCells[rowNum] || {};
                                  const isEdited = Object.keys(rowEdits).length > 0;
                                  const isFailed = failedRows[String(rowNum)] !== undefined && !failedRows.__unknown__;
                                  const isCurrentError = selectedErrorRow === rowNum;
                                  const failMsg = failedRows[String(rowNum)] || '';
                                  const failedColInfos = isFailed ? parseFailedColsFromMsg(failMsg) : [];
                                  const failedColIdxSet = new Set(failedColInfos.filter(c => c.colIdx !== null).map(c => c.colIdx));
                                  const friendlyMsg = isFailed ? friendlyFailMsg(failMsg) : '';
                                  return (
                                    <React.Fragment key={rIdx}>
                                      <tr style={{ background: isCurrentError ? '#ffe4e6' : isFailed ? '#fff1f2' : isEdited ? '#fffbeb' : undefined, boxShadow: isCurrentError ? 'inset 4px 0 0 #be123c' : isFailed ? 'inset 3px 0 0 #ef4444' : undefined }}>
                                        <td style={{ textAlign: 'center', color: isFailed ? '#e11d48' : '#b0b8c1', background: isCurrentError ? '#fecdd3' : isFailed ? '#fee2e2' : isEdited ? '#fef9c3' : '#f9fafb', fontWeight: 700, borderRight: '1px solid #e5e8eb', fontSize: '0.76rem', minWidth: '46px', verticalAlign: 'middle' }}>
                                          {rowNum}
                                          {isCurrentError && <span style={{ display: 'block', fontSize: '0.62rem', color: '#9f1239' }}>NOW</span>}
                                          {!isCurrentError && isFailed && <span style={{ display: 'block', fontSize: '0.65rem', color: '#e11d48' }}>❌</span>}
                                          {!isFailed && isEdited && <span style={{ color: '#e67e22' }}>✏</span>}
                                        </td>
                                        {excelHeaders.map((_, cIdx) => {
                                          const orig = Array.isArray(row) ? (row[cIdx] || '') : (row[String(cIdx)] || '');
                                          const disp = rowEdits[cIdx] !== undefined ? rowEdits[cIdx] : orig;
                                          const isCE = rowEdits[cIdx] !== undefined && rowEdits[cIdx] !== orig;
                                          const isErrCol = isFailed && failedColIdxSet.has(cIdx);
                                          return (
                                            <td key={cIdx} style={{ padding: 0, position: 'relative' }}>
                                              {isErrCol && <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: '2px', background: '#ef4444', zIndex: 1 }} />}
                                              <input
                                                value={disp}
                                                onChange={e => {
                                                  const nv = e.target.value;
                                                  setEditedCells(prev => {
                                                    const pr = prev[rowNum] || {};
                                                    if (nv === orig) {
                                                      const { [cIdx]: _, ...rest } = pr;
                                                      if (!Object.keys(rest).length) {
                                                        const { [rowNum]: __, ...rr } = prev;
                                                        return rr;
                                                      }
                                                      return { ...prev, [rowNum]: rest };
                                                    }
                                                    return { ...prev, [rowNum]: { ...pr, [cIdx]: nv } };
                                                  });
                                                }}
                                                style={{ width: '100%', boxSizing: 'border-box', padding: '7px 10px', border: 'none', outline: isErrCol ? '2px solid #ef4444' : 'none', outlineOffset: '-2px', background: isCE ? '#fef3c7' : isErrCol ? '#fee2e2' : isFailed ? '#fff8f8' : 'transparent', fontSize: '0.8rem', fontFamily: 'inherit', color: '#191f28', fontWeight: isErrCol ? 700 : 400 }}
                                                onFocus={e => { e.target.style.background = '#f0f7ff'; }}
                                                onBlur={e => { e.target.style.background = isCE ? '#fef3c7' : isErrCol ? '#fee2e2' : isFailed ? '#fff8f8' : 'transparent'; }}
                                              />
                                            </td>
                                          );
                                        })}
                                      </tr>
                                      {isFailed && (
                                        <tr style={{ background: '#fff1f2' }}>
                                          <td style={{ background: '#fee2e2', borderRight: '1px solid #fecdd3', borderBottom: '2px solid #fca5a5' }} />
                                          <td colSpan={excelHeaders.length} style={{ padding: '5px 10px 7px', borderBottom: '2px solid #fca5a5', background: '#fff1f2' }}>
                                            <div style={{ display: 'flex', alignItems: 'flex-start', gap: '8px', flexWrap: 'wrap' }}>
                                              <span style={{ background: '#fee2e2', color: '#e11d48', fontWeight: 700, fontSize: '0.72rem', padding: '2px 8px', borderRadius: '4px', whiteSpace: 'nowrap', flexShrink: 0 }}>
                                                ❌ {friendlyMsg}
                                              </span>
                                              {failedColInfos.filter(c => c.colLabel).map((c, i) => (
                                                <span key={i} style={{ background: '#fef3c7', color: '#92400e', fontWeight: 600, fontSize: '0.72rem', padding: '2px 8px', borderRadius: '4px', whiteSpace: 'nowrap', flexShrink: 0 }}>
                                                  📌 {c.colLabel} 컬럼
                                                </span>
                                              ))}
                                              <span style={{ color: '#9f1239', fontSize: '0.68rem', lineHeight: 1.5, wordBreak: 'break-all' }}>
                                                {failMsg}
                                              </span>
                                            </div>
                                          </td>
                                        </tr>
                                      )}
                                    </React.Fragment>
                                  );
                                })}
                              </tbody>
                            </table>
                          </div>

                          {previewTotalPages > 1 && (
                            <div style={{ padding: '10px 14px', borderTop: '1px solid #e5e8eb', display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: '#f9fafb', flexWrap: 'wrap', gap: '6px' }}>
                              <span style={{ fontSize: '0.76rem', color: '#8b95a1' }}>{((previewPage - 1) * previewPageSize + 1).toLocaleString()} ~ {Math.min(previewPage * previewPageSize, totalRows).toLocaleString()}행 / 전체 {totalRows.toLocaleString()}건</span>
                              <div style={{ display: 'flex', gap: '3px' }}>
                                {[['«', 1], ['‹', previewPage - 1], ...Array.from({ length: Math.min(5, previewTotalPages) }, (_, i) => {
                                  let p;
                                  if (previewTotalPages <= 5) p = i + 1;
                                  else if (previewPage <= 3) p = i + 1;
                                  else if (previewPage >= previewTotalPages - 2) p = previewTotalPages - 4 + i;
                                  else p = previewPage - 2 + i;
                                  return [p, p];
                                }), ...[['›', previewPage + 1], ['»', previewTotalPages]]].map(([label, pg], i) => (
                                  <button
                                    key={i}
                                    onClick={() => { if (pg >= 1 && pg <= previewTotalPages) { setPreviewPage(pg); fetchPreviewPage(file, pg, headerRow, null); } }}
                                    disabled={pg < 1 || pg > previewTotalPages || previewLoading}
                                    style={{ minWidth: '28px', height: '28px', padding: '0 5px', borderRadius: '5px', border: '1px solid', borderColor: pg === previewPage ? '#3182f6' : '#e5e8eb', background: pg === previewPage ? '#3182f6' : 'white', color: pg === previewPage ? 'white' : (pg < 1 || pg > previewTotalPages || previewLoading) ? '#d1d5db' : '#333', fontWeight: pg === previewPage ? 700 : 400, fontSize: '0.76rem', cursor: pg < 1 || pg > previewTotalPages ? 'not-allowed' : 'pointer' }}
                                  >
                                    {label}
                                  </button>
                                ))}
                              </div>
                            </div>
                          )}
                        </>
                      )}
                    </div>
                  </div>

                  <div className="workspace-side-stack">
                    <div className={`workspace-card workspace-card-${hasKnownFailedRows || hasUnknownFailedRows ? 'warning' : 'positive'}`}>
                      <div className="workspace-card-title">{uploadReadyLabel}</div>
                      <div className="workspace-card-desc">{uploadReadyDesc}</div>
                      <div className="workspace-guide-list compact">
                        <div>헤더 기준: {headerRow}행</div>
                        <div>수정된 행: {editedRowCount}건</div>
                        <div>오류 행: {failedRowCount}건</div>
                      </div>
                      {isAdmin && <div style={{ marginTop: '14px' }}>{renderDebugUploadOptions(false)}</div>}
                      <div className="workspace-action-stack">
                        {hasKnownFailedRows && <button className="side-action-btn side-action-btn-danger" onClick={selectedErrorRow ? () => moveBetweenFailedRows(1) : moveToFirstFailedRow}>{selectedErrorRow ? '다음 오류 확인' : '첫 오류 확인'}</button>}
                        {editedRowCount > 0 && <button className="side-action-btn" onClick={() => setEditedCells({})}>수정 내용 초기화</button>}
                        <button className="side-action-btn side-action-btn-primary" onClick={handleUpload} disabled={previewLoading}>
                          {hasKnownFailedRows || hasUnknownFailedRows ? '수정 후 재업로드' : '업로드 실행'}
                        </button>
                      </div>
                    </div>

                    <div className="workspace-card">
                      <div className="workspace-card-title">작업 가이드</div>
                      <div className="workspace-guide-list">
                        <div>오류 행은 빨간색 띠와 함께 표시됩니다.</div>
                        <div>강조된 셀만 수정하면 나머지 값은 그대로 유지됩니다.</div>
                        <div>문제가 없는 경우 바로 업로드 실행으로 넘어가면 됩니다.</div>
                      </div>
                    </div>

                    {historyList.length > 0 && (
                      <div className="workspace-card">
                        <div className="workspace-card-title">최근 업로드 이력</div>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', maxHeight: '220px', overflowY: 'auto', marginTop: '12px' }}>
                          {historyList.slice(0, 5).map((h, i) => (
                            <div key={i} className="history-item">
                              <div className="history-item-header"><span className="history-item-job">{h.job_name}</span><span className="history-item-time">{h.reg_dttm?.substring(0, 16)}</span></div>
                              <div className="history-item-file">📁 {h.file_name}</div>
                              <div className="history-item-stats">
                                <span className="stat-chip success">✅ {h.success_cnt?.toLocaleString()}건 성공</span>
                                {(h.fail_cnt > 0 || h.error_file) && <span className="stat-chip fail" onClick={() => downloadErrorReport(h.error_file)}>🚨 {h.fail_cnt?.toLocaleString() || 0}건 실패</span>}
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </>
            )}
          </div>
        )}
      </div>
    );
  };

  const renderStep = () => {
    if (isAdmin) return [renderAdminStep0, renderAdminStep1, renderAdminStep2, renderAdminStep3][currentStep]?.();
    return [renderUserStep0, renderUserStep1][currentStep]?.();
  };

  const nextLabel = isAdmin && currentStep === 2 ? '💾 저장하기' : '다음 →';
  const hideNextBtn = !isAdmin && currentStep === 1;
  const isLastStep = isAdmin ? currentStep === 3 : currentStep === 1;

  return (
    <div style={{ minHeight: '100vh', background: '#f8fafc' }}>
      <ToastContainer position="top-left" autoClose={3000} style={{ position: 'fixed', zIndex: 99999 }} />

      {/* 헤더 */}
      <div style={{ background: 'white', borderBottom: '1px solid #e2e8f0', padding: '0 32px' }}>
        <div style={{ maxWidth: '100%', margin: '0 auto', height: '60px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <div style={{ width: '34px', height: '34px', borderRadius: '9px', background: 'linear-gradient(135deg,#6366f1,#8b5cf6)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '17px' }}>📊</div>
            <div>
              <div style={{ fontWeight: 800, fontSize: '0.95rem', color: '#0f172a' }}>{isAdmin ? 'Excel Easy Loader' : (jobName || 'Excel Upload')}</div>
              {uploadId && <div style={{ fontSize: '0.68rem', color: '#94a3b8' }}>ID: {uploadId}</div>}
            </div>
          </div>
          <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
            <button onClick={() => window.location.href = '?view=dashboard'} style={{ background: 'transparent', border: '1px solid #e2e8f0', color: '#64748b', borderRadius: '8px', padding: '0 14px', height: '34px', fontSize: '0.8rem', fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}>📊 대시보드</button>
            {isAdmin && (
              <div style={{ position: 'relative' }}>
                <button
                  onClick={() => { setShowLoaderPanel(p => { if (!p) loadLoaderList(); return !p; }); }}
                  style={{ background: showLoaderPanel ? '#6366f1' : 'transparent', border: '1px solid #e2e8f0', color: showLoaderPanel ? 'white' : '#64748b', borderRadius: '8px', padding: '0 14px', height: '34px', fontSize: '0.8rem', fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', transition: 'all 0.15s' }}>
                  📋 로더 목록
                </button>
                {showLoaderPanel && (
                  <div style={{ position: 'absolute', top: '42px', right: 0, width: '440px', background: 'white', borderRadius: '14px', boxShadow: '0 8px 32px rgba(0,0,0,0.15)', border: '1px solid #e2e8f0', zIndex: 9999, overflow: 'hidden' }}>
                    {/* 패널 헤더 */}
                    <div style={{ padding: '14px 18px', background: 'linear-gradient(135deg,#6366f1,#8b5cf6)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                      <span style={{ fontWeight: 700, fontSize: '0.9rem', color: 'white' }}>📋 로더 목록</span>
                      <div style={{ display: 'flex', gap: '6px' }}>
                        <button onClick={loadLoaderList} style={{ background: 'rgba(255,255,255,0.2)', border: 'none', color: 'white', borderRadius: '6px', padding: '4px 10px', fontSize: '0.75rem', cursor: 'pointer', fontFamily: 'inherit' }}>🔄 새로고침</button>
                        <button onClick={() => window.location.href = '?admin=true'} style={{ background: 'rgba(255,255,255,0.2)', border: 'none', color: 'white', borderRadius: '6px', padding: '4px 10px', fontSize: '0.75rem', cursor: 'pointer', fontFamily: 'inherit' }}>➕ 신규</button>
                        <button onClick={() => setShowLoaderPanel(false)} style={{ background: 'transparent', border: 'none', color: 'white', fontSize: '1rem', cursor: 'pointer', lineHeight: 1, padding: '0 4px' }}>✕</button>
                      </div>
                    </div>
                    {/* 목록 */}
                    <div style={{ maxHeight: '440px', overflowY: 'auto', padding: '6px 0' }}>
                      {loaderPanelLoading ? (
                        <div style={{ padding: '28px', textAlign: 'center', color: '#94a3b8', fontSize: '0.85rem' }}>불러오는 중...</div>
                      ) : loaderList.length === 0 ? (
                        <div style={{ padding: '28px', textAlign: 'center', color: '#94a3b8', fontSize: '0.85rem' }}>등록된 로더가 없습니다.</div>
                      ) : loaderList.map(item => (
                        <div key={item.upload_id} style={{ padding: '10px 16px', borderBottom: '1px solid #f8fafc', display: 'flex', alignItems: 'center', gap: '10px', background: uploadId === item.upload_id ? '#f0f0ff' : 'white', transition: 'background 0.1s' }}>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ fontWeight: 600, fontSize: '0.85rem', color: '#0f172a', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', display: 'flex', alignItems: 'center', gap: '6px' }}>
                              {uploadId === item.upload_id && <span style={{ background: '#6366f1', color: 'white', fontSize: '0.62rem', padding: '1px 6px', borderRadius: '4px', flexShrink: 0 }}>편집중</span>}
                              {item.job_name || '(이름 없음)'}
                            </div>
                            <div style={{ fontSize: '0.7rem', color: '#94a3b8', marginTop: '2px' }}>{item.reg_dttm?.substring(0, 16)} · 헤더 {item.header_row}행</div>
                          </div>
                          <div style={{ display: 'flex', gap: '4px', flexShrink: 0 }}>
                            <button onClick={() => { window.location.href = `?admin=true&upload_id=${item.upload_id}`; }} title="편집" style={{ padding: '4px 10px', borderRadius: '6px', border: '1px solid #e2e8f0', background: 'white', color: '#6366f1', fontSize: '0.75rem', cursor: 'pointer', fontWeight: 600 }}>✏️ 편집</button>
                            <button onClick={() => handleCloneLoader(item.upload_id, item.job_name)} title="복제" style={{ padding: '4px 10px', borderRadius: '6px', border: '1px solid #e2e8f0', background: 'white', color: '#10b981', fontSize: '0.75rem', cursor: 'pointer', fontWeight: 600 }}>📋 복제</button>
                            <button onClick={() => handleDeleteLoader(item.upload_id, item.job_name)} title="삭제" style={{ padding: '4px 10px', borderRadius: '6px', border: '1px solid #fee2e2', background: 'white', color: '#ef4444', fontSize: '0.75rem', cursor: 'pointer', fontWeight: 600 }}>🗑️</button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* 본문 */}
      <div style={{ maxWidth: '100%', margin: '0 auto', padding: '36px 24px 80px' }}>
        <StepIndicator steps={steps} current={currentStep} />

        <div style={{ background: 'white', borderRadius: '16px', boxShadow: '0 1px 3px rgba(0,0,0,0.07), 0 4px 20px rgba(0,0,0,0.04)', border: '1px solid #f1f5f9', overflow: 'hidden' }}>
          {renderStep()}

          {/* 네비게이션 */}
          {!isLastStep && (
            <div style={{ padding: '18px 32px', borderTop: '1px solid #f1f5f9', display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: '#fafafa' }}>
              <button onClick={goPrev} disabled={currentStep === 0} style={{ padding: '10px 22px', borderRadius: '10px', border: '1px solid #e2e8f0', background: 'white', color: currentStep === 0 ? '#cbd5e1' : '#475569', fontWeight: 600, cursor: currentStep === 0 ? 'not-allowed' : 'pointer', fontSize: '0.88rem' }}>
                ← 이전
              </button>
              <span style={{ fontSize: '0.75rem', color: '#94a3b8' }}>{currentStep + 1} / {steps.length}</span>
              {!hideNextBtn ? (
                <button onClick={goNext} disabled={!canGoNext()} style={{ padding: '10px 26px', borderRadius: '10px', border: 'none', background: canGoNext() ? 'linear-gradient(135deg,#6366f1,#8b5cf6)' : '#e2e8f0', color: canGoNext() ? 'white' : '#94a3b8', fontWeight: 700, cursor: canGoNext() ? 'pointer' : 'not-allowed', fontSize: '0.88rem', boxShadow: canGoNext() ? '0 2px 8px rgba(99,102,241,0.28)' : 'none' }}>
                  {nextLabel}
                </button>
              ) : <div />}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default ExcelApp;
