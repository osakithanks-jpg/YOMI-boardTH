/**
 * 選考進捗・ヨミ管理システム - メールテンプレート & 自動生成ユーティリティ (選択候補者自動反映対応)
 */

/**
 * 日付フォーマット変換 (YYYY-MM-DD -> YYYY年M月D日) (指示書 14項)
 */
export function formatJapaneseDate(dateStr) {
  if (!dateStr) return null;
  // ISO形式やYYYY-MM-DD形式の解析
  const match = dateStr.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
  if (match) {
    const year = parseInt(match[1], 10);
    const month = parseInt(match[2], 10);
    const day = parseInt(match[3], 10);
    return `${year}年${month}月${day}日`;
  }
  const d = new Date(dateStr);
  if (!isNaN(d.getTime())) {
    return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`;
  }
  return null;
}

/**
 * 候補者名と敬称「様」の正規化 (指示書 5項)
 */
export function normalizeCandidateName(name) {
  if (!name) return '候補者 様';
  let cleaned = name.trim().replace(/\s*様\s*$/g, '').trim();
  return `${cleaned} 様`;
}

/**
 * フェーズ＆進行状態に応じた初期確認事項の補完 (指示書 10項)
 */
export function getConfirmationItem(selection) {
  const customItem = selection.companyConfirmationItem || selection.companyCheckItems || selection.companySharedComment;
  if (customItem && customItem.trim()) {
    return customItem.trim();
  }

  const phase = selection.phase || '';
  const status = selection.progressStatus || '';

  if (phase === '書類選考') {
    return '書類選考結果のご確認';
  }
  if (phase.includes('面接')) {
    if (status === '調整中' || status === '未対応') {
      return '面接日程のご確認';
    }
    if (status === '実施済み・結果待ち' || status === '実施済み' || status === '結果待ち') {
      return '面接結果のご確認';
    }
    return '選考進捗のご確認';
  }
  if (phase === 'オファー面談・条件提示' || phase === '内定') {
    if (status === '保留') return '進捗のご確認';
    return '内定条件および今後の進行についてのご確認';
  }
  if (phase === '内定承諾' || phase === '入社予定') {
    return '入社手続きおよび受け入れ準備のご確認';
  }

  return '進捗のご確認';
}

/**
 * フェーズ＆進行状態に応じた動的日付項目名と日本語日付の取得 (指示書 6項, 7項)
 */
export function getDateInfoForSelection(selection, histories = []) {
  const phase = selection.phase || '';
  const status = selection.progressStatus || '';

  // 1. 書類選考
  if (phase === '書類選考' || phase === '推薦準備') {
    const rawDate = selection.submissionDate || selection.recommendationDate || selection.createdAt;
    const formatted = formatJapaneseDate(rawDate);
    return formatted ? { label: '書類提出日', value: formatted } : null;
  }

  // 2. 一次〜最終面接
  if (phase.includes('面接')) {
    const isBeforeInterview = status === '調整中' || status === '日程確定' || status === '未対応' || status === '実施前';
    const rawDate = selection.nextScheduleDate || selection.interviewDate || selection.phaseUpdatedAt;
    const formatted = formatJapaneseDate(rawDate);
    
    if (isBeforeInterview) {
      return formatted ? { label: '面接予定日', value: formatted } : null;
    } else {
      return formatted ? { label: '面接実施日', value: formatted } : null;
    }
  }

  // 3. オファー面談・条件提示
  if (phase === 'オファー面談・条件提示') {
    const rawDate = selection.nextScheduleDate || selection.phaseUpdatedAt;
    const formatted = formatJapaneseDate(rawDate);
    const isPast = rawDate && new Date(rawDate) <= new Date();

    if (status === '条件提示のみ') {
      return formatted ? { label: '条件提示日', value: formatted } : null;
    }
    if (isPast || status === '実施済み' || status === '通過' || status === '保留') {
      return formatted ? { label: '面談実施日', value: formatted } : null;
    } else {
      return formatted ? { label: '面談予定日', value: formatted } : null;
    }
  }

  // 4. 内定
  if (phase === '内定') {
    // 履歴から探すか、phaseUpdatedAt
    const noticeDate = selection.offerNoticeDate || selection.phaseUpdatedAt || selection.createdAt;
    const formatted = formatJapaneseDate(noticeDate);
    return formatted ? { label: '内定通知日', value: formatted } : null;
  }

  // 5. 内定承諾 / 入社予定
  if (phase === '内定承諾' || phase === '入社予定') {
    const acceptDate = selection.acceptanceDate || selection.selectionEndDate || selection.phaseUpdatedAt;
    const formatted = formatJapaneseDate(acceptDate);
    return formatted ? { label: '内定承諾日', value: formatted } : null;
  }

  // デフォルト: 次回予定日
  const rawDate = selection.nextScheduleDate;
  const formatted = formatJapaneseDate(rawDate);
  return formatted ? { label: '次回予定日', value: formatted } : null;
}

/**
 * 選択された全選考案件から {{候補者一覧}} 差し込みテキストを一括自動生成 (指示書 2, 3, 4, 5, 6, 7, 8, 9, 10項)
 */
export function buildCandidateListEmailText(selections, candidatesMap, jobsMap, historiesList = []) {
  if (!selections || selections.length === 0) {
    return '（対象の選考案件が選択されていません）';
  }

  let hasMissingDate = false;

  const itemsText = selections.map((s, idx) => {
    const cand = candidatesMap.get(s.candidateId);
    const job = jobsMap.get(s.jobId);

    const candNameFormatted = normalizeCandidateName(cand ? cand.name : s.candidateName);
    const jobTitleFormatted = job ? job.title : s.jobName || '全般';

    // 現在の選考状況：フェーズ（進行状態） (指示書 4項)
    let statusText = s.phase || '';
    if (s.progressStatus && s.progressStatus !== '未対応' && s.progressStatus !== '未登録' && s.progressStatus.trim() !== '') {
      statusText += `（${s.progressStatus}）`;
    }

    // フェーズ対応の日付 (指示書 6項, 7項)
    const dateInfo = getDateInfoForSelection(s, historiesList);
    if (!dateInfo) {
      hasMissingDate = true;
    }

    // 確認事項 (指示書 10項)
    const confirmItem = getConfirmationItem(s);

    let text = `${idx + 1}．${candNameFormatted}\n`;
    text += `  応募ポジション：${jobTitleFormatted}\n`;
    text += `  現在の選考状況：${statusText}\n`;
    if (dateInfo) {
      text += `  ${dateInfo.label}：${dateInfo.value}\n`;
    }
    text += `  確認事項：${confirmItem}`;

    return text;
  }).join('\n\n'); // 空行1行を挟む (指示書 8項)

  return {
    text: itemsText,
    hasMissingDate
  };
}

/**
 * クリップボードへの文字列コピー
 */
export async function copyToClipboard(text) {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    } else {
      const textArea = document.createElement('textarea');
      textArea.value = text;
      textArea.style.position = 'fixed';
      textArea.style.left = '-999999px';
      document.body.appendChild(textArea);
      textArea.focus();
      textArea.select();
      const successful = document.execCommand('copy');
      textArea.remove();
      return successful;
    }
  } catch (err) {
    console.error('Copy failed', err);
    return false;
  }
}

/**
 * 簡易確認メール文面自動生成 (旧機能維持用)
 */
export function generateCheckEmailTemplate(companyName, contactName, raName, inProgressCount) {
  const contactStr = contactName ? `${contactName}様` : 'ご担当者様';

  return `${companyName}
${contactStr}

いつも大変お世話になっております。
株式会社サンクスパートナーズの${raName}でございます。

現在、貴社にて進行中の選考案件（全${inProgressCount}名）につきまして、
最新の選考状況および面接結果のご確認のためご連絡いたしました。

お忙しいところ恐縮ではございますが、ご高覧いただけますと幸いでございます。
何卒よろしくお願い申し上げます。`;
}
