import React, { useState, useEffect, useRef, useMemo, lazy, Suspense } from 'react';
import Select from 'react-select';
import Swal from 'sweetalert2';
import './App.css';
import { translateError as translateUploadError, parseFailedColsFromMsg as parseUploadFailedColsFromMsg, friendlyFailMsg as friendlyUploadFailMsg } from './excelErrorText';

const AdminWizardScreen = lazy(() => import('./components/AdminWizardScreen'));
const UserUploadScreen = lazy(() => import('./components/UserUploadScreen'));

const API_URL = "/api/excel/engine";
const ACTIVE_UPLOAD_STATE_KEY = 'excel_upload_active_state_v1';
const ACTIVE_UPLOAD_HEARTBEAT_MS = 3000;
const COMPLETION_SNAPSHOT_KEY = 'excel_upload_last_completion_v1';
const CURRENT_EMP_ID_KEY = 'excel_upload_current_emp_id';
const CURRENT_MTN_ID_KEY = 'excel_upload_current_mtn_id';
const isUsableMtnId = (value) => {
  const v = String(value || '').trim();
  return !!v && v !== '*';
};
const getCurrentEmpId = () => {
  try {
    const fromGlobal = window.$egene?._user?.emp_id || window.$egene?.emp_id || '';
    if (fromGlobal) {
      localStorage.setItem(CURRENT_EMP_ID_KEY, String(fromGlobal));
      return fromGlobal;
    }
    const fromStorage = localStorage.getItem(CURRENT_EMP_ID_KEY) || '';
    return fromStorage;
  } catch {
    try {
      return localStorage.getItem(CURRENT_EMP_ID_KEY) || '';
    } catch {
      return '';
    }
  }
};
// 2026-06-20: 컬럼 매핑의 "현재 로그인 MTN" 특수값 처리를 위해 런타임 MTN 값을 수집한다.
const getCurrentMtnId = () => {
  try {
    // 2026-06-20: '*' 와일드카드 MTN보다 JSP가 내려준 실제 세션 emp_mtn_id를 우선 사용한다.
    const candidates = [
      window.__EXCEL_UPLOAD_SESSION__?.emp_mtn_id,
      window.__EXCEL_UPLOAD_SESSION__?.mtn_id,
      window.$egene?._user?.emp_mtn_id,
      window.$egene?._user?.mtn_id,
      window.$egene?.mtn?.mtn_id,
      window.$egene?._mtn?.mtn_id,
      window.$egene?.mtn_id,
      window.$egene?.mtn_cd,
      localStorage.getItem(CURRENT_MTN_ID_KEY)
    ];
    const found = candidates.find(isUsableMtnId) || '';
    if (found) {
      localStorage.setItem(CURRENT_MTN_ID_KEY, String(found).trim());
      return String(found).trim();
    }
    return '';
  } catch {
    try {
      const fromStorage = localStorage.getItem(CURRENT_MTN_ID_KEY) || '';
      return isUsableMtnId(fromStorage) ? fromStorage : '';
    } catch {
      return '';
    }
  }
};
const getScopedStorageKey = (baseKey, empId = getCurrentEmpId()) => {
  const id = String(empId || '').trim();
  return id ? `${baseKey}::${encodeURIComponent(id)}` : baseKey;
};

const alertText = (value) => {
  if (value == null) return '';
  if (typeof value === 'string') return value.replace(/\uFFFD/g, '').trim();
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (value?.props?.children) {
    const children = Array.isArray(value.props.children) ? value.props.children : [value.props.children];
    return children.map(alertText).filter(Boolean).join(' ');
  }
  return String(value);
};

const alertIcon = (type) => {
  if (type === 'error') return 'error';
  if (type === 'warning' || type === 'warn') return 'warning';
  if (type === 'info') return 'info';
  return 'success';
};

const showToastAlert = ({ type = 'success', message = '', autoClose = 2200 }) => {
  Swal.close();
  Swal.fire({
    toast: true,
    position: 'top-end',
    icon: alertIcon(type),
    title: message || '처리되었습니다.',
    timer: autoClose,
    timerProgressBar: true,
    showConfirmButton: false,
    showCloseButton: true,
    customClass: {
      popup: 'excel-swal-toast',
    },
  });
};

// 2026-06-20: react-toastify 알림을 SweetAlert2 기반 알림으로 대체한다.
const toast = {
  loading(message) {
    Swal.fire({
      title: alertText(message) || '처리 중...',
      allowOutsideClick: false,
      allowEscapeKey: false,
      didOpen: () => Swal.showLoading(),
    });
    return Date.now();
  },
  update(_id, options = {}) {
    const message = alertText(options.render || options.message);
    if (options.isLoading) {
      Swal.fire({
        title: message || '처리 중...',
        allowOutsideClick: false,
        allowEscapeKey: false,
        didOpen: () => Swal.showLoading(),
      });
      return;
    }
    showToastAlert({
      type: options.type,
      message,
      autoClose: options.autoClose || 2200,
    });

  },
  success(message, options = {}) {
    showToastAlert({ type: 'success', message: alertText(message), autoClose: options.autoClose || 1800 });

  },
  error(message) {
    Swal.fire({ icon: 'error', title: alertText(message), confirmButtonColor: '#6366f1' });
  },
  warn(message) {
    Swal.fire({ icon: 'warning', title: alertText(message), confirmButtonColor: '#6366f1' });
  },
  info(message) {
    Swal.fire({ icon: 'info', title: alertText(message), confirmButtonColor: '#6366f1' });
  },
};

// ─────────────────────────────────────────────
// 공통 서브 컴포넌트
// ─────────────────────────────────────────────

const AsyncSqlCodeEditor = ({ value, onChange }) => {
  const [CmComp, setCmComp] = useState(null);
  const [sqlExtFactory, setSqlExtFactory] = useState(null);
  useEffect(() => {
    let mounted = true;
    Promise.all([
      import('@uiw/react-codemirror'),
      import('@codemirror/lang-sql'),
    ]).then(([cmMod, sqlMod]) => {
      if (!mounted) return;
      setCmComp(() => cmMod.default);
      setSqlExtFactory(() => sqlMod.sql);
    }).catch(() => {
      if (!mounted) return;
      setCmComp(null);
      setSqlExtFactory(null);
    });
    return () => { mounted = false; };
  }, []);

  if (!CmComp || !sqlExtFactory) {
    return (
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="SQL 문을 작성하세요..."
        style={{ width: '100%', minHeight: '100px', border: 'none', padding: '10px', fontSize: '0.85rem', fontFamily: 'inherit', resize: 'vertical' }}
      />
    );
  }
  return (
    <CmComp
      value={value}
      height="100px"
      extensions={[sqlExtFactory()]}
      onChange={onChange}
      placeholder="SQL 문을 작성하세요..."
      style={{ fontSize: '0.85rem' }}
    />
  );
};

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
          <AsyncSqlCodeEditor
            value={s.sql}
            onChange={v => { const n = [...sqls]; n[i].sql = v; setSqls(n); }}
          />
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

const UploadAdvancedSettingsModal = ({
  debugDetailEnabled,
  setDebugDetailEnabled,
  debugRowLimit,
  setDebugRowLimit,
  alertEnabled,
  setAlertEnabled,
  alertWebhookUrl,
  setAlertWebhookUrl,
  alertFailRateThreshold,
  setAlertFailRateThreshold,
  alertFailCountThreshold,
  setAlertFailCountThreshold,
  onClose,
}) => (
  <div className="excel-modal-overlay" onClick={onClose}>
    <div className="excel-modal excel-advanced-modal" onClick={e => e.stopPropagation()}>
      <div className="excel-modal-head">
        <div>
          <div className="excel-modal-kicker">Advanced Settings</div>
          <div className="excel-modal-title">업로드 고급 설정</div>
        </div>
        <button className="excel-modal-close" onClick={onClose}>닫기</button>
      </div>
      <div className="excel-modal-body">
        <div className="advanced-setting-section">
          <div className="advanced-setting-top">
            <div>
              <div className="advanced-setting-title">디버깅 모드</div>
              <div className="advanced-setting-desc">업로드 로그에 행별 매핑값, 예상 SQL, Row-SQL 치환 결과를 자세히 출력합니다.</div>
            </div>
            <label className="advanced-switch">
              <input type="checkbox" checked={debugDetailEnabled} onChange={(e) => setDebugDetailEnabled(e.target.checked)} />
              <span>{debugDetailEnabled ? 'ON' : 'OFF'}</span>
            </label>
          </div>
          <div className="advanced-field-row">
            <label className="advanced-field-label">상세 로그 행 수</label>
            <input
              type="number"
              min="1"
              max="200"
              value={debugRowLimit}
              onChange={(e) => setDebugRowLimit(e.target.value)}
              disabled={!debugDetailEnabled}
              className="advanced-input short"
            />
            <span className="advanced-field-hint">1 ~ 200, 기본 20</span>
          </div>
        </div>

        <div className="advanced-setting-section">
          <div className="advanced-setting-top">
            <div>
              <div className="advanced-setting-title">운영 알림(Webhook)</div>
              <div className="advanced-setting-desc">
                업로드 실패율 또는 실패 건수가 기준을 넘으면 지정한 Webhook URL로 운영 알림을 전송합니다. Slack, Teams, 사내 알림 중계 API처럼 HTTP 요청을 받을 수 있는 주소를 입력하면 됩니다.
              </div>
            </div>
            <label className="advanced-switch">
              <input type="checkbox" checked={alertEnabled} onChange={(e) => setAlertEnabled(e.target.checked)} />
              <span>{alertEnabled ? 'ON' : 'OFF'}</span>
            </label>
          </div>
          <div className="advanced-webhook-note">
            실패율 기준과 실패 건수 기준 중 하나라도 초과하면 알림 대상입니다. Webhook URL은 운영 알림 수신 서버의 전체 주소를 입력하세요.
          </div>
          <label className="advanced-field-label">Webhook URL</label>
          <input
            type="text"
            value={alertWebhookUrl}
            onChange={(e) => setAlertWebhookUrl(e.target.value)}
            placeholder="https://example.com/hooks/excel-upload"
            disabled={!alertEnabled}
            className="advanced-input"
          />
          <div className="advanced-threshold-grid">
            <div>
              <label className="advanced-field-label">실패율 임계치(%)</label>
              <input
                type="number"
                min="1"
                max="100"
                value={alertFailRateThreshold}
                onChange={(e) => setAlertFailRateThreshold(e.target.value)}
                disabled={!alertEnabled}
                className="advanced-input"
              />
            </div>
            <div>
              <label className="advanced-field-label">실패 건수 임계치</label>
              <input
                type="number"
                min="1"
                value={alertFailCountThreshold}
                onChange={(e) => setAlertFailCountThreshold(e.target.value)}
                disabled={!alertEnabled}
                className="advanced-input"
              />
            </div>
          </div>
        </div>
      </div>
      <div className="excel-modal-footer">
        <button className="side-action-btn side-action-btn-primary" onClick={onClose}>적용</button>
      </div>
    </div>
  </div>
);

const readCompletionSnapshot = () => {
  try {
    const empId = getCurrentEmpId();
    const scopedRaw = empId ? localStorage.getItem(getScopedStorageKey(COMPLETION_SNAPSHOT_KEY, empId)) : null;
    const fallbackRaw = localStorage.getItem(COMPLETION_SNAPSHOT_KEY);
    const candidates = [scopedRaw, fallbackRaw].filter(Boolean);
    for (const raw of candidates) {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object') {
        if (!empId || !parsed.uploader_emp_id || String(parsed.uploader_emp_id) === String(empId)) {
          return parsed;
        }
      }
    }
    return null;
  } catch {
    return null;
  }
};

const writeCompletionSnapshot = (snapshot) => {
  try {
    const empId = snapshot?.uploader_emp_id || getCurrentEmpId();
    const scopedKey = getScopedStorageKey(COMPLETION_SNAPSHOT_KEY, empId);
    const serialized = JSON.stringify(snapshot);
    localStorage.setItem(scopedKey, serialized);
    localStorage.setItem(COMPLETION_SNAPSHOT_KEY, serialized);
  } catch {}
};

const snapshotToHistoryRow = (snapshot) => {
  if (!snapshot) return null;
  return {
    hist_id: snapshot.hist_id || '',
    job_id: snapshot.job_id || '',
    upload_id: snapshot.upload_id || '',
    job_name: snapshot.job_name || '',
    file_name: snapshot.file_name || '',
    success_cnt: Number(snapshot.success_cnt) || 0,
    attempt_success_cnt: Number(snapshot.attempt_success_cnt ?? snapshot.success_cnt) || 0,
    fail_cnt: Number(snapshot.fail_cnt) || 0,
    error_file: snapshot.error_file || '',
    reg_dttm: snapshot.completed_at || snapshot.reg_dttm || new Date().toISOString(),
    config_snapshot_hash: snapshot.config_snapshot_hash || '',
    retry_mode: snapshot.retry_mode || '',
    retry_reason_types: snapshot.retry_reason_types || '',
    rolled_back_yn: snapshot.rolled_back_yn || 'N',
  };
};

const progressToHistoryRow = (state, fallback = {}) => {
  if (!state) return null;
  return {
    hist_id: fallback.hist_id || '',
    job_id: state.job_id || fallback.job_id || '',
    upload_id: state.upload_id || fallback.upload_id || '',
    job_name: state.job_name || fallback.job_name || '',
    file_name: state.file_name || fallback.file_name || '',
    success_cnt: Number(state.success_cnt ?? fallback.success_cnt) || 0,
    attempt_success_cnt: Number(state.attempt_success_cnt ?? fallback.attempt_success_cnt ?? state.success_cnt ?? fallback.success_cnt) || 0,
    fail_cnt: Number(state.fail_cnt ?? fallback.fail_cnt) || 0,
    error_file: state.error_file || fallback.error_file || '',
    reg_dttm: state.completed_at || fallback.completed_at || fallback.reg_dttm || new Date().toISOString(),
    config_snapshot_hash: state.config_snapshot_hash || fallback.config_snapshot_hash || '',
    retry_mode: state.retry_mode || fallback.retry_mode || '',
    retry_reason_types: state.retry_reason_types || fallback.retry_reason_types || '',
    rolled_back_yn: state.rolled_back_yn || fallback.rolled_back_yn || 'N',
  };
};

const CompletionSummaryView = ({ uploadId, histId, seed, historyList, loading, error, onOpenWorkbench, onOpenDashboard, onNewUpload }) => {
  const snapshot = seed || readCompletionSnapshot();
  const targetHistId = histId || snapshot?.hist_id || '';
  const targetUploadId = uploadId || snapshot?.upload_id || '';
  const targetJobId = snapshot?.job_id || '';
  const targetFileName = snapshot?.file_name || '';
  const matchedRows = targetHistId
    ? historyList.filter((row) => String(row.hist_id || '') === String(targetHistId))
    : (targetUploadId ? historyList.filter((row) => String(row.upload_id || '') === String(targetUploadId)) : []);
  const rows = matchedRows.length > 0
    ? matchedRows
    : (!targetHistId && !targetUploadId && historyList.length > 0
        ? historyList
        : (snapshot ? [snapshotToHistoryRow(snapshot)] : []));
  const latest = rows[0] || null;
  const totalSuccess = rows.reduce((sum, row) => sum + (Number(row.success_cnt) || 0), 0);
  const totalFail = rows.reduce((sum, row) => sum + (Number(row.fail_cnt) || 0), 0);
  const latestRolledBack = latest?.rolled_back_yn === 'Y';
  const latestStatus = latest
    ? (latestRolledBack ? 'rollback' : Number(latest.fail_cnt) > 0 ? 'partial' : 'ok')
    : 'none';
  const statusLabel = latestStatus === 'ok' ? '완료' : latestStatus === 'rollback' ? '전체 롤백' : latestStatus === 'partial' ? '부분 완료' : '대기';
  const statusDesc = latestStatus === 'ok'
    ? '업로드가 정상적으로 끝났습니다.'
    : latestStatus === 'rollback'
      ? '실패 행이 있어 성공 처리된 행까지 모두 반영하지 않았습니다.'
    : latestStatus === 'partial'
      ? '일부 행이 실패했습니다. 결과 내역에서 오류 파일을 확인하세요.'
      : '완료 이력을 아직 불러오지 못했습니다.';
  const copyValue = async (label, value) => {
    const text = value || '-';
    try {
      await navigator.clipboard.writeText(text);
      toast.success(`${label} 복사 완료`);
    } catch {
      toast.error(`${label} 복사 실패`);
    }
  };

  return (
    <div className="upload-flow-stack" style={{ maxWidth: '1100px', margin: '0 auto' }}>
      <div className="result-hero result-ok" style={{ minHeight: 'auto' }}>
        <div className="result-hero-icon">✅</div>
        <div className="result-hero-content">
          <div className="result-hero-title">엑셀 업로드 완료 내역</div>
          <div className="result-hero-desc">{statusDesc}</div>
        </div>
      </div>

      {loading ? (
        <div className="result-list-card">
          <div className="result-list-title">불러오는 중</div>
          <div className="result-list-tip">완료된 업로드 내역을 확인하고 있습니다.</div>
        </div>
      ) : error ? (
        <div className="result-list-card result-list-card-error">
          <div className="result-list-title">완료 화면 오류</div>
          <div className="result-error-raw">{translateUploadError(error).friendlyMsg}</div>
        </div>
      ) : (
        <>
          <div className="upload-stats-grid">
            <div className="upload-stat-card">
              <div className="upload-stat-label">최신 상태</div>
              <div className={`upload-stat-value ${latestStatus === 'ok' ? 'success' : 'danger'}`}>{statusLabel}</div>
            </div>
            <div className="upload-stat-card">
              <div className="upload-stat-label">성공 건수</div>
              <div className="upload-stat-value success">{totalSuccess.toLocaleString()}</div>
            </div>
            <div className="upload-stat-card">
              <div className="upload-stat-label">실패 건수</div>
              <div className="upload-stat-value danger">{totalFail.toLocaleString()}</div>
            </div>
            </div>

          <div className="result-list-card">
            <div className="result-list-title">진단 정보</div>
              <div className="upload-stats-grid" style={{ marginTop: '10px' }}>
              <div className="upload-stat-card">
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px' }}>
                  <div className="upload-stat-label">파일명</div>
                  <button type="button" className="completion-copy-btn" title="파일명 복사" aria-label="파일명 복사" onClick={() => copyValue('파일명', latest?.file_name || targetFileName || '')}><span aria-hidden="true">⧉</span></button>
                </div>
                <div className="upload-stat-note" style={{ wordBreak: 'break-all', marginTop: '6px' }}>{latest?.file_name || targetFileName || '-'}</div>
              </div>
              <div className="upload-stat-card">
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px' }}>
                  <div className="upload-stat-label">작업 ID</div>
                  <button type="button" className="completion-copy-btn" title="작업 ID 복사" aria-label="작업 ID 복사" onClick={() => copyValue('작업 ID', targetJobId || latest?.job_id || '')}><span aria-hidden="true">⧉</span></button>
                </div>
                <div className="upload-stat-note" style={{ wordBreak: 'break-all', marginTop: '6px' }}>{targetJobId || latest?.job_id || '-'}</div>
              </div>
              <div className="upload-stat-card">
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px' }}>
                  <div className="upload-stat-label">히스토리 ID</div>
                  <button type="button" className="completion-copy-btn" title="히스토리 ID 복사" aria-label="히스토리 ID 복사" onClick={() => copyValue('히스토리 ID', targetHistId || latest?.hist_id || snapshot?.hist_id || '')}><span aria-hidden="true">⧉</span></button>
                </div>
                <div className="upload-stat-note" style={{ wordBreak: 'break-all', marginTop: '6px' }}>{targetHistId || latest?.hist_id || snapshot?.hist_id || '-'}</div>
              </div>
              <div className="upload-stat-card">
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px' }}>
                  <div className="upload-stat-label">업로드 ID</div>
                  <button type="button" className="completion-copy-btn" title="업로드 ID 복사" aria-label="업로드 ID 복사" onClick={() => copyValue('업로드 ID', targetUploadId || latest?.upload_id || snapshot?.upload_id || '')}><span aria-hidden="true">⧉</span></button>
                </div>
                <div className="upload-stat-note" style={{ wordBreak: 'break-all', marginTop: '6px' }}>{targetUploadId || latest?.upload_id || snapshot?.upload_id || '-'}</div>
              </div>
            </div>
          </div>

          {latest && (
            <div className="result-list-card">
              <div className="result-list-title">최신 완료 내역</div>
              <div className="history-item" style={{ marginTop: '10px' }}>
                <div className="history-item-header">
                  <span className="history-item-job">{latest.job_name || '(이름 없음)'}</span>
                  <span className="history-item-time">{latest.reg_dttm?.substring(0, 16)}</span>
                </div>
                <div className="history-item-file">📁 {latest.file_name || '-'}</div>
              <div className="history-item-stats">
                  {latest.rolled_back_yn === 'Y' && <span className="stat-chip rollback">↩ 전체 롤백</span>}
                  {latest.rolled_back_yn === 'Y' && <span className="stat-chip attempt">시도 성공 {Number(latest.attempt_success_cnt || 0).toLocaleString()}건</span>}
                  <span className="stat-chip success">✅ {Number(latest.success_cnt || 0).toLocaleString()}건 성공</span>
                  <span className="stat-chip fail">❌ {Number(latest.fail_cnt || 0).toLocaleString()}건 실패</span>
                  {latest.error_file && <span className="stat-chip">🚨 오류 파일 생성</span>}
                </div>
              </div>
            </div>
          )}

          <div className="result-action-grid">
            <button className="result-action-card action-primary" onClick={onOpenWorkbench}>
              <span className="result-action-title">작업 화면 열기</span>
              <span className="result-action-desc">오류가 있으면 미리보기로 바로 돌아갈 수 있습니다.</span>
            </button>
            <button className="result-action-card action-neutral" onClick={onOpenDashboard}>
              <span className="result-action-title">대시보드 보기</span>
              <span className="result-action-desc">전체 로더와 이력을 한 번에 확인합니다.</span>
            </button>
            <button className="result-action-card action-neutral" onClick={onNewUpload}>
              <span className="result-action-title">새 업로드 시작</span>
              <span className="result-action-desc">현재 완료 내역은 유지한 채 새 파일을 올립니다.</span>
            </button>
          </div>

          {rows.length > 0 && (
            <div className="result-list-card">
              <div className="result-list-title">최근 완료 이력</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginTop: '10px', maxHeight: '260px', overflowY: 'auto' }}>
                {rows.slice(0, 5).map((h, i) => (
                  <div key={i} className="history-item">
                    <div className="history-item-header">
                      <span className="history-item-job">{h.job_name || '(이름 없음)'}</span>
                      <span className="history-item-time">{h.reg_dttm?.substring(0, 16)}</span>
                    </div>
                    <div className="history-item-file">📁 {h.file_name || '-'}</div>
                    <div className="history-item-stats">
                      {h.rolled_back_yn === 'Y' && <span className="stat-chip rollback">↩ 전체 롤백</span>}
                      {h.rolled_back_yn === 'Y' && <span className="stat-chip attempt">시도 성공 {Number(h.attempt_success_cnt || 0).toLocaleString()}건</span>}
                      <span className="stat-chip success">✅ {Number(h.success_cnt || 0).toLocaleString()}건</span>
                      <span className="stat-chip fail">❌ {Number(h.fail_cnt || 0).toLocaleString()}건</span>
                      {h.error_file && <span className="stat-chip">🚨 오류 파일</span>}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
};

// ─────────────────────────────────────────────
// 메인 컴포넌트
// ─────────────────────────────────────────────
function ExcelApp() {
  const queryParams = new URLSearchParams(window.location.search);
  const isAdmin = queryParams.get('admin') === 'true';
  const isCompletionView = queryParams.get('view') === 'completion' || queryParams.get('result') === '1';
  const completionHistId = queryParams.get('hist_id') || '';
  const completionUploadId = queryParams.get('upload_id') || '';
  const completionJobId = queryParams.get('job_id') || '';
  const completionFileName = queryParams.get('file_name') || '';

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
  const [advancedSettingsOpen, setAdvancedSettingsOpen] = useState(false);
  const [alertEnabled, setAlertEnabled] = useState(false);
  const [alertWebhookUrl, setAlertWebhookUrl] = useState('');
  const [alertFailRateThreshold, setAlertFailRateThreshold] = useState(30);
  const [alertFailCountThreshold, setAlertFailCountThreshold] = useState(50);
  const MAPPING_PAGE_SIZE = 10;
  const [mappingPage, setMappingPage] = useState(1);
  const [progress, setProgress] = useState({ current: 0, total: 0, percent: 0 });
  const [historyList, setHistoryList] = useState([]);
  const [completionHistoryList, setCompletionHistoryList] = useState([]);
  const [completionLoading, setCompletionLoading] = useState(false);
  const [completionError, setCompletionError] = useState('');
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
  const sharedStateHeartbeatRef = useRef(null);
  const isLeavingPageRef = useRef(false);
  const alertCfgLoadedRef = useRef(false);
  const alertCfgSaveTimerRef = useRef(null);
  const [isDragging, setIsDragging] = useState(false);
  const [sampleFile, setSampleFile] = useState(null);
  const [sampleFileName, setSampleFileName] = useState('');
  const [sampleFileDownloadName, setSampleFileDownloadName] = useState('');
  // 2026-06-19: 샘플 파일 저장 경로를 운영자가 직접 지정할 수 있도록 추가한다.
  const [sampleFilePath, setSampleFilePath] = useState('');
  // 2026-06-19: UPSERT 빈 칸 유지 옵션을 화면 상태로 둔다.
  const [upsertKeepEmptyYn, setUpsertKeepEmptyYn] = useState('N');
  // 2026-07-07: 업로드 실패 시 전체 트랜잭션을 롤백할지 설정한다.
  const [rollbackOnFailYn, setRollbackOnFailYn] = useState('N');
  // 2026-07-07: Post-SQL 실패 시 업로드 데이터까지 롤백할지 설정한다.
  const [postSqlRollbackOnFailYn, setPostSqlRollbackOnFailYn] = useState('N');
  // 2026-06-20: 로더별 엑셀 업로드 최대 행 수 제한을 화면 상태로 둔다. 빈 값은 제한 없음.
  const [maxUploadRows, setMaxUploadRows] = useState('');
  const [instructions, setInstructions] = useState('');
  const [loaderList, setLoaderList] = useState([]);
  const [showLoaderPanel, setShowLoaderPanel] = useState(false);
  const [loaderPanelLoading, setLoaderPanelLoading] = useState(false);

  const formatFileSize = b => !b ? '' : b < 1024 ? b + ' B' : b < 1024*1024 ? (b/1024).toFixed(1)+' KB' : (b/(1024*1024)).toFixed(2)+' MB';
  const encodeSafeBase64 = str => btoa(encodeURIComponent(str || '').replace(/%([0-9A-F]{2})/g, (m, p1) => String.fromCharCode('0x' + p1)));
  const isLikelyDirectoryPath = (value) => {
    const text = String(value || '').trim();
    if (!text) return false;
    if (/[\\/]$/.test(text)) return true;
    const lastSlash = Math.max(text.lastIndexOf('\\'), text.lastIndexOf('/'));
    const lastPart = lastSlash >= 0 ? text.slice(lastSlash + 1) : text;
    return lastPart && !lastPart.includes('.');
  };
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
  const readSharedUploadState = () => {
    try {
      const empId = getCurrentEmpId();
      const scopedRaw = empId ? localStorage.getItem(getScopedStorageKey(ACTIVE_UPLOAD_STATE_KEY, empId)) : null;
      const fallbackRaw = localStorage.getItem(ACTIVE_UPLOAD_STATE_KEY);
      const candidates = [scopedRaw, fallbackRaw].filter(Boolean);
      for (const raw of candidates) {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === 'object') {
          if (!empId || !parsed.uploader_emp_id || String(parsed.uploader_emp_id) === String(empId)) {
            return parsed;
          }
        }
      }
      return {};
    } catch {
      return {};
    }
  };
  const completionSeed = readCompletionSnapshot() || readSharedUploadState();
  const publishSharedUploadState = (patch = {}) => {
    try {
      const prev = readSharedUploadState();
      const empId = patch.uploader_emp_id || prev?.uploader_emp_id || getCurrentEmpId();
      const next = {
        ...prev,
        ...patch,
        uploader_emp_id: empId,
        updated_at: new Date().toISOString(),
      };
      const serialized = JSON.stringify(next);
      localStorage.setItem(getScopedStorageKey(ACTIVE_UPLOAD_STATE_KEY, empId), serialized);
      localStorage.setItem(ACTIVE_UPLOAD_STATE_KEY, serialized);
    } catch {}
  };
  const publishCompletionSnapshot = (payload = {}) => {
    writeCompletionSnapshot({
      ...payload,
      uploader_emp_id: payload.uploader_emp_id || getCurrentEmpId(),
      saved_at: new Date().toISOString(),
    });
  };
  const stopSharedStateHeartbeat = () => {
    const t = sharedStateHeartbeatRef.current;
    if (t) clearInterval(t);
    sharedStateHeartbeatRef.current = null;
  };
  const startSharedStateHeartbeat = () => {
    stopSharedStateHeartbeat();
    const tick = () => {
      publishSharedUploadState({
        uploader_alive: true,
        heartbeat_at: new Date().toISOString(),
      });
    };
    tick();
    sharedStateHeartbeatRef.current = setInterval(tick, ACTIVE_UPLOAD_HEARTBEAT_MS);
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
  const attachSseStream = (jobId, options = {}) => {
    const resumed = options.resumed === true;
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
        const lastLog = Array.isArray(data.logs) && data.logs.length > 0 ? data.logs[data.logs.length - 1] : '';
        publishSharedUploadState({
          job_id: jobId,
          upload_id: uploadId || '',
          job_name: jobName || '',
          file_name: file?.name || '',
          status: 'running',
          current: Number(data.current) || 0,
          total: Number(data.total) || 0,
          percent: Number(data.percent) || 0,
          last_log: lastLog || '',
        });
      } else if (data.type === 'done') {
        sseCompletedRef.current = true;
        publishSharedUploadState({
          status: 'done',
          uploader_alive: false,
          heartbeat_at: new Date().toISOString(),
          percent: 100,
        });
        stopSharedStateHeartbeat();
        es.close(); esRef.current = null;
      } else if (data.type === 'error') {
        touchUploadWatchdog();
        setUploadLogs(prev => [...prev, `💣 오류: ${data.msg}`].slice(-100));
        publishSharedUploadState({
          status: 'err',
          uploader_alive: false,
          heartbeat_at: new Date().toISOString(),
          last_log: data.msg || 'SSE error',
        });
        stopSharedStateHeartbeat();
        es.close(); esRef.current = null;
        if (resumed) {
          setUploading(false);
          setUploadJobId('');
          sessionStorage.removeItem('excel_active_job_id');
          }
        } else if (data.type === 'waiting') {
          touchUploadWatchdog();
          setUploadLogs(prev => {
            if (prev.some(v => v.includes("\uC791\uC5C5 \uB300\uAE30 \uC911"))) return prev;
            return [...prev, resumed ? "\u231B \uC774\uC804 \uC791\uC5C5 \uC0C1\uD0DC\uB97C \uC870\uD68C \uC911\uC785\uB2C8\uB2E4..." : "\u231B \uC791\uC5C5 \uB300\uAE30 \uC911... \uC11C\uBC84 \uC900\ube44\ub97c \uD655\uc778\ud558\uACE0 \uC788\uC2B5\uB2C8\uB2E4."].slice(-100);
          });
        }
      } catch {}
    };
    es.onerror = () => {
      setUploadLogs(prev => {
        if (prev.some(v => v.includes('SSE 연결이 일시적으로 불안정'))) return prev;
        return [...prev, '⚠ SSE 연결이 일시적으로 불안정합니다. 자동 재연결을 시도합니다.'].slice(-100);
      });
      if (esRef.current && esRef.current.readyState === EventSource.CLOSED) {
        esRef.current = null;
      }
    };
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
    stopSharedStateHeartbeat();
  }, []);

  useEffect(() => {
    const onBeforeUnload = () => {
      isLeavingPageRef.current = true;
      if (!uploading || !uploadJobId) return;
      publishSharedUploadState({
        job_id: uploadJobId,
        upload_id: uploadId || '',
        job_name: jobName || '',
        file_name: file?.name || '',
        status: 'detached',
        uploader_alive: false,
        heartbeat_at: new Date().toISOString(),
        last_log: '업로드 화면 탭이 닫혀 메인 화면 모니터링으로 전환되었습니다.',
      });
    };
    const onPageHide = () => {
      isLeavingPageRef.current = true;
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    window.addEventListener('pagehide', onPageHide);
    return () => {
      window.removeEventListener('beforeunload', onBeforeUnload);
      window.removeEventListener('pagehide', onPageHide);
    };
  }, [uploading, uploadJobId, uploadId, jobName, file]);

  useEffect(() => {
    if (isAdmin) post(API_URL, getParams({ mode: 'get_tables' })).then(d => setTableList(Array.isArray(d) ? d : []));
    const uId = new URLSearchParams(window.location.search).get('upload_id');
    if (isCompletionView) {
      setCompletionLoading(true);
      setCompletionError('');
      const targetHistId = completionHistId || completionSeed?.hist_id || '';
      const targetUploadId = completionUploadId || completionSeed?.upload_id || '';
      const snapshotRow = snapshotToHistoryRow(completionSeed);
      const fromProgress = (res) => progressToHistoryRow({
        ...res,
        hist_id: targetHistId || res.hist_id || '',
        job_id: completionJobId || res.job_id || '',
        upload_id: targetUploadId || res.upload_id || '',
        file_name: completionFileName || completionSeed?.file_name || res.file_name || '',
      }, snapshotRow || {});

      const finishWithRows = (rows) => {
        const list = Array.isArray(rows) ? rows : [];
        setCompletionHistoryList(list);
        setCompletionLoading(false);
        if (list.length === 0) {
          setCompletionError('완료 이력을 찾을 수 없습니다.');
        }
      };

      const fetchByProgress = () => {
        if (!completionJobId) {
          finishWithRows(snapshotRow ? [snapshotRow] : []);
          return;
        }
        post(API_URL, getParams({ mode: 'progress', job_id: completionJobId })).then((res) => {
          if (res.status === 'ok') {
            const progressRow = fromProgress(res);
            const progressHistId = res.hist_id || progressRow?.hist_id || '';
            if (progressHistId) {
              post(API_URL, getParams({ mode: 'get_history_detail', hist_id: progressHistId })).then((detailRes) => {
                if (detailRes.status === 'ok' && detailRes.row) {
                  finishWithRows([detailRes.row]);
                  return;
                }
                finishWithRows(progressRow ? [progressRow] : []);
              }).catch(() => {
                finishWithRows(progressRow ? [progressRow] : []);
              });
              return;
            }
            finishWithRows(progressRow ? [progressRow] : []);
            return;
          }
          finishWithRows(snapshotRow ? [snapshotRow] : []);
        }).catch(() => {
          finishWithRows(snapshotRow ? [snapshotRow] : []);
        });
      };

      if (targetHistId) {
        post(API_URL, getParams({ mode: 'get_history_detail', hist_id: targetHistId, upload_id: targetUploadId || '' })).then((res) => {
          if (res.status === 'ok' && res.row) {
            finishWithRows([res.row]);
            return;
          }
          setCompletionLoading(false);
          setCompletionError('완료 이력을 찾을 수 없습니다.');
        }).catch(() => {
          setCompletionLoading(false);
          setCompletionError('완료 화면을 불러오지 못했습니다.');
        });
        return;
      }

      loadHistory(targetUploadId).then((list) => {
        const row = Array.isArray(list) && list.length > 0 ? list[0] : null;
        if (row) {
          finishWithRows([row]);
          return;
        }
        fetchByProgress();
      }).catch(fetchByProgress);
      return;
    }
    if (uId) loadConfiguration(uId);
    loadHistory().then(setHistoryList);
    try {
      const activeJobId = sessionStorage.getItem('excel_active_job_id');
      if (activeJobId) {
        setUploadJobId(activeJobId);
        setUploading(true);
        setUploadLogs(prev => [...prev, '🔄 이전 업로드 작업을 복구하는 중입니다...']);
        publishSharedUploadState({
          source: 'excel_upload',
          job_id: activeJobId,
          upload_id: uploadId || '',
          job_name: jobName || '',
          file_name: file?.name || '',
          status: 'running',
          uploader_alive: true,
          heartbeat_at: new Date().toISOString(),
          last_log: '이전 작업을 복구 중입니다.',
        });
        startSharedStateHeartbeat();
        startUploadWatchdog();
        attachSseStream(activeJobId, { resumed: true });
        post(API_URL, getParams({ mode: 'progress', job_id: activeJobId })).then((res) => {
          if (res.status === 'none') {
            setUploadLogs(prev => [...prev, '⚠ 이전 작업 상태를 찾지 못했습니다. 서버 재시작 또는 세션 만료일 수 있습니다.']);
            setUploading(false);
            setUploadJobId('');
            stopUploadWatchdog();
            stopSharedStateHeartbeat();
            try { sessionStorage.removeItem('excel_active_job_id'); } catch {}
          }
        });
      }
    } catch {}
  }, []);

  const loadHistory = async (targetUploadId = '') => {
    const fd = { mode: 'get_history' };
    if (targetUploadId) fd.upload_id = targetUploadId;
    const res = await post(API_URL, getParams(fd));
    if (res.status === 'ok') return res.list || [];
    return [];
  };

  const loadLoaderList = async () => {
    setLoaderPanelLoading(true);
    const res = await post(API_URL, getParams({ mode: 'get_list' }));
    if (res.status === 'ok') setLoaderList(res.list || []);
    setLoaderPanelLoading(false);
  };

  const handleDeleteLoader = async (id, name) => {
    const confirmResult = await Swal.fire({
      icon: 'warning',
      title: '로더를 삭제할까요?',
      text: `"${name}" 로더는 삭제 후 복구할 수 없습니다.`,
      showCancelButton: true,
      confirmButtonText: '삭제',
      cancelButtonText: '취소',
      confirmButtonColor: '#dc2626',
      cancelButtonColor: '#6b7280',
      reverseButtons: true,
    });
    if (!confirmResult.isConfirmed) return;
    const deleteToastId = toast.loading('삭제 중...');
    const deleteResult = await post(API_URL, getParams({ mode: 'delete', upload_id: id }));
    if (deleteResult.status === 'ok') {
      toast.update(deleteToastId, { render: '삭제 완료', type: 'success', isLoading: false, autoClose: 2000 });
      if (uploadId === id) { setTimeout(() => { window.location.href = window.location.pathname + '?admin=true'; }, 1500); }
      await loadLoaderList();
    } else {
      toast.update(deleteToastId, { render: deleteResult.msg || '삭제 실패', type: 'error', isLoading: false, autoClose: 3000 });
    }
    return;
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
        setSampleFilePath((res.sample_file_name || '').includes('\\') || (res.sample_file_name || '').includes('/') ? res.sample_file_name : '');
        setSampleFileDownloadName(res.sample_file_org_name || '');
        setUpsertKeepEmptyYn((res.upsert_keep_empty_yn || 'N') === 'Y' ? 'Y' : 'N');
        setRollbackOnFailYn((res.rollback_on_fail_yn || 'N') === 'Y' ? 'Y' : 'N');
        setPostSqlRollbackOnFailYn((res.post_sql_rollback_on_fail_yn || 'N') === 'Y' ? 'Y' : 'N');
        setMaxUploadRows(Number(res.max_upload_rows) > 0 ? String(res.max_upload_rows) : '');
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
    const cols = Array.isArray(d)
      ? d.map(col => ({
          ...col,
          label: col.display_label || col.label || col.value,
          raw_label: col.label || col.value,
        }))
      : [];
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
    const selectedTable = tableName || '';
    const nextStructs = [...structs];
    nextStructs[index] = {
      ...nextStructs[index],
      table: selectedTable,
      ent_id: '',
      pk_col: '',
      upsert_keys: [],
    };
    setStructs(nextStructs);

    if (selectedTable) {
      const columns = await loadCols(selectedTable);
      const metadataColumn = columns.find(col => col.entity_id || col.is_pk === 'Y');
      const primaryKeyColumn = columns.find(col => col.is_pk === 'Y');
      const detectedEntityId = String(metadataColumn?.entity_id || '').trim().toUpperCase();
      const detectedPrimaryKey = primaryKeyColumn?.value || '';

      setStructs(current => current.map((item, itemIndex) => (
        itemIndex === index && item.table === selectedTable
          ? { ...item, ent_id: detectedEntityId, pk_col: detectedPrimaryKey }
          : item
      )));
    }

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
    if (sampleFilePath?.trim()) {
      const normalizedSamplePath = sampleFilePath.trim();
      // 2026-06-19: 입력값이 폴더 경로면 sample_file_dir 로, 파일 경로면 sample_file_path 로 보낸다.
      if (isLikelyDirectoryPath(normalizedSamplePath)) fd.append('sample_file_dir', normalizedSamplePath);
      else fd.append('sample_file_path', normalizedSamplePath);
    }
    fd.append('upsert_keep_empty_yn', upsertKeepEmptyYn);
    fd.append('rollback_on_fail_yn', rollbackOnFailYn);
    fd.append('post_sql_rollback_on_fail_yn', postSqlRollbackOnFailYn);
    fd.append('max_upload_rows', String(Math.max(Number(maxUploadRows) || 0, 0)));
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
    fd.append('max_upload_rows', String(Math.max(Number(maxUploadRows) || 0, 0)));
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
    .map(Number)
    .filter(Number.isFinite)
    .sort((a, b) => a - b);

  const resolveUploadFailedMessages = (res) => {
    let failedMsgs = (res?.failed_row_msgs && Object.keys(res.failed_row_msgs).length > 0)
      ? res.failed_row_msgs : {};

    if (Object.keys(failedMsgs).length === 0) {
      const logFailedMsgs = {};
      const hRow = parseInt(headerRow) || 1;
      uploadLogsRef.current.forEach(log => {
        const m = log.match(/❌\s*(\d+)행\s*(?:개별\s*)?오류[:\s]+(.+)/);
        if (m) {
          const sheetRow1based = parseInt(m[1]);
          const dataRow = sheetRow1based - hRow;
          if (dataRow > 0) logFailedMsgs[String(dataRow)] = m[2].trim();
        }
      });
      if (Object.keys(logFailedMsgs).length > 0) failedMsgs = logFailedMsgs;
    }

    if (Object.keys(failedMsgs).length === 0 && Number(res?.fail_cnt) > 0) {
      failedMsgs = { '__unknown__': `${res.fail_cnt}건 실패 (행 특정 불가 - 오류 리포트를 확인하세요)` };
    }

    return failedMsgs;
  };

  const focusFirstFailedMessagePage = (failedMsgs) => {
    const validKeys = Object.keys(failedMsgs || {}).filter(k => Number.isFinite(Number(k)));
    if (validKeys.length === 0 || !file) return;
    const firstFailedRowNum = Math.min(...validKeys.map(Number));
    setSelectedErrorRow(firstFailedRowNum);
    const failedPage = Math.ceil(firstFailedRowNum / previewPageSize);
    if (failedPage !== previewPage && failedPage >= 1) {
      setPreviewPage(failedPage);
      fetchPreviewPage(file, failedPage, headerRow, null);
    }
  };

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
    if (progress.percent >= 100) return { key: 'done', label: '완료 확인 중', desc: '서버의 최종 결과를 기다리고 있습니다.' };
    if (progress.percent >= 90) return { key: 'finalize', label: '마무리 중', desc: '처리된 결과를 정리하고 있습니다.' };
    if (progress.current > 0 || progress.percent > 0) return { key: 'processing', label: '서버 처리 중', desc: '서버에서 행 데이터를 순차적으로 처리하고 있습니다.' };
    return { key: 'start', label: '업로드 시작', desc: '서버 작업을 준비하고 있습니다.' };
  };

  const retryTypeRowMap = useMemo(() => {
    const map = {};
    Object.entries(failedRows).forEach(([rowKey, msg]) => {
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

  const renderDebugUploadOptions = () => (
    <button
      type="button"
      className="side-action-btn advanced-settings-trigger"
      onClick={() => setAdvancedSettingsOpen(true)}
    >
      고급 설정
      <span className={debugDetailEnabled || alertEnabled ? 'advanced-settings-badge active' : 'advanced-settings-badge'}>
        {[
          debugDetailEnabled ? '디버깅' : null,
          alertEnabled ? '알림' : null,
        ].filter(Boolean).join(' · ') || '기본'}
      </span>
    </button>
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
    const cols = parseUploadFailedColsFromMsg(msg, mapping, excelHeaders);
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
      if (!Number.isFinite(Number(rowKey))) {
        unknownCnt += 1;
        return;
      }
      const parsed = parseUploadFailedColsFromMsg(msg, mapping, excelHeaders);
      if (!parsed.length) {
        const fallbackType = friendlyUploadFailMsg(msg);
        byType[fallbackType] = (byType[fallbackType] || 0) + 1;
        byColumn['행 특정 불가'] = (byColumn['행 특정 불가'] || 0) + 1;
        totalErrItems += 1;
        return;
      }
      parsed.forEach(item => {
        const typeKey = item.errType || friendlyUploadFailMsg(msg);
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
      before_fail_count: Object.keys(failedRows).filter(k => Number.isFinite(Number(k))).length,
    } : null;
    const rollbackNotes = [
      rollbackOnFailYn === 'Y' ? '실패 행이 하나라도 있으면 성공 처리된 행까지 모두 반영하지 않습니다.' : '',
      postSqlRollbackOnFailYn === 'Y' ? 'Post-SQL 오류가 발생해도 업로드 데이터까지 모두 반영하지 않습니다.' : '',
    ].filter(Boolean);
    const uploadConfirmHtml = '데이터를 서버로 전송하시겠습니까?'
      + rollbackNotes.map(note => `<br><small style="color:#ef4444">${note}</small>`).join('')
      + '<br><small style="color:#64748b">대량 데이터는 수 분이 소요될 수 있습니다.</small>';
    const cr = await Swal.fire({ title: '데이터 업로드 실행', html: uploadConfirmHtml, icon: rollbackNotes.length > 0 ? 'warning' : 'question', showCancelButton: true, confirmButtonColor: '#6366f1', cancelButtonColor: '#94a3b8', confirmButtonText: '🚀 진행', cancelButtonText: '취소', reverseButtons: true });
    if (!cr.isConfirmed) return;

    setUploading(true); setProgress({ current: 0, total: 0, percent: 0 }); setUploadLogs([useTargetRows ? "\uD83C\uDFAF \uC2E4\uD328\uD589 \uC7AC\uCC98\ub9ac\ub97c \uC2DC\uc791\ud569\ub2c8\ub2e4..." : "\uD83D\uDE80 \uD30C\uc77c \uc804\uc1a1\uc744 \uc2dc\uc791\ud569\ub2c8\ub2e4..."]); setUploadResult(null);
    sseCompletedRef.current = false; // SSE 완료 플래그 초기화
    const jobId = 'JOB_' + Date.now();
    setUploadJobId(jobId);
    setCancellingUpload(false);
    startUploadWatchdog();
    publishSharedUploadState({
      source: 'excel_upload',
      job_id: jobId,
      upload_id: uploadId || '',
      job_name: jobName || '',
      file_name: file?.name || '',
      status: 'running',
      current: 0,
      total: 0,
      percent: 0,
      last_log: useTargetRows ? '실패행 재처리를 시작합니다.' : '업로드를 시작합니다.',
      uploader_alive: true,
      heartbeat_at: new Date().toISOString(),
    });
    startSharedStateHeartbeat();
    try { sessionStorage.setItem('excel_active_job_id', jobId); } catch {}

    attachSseStream(jobId);

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
    fd.append('upsert_keep_empty_yn', upsertKeepEmptyYn);
    fd.append('rollback_on_fail_yn', rollbackOnFailYn);
    fd.append('post_sql_rollback_on_fail_yn', postSqlRollbackOnFailYn);
    fd.append('max_upload_rows', String(Math.max(Number(maxUploadRows) || 0, 0)));
    // 2026-06-20: 관리자 컬럼 매핑의 현재 로그인 사용자/MTN 특수값을 서버에서 치환할 수 있도록 전달한다.
    fd.append('login_user_id', getCurrentEmpId());
    fd.append('login_mtn_id', getCurrentMtnId());
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

    const tid = null;
    const updateUploadToast = (options) => {
      if (tid) toast.update(tid, options);
    };
    try {
      // 2026-08-12 이준혁: 서버가 multipart 본문을 읽기 전에 전용 업로드 Queue 수용 여부를 판단하도록 힌트를 전달한다.
      const uploadRequestUrl = `${API_URL}?mode=upload&job_id=${encodeURIComponent(jobId)}`;
      const res = await post(uploadRequestUrl, fd);
      // ── SSE 스트림 정리 ──
      if (esRef.current) { esRef.current.close(); esRef.current = null; }
      stopUploadWatchdog();
      setUploading(false);
      setCancellingUpload(false);
      setUploadJobId('');
      try { sessionStorage.removeItem('excel_active_job_id'); } catch {}
      stopSharedStateHeartbeat();
      // 2026-08-12 이준혁: 업로드 Queue 포화는 결과 화면으로 넘기지 않고 즉시 안내한다.
      if (res.status === 'busy') {
        setUploadResult(null);
        setFailedRows({});
        setProgress({ current: 0, total: 0, percent: 0 });
        publishSharedUploadState({
          job_id: jobId,
          upload_id: uploadId || '',
          status: 'busy',
          uploader_alive: false,
          heartbeat_at: new Date().toISOString(),
          last_log: res.msg || '현재 업로드 작업이 많습니다. 잠시 후 다시 시도해 주세요.',
        });
        await Swal.fire({
          title: '업로드 대기열이 가득 찼습니다',
          text: res.msg || '현재 업로드 작업이 많습니다. 잠시 후 다시 시도해 주세요.',
          icon: 'warning',
          confirmButtonColor: '#6366f1',
          confirmButtonText: '확인',
        });
        return;
      }
      if (res.status === 'ok' || res.status === 'partial') {
        setProgress(p => ({ ...p, current: p.total, percent: 100 }));
        setUploadLogs(prev => [...prev, '🎉 업로드 완료!']);
        loadHistory().then(setHistoryList);

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
            attempt_success_cnt: Number(res.attempt_success_cnt ?? res.success_cnt) || 0,
            fail_cnt: failCnt,
            fail_rate: Number(failRate.toFixed(2)),
            retry_mode: retryMode,
          }, `${uploadId}|${retryMode}|upload_warning|${file?.name || ''}|${successCnt}|${failCnt}`);
        }

        if (res.status === 'partial') {
          // partial: 파일/미리보기 항상 유지, 실패 행 강조
          const failedMsgs = resolveUploadFailedMessages(res);
          setFailedRows(failedMsgs);
          // uploadResult에도 failedMsgs 병합 (버튼에서 사용)
          setUploadResult({ ...res, failed_row_msgs: failedMsgs, retry_summary: retrySummaryBase ? { ...retrySummaryBase, after_fail_count: Object.keys(failedMsgs).filter(k => Number.isFinite(Number(k))).length } : null });
          publishCompletionSnapshot({
            status: 'partial',
            hist_id: res.hist_id || '',
            job_id: uploadJobId || '',
            upload_id: uploadId || res.upload_id || '',
            job_name: jobName || '',
            file_name: file?.name || '',
            success_cnt: successCnt,
            attempt_success_cnt: Number(res.attempt_success_cnt ?? res.success_cnt) || 0,
            fail_cnt: failCnt,
            error_file: res.error_file || '',
            msg: res.msg || '',
            failed_row_msgs: failedMsgs,
            retry_mode: retryMode,
            retry_reason_types: retryMode === 'fail_type' ? retryFailTypes.join(',') : '',
            config_snapshot_hash: res.config_snapshot_hash || '',
            rolled_back_yn: res.rolled_back_yn || 'N',
          });
          publishSharedUploadState({
            hist_id: res.hist_id || '',
            job_id: uploadJobId || '',
            upload_id: uploadId || res.upload_id || '',
            job_name: jobName || '',
            file_name: file?.name || '',
            status: 'partial',
            uploader_alive: false,
            heartbeat_at: new Date().toISOString(),
            percent: 100,
            current: Number(res.success_cnt || 0) + Number(res.fail_cnt || 0),
            total: Number(res.success_cnt || 0) + Number(res.fail_cnt || 0),
            success_cnt: successCnt,
            fail_cnt: failCnt,
            error_file: res.error_file || '',
            last_log: `${res.fail_cnt || 0}건 실패로 부분 완료`,
            rolled_back_yn: res.rolled_back_yn || 'N',
          });
          updateUploadToast({ render: `⚠️ ${res.fail_cnt}건 실패 — 미리보기에서 수정 후 재업로드`, type: 'warning', isLoading: false, autoClose: 5000 });
          focusFirstFailedMessagePage(failedMsgs);
        } else {
          // ok: 완전 성공 → 결과 화면으로
          setFailedRows({});
          setUploadResult({ ...res, retry_summary: retrySummaryBase ? { ...retrySummaryBase, after_fail_count: 0 } : null });
          publishCompletionSnapshot({
            status: 'ok',
            hist_id: res.hist_id || '',
            job_id: uploadJobId || '',
            upload_id: uploadId || res.upload_id || '',
            job_name: jobName || '',
            file_name: file?.name || '',
            success_cnt: successCnt,
            attempt_success_cnt: Number(res.attempt_success_cnt ?? res.success_cnt) || 0,
            fail_cnt: failCnt,
            error_file: res.error_file || '',
            msg: res.msg || '',
            retry_mode: retryMode,
            retry_reason_types: retryMode === 'fail_type' ? retryFailTypes.join(',') : '',
            config_snapshot_hash: res.config_snapshot_hash || '',
            rolled_back_yn: res.rolled_back_yn || 'N',
          });
          publishSharedUploadState({
            hist_id: res.hist_id || '',
            job_id: uploadJobId || '',
            upload_id: uploadId || res.upload_id || '',
            job_name: jobName || '',
            file_name: file?.name || '',
            status: 'ok',
            uploader_alive: false,
            heartbeat_at: new Date().toISOString(),
            percent: 100,
            current: Number(res.success_cnt || 0),
            total: Number(res.success_cnt || 0),
            success_cnt: successCnt,
            attempt_success_cnt: Number(res.attempt_success_cnt ?? res.success_cnt) || 0,
            fail_cnt: failCnt,
            error_file: res.error_file || '',
            last_log: '업로드가 정상 완료되었습니다.',
            rolled_back_yn: res.rolled_back_yn || 'N',
          });
          updateUploadToast({ render: '🎉 완료', type: 'success', isLoading: false, autoClose: 3000 });
          setFile(null); setPreviewData([]); setEditedCells({});
          const el = document.getElementById('fileInput'); if (el) el.value = '';
          const el2 = document.getElementById('adminUploadFileInput'); if (el2) el2.value = '';
        }
      } else {
        // err: 파일 유지, 오류 메시지 + 행 강조
        updateUploadToast({ render: '❌ 실패', type: 'error', isLoading: false, autoClose: 3000 });
        const { friendlyMsg, solution } = translateUploadError(res.msg);
        let failedMsgs = resolveUploadFailedMessages(res);
        const rowMatch = res.msg?.match(/엑셀 \[ (\d+) 번째 행 \]/);
        if (Object.keys(failedMsgs).length === 0 && rowMatch) {
          const errRowNum = parseInt(rowMatch[1]);
          const dataRowNum = errRowNum - parseInt(headerRow);
          if (dataRowNum > 0) {
            failedMsgs = { [String(dataRowNum)]: res.msg };
          }
        }
        setFailedRows(failedMsgs);
        setUploadResult({ ...res, friendlyMsg, solution, failed_row_msgs: failedMsgs, retry_summary: retrySummaryBase ? { ...retrySummaryBase, after_fail_count: Object.keys(failedMsgs).filter(k => Number.isFinite(Number(k))).length } : null });
        publishCompletionSnapshot({
          status: 'err',
          hist_id: res.hist_id || '',
          job_id: uploadJobId || '',
          upload_id: uploadId || res.upload_id || '',
          job_name: jobName || '',
          file_name: file?.name || '',
          success_cnt: Number(res.success_cnt) || 0,
          attempt_success_cnt: Number(res.attempt_success_cnt ?? res.success_cnt) || 0,
          fail_cnt: Number(res.fail_cnt) || 0,
          error_file: res.error_file || '',
          msg: res.msg || '',
          failed_row_msgs: failedMsgs,
          retry_mode: retryMode,
          retry_reason_types: retryMode === 'fail_type' ? retryFailTypes.join(',') : '',
          config_snapshot_hash: res.config_snapshot_hash || '',
          rolled_back_yn: res.rolled_back_yn || 'N',
        });
        publishSharedUploadState({
          hist_id: res.hist_id || '',
          job_id: uploadJobId || '',
          upload_id: uploadId || res.upload_id || '',
          job_name: jobName || '',
          file_name: file?.name || '',
          status: 'err',
          uploader_alive: false,
          heartbeat_at: new Date().toISOString(),
          success_cnt: Number(res.success_cnt) || 0,
          attempt_success_cnt: Number(res.attempt_success_cnt ?? res.success_cnt) || 0,
          fail_cnt: Number(res.fail_cnt) || 0,
          error_file: res.error_file || '',
          last_log: res.msg || '업로드 실패',
          rolled_back_yn: res.rolled_back_yn || 'N',
        });
        void sendOpsAlert('upload_error', {
          status: 'err',
          file_name: file?.name || '',
          msg: res.msg || '',
          retry_mode: retryMode,
        }, `${uploadId}|${retryMode}|upload_error|${file?.name || ''}|${res.msg || ''}`);
        if (Object.keys(failedMsgs).filter(k => Number.isFinite(Number(k))).length > 0) {
          focusFirstFailedMessagePage(failedMsgs);
        }
      }
    } catch {
      if (isLeavingPageRef.current) {
        if (esRef.current) { esRef.current.close(); esRef.current = null; }
        stopUploadWatchdog();
        stopSharedStateHeartbeat();
        setUploading(false);
        setCancellingUpload(false);
        setUploadJobId('');
        try { sessionStorage.removeItem('excel_active_job_id'); } catch {}
        return;
      }
      if (esRef.current) { esRef.current.close(); esRef.current = null; }
      stopUploadWatchdog();
      stopSharedStateHeartbeat();

      // ── JEUS 타임아웃 대응 ─────────────────────────────────────────
      // SSE로 'done' 신호를 이미 받은 경우 → 서버는 정상 완료됨
      // fetch만 JEUS 타임아웃으로 끊긴 것이므로 성공으로 처리
      if (sseCompletedRef.current) {
        setUploading(false);
        setCancellingUpload(false);
        setUploadJobId('');
        try { sessionStorage.removeItem('excel_active_job_id'); } catch {}
        setProgress(p => ({ ...p, percent: 100 }));
        setUploadLogs(prev => [...prev, '🎉 업로드 완료!']);
        const finalSnapshotBase = {
          status: 'ok',
          hist_id: '',
          job_id: uploadJobId || '',
          upload_id: uploadId || '',
          job_name: jobName || '',
          file_name: file?.name || '',
          success_cnt: 0,
          fail_cnt: 0,
          error_file: '',
          msg: '업로드 완료',
        };
        // [2026-04-26] JEUS 타임아웃으로 응답 본문을 못 받아도, 서버 이력에서 최종 집계를 다시 읽어 완료 화면이 0건으로 보이지 않게 한다.
        void loadHistory(uploadId || '').then((rows) => {
          const latest = Array.isArray(rows) && rows.length > 0 ? rows[0] : null;
          const nextSnapshot = latest ? {
            ...finalSnapshotBase,
            hist_id: latest.hist_id || finalSnapshotBase.hist_id,
            upload_id: latest.upload_id || finalSnapshotBase.upload_id,
            job_name: latest.job_name || finalSnapshotBase.job_name,
            file_name: latest.file_name || finalSnapshotBase.file_name,
            success_cnt: Number(latest.success_cnt) || 0,
            fail_cnt: Number(latest.fail_cnt) || 0,
            error_file: latest.error_file || '',
            config_snapshot_hash: latest.config_snapshot_hash || '',
            retry_mode: latest.retry_mode || '',
            retry_reason_types: latest.retry_reason_types || '',
            completed_at: latest.reg_dttm || new Date().toISOString(),
          } : finalSnapshotBase;
          publishCompletionSnapshot(nextSnapshot);
          setUploadResult({ ...nextSnapshot });
          publishSharedUploadState({
            hist_id: nextSnapshot.hist_id || '',
            job_id: uploadJobId || '',
            upload_id: nextSnapshot.upload_id || '',
            job_name: nextSnapshot.job_name || '',
            file_name: nextSnapshot.file_name || '',
            status: 'ok',
            uploader_alive: false,
            heartbeat_at: new Date().toISOString(),
            percent: 100,
            current: Number(nextSnapshot.success_cnt) + Number(nextSnapshot.fail_cnt),
            total: Number(nextSnapshot.success_cnt) + Number(nextSnapshot.fail_cnt),
            success_cnt: Number(nextSnapshot.success_cnt) || 0,
            fail_cnt: Number(nextSnapshot.fail_cnt) || 0,
            error_file: nextSnapshot.error_file || '',
            last_log: '업로드가 정상 완료되었습니다.',
          });
          updateUploadToast({ render: '🎉 업로드 완료', type: 'success', isLoading: false, autoClose: 3000 });
          setFailedRows({});
          setFile(null); setPreviewData([]); setEditedCells({});
          const el = document.getElementById('fileInput'); if (el) el.value = '';
          const el2 = document.getElementById('adminUploadFileInput'); if (el2) el2.value = '';
          loadHistory().then(setHistoryList);
        }).catch(() => {
          publishCompletionSnapshot(finalSnapshotBase);
          publishSharedUploadState({
            hist_id: finalSnapshotBase.hist_id || '',
            job_id: uploadJobId || '',
            upload_id: uploadId || '',
            job_name: jobName || '',
            file_name: file?.name || '',
            status: 'ok',
            uploader_alive: false,
            heartbeat_at: new Date().toISOString(),
            percent: 100,
            last_log: '업로드가 정상 완료되었습니다.',
          });
          updateUploadToast({ render: '🎉 업로드 완료', type: 'success', isLoading: false, autoClose: 3000 });
          setFailedRows({});
          setUploadResult({ ...finalSnapshotBase });
          setFile(null); setPreviewData([]); setEditedCells({});
          const el = document.getElementById('fileInput'); if (el) el.value = '';
          const el2 = document.getElementById('adminUploadFileInput'); if (el2) el2.value = '';
          loadHistory().then(setHistoryList);
        });
        return;
      }

      // SSE 완료 신호도 없이 끊긴 경우 → 진짜 통신 오류
      setUploading(false);
      setCancellingUpload(false);
      setUploadJobId('');
      try { sessionStorage.removeItem('excel_active_job_id'); } catch {}
        publishCompletionSnapshot({
          status: 'err',
          hist_id: '',
          job_id: uploadJobId || '',
          upload_id: uploadId || '',
        job_name: jobName || '',
        file_name: file?.name || '',
        success_cnt: 0,
        fail_cnt: 0,
        error_file: '',
        msg: '통신 오류 (서버 응답 지연 또는 연결 문제)',
      });
      publishSharedUploadState({
        hist_id: '',
        job_id: uploadJobId || '',
        upload_id: uploadId || '',
        job_name: jobName || '',
        file_name: file?.name || '',
        status: 'err',
        uploader_alive: false,
        heartbeat_at: new Date().toISOString(),
        last_log: '통신 오류 (서버 응답 지연 또는 연결 문제)',
      });
      updateUploadToast({ render: '❌ 통신 오류 (서버 응답 지연 또는 연결 문제)', type: 'error', isLoading: false, autoClose: 3500 });
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
    fd.append('max_upload_rows', String(Math.max(Number(maxUploadRows) || 0, 0)));
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
  const filteredCols = currentDbCols.filter(c => {
    const keyword = searchTerm.toLowerCase();
    return String(c.label || '').toLowerCase().includes(keyword)
      || String(c.value || '').toLowerCase().includes(keyword)
      || String(c.comment || '').toLowerCase().includes(keyword);
  }).sort((a, b) => { const ac = !!currentAliasMapping[a.value], bc = !!currentAliasMapping[b.value]; return ac === bc ? 0 : ac ? -1 : 1; });
  const mappingTotalPages = Math.ceil(filteredCols.length / MAPPING_PAGE_SIZE);
  const pagedCols = filteredCols.slice((mappingPage - 1) * MAPPING_PAGE_SIZE, mappingPage * MAPPING_PAGE_SIZE);

  // ─── 스텝 이동 ──────────────────────────────
  const goNext = async () => {
    if (isAdmin && currentStep === 2) { const ok = await handleSave(); if (ok) setCurrentStep(3); }
    else setCurrentStep(s => s + 1);
  };
  const goPrev = () => setCurrentStep(s => Math.max(0, s - 1));

  const canGoNext = () => {
    if (isAdmin) {
      if (currentStep === 0) return !!jobName.trim();
      if (currentStep === 1) return !!structs[0].table;
      // 2026-06-20: 샘플 엑셀 헤더가 인식된 뒤에만 컬럼 매핑 저장 단계로 진행할 수 있게 제한한다.
      if (currentStep === 2) return !!file && excelHeaders.length > 0;
      return true;
    }
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
    translateError: translateUploadError,
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
    parseFailedColsFromMsg: parseUploadFailedColsFromMsg,
    friendlyFailMsg: friendlyUploadFailMsg,
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
    sampleFilePath,
    setSampleFilePath,
    upsertKeepEmptyYn,
    setUpsertKeepEmptyYn,
    rollbackOnFailYn,
    setRollbackOnFailYn,
    postSqlRollbackOnFailYn,
    setPostSqlRollbackOnFailYn,
    maxUploadRows,
    setMaxUploadRows,
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
    parseFailedColsFromMsg: parseUploadFailedColsFromMsg,
    friendlyFailMsg: friendlyUploadFailMsg,
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

  if (isCompletionView) {
    const latestHistory = completionHistoryList[0] || null;
    return (
      <div style={{ minHeight: '100vh', background: '#f8fafc' }}>
        <div style={{ background: 'white', borderBottom: '1px solid #e2e8f0', padding: '0 32px' }}>
          <div style={{ maxWidth: '100%', margin: '0 auto', height: '60px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
              <div style={{ width: '34px', height: '34px', borderRadius: '9px', background: 'linear-gradient(135deg,#16a34a,#22c55e)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '17px' }}>✅</div>
              <div>
                <div style={{ fontWeight: 800, fontSize: '0.95rem', color: '#0f172a' }}>엑셀업로드 완료 내역</div>
                <div style={{ fontSize: '0.68rem', color: '#94a3b8' }}>{latestHistory?.job_name || completionUploadId || '완료 결과 보기'}</div>
              </div>
            </div>
            <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
              <button onClick={() => window.location.href = '?view=dashboard'} style={{ background: 'transparent', border: '1px solid #e2e8f0', color: '#64748b', borderRadius: '8px', padding: '0 14px', height: '34px', fontSize: '0.8rem', fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}>📊 대시보드</button>
              <button onClick={() => window.location.href = '?upload_id=' + encodeURIComponent(completionUploadId || (latestHistory?.upload_id || '')) + (completionHistId ? '&hist_id=' + encodeURIComponent(completionHistId) : '')} style={{ background: 'transparent', border: '1px solid #e2e8f0', color: '#64748b', borderRadius: '8px', padding: '0 14px', height: '34px', fontSize: '0.8rem', fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}>🧰 작업 화면</button>
            </div>
          </div>
        </div>
        <div style={{ maxWidth: '100%', margin: '0 auto', padding: '36px 24px 80px' }}>
          <CompletionSummaryView
            uploadId={completionUploadId}
            histId={completionHistId}
            seed={completionSeed}
            historyList={completionHistoryList}
            loading={completionLoading}
            error={completionError}
            onOpenWorkbench={() => { window.location.href = '?upload_id=' + encodeURIComponent(completionUploadId || (latestHistory?.upload_id || '')) + (completionHistId ? '&hist_id=' + encodeURIComponent(completionHistId) : ''); }}
            onOpenDashboard={() => { window.location.href = '?view=dashboard'; }}
            onNewUpload={() => { window.location.href = '?'; }}
          />
        </div>
      </div>
    );
  }

  const canNavigateStep = (stepIndex) => {
    if (!isAdmin) return true;
    if (stepIndex <= currentStep) return true;
    if (stepIndex === 1) return !!jobName.trim();
    if (stepIndex === 2) return !!jobName.trim() && !!structs[0]?.table;
    if (stepIndex === 3) return !!uploadId;
    return false;
  };

  const handleStepClick = (stepIndex) => {
    if (!canNavigateStep(stepIndex)) return;
    setCurrentStep(stepIndex);
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
            onStepClick={handleStepClick}
            canNavigateStep={canNavigateStep}
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
          onStepClick={handleStepClick}
          canNavigateStep={canNavigateStep}
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
    <div className={`excel-product-shell ${isAdmin ? 'excel-product-shell-admin' : 'excel-product-shell-user'}`}>
      {advancedSettingsOpen && (
        <UploadAdvancedSettingsModal
          debugDetailEnabled={debugDetailEnabled}
          setDebugDetailEnabled={setDebugDetailEnabled}
          debugRowLimit={debugRowLimit}
          setDebugRowLimit={setDebugRowLimit}
          alertEnabled={alertEnabled}
          setAlertEnabled={setAlertEnabled}
          alertWebhookUrl={alertWebhookUrl}
          setAlertWebhookUrl={setAlertWebhookUrl}
          alertFailRateThreshold={alertFailRateThreshold}
          setAlertFailRateThreshold={setAlertFailRateThreshold}
          alertFailCountThreshold={alertFailCountThreshold}
          setAlertFailCountThreshold={setAlertFailCountThreshold}
          onClose={() => setAdvancedSettingsOpen(false)}
        />
      )}

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
                            {item.can_delete === true && (
                              <button onClick={() => handleDeleteLoader(item.upload_id, item.job_name)} title="삭제" style={{ padding: '4px 10px', borderRadius: '6px', border: '1px solid #fee2e2', background: 'white', color: '#ef4444', fontSize: '0.75rem', cursor: 'pointer', fontWeight: 600 }}>🗑️</button>
                            )}
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
