/**
 * 選考進捗・ヨミ管理システム - 企業向け CSV・Excel エクスポートユーティリティ (社内情報完全除外 ＆ 企業提出成形対応)
 */

import { store } from '../store.js';

/**
 * 企業向けエクスポートデータの生成 (非公開情報を徹底除外) (指示書 15項)
 */
export function buildCompanyExportRows(company, selections) {
  const candidates = store.getCandidates();
  const jobs = store.getJobs();

  const candidatesMap = new Map(candidates.map(c => [c.candidateId, c]));
  const jobsMap = new Map(jobs.map(j => [j.jobId, j]));

  return selections.map((sel, idx) => {
    const candidate = candidatesMap.get(sel.candidateId);
    const job = jobsMap.get(sel.jobId);

    // フェーズ・状態に応じた日付の動的決定 (指示書 13項)
    const dateStr = sel.nextScheduleDate || sel.recommendationDate || (sel.phaseUpdatedAt ? sel.phaseUpdatedAt.split('T')[0] : '');

    return {
      'No.': idx + 1,
      '候補者名': (candidate ? candidate.name : sel.candidateName) + ' 様',
      '応募ポジション': job ? (job.title || job.jobName) : sel.jobName,
      '推薦日/提出日': sel.recommendationDate || '',
      '現在の選考状況': `${sel.phase} (${sel.progressStatus})`,
      '面接予定日/実施日': dateStr,
      '企業への確認事項': sel.companyConfirmationItem || sel.companyCheckItems || '選考結果のご確認',
      '企業共有コメント': sel.companySharedComment || '',
      '企業回答': '',      // 人事記入欄
      '回答日': '',        // 人事記入欄
      '次回選考希望': '',   // 人事記入欄
      '備考・コメント': '' // 人事記入欄
    };
  });
}

/**
 * UTF-8 BOM付き CSV ダウンロード処理 (指示書 16, 28項)
 */
export function exportCompanyToCsv(company, selections, filename) {
  const rows = buildCompanyExportRows(company, selections);
  if (!rows || rows.length === 0) {
    alert('出力対象の選考案件が存在しません。');
    return;
  }

  const headers = Object.keys(rows[0]);
  
  const escapeCSV = (val) => {
    if (val === null || val === undefined) return '""';
    const str = String(val).replace(/"/g, '""');
    return `"${str}"`;
  };

  let csvContent = '\uFEFF'; // UTF-8 BOM
  csvContent += headers.map(escapeCSV).join(',') + '\r\n';

  rows.forEach(row => {
    const line = headers.map(h => escapeCSV(row[h])).join(',');
    csvContent += line + '\r\n';
  });

  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.setAttribute('href', url);
  link.setAttribute('download', filename.endsWith('.csv') ? filename : `${filename}.csv`);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

/**
 * SheetJS (XLSX) を利用した 企業向け Excel (.xlsx) ダウンロード処理 (指示書 17, 28項)
 */
export function exportCompanyToExcel(company, selections, filename) {
  const rows = buildCompanyExportRows(company, selections);
  if (!rows || rows.length === 0) {
    alert('出力対象の選考案件が存在しません。');
    return;
  }

  if (typeof XLSX === 'undefined') {
    console.warn('XLSX library not loaded, falling back to CSV export.');
    exportCompanyToCsv(company, selections, filename.replace(/\.xlsx$/i, '.csv'));
    return;
  }

  const consultants = store.getConsultants();
  const raCons = consultants.find(c => c.consultantId === (company.primaryRaId || company.raConsultantId));

  // ヘッダー概要情報行の構築 (指示書 17項)
  const headerInfo = [
    { 'No.': `${company.name} 御中`, '候補者名': '', '応募ポジション': '' },
    { 'No.': `資料名: 選考進捗確認資料`, '候補者名': '', '応募ポジション': '' },
    { 'No.': `作成日: ${new Date().toLocaleDateString('ja-JP')}`, '候補者名': '', '応募ポジション': '' },
    { 'No.': `担当: 株式会社サンクスパートナーズ (${raCons ? raCons.name : '担当RA'})`, '候補者名': '', '応募ポジション': '' },
    { 'No.': `対象件数: ${selections.length}件`, '候補者名': '', '応募ポジション': '' },
    { 'No.': '', '候補者名': '', '応募ポジション': '' } // 空白行
  ];

  const worksheet = XLSX.utils.json_to_sheet(rows, { origin: 'A7' });

  // 概要情報を書き込み
  XLSX.utils.sheet_add_json(worksheet, headerInfo, { skipHeader: true, origin: 'A1' });

  // 列幅自動調整 (指示書 17項)
  const colWidths = [
    { wch: 6 },  // No.
    { wch: 18 }, // 候補者名
    { wch: 24 }, // 応募ポジション
    { wch: 14 }, // 推薦日
    { wch: 22 }, // 現在の選考状況
    { wch: 18 }, // 面接予定日
    { wch: 28 }, // 確認事項
    { wch: 30 }, // 共有コメント
    { wch: 20 }, // 企業回答
    { wch: 14 }, // 回答日
    { wch: 18 }, // 次回選考希望
    { wch: 24 }  // コメント
  ];
  worksheet['!cols'] = colWidths;

  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, '選考進捗確認資料');

  const finalFilename = filename.endsWith('.xlsx') ? filename : `${filename}.xlsx`;
  XLSX.writeFile(workbook, finalFilename);
}
