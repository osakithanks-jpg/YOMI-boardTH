/**
 * 選考進捗・ヨミ管理システム - ホワイトボード用 5区分フェーズマッピング & RA対応計算ユーティリティ (指示書 5, 6, 7, 10, 15, 17, 18, 27項)
 */

import { WHITEBOARD_5PHASES, URGENCY_LEVELS, NEXT_ACTION_TARGETS } from '../constants.js';

/**
 * 実フェーズ文字列からホワイトボード5区分表示グループへのマッピング (指示書 6, 7, 30項)
 */
export function getWhiteboardPhaseGroup(phaseInput) {
  if (!phaseInput) return '書類選考';

  const phase = phaseInput.trim();

  // 1. 内定承諾
  if (['内定承諾', '承諾', '入社予定', '入社日確定', '入社手続き中', '内定承諾後'].includes(phase)) {
    return '内定承諾';
  }

  // 2. 内定
  if (['内定', 'オファー面談', 'オファー面談・条件提示', '条件提示', '条件調整中', '内定回答待ち', '候補者回答待ち', 'オファー面談調整中'].includes(phase)) {
    return '内定';
  }

  // 3. 最終・二次
  if (['二次面接', '二次選考', '三次面接', '三次選考', '最終面接', '最終選考', '役員面接', '二次面接以降', '最終面接前面談', '最終'].includes(phase)) {
    return '最終・二次';
  }

  // 4. 一次
  if (['一次面接', '一次選考', '一次面談', 'カジュアル面談', '一次面接日程調整', '一次面接結果待ち', '一次'].includes(phase)) {
    return '一次';
  }

  // 5. 書類選考
  if (['推薦準備', '推薦済み', '書類提出済み', '書類選考', '書類確認中', '書類選考結果待ち', '企業推薦前確認', '書類'].includes(phase)) {
    return '書類選考';
  }

  // 表記ゆれ判定
  if (phase.includes('最終') || phase.includes('二次') || phase.includes('三次')) return '最終・二次';
  if (phase.includes('一次') || phase.includes('面談')) return '一次';
  if (phase.includes('オファー') || phase.includes('条件') || phase.includes('内定')) return '内定';
  if (phase.includes('承諾') || phase.includes('入社')) return '内定承諾';

  return '書類選考';
}

/**
 * 営業日加算ユーティリティ (土日スキップ) (指示書 15, 19項)
 */
export function addBusinessDays(startDateInput, daysToAdd) {
  let date = new Date(startDateInput || new Date());
  let added = 0;
  while (added < daysToAdd) {
    date.setDate(date.getDate() + 1);
    const dayOfWeek = date.getDay();
    if (dayOfWeek !== 0 && dayOfWeek !== 6) { // 0:日, 6:土
      added++;
    }
  }
  return date;
}

/**
 * CAが選考フェーズ・進行状態を更新した際の RA企業対応項目 自動連動判定ロジック (指示書 5, 6, 7, 11, 15, 18, 27項)
 */
export function deriveCompanyActionFromSelection({ phase, progressStatus, recommendationDate, nextScheduleDate, currentCompanyAction = {} }) {
  const p = phase || '書類選考';
  const s = progressStatus || '未対応';
  const today = new Date();

  let type = '要確認';
  let status = '未対応';
  let confirmationItem = '';
  let nextAction = '要確認';
  let nextActionTarget = '企業';
  let suggestedDeadlineDays = 2;

  // 1. 選考終了・辞退・見送り案件の自動処理 (指示書 6項)
  if (p === '選考終了' || p === '内定辞退' || s === '不通過' || s === '候補者辞退' || s === '企業都合終了') {
    return {
      companyActionType: '対応不要',
      companyActionStatus: '対応完了',
      companyConfirmationItem: '',
      nextAction: '対応完了',
      nextActionTarget: '対応不要',
      actionDeadline: null,
      nextCompanyContactDate: null,
      shouldAppearInRaToday: false
    };
  }

  // 2. 内定承諾
  if (p === '内定承諾' || p === '入社予定') {
    type = '入社手続きの確認';
    status = '未対応';
    confirmationItem = '入社日・入社手続きのご確認';
    nextAction = '企業へ入社日・入社手続きを確認';
    nextActionTarget = '企業';
    suggestedDeadlineDays = 3;
  }
  // 3. 内定・オファー面談・条件提示
  else if (p === '内定' || p === 'オファー面談・条件提示' || p === '条件提示') {
    if (s === '日程調整中') {
      type = 'オファー面談日程の確認';
      status = '未対応';
      confirmationItem = 'オファー面談日程のご確認';
      nextAction = '企業へオファー面談日を確認';
      nextActionTarget = '企業';
      suggestedDeadlineDays = 2;
    } else if (s === '条件確認中' || s === '条件提示中') {
      type = '条件内容の確認';
      status = '未対応';
      confirmationItem = '提示条件および回答期限のご確認';
      nextAction = '企業へ条件内容・回答期限を確認';
      nextActionTarget = '企業';
      suggestedDeadlineDays = 3;
    } else if (s === '候補者回答待ち' || s === '未対応') {
      type = '候補者意向の確認';
      status = 'CA確認待ち';
      confirmationItem = currentCompanyAction.companyConfirmationItem || '候補者の選考意向・回答期限のご確認';
      nextAction = 'CAへ候補者の意向を確認';
      nextActionTarget = 'CA';
      suggestedDeadlineDays = 1;
    } else {
      type = 'オファー面談・条件提示の確認';
      status = '未対応';
      confirmationItem = 'オファー面談・条件提示進捗のご確認';
      nextAction = '企業へオファー面談・条件提示進捗を確認';
      nextActionTarget = '企業';
    }
  }
  // 4. 面接（最終・三次・二次・一次）
  else if (p.includes('面接')) {
    const isFinal = p.includes('最終');
    const isSecond = p.includes('二次');
    const isThird = p.includes('三次');

    const prefix = isFinal ? '最終面接' : (isThird ? '三次面接' : (isSecond ? '二次面接' : '一次面接'));

    if (s === '日程調整中') {
      type = '面接日程の確認';
      status = '未対応';
      confirmationItem = `${prefix}日程のご確認`;
      nextAction = `企業へ${prefix}日程を確認`;
      nextActionTarget = '企業';
      suggestedDeadlineDays = 2;
    } else if (s === '候補者日程待ち') {
      type = '候補者日程の確認';
      status = 'CA確認待ち';
      confirmationItem = currentCompanyAction.companyConfirmationItem || `${prefix}の候補者様候補日確認`;
      nextAction = `CAへ候補者の${prefix}候補日を確認`;
      nextActionTarget = 'CA';
      suggestedDeadlineDays = 1;
    } else if (s === '実施済み・結果待ち' || s === '未対応') {
      type = '面接結果の確認';
      status = '未対応';
      confirmationItem = `${prefix}結果のご確認`;
      nextAction = `企業へ${prefix}結果を確認`;
      nextActionTarget = '企業';
      suggestedDeadlineDays = 2;
    } else {
      type = '面接進捗の確認';
      status = '未対応';
      confirmationItem = `${prefix}進捗のご確認`;
      nextAction = `企業へ${prefix}進捗を確認`;
      nextActionTarget = '企業';
    }
  }
  // 5. 書類選考
  else if (p === '書類選考' || p === '推薦準備') {
    if (p === '推薦準備') {
      type = '推薦書類の確認';
      status = 'CA確認待ち';
      confirmationItem = '推薦書類のご準備・推薦状況のご確認';
      nextAction = 'CAへ推薦書類の状況を確認';
      nextActionTarget = 'CA';
      suggestedDeadlineDays = 1;
    } else {
      type = '書類選考結果の確認';
      status = '未対応';
      confirmationItem = '書類選考結果のご確認';
      nextAction = '企業へ書類選考結果を確認';
      nextActionTarget = '企業';
      suggestedDeadlineDays = 3;
    }
  }

  const calculatedDeadline = addBusinessDays(today, suggestedDeadlineDays).toISOString().slice(0, 10);

  return {
    companyActionType: type,
    companyActionStatus: status,
    companyConfirmationItem: confirmationItem,
    nextAction,
    nextActionTarget,
    actionDeadline: calculatedDeadline,
    nextCompanyContactDate: calculatedDeadline,
    companyActionSource: 'auto',
    shouldAppearInRaToday: (status === '未対応' || status === 'CA確認待ち')
  };
}

/**
 * フェーズと進行状態からの「次の対応」および「対応先」自動判定
 */
export function autoDetectNextAction(selection) {
  if (!selection) return { action: '要確認', target: '社内' };

  if (selection.nextAction && selection.nextActionTarget) {
    return { action: selection.nextAction, target: selection.nextActionTarget };
  }

  const derived = deriveCompanyActionFromSelection({
    phase: selection.phase,
    progressStatus: selection.progressStatus,
    currentCompanyAction: selection
  });

  return {
    action: derived.nextAction,
    target: derived.nextActionTarget
  };
}

/**
 * 基準日からの経過日数の計算
 */
export function calculateElapsedTime(selection, todayInput = new Date()) {
  const today = new Date(todayInput);
  today.setHours(0, 0, 0, 0);

  const phase = selection.phase || '';
  let baseDate = null;
  let label = '経過';

  if (phase === '書類選考') {
    if (selection.recommendationDate) {
      baseDate = new Date(selection.recommendationDate);
      label = '書類提出後';
    }
  } else if (phase.includes('面接')) {
    if (selection.nextScheduleDate && new Date(selection.nextScheduleDate) <= today) {
      baseDate = new Date(selection.nextScheduleDate);
      label = '面接実施後';
    }
  }

  if (!baseDate && selection.phaseUpdatedAt) {
    baseDate = new Date(selection.phaseUpdatedAt);
    label = 'フェーズ変更後';
  }

  if (!baseDate) {
    return { days: 0, label: '経過', text: '経過: -' };
  }

  baseDate.setHours(0, 0, 0, 0);
  const diffTime = today.getTime() - baseDate.getTime();
  const diffDays = Math.max(0, Math.floor(diffTime / (1000 * 60 * 60 * 24)));

  return {
    days: diffDays,
    label,
    text: `${label}：${diffDays}日`
  };
}

/**
 * 対応期限の確定
 */
export function getEffectiveDeadline(selection, todayInput = new Date()) {
  if (selection.actionDeadline) return new Date(selection.actionDeadline);
  if (selection.nextCompanyContactDate) return new Date(selection.nextCompanyContactDate);
  if (selection.nextScheduleDate) return new Date(selection.nextScheduleDate);

  const today = new Date(todayInput);
  return addBusinessDays(today, 2);
}

/**
 * 緊急度の判定
 */
export function calculateUrgency(selection, todayInput = new Date()) {
  if (selection.phase === '内定辞退') return URGENCY_LEVELS.DECLINED;
  if (selection.phase === '選考終了') return URGENCY_LEVELS.NONE;
  if (selection.companyActionStatus === '完了' || selection.companyActionStatus === '対応完了' || selection.progressStatus === '完了') return URGENCY_LEVELS.NONE;

  const today = new Date(todayInput);
  today.setHours(0, 0, 0, 0);

  const deadline = getEffectiveDeadline(selection, today);
  deadline.setHours(0, 0, 0, 0);

  const diffTime = deadline.getTime() - today.getTime();
  const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));

  if (diffDays < 0) return URGENCY_LEVELS.EXPIRED;
  if (diffDays === 0) return URGENCY_LEVELS.TODAY;

  if (selection.companyActionStatus === '回答待ち') return URGENCY_LEVELS.WAITING_REPLY;
  if (selection.nextActionTarget === 'CA' || selection.companyActionStatus === 'CA確認待ち') return URGENCY_LEVELS.CA_CHECK;
  if (diffDays >= 1 && diffDays <= 3) return URGENCY_LEVELS.WITHIN_3DAYS;

  return URGENCY_LEVELS.NONE;
}
