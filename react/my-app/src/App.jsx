import { useState, useRef, useCallback, useMemo } from "react";
import * as XLSX from "xlsx";

// ─── 타입 감지 & 포맷 유틸 ─────────────────────────────────────────────────

const detectNumeric = (rows, colName) => {
  const nonEmpty = rows.filter(r => r[colName] !== "" && r[colName] !== null && r[colName] !== undefined);
  if (!nonEmpty.length) return false;
  return nonEmpty.every(r => !isNaN(Number(r[colName])));
};

const formatVal = (val, isNumeric, nullOnEmpty = true) => {
  if (val === "" || val === null || val === undefined) {
    return nullOnEmpty ? "NULL" : "''";
  }
  if (isNumeric) return String(val);
  const escaped = String(val).replace(/'/g, "''");
  return `'${escaped}'`;
};

// ─── 메인 컴포넌트 ─────────────────────────────────────────────────────────

export default function App() {
  const [rows, setRows] = useState([]);
  const [columns, setColumns] = useState([]);
  const [tableName, setTableName] = useState("your_table");
  const [dragging, setDragging] = useState(false);
  const [fileName, setFileName] = useState("");
  const [copied, setCopied] = useState(false);
  const [nullOnEmpty, setNullOnEmpty] = useState(true);

  // ── 작업 유형: update / insert / delete
  const [operation, setOperation] = useState("update");

  // ── UPDATE 전용: 쿼리 방식
  const [queryType, setQueryType] = useState("case");

  // ── INSERT 전용 옵션
  const [insertIgnore, setInsertIgnore] = useState(false);
  const [insertOnDuplicate, setInsertOnDuplicate] = useState(false);

  // ── WHERE 조건 (UPDATE / DELETE 공용)
  const [whereExcelCol, setWhereExcelCol] = useState("");
  const [whereDbCol, setWhereDbCol] = useState("");
  const [whereTypeOverride, setWhereTypeOverride] = useState(null);

  // ── 컬럼 매핑 (UPDATE SET / INSERT 컬럼 공용)
  const [setMappings, setSetMappings] = useState([
    { id: 1, excelCol: "", dbCol: "", typeOverride: null },
  ]);

  const fileRef = useRef();

  // ── 파일 처리 ─────────────────────────────────────────────────────────────

  const processFile = (file) => {
    setFileName(file.name);
    const reader = new FileReader();
    reader.onload = (e) => {
      const wb = XLSX.read(e.target.result, { type: "array" });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const data = XLSX.utils.sheet_to_json(ws, { defval: "" });
      if (data.length > 0) {
        const cols = Object.keys(data[0]);
        setColumns(cols);
        setRows(data);
        setWhereExcelCol(cols[0] || "");
        setWhereDbCol(cols[0] || "");
        setWhereTypeOverride(null);
        if (cols[1])
          setSetMappings([{ id: 1, excelCol: cols[1], dbCol: cols[1], typeOverride: null }]);
      }
    };
    reader.readAsArrayBuffer(file);
  };

  const onDrop = useCallback((e) => {
    e.preventDefault();
    setDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) processFile(file);
  }, []);

  // ── 매핑 조작 ─────────────────────────────────────────────────────────────

  const addSetMapping = () =>
    setSetMappings((p) => [...p, { id: Date.now(), excelCol: "", dbCol: "", typeOverride: null }]);

  const removeSetMapping = (id) =>
    setSetMappings((p) => p.filter((m) => m.id !== id));

  const updateSetMapping = (id, field, value) =>
    setSetMappings((p) =>
      p.map((m) => {
        if (m.id !== id) return m;
        const u = { ...m, [field]: value };
        if (field === "excelCol" && m.dbCol === m.excelCol) {
          u.dbCol = value;
          u.typeOverride = null;
        }
        return u;
      })
    );

  // ── 타입 감지 ─────────────────────────────────────────────────────────────

  const colNumericCache = useMemo(() => {
    const cache = {};
    columns.forEach((c) => { cache[c] = detectNumeric(rows, c); });
    return cache;
  }, [rows, columns]);

  const isNumeric = (colName, override) => {
    if (override === "text") return false;
    if (override === "number") return true;
    return colNumericCache[colName] ?? false;
  };

  // ── 쿼리 생성 ─────────────────────────────────────────────────────────────

  const generateQuery = () => {
    if (!rows.length) return "";

    const vm = setMappings.filter((m) => m.excelCol && m.dbCol);
    const whereIsNum = isNumeric(whereExcelCol, whereTypeOverride);
    const fmtWhere = (r) => formatVal(r[whereExcelCol], whereIsNum, nullOnEmpty);
    const fmtCol = (m, r) => formatVal(r[m.excelCol], isNumeric(m.excelCol, m.typeOverride), nullOnEmpty);

    // ── DELETE ──────────────────────────────────────────────────────────────
    if (operation === "delete") {
      if (!whereExcelCol || !whereDbCol) return "";
      const ids = rows.map((r) => fmtWhere(r)).join(", ");
      return `DELETE FROM ${tableName}\nWHERE ${whereDbCol} IN (${ids});`;
    }

    // ── INSERT ──────────────────────────────────────────────────────────────
    if (operation === "insert") {
      if (!vm.length) return "";
      const dbCols = vm.map((m) => m.dbCol).join(", ");
      const valueRows = rows
        .map((r) => {
          const vals = vm.map((m) => fmtCol(m, r)).join(", ");
          return `    (${vals})`;
        })
        .join(",\n");

      const keyword = insertIgnore ? "INSERT IGNORE INTO" : "INSERT INTO";
      let q = `${keyword} ${tableName} (${dbCols})\nVALUES\n${valueRows};`;

      if (insertOnDuplicate && !insertIgnore) {
        const dupCols = vm.map((m) => `    ${m.dbCol} = VALUES(${m.dbCol})`).join(",\n");
        q = q.replace(/;$/, `\nON DUPLICATE KEY UPDATE\n${dupCols};`);
      }
      return q;
    }

    // ── UPDATE ──────────────────────────────────────────────────────────────
    if (!whereExcelCol || !whereDbCol || !vm.length) return "";

    if (queryType === "case") {
      const setParts = vm.map((m) => {
        const cases = rows.map((r) => `        WHEN ${fmtWhere(r)} THEN ${fmtCol(m, r)}`).join("\n");
        return `    ${m.dbCol} = CASE ${whereDbCol}\n${cases}\n        ELSE ${m.dbCol}\n    END`;
      }).join(",\n");
      const ids = rows.map((r) => fmtWhere(r)).join(", ");
      return `UPDATE ${tableName}\nSET\n${setParts}\nWHERE ${whereDbCol} IN (${ids});`;
    }

    if (queryType === "join") {
      const allCols = [whereExcelCol, ...vm.map((m) => m.excelCol)];
      const allDbCols = [whereDbCol, ...vm.map((m) => m.dbCol)];
      const valueRows = rows.map((r) => {
        const vals = allCols.map((col, i) => i === 0 ? fmtWhere(r) : fmtCol(vm[i - 1], r));
        return `        ROW(${vals.join(", ")})`;
      }).join(",\n");
      const setClause = vm.map((m) => `    t.${m.dbCol} = tmp.${m.dbCol}`).join(",\n");
      return `UPDATE ${tableName} t\nJOIN (\n    SELECT * FROM (VALUES\n${valueRows}\n    ) AS v(${allDbCols.join(", ")})\n) tmp ON t.${whereDbCol} = tmp.${whereDbCol}\nSET\n${setClause};`;
    }

    if (queryType === "individual") {
      return rows.map((r) => {
        const setClause = vm.map((m) => `${m.dbCol} = ${fmtCol(m, r)}`).join(", ");
        return `UPDATE ${tableName} SET ${setClause} WHERE ${whereDbCol} = ${fmtWhere(r)};`;
      }).join("\n");
    }

    return "";
  };

  const query = generateQuery();

  const handleCopy = () => {
    navigator.clipboard.writeText(query);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const validMappings = setMappings.filter((m) => m.excelCol && m.dbCol);

  const showWhere = operation === "update" || operation === "delete";
  const showSetMappings = operation === "update" || operation === "insert";
  const showQueryType = operation === "update";
  const showInsertOptions = operation === "insert";

  // ── TypeToggle ────────────────────────────────────────────────────────────

  const TypeToggle = ({ colName, override, onChange }) => {
    if (!colName) return null;
    const effective = isNumeric(colName, override);
    return (
      <div className="type-toggle-wrap">
        <button className={`type-btn ${override === null ? "active" : ""}`} onClick={() => onChange(null)}>AUTO</button>
        <button className={`type-btn ${override === "number" ? "active num" : ""}`} onClick={() => onChange("number")}>#</button>
        <button className={`type-btn ${override === "text" ? "active txt" : ""}`} onClick={() => onChange("text")}>"A"</button>
        <span className="type-detected">
          → {effective ? "숫자" : "문자"}
          {override === null && <span className="type-auto-badge">auto</span>}
        </span>
      </div>
    );
  };

  return (
    <div className="app">
      <style>{`
        *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
        body { background: #0d0d0f; }
        .app { min-height: 100vh; background: #0d0d0f; color: #e8e6e1; font-family: 'JetBrains Mono','Fira Code','Cascadia Code',monospace; padding: 32px 20px; }
        .container { max-width: 1200px; margin: 0 auto; }

        .header { text-align: center; margin-bottom: 40px; }
        .header-badge { display: inline-flex; align-items: center; gap: 6px; background: #1a1a1f; border: 1px solid #2a2a35; color: #6b8cff; font-size: 11px; letter-spacing: .12em; padding: 5px 14px; border-radius: 20px; margin-bottom: 18px; text-transform: uppercase; }
        .badge-dot { width: 6px; height: 6px; border-radius: 50%; background: #6b8cff; animation: pulse 2s infinite; }
        @keyframes pulse { 0%,100%{opacity:1}50%{opacity:.3} }
        .header-title { font-size: clamp(28px,5vw,48px); font-weight: 700; letter-spacing: -.02em; color: #f0ede8; margin-bottom: 8px; }
        .title-arrow { color: #6b8cff; }
        .header-desc { color: #666; font-size: 13px; letter-spacing: .03em; }

        .main-grid { display: grid; grid-template-columns: 380px 1fr; gap: 20px; align-items: start; }
        @media(max-width:800px){.main-grid{grid-template-columns:1fr}}

        .config-card { background: #111116; border: 1px solid #1e1e28; border-radius: 10px; padding: 20px; margin-bottom: 12px; }
        .section-header { display: flex; align-items: center; gap: 10px; margin-bottom: 16px; }
        .section-num { font-size: 10px; font-weight: 700; color: #6b8cff; letter-spacing: .1em; background: rgba(107,140,255,.1); padding: 2px 7px; border-radius: 4px; }
        .section-label { font-size: 12px; color: #aaa; letter-spacing: .06em; text-transform: uppercase; }
        .add-btn { margin-left: auto; background: rgba(107,140,255,.12); border: 1px solid rgba(107,140,255,.3); color: #6b8cff; font-size: 11px; padding: 4px 10px; border-radius: 5px; cursor: pointer; font-family: inherit; letter-spacing: .05em; transition: all .15s; }
        .add-btn:hover { background: rgba(107,140,255,.2); }

        /* Operation Selector */
        .op-selector { display: grid; grid-template-columns: repeat(3,1fr); gap: 8px; }
        .op-item { padding: 12px 10px; border: 1px solid #1e1e28; border-radius: 8px; cursor: pointer; text-align: center; transition: all .2s; background: #0d0d12; }
        .op-item:hover { border-color: #2a2a3a; }
        .op-item.active-update { border-color: #6b8cff; background: rgba(107,140,255,.06); }
        .op-item.active-insert { border-color: #4ade80; background: rgba(74,222,128,.06); }
        .op-item.active-delete { border-color: #ff6b6b; background: rgba(255,107,107,.06); }
        .op-item input { display: none; }
        .op-badge { display: inline-block; font-size: 9px; font-weight: 700; letter-spacing: .12em; padding: 2px 8px; border-radius: 4px; margin-bottom: 5px; }
        .op-badge-update { background: rgba(107,140,255,.15); color: #6b8cff; }
        .op-badge-insert { background: rgba(74,222,128,.15); color: #4ade80; }
        .op-badge-delete { background: rgba(255,107,107,.15); color: #ff6b6b; }
        .op-desc { font-size: 10px; color: #555; }

        /* Upload */
        .upload-zone { border: 1.5px dashed #2a2a35; border-radius: 10px; padding: 28px; text-align: center; cursor: pointer; transition: all .2s; margin-bottom: 12px; background: #0f0f14; }
        .upload-zone:hover,.upload-zone.dragging { border-color: #6b8cff; background: rgba(107,140,255,.04); }
        .upload-zone.has-file { border-style: solid; border-color: #2a3f2a; }
        .upload-icon-wrap { width: 40px; height: 40px; border-radius: 8px; background: #1a1a24; border: 1px solid #2a2a35; display: flex; align-items: center; justify-content: center; color: #6b8cff; }
        .upload-icon-wrap.success { background: #1a2a1a; border-color: #2a4a2a; color: #4ade80; }
        .upload-success { display: flex; align-items: center; gap: 14px; text-align: left; }
        .upload-filename { font-size: 13px; color: #e8e6e1; font-weight: 500; }
        .upload-meta { font-size: 11px; color: #555; margin-top: 3px; }
        .upload-text { font-size: 13px; color: #888; margin-bottom: 4px; }
        .upload-sub { font-size: 11px; color: #444; }

        /* Fields */
        .field-group { margin-bottom: 12px; }
        .field-label { display: block; font-size: 10px; color: #555; letter-spacing: .1em; text-transform: uppercase; margin-bottom: 6px; }
        .field-input { width: 100%; background: #0a0a0e; border: 1px solid #222230; border-radius: 6px; color: #e8e6e1; font-size: 12px; font-family: inherit; padding: 8px 10px; transition: border-color .15s; outline: none; }
        .field-input:focus { border-color: #6b8cff; }
        select.field-input { cursor: pointer; }

        /* Mapping */
        .mapping-row { display: grid; grid-template-columns: 1fr 24px 1fr; align-items: end; gap: 8px; margin-bottom: 10px; }
        .mapping-row.has-remove { grid-template-columns: 1fr 24px 1fr 24px; }
        .mapping-arrow { display: flex; align-items: center; justify-content: center; padding-bottom: 2px; color: #333; }
        .remove-btn { background: transparent; border: 1px solid #2a2020; color: #664444; border-radius: 5px; width: 24px; height: 36px; cursor: pointer; font-size: 10px; transition: all .15s; display: flex; align-items: center; justify-content: center; }
        .remove-btn:hover { background: #2a1414; color: #ff6666; border-color: #663333; }

        /* Type Toggle */
        .type-toggle-wrap { display: flex; align-items: center; gap: 4px; margin-top: 6px; flex-wrap: wrap; }
        .type-btn { background: #111116; border: 1px solid #222230; color: #555; font-family: inherit; font-size: 10px; padding: 2px 7px; border-radius: 4px; cursor: pointer; transition: all .15s; }
        .type-btn:hover { border-color: #444; color: #888; }
        .type-btn.active { background: #1a1a24; border-color: #3a3a55; color: #aaa; }
        .type-btn.active.num { border-color: #6b8cff; color: #6b8cff; }
        .type-btn.active.txt { border-color: #f5a623; color: #f5a623; }
        .type-detected { font-size: 10px; color: #444; margin-left: 4px; display: flex; align-items: center; gap: 4px; }
        .type-auto-badge { background: #1a1a24; border: 1px solid #2a2a35; color: #555; font-size: 9px; padding: 1px 5px; border-radius: 3px; }

        /* Query Types */
        .query-types { display: flex; flex-direction: column; gap: 8px; }
        .query-type-item { display: flex; align-items: center; gap: 12px; padding: 12px 14px; border: 1px solid #1e1e28; border-radius: 8px; cursor: pointer; transition: all .15s; }
        .query-type-item:hover { border-color: #2a2a3a; }
        .query-type-item.active { border-color: #6b8cff; background: rgba(107,140,255,.04); }
        .query-type-item input { display: none; }
        .query-type-content { flex: 1; }
        .query-type-label { display: block; font-size: 12px; color: #e0ddd8; margin-bottom: 2px; }
        .query-type-desc { font-size: 10px; color: #555; }
        .query-radio { width: 14px; height: 14px; border: 1.5px solid #333; border-radius: 50%; transition: all .15s; }
        .query-radio.checked { border-color: #6b8cff; background: #6b8cff; }

        /* Options */
        .options-row { display: flex; align-items: center; gap: 10px; padding: 10px 14px; background: #0a0a0e; border: 1px solid #1a1a24; border-radius: 7px; margin-top: 8px; transition: opacity .2s; }
        .option-label { font-size: 11px; color: #666; flex: 1; }
        .toggle-wrap { position: relative; }
        .toggle-input { display: none; }
        .toggle-track { display: block; width: 32px; height: 18px; background: #1e1e28; border-radius: 9px; cursor: pointer; transition: background .2s; position: relative; }
        .toggle-input:checked + .toggle-track { background: #6b8cff; }
        .toggle-input:checked + .toggle-track.green { background: #4ade80; }
        .toggle-track::after { content:''; position:absolute; top:2px; left:2px; width:14px; height:14px; border-radius:50%; background:#555; transition:all .2s; }
        .toggle-input:checked + .toggle-track::after { left:16px; background:#fff; }

        /* Output */
        .output-card { background: #080810; border: 1px solid #1e1e28; border-radius: 10px; overflow: hidden; position: sticky; top: 20px; }
        .output-header { display: flex; align-items: center; justify-content: space-between; padding: 14px 18px; border-bottom: 1px solid #1a1a24; background: #0d0d16; }
        .output-title { display: flex; align-items: center; gap: 8px; font-size: 11px; color: #555; letter-spacing: .12em; }
        .output-dot { width: 7px; height: 7px; border-radius: 50%; background: #333; transition: background .3s; }
        .op-tag { font-size: 9px; font-weight: 700; padding: 1px 6px; border-radius: 3px; letter-spacing: .1em; }
        .op-tag-update { background: rgba(107,140,255,.15); color: #6b8cff; }
        .op-tag-insert { background: rgba(74,222,128,.15); color: #4ade80; }
        .op-tag-delete { background: rgba(255,107,107,.15); color: #ff6b6b; }
        .copy-btn { background: rgba(107,140,255,.12); border: 1px solid rgba(107,140,255,.3); color: #6b8cff; font-family: inherit; font-size: 11px; padding: 5px 14px; border-radius: 5px; cursor: pointer; transition: all .15s; letter-spacing: .05em; }
        .copy-btn.copied { background: rgba(74,222,128,.1); border-color: rgba(74,222,128,.3); color: #4ade80; }
        .output-body { min-height: 360px; max-height: 540px; overflow-y: auto; }
        .query-output { padding: 20px; font-size: 12px; line-height: 1.7; color: #c8d0ff; white-space: pre-wrap; word-break: break-all; font-family: inherit; }
        .output-empty { display: flex; flex-direction: column; align-items: center; justify-content: center; height: 360px; gap: 14px; }
        .empty-icon { width: 48px; height: 48px; border-radius: 10px; background: #111116; border: 1px solid #1e1e28; display: flex; align-items: center; justify-content: center; color: #333; }
        .empty-text { font-size: 12px; color: #444; text-align: center; line-height: 1.8; }
        .output-statusbar { display: flex; align-items: center; gap: 10px; padding: 10px 18px; border-top: 1px solid #1a1a24; background: #0a0a12; font-size: 10px; letter-spacing: .06em; }
        .status-item { display: flex; gap: 6px; align-items: center; }
        .sk { color: #444; }
        .sv { color: #888; }
        .sdiv { color: #222; }
        .status-end { margin-left: auto; display: flex; align-items: center; gap: 6px; color: #444; }
        .status-led { width: 6px; height: 6px; border-radius: 50%; background: #222; transition: background .3s; }
        .status-led.on { background: #4ade80; box-shadow: 0 0 6px #4ade8066; }
        ::-webkit-scrollbar{width:4px}::-webkit-scrollbar-track{background:transparent}::-webkit-scrollbar-thumb{background:#2a2a35;border-radius:2px}
      `}</style>

      <div className="container">
        <header className="header">
          <div className="header-badge">
            <span className="badge-dot" />
            MariaDB · Query Generator
          </div>
          <h1 className="header-title">
            Excel <span className="title-arrow">→</span> SQL
          </h1>
          <p className="header-desc">엑셀 데이터로 UPDATE · INSERT · DELETE 쿼리를 자동 생성합니다</p>
        </header>

        <div className="main-grid">
          <div className="left-panel">

            {/* Upload */}
            <div
              className={`upload-zone ${dragging ? "dragging" : ""} ${fileName ? "has-file" : ""}`}
              onClick={() => fileRef.current.click()}
              onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
              onDragLeave={() => setDragging(false)}
              onDrop={onDrop}
            >
              <input ref={fileRef} type="file" accept=".xlsx,.xls"
                onChange={(e) => { const f = e.target.files[0]; if (f) processFile(f); }}
                style={{ display: "none" }} />
              {fileName ? (
                <div className="upload-success">
                  <div className="upload-icon-wrap success">✓</div>
                  <div>
                    <div className="upload-filename">{fileName}</div>
                    <div className="upload-meta">{rows.length}행 · {columns.length}개 컬럼 감지됨</div>
                  </div>
                </div>
              ) : (
                <div>
                  <div className="upload-icon-wrap" style={{ margin: "0 auto 10px" }}>
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
                      <path d="M12 15V4M12 4L8 8M12 4L16 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                      <path d="M4 16V18C4 19.1046 4.89543 20 6 20H18C19.1046 20 20 19.1046 20 18V16" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
                    </svg>
                  </div>
                  <div className="upload-text">엑셀 파일 드래그 또는 클릭</div>
                  <div className="upload-sub">.xlsx · .xls 지원</div>
                </div>
              )}
            </div>

            {/* 01 테이블 설정 */}
            <div className="config-card">
              <div className="section-header">
                <span className="section-num">01</span>
                <span className="section-label">테이블 설정</span>
              </div>
              <div className="field-group">
                <label className="field-label">테이블 이름</label>
                <input className="field-input" value={tableName} onChange={e => setTableName(e.target.value)} placeholder="your_table" />
              </div>
            </div>

            {/* 02 작업 유형 */}
            <div className="config-card">
              <div className="section-header">
                <span className="section-num">02</span>
                <span className="section-label">작업 유형</span>
              </div>
              <div className="op-selector">
                {[
                  { val: "update", badge: "UPDATE", desc: "기존 행 수정" },
                  { val: "insert", badge: "INSERT", desc: "새 행 삽입" },
                  { val: "delete", badge: "DELETE", desc: "행 삭제" },
                ].map(op => (
                  <label key={op.val} className={`op-item ${operation === op.val ? `active-${op.val}` : ""}`}>
                    <input type="radio" name="op" value={op.val} checked={operation === op.val} onChange={() => setOperation(op.val)} />
                    <div className={`op-badge op-badge-${op.val}`}>{op.badge}</div>
                    <div className="op-desc">{op.desc}</div>
                  </label>
                ))}
              </div>
            </div>

            {/* 03 WHERE (UPDATE / DELETE) */}
            {showWhere && (
              <div className="config-card">
                <div className="section-header">
                  <span className="section-num">03</span>
                  <span className="section-label">WHERE 조건 컬럼</span>
                </div>
                <div className="mapping-row">
                  <div className="mapping-field">
                    <label className="field-label">엑셀 컬럼</label>
                    <select className="field-input" value={whereExcelCol}
                      onChange={e => { setWhereExcelCol(e.target.value); setWhereTypeOverride(null); }}>
                      <option value="">선택하세요</option>
                      {columns.map(c => <option key={c} value={c}>{c}</option>)}
                    </select>
                  </div>
                  <div className="mapping-arrow">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                      <path d="M5 12H19M13 6L19 12L13 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                    </svg>
                  </div>
                  <div className="mapping-field">
                    <label className="field-label">DB 컬럼명</label>
                    <input className="field-input" value={whereDbCol} onChange={e => setWhereDbCol(e.target.value)} placeholder="db_column" />
                  </div>
                </div>
                <TypeToggle colName={whereExcelCol} override={whereTypeOverride} onChange={setWhereTypeOverride} />
              </div>
            )}

            {/* 03/04 컬럼 매핑 */}
            {showSetMappings && (
              <div className="config-card">
                <div className="section-header">
                  <span className="section-num">{operation === "insert" ? "03" : "04"}</span>
                  <span className="section-label">{operation === "insert" ? "INSERT 컬럼 매핑" : "SET 컬럼 매핑"}</span>
                  <button className="add-btn" onClick={addSetMapping}>+ 추가</button>
                </div>
                <div className="set-mappings">
                  {setMappings.map((m, idx) => (
                    <div key={m.id}>
                      <div className={`mapping-row ${setMappings.length > 1 ? "has-remove" : ""}`}>
                        <div className="mapping-field">
                          {idx === 0 && <label className="field-label">엑셀 컬럼</label>}
                          <select className="field-input" value={m.excelCol}
                            onChange={e => updateSetMapping(m.id, "excelCol", e.target.value)}>
                            <option value="">선택하세요</option>
                            {columns.map(c => <option key={c} value={c}>{c}</option>)}
                          </select>
                        </div>
                        <div className="mapping-arrow">
                          <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                            <path d="M5 12H19M13 6L19 12L13 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                          </svg>
                        </div>
                        <div className="mapping-field">
                          {idx === 0 && <label className="field-label">DB 컬럼명</label>}
                          <input className="field-input" value={m.dbCol}
                            onChange={e => updateSetMapping(m.id, "dbCol", e.target.value)} placeholder="db_column" />
                        </div>
                        {setMappings.length > 1 && (
                          <button className="remove-btn" onClick={() => removeSetMapping(m.id)}>✕</button>
                        )}
                      </div>
                      <TypeToggle colName={m.excelCol} override={m.typeOverride} onChange={(v) => updateSetMapping(m.id, "typeOverride", v)} />
                      {idx < setMappings.length - 1 && <div style={{ height: 12 }} />}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* INSERT 옵션 */}
            {showInsertOptions && (
              <div className="config-card">
                <div className="section-header">
                  <span className="section-num">04</span>
                  <span className="section-label">INSERT 옵션</span>
                </div>
                <div className="options-row">
                  <div className="option-label">
                    INSERT IGNORE
                    <span style={{ color: "#444", fontSize: 10, display: "block", marginTop: 2 }}>중복 키 오류 무시</span>
                  </div>
                  <div className="toggle-wrap">
                    <input type="checkbox" id="ignoreToggle" className="toggle-input"
                      checked={insertIgnore}
                      onChange={e => { setInsertIgnore(e.target.checked); if (e.target.checked) setInsertOnDuplicate(false); }} />
                    <label htmlFor="ignoreToggle" className="toggle-track green" />
                  </div>
                </div>
                <div className="options-row" style={{ opacity: insertIgnore ? 0.35 : 1 }}>
                  <div className="option-label">
                    ON DUPLICATE KEY UPDATE
                    <span style={{ color: "#444", fontSize: 10, display: "block", marginTop: 2 }}>중복 시 해당 행 업데이트</span>
                  </div>
                  <div className="toggle-wrap">
                    <input type="checkbox" id="dupToggle" className="toggle-input"
                      checked={insertOnDuplicate} disabled={insertIgnore}
                      onChange={e => setInsertOnDuplicate(e.target.checked)} />
                    <label htmlFor="dupToggle" className="toggle-track green" />
                  </div>
                </div>
                <div className="options-row">
                  <div className="option-label">빈 셀 → NULL <span style={{ color: "#444" }}>(끄면 '' 빈 문자열)</span></div>
                  <div className="toggle-wrap">
                    <input type="checkbox" id="nullToggleIns" className="toggle-input"
                      checked={nullOnEmpty} onChange={e => setNullOnEmpty(e.target.checked)} />
                    <label htmlFor="nullToggleIns" className="toggle-track" />
                  </div>
                </div>
              </div>
            )}

            {/* UPDATE 쿼리 방식 */}
            {showQueryType && (
              <div className="config-card">
                <div className="section-header">
                  <span className="section-num">05</span>
                  <span className="section-label">쿼리 방식</span>
                </div>
                <div className="query-types">
                  {[
                    { val: "case", label: "CASE WHEN", desc: "단일 쿼리 처리 — 권장" },
                    { val: "join", label: "VALUES JOIN", desc: "인라인 서브쿼리" },
                    { val: "individual", label: "개별 UPDATE", desc: "한 줄씩 분리" },
                  ].map(opt => (
                    <label key={opt.val} className={`query-type-item ${queryType === opt.val ? "active" : ""}`}>
                      <input type="radio" name="qt" value={opt.val}
                        checked={queryType === opt.val} onChange={() => setQueryType(opt.val)} />
                      <div className="query-type-content">
                        <span className="query-type-label">{opt.label}</span>
                        <span className="query-type-desc">{opt.desc}</span>
                      </div>
                      <div className={`query-radio ${queryType === opt.val ? "checked" : ""}`} />
                    </label>
                  ))}
                </div>
                <div className="options-row" style={{ marginTop: 14 }}>
                  <div className="option-label">빈 셀 → NULL <span style={{ color: "#444" }}>(끄면 '' 빈 문자열)</span></div>
                  <div className="toggle-wrap">
                    <input type="checkbox" id="nullToggle" className="toggle-input"
                      checked={nullOnEmpty} onChange={e => setNullOnEmpty(e.target.checked)} />
                    <label htmlFor="nullToggle" className="toggle-track" />
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Right Panel */}
          <div className="right-panel">
            <div className="output-card">
              <div className="output-header">
                <div className="output-title">
                  <span className="output-dot" style={query ? { background: "#4ade80" } : {}} />
                  SQL OUTPUT
                  <span className={`op-tag op-tag-${operation}`}>{operation.toUpperCase()}</span>
                </div>
                {query && (
                  <button className={`copy-btn ${copied ? "copied" : ""}`} onClick={handleCopy}>
                    {copied ? "✓ 복사됨" : "⎘ 복사"}
                  </button>
                )}
              </div>

              <div className="output-body">
                {query ? (
                  <pre className="query-output">{query}</pre>
                ) : (
                  <div className="output-empty">
                    <div className="empty-icon">
                      <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
                        <path d="M14 2H6C5.46957 2 4.96086 2.21071 4.58579 2.58579C4.21071 2.96086 4 3.46957 4 4V20C4 20.5304 4.21071 21.0391 4.58579 21.4142C4.96086 21.7893 5.46957 22 6 22H18C18.5304 22 19.0391 21.7893 19.4142 21.4142C19.7893 21.0391 20 20.5304 20 20V8L14 2Z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                        <path d="M14 2V8H20M16 13H8M16 17H8M10 9H8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                      </svg>
                    </div>
                    <p className="empty-text">엑셀을 업로드하고<br />설정하면<br />쿼리가 생성됩니다</p>
                  </div>
                )}
              </div>

              <div className="output-statusbar">
                <div className="status-item">
                  <span className="sk">ROWS</span>
                  <span className="sv">{rows.length}</span>
                </div>
                <span className="sdiv">|</span>
                {operation !== "delete" && (
                  <>
                    <div className="status-item">
                      <span className="sk">{operation === "insert" ? "COLS" : "SET"}</span>
                      <span className="sv">{validMappings.length}개</span>
                    </div>
                    <span className="sdiv">|</span>
                  </>
                )}
                <div className="status-item">
                  <span className="sk">OP</span>
                  <span className="sv">{operation.toUpperCase()}</span>
                </div>
                <span className="sdiv">|</span>
                <div className="status-item">
                  <span className="sk">CHARS</span>
                  <span className="sv">{query.length.toLocaleString()}</span>
                </div>
                <div className="status-end">
                  <span className={`status-led ${query ? "on" : ""}`} />
                  {query ? "READY" : "IDLE"}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}