import React, { useState, useEffect, useRef, useMemo, lazy, Suspense } from 'react';
import Select from 'react-select';
import { ToastContainer, toast } from 'react-toastify';
import 'react-toastify/dist/ReactToastify.css';
import Swal from 'sweetalert2';
import './App.css';

import CodeMirror from '@uiw/react-codemirror';
import { sql } from '@codemirror/lang-sql';
const AdminWizardScreen = lazy(() => import('./components/AdminWizardScreen'));
const UserUploadScreen = lazy(() => import('./components/UserUploadScreen'));

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
  const [uploadJobId, setUploadJobId] = useState('');
  const [cancellingUpload, setCancellingUpload] = useState(false);
  const [validating, setValidating] = useState(false);
  const [showOnlyFailedRows, setShowOnlyFailedRows] = useState(false);
  const [selectedErrorRow, setSelectedErrorRow] = useState(null);
  const [showDetailedUploadLogs, setShowDetailedUploadLogs] = useState(false);
  const [debugDetailEnabled, setDebugDetailEnabled] = useState(false);
  const [debugRowLimit, setDebugRowLimit] = useState(20);
  const [retryPolicy, setRetryPolicy] = useState('failed_only'); // failed_only | failed_and_edited | fail_type
  const [retryFailTypes, setRetryFailTypes] = useState([]);
  const [alertEnabled, setAlertEnabled] = useState(false);
  const [alertWebhookUrl, setAlertWebhookUrl] = useState('');
  const [alertFailRateThreshold, setAlertFailRateThreshold] = useState(30);
  const [alertFailCountThreshold, setAlertFailCountThreshold] = useState(50);
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
  const uploadWatchdogRef = useRef({ timerId: null, lastEventAt: 0, warned: false });
  const alertCfgLoadedRef = useRef(false);
  const alertCfgSaveTimerRef = useRef(null);
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
  const classifyFailTypeClient = (rawMsg) => {
    const m = (rawMsg || '').toLowerCase();
    if (!m) return '기타';
    if (m.includes('null') && (m.includes('not') || m.includes('cannot'))) return '필수값 누락';
    if (m.includes('unique') || m.includes('duplicate') || m.includes('중복')) return '중복키';
    if (m.includes('too long') || m.includes('data too long') || m.includes('length') || m.includes('max')) return '길이초과';
    if (m.includes('number') || m.includes('numeric') || m.includes('숫자')) return '숫자형식';
    if (m.includes('date') || m.includes('time') || m.includes('yyyy')) return '날짜형식';
    if (m.includes('foreign key') || m.includes('referential') || m.includes('fk')) return '참조무결성';
    if (m.includes('timeout') || m.includes('timed out')) return '타임아웃';
    return '기타';
  };
  const sendOpsAlert = async (eventType, payload = {}, dedupKey = '') => {
    if (!alertEnabled || !uploadId) return;
    try {
      const body = {
        mode: 'send_alert',
        upload_id: uploadId,
        event_type: eventType,
        payload_json: JSON.stringify({ event_time: new Date().toISOString(), job_name: jobName || null, ...payload }),
      };
      if (dedupKey) body.dedup_key = dedupKey;
      const res = await post(API_URL, getParams(body));
      if (res.status === 'ok' || res.status === 'skip') {
        setUploadLogs(prev => [...prev, `📣 운영 알림 처리 (${eventType}): ${res.msg || res.status}`].slice(-120));
        return;
      }
      setUploadLogs(prev => [...prev, `⚠ 운영 알림 처리 실패: ${res.msg || 'server error'}`].slice(-120));
    } catch (e) {
      setUploadLogs(prev => [...prev, `⚠ 운영 알림 전송 실패: ${e.message || 'network error'}`].slice(-120));
    }
  };
  const stopUploadWatchdog = () => {
    const t = uploadWatchdogRef.current?.timerId;
    if (t) {
      clearInterval(t);
    }
    uploadWatchdogRef.current = { timerId: null, lastEventAt: 0, warned: false };
  };
  const touchUploadWatchdog = () => {
    uploadWatchdogRef.current.lastEventAt = Date.now();
    uploadWatchdogRef.current.warned = false;
  };
  const startUploadWatchdog = () => {
    stopUploadWatchdog();
    uploadWatchdogRef.current.lastEventAt = Date.now();
    uploadWatchdogRef.current.warned = false;
    uploadWatchdogRef.current.timerId = setInterval(() => {
      const elapsed = Date.now() - (uploadWatchdogRef.current.lastEventAt || Date.now());
      if (elapsed > 30000 && !uploadWatchdogRef.current.warned) {
        setUploadLogs(prev => [...prev, '⏱ 진행 로그 수신이 지연되고 있습니다. 서버 처리 상태를 계속 확인 중입니다.'].slice(-120));
        uploadWatchdogRef.current.warned = true;
      }
    }, 5000);
  };

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
    if (!uploadId) return;
    alertCfgLoadedRef.current = false;
    post(API_URL, getParams({ mode: 'get_alert_config', upload_id: uploadId })).then((res) => {
      if (res.status !== 'ok') {
        alertCfgLoadedRef.current = true;
        return;
      }
      setAlertEnabled(!!res.enabled);
      setAlertWebhookUrl(res.webhook_url || '');
      setAlertFailRateThreshold(Number(res.fail_rate_threshold) || 30);
      setAlertFailCountThreshold(Number(res.fail_count_threshold) || 50);
      alertCfgLoadedRef.current = true;
    });
  }, [uploadId]);
  useEffect(() => {
    if (!uploadId || !alertCfgLoadedRef.current) return;
    if (alertCfgSaveTimerRef.current) clearTimeout(alertCfgSaveTimerRef.current);
    alertCfgSaveTimerRef.current = setTimeout(() => {
      post(API_URL, getParams({
        mode: 'save_alert_config',
        upload_id: uploadId,
        enabled: alertEnabled ? 'Y' : 'N',
        webhook_url: alertWebhookUrl || '',
        fail_rate_threshold: String(Number(alertFailRateThreshold) || 30),
        fail_count_threshold: String(Number(alertFailCountThreshold) || 50),
      }));
    }, 500);
  }, [uploadId, alertEnabled, alertWebhookUrl, alertFailRateThreshold, alertFailCountThreshold]);
  useEffect(() => () => {
    if (esRef.current) {
      esRef.current.close();
      esRef.current = null;
    }
    if (alertCfgSaveTimerRef.current) clearTimeout(alertCfgSaveTimerRef.current);
    stopUploadWatchdog();
  }, []);

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
        setStructs(s);
        setPreSqls(safeJsonParse(res.pre_sql_json, [{ sql: '' }]));
        setPostSqls(safeJsonParse(res.post_sql_json, [{ sql: '' }]));
        setRowSqls(safeJsonParse(res.row_sql_json, [{ sql: '' }]));
        setSampleFileName(res.sample_file_name || '');
        setSampleFileDownloadName(res.sample_file_org_name || '');
        setInstructions(res.instructions || '');
        const loadedEntries = await Promise.all(s.map(async item => {
          if (!item.table) return [item.table, []];
          const cols = await loadCols(item.table);
          return [item.table, cols];
        }));
        const loadedColsCache = loadedEntries.reduce((acc, [tableName, cols]) => {
          if (tableName) acc[tableName] = cols;
          return acc;
        }, {});
        setMapping(sanitizeMappingForStructs(m, s, loadedColsCache));
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

  const sanitizeMappingForStructs = (rawMapping, targetStructs = structs, targetColsCache = colsCache) => {
    const sanitized = {};
    const validAliases = new Set(targetStructs.map(item => item.alias));

    targetStructs.forEach(item => {
      const alias = item.alias;
      const aliasMapping = rawMapping?.[alias] || {};
      const tableCols = targetColsCache[item.table] || [];

      if (!item.table || !tableCols.length) {
        sanitized[alias] = {};
        return;
      }

      const validColSet = new Set(tableCols.map(col => col.value));
      sanitized[alias] = Object.fromEntries(
        Object.entries(aliasMapping).filter(([dbCol, mapVal]) => validColSet.has(dbCol) && mapVal)
      );
    });

    Object.keys(sanitized).forEach(alias => {
      if (!validAliases.has(alias)) delete sanitized[alias];
    });

    if (!sanitized.ROOT) sanitized.ROOT = {};
    return sanitized;
  };

  const ensureStructColumnsLoaded = async (targetStructs = structs) => {
    const nextColsCache = { ...colsCache };
    for (const item of targetStructs) {
      if (item.table && !nextColsCache[item.table]?.length) {
        nextColsCache[item.table] = await loadCols(item.table);
      }
    }
    return nextColsCache;
  };

  const handleStructTableChange = async (index, tableName) => {
    const nextStructs = [...structs];
    nextStructs[index] = {
      ...nextStructs[index],
      table: tableName || '',
      pk_col: '',
      upsert_keys: [],
    };
    setStructs(nextStructs);

    if (tableName) await loadCols(tableName);

    const alias = nextStructs[index].alias;
    setMapping(prev => ({
      ...prev,
      [alias]: {},
    }));
  };

  const handleStructAliasChange = (index, nextAliasRaw) => {
    const prevAlias = structs[index].alias;
    const nextAlias = (nextAliasRaw || '').trim();
    const nextStructs = [...structs];
    nextStructs[index] = { ...nextStructs[index], alias: nextAlias };
    nextStructs.forEach((item, itemIndex) => {
      if (itemIndex !== index && item.parent === prevAlias) {
        nextStructs[itemIndex] = { ...item, parent: nextAlias };
      }
    });
    setStructs(nextStructs);
    setMapping(prev => {
      const nextMapping = { ...prev };
      const aliasMapping = nextMapping[prevAlias] || {};
      delete nextMapping[prevAlias];
      nextMapping[nextAlias] = aliasMapping;
      return nextMapping;
    });
    if (activeAlias === prevAlias) setActiveAlias(nextAlias || 'ROOT');
  };

  const handleRemoveStruct = (index) => {
    const removedAlias = structs[index]?.alias;
    const nextStructs = structs.filter((_, idx) => idx !== index).map(item => (
      item.parent === removedAlias ? { ...item, parent: 'ROOT' } : item
    ));
    setStructs(nextStructs);
    setMapping(prev => {
      const nextMapping = { ...prev };
      delete nextMapping[removedAlias];
      return sanitizeMappingForStructs(nextMapping, nextStructs, colsCache);
    });
    if (activeAlias === removedAlias) setActiveAlias('ROOT');
  };

  const handleSave = async () => {
    const tid = toast.loading('💾 저장 중...');
    const preparedColsCache = await ensureStructColumnsLoaded(structs);
    const sanitizedMapping = sanitizeMappingForStructs(mapping, structs, preparedColsCache);
    setMapping(sanitizedMapping);
    const fd = new FormData();
    fd.append('mode', 'save'); fd.append('upload_id', uploadId); fd.append('job_name', jobName); fd.append('header_row', headerRow);
    fd.append('struct_json_b64', encodeSafeBase64(JSON.stringify(structs)));
    fd.append('mapping_json_b64', encodeSafeBase64(JSON.stringify(sanitizedMapping)));
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
    if (msg.includes('사용자 요청으로 업로드가 취소')) return { friendlyMsg: '사용자 요청으로 업로드가 취소되었습니다.', solution: '파일과 설정을 확인한 뒤 다시 실행할 수 있습니다.' };
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

  const retryTypeRowMap = useMemo(() => {
    const map = {};
    Object.entries(failedRows).forEach(([rowKey, msg]) => {
      if (rowKey === '__unknown__') return;
      const rowNum = Number(rowKey);
      if (!Number.isFinite(rowNum) || rowNum <= 0) return;
      const t = classifyFailTypeClient(msg);
      if (!map[t]) map[t] = [];
      map[t].push(rowNum);
    });
    Object.keys(map).forEach((k) => map[k].sort((a, b) => a - b));
    return map;
  }, [failedRows]);

  const retryTypeOptions = useMemo(
    () => Object.keys(retryTypeRowMap).sort((a, b) => retryTypeRowMap[b].length - retryTypeRowMap[a].length),
    [retryTypeRowMap]
  );

  const getRetryTargetRows = (mode) => {
    const failedOnly = getKnownFailedRowNumbers();
    if (mode === 'failed_only') {
      return failedOnly;
    }
    if (mode === 'failed_and_edited') {
      const editedOnly = Object.keys(editedCells)
        .map((k) => Number(k))
        .filter((n) => Number.isFinite(n) && n > 0);
      return Array.from(new Set([...failedOnly, ...editedOnly])).sort((a, b) => a - b);
    }
    if (mode === 'fail_type') {
      const rows = [];
      retryFailTypes.forEach((t) => {
        const arr = retryTypeRowMap[t] || [];
        rows.push(...arr);
      });
      return Array.from(new Set(rows)).sort((a, b) => a - b);
    }
    return [];
  };

  const runPolicyRetry = () => handleUpload({ retryMode: retryPolicy });

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
      <div style={{ marginTop: '12px', borderTop: '1px dashed #cbd5e1', paddingTop: '10px' }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: '10px', cursor: 'pointer' }}>
          <input
            type="checkbox"
            checked={alertEnabled}
            onChange={(e) => setAlertEnabled(e.target.checked)}
            style={{ width: '16px', height: '16px', accentColor: '#0ea5e9' }}
          />
          <span style={{ fontWeight: 700, color: '#1e293b', fontSize: compact ? '0.82rem' : '0.86rem' }}>
            운영 알림(Webhook)
          </span>
        </label>
        <input
          type="text"
          value={alertWebhookUrl}
          onChange={(e) => setAlertWebhookUrl(e.target.value)}
          placeholder="Webhook URL"
          disabled={!alertEnabled}
          style={{ width: '100%', marginTop: '8px', padding: '7px 10px', borderRadius: '8px', border: '1px solid #cbd5e1', fontSize: '0.74rem', fontFamily: 'inherit', background: alertEnabled ? 'white' : '#f1f5f9' }}
        />
        <div style={{ display: 'flex', gap: '8px', marginTop: '8px' }}>
          <input
            type="number"
            min="1"
            max="100"
            value={alertFailRateThreshold}
            onChange={(e) => setAlertFailRateThreshold(e.target.value)}
            disabled={!alertEnabled}
            style={{ width: '110px', padding: '6px 8px', borderRadius: '8px', border: '1px solid #cbd5e1', fontSize: '0.73rem', fontFamily: 'inherit', background: alertEnabled ? 'white' : '#f1f5f9' }}
          />
          <input
            type="number"
            min="1"
            value={alertFailCountThreshold}
            onChange={(e) => setAlertFailCountThreshold(e.target.value)}
            disabled={!alertEnabled}
            style={{ width: '120px', padding: '6px 8px', borderRadius: '8px', border: '1px solid #cbd5e1', fontSize: '0.73rem', fontFamily: 'inherit', background: alertEnabled ? 'white' : '#f1f5f9' }}
          />
        </div>
        <div style={{ fontSize: '0.7rem', color: '#64748b', marginTop: '5px' }}>
          실패율(%) / 실패건수 임계치 초과 시 알림 전송
        </div>
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

  const buildValidationSummary = (failedMap) => {
    const byType = {};
    const byColumn = {};
    let unknownCnt = 0;
    let totalErrItems = 0;

    Object.entries(failedMap || {}).forEach(([rowKey, msg]) => {
      if (rowKey === '__unknown__') {
        unknownCnt += 1;
        return;
      }
      const parsed = parseFailedColsFromMsg(msg);
      if (!parsed.length) {
        const fallbackType = friendlyFailMsg(msg);
        byType[fallbackType] = (byType[fallbackType] || 0) + 1;
        byColumn['행 특정 불가'] = (byColumn['행 특정 불가'] || 0) + 1;
        totalErrItems += 1;
        return;
      }
      parsed.forEach(item => {
        const typeKey = item.errType || friendlyFailMsg(msg);
        const colKey = item.colLabel || item.dbCol || '행 특정 불가';
        byType[typeKey] = (byType[typeKey] || 0) + 1;
        byColumn[colKey] = (byColumn[colKey] || 0) + 1;
        totalErrItems += 1;
      });
    });

    const topTypes = Object.entries(byType).sort((a, b) => b[1] - a[1]).slice(0, 5);
    const topColumns = Object.entries(byColumn).sort((a, b) => b[1] - a[1]).slice(0, 8);

    return {
      totalErrItems,
      unknownCnt,
      topTypes,
      topColumns,
    };
  };

  const validationSummary = buildValidationSummary(failedRows);

  const handleUpload = async (options = {}) => {
    if (!file) return;
    const retryMode = options?.retryMode
      ? options.retryMode
      : (options?.retryFailedOnly ? 'failed_only' : 'full_upload');
    const retryTargetRows = getRetryTargetRows(retryMode);
    const useTargetRows = retryMode !== 'full_upload' && retryTargetRows.length > 0;
    if (retryMode !== 'full_upload' && !useTargetRows) {
      toast.warn('재처리 대상 행이 없습니다.');
      return;
    }
    const retrySummaryBase = useTargetRows ? {
      mode: retryMode,
      target_count: retryTargetRows.length,
      before_fail_count: Object.keys(failedRows).filter(k => k !== '__unknown__').length,
    } : null;
    const cr = await Swal.fire({ title: '데이터 업로드 실행', html: '데이터를 서버로 전송하시겠습니까?<br><small style="color:#ef4444">대량 데이터는 수 분이 소요될 수 있습니다.</small>', icon: 'question', showCancelButton: true, confirmButtonColor: '#6366f1', cancelButtonColor: '#94a3b8', confirmButtonText: '🚀 진행', cancelButtonText: '취소', reverseButtons: true });
    if (!cr.isConfirmed) return;

    setUploading(true); setProgress({ current: 0, total: 0, percent: 0 }); setUploadLogs([useTargetRows ? '🎯 실패행 재처리를 시작합니다...' : '🚀 파일 전송을 시작합니다...']); setUploadResult(null);
    sseCompletedRef.current = false; // SSE 완료 플래그 초기화
    const jobId = 'JOB_' + Date.now();
    setUploadJobId(jobId);
    setCancellingUpload(false);
    startUploadWatchdog();

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
          touchUploadWatchdog();
          setProgress({ current: data.current, total: data.total, percent: data.percent });
          if (data.logs?.length > 0) {
            setUploadLogs(prev => [...prev, ...data.logs].slice(-100));
          }
        } else if (data.type === 'done') {
          // 업로드 완료 — SSE 스트림 닫기 (fetch 응답 처리는 아래에서)
          sseCompletedRef.current = true; // JEUS 타임아웃으로 fetch가 끊겨도 성공 처리하기 위한 플래그
          es.close(); esRef.current = null;
        } else if (data.type === 'error') {
          touchUploadWatchdog();
          setUploadLogs(prev => [...prev, `💣 오류: ${data.msg}`]);
          es.close(); esRef.current = null;
        } else if (data.type === 'waiting') {
          touchUploadWatchdog();
          setUploadLogs(prev => {
            if (prev.some(v => v.includes('작업 대기 중'))) return prev;
            return [...prev, '⌛ 작업 대기 중... 서버 준비를 확인하고 있습니다.'].slice(-100);
          });
        }
        // type === 'waiting' 은 무시 (업로드 요청 도달 전 대기 상태)
      } catch { /* JSON 파싱 실패 무시 */ }
    };

    es.onerror = () => {
      // 연결 오류 — EventSource는 자동 재연결을 시도하므로
      // 업로드가 완전히 끝난 경우에만 닫기
      setUploadLogs(prev => {
        if (prev.some(v => v.includes('SSE 연결이 일시적으로 불안정'))) return prev;
        return [...prev, '⚠ SSE 연결이 일시적으로 불안정합니다. 자동 재연결을 시도합니다.'].slice(-100);
      });
      if (esRef.current && esRef.current.readyState === EventSource.CLOSED) {
        esRef.current = null;
      }
    };

    const preparedColsCache = await ensureStructColumnsLoaded(structs);
    const sanitizedMapping = sanitizeMappingForStructs(mapping, structs, preparedColsCache);
    setMapping(sanitizedMapping);

    const fd = new FormData();
    fd.append('mode', 'upload'); fd.append('job_id', jobId); fd.append('file', file);
    fd.append('header_row', headerRow); fd.append('job_name', jobName || '직접 업로드'); fd.append('file_name', file.name);
    fd.append('struct_json_b64', encodeSafeBase64(JSON.stringify(structs)));
    fd.append('mapping_json_b64', encodeSafeBase64(JSON.stringify(sanitizedMapping)));
    fd.append('pre_sql_json_b64', encodeSafeBase64(JSON.stringify(preSqls)));
    fd.append('post_sql_json_b64', encodeSafeBase64(JSON.stringify(postSqls)));
    fd.append('row_sql_json_b64', encodeSafeBase64(JSON.stringify(rowSqls)));
    if (debugDetailEnabled) {
      fd.append('debug_detail', 'Y');
      fd.append('debug_row_limit', String(Math.min(Math.max(Number(debugRowLimit) || 20, 1), 200)));
    }
    if (Object.keys(editedCells).length > 0) fd.append('edited_rows_b64', encodeSafeBase64(JSON.stringify(editedCells)));
    if (useTargetRows) fd.append('target_rows_b64', encodeSafeBase64(JSON.stringify(retryTargetRows)));
    fd.append('retry_mode', retryMode);
    if (retryMode === 'fail_type' && retryFailTypes.length > 0) {
      fd.append('retry_reason_types', retryFailTypes.join(','));
    }

    const tid = toast.loading(useTargetRows ? '🎯 실패행만 재처리 중...' : '🚀 서버 전송 중...', { position: 'top-left' });
    try {
      const res = await post(API_URL, fd);
      // ── SSE 스트림 정리 ──
      if (esRef.current) { esRef.current.close(); esRef.current = null; }
      stopUploadWatchdog();
      setUploading(false);
      setCancellingUpload(false);
      setUploadJobId('');
      if (res.status === 'ok' || res.status === 'partial') {
        setProgress(p => ({ ...p, current: p.total, percent: 100 }));
        setUploadLogs(prev => [...prev, '🎉 업로드 완료!']);
        loadHistory();

        const successCnt = Number(res.success_cnt) || 0;
        const failCnt = Number(res.fail_cnt) || 0;
        const totalCnt = successCnt + failCnt;
        const failRate = totalCnt > 0 ? (failCnt / totalCnt) * 100 : 0;
        const thresholdRate = Number(alertFailRateThreshold) || 0;
        const thresholdCount = Number(alertFailCountThreshold) || 0;
        if (res.status === 'err' || failCnt >= thresholdCount || failRate >= thresholdRate) {
          void sendOpsAlert('upload_warning', {
            status: res.status,
            file_name: file?.name || '',
            success_cnt: successCnt,
            fail_cnt: failCnt,
            fail_rate: Number(failRate.toFixed(2)),
            retry_mode: retryMode,
          }, `${uploadId}|${retryMode}|upload_warning|${file?.name || ''}|${successCnt}|${failCnt}`);
        }

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
          setUploadResult({ ...res, failed_row_msgs: failedMsgs, retry_summary: retrySummaryBase ? { ...retrySummaryBase, after_fail_count: Object.keys(failedMsgs).filter(k => k !== '__unknown__').length } : null });
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
          setUploadResult({ ...res, retry_summary: retrySummaryBase ? { ...retrySummaryBase, after_fail_count: 0 } : null });
          toast.update(tid, { render: '🎉 완료', type: 'success', isLoading: false, autoClose: 3000 });
          setFile(null); setPreviewData([]); setEditedCells({});
          const el = document.getElementById('fileInput'); if (el) el.value = '';
          const el2 = document.getElementById('adminUploadFileInput'); if (el2) el2.value = '';
        }
      } else {
        // err: 파일 유지, 오류 메시지 + 행 강조
        toast.update(tid, { render: '❌ 실패', type: 'error', isLoading: false, autoClose: 3000 });
        const { friendlyMsg, solution } = translateError(res.msg);
        setUploadResult({ ...res, friendlyMsg, solution, retry_summary: retrySummaryBase });
        void sendOpsAlert('upload_error', {
          status: 'err',
          file_name: file?.name || '',
          msg: res.msg || '',
          retry_mode: retryMode,
        }, `${uploadId}|${retryMode}|upload_error|${file?.name || ''}|${res.msg || ''}`);
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
      stopUploadWatchdog();

      // ── JEUS 타임아웃 대응 ─────────────────────────────────────────
      // SSE로 'done' 신호를 이미 받은 경우 → 서버는 정상 완료됨
      // fetch만 JEUS 타임아웃으로 끊긴 것이므로 성공으로 처리
      if (sseCompletedRef.current) {
        setUploading(false);
        setCancellingUpload(false);
        setUploadJobId('');
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
      setCancellingUpload(false);
      setUploadJobId('');
      toast.update(tid, { render: '❌ 통신 오류 (서버 응답 지연 또는 연결 문제)', type: 'error', isLoading: false, autoClose: 3500 });
      void sendOpsAlert('upload_network_error', {
        file_name: file?.name || '',
        retry_mode: retryMode,
      }, `${uploadId}|${retryMode}|upload_network_error|${file?.name || ''}`);
    }
  };

  const handleCancelUpload = async () => {
    if (!uploading || !uploadJobId || cancellingUpload) return;
    setCancellingUpload(true);
    setUploadLogs(prev => [...prev, '🛑 업로드 취소 요청 중...']);
    try {
      const res = await post(API_URL, getParams({ mode: 'cancel', job_id: uploadJobId }));
      if (res.status === 'ok') {
        setUploadLogs(prev => [...prev, '🛑 취소 요청이 접수되었습니다. 서버가 현재 작업을 정리합니다.']);
        toast.info('취소 요청을 보냈습니다.', { position: 'top-left' });
        void sendOpsAlert('cancel_requested', { job_id: uploadJobId }, `${uploadId}|cancel_requested|${uploadJobId}`);
      } else {
        setUploadLogs(prev => [...prev, `⚠ 취소 요청 실패: ${res.msg || '작업 없음'}`]);
        setCancellingUpload(false);
      }
    } catch {
      setUploadLogs(prev => [...prev, '⚠ 취소 요청 중 네트워크 오류']);
      setCancellingUpload(false);
    }
  };

  const handleValidate = async () => {
    if (!file) return;
    const preparedColsCache = await ensureStructColumnsLoaded(structs);
    const sanitizedMapping = sanitizeMappingForStructs(mapping, structs, preparedColsCache);
    setMapping(sanitizedMapping);

    const fd = new FormData();
    fd.append('mode', 'validate');
    fd.append('file', file);
    fd.append('header_row', headerRow);
    fd.append('struct_json_b64', encodeSafeBase64(JSON.stringify(structs)));
    fd.append('mapping_json_b64', encodeSafeBase64(JSON.stringify(sanitizedMapping)));
    if (Object.keys(editedCells).length > 0) {
      fd.append('edited_rows_b64', encodeSafeBase64(JSON.stringify(editedCells)));
    }

    const tid = toast.loading('🔎 검증 실행 중...', { position: 'top-left' });
    setValidating(true);
    try {
      const res = await post(API_URL, fd);
      if (res.status !== 'ok') {
        toast.update(tid, { render: `❌ 검증 실패: ${res.msg || '서버 오류'}`, type: 'error', isLoading: false, autoClose: 3500 });
        return;
      }

      const failedMsgs = (res.failed_row_msgs && Object.keys(res.failed_row_msgs).length > 0)
        ? res.failed_row_msgs : {};
      setFailedRows(failedMsgs);

      if (Object.keys(failedMsgs).length > 0) {
        toast.update(tid, {
          render: `⚠️ 검증 완료: ${res.fail_cnt || Object.keys(failedMsgs).length}건 오류`,
          type: 'warning',
          isLoading: false,
          autoClose: 4000
        });
        const firstFailedRowNum = Math.min(...Object.keys(failedMsgs).map(Number));
        if (!isNaN(firstFailedRowNum) && firstFailedRowNum > 0) {
          const failedPage = Math.ceil(firstFailedRowNum / previewPageSize);
          if (failedPage !== previewPage && failedPage >= 1) {
            setPreviewPage(failedPage);
            fetchPreviewPage(file, failedPage, headerRow, null);
          }
          setSelectedErrorRow(firstFailedRowNum);
        }
      } else {
        setSelectedErrorRow(null);
        toast.update(tid, { render: '✅ 검증 통과: 업로드 가능', type: 'success', isLoading: false, autoClose: 3000 });
      }
    } catch {
      toast.update(tid, { render: '❌ 검증 중 통신 오류', type: 'error', isLoading: false, autoClose: 3500 });
    } finally {
      setValidating(false);
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

  const userStepProps = {
    jobName,
    instructions,
    sampleFileName,
    downloadSampleFile,
    file,
    previewData,
    failedRows,
    uploadResult,
    previewPageSize,
    previewPage,
    headerRow,
    uploadLogs,
    showDetailedUploadLogs,
    progress,
    totalRows,
    excelHeaders,
    historyList,
    uploading,
    isDragging,
    setIsDragging,
    previewLoading,
    showOnlyFailedRows,
    editedCells,
    selectedErrorRow,
    isAdmin,
    previewTotalPages,
    logEndRef,
    getKnownFailedRowNumbers,
    getUploadStageInfo,
    setFailedRows,
    setSelectedErrorRow,
    setPreviewPage,
    fetchPreviewPage,
    setUploadResult,
    translateError,
    downloadErrorReport,
    setUploadLogs,
    setProgress,
    resetCorrectionState,
    clearSelectedFile,
    setShowDetailedUploadLogs,
    processSelectedFile,
    formatFileSize,
    moveToFirstFailedRow,
    moveBetweenFailedRows,
    parseFailedColsFromMsg,
    friendlyFailMsg,
    setEditedCells,
    renderDebugUploadOptions,
    handleUpload,
    handleCancelUpload,
    cancellingUpload,
    handleValidate,
    validating,
    validationSummary,
    setShowOnlyFailedRows,
    retryPolicy,
    setRetryPolicy,
    retryTypeOptions,
    retryFailTypes,
    setRetryFailTypes,
    runPolicyRetry,
  };

  const adminStepProps = {
    jobName,
    setJobName,
    headerRow,
    setHeaderRow,
    uploadId,
    sampleFile,
    setSampleFile,
    sampleFileName,
    setSampleFileName,
    sampleFileDownloadName,
    setSampleFileDownloadName,
    downloadSampleFile,
    instructions,
    setInstructions,
    structs,
    setStructs,
    tableList,
    loadCols,
    handleStructTableChange,
    handleStructAliasChange,
    handleRemoveStruct,
    colsCache,
    setMapping,
    preSqls,
    setPreSqls,
    postSqls,
    setPostSqls,
    rowSqls,
    setRowSqls,
    SqlEditor,
    MySelect,
    MyMultiSelect,
    file,
    formatFileSize,
    processSelectedFile,
    excelHeaders,
    activeAlias,
    setActiveAlias,
    filteredCols,
    currentAliasMapping,
    searchTerm,
    setSearchTerm,
    pagedCols,
    mappingTotalPages,
    mappingPage,
    setMappingPage,
    updateMappingVal,
    handleReplaceSetup,
    previewLoading,
    isDragging,
    setIsDragging,
    setCurrentStep,
    handleSave,
    uploadResult,
    downloadErrorReport,
    setFailedRows,
    previewPageSize,
    previewPage,
    setPreviewPage,
    fetchPreviewPage,
    setUploadResult,
    setUploadLogs,
    setProgress,
    setFile,
    setPreviewData,
    uploading,
    progress,
    uploadLogs,
    logEndRef,
    totalRows,
    setTotalRows,
    editedCells,
    setEditedCells,
    failedRows,
    moveToFirstFailedRow,
    parseFailedColsFromMsg,
    friendlyFailMsg,
    previewData,
    previewTotalPages,
    renderDebugUploadOptions,
    isAdmin,
    handleUpload,
    handleCancelUpload,
    cancellingUpload,
    handleValidate,
    validating,
    validationSummary,
    retryPolicy,
    setRetryPolicy,
    retryTypeOptions,
    retryFailTypes,
    setRetryFailTypes,
    runPolicyRetry,
  };

  const renderStep = () => {
    if (isAdmin) {
      return (
        <Suspense fallback={<div style={{ padding: '20px', color: '#64748b' }}>관리자 화면 로딩 중...</div>}>
          <AdminWizardScreen
            steps={steps}
            currentStep={currentStep}
            isLastStep={isLastStep}
            goPrev={goPrev}
            goNext={goNext}
            canGoNext={canGoNext()}
            nextLabel={nextLabel}
            adminStepProps={adminStepProps}
          />
        </Suspense>
      );
    }

    return (
      <Suspense fallback={<div style={{ padding: '20px', color: '#64748b' }}>업로드 화면 로딩 중...</div>}>
        <UserUploadScreen
          steps={steps}
          currentStep={currentStep}
          isLastStep={isLastStep}
          goPrev={goPrev}
          goNext={goNext}
          canGoNext={canGoNext()}
          nextLabel={nextLabel}
          hideNextBtn={hideNextBtn}
          userStepProps={userStepProps}
        />
      </Suspense>
    );
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
        {renderStep()}
      </div>
    </div>
  );
}

export default ExcelApp;
