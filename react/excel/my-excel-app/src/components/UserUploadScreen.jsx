import React from 'react';
import { toast } from 'react-toastify';
import StepIndicator from './StepIndicator';

const UserIntroStep = ({ jobName, instructions, sampleFileName, downloadSampleFile }) => (
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

const UserWorkbenchStep = ({
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
  sampleFileName,
  jobName,
  instructions,
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
  downloadSampleFile,
}) => {
  const [previewSearchTerm, setPreviewSearchTerm] = React.useState('');
  const [showErrorColumnsOnly, setShowErrorColumnsOnly] = React.useState(false);
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
  const failedColumnIndexSet = React.useMemo(() => {
    const set = new Set();
    Object.entries(failedRows).forEach(([rowKey, message]) => {
      if (rowKey === '__unknown__') return;
      parseFailedColsFromMsg(message || '').forEach(info => {
        if (info.colIdx !== null) set.add(info.colIdx);
      });
    });
    return set;
  }, [failedRows, parseFailedColsFromMsg]);
  const visibleColumnIndexes = React.useMemo(() => {
    if (!showErrorColumnsOnly || failedColumnIndexSet.size === 0) {
      return excelHeaders.map((_, idx) => idx);
    }
    return excelHeaders.map((_, idx) => idx).filter(idx => failedColumnIndexSet.has(idx));
  }, [excelHeaders, failedColumnIndexSet, showErrorColumnsOnly]);
  const searchKeyword = previewSearchTerm.trim().toLowerCase();
  const filteredPreviewData = previewData.filter((row, index) => {
    const rowNum = row._rowNum ?? ((previewPage - 1) * previewPageSize + index + 1);
    const isFailedRow = failedRows[String(rowNum)] !== undefined && !failedRows.__unknown__;
    if (showOnlyFailedRows && !isFailedRow) {
      return false;
    }
    if (!searchKeyword) {
      return true;
    }
    return visibleColumnIndexes.some(colIdx => {
      const cellValue = Array.isArray(row) ? (row[colIdx] || '') : (row[String(colIdx)] || '');
      return String(cellValue).toLowerCase().includes(searchKeyword);
    });
  });
  const checklistItems = [
    {
      label: '파일 형식 확인',
      ok: !hasFile || /\.(xlsx|xls)$/i.test(file.name),
      detail: hasFile ? '지원 형식으로 인식되었습니다.' : '.xls 또는 .xlsx 파일을 선택하세요.',
    },
    {
      label: '헤더 인식',
      ok: !hasFile || excelHeaders.length > 0,
      detail: hasFile ? `헤더 ${excelHeaders.length}개를 읽었습니다.` : `헤더 기준은 ${headerRow}행입니다.`,
    },
    {
      label: '데이터 건수',
      ok: !hasFile || totalRows > 0,
      detail: hasFile ? `업로드 대상 ${totalRows.toLocaleString()}건` : '파일 선택 후 건수를 계산합니다.',
    },
    {
      label: '오류 여부',
      ok: !hasFile || (!hasKnownFailedRows && !hasUnknownFailedRows),
      detail: !hasFile ? '사전 점검 전입니다.' : hasUnknownFailedRows ? '실패 건은 있으나 행 특정이 필요합니다.' : hasKnownFailedRows ? `${failedRowCount}개 행 수정 필요` : '즉시 업로드 가능한 상태입니다.',
    },
  ];

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

  const sessionModeLabel = !hasFile
    ? '새 업로드 시작'
    : previewLoading
      ? '파일 점검 중'
      : hasKnownFailedRows || hasUnknownFailedRows
        ? '오류 수정 작업'
        : '업로드 실행 준비';

  return (
    <div className="wizard-panel">
      <div className="wizard-panel-title">📂 엑셀업로드 WorkBench</div>
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

          <div className="result-priority-strip">
            {uploadResult.status === 'ok' && (
              <div className="result-priority-card priority-success">
                <div className="result-priority-title">권장 다음 작업</div>
                <div className="result-priority-desc">같은 양식으로 이어서 업로드하거나 최근 이력을 확인하세요.</div>
              </div>
            )}
            {uploadResult.status === 'partial' && (
              <div className="result-priority-card priority-warning">
                <div className="result-priority-title">먼저 실패 행 수정이 가장 빠릅니다</div>
                <div className="result-priority-desc">오류 리포트보다 먼저 미리보기 작업대로 돌아가 빨간 셀만 수정하면 재업로드가 더 빠릅니다.</div>
              </div>
            )}
            {uploadResult.status === 'err' && (
              <div className="result-priority-card priority-danger">
                <div className="result-priority-title">오류 원인 확인 후 다시 시도</div>
                <div className="result-priority-desc">원문 오류와 해결 가이드를 먼저 보고 파일 또는 설정을 조정한 뒤 다시 업로드하세요.</div>
              </div>
            )}
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

          <div className={`result-action-grid ${uploadResult.status === 'partial' ? 'result-action-grid-priority' : ''}`}>
            {uploadResult.status !== 'ok' && file && (
              <button className={`result-action-card action-primary ${uploadResult.status === 'partial' ? 'action-emphasis' : ''}`} onClick={openCorrectionWorkbench}>
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
            <div style={{ marginTop: '10px', display: 'flex', justifyContent: 'flex-end' }}>
              <button className="inline-control-btn" onClick={handleCancelUpload} disabled={cancellingUpload}>
                {cancellingUpload ? '취소 요청 중...' : '업로드 취소'}
              </button>
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
          <div className="focus-workbench-hero">
            <div className={`focus-hero-main focus-hero-main-${validationTone}`}>
              <div className="focus-hero-kicker">작업 세션</div>
              <div className="focus-hero-title-row">
                <div className="focus-hero-title">{sessionModeLabel}</div>
                <div className={`focus-hero-badge focus-hero-badge-${validationTone}`}>
                  {!hasFile ? '대기' : previewLoading ? '분석 중' : hasKnownFailedRows || hasUnknownFailedRows ? '수정 필요' : 'Ready'}
                </div>
              </div>
              <div className="focus-hero-desc">{validationSummaryText}</div>
              <div className="focus-hero-metrics">
                <div className="focus-hero-metric">
                  <span className="focus-hero-metric-label">파일</span>
                  <strong>{hasFile ? file.name : '선택 전'}</strong>
                </div>
                <div className="focus-hero-metric">
                  <span className="focus-hero-metric-label">데이터</span>
                  <strong>{hasFile ? `${totalRows.toLocaleString()}건` : '.xls / .xlsx'}</strong>
                </div>
                <div className="focus-hero-metric">
                  <span className="focus-hero-metric-label">현재 상태</span>
                  <strong>{hasKnownFailedRows ? `${failedRowCount}개 오류` : editedRowCount > 0 ? `${editedRowCount}개 수정` : '점검 대기'}</strong>
                </div>
              </div>
            </div>
          </div>

          <div className="preflight-checklist-card">
            <div className="preflight-checklist-head">
              <div>
                <div className="preflight-checklist-title">업로드 전 체크리스트</div>
                <div className="preflight-checklist-desc">실행 전에 가장 자주 헷갈리는 지점을 빠르게 확인합니다.</div>
              </div>
              <div className={`preflight-checklist-summary ${checklistItems.every(item => item.ok) ? 'ok' : 'warn'}`}>
                {checklistItems.filter(item => item.ok).length} / {checklistItems.length} 통과
              </div>
            </div>
            <div className="preflight-checklist-grid">
              {checklistItems.map(item => (
                <div key={item.label} className={`preflight-check-item ${item.ok ? 'ok' : 'warn'}`}>
                  <div className="preflight-check-icon">{item.ok ? '✓' : '!'}</div>
                  <div>
                    <div className="preflight-check-label">{item.label}</div>
                    <div className="preflight-check-detail">{item.detail}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {!hasFile ? (
            <div className="upload-workspace-grid workbench-grid-empty">
              <div className="workspace-card workspace-card-drop workspace-card-drop-focus">
                <div className="workspace-card-title">파일 업로드</div>
                <div className="workspace-card-desc">양식에 맞는 엑셀 파일을 선택하면 사전 점검과 작업 화면이 바로 열립니다.</div>
                <label
                  htmlFor="fileInput"
                  className={`redesign-dropzone ${isDragging ? 'dragging' : ''}`}
                  onDragOver={e => { e.preventDefault(); setIsDragging(true); }}
                  onDragLeave={e => { e.preventDefault(); setIsDragging(false); }}
                  onDrop={e => {
                    e.preventDefault();
                    setIsDragging(false);
                    const dropped = e.dataTransfer.files[0];
                    if (dropped && (dropped.name.endsWith('.xlsx') || dropped.name.endsWith('.xls'))) processSelectedFile(dropped);
                    else if (dropped) toast.error('❌ .xls/.xlsx만 가능합니다.');
                  }}
                >
                  <input type="file" id="fileInput" accept=".xls,.xlsx" style={{ display: 'none' }} onChange={e => { const selected = e.target.files[0]; if (selected) processSelectedFile(selected); }} />
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

              <div className="workspace-side-stack workspace-side-stack-focus">
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
            <div className="upload-workspace-grid workbench-grid-focus">
              <div className="workspace-main-stack">
                <div className="workspace-card workspace-card-session">
                  <div className="workspace-card-head">
                    <div>
                      <div className="workspace-card-title">현재 작업 세션</div>
                      <div className="workspace-card-desc">파일 맥락과 현재 수정 상태를 유지한 채 바로 작업대에서 이어서 처리합니다.</div>
                    </div>
                    <button className="side-action-btn side-action-btn-danger" onClick={clearSelectedFile}>파일 제거</button>
                  </div>
                  <div className="summary-chip-list summary-chip-list-session">
                    <span className="summary-chip strong">{file.name}</span>
                    <span className="summary-chip">{formatFileSize(file.size)}</span>
                    <span className="summary-chip">헤더 {excelHeaders.length}개</span>
                    <span className="summary-chip">데이터 {totalRows.toLocaleString()}건</span>
                    <span className="summary-chip">헤더 기준 {headerRow}행</span>
                  </div>
                </div>

                <div className="workspace-card workspace-card-workbench">
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
                    <>
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
                      {validationSummary.totalErrItems > 0 && (
                        <div style={{ marginTop: '10px', border: '1px solid #fed7aa', background: '#fff7ed', borderRadius: '10px', padding: '10px 12px' }}>
                          <div style={{ fontWeight: 700, fontSize: '0.82rem', color: '#9a3412', marginBottom: '8px' }}>🔎 검증 요약 리포트</div>
                          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0,1fr))', gap: '10px' }}>
                            <div>
                              <div style={{ fontSize: '0.73rem', color: '#7c2d12', marginBottom: '5px', fontWeight: 700 }}>오류 유형별</div>
                              {validationSummary.topTypes.map(([name, cnt]) => (
                                <div key={name} style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.74rem', color: '#7c2d12', marginBottom: '2px' }}>
                                  <span>{name}</span><strong>{cnt}건</strong>
                                </div>
                              ))}
                            </div>
                            <div>
                              <div style={{ fontSize: '0.73rem', color: '#7c2d12', marginBottom: '5px', fontWeight: 700 }}>문제 컬럼 TOP</div>
                              {validationSummary.topColumns.map(([name, cnt]) => (
                                <div key={name} style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.74rem', color: '#7c2d12', marginBottom: '2px' }}>
                                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '80%' }}>{name}</span><strong>{cnt}건</strong>
                                </div>
                              ))}
                            </div>
                          </div>
                          {validationSummary.unknownCnt > 0 && (
                            <div style={{ marginTop: '6px', fontSize: '0.72rem', color: '#9a3412' }}>
                              행 특정 불가 오류: {validationSummary.unknownCnt}건
                            </div>
                          )}
                        </div>
                      )}
                    </>
                  )}
                  
                  {hasPreview && (
                    <>
                      <div className="workbench-toolbar">
                        <div className="workbench-toolbar-left">
                          <label className="workbench-search">
                            <span className="workbench-search-icon">⌕</span>
                            <input
                              value={previewSearchTerm}
                              onChange={e => setPreviewSearchTerm(e.target.value)}
                              placeholder="표에서 값 검색"
                            />
                          </label>
                          <button className={`inline-control-btn ${showOnlyFailedRows ? 'active' : ''}`} onClick={() => setShowOnlyFailedRows(prev => !prev)} disabled={!hasKnownFailedRows}>
                            {showOnlyFailedRows ? '전체 행 보기' : '오류 행만 보기'}
                          </button>
                          <button className={`inline-control-btn ${showErrorColumnsOnly ? 'active' : ''}`} onClick={() => setShowErrorColumnsOnly(prev => !prev)} disabled={failedColumnIndexSet.size === 0}>
                            {showErrorColumnsOnly ? '전체 컬럼 보기' : '오류 컬럼만 보기'}
                          </button>
                          {editedRowCount > 0 && <button className="inline-control-btn" onClick={() => setEditedCells({})}>수정한 행 초기화</button>}
                        </div>
                        {hasKnownFailedRows && (
                          <div className="error-nav-cluster">
                            <span className="error-nav-status">
                              {currentSelectedErrorIndex >= 0 ? `오류 ${currentSelectedErrorIndex + 1} / ${knownFailedRows.length}` : `오류 ${knownFailedRows.length}건`}
                            </span>
                            <button className="inline-control-btn" onClick={() => moveBetweenFailedRows(-1)}>이전 오류</button>
                            <button className="inline-control-btn" onClick={() => moveBetweenFailedRows(1)}>다음 오류</button>
                          </div>
                        )}
                      </div>

                      {filteredPreviewData.length === 0 && (showOnlyFailedRows || searchKeyword) && (
                        <div className="table-empty-state">
                          <div className="table-empty-title">
                            {searchKeyword ? '검색 조건에 맞는 행이 없습니다.' : '현재 페이지에는 오류 행이 없습니다.'}
                          </div>
                          <div className="table-empty-desc">
                            {searchKeyword ? '검색어를 지우거나 전체 컬럼 보기로 바꿔 다시 확인해 주세요.' : '다음 오류 버튼을 누르면 오류가 있는 페이지로 바로 이동할 수 있습니다.'}
                          </div>
                        </div>
                      )}

                      <div className="workbench-table-shell">
                        {previewLoading && <div style={{ position: 'absolute', inset: 0, background: 'rgba(255,255,255,0.72)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 2, fontWeight: 700, color: '#3182f6' }}>미리보기 갱신 중...</div>}
                        <table className="data-table" style={{ margin: 0, whiteSpace: 'nowrap', border: 'none' }}>
                          <thead style={{ position: 'sticky', top: 0, zIndex: 1 }}>
                            <tr>
                              <th style={{ width: '46px', textAlign: 'center', color: '#8b95a1', background: '#f2f4f6' }}>No.</th>
                              {visibleColumnIndexes.map(i => <th key={i}>{excelHeaders[i].label}</th>)}
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
                                    {visibleColumnIndexes.map((cIdx) => {
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
                                      <td colSpan={visibleColumnIndexes.length} style={{ padding: '5px 10px 7px', borderBottom: '2px solid #fca5a5', background: '#fff1f2' }}>
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
                        <div className="table-pagination-bar">
                          <span className="table-pagination-meta">{((previewPage - 1) * previewPageSize + 1).toLocaleString()} ~ {Math.min(previewPage * previewPageSize, totalRows).toLocaleString()}행 / 전체 {totalRows.toLocaleString()}건</span>
                          <div className="table-pagination-actions">
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
                                className={`table-page-btn ${pg === previewPage ? 'active' : ''}`}
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

              <div className="workspace-side-stack workspace-side-stack-sticky">
                <div className={`workspace-card workspace-card-${hasKnownFailedRows || hasUnknownFailedRows ? 'warning' : 'positive'} workspace-card-command`}>
                  <div className="workspace-card-title">{uploadReadyLabel}</div>
                  <div className="workspace-card-desc">{uploadReadyDesc}</div>
                  <div className="workspace-guide-list compact workspace-guide-list-command">
                    <div>헤더 기준: {headerRow}행</div>
                    <div>수정된 행: {editedRowCount}건</div>
                    <div>오류 행: {failedRowCount}건</div>
                  </div>
                  {isAdmin && <div style={{ marginTop: '14px' }}>{renderDebugUploadOptions(false)}</div>}
                  <div className="workspace-action-stack">
                    {hasKnownFailedRows && <button className="side-action-btn side-action-btn-danger" onClick={selectedErrorRow ? () => moveBetweenFailedRows(1) : moveToFirstFailedRow}>{selectedErrorRow ? '다음 오류 확인' : '첫 오류 확인'}</button>}
                    {editedRowCount > 0 && <button className="side-action-btn" onClick={() => setEditedCells({})}>수정 내용 초기화</button>}
                    <button className="side-action-btn" onClick={handleValidate} disabled={previewLoading || validating}>
                      {validating ? '검증 중...' : '검증 실행'}
                    </button>
                    {hasKnownFailedRows && (
                      <button className="side-action-btn" onClick={() => handleUpload({ retryFailedOnly: true })} disabled={previewLoading || validating}>
                        실패행만 재처리
                      </button>
                    )}
                    <button className="side-action-btn side-action-btn-primary" onClick={handleUpload} disabled={previewLoading || validating}>
                      {hasKnownFailedRows || hasUnknownFailedRows ? '수정 후 재업로드' : '업로드 실행'}
                    </button>
                  </div>
                </div>

                <div className="workspace-card workspace-card-guide-compact">
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
          )}
        </div>
      )}
    </div>
  );
};

const UserUploadScreen = ({
  steps,
  currentStep,
  isLastStep,
  goPrev,
  goNext,
  canGoNext,
  nextLabel,
  hideNextBtn,
  userStepProps,
}) => {
  const content = currentStep === 0
    ? <UserIntroStep {...userStepProps} />
    : <UserWorkbenchStep {...userStepProps} />;

  return (
    <>
      <StepIndicator steps={steps} current={currentStep} />
      <div style={{ background: 'white', borderRadius: '16px', boxShadow: '0 1px 3px rgba(0,0,0,0.07), 0 4px 20px rgba(0,0,0,0.04)', border: '1px solid #f1f5f9', overflow: 'hidden' }}>
        {content}
        {!isLastStep && (
          <div style={{ padding: '18px 32px', borderTop: '1px solid #f1f5f9', display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: '#fafafa' }}>
            <button onClick={goPrev} disabled={currentStep === 0} style={{ padding: '10px 22px', borderRadius: '10px', border: '1px solid #e2e8f0', background: 'white', color: currentStep === 0 ? '#cbd5e1' : '#475569', fontWeight: 600, cursor: currentStep === 0 ? 'not-allowed' : 'pointer', fontSize: '0.88rem' }}>
              ← 이전
            </button>
            <span style={{ fontSize: '0.75rem', color: '#94a3b8' }}>{currentStep + 1} / {steps.length}</span>
            {!hideNextBtn ? (
              <button onClick={goNext} disabled={!canGoNext} style={{ padding: '10px 26px', borderRadius: '10px', border: 'none', background: canGoNext ? 'linear-gradient(135deg,#6366f1,#8b5cf6)' : '#e2e8f0', color: canGoNext ? 'white' : '#94a3b8', fontWeight: 700, cursor: canGoNext ? 'pointer' : 'not-allowed', fontSize: '0.88rem', boxShadow: canGoNext ? '0 2px 8px rgba(99,102,241,0.28)' : 'none' }}>
                {nextLabel}
              </button>
            ) : <div />}
          </div>
        )}
      </div>
    </>
  );
};

export default UserUploadScreen;
