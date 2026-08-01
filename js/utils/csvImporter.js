/**
 * 選考進捗・ヨミ管理システム - スプレッドシートCSV一括取込・名寄せ・プレビューユーティリティ
 */

import { store } from '../store.js';

export function parseCSVText(csvText) {
  const lines = csvText.split(/\r\n|\n|\r/);
  const result = [];

  let currentLine = [];
  let inQuotes = false;
  let currentValue = '';

  for (let i = 0; i < csvText.length; i++) {
    const char = csvText[i];
    const nextChar = csvText[i + 1];

    if (char === '"') {
      if (inQuotes && nextChar === '"') {
        currentValue += '"';
        i++; // スキップ
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === ',' && !inQuotes) {
      currentLine.push(currentValue.trim());
      currentValue = '';
    } else if ((char === '\r' || char === '\n') && !inQuotes) {
      if (char === '\r' && nextChar === '\n') i++;
      currentLine.push(currentValue.trim());
      if (currentLine.some(cell => cell.length > 0)) {
        result.push(currentLine);
      }
      currentLine = [];
      currentValue = '';
    } else {
      currentValue += char;
    }
  }

  if (currentValue || currentLine.length > 0) {
    currentLine.push(currentValue.trim());
    if (currentLine.some(cell => cell.length > 0)) {
      result.push(currentLine);
    }
  }

  return result;
}

/**
 * CSVデータの解析と検証・プレビュー生成
 */
export function analyzeImportCSV(csvRows, autoCreateMasters = true) {
  if (!csvRows || csvRows.length < 2) {
    return { error: 'CSVにヘッダー行およびデータ行が存在しません。' };
  }

  const headers = csvRows[0].map(h => h.replace(/^\uFEFF/, '').trim());
  const dataRows = csvRows.slice(1);

  const getColIndex = (name) => headers.findIndex(h => h.includes(name));

  const idxCand = getColIndex('候補者');
  const idxComp = getColIndex('企業');
  const idxJob = getColIndex('求人') !== -1 ? getColIndex('求人') : getColIndex('ポジション');
  const idxCA = getColIndex('CA');
  const idxRA = getColIndex('RA');
  const idxPhase = getColIndex('フェーズ');
  const idxStatus = getColIndex('進行状態');
  const idxMonth = getColIndex('完了見込み月');
  const idxYomi = getColIndex('ヨミ');
  const idxDate = getColIndex('次回予定日');
  const idxMemo = getColIndex('備考');

  if (idxCand === -1 || idxComp === -1) {
    return { error: '必須項目「候補者名」「企業名」のヘッダーが見つかりません。' };
  }

  const existingConsultants = store.getConsultants();
  const existingCompanies = store.getCompanies();
  const existingJobs = store.getJobs();
  const existingCandidates = store.getCandidates();
  const existingSelections = store.getSelections();

  const previewItems = [];
  let newCount = 0;
  let updateCount = 0;
  let errorCount = 0;

  dataRows.forEach((row, rowIndex) => {
    const lineNum = rowIndex + 2;
    const candName = row[idxCand] || '';
    const compName = row[idxComp] || '';
    const jobTitle = idxJob !== -1 ? row[idxJob] : '総合職・標準ポジション';
    const caName = idxCA !== -1 ? row[idxCA] : '';
    const raName = idxRA !== -1 ? row[idxRA] : '';
    const phase = idxPhase !== -1 ? row[idxPhase] : '書類選考';
    const status = idxStatus !== -1 ? row[idxStatus] : '未対応';
    const month = idxMonth !== -1 ? row[idxMonth] : '';
    const yomiRaw = idxYomi !== -1 ? row[idxYomi] : '';
    const nextDate = idxDate !== -1 ? row[idxDate] : '';
    const memo = idxMemo !== -1 ? row[idxMemo] : '';

    const rowErrors = [];

    if (!candName) rowErrors.push('候補者名が空欄です');
    if (!compName) rowErrors.push('企業名が空欄です');

    // ヨミの数値変換
    let yomiVal = 0.25;
    if (yomiRaw.includes('0%')) yomiVal = 0;
    else if (yomiRaw.includes('25%')) yomiVal = 0.25;
    else if (yomiRaw.includes('50%')) yomiVal = 0.5;
    else if (yomiRaw.includes('75%')) yomiVal = 0.75;
    else if (yomiRaw.includes('100%')) yomiVal = 1.0;

    // マスタ存在判定
    const candMatch = existingCandidates.find(c => c.name === candName);
    const compMatch = existingCompanies.find(c => c.name === compName);
    const jobMatch = compMatch ? existingJobs.find(j => j.companyId === compMatch.companyId && j.title === jobTitle) : null;
    const caMatch = existingConsultants.find(c => c.name === caName);
    const raMatch = existingConsultants.find(c => c.name === raName);

    if (!autoCreateMasters) {
      if (!candMatch) rowErrors.push(`候補者マスタ未存在: ${candName}`);
      if (!compMatch) rowErrors.push(`企業マスタ未存在: ${compName}`);
    }

    // 重複判定（候補者 + 企業 + 求人）
    let isUpdate = false;
    if (candMatch && compMatch && jobMatch) {
      const existsSel = existingSelections.find(s => 
        s.candidateId === candMatch.candidateId &&
        s.companyId === compMatch.companyId &&
        s.jobId === jobMatch.jobId
      );
      if (existsSel) isUpdate = true;
    }

    if (rowErrors.length > 0) {
      errorCount++;
    } else if (isUpdate) {
      updateCount++;
    } else {
      newCount++;
    }

    previewItems.push({
      lineNum,
      candName,
      compName,
      jobTitle,
      caName,
      raName,
      phase,
      status,
      yomiVal,
      month,
      nextDate,
      memo,
      isUpdate,
      hasError: rowErrors.length > 0,
      errors: rowErrors
    });
  });

  return {
    totalRows: dataRows.length,
    newCount,
    updateCount,
    errorCount,
    items: previewItems
  };
}

/**
 * プレビュー完了後の実際のインポート実行処理
 */
export function executeImport(previewItems, autoCreateMasters = true) {
  let importedCount = 0;

  previewItems.forEach(item => {
    if (item.hasError) return;

    // 1. 候補者マスタ確保
    let candidate = store.getCandidates().find(c => c.name === item.candName);
    if (!candidate && autoCreateMasters) {
      candidate = store.saveCandidate({
        name: item.candName,
        kana: item.candName,
        caConsultantId: store.getConsultants()[0].consultantId,
        activityStatus: '選考中',
        internalManagementNumber: 'IMP-' + Date.now().toString().substr(6),
        remarks: 'CSV一括取り込みにより作成'
      });
      candidate = store.getCandidates().find(c => c.name === item.candName);
    }

    // 2. 企業マスタ確保
    let company = store.getCompanies().find(c => c.name === item.compName);
    if (!company && autoCreateMasters) {
      company = store.saveCompany({
        name: item.compName,
        kana: item.compName,
        raConsultantId: store.getConsultants()[0].consultantId,
        rank: '通常',
        checkIntervalDays: 3,
        remarks: 'CSV一括取り込みにより作成'
      });
      company = store.getCompanies().find(c => c.name === item.compName);
    }

    // 3. 求人マスタ確保
    let job = company ? store.getJobs(false, company.companyId).find(j => j.title === item.jobTitle) : null;
    if (!job && company && autoCreateMasters) {
      job = store.saveJob({
        companyId: company.companyId,
        title: item.jobTitle,
        status: '募集中',
        raConsultantId: company.raConsultantId
      });
      job = store.getJobs(false, company.companyId).find(j => j.title === item.jobTitle);
    }

    if (!candidate || !company || !job) return;

    // 4. コンサルタント取得
    const ca = store.getConsultants().find(c => c.name === item.caName) || store.getConsultants()[0];
    const ra = store.getConsultants().find(c => c.name === item.raName) || store.getConsultants()[0];

    // 5. 選考案件の登録・更新
    const existing = store.getSelections().find(s => 
      s.candidateId === candidate.candidateId &&
      s.companyId === company.companyId &&
      s.jobId === job.jobId
    );

    if (existing) {
      store.updateSelection(existing.selectionId, {
        phase: item.phase,
        progressStatus: item.status,
        yomi: item.yomiVal,
        expectedCompletionMonth: item.month || existing.expectedCompletionMonth,
        nextScheduleDate: item.nextDate || existing.nextScheduleDate,
        internalMemo: item.memo ? `${existing.internalMemo}\n[取り込み備考] ${item.memo}` : existing.internalMemo
      }, 'CSV一括取り込みによる更新');
    } else {
      store.addSelection({
        candidateId: candidate.candidateId,
        companyId: company.companyId,
        jobId: job.jobId,
        caConsultantId: ca.consultantId,
        raConsultantId: ra.consultantId,
        phase: item.phase,
        progressStatus: item.status,
        yomi: item.yomiVal,
        expectedCompletionMonth: item.month,
        nextScheduleDate: item.nextDate,
        internalMemo: item.memo
      });
    }

    importedCount++;
  });

  return importedCount;
}
