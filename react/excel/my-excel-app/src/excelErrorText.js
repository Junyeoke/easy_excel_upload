const normalizeText = (value) => String(value || '').replace(/\s+/g, ' ').trim();

const extractLengthInfo = (msg) => {
  const text = String(msg || '');
  const maxMatch =
    text.match(/최대\s*([0-9,]+)\s*자/) ||
    text.match(/max\s*[:=]?\s*([0-9,]+)/i) ||
    text.match(/maximum\s*([0-9,]+)/i);
  const inputMatch =
    text.match(/입력\s*([0-9,]+)\s*자/) ||
    text.match(/input\s*[:=]?\s*([0-9,]+)/i) ||
    text.match(/entered\s*([0-9,]+)/i);

  return {
    maxLen: maxMatch ? maxMatch[1].replace(/,/g, '') : '',
    inputLen: inputMatch ? inputMatch[1].replace(/,/g, '') : '',
  };
};

export const translateError = (msg) => {
  if (!msg) {
    return {
      friendlyMsg: '알 수 없는 오류',
      solution: '관리자에게 문의해 주세요.',
    };
  }

  const text = String(msg);
  const rowMatch = text.match(/엑셀\s*\[\s*(\d+)\s*번째\s*행\s*\]/i) || text.match(/row\s*[:=]\s*(\d+)/i);
  const rowInfo = rowMatch ? `${rowMatch[1]}번째 행에서 ` : '';
  const lower = text.toLowerCase();

  if (lower.includes('cancel') || text.includes('사용자 요청으로 업로드가 취소')) {
    return { friendlyMsg: '사용자 요청으로 업로드가 취소되었습니다.', solution: '파일이나 설정을 수정한 뒤 다시 실행할 수 있습니다.' };
  }
  if (lower.includes('cannot be null') || lower.includes('null')) {
    return { friendlyMsg: `${rowInfo}필수 값이 비어 있습니다.`, solution: '빈 셀이 있는지 확인해 주세요.' };
  }
  if (lower.includes('duplicate entry') || lower.includes('unique constraint') || lower.includes('ora-00001')) {
    return { friendlyMsg: `${rowInfo}중복 데이터가 있습니다.`, solution: '이미 등록된 값인지 확인해 주세요.' };
  }
  if (lower.includes('data too long') || lower.includes('value too large') || text.includes('길이초과')) {
    const { maxLen, inputLen } = extractLengthInfo(text);
    const detail = maxLen || inputLen ? ` (최대 ${maxLen || '?'}자, 입력 ${inputLen || '?'}자)` : '';
    return {
      friendlyMsg: `${rowInfo}값 길이 초과${detail}`,
      solution: '해당 컬럼의 허용 길이 안으로 줄여 주세요.',
    };
  }
  if (lower.includes('syntax error') || lower.includes('sql')) {
    return { friendlyMsg: `${rowInfo}SQL 처리에 실패했습니다.`, solution: '매핑이나 SQL 문법을 다시 확인해 주세요.' };
  }
  return { friendlyMsg: `${rowInfo}데이터 처리에 실패했습니다.`, solution: '원문 오류와 설정을 함께 확인해 주세요.' };
};

const resolveColumnLabel = (mapping, excelHeaders, dbCol) => {
  const target = String(dbCol || '').toLowerCase();
  for (const aliasMap of Object.values(mapping || {})) {
    for (const [dbColKey, excelIdxVal] of Object.entries(aliasMap || {})) {
      if (String(dbColKey).toLowerCase() !== target) continue;
      const idx = Number.parseInt(excelIdxVal, 10);
      if (!Number.isNaN(idx)) {
        return {
          colIdx: idx,
          colLabel: excelHeaders?.[idx]?.label || dbColKey,
        };
      }
    }
  }
  return { colIdx: null, colLabel: null };
};

export const parseFailedColsFromMsg = (msg, mapping = {}, excelHeaders = []) => {
  if (!msg) return [];
  const text = String(msg);
  const results = [];

  const multiMatch = text.match(/\[MULTI_COL\]\s*(.+)/);
  if (multiMatch) {
    multiMatch[1].split('|').forEach((entry) => {
      const colonIdx = entry.indexOf(':');
      const dbCol = normalizeText(colonIdx >= 0 ? entry.substring(0, colonIdx) : entry).toLowerCase();
      const errRaw = normalizeText(colonIdx >= 0 ? entry.substring(colonIdx + 1) : '');
      const { colIdx, colLabel } = resolveColumnLabel(mapping, excelHeaders, dbCol);
      results.push({
        dbCol,
        errType: translateError(errRaw).friendlyMsg || 'DB 저장 실패',
        colIdx,
        colLabel,
      });
    });
    return results;
  }

  const patterns = [
    /[Cc]olumn['\s`"]+([a-zA-Z0-9_]+)/,
    /field['\s`"]+([a-zA-Z0-9_]+)/i,
    /for column '([^']+)'/i,
    /컬럼['\s`"]+([a-zA-Z0-9_가-힣]+)/,
  ];

  let dbCol = null;
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) {
      dbCol = match[1];
      break;
    }
  }
  if (!dbCol) return [];

  const { colIdx, colLabel } = resolveColumnLabel(mapping, excelHeaders, dbCol);
  return [{
    dbCol: String(dbCol).toLowerCase(),
    errType: translateError(text).friendlyMsg || 'DB 저장 실패',
    colIdx,
    colLabel,
  }];
};

export const friendlyFailMsg = (msg) => {
  const text = String(msg || '');
  if (!text) return '오류';

  if (text.startsWith('[MULTI_COL]')) {
    const types = new Set(
      text.replace('[MULTI_COL]', '').trim().split('|').map((entry) => {
        const errText = normalizeText(entry.split(':').slice(1).join(':'));
        return translateError(errText).friendlyMsg || 'DB 저장 실패';
      })
    );
    return [...types].join(' / ');
  }

  return translateError(text).friendlyMsg || '오류';
};
