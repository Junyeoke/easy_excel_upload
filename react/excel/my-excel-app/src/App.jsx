import React, { useState, useEffect, useRef, useCallback } from 'react';
import Select from 'react-select';
import CodeMirror from '@uiw/react-codemirror';
import { sql } from '@codemirror/lang-sql';
import { ToastContainer, toast } from 'react-toastify';
import 'react-toastify/dist/ReactToastify.css';
import './App.css';

// =========================================
// 도움말 내용
// =========================================
const STEP_GUIDES = {
  1: { title: "기본 설정", content: "작업 이름과 스케줄(Cron Expression)을 설정합니다.\n\n예시 Cron:\n• 0 0 * * * → 매일 자정 실행\n• 0 9 * * 1 → 매주 월요일 오전 9시 실행\n• */30 * * * * → 30분마다 실행" },
  2: { title: "데이터 가져오기 및 적재 (Source → Target)", content: "원본(Source) 테이블 또는 커스텀 SQL의 컬럼을 대상(Target) 테이블의 컬럼에 매핑합니다.\n\nPK 컬럼과 Entity ID를 지정하면 적재 시 자동으로 고유 시퀀스가 채번되어 PK로 들어갑니다.\nEntity ID를 비워두면 UUID가 생성됩니다." },
  3: { title: "데이터 비교 및 검증 (Target ↔ Compare)", content: "대상 테이블과 실제 운영(비교) 테이블을 조인하여 데이터 정합성을 비교합니다.\n\n• 키 매핑: 두 테이블을 연결할 PK/Unique 컬럼을 지정합니다.\n• 변경감지 매핑: 값이 변경되었는지 비교할 컬럼 쌍을 지정합니다." },
  4: { title: "상태값 지정 & PK 보존", content: "비교 결과에 따라 대상 테이블에 상태를 마킹합니다.\n\n• New: 비교 테이블에 존재하지 않는 신규 데이터\n• Match: 두 테이블의 값이 모두 동일\n• Diff: 값이 다른 항목\n\nPK 보존: Match/Diff 시 비교 테이블의 PK 값을 대상 테이블에 저장하여 향후 UPDATE 시 활용합니다." },
  5: { title: "후처리 SQL", content: "동기화 및 상태 마킹이 모두 완료된 후 실행할 SQL을 등록합니다.\n\n예시:\n• 임시 테이블 클린업\n• 집계 테이블 갱신\n• 알림 트리거 등\n\n여러 개 등록 시 순서대로 실행됩니다." }
};

// =========================================
// 컴포넌트: 도움말 모달
// =========================================
const StepHelpModal = ({ step, onClose }) => (
  <div className="modal-overlay" onClick={onClose}>
    <div className="modal-content" onClick={e => e.stopPropagation()}>
      <div className="modal-header">
        <h3>💡 {STEP_GUIDES[step].title}</h3>
        <button className="btn-close" onClick={onClose}>&times;</button>
      </div>
      <div className="modal-body">{STEP_GUIDES[step].content}</div>
      <div className="modal-footer">
        <button className="btn btn-primary" onClick={onClose}>확인</button>
      </div>
    </div>
  </div>
);

// =========================================
// 컴포넌트: 확인 모달 (browser confirm 대체)
// =========================================
const ConfirmModal = ({ icon, title, desc, confirmLabel, confirmType, onConfirm, onCancel }) => (
  <div className="modal-overlay" onClick={onCancel}>
    <div className="confirm-modal-content modal-content" onClick={e => e.stopPropagation()}>
      <div className="confirm-modal-body">
        <div className="confirm-icon">{icon}</div>
        <div className="confirm-title">{title}</div>
        <div className="confirm-desc">{desc}</div>
      </div>
      <div className="confirm-modal-footer">
        <button className="btn btn-confirm-cancel" onClick={onCancel}>취소</button>
        <button className={`btn btn-confirm-ok ${confirmType || ''}`} onClick={onConfirm}>
          {confirmLabel || '확인'}
        </button>
      </div>
    </div>
  </div>
);

// =========================================
// 컴포넌트: 접기/펼치기 카드
// =========================================
const CollapsibleCard = ({ step, title, helpStep, onHelp, extra, defaultOpen = true, children }) => {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="card">
      <div className="card-header" onClick={() => setOpen(o => !o)}>
        <div className="card-header-left">
          {step && <span className="step-badge">{step}</span>}
          <span>{title}</span>
        </div>
        <div className="card-header-right" onClick={e => e.stopPropagation()}>
          {extra}
          {helpStep && (
            <button className="btn-help" onClick={() => onHelp(helpStep)}>
              ❓ 도움말
            </button>
          )}
          <span className={`collapse-icon ${open ? 'open' : 'closed'}`} onClick={e => { e.stopPropagation(); setOpen(o => !o); }}>▼</span>
        </div>
      </div>
      <div className={`card-body ${open ? '' : 'collapsed'}`}>{children}</div>
    </div>
  );
};

// =========================================
// 컴포넌트: 로그 콘솔
// =========================================
const LogConsole = ({ logs }) => {
  const bodyRef = useRef(null);

  useEffect(() => {
    if (bodyRef.current) {
      bodyRef.current.scrollTop = bodyRef.current.scrollHeight;
    }
  }, [logs]);

  const classify = (log) => {
    if (log.includes('✅') || log.includes('💾') || log.includes('완료') || log.includes('성공')) return 'success';
    if (log.includes('❌') || log.includes('오류') || log.includes('실패') || log.includes('Error')) return 'error';
    if (log.includes('⚠️') || log.includes('경고')) return 'warn';
    if (log.includes('🚀') || log.includes('🔍') || log.includes('⚡') || log.includes('📊')) return 'info';
    return 'default';
  };

  return (
    <div className="log-console">
      <div className="log-console-header">
        <div className="log-console-dots">
          <div className="log-console-dot red" />
          <div className="log-console-dot yellow" />
          <div className="log-console-dot green" />
        </div>
        <div className="log-console-title">🖥 Execution Log Console</div>
        <div style={{ width: 60 }} />
      </div>
      <div className="log-console-body" ref={bodyRef}>
        {logs.length === 0
          ? <div className="log-empty">대기 중... 실행 버튼을 누르면 로그가 출력됩니다.</div>
          : logs.map((log, idx) => (
            <div key={idx} className={`log-line ${classify(log)}`}>{log}</div>
          ))
        }
      </div>
    </div>
  );
};

// =========================================
// 메인 앱
// =========================================
function App() {
  const [jobs, setJobs] = useState([]);
  const [tableList, setTableList] = useState([]);
  const [colsCache, setColsCache] = useState({});
  const [selectedJobId, setSelectedJobId] = useState("");
  const [isEditing, setIsEditing] = useState(false);
  const [activeHelpStep, setActiveHelpStep] = useState(null);
  const [srcType, setSrcType] = useState('TABLE');
  const [runLogs, setRunLogs] = useState([]);
  const [isSaving, setIsSaving] = useState(false);
  const [isRunning, setIsRunning] = useState(false);
  const [jobSearch, setJobSearch] = useState('');
  const [confirmState, setConfirmState] = useState(null); // { icon, title, desc, confirmLabel, confirmType, onConfirm }

  const initialForm = {
    sync_id: "", job_name: "", cron_exp: "", use_yn: "Y",
    src_table: "", tgt_table: "", tgt_pk_col: "", ent_id: "", cmp_table: "",
    status_col: "", val_new: "New", val_match: "Match", val_diff: "Diff",
    match_cmp_pk: "", match_tgt_fk: "",
    load_maps: [], cmp_keys: [], cmp_maps: [], post_sqls: [{ sql: "" }]
  };
  const [form, setForm] = useState(initialForm);

  // 확인 모달 열기 헬퍼
  const openConfirm = useCallback((opts) => {
    return new Promise((resolve) => {
      setConfirmState({
        ...opts,
        onConfirm: () => { setConfirmState(null); resolve(true); },
        onCancel: () => { setConfirmState(null); resolve(false); }
      });
    });
  }, []);

  const decodeEntity = (str) => {
    if (!str) return "";
    const txt = document.createElement("textarea");
    txt.innerHTML = str;
    return txt.value;
  };

  const post = async (url, formData) => {
    const headers = {};
    const csrfToken = document.querySelector("meta[name='_csrf']")?.getAttribute("content");
    const csrfHeader = document.querySelector("meta[name='_csrf_header']")?.getAttribute("content");
    if (csrfToken && csrfHeader) headers[csrfHeader] = csrfToken;
    try {
      const res = await fetch(url, { method: 'POST', headers, body: new URLSearchParams(formData) });
      if (res.status === 401 || res.status === 403) return { status: 'err', msg: 'Unauthorized' };
      const text = await res.text();
      try { return JSON.parse(text); } catch { return { status: 'err', msg: 'JSON Parse Error' }; }
    } catch (e) { return { status: 'err', msg: 'Network Error' }; }
  };

  useEffect(() => { loadTables(); loadJobList(); }, []);
  const loadTables = () => post("./Easy_Sync_UI.jsp", { mode: "get_tables" }).then(d => setTableList(Array.isArray(d) ? d : []));
  const loadJobList = () => post("./Easy_Sync_Engine.jsp", { mode: "get_job_list" }).then(d => setJobs(Array.isArray(d) ? d : []));

  const loadCols = async (tbl) => {
    if (!tbl) return;
    const decodedTbl = decodeEntity(tbl);
    const d = await post("./Easy_Sync_UI.jsp", { mode: "get_columns", table_name: decodedTbl });
    if (d.status === 'err') { toast.error(<div>❌ 쿼리 오류<br /><small>{d.msg}</small></div>); return; }
    setColsCache(p => ({ ...p, [tbl]: Array.isArray(d) ? d : [] }));
  };

  const handleLoadJob = async (id) => {
    const data = await post("./Easy_Sync_Engine.jsp", { mode: "get_job_detail", sync_id: id });
    setSelectedJobId(id); setIsEditing(true); setRunLogs([]);
    const parse = (s) => { try { return JSON.parse(decodeEntity(s) || "[]") } catch { return [] } };
    const decodedSrc = decodeEntity(data.src_table);
    setSrcType((decodedSrc && decodedSrc.trim().toUpperCase().startsWith('SELECT')) ? 'SQL' : 'TABLE');
    if (decodedSrc) await loadCols(decodedSrc);
    if (data.tgt_table) await loadCols(data.tgt_table);
    if (data.cmp_table) await loadCols(data.cmp_table);
    setForm({
      ...data, src_table: decodedSrc,
      load_maps: parse(data.load_map_json),
      cmp_keys: parse(data.cmp_key_json),
      cmp_maps: parse(data.cmp_map_json),
      post_sqls: parse(data.post_sql_json).length ? parse(data.post_sql_json) : [{ sql: '' }]
    });
  };

  const handleSave = async () => {
    if (!form.job_name || !form.src_table || !form.tgt_table) {
      return toast.warn("⚠️ 작업명, 원본(Source), 대상(Target) 테이블은 필수입니다.");
    }
    setIsSaving(true);
    const payload = {
      ...form, mode: "save",
      load_map_json: JSON.stringify(form.load_maps),
      cmp_key_json: JSON.stringify(form.cmp_keys),
      cmp_map_json: JSON.stringify(form.cmp_maps),
      post_sql_json: JSON.stringify(form.post_sqls)
    };
    const res = await post("./Easy_Sync_Engine.jsp", payload);
    setIsSaving(false);
    if (res.status === 'ok') { toast.success("💾 성공적으로 저장되었습니다!"); loadJobList(); }
    else { toast.error("저장 실패: " + res.msg); }
  };

  const handleRun = async () => {
    if (!form.sync_id) return toast.warn("⚠️ 먼저 작업을 저장하세요.");
    const ok = await openConfirm({
      icon: "▶️",
      title: "작업을 실행하시겠습니까?",
      desc: `"${form.job_name}" 작업이 즉시 실행됩니다.\n대상 테이블에 데이터가 Insert됩니다.`,
      confirmLabel: "실행",
      confirmType: "success"
    });
    if (!ok) return;

    setIsRunning(true);
    setRunLogs(["⏳ 작업을 서버에 요청 중..."]);
    const id = toast.loading("🚀 작업 실행 중...");
    const res = await post("./Easy_Sync_Engine.jsp", { mode: "run_job", sync_id: form.sync_id });
    setIsRunning(false);
    if (res.logs && Array.isArray(res.logs)) setRunLogs(res.logs);
    if (res.status === 'ok') {
      toast.update(id, { render: "✅ 작업이 완료되었습니다. 로그를 확인하세요.", type: "success", isLoading: false, autoClose: 3000 });
      loadJobList();
    } else {
      toast.update(id, { render: "❌ 실행 실패: " + res.msg, type: "error", isLoading: false, autoClose: 5000 });
    }
  };

  const handleDelete = async () => {
    const ok = await openConfirm({
      icon: "🗑️",
      title: `"${form.job_name}" 작업을 삭제하시겠습니까?`,
      desc: "삭제된 작업은 복구할 수 없습니다.",
      confirmLabel: "삭제",
      confirmType: ""
    });
    if (!ok) return;
    await post("./Easy_Sync_Engine.jsp", { mode: "delete", sync_id: form.sync_id });
    toast.info("🗑️ 작업이 삭제되었습니다.");
    loadJobList();
    setIsEditing(false);
    setSelectedJobId("");
  };

  const updateRow = (k, i, f, v) => setForm(p => { const nl = [...p[k]]; nl[i][f] = v; return { ...p, [k]: nl }; });
  const addRow = (k, o) => setForm(p => ({ ...p, [k]: [...(p[k] || []), o] }));
  const delRow = (k, i) => setForm(p => ({ ...p, [k]: p[k].filter((_, idx) => idx !== i) }));

  // ======== MySelect ========
  const MySelect = ({ options = [], value, onChange, placeholder = "선택" }) => {
    const opts = options.map(o => (typeof o === 'object' ? o : { value: o, label: o }));
    return (
      <Select
        options={opts}
        value={opts.find(o => o.value === value) || null}
        onChange={o => onChange(o ? o.value : "")}
        placeholder={placeholder}
        isClearable={true}
        menuPortalTarget={document.body}
        styles={{
          menuPortal: b => ({ ...b, zIndex: 9999 }),
          control: (b, s) => ({
            ...b,
            minHeight: '36px',
            borderRadius: '7px',
            borderColor: s.isFocused ? '#818cf8' : '#e2e8f0',
            borderWidth: '1.5px',
            boxShadow: s.isFocused ? '0 0 0 3px rgba(99,102,241,0.1)' : 'none',
            fontSize: '0.875rem',
            '&:hover': { borderColor: '#818cf8' }
          }),
          option: (b, s) => ({
            ...b,
            fontSize: '0.875rem',
            backgroundColor: s.isSelected ? '#4f46e5' : s.isFocused ? '#eef2ff' : 'white',
            color: s.isSelected ? 'white' : '#1e293b'
          }),
          placeholder: b => ({ ...b, color: '#94a3b8', fontSize: '0.875rem' }),
          singleValue: b => ({ ...b, fontSize: '0.875rem' })
        }}
      />
    );
  };

  // ======== 스텝 진행 바 ========
  const StepProgress = () => {
    const steps = [
      { num: 1, label: '기본 설정' },
      { num: 2, label: '적재 매핑' },
      { num: 3, label: '비교 매핑' },
      { num: 4, label: '상태값' },
      { num: 5, label: '후처리 SQL' }
    ];
    // 완료 여부 간단 체크
    const isDone = (n) => {
      if (n === 1) return !!(form.job_name && form.cron_exp);
      if (n === 2) return !!(form.src_table && form.tgt_table && form.load_maps.length > 0);
      if (n === 3) return !!(form.cmp_table && form.cmp_keys.length > 0);
      if (n === 4) return !!(form.status_col);
      if (n === 5) return form.post_sqls.some(s => s.sql?.trim());
      return false;
    };
    return (
      <div className="step-progress">
        {steps.map((s, idx) => (
          <React.Fragment key={s.num}>
            <div className={`step-prog-item ${isDone(s.num) ? 'done' : ''}`}>
              <div className="step-prog-num">{isDone(s.num) ? '✓' : s.num}</div>
              <div className="step-prog-label">{s.label}</div>
            </div>
            {idx < steps.length - 1 && <div className={`step-prog-divider ${isDone(s.num) ? 'done' : ''}`} />}
          </React.Fragment>
        ))}
      </div>
    );
  };

  // ======== 사이드바 Job 목록 필터 ========
  const filteredJobs = jobs.filter(j =>
    !jobSearch || j.job_name?.toLowerCase().includes(jobSearch.toLowerCase())
  );

  // ======== 렌더링 ========
  return (
    <div className="container">
      <ToastContainer position="top-right" autoClose={3000} hideProgressBar={false} />

      {/* 확인 모달 */}
      {confirmState && (
        <ConfirmModal
          icon={confirmState.icon}
          title={confirmState.title}
          desc={confirmState.desc}
          confirmLabel={confirmState.confirmLabel}
          confirmType={confirmState.confirmType}
          onConfirm={confirmState.onConfirm}
          onCancel={confirmState.onCancel}
        />
      )}

      {/* 도움말 모달 */}
      {activeHelpStep && <StepHelpModal step={activeHelpStep} onClose={() => setActiveHelpStep(null)} />}

      {/* ── 사이드바 ── */}
      <div className="sidebar">
        <div className="sidebar-header">
          <h3>⚡ Easy Sync V2</h3>
          <div className="sidebar-search">
            <span className="sidebar-search-icon">🔎</span>
            <input
              type="text"
              placeholder="작업 검색..."
              value={jobSearch}
              onChange={e => setJobSearch(e.target.value)}
            />
          </div>
          <button className="sidebar-new-btn" onClick={() => {
            setSelectedJobId(""); setIsEditing(true);
            setForm(initialForm); setRunLogs([]);
            setSrcType('TABLE');
          }}>
            + 새 작업 만들기
          </button>
        </div>

        <div className="sidebar-section-label">작업 목록 ({filteredJobs.length})</div>

        <div className="job-list">
          {filteredJobs.length === 0 && (
            <div style={{ color: '#475569', fontSize: '0.8rem', textAlign: 'center', padding: '20px 0' }}>
              {jobSearch ? '검색 결과 없음' : '등록된 작업이 없습니다.'}
            </div>
          )}
          {filteredJobs.map(job => {
            const hasResult = !!job.last_result;
            const isOk = job.last_result === '성공';
            return (
              <div
                key={job.sync_id}
                className={`job-item ${selectedJobId === job.sync_id ? 'active' : ''}`}
                onClick={() => handleLoadJob(job.sync_id)}
              >
                <div className="job-item-header">
                  <div className="job-title">{job.job_name}</div>
                  <div className={`result-dot ${hasResult ? (isOk ? 'ok' : 'err') : 'none'}`} title={job.last_result || '미실행'} />
                </div>
                <div className="job-info">
                  <span className={`use-badge ${job.use_yn}`}>{job.use_yn}</span>
                  <span className="job-cron">{job.cron_exp || 'Manual'}</span>
                  {job.last_run_dttm && <span>· {job.last_run_dttm}</span>}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* ── 메인 영역 ── */}
      <div className="main">
        {!isEditing ? (
          /* 빈 화면 */
          <div className="empty-state">
            <div className="empty-state-icon">⚡</div>
            <h2>데이터 동기화 작업을 시작하세요</h2>
            <p>왼쪽에서 기존 작업을 선택하거나,<br />새 작업 만들기를 눌러 동기화를 설정하세요.</p>
            <div className="empty-state-steps">
              {[
                ['STEP 1', '기본 설정', '작업명 & 스케줄'],
                ['STEP 2', '적재 매핑', 'Source → Target'],
                ['STEP 3', '비교 매핑', 'Target ↔ Compare'],
                ['STEP 4', '상태 마킹', 'New / Match / Diff'],
                ['STEP 5', '후처리 SQL', '후속 작업 실행'],
              ].map(([badge, title, sub]) => (
                <div key={badge} className="empty-step-chip">
                  <strong>{badge}</strong>
                  <span>{title}</span>
                  <div style={{ fontSize: '0.72rem', marginTop: '2px', color: '#94a3b8' }}>{sub}</div>
                </div>
              ))}
            </div>
          </div>
        ) : (
          <React.Fragment key={selectedJobId || 'new'}>
            {/* 스텝 진행 바 */}
            <StepProgress />

            {/* STEP 1: 기본 설정 */}
            <CollapsibleCard step="STEP 1" title="기본 설정" helpStep={1} onHelp={setActiveHelpStep}>
              <div className="form-row">
                <div className="form-col">
                  <label>작업명 <span style={{ color: '#ef4444' }}>*</span></label>
                  <input type="text" value={form.job_name} onChange={e => setForm(p => ({ ...p, job_name: e.target.value }))} placeholder="예: 고객 데이터 동기화" />
                </div>
                <div className="form-col">
                  <label>Cron Expression</label>
                  <input type="text" value={form.cron_exp} onChange={e => setForm(p => ({ ...p, cron_exp: e.target.value }))} placeholder="예: 0 0 * * * (매일 자정)" />
                </div>
                <div className="form-col" style={{ flex: '0 0 110px' }}>
                  <label>사용 여부</label>
                  <MySelect options={['Y', 'N']} value={form.use_yn} onChange={v => setForm(p => ({ ...p, use_yn: v }))} />
                </div>
              </div>
            </CollapsibleCard>

            {/* STEP 2: 적재 매핑 */}
            <CollapsibleCard
              step="STEP 2"
              title="가져오기 및 대상 적재 매핑"
              helpStep={2}
              onHelp={setActiveHelpStep}
              extra={<button className="btn btn-mini btn-add" onClick={e => { e.stopPropagation(); addRow('load_maps', { src: '', tgt: '' }); }}>+ 매핑 추가</button>}
            >
              {/* Source / Target 테이블 선택 */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 28px 1fr', gap: 14, alignItems: 'start', marginBottom: 14 }}>
                {/* Source 컬럼 */}
                <div className="form-col">
                  <label style={{ color: '#4f46e5' }}>📥 원본 테이블 (Source) <span style={{ color: '#ef4444' }}>*</span></label>
                  <div style={{ display: 'flex', gap: 12, margin: '5px 0 6px', fontSize: '0.8rem' }}>
                    <label style={{ fontWeight: 500, color: '#475569', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4 }}>
                      <input type="radio" checked={srcType === 'TABLE'} onChange={() => setSrcType('TABLE')} />
                      테이블 선택
                    </label>
                    <label style={{ fontWeight: 500, color: '#475569', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4 }}>
                      <input type="radio" checked={srcType === 'SQL'} onChange={() => setSrcType('SQL')} />
                      커스텀 SQL
                    </label>
                  </div>
                  {srcType === 'TABLE'
                    ? <MySelect options={tableList} value={form.src_table} onChange={v => { setForm(p => ({ ...p, src_table: v })); loadCols(v); }} placeholder="Source 테이블 선택..." />
                    : (
                      <>
                        <CodeMirror value={form.src_table} height="90px" extensions={[sql()]} onChange={v => setForm(p => ({ ...p, src_table: v }))} theme="light" basicSetup={{ lineNumbers: true }} />
                        <button className="btn btn-mini btn-add" style={{ marginTop: 6 }} onClick={() => loadCols(form.src_table)}>🔄 컬럼 갱신</button>
                      </>
                    )
                  }
                </div>

                {/* 화살표 - Source 드롭다운 위치에 맞게 paddingTop 조정 */}
                <div style={{ paddingTop: srcType === 'SQL' ? 54 : 54, color: '#818cf8', fontSize: '1.1rem', textAlign: 'center', lineHeight: 1 }}>→</div>

                {/* Target 컬럼 */}
                <div className="form-col">
                  <label style={{ color: '#e11d48' }}>💾 대상 테이블 (Target) <span style={{ color: '#ef4444' }}>*</span></label>
                  {/* 라디오버튼 행 높이(약 27px)와 margin(11px) = 38px 여백 */}
                  <div style={{ height: 38 }} />
                  <MySelect options={tableList} value={form.tgt_table} onChange={v => { setForm(p => ({ ...p, tgt_table: v })); loadCols(v); }} placeholder="Target 테이블 선택..." />
                </div>
              </div>

              {/* PK/Entity 설정 */}
              <div className="section-divider">
                <div className="form-row">
                  <div className="form-col">
                    <label>🔑 Target PK 컬럼 <span style={{ fontSize: '0.72rem', color: '#94a3b8', fontWeight: 400 }}>(비워두면 채번 안함)</span></label>
                    <MySelect options={colsCache[form.tgt_table] || []} value={form.tgt_pk_col} onChange={v => setForm(p => ({ ...p, tgt_pk_col: v }))} placeholder="PK 컬럼 선택..." />
                  </div>
                  <div className="form-col">
                    <label>📝 Entity ID <span style={{ fontSize: '0.72rem', color: '#94a3b8', fontWeight: 400 }}>(비워두면 UUID 생성)</span></label>
                    <input type="text" value={form.ent_id} onChange={e => setForm(p => ({ ...p, ent_id: e.target.value }))} placeholder="예: ENT_CUSTOMER" />
                  </div>
                </div>
              </div>

              {/* 매핑 테이블 */}
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Source 컬럼</th>
                    <th className="arrow-cell" />
                    <th>Target 컬럼 (적재 위치)</th>
                    <th width="44">삭제</th>
                  </tr>
                </thead>
                <tbody>
                  {form.load_maps.length === 0 && (
                    <tr><td colSpan={4} style={{ textAlign: 'center', color: '#94a3b8', padding: '16px', fontSize: '0.82rem' }}>
                      위 "+ 매핑 추가" 버튼으로 컬럼을 매핑하세요.
                    </td></tr>
                  )}
                  {form.load_maps.map((m, i) => (
                    <tr key={i}>
                      <td><MySelect options={colsCache[form.src_table] || []} value={m.src} onChange={v => updateRow('load_maps', i, 'src', v)} /></td>
                      <td className="arrow-cell">→</td>
                      <td><MySelect options={colsCache[form.tgt_table] || []} value={m.tgt} onChange={v => updateRow('load_maps', i, 'tgt', v)} /></td>
                      <td><button className="btn btn-mini btn-del" onClick={() => delRow('load_maps', i)}>✕</button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </CollapsibleCard>

            {/* STEP 3: 비교 테이블 매핑 */}
            <CollapsibleCard step="STEP 3" title="비교 테이블 매핑 (검증용)" helpStep={3} onHelp={setActiveHelpStep}>
              <div className="form-row" style={{ marginBottom: 16 }}>
                <div className="form-col">
                  <label style={{ color: '#0ea5e9' }}>🔍 운영(비교) 테이블 (Compare Table)</label>
                  <MySelect options={tableList} value={form.cmp_table} onChange={v => { setForm(p => ({ ...p, cmp_table: v })); loadCols(v); }} placeholder="비교할 테이블 선택..." />
                </div>
              </div>
              <div style={{ display: 'flex', gap: 20 }}>
                {/* 키 매핑 */}
                <div style={{ flex: 1 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                    <strong style={{ fontSize: '0.83rem', color: '#334155' }}>🔑 키 매핑 (JOIN 기준)</strong>
                    <button className="btn btn-mini btn-add" onClick={() => addRow('cmp_keys', { tgt: '', cmp: '' })}>+ 추가</button>
                  </div>
                  <table className="data-table">
                    <thead><tr><th>Target 컬럼</th><th className="arrow-cell" /><th>Compare 컬럼</th><th width="44">삭제</th></tr></thead>
                    <tbody>
                      {form.cmp_keys.length === 0 && <tr><td colSpan={4} style={{ textAlign: 'center', color: '#94a3b8', padding: '12px', fontSize: '0.8rem' }}>키 매핑을 추가하세요.</td></tr>}
                      {form.cmp_keys.map((k, i) => (
                        <tr key={i}>
                          <td><MySelect options={colsCache[form.tgt_table] || []} value={k.tgt} onChange={v => updateRow('cmp_keys', i, 'tgt', v)} /></td>
                          <td className="arrow-cell">↔</td>
                          <td><MySelect options={colsCache[form.cmp_table] || []} value={k.cmp} onChange={v => updateRow('cmp_keys', i, 'cmp', v)} /></td>
                          <td><button className="btn btn-mini btn-del" onClick={() => delRow('cmp_keys', i)}>✕</button></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                <div style={{ width: 1, background: '#e2e8f0' }} />

                {/* 변경감지 매핑 */}
                <div style={{ flex: 1 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                    <strong style={{ fontSize: '0.83rem', color: '#334155' }}>📑 변경감지 컬럼 매핑</strong>
                    <button className="btn btn-mini btn-add" onClick={() => addRow('cmp_maps', { tgt: '', cmp: '' })}>+ 추가</button>
                  </div>
                  <table className="data-table">
                    <thead><tr><th>Target 컬럼</th><th className="arrow-cell" /><th>Compare 컬럼</th><th width="44">삭제</th></tr></thead>
                    <tbody>
                      {form.cmp_maps.length === 0 && <tr><td colSpan={4} style={{ textAlign: 'center', color: '#94a3b8', padding: '12px', fontSize: '0.8rem' }}>값 비교할 컬럼을 추가하세요.</td></tr>}
                      {form.cmp_maps.map((m, i) => (
                        <tr key={i}>
                          <td><MySelect options={colsCache[form.tgt_table] || []} value={m.tgt} onChange={v => updateRow('cmp_maps', i, 'tgt', v)} /></td>
                          <td className="arrow-cell">↔</td>
                          <td><MySelect options={colsCache[form.cmp_table] || []} value={m.cmp} onChange={v => updateRow('cmp_maps', i, 'cmp', v)} /></td>
                          <td><button className="btn btn-mini btn-del" onClick={() => delRow('cmp_maps', i)}>✕</button></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </CollapsibleCard>

            {/* STEP 4: 상태값 */}
            <CollapsibleCard step="STEP 4" title="상태값 지정 & 기존 PK 보존" helpStep={4} onHelp={setActiveHelpStep}>
              <div className="form-row" style={{ marginBottom: 14 }}>
                <div className="form-col" style={{ flex: '0 0 220px' }}>
                  <label>상태 기록 컬럼 (Target 안)</label>
                  <MySelect options={colsCache[form.tgt_table] || []} value={form.status_col} onChange={v => setForm(p => ({ ...p, status_col: v }))} placeholder="상태 컬럼 선택..." />
                </div>
                <div className="form-col">
                  <label>🆕 New 값</label>
                  <input type="text" value={form.val_new} onChange={e => setForm(p => ({ ...p, val_new: e.target.value }))} />
                </div>
                <div className="form-col">
                  <label>✅ Match 값</label>
                  <input type="text" value={form.val_match} onChange={e => setForm(p => ({ ...p, val_match: e.target.value }))} />
                </div>
                <div className="form-col">
                  <label>⚠️ Diff 값</label>
                  <input type="text" value={form.val_diff} onChange={e => setForm(p => ({ ...p, val_diff: e.target.value }))} />
                </div>
              </div>

              {/* PK 보존 */}
              <div className="section-divider" style={{ background: '#fff7f7', borderColor: '#fca5a5' }}>
                <div style={{ fontSize: '0.78rem', fontWeight: 700, color: '#ef4444', marginBottom: 10, display: 'flex', alignItems: 'center', gap: 6 }}>
                  🔗 기존 PK 보존 설정
                  <span style={{ fontWeight: 400, color: '#94a3b8' }}>— Match/Diff 시 운영 테이블 PK를 대상 테이블에 저장</span>
                </div>
                <div className="form-row">
                  <div className="form-col">
                    <label>비교(운영) 테이블 PK 컬럼</label>
                    <MySelect options={colsCache[form.cmp_table] || []} value={form.match_cmp_pk} onChange={v => setForm(p => ({ ...p, match_cmp_pk: v }))} placeholder="운영 PK (예: cm_id)" />
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', color: '#818cf8', fontSize: '1.2rem', paddingTop: 22, flexShrink: 0 }}>→</div>
                  <div className="form-col">
                    <label>대상(Target) 테이블 저장 컬럼</label>
                    <MySelect options={colsCache[form.tgt_table] || []} value={form.match_tgt_fk} onChange={v => setForm(p => ({ ...p, match_tgt_fk: v }))} placeholder="임시 FK (예: trg_cm_id)" />
                  </div>
                </div>
              </div>
            </CollapsibleCard>

            {/* STEP 5: 후처리 SQL */}
            <CollapsibleCard
              step="STEP 5"
              title="후처리 SQL"
              helpStep={5}
              onHelp={setActiveHelpStep}
              extra={<button className="btn btn-mini btn-add" onClick={e => { e.stopPropagation(); addRow('post_sqls', { sql: "" }); }}>+ SQL 추가</button>}
              defaultOpen={false}
            >
              <table className="data-table">
                <thead>
                  <tr><th>실행할 SQL</th><th width="50" style={{ textAlign: 'center' }}>삭제</th></tr>
                </thead>
                <tbody>
                  {(form.post_sqls || []).map((s, i) => (
                    <tr key={i}>
                      <td>
                        <CodeMirror value={s.sql} height="90px" extensions={[sql()]} onChange={v => updateRow('post_sqls', i, 'sql', v)} theme="light" basicSetup={{ lineNumbers: true }} />
                      </td>
                      <td align="center">
                        <button className="btn btn-mini btn-del" onClick={() => delRow('post_sqls', i)}>✕</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </CollapsibleCard>

            {/* 로그 콘솔 */}
            <LogConsole logs={runLogs} />

            {/* Footer 액션 */}
            <div className="footer-actions">
              {form.sync_id && (
                <button className="btn btn-delete-job" onClick={handleDelete}>🗑️ 삭제</button>
              )}
              <button className="btn btn-save" onClick={handleSave} disabled={isSaving}>
                {isSaving ? <><span className="spinner" /> 저장 중...</> : '💾 저장하기'}
              </button>
              <button className="btn btn-exec" onClick={handleRun} disabled={isRunning || !form.sync_id}>
                {isRunning ? <><span className="spinner" /> 실행 중...</> : '▶️ 실행하기'}
              </button>
            </div>

            <div style={{ height: 24 }} />
          </React.Fragment>
        )}
      </div>
    </div>
  );
}

export default App;
