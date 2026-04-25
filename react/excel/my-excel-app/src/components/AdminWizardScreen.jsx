import React from 'react';
import { toast } from 'react-toastify';
import StepIndicator from './StepIndicator';

const AdminStageHero = ({ eyebrow, title, desc, status, meta = [] }) => (
  <div className="admin-stage-hero">
    <div className="admin-stage-hero-main">
      <div className="admin-stage-eyebrow">{eyebrow}</div>
      <div className="admin-stage-title-row">
        <div className="admin-stage-title">{title}</div>
        <div className="admin-stage-status">{status}</div>
      </div>
      <div className="admin-stage-desc">{desc}</div>
      {meta.length > 0 && (
        <div className="admin-stage-meta-list">
          {meta.map(item => (
            <div key={item.label} className="admin-stage-meta-item">
              <span className="admin-stage-meta-label">{item.label}</span>
              <strong>{item.value}</strong>
            </div>
          ))}
        </div>
      )}
    </div>
  </div>
);

const AdminOpsStrip = ({ items = [] }) => (
  <div className="admin-ops-strip">
    {items.map(item => (
      <div key={item.label} className={`admin-ops-card${item.tone ? ` ${item.tone}` : ''}`}>
        <span className="admin-ops-label">{item.label}</span>
        <strong className="admin-ops-value">{item.value}</strong>
        {item.desc && <span className="admin-ops-desc">{item.desc}</span>}
      </div>
    ))}
  </div>
);

const AdminStep0 = ({
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
}) => (
  <div className="wizard-panel">
    <AdminStageHero
      eyebrow="Admin Setup"
      title="기본 설정"
      status="Step 1"
      desc="업로드 작업의 이름, 헤더 기준, 샘플 양식, 사용자 안내 문구를 먼저 정리합니다."
      meta={[
        { label: '작업명', value: jobName?.trim() || '미입력' },
        { label: '헤더 행', value: `${headerRow || 1}행` },
        { label: '샘플 파일', value: sampleFileName || sampleFile?.name || '없음' },
      ]}
    />
    <AdminOpsStrip
      items={[
        { label: '작업명 점검', value: jobName?.trim() ? '완료' : '입력 필요', desc: jobName?.trim() || '사용자에게 보일 작업 이름을 정하세요.', tone: jobName?.trim() ? 'success' : 'warn' },
        { label: '헤더 기준', value: `${headerRow || 1}행`, desc: '엑셀 헤더가 인식될 행 번호입니다.' },
        { label: '샘플 양식', value: sampleFileName || sampleFile?.name || '등록 전', desc: sampleFileName || sampleFile?.name ? '사용자 다운로드 양식으로 활용됩니다.' : '샘플 파일을 등록해두면 문의가 줄어듭니다.', tone: sampleFileName || sampleFile?.name ? 'success' : 'warn' },
        { label: '안내 문구', value: instructions?.trim() ? '작성됨' : '권장', desc: instructions?.trim() ? '사용자 화면에 바로 노출됩니다.' : '업로드 규칙과 예외사항을 적어두면 좋습니다.', tone: instructions?.trim() ? 'success' : 'warn' },
      ]}
    />
    <div className="preflight-checklist-card admin-checklist-card">
      <div className="preflight-checklist-head">
        <div>
          <div className="preflight-checklist-title">설정 전 체크포인트</div>
          <div className="preflight-checklist-desc">저장 전에 운영자가 다시 확인해야 할 항목을 한곳에 모았습니다.</div>
        </div>
        <div className={`preflight-checklist-summary ${(jobName?.trim() && (sampleFileName || sampleFile?.name)) ? 'ok' : 'warn'}`}>
          {(jobName?.trim() ? 1 : 0) + ((sampleFileName || sampleFile?.name) ? 1 : 0) + (instructions?.trim() ? 1 : 0)} / 3 점검
        </div>
      </div>
      <div className="preflight-checklist-grid admin-checklist-grid">
        {[
          { label: '작업명', detail: jobName?.trim() || '사용자 화면 제목으로 노출됩니다.', ok: !!jobName?.trim() },
          { label: '샘플 양식', detail: sampleFileName || sampleFile?.name || '등록해두면 재문의가 줄어듭니다.', ok: !!(sampleFileName || sampleFile?.name) },
          { label: '안내 문구', detail: instructions?.trim() || '입력해두면 업로드 실패를 줄이는 데 도움이 됩니다.', ok: !!instructions?.trim() },
        ].map(item => (
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
        <input
          type="file"
          id="sampleFileInput"
          accept=".xls,.xlsx"
          onChange={e => {
            const selected = e.target.files[0];
            if (selected) {
              setSampleFile(selected);
              setSampleFileName(selected.name);
              setSampleFileDownloadName(prev => prev?.trim() ? prev : selected.name);
            }
          }}
          style={{ flex: 1, padding: '8px', border: '1px solid #e2e8f0', borderRadius: '8px', background: 'white', fontSize: '0.88rem' }}
        />
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

const AdminStep1 = ({
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
}) => {
  const childCount = Math.max(0, structs.length - 1);
  const upsertCount = structs.filter(s => (s.upsert_keys || []).length > 0).length;

  return (
    <div className="wizard-panel">
      <AdminStageHero
      eyebrow="Structure Design"
      title="테이블 구조와 SQL 설계"
      status="Step 2"
      desc="ROOT부터 하위 테이블 관계, PK/FK, UPSERT 키와 Pre/Post/Row SQL까지 한 번에 설계합니다."
      meta={[
        { label: '테이블 수', value: `${structs.length}개` },
        { label: 'Pre-SQL', value: `${preSqls.length}개` },
        { label: 'Post-SQL', value: `${postSqls.length}개` },
      ]}
    />
      <AdminOpsStrip
        items={[
          { label: 'ROOT', value: structs[0]?.table || '미선택', desc: '업로드의 시작 테이블입니다.', tone: structs[0]?.table ? 'success' : 'warn' },
          { label: '하위 테이블', value: `${childCount}개`, desc: childCount > 0 ? '계층 업로드가 구성되어 있습니다.' : '단일 테이블 업로드 구조입니다.' },
          { label: 'UPSERT 설정', value: `${upsertCount}개`, desc: upsertCount > 0 ? '업데이트 키가 지정된 테이블이 있습니다.' : '모든 테이블이 INSERT 전용입니다.' },
          { label: '행 단위 SQL', value: `${rowSqls.length}개`, desc: rowSqls.length > 0 ? '행마다 실행되는 후처리가 있습니다.' : '추가 후처리 없이 기본 저장만 수행합니다.' },
        ]}
      />
    <div className="wiz-section" style={{ marginTop: '28px' }}>
      <div className="wiz-section-title">테이블 구조</div>
      <div style={{ overflowX: 'auto' }}>
        <table className="data-table" style={{ fontSize: '0.82rem' }}>
          <thead><tr><th>Alias</th><th>Table</th><th>Entity ID</th><th>PK Column</th><th>Parent</th><th>FK Column</th><th>업데이트 키 (UPSERT)</th><th width="50">삭제</th></tr></thead>
          <tbody>
            {structs.map((s, i) => (
              <tr key={i}>
                <td>{i === 0 ? <b style={{ color: '#6366f1' }}>ROOT</b> : <input type="text" value={s.alias} onChange={e => handleStructAliasChange(i, e.target.value)} className="wiz-input-sm" />}</td>
                <td style={{ minWidth: '200px' }}><MySelect options={tableList} value={s.table} onChange={v => handleStructTableChange(i, v)} placeholder="테이블 선택" /></td>
                <td style={{ minWidth: '90px' }}><input type="text" value={s.ent_id || ''} onChange={e => { const next = [...structs]; next[i].ent_id = e.target.value.toUpperCase(); setStructs(next); }} placeholder="예: CM" className="wiz-input-sm" style={{ textTransform: 'uppercase' }} /></td>
                <td style={{ minWidth: '180px' }}><MySelect options={colsCache[s.table] || []} value={s.pk_col} onChange={v => { const next = [...structs]; next[i].pk_col = v; setStructs(next); }} placeholder="PK 선택" /></td>
                <td style={{ minWidth: '150px' }}>{i > 0 && <MySelect options={structs.map(x => x.alias)} value={s.parent} onChange={v => { const next = [...structs]; next[i].parent = v; setStructs(next); }} placeholder="부모" />}</td>
                <td style={{ minWidth: '130px' }}>{i > 0 && <input type="text" value={s.fk} onChange={e => { const next = [...structs]; next[i].fk = e.target.value; setStructs(next); }} placeholder="FK 컬럼" className="wiz-input-sm" />}</td>
                <td style={{ minWidth: '240px' }}>
                  <MyMultiSelect options={colsCache[s.table] || []} value={s.upsert_keys || []} onChange={v => { const next = [...structs]; next[i].upsert_keys = v; setStructs(next); }} placeholder={s.table ? '키 선택 (없으면 INSERT 전용)' : '테이블 먼저 선택'} isDisabled={!s.table} />
                  {s.upsert_keys?.length > 0 && <div style={{ marginTop: '3px', fontSize: '0.7rem', color: '#92400e', background: '#fef9c3', padding: '2px 6px', borderRadius: '4px' }}>🔄 UPSERT 모드</div>}
                </td>
                <td style={{ textAlign: 'center' }}>{i > 0 && <button className="btn btn-mini btn-del" onClick={() => handleRemoveStruct(i)}>삭제</button>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <button className="btn btn-mini btn-add" onClick={() => { const alias = 'T' + structs.length; setStructs([...structs, { alias, table: '', pk_col: '', parent: 'ROOT', fk: '', upsert_keys: [] }]); setMapping(prev => ({ ...prev, [alias]: {} })); }} style={{ marginTop: '12px' }}>+ 하위 테이블 추가</button>
    </div>
    <div className="wiz-section">
      <div className="wiz-section-title">SQL 설정</div>
      <div className="wiz-grid-2">
        <SqlEditor title="⚡ Pre-SQL" sqls={preSqls} setSqls={setPreSqls} tooltip="업로드 전 1회 실행" />
        <SqlEditor title="✅ Post-SQL" sqls={postSqls} setSqls={setPostSqls} tooltip="업로드 후 1회 실행" />
      </div>
      <SqlEditor title="🔁 Row-SQL (행마다 실행)" sqls={rowSqls} setSqls={setRowSqls} tooltip="각 행이 처리될 때마다 실행됩니다. SQL 안에 ${토큰명} 형식으로 값을 동적으로 삽입할 수 있습니다." />
      <div style={{ marginTop: '4px', borderRadius: '12px', border: '1px solid #e0e7ff', background: 'linear-gradient(135deg, #f8f9ff 0%, #faf5ff 100%)', overflow: 'hidden' }}>
        <div style={{ padding: '10px 16px', background: 'linear-gradient(90deg, #6366f1, #8b5cf6)', display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span style={{ fontSize: '14px' }}>🔖</span>
          <span style={{ fontWeight: 700, fontSize: '0.82rem', color: 'white' }}>Row-SQL 토큰 사용 가이드</span>
          <span style={{ marginLeft: 'auto', fontSize: '0.72rem', color: 'rgba(255,255,255,0.75)', fontStyle: 'italic' }}>{'${토큰명}'} 형식으로 SQL 내 어디서든 사용</span>
        </div>
        <div style={{ padding: '14px 16px' }}>
          <div style={{ marginBottom: '10px' }}>
            <div style={{ fontSize: '0.72rem', fontWeight: 700, color: '#6366f1', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '8px' }}>📌 기본 제공 토큰</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: '6px' }}>
              {[
                { token: '${NEW_ID}', badge: '필수', badgeColor: '#ef4444', desc: '현재 행에 채번된 신규 PK 값', ex: 'UPDATE log SET ref_id = ${NEW_ID}' },
                { token: '${PARENT_ID}', badge: '계층', badgeColor: '#f59e0b', desc: '부모 테이블의 PK 값 (하위 테이블에서 사용)', ex: 'WHERE parent_key = ${PARENT_ID}' },
                { token: '${PK_COL}', badge: '메타', badgeColor: '#64748b', desc: '현재 테이블의 PK 컬럼명 (문자열)', ex: '-- PK 컬럼명: ${PK_COL}' },
                { token: '${ALIAS}', badge: '메타', badgeColor: '#64748b', desc: '현재 처리 중인 테이블 Alias (예: ROOT)', ex: '-- Alias: ${ALIAS}' },
                { token: '${TABLE}', badge: '메타', badgeColor: '#64748b', desc: '현재 처리 중인 실제 테이블명', ex: '-- Table: ${TABLE}' },
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
          <div style={{ marginBottom: '10px' }}>
            <div style={{ fontSize: '0.72rem', fontWeight: 700, color: '#059669', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '8px' }}>📊 엑셀 원본값 토큰</div>
            <div style={{ background: 'white', border: '1px solid #e8ecf0', borderRadius: '8px', padding: '10px 14px', display: 'flex', gap: '16px', flexWrap: 'wrap', alignItems: 'flex-start' }}>
              <div style={{ flex: 1, minWidth: '220px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '5px' }}>
                  <code style={{ fontSize: '0.8rem', fontWeight: 700, color: '#059669', background: '#ecfdf5', padding: '2px 8px', borderRadius: '5px', fontFamily: 'monospace' }}>{'${COL_0}'}</code>
                  <code style={{ fontSize: '0.8rem', fontWeight: 700, color: '#059669', background: '#ecfdf5', padding: '2px 8px', borderRadius: '5px', fontFamily: 'monospace' }}>{'${COL_1}'}</code>
                  <code style={{ fontSize: '0.8rem', fontWeight: 500, color: '#94a3b8', background: '#f1f5f9', padding: '2px 8px', borderRadius: '5px', fontFamily: 'monospace' }}>...</code>
                </div>
                <div style={{ fontSize: '0.76rem', color: '#475569', marginBottom: '3px' }}>엑셀 열 번호(0부터 시작)에 해당하는 <strong>원본 셀 값</strong>을 그대로 삽입합니다.</div>
                <div style={{ fontSize: '0.71rem', color: '#94a3b8', fontFamily: 'monospace' }}>예) A열 = {'${COL_0}'} | B열 = {'${COL_1}'} | C열 = {'${COL_2}'}</div>
              </div>
              <div style={{ background: '#f0fdf4', border: '1px solid #a7f3d0', borderRadius: '7px', padding: '8px 12px', fontSize: '0.76rem', color: '#065f46', minWidth: '200px' }}>
                <strong>💡 Tip:</strong> 컬럼 매핑에서 확인한 열 순서(0-based)를 그대로 사용하세요.<br />
                헤더행이 2행이면 데이터는 3행부터 시작합니다.
              </div>
            </div>
          </div>
          <div style={{ marginBottom: '10px' }}>
            <div style={{ fontSize: '0.72rem', fontWeight: 700, color: '#d97706', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '8px' }}>🗄️ DB 컬럼값 토큰</div>
            <div style={{ background: 'white', border: '1px solid #e8ecf0', borderRadius: '8px', padding: '10px 14px', display: 'flex', gap: '16px', flexWrap: 'wrap', alignItems: 'flex-start' }}>
              <div style={{ flex: 1, minWidth: '220px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '5px', flexWrap: 'wrap' }}>
                  <code style={{ fontSize: '0.8rem', fontWeight: 700, color: '#d97706', background: '#fef3c7', padding: '2px 8px', borderRadius: '5px', fontFamily: 'monospace' }}>{'${컬럼명}'}</code>
                </div>
                <div style={{ fontSize: '0.76rem', color: '#475569', marginBottom: '3px' }}><strong>컬럼 매핑에서 설정한 DB 컬럼명</strong>을 그대로 토큰으로 사용합니다.<br />해당 행에 실제 저장된 값(치환·고정값 포함)이 삽입됩니다.</div>
                <div style={{ fontSize: '0.71rem', color: '#94a3b8', fontFamily: 'monospace' }}>예) {'${EMP_NM}'} | {'${DEPT_CD}'} | {'${REG_DT}'}</div>
              </div>
              <div style={{ background: '#fffbeb', border: '1px solid #fde68a', borderRadius: '7px', padding: '8px 12px', fontSize: '0.76rem', color: '#92400e', minWidth: '200px' }}>
                <strong>⚠ 주의:</strong> 컬럼명은 <strong>대소문자를 정확히</strong> 입력해야 합니다.<br />
                매핑되지 않은 컬럼은 빈 문자열로 치환됩니다.
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
    </div>
  );
};

const AdminStep2 = ({
  file,
  formatFileSize,
  processSelectedFile,
  excelHeaders,
  structs,
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
  MySelect,
  previewLoading,
  isDragging,
  setIsDragging,
}) => {
  const mappedCount = filteredCols.filter(c => currentAliasMapping[c.value]).length;
  const unmappedCount = Math.max(0, filteredCols.length - mappedCount);

  return (
    <div className="wizard-panel">
      <AdminStageHero
      eyebrow="Mapping Workbench"
      title="컬럼 매핑"
      status="Step 3"
      desc="샘플 엑셀을 기준으로 각 테이블의 DB 컬럼과 매핑 방식을 구성합니다."
      meta={[
        { label: '샘플 파일', value: file?.name || '선택 전' },
        { label: '헤더 수', value: `${excelHeaders.length}개` },
        { label: '활성 Alias', value: activeAlias || 'ROOT' },
      ]}
    />
      <AdminOpsStrip
        items={[
          { label: '매핑 완료', value: `${mappedCount}개`, desc: filteredCols.length ? `${filteredCols.length}개 대상 중 연결된 컬럼 수입니다.` : '테이블과 샘플 파일을 먼저 준비하세요.', tone: mappedCount > 0 ? 'success' : 'warn' },
          { label: '미매핑', value: `${unmappedCount}개`, desc: unmappedCount > 0 ? '필요한 컬럼만 선별적으로 연결할 수 있습니다.' : '현재 표시된 컬럼은 모두 매핑되어 있습니다.' },
          { label: '검색 상태', value: searchTerm?.trim() ? '필터 적용 중' : '전체 보기', desc: searchTerm?.trim() ? `"${searchTerm}" 기준으로 결과를 좁혀서 보는 중입니다.` : 'DB 컬럼 전체를 보고 있습니다.' },
          { label: '샘플 헤더', value: `${excelHeaders.length}개`, desc: file ? '선택한 샘플 파일에서 헤더를 읽어왔습니다.' : '샘플 파일을 먼저 선택하면 매핑이 쉬워집니다.', tone: file ? 'success' : 'warn' },
        ]}
      />
    <div className="wiz-section" style={{ marginTop: '28px' }}>
      <div className="wiz-section-title" style={{ marginBottom: '10px' }}>샘플 엑셀 파일 선택 (헤더 파악용)</div>
      <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
        <label htmlFor="mappingFileInput" style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '10px 20px', background: '#f8fafc', border: '1.5px dashed #cbd5e1', borderRadius: '10px', cursor: 'pointer', fontSize: '0.88rem', color: '#475569', flex: 1 }}>
          📂 {file ? <span style={{ fontWeight: 600, color: '#059669' }}>{file.name} ({formatFileSize(file.size)})</span> : <span>엑셀 파일을 선택하세요 (.xls, .xlsx)</span>}
        </label>
        <input id="mappingFileInput" type="file" accept=".xls,.xlsx" style={{ display: 'none' }} onChange={e => { const selected = e.target.files[0]; if (selected) processSelectedFile(selected); }} />
        {file && <span style={{ fontSize: '0.8rem', color: '#10b981', fontWeight: 600, whiteSpace: 'nowrap' }}>헤더 {excelHeaders.length}개 인식</span>}
      </div>
    </div>
    {structs[0].table && (
      <div className="wiz-section">
        <div className="admin-alias-tabs">
          {structs.map(s => (
            <button key={s.alias} onClick={() => setActiveAlias(s.alias)} className={`admin-alias-tab${activeAlias === s.alias ? ' active' : ''}`}>
              {s.alias} 테이블
            </button>
          ))}
        </div>
        <div className="admin-mapping-toolbar">
          <span style={{ fontSize: '0.82rem', color: '#64748b' }}>총 <b style={{ color: '#1e293b' }}>{filteredCols.length}</b>개 컬럼 <span style={{ marginLeft: '6px', color: '#6366f1', fontWeight: 600 }}>(매핑됨: {filteredCols.filter(c => currentAliasMapping[c.value]).length}개)</span></span>
          <div className="workbench-search admin-mapping-search">
            <span className="workbench-search-icon">⌕</span>
            <input type="text" placeholder="컬럼 검색..." value={searchTerm} onChange={e => setSearchTerm(e.target.value)} />
          </div>
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
                let selectValue = mapVal;
                let fixedText = '';
                if (isFixed) {
                  selectValue = '_FIXED_';
                  fixedText = mapVal.substring(8);
                } else if (isReplace) {
                  selectValue = mapVal.split(':')[1];
                } else if (isUnique) {
                  selectValue = mapVal.split(':')[1];
                }
                return (
                  <tr key={col.value} style={{ opacity: isChecked ? 1 : 0.45, background: isChecked ? '#f0fdfa' : 'transparent' }}>
                    <td style={{ textAlign: 'center' }}>
                      <input type="checkbox" checked={isChecked} onChange={() => updateMappingVal(col.value, isChecked ? '' : '_AUTO_SEQ_')} style={{ transform: 'scale(1.2)', cursor: 'pointer', accentColor: '#10b981' }} />
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
            {[['«', 1], ['‹', mappingPage - 1], ...Array.from({ length: Math.min(5, mappingTotalPages) }, (_, i) => {
              let p;
              if (mappingTotalPages <= 5) p = i + 1;
              else if (mappingPage <= 3) p = i + 1;
              else if (mappingPage >= mappingTotalPages - 2) p = mappingTotalPages - 4 + i;
              else p = mappingPage - 2 + i;
              return [p, p];
            }), ...[['›', mappingPage + 1], ['»', mappingTotalPages]]].map(([label, pg], i) => (
              <button key={i} onClick={() => { if (pg >= 1 && pg <= mappingTotalPages) setMappingPage(pg); }} disabled={pg < 1 || pg > mappingTotalPages} style={{ minWidth: '30px', height: '30px', padding: '0 6px', borderRadius: '6px', border: '1px solid', borderColor: pg === mappingPage ? '#6366f1' : '#e2e8f0', background: pg === mappingPage ? '#6366f1' : 'white', color: pg === mappingPage ? 'white' : (pg < 1 || pg > mappingTotalPages) ? '#d1d5db' : '#374151', fontWeight: pg === mappingPage ? 700 : 400, fontSize: '0.78rem', cursor: pg < 1 || pg > mappingTotalPages ? 'not-allowed' : 'pointer' }}>
                {label}
              </button>
            ))}
            <span style={{ marginLeft: '6px', fontSize: '0.75rem', color: '#94a3b8' }}>{mappingPage} / {mappingTotalPages}</span>
          </div>
        )}
      </div>
    )}
    </div>
  );
};

const AdminStep3 = (props) => {
  const {
    uploadId,
    setCurrentStep,
    handleSave,
    uploadResult,
    downloadErrorReport,
    setFailedRows,
    previewPageSize,
    previewPage,
    file,
    setPreviewPage,
    fetchPreviewPage,
    headerRow,
    setUploadResult,
    setUploadLogs,
    setProgress,
    setFile,
    setPreviewData,
    uploading,
    progress,
    uploadLogs,
    logEndRef,
    formatFileSize,
    totalRows,
    setTotalRows,
    setEditedCells,
    setIsDragging,
    isDragging,
    processSelectedFile,
    previewData,
    failedRows,
    moveToFirstFailedRow,
    parseFailedColsFromMsg,
    friendlyFailMsg,
    editedCells,
    excelHeaders,
    previewLoading,
    previewTotalPages,
    renderDebugUploadOptions,
    isAdmin,
    handleUpload,
  } = props;

  const resetAdminUploadState = () => {
    setUploadResult(null);
    setUploadLogs([]);
    setProgress({ current: 0, total: 0, percent: 0 });
    setFailedRows({});
    setFile(null);
    setPreviewData([]);
    setTotalRows(0);
    setEditedCells({});
    const input = document.getElementById('adminUploadFileInput');
    if (input) input.value = '';
  };

  const hasFailedRows = Object.keys(failedRows).length > 0;
  const editedRowCount = Object.keys(editedCells).length;
  const launchChecklistItems = [
    {
      label: '파일 선택',
      detail: file ? file.name : '업로드할 샘플 엑셀을 선택하세요.',
      ok: !!file,
    },
    {
      label: '미리보기 준비',
      detail: previewData.length > 0 ? `${previewData.length.toLocaleString()}행이 현재 페이지에 로드됨` : '미리보기가 아직 비어 있습니다.',
      ok: previewData.length > 0,
    },
    {
      label: '실패 행 여부',
      detail: hasFailedRows ? `${Object.keys(failedRows).length}행 점검 필요` : '현재 페이지 기준 실패 행이 없습니다.',
      ok: !hasFailedRows,
    },
    {
      label: '수정 반영',
      detail: editedRowCount > 0 ? `${editedRowCount}행을 직접 수정했습니다.` : '직접 수정한 행은 아직 없습니다.',
      ok: true,
    },
  ];

  return (
    <div className="wizard-panel">
      <AdminStageHero
        eyebrow="Launch & Verify"
        title="설정 저장 완료"
        status="Step 4"
        desc="설정이 저장되었습니다. 바로 테스트 업로드를 실행하거나, 다시 저장 후 배포 흐름으로 이어갈 수 있습니다."
        meta={[
          { label: '로더 ID', value: uploadId || '저장 후 생성' },
          { label: '사용자 URL', value: uploadId ? `?upload_id=${uploadId}` : '생성 전' },
          { label: '업로드 상태', value: uploading ? `${progress.percent}% 진행 중` : uploadResult ? uploadResult.status : '대기' },
        ]}
      />
      <div className="admin-stage-action-row">
        <button onClick={() => setCurrentStep(0)} className="side-action-btn">← 설정 처음으로</button>
        <button onClick={handleSave} className="side-action-btn side-action-btn-green">💾 다시 저장</button>
      </div>
      {!uploading && !uploadResult && (
        <div className="preflight-checklist-card admin-checklist-card">
          <div className="preflight-checklist-head">
            <div>
              <div className="preflight-checklist-title">실행 전 체크리스트</div>
              <div className="preflight-checklist-desc">테스트 업로드를 누르기 전에 파일 상태와 수정 여부를 마지막으로 확인하세요.</div>
            </div>
            <div className={`preflight-checklist-summary ${launchChecklistItems.filter(item => item.ok).length >= 3 ? 'ok' : 'warn'}`}>
              {launchChecklistItems.filter(item => item.ok).length} / {launchChecklistItems.length} 준비
            </div>
          </div>
          <div className="preflight-checklist-grid admin-checklist-grid">
            {launchChecklistItems.map(item => (
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
      )}
      <div style={{ marginTop: '28px' }}>
        <div className="wiz-section-title" style={{ marginBottom: '16px' }}>🚀 데이터 업로드 (테스트 / 직접 실행)</div>
        {uploadResult ? (
          <div>
            <div className="result-priority-strip" style={{ marginBottom: '14px' }}>
              {uploadResult.status === 'ok' && (
                <div className="result-priority-card priority-success">
                  <div className="result-priority-title">다음 단계</div>
                  <div className="result-priority-desc">업로드가 정상 완료되었습니다. 샘플 검증이 끝났다면 설정을 그대로 운영 흐름에 연결하면 됩니다.</div>
                </div>
              )}
              {uploadResult.status === 'partial' && (
                <div className="result-priority-card priority-warning">
                  <div className="result-priority-title">우선 확인할 작업</div>
                  <div className="result-priority-desc">실패 행을 다시 미리보기로 불러와 수정한 뒤 재업로드하는 경로가 가장 빠릅니다.</div>
                </div>
              )}
              {uploadResult.status === 'err' && (
                <div className="result-priority-card priority-danger">
                  <div className="result-priority-title">우선 확인할 작업</div>
                  <div className="result-priority-desc">오류 원문과 해결 가이드를 보고 설정 구조나 샘플 데이터를 먼저 점검하는 것이 좋습니다.</div>
                </div>
              )}
            </div>
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
                      if (pg !== previewPage && file) {
                        setPreviewPage(pg);
                        fetchPreviewPage(file, pg, headerRow, null);
                      }
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
                <div style={{ marginTop: '8px', fontSize: '0.75rem', color: '#64748b', background: '#f1f5f9', padding: '8px', borderRadius: '6px', fontFamily: 'monospace', wordBreak: 'break-all' }}>
                  🔍 원문: {uploadResult.msg}
                </div>
                {uploadResult.solution && <div style={{ color: '#166534', background: '#f0fdf4', padding: '9px 12px', borderRadius: '8px', fontSize: '0.83rem' }}>💡 {uploadResult.solution}</div>}
                <button onClick={() => setUploadResult(null)} style={{ marginTop: '10px', padding: '9px 18px', borderRadius: '8px', border: '1px solid #fca5a5', background: 'white', color: '#e11d48', fontWeight: 700, cursor: 'pointer', fontSize: '0.83rem', width: '100%' }}>
                  ✏ 미리보기에서 직접 수정하기
                </button>
              </div>
            )}
            <div style={{ textAlign: 'center', marginTop: '14px' }}>
              <button onClick={resetAdminUploadState} style={{ padding: '9px 20px', borderRadius: '8px', border: '1px solid #e2e8f0', background: 'white', color: '#475569', fontWeight: 600, cursor: 'pointer', fontSize: '0.88rem' }}>
                ↩ 다시 업로드
              </button>
            </div>
          </div>
        ) : uploading ? (
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
                <button onClick={() => { setFile(null); setPreviewData([]); setTotalRows(0); setEditedCells({}); setFailedRows({}); const input = document.getElementById('adminUploadFileInput'); if (input) input.value = ''; }} style={{ height: '28px', padding: '0 10px', borderRadius: '7px', border: '1px solid #fca5a5', background: 'white', color: '#ef4444', fontSize: '0.76rem', fontWeight: 700, cursor: 'pointer' }}>✕</button>
              </div>
            ) : (
              <label htmlFor="adminUploadFileInput" onDragOver={e => { e.preventDefault(); setIsDragging(true); }} onDragLeave={e => { e.preventDefault(); setIsDragging(false); }} onDrop={e => { e.preventDefault(); setIsDragging(false); const dropped = e.dataTransfer.files[0]; if (dropped && (dropped.name.endsWith('.xlsx') || dropped.name.endsWith('.xls'))) processSelectedFile(dropped); else if (dropped) toast.error('❌ .xls/.xlsx만 가능합니다.'); }} style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '16px 20px', borderRadius: '12px', cursor: 'pointer', border: isDragging ? '2px solid #6366f1' : '2px dashed #cbd5e1', background: isDragging ? '#eef2ff' : '#f9fafb', transition: 'all 0.18s', marginBottom: '12px' }}>
                <input id="adminUploadFileInput" type="file" accept=".xls,.xlsx" style={{ display: 'none' }} onChange={e => { const selected = e.target.files[0]; if (selected) processSelectedFile(selected); }} />
                <div style={{ width: '40px', height: '40px', borderRadius: '10px', background: isDragging ? '#6366f1' : 'white', border: isDragging ? 'none' : '1.5px solid #e5e8eb', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '1.3rem', flexShrink: 0 }}>{isDragging ? '📂' : '📤'}</div>
                <div>
                  <div style={{ fontWeight: 700, color: isDragging ? '#6366f1' : '#333d4b', fontSize: '0.9rem' }}>{isDragging ? '여기에 놓아주세요!' : '업로드할 엑셀 파일을 드래그하거나 클릭하여 선택'}</div>
                  <div style={{ marginTop: '3px', display: 'flex', gap: '5px' }}>{['.xls', '.xlsx'].map(ext => <span key={ext} style={{ background: '#eef2ff', color: '#6366f1', fontSize: '0.68rem', fontWeight: 700, padding: '1px 7px', borderRadius: '4px' }}>{ext}</span>)}</div>
                </div>
              </label>
            )}

            {previewData.length > 0 && (
              <div style={{ border: `1px solid ${Object.keys(failedRows).length > 0 ? '#fecdd3' : '#e5e8eb'}`, borderRadius: '10px', overflow: 'hidden', marginBottom: '14px' }}>
                {Object.keys(failedRows).length > 0 && (
                  <div style={{ background: '#fff1f2', borderBottom: '1px solid #fecdd3', padding: '8px 14px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '6px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '7px' }}>
                      <span>🚨</span>
                      <span style={{ fontWeight: 700, color: '#e11d48', fontSize: '0.82rem' }}>{failedRows.__unknown__ ? `${uploadResult?.fail_cnt ?? '일부'}건 실패` : `${Object.keys(failedRows).length}행 실패`}</span>
                      <span style={{ color: '#9f1239', fontSize: '0.75rem' }}>{failedRows.__unknown__ ? '오류 리포트를 다운로드하거나 수정 후 재업로드하세요.' : '빨간 행을 수정 후 재업로드하세요.'}</span>
                    </div>
                    <div style={{ display: 'flex', gap: '5px' }}>
                      <button onClick={moveToFirstFailedRow} style={{ fontSize: '0.7rem', padding: '2px 9px', borderRadius: '5px', border: '1px solid #fca5a5', background: 'white', color: '#e11d48', cursor: 'pointer', fontWeight: 600 }}>🔴 실패 행으로</button>
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
                    {Object.keys(editedCells).length > 0 && <button onClick={() => setEditedCells({})} style={{ fontSize: '0.7rem', padding: '2px 8px', borderRadius: '5px', border: '1px solid #fca5a5', background: 'white', color: '#ef4444', cursor: 'pointer' }}>↩ 수정 초기화</button>}
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
                        const rowNum = row._rowNum ?? ((props.previewPage - 1) * props.previewPageSize + rIdx + 1);
                        const rowEdits = editedCells[rowNum] || {};
                        const isEdited = Object.keys(rowEdits).length > 0;
                        const isFailed = failedRows[String(rowNum)] !== undefined && !failedRows.__unknown__;
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
                                const original = Array.isArray(row) ? (row[cIdx] || '') : (row[String(cIdx)] || '');
                                const display = rowEdits[cIdx] !== undefined ? rowEdits[cIdx] : original;
                                const isCellEdited = rowEdits[cIdx] !== undefined && rowEdits[cIdx] !== original;
                                const isErrorCol = isFailed && failedColIdxSet.has(cIdx);
                                return (
                                  <td key={cIdx} style={{ padding: 0, position: 'relative' }}>
                                    {isErrorCol && <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: '2px', background: '#ef4444', zIndex: 1 }} />}
                                    <input
                                      value={display}
                                      onChange={e => {
                                        const nextValue = e.target.value;
                                        props.setEditedCells(prev => {
                                          const rowPatch = prev[rowNum] || {};
                                          if (nextValue === original) {
                                            const { [cIdx]: _, ...rest } = rowPatch;
                                            if (!Object.keys(rest).length) {
                                              const { [rowNum]: __, ...remaining } = prev;
                                              return remaining;
                                            }
                                            return { ...prev, [rowNum]: rest };
                                          }
                                          return { ...prev, [rowNum]: { ...rowPatch, [cIdx]: nextValue } };
                                        });
                                      }}
                                      style={{ width: '100%', boxSizing: 'border-box', padding: '6px 9px', border: 'none', outline: isErrorCol ? '2px solid #ef4444' : 'none', outlineOffset: '-2px', background: isCellEdited ? '#fef3c7' : isErrorCol ? '#fee2e2' : isFailed ? '#fff8f8' : 'transparent', fontSize: '0.78rem', fontFamily: 'inherit', color: '#191f28', fontWeight: isErrorCol ? 700 : 400 }}
                                      onFocus={e => { e.target.style.background = '#f0f7ff'; }}
                                      onBlur={e => { e.target.style.background = isCellEdited ? '#fef3c7' : isErrorCol ? '#fee2e2' : isFailed ? '#fff8f8' : 'transparent'; }}
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
                                    <span style={{ background: '#fee2e2', color: '#e11d48', fontWeight: 700, fontSize: '0.7rem', padding: '2px 7px', borderRadius: '4px', whiteSpace: 'nowrap', flexShrink: 0 }}>❌ {friendlyMsg}</span>
                                    {failedColInfos.filter(c => c.colLabel).map((c, i) => <span key={i} style={{ background: '#fef3c7', color: '#92400e', fontWeight: 600, fontSize: '0.7rem', padding: '2px 7px', borderRadius: '4px', whiteSpace: 'nowrap', flexShrink: 0 }}>📌 {c.colLabel} 컬럼</span>)}
                                    <span style={{ color: '#9f1239', fontSize: '0.68rem', lineHeight: 1.4, wordBreak: 'break-all' }}>{failMsg}</span>
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
                    <span style={{ fontSize: '0.72rem', color: '#8b95a1' }}>{((props.previewPage - 1) * props.previewPageSize + 1).toLocaleString()} ~ {Math.min(props.previewPage * props.previewPageSize, totalRows).toLocaleString()}행 / 전체 {totalRows.toLocaleString()}건</span>
                    <div style={{ display: 'flex', gap: '3px' }}>
                      {[['«', 1], ['‹', props.previewPage - 1], ...Array.from({ length: Math.min(5, previewTotalPages) }, (_, i) => {
                        let p;
                        if (previewTotalPages <= 5) p = i + 1;
                        else if (props.previewPage <= 3) p = i + 1;
                        else if (props.previewPage >= previewTotalPages - 2) p = previewTotalPages - 4 + i;
                        else p = props.previewPage - 2 + i;
                        return [p, p];
                      }), ...[['›', props.previewPage + 1], ['»', previewTotalPages]]].map(([label, pg], i) => (
                        <button key={i} onClick={() => { if (pg >= 1 && pg <= previewTotalPages) { setPreviewPage(pg); fetchPreviewPage(file, pg, headerRow, null); } }} disabled={pg < 1 || pg > previewTotalPages || previewLoading} style={{ minWidth: '26px', height: '26px', padding: '0 4px', borderRadius: '4px', border: '1px solid', borderColor: pg === props.previewPage ? '#3182f6' : '#e5e8eb', background: pg === props.previewPage ? '#3182f6' : 'white', color: pg === props.previewPage ? 'white' : (pg < 1 || pg > previewTotalPages || previewLoading) ? '#d1d5db' : '#333', fontWeight: pg === props.previewPage ? 700 : 400, fontSize: '0.72rem', cursor: pg < 1 || pg > previewTotalPages ? 'not-allowed' : 'pointer' }}>
                          {label}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}

            {file && (() => {
              const hasFailed = Object.keys(failedRows).length > 0;
              return (
                <div style={{ padding: '16px 20px', background: hasFailed ? 'linear-gradient(135deg,#fff1f2,#fef2f2)' : 'linear-gradient(135deg,#eef2ff,#f5f3ff)', borderRadius: '12px', border: hasFailed ? '1px solid #fecdd3' : '1px solid #e0e7ff', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px', flexWrap: 'wrap' }}>
                  <div>
                    <div style={{ fontWeight: 700, color: '#1e293b', fontSize: '0.9rem' }}>{hasFailed ? `🚨 ${Object.keys(failedRows).length}건 실패 — 수정 후 재업로드` : '업로드 준비 완료'}</div>
                    <div style={{ color: '#64748b', fontSize: '0.78rem', marginTop: '2px' }}>{previewLoading ? '데이터 분석 중...' : hasFailed ? '빨간 행의 셀을 클릭해 직접 수정하세요.' : `총 ${totalRows.toLocaleString()}건을 전송합니다`}</div>
                  </div>
                  <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
                    {isAdmin && renderDebugUploadOptions(true)}
                    {hasFailed && <button onClick={() => { setFailedRows({}); setEditedCells({}); }} style={{ padding: '9px 16px', borderRadius: '9px', border: '1px solid #e2e8f0', background: 'white', color: '#64748b', fontWeight: 600, cursor: 'pointer', fontSize: '0.82rem' }}>초기화</button>}
                    <button onClick={handleUpload} disabled={previewLoading} style={{ padding: '11px 28px', borderRadius: '10px', border: 'none', background: previewLoading ? '#e2e8f0' : hasFailed ? 'linear-gradient(135deg,#ef4444,#dc2626)' : 'linear-gradient(135deg,#6366f1,#8b5cf6)', color: previewLoading ? '#94a3b8' : 'white', fontWeight: 800, cursor: previewLoading ? 'not-allowed' : 'pointer', fontSize: '0.9rem', display: 'inline-flex', alignItems: 'center', gap: '7px', boxShadow: previewLoading ? 'none' : hasFailed ? '0 4px 14px rgba(239,68,68,0.3)' : '0 4px 14px rgba(99,102,241,0.3)', whiteSpace: 'nowrap' }}>
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
};

const AdminWizardScreen = ({
  steps,
  currentStep,
  isLastStep,
  goPrev,
  goNext,
  canGoNext,
  nextLabel,
  adminStepProps,
}) => {
  const content = [
    <AdminStep0 key="0" {...adminStepProps} />,
    <AdminStep1 key="1" {...adminStepProps} />,
    <AdminStep2 key="2" {...adminStepProps} />,
    <AdminStep3 key="3" {...adminStepProps} />,
  ][currentStep];

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
            <button onClick={goNext} disabled={!canGoNext} style={{ padding: '10px 26px', borderRadius: '10px', border: 'none', background: canGoNext ? 'linear-gradient(135deg,#6366f1,#8b5cf6)' : '#e2e8f0', color: canGoNext ? 'white' : '#94a3b8', fontWeight: 700, cursor: canGoNext ? 'pointer' : 'not-allowed', fontSize: '0.88rem', boxShadow: canGoNext ? '0 2px 8px rgba(99,102,241,0.28)' : 'none' }}>
              {nextLabel}
            </button>
          </div>
        )}
      </div>
    </>
  );
};

export default AdminWizardScreen;
