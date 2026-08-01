/**
 * 選考進捗・ヨミ管理システム - メール作成・連絡登録モーダルコンポーネント (高精度候補者一覧自動反映 ＆ 手動編集保護)
 */

import { store } from '../store.js';
import { EMAIL_TONES } from '../constants.js';
import {
  copyToClipboard,
  buildCandidateListEmailText,
  getDateInfoForSelection,
  getConfirmationItem,
  normalizeCandidateName
} from '../utils/mailTemplate.js';

export function openEmailComposerModal(companyId, onClose, initialSelectionIds = null) {
  let modalEl = document.getElementById('email-composer-modal');
  if (modalEl) modalEl.remove();

  const company = store.getCompanies().find(c => c.companyId === companyId);
  if (!company) return;

  const selections = store.getSelections().filter(s => !s.isArchived && s.companyId === companyId && s.phase !== '選考終了');
  const candidates = store.getCandidates();
  const jobs = store.getJobs(false, companyId);
  const consultants = store.getConsultants();
  const templates = store.getEmailTemplates();
  const histories = store.getHistories();

  const candidatesMap = new Map(candidates.map(c => [c.candidateId, c]));
  const jobsMap = new Map(jobs.map(j => [j.jobId, j]));
  const consultantsMap = new Map(consultants.map(c => [c.consultantId, c]));

  let selectedTemplateId = templates[0] ? templates[0].id : '';
  let selectedTone = 'normal';
  
  // 初期選択案件リスト
  let selectedSelectionIds = initialSelectionIds && initialSelectionIds.length > 0 
    ? [...initialSelectionIds]
    : selections.map(s => s.selectionId);

  let generatedSubject = '';
  let generatedBody = '';
  let isManuallyEdited = false; // 手動編集フラグ (指示書 13項)

  modalEl = document.createElement('div');
  modalEl.id = 'email-composer-modal';
  modalEl.className = 'fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4 overflow-y-auto';

  function buildGeneratedBodyAndSubject() {
    const currentTpl = templates.find(t => t.id === selectedTemplateId) || templates[0];
    const user = store.getCurrentConsultant();
    const todayStr = new Date().toLocaleDateString('ja-JP');

    // 選択された選考案件の配列 (指示書 8項, 9項)
    const targetSelections = selections.filter(s => selectedSelectionIds.includes(s.selectionId));

    // {{候補者一覧}} 差し込みテキストの自動生成 (指示書 2, 3, 4, 5, 6, 7, 8, 9, 10, 11項)
    const candListResult = buildCandidateListEmailText(targetSelections, candidatesMap, jobsMap, histories);
    const bulkCandidateListStr = candListResult.text;

    // 単体用変数の構築
    let candNameStr = '';
    let jobTitleStr = '';
    let recDateStr = '';
    let interviewDateStr = '';
    let phaseStr = '';
    let statusStr = '';
    let checkItemStr = '';

    if (targetSelections.length === 1) {
      const s = targetSelections[0];
      const cand = candidatesMap.get(s.candidateId);
      const job = jobsMap.get(s.jobId);
      candNameStr = normalizeCandidateName(cand ? cand.name : s.candidateName);
      jobTitleStr = job ? job.title : s.jobName;
      recDateStr = s.recommendationDate || '-';
      interviewDateStr = s.nextScheduleDate || '-';
      phaseStr = s.phase;
      statusStr = s.progressStatus;
      checkItemStr = getConfirmationItem(s);
    } else if (targetSelections.length > 1) {
      candNameStr = targetSelections.map(s => normalizeCandidateName(candidatesMap.get(s.candidateId)?.name || s.candidateName)).join('、');
      jobTitleStr = '複数ポジション';
      phaseStr = '各候補者様のステータス';
      checkItemStr = '各候補者様の進捗確認';
    }

    const replaceVars = (text) => {
      if (!text) return '';
      return text
        .replace(/\{\{企業名\}\}/g, company.name)
        .replace(/\{\{企業担当者名\}\}/g, company.contactName || 'ご担当者')
        .replace(/\{\{RA名\}\}/g, user.name)
        .replace(/\{\{候補者名\}\}/g, candNameStr)
        .replace(/\{\{求人名\}\}/g, jobTitleStr)
        .replace(/\{\{推薦日\}\}/g, recDateStr)
        .replace(/\{\{面接実施日\}\}/g, interviewDateStr)
        .replace(/\{\{面接予定日\}\}/g, interviewDateStr)
        .replace(/\{\{選考フェーズ\}\}/g, phaseStr)
        .replace(/\{\{進行状態\}\}/g, statusStr)
        .replace(/\{\{確認事項\}\}/g, checkItemStr)
        .replace(/\{\{候補者回答期限\}\}/g, '近日中')
        .replace(/\{\{本日の日付\}\}/g, todayStr)
        .replace(/\{\{候補者一覧\}\}/g, bulkCandidateListStr);
    };

    generatedSubject = replaceVars(currentTpl?.subjectTemplate || '');
    generatedBody = replaceVars(currentTpl?.bodyTemplate || '');

    return { candListResult, targetSelections };
  }

  function renderModalContent() {
    const { candListResult, targetSelections } = buildGeneratedBodyAndSubject();

    modalEl.innerHTML = `
      <div class="bg-white rounded-2xl shadow-2xl border border-slate-200 w-full max-w-4xl max-h-[90vh] flex flex-col overflow-hidden animate-fadeIn text-xs">
        <!-- ヘッダー -->
        <div class="px-6 py-4 bg-slate-900 text-white flex items-center justify-between border-b border-slate-800">
          <div>
            <h3 class="text-base font-bold flex items-center gap-2">
              <svg class="w-5 h-5 text-indigo-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"></path></svg>
              企業向け進捗確認メール作成 (${company.name})
            </h3>
            <p class="text-xs text-slate-400 mt-0.5">テンプレート選択・候補者情報自動差し込み・コピー＆連絡履歴更新</p>
          </div>
          <button id="btn-composer-close" class="text-slate-400 hover:text-white p-1">
            <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path></svg>
          </button>
        </div>

        <div class="p-6 overflow-y-auto space-y-5 flex-1">
          <!-- 選択中案件の要約確認エリア (指示書 12項) -->
          <div class="bg-slate-50 p-4 rounded-xl border border-slate-200 space-y-2">
            <div class="flex items-center justify-between">
              <h4 class="font-bold text-slate-800 flex items-center gap-2">
                <span>対象候補者・選考案件の選択</span>
                <span class="px-2 py-0.5 bg-indigo-100 text-indigo-800 rounded font-bold text-[11px]">選択中: ${targetSelections.length}案件</span>
              </h4>
              ${candListResult.hasMissingDate ? `
                <span class="text-[11px] font-bold text-amber-700 bg-amber-50 px-2 py-0.5 rounded border border-amber-200">
                  ⚠️ 一部の選考案件で日付が未登録です（日付行は自動省略されています）
                </span>
              ` : ''}
            </div>

            <!-- 要約バッジ表示 (指示書 12項) -->
            <div class="bg-white p-2.5 rounded-lg border border-slate-200 max-h-28 overflow-y-auto space-y-1">
              ${targetSelections.length === 0 ? `
                <span class="text-slate-400">案件が選択されていません。下記よりチェックを入れて選択してください。</span>
              ` : targetSelections.map(s => {
                const cand = candidatesMap.get(s.candidateId);
                const job = jobsMap.get(s.jobId);
                const dateInfo = getDateInfoForSelection(s, histories);
                return `
                  <div class="text-[11px] text-slate-700 font-medium flex items-center justify-between border-b border-slate-100 pb-1 last:border-0 last:pb-0">
                    <span>・<strong class="text-slate-900">${cand ? cand.name : s.candidateName} 様</strong> ／ ${job ? job.title : s.jobName} ／ <strong class="text-indigo-700">${s.phase} (${s.progressStatus})</strong></span>
                    <span class="text-slate-500 font-mono">${dateInfo ? `${dateInfo.label}:${dateInfo.value}` : '日付未登録'}</span>
                  </div>
                `;
              }).join('')}
            </div>

            <div class="flex flex-wrap gap-2 pt-1">
              ${selections.map(s => {
                const cand = candidatesMap.get(s.candidateId);
                const isSelected = selectedSelectionIds.includes(s.selectionId);
                return `
                  <label class="inline-flex items-center space-x-1.5 px-2.5 py-1 bg-white border border-slate-300 rounded cursor-pointer ${isSelected ? 'border-indigo-500 bg-indigo-50/50 text-indigo-900 font-bold' : 'text-slate-700'}">
                    <input type="checkbox" class="chk-select-item" data-id="${s.selectionId}" ${isSelected ? 'checked' : ''} class="rounded text-indigo-600">
                    <span>${cand ? cand.name : s.candidateName} (${s.phase})</span>
                  </label>
                `;
              }).join('')}
            </div>
          </div>

          <!-- テンプレート・トーン選択 -->
          <div class="grid grid-cols-1 sm:grid-cols-2 gap-4 bg-indigo-50/40 p-4 rounded-xl border border-indigo-100">
            <div>
              <label class="block font-bold text-slate-800 mb-1">メールテンプレート</label>
              <select id="select-composer-template" class="w-full bg-white border border-slate-300 font-bold text-indigo-900 rounded px-3 py-2 focus:outline-none focus:border-indigo-600">
                ${templates.map(t => `<option value="${t.id}" ${t.id === selectedTemplateId ? 'selected' : ''}>${t.templateName}</option>`).join('')}
              </select>
            </div>

            <div>
              <label class="block font-bold text-slate-800 mb-1">文章トーン</label>
              <select id="select-composer-tone" class="w-full bg-white border border-slate-300 font-medium rounded px-3 py-2 focus:outline-none">
                ${EMAIL_TONES.map(tn => `<option value="${tn.value}" ${tn.value === selectedTone ? 'selected' : ''}>${tn.label}</option>`).join('')}
              </select>
            </div>
          </div>

          <!-- 件名 & 本文プレビュー/手動編集 (手動編集保護対応) (指示書 13項) -->
          <div class="space-y-3">
            <div>
              <div class="flex items-center justify-between mb-1">
                <label class="font-bold text-slate-800">件名</label>
                <button type="button" id="btn-copy-subject" class="text-indigo-600 hover:text-indigo-800 font-bold text-[11px]">件名をコピー</button>
              </div>
              <input type="text" id="input-composer-subject" value="${generatedSubject}" class="w-full bg-slate-50 border border-slate-300 font-bold rounded px-3 py-2 focus:bg-white focus:outline-none">
            </div>

            <div>
              <div class="flex items-center justify-between mb-1">
                <label class="font-bold text-slate-800">本文 (手動修正可能)</label>
                <div class="flex items-center space-x-3">
                  <button type="button" id="btn-regenerate-body" class="text-indigo-600 hover:text-indigo-800 font-bold text-[11px]">自動生成文にリセット</button>
                  <button type="button" id="btn-copy-body" class="text-indigo-600 hover:text-indigo-800 font-bold text-[11px]">本文をコピー</button>
                </div>
              </div>
              <textarea id="textarea-composer-body" rows="11" class="w-full bg-slate-50 border border-slate-300 font-mono text-xs rounded p-3 focus:bg-white focus:outline-none leading-relaxed">${generatedBody}</textarea>
            </div>
          </div>

          <!-- 次回予定日設定 -->
          <div class="flex items-center justify-between bg-slate-50 p-3 rounded-lg border border-slate-200">
            <span class="font-bold text-slate-700">次回企業連絡予定日 (連絡後に自動設定):</span>
            <input type="date" id="input-composer-next-date" value="${new Date(Date.now() + 86400000 * 3).toISOString().split('T')[0]}" class="bg-white border border-slate-300 rounded px-2.5 py-1 text-xs">
          </div>
        </div>

        <div class="px-6 py-4 bg-slate-50 border-t border-slate-200 flex flex-wrap items-center justify-between gap-3">
          <button type="button" id="btn-copy-both" class="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-white font-bold rounded-lg text-xs transition flex items-center gap-1.5">
            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 5H6a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2v-1M8 5a2 2 0 002 2h2a2 2 0 002-2M8 5a2 2 0 012-2h2a2 2 0 012 2m0 0h2a2 2 0 012 2v3m2 4H10m0 0l3-3m-3 3l3 3"></path></svg>
            件名と本文をまとめてコピー
          </button>

          <div class="flex items-center space-x-3">
            <button type="button" id="btn-composer-cancel" class="px-4 py-2 bg-white border border-slate-300 text-slate-700 rounded-lg text-xs font-semibold">
              閉じる
            </button>
            <button type="button" id="btn-composer-mark-contacted" class="px-5 py-2 bg-emerald-600 hover:bg-emerald-500 text-white font-bold rounded-lg text-xs shadow transition">
              コピー＆連絡済みにする
            </button>
          </div>
        </div>
      </div>
    `;

    const bodyTextArea = modalEl.querySelector('#textarea-composer-body');

    // 手動編集イベントの監視 (指示書 13項)
    bodyTextArea?.addEventListener('input', () => {
      isManuallyEdited = true;
    });

    // モーダル閉じる
    modalEl.querySelector('#btn-composer-close')?.addEventListener('click', () => modalEl.remove());
    modalEl.querySelector('#btn-composer-cancel')?.addEventListener('click', () => modalEl.remove());

    // 候補者チェックボックス変更 (手動編集保護付き) (指示書 13項)
    modalEl.querySelectorAll('.chk-select-item').forEach(chk => {
      chk.addEventListener('change', () => {
        const id = chk.getAttribute('data-id');
        if (isManuallyEdited) {
          if (!confirm('現在編集している本文を再生成しますか？\n手動で編集した内容は上書きされます。')) {
            chk.checked = !chk.checked; // 元に戻す
            return;
          }
        }

        if (chk.checked) {
          if (!selectedSelectionIds.includes(id)) selectedSelectionIds.push(id);
        } else {
          selectedSelectionIds = selectedSelectionIds.filter(i => i !== id);
        }
        isManuallyEdited = false;
        renderModalContent();
      });
    });

    // テンプレート変更 (手動編集保護付き) (指示書 13項)
    modalEl.querySelector('#select-composer-template')?.addEventListener('change', (e) => {
      if (isManuallyEdited) {
        if (!confirm('現在編集している本文を再生成しますか？\n手動で編集した内容は上書きされます。')) {
          e.target.value = selectedTemplateId; // 元に戻す
          return;
        }
      }
      selectedTemplateId = e.target.value;
      isManuallyEdited = false;
      renderModalContent();
    });

    modalEl.querySelector('#select-composer-tone')?.addEventListener('change', (e) => {
      selectedTone = e.target.value;
      renderModalContent();
    });

    // 本文リセットボタン
    modalEl.querySelector('#btn-regenerate-body')?.addEventListener('click', () => {
      if (isManuallyEdited) {
        if (!confirm('手動で編集した内容を破棄し、自動生成文章に戻しますか？')) return;
      }
      isManuallyEdited = false;
      renderModalContent();
    });

    // コピー処理
    modalEl.querySelector('#btn-copy-subject')?.addEventListener('click', async () => {
      const subj = modalEl.querySelector('#input-composer-subject').value;
      if (await copyToClipboard(subj)) alert('件名をコピーしました');
    });

    modalEl.querySelector('#btn-copy-body')?.addEventListener('click', async () => {
      const body = modalEl.querySelector('#textarea-composer-body').value;
      if (await copyToClipboard(body)) alert('本文をコピーしました');
    });

    modalEl.querySelector('#btn-copy-both')?.addEventListener('click', async () => {
      const subj = modalEl.querySelector('#input-composer-subject').value;
      const body = modalEl.querySelector('#textarea-composer-body').value;
      const fullText = `件名: ${subj}\n\n${body}`;
      if (await copyToClipboard(fullText)) alert('件名と本文をまとめてコピーしました');
    });

    // コピー＆連絡済みにするアクション
    modalEl.querySelector('#btn-composer-mark-contacted')?.addEventListener('click', async () => {
      const subj = modalEl.querySelector('#input-composer-subject').value;
      const body = modalEl.querySelector('#textarea-composer-body').value;
      const nextDate = modalEl.querySelector('#input-composer-next-date').value;

      const fullText = `件名: ${subj}\n\n${body}`;
      await copyToClipboard(fullText);

      store.addCompanyCommunication({
        companyId,
        selectionIds: selectedSelectionIds,
        communicationType: '進捗確認メール作成',
        method: 'メール',
        templateId: selectedTemplateId,
        subject: subj,
        body: body,
        nextActionDate: nextDate || null,
        status: '連絡済み'
      });

      alert('メール文章をクリップボードにコピーし、連絡履歴を更新しました。');
      modalEl.remove();
      if (onClose) onClose();
    });
  }

  document.body.appendChild(modalEl);
  renderModalContent();
}
