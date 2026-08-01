/**
 * 選考進捗・ヨミ管理システム - 選考案件詳細・編集モーダルコンポーネント (選考終了・内定辞退入力 & 直前フェーズ保存対応)
 */

import { store } from '../store.js';
import { PHASES, PROGRESS_STATUSES, YOMI_OPTIONS, END_REASONS, COMPANY_ACTION_TYPES, COMPANY_ACTION_STATUSES, ENTRY_SOURCES } from '../constants.js';
import { getQuarterFromYearMonth } from '../utils/yomiCalculations.js';

export function openSelectionDetailModal(selectionId, onClose) {
  let modalEl = document.getElementById('selection-detail-modal');
  if (modalEl) modalEl.remove();

  const selections = store.getSelections();
  const selection = selections.find(s => s.selectionId === selectionId);
  if (!selection) return;

  const candidates = store.getCandidates();
  const companies = store.getCompanies();
  const jobs = store.getJobs();
  const consultants = store.getConsultants();
  const histories = store.getHistories(selectionId);

  const cand = candidates.find(c => c.candidateId === selection.candidateId);
  const comp = companies.find(c => c.companyId === selection.companyId);
  const job = jobs.find(j => j.jobId === selection.jobId);
  const caCons = consultants.find(c => c.consultantId === (selection.caId || selection.caConsultantId));
  const raCons = consultants.find(c => c.consultantId === (selection.raId || selection.raConsultantId));

  const caConsultants = store.getCaConsultants();
  const raConsultants = store.getRaConsultants();

  modalEl = document.createElement('div');
  modalEl.id = 'selection-detail-modal';
  modalEl.className = 'fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4 overflow-y-auto';

  const defaultMonth = selection.expectedCompletionMonth || new Date().toISOString().slice(0, 7);
  const defaultQInfo = getQuarterFromYearMonth(defaultMonth);

  const currentEntrySource = selection.entrySource || 'UNSET';
  const isPassUp = currentEntrySource === 'PASS_UP';
  const isOther = currentEntrySource === 'OTHER';
  const isEnded = selection.phase === '選考終了' || selection.phase === '内定辞退';

  modalEl.innerHTML = `
    <div class="bg-white rounded-2xl shadow-2xl border border-slate-200 w-full max-w-3xl max-h-[90vh] flex flex-col overflow-hidden animate-fadeIn text-xs">
      <!-- モーダルヘッダー -->
      <div class="px-6 py-4 bg-slate-900 text-white flex items-center justify-between border-b border-slate-800">
        <div>
          <div class="flex items-center space-x-2">
            <span class="text-xs bg-indigo-500/30 text-indigo-300 px-2 py-0.5 rounded font-mono">ID: ${selection.selectionId}</span>
            <h3 class="text-base font-bold">${cand ? cand.name : selection.candidateName} 様 ／ ${comp ? comp.name : selection.companyName}</h3>
          </div>
          <p class="text-xs text-slate-400 mt-0.5">求人: ${job ? (job.title || job.jobName) : selection.jobName} (担当CA: ${caCons ? caCons.name : '未設定'} / 担当RA: ${raCons ? raCons.name : '未設定'})</p>
        </div>
        <button id="btn-detail-close" class="text-slate-400 hover:text-white p-1">
          <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path></svg>
        </button>
      </div>

      <!-- モーダルボディ -->
      <div class="p-6 overflow-y-auto space-y-6 flex-1">
        <form id="form-selection-detail" class="space-y-5" onsubmit="return false;">
          <!-- 1. フェーズ・進行状態・ヨミ設定 -->
          <div class="bg-indigo-50/50 p-4 rounded-xl border border-indigo-100 space-y-3">
            <h4 class="font-bold text-slate-800 text-xs flex items-center gap-1.5">
              <svg class="w-4 h-4 text-indigo-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>
              選考状況 ＆ ヨミの更新
            </h4>

            <div class="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <label class="block font-bold text-slate-700 mb-1">選考フェーズ</label>
                <select id="detail-phase" class="w-full bg-white border border-slate-300 font-bold text-indigo-900 rounded px-2.5 py-1.5 focus:outline-none">
                  ${PHASES.map(p => `<option value="${p}" ${selection.phase === p ? 'selected' : ''}>${p}</option>`).join('')}
                </select>
              </div>

              <div>
                <label class="block font-bold text-slate-700 mb-1">進行状態</label>
                <select id="detail-status" class="w-full bg-white border border-slate-300 font-medium text-slate-800 rounded px-2.5 py-1.5 focus:outline-none">
                  ${PROGRESS_STATUSES.map(s => `<option value="${s}" ${selection.progressStatus === s ? 'selected' : ''}>${s}</option>`).join('')}
                </select>
              </div>

              <div>
                <label class="block font-bold text-slate-700 mb-1">ヨミ (内定承諾確率)</label>
                <select id="detail-yomi" class="w-full bg-white border border-slate-300 font-bold text-indigo-900 rounded px-2.5 py-1.5 focus:outline-none">
                  ${YOMI_OPTIONS.map(y => `<option value="${y.value}" ${Number(selection.yomi) === y.value ? 'selected' : ''}>${y.label} (${y.value * 100}%)</option>`).join('')}
                </select>
              </div>
            </div>

            <!-- 選考終了・内定辞退入力エリア (指示書 19, 20項) -->
            <div id="detail-container-end-reason" class="p-3 bg-rose-50 rounded-lg border border-rose-200 space-y-2 ${isEnded ? '' : 'hidden'}">
              <div class="flex items-center justify-between">
                <label class="font-bold text-rose-900">終了理由 <span class="text-rose-600">*</span></label>
                <span id="detail-badge-decline-prev" class="text-[10px] font-bold text-slate-600">
                  ${selection.previousPhaseBeforeDecline ? `辞退前フェーズ: ${selection.previousPhaseBeforeDecline}` : ''}
                </span>
              </div>
              <div class="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <select id="detail-end-reason" class="w-full bg-white border border-rose-300 font-bold text-rose-900 rounded px-2.5 py-1.5 focus:outline-none">
                  <option value="">終了理由を選択...</option>
                  ${END_REASONS.map(r => `<option value="${r}" ${selection.endReason === r ? 'selected' : ''}>${r}</option>`).join('')}
                </select>
                <input type="text" id="detail-end-reason-detail" value="${selection.endReasonDetail || selection.declineReason || ''}" placeholder="詳細理由・辞退理由を入力..." class="w-full bg-white border border-rose-300 rounded px-2.5 py-1.5 text-slate-800 focus:outline-none">
              </div>
            </div>

            <!-- ヨミ設定理由 -->
            <div>
              <label class="block font-semibold text-slate-700 mb-1">ヨミ設定理由</label>
              <input type="text" id="detail-yomi-reason" value="${selection.yomiReason || ''}" placeholder="本人の志望度、面接評価などの根拠" class="w-full bg-white border border-slate-300 rounded px-3 py-1.5 focus:outline-none">
            </div>
          </div>

          <!-- 2. エントリー経路 ＆ パスアップ詳細 -->
          <div class="grid grid-cols-1 sm:grid-cols-2 gap-3 bg-indigo-50/60 p-3.5 rounded-xl border border-indigo-100">
            <div>
              <label class="block font-bold text-slate-800 mb-1">エントリー経路</label>
              <select id="detail-entry-source" class="w-full bg-white border border-slate-300 font-bold text-indigo-900 rounded px-2.5 py-1.5 focus:outline-none">
                <option value="UNSET">未設定</option>
                ${ENTRY_SOURCES.map(s => `<option value="${s.code}" ${currentEntrySource === s.code ? 'selected' : ''}>${s.label}</option>`).join('')}
              </select>
            </div>

            <div id="detail-container-entry-detail" class="${(isPassUp || isOther) ? '' : 'hidden'}">
              <label id="detail-label-entry-detail" class="block font-bold text-slate-800 mb-1">${isPassUp ? 'パスアップ詳細' : '経路詳細'} <span class="text-rose-500">*</span></label>
              <input type="text" id="detail-entry-detail" value="${selection.entrySourceDetail || ''}" placeholder="詳細を入力" class="w-full bg-white border border-slate-300 rounded px-2.5 py-1.5 font-bold text-slate-800 focus:outline-none">
            </div>
          </div>

          <!-- 3. スケジュール ＆ 完了見込み月 -->
          <div class="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <label class="block font-semibold text-slate-700 mb-1">推薦日</label>
              <input type="date" id="detail-recommendation-date" value="${selection.recommendationDate || ''}" class="w-full bg-slate-50 border border-slate-300 rounded px-2.5 py-1.5 focus:outline-none">
            </div>

            <div>
              <label class="block font-semibold text-slate-700 mb-1">次回予定日 (面接等)</label>
              <input type="date" id="detail-next-date" value="${selection.nextScheduleDate || ''}" class="w-full bg-slate-50 border border-slate-300 rounded px-2.5 py-1.5 focus:outline-none">
            </div>

            <div>
              <div class="flex items-center justify-between mb-1">
                <label class="font-bold text-slate-800">完了見込み月</label>
                <span id="detail-badge-q-forecast" class="text-[10px] font-extrabold bg-indigo-100 text-indigo-800 px-2 py-0.5 rounded border border-indigo-200">
                  ${defaultQInfo ? `着地見込みQ：${defaultQInfo.label}` : '着地見込みQ：未設定'}
                </span>
              </div>
              <input type="month" id="detail-expected-month" value="${selection.expectedCompletionMonth || ''}" class="w-full bg-slate-50 border border-slate-300 rounded px-2.5 py-1.5 font-bold text-slate-900 focus:outline-none">
            </div>
          </div>

          <!-- 4. CA/RA 担当コンサル設定 -->
          <div class="grid grid-cols-1 sm:grid-cols-2 gap-3 bg-slate-50 p-3 rounded-lg border border-slate-200">
            <div>
              <label class="block font-bold text-slate-700 mb-1">担当CA</label>
              <select id="detail-ca-id" class="w-full bg-white border border-slate-300 rounded px-2.5 py-1.5 font-bold text-indigo-700 focus:outline-none">
                ${caConsultants.map(c => `<option value="${c.consultantId}" ${(selection.caId || selection.caConsultantId) === c.consultantId ? 'selected' : ''}>${c.name} (CA)</option>`).join('')}
              </select>
            </div>

            <div>
              <label class="block font-bold text-slate-700 mb-1">担当RA</label>
              <select id="detail-ra-id" class="w-full bg-white border border-slate-300 rounded px-2.5 py-1.5 font-bold text-indigo-700 focus:outline-none">
                ${raConsultants.map(c => `<option value="${c.consultantId}" ${(selection.raId || selection.raConsultantId) === c.consultantId ? 'selected' : ''}>${c.name} (RA)</option>`).join('')}
              </select>
            </div>
          </div>

          <!-- 5. 企業対応・確認事項設定 -->
          <div class="bg-amber-50/40 p-4 rounded-xl border border-amber-100 space-y-3">
            <div class="flex items-center justify-between">
              <h4 class="font-bold text-slate-800 text-xs flex items-center gap-1.5">
                <svg class="w-4 h-4 text-amber-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4"></path></svg>
                企業向け確認・対応設定 (RA用)
              </h4>

              <div class="flex items-center space-x-2">
                <span id="detail-badge-action-source" class="text-[10px] font-bold px-2 py-0.5 rounded ${selection.companyActionSource === 'manual' ? 'bg-amber-100 text-amber-900 border border-amber-300' : 'bg-indigo-100 text-indigo-900 border border-indigo-200'}">
                  ${selection.companyActionSource === 'manual' ? '手動設定済み' : '選考状況から自動判定中'}
                </span>
                <button type="button" id="btn-reset-auto-action" class="px-2.5 py-1 bg-white hover:bg-indigo-600 hover:text-white text-indigo-700 text-[10px] font-bold rounded border border-indigo-300 shadow-2xs transition">
                  自動設定へ戻す
                </button>
              </div>
            </div>

            <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label class="block font-semibold text-slate-700 mb-1">企業対応区分</label>
                <select id="detail-company-action-type" class="w-full bg-white border border-slate-300 rounded px-2.5 py-1.5 font-bold text-indigo-800 focus:outline-none">
                  ${COMPANY_ACTION_TYPES.map(t => `<option value="${t}" ${selection.companyActionType === t ? 'selected' : ''}>${t}</option>`).join('')}
                </select>
              </div>

              <div>
                <label class="block font-semibold text-slate-700 mb-1">企業対応ステータス</label>
                <select id="detail-company-action-status" class="w-full bg-white border border-slate-300 rounded px-2.5 py-1.5 font-bold text-slate-800 focus:outline-none">
                  ${COMPANY_ACTION_STATUSES.map(st => `<option value="${st}" ${selection.companyActionStatus === st ? 'selected' : ''}>${st}</option>`).join('')}
                </select>
              </div>
            </div>

            <div>
              <label class="block font-semibold text-slate-700 mb-1">企業への確認事項</label>
              <input type="text" id="detail-company-check-item" value="${selection.companyConfirmationItem || selection.companyCheckItems || ''}" placeholder="合否確認、条件面談の日程など" class="w-full bg-white border border-slate-300 rounded px-3 py-1.5 focus:outline-none">
            </div>

            <div>
              <label class="block font-semibold text-slate-700 mb-1">企業共有コメント (進捗メール用)</label>
              <input type="text" id="detail-company-shared-comment" value="${selection.companySharedComment || ''}" placeholder="企業への連絡メール本文に記載するメモ" class="w-full bg-white border border-slate-300 rounded px-3 py-1.5 focus:outline-none">
            </div>
          </div>

          <!-- 6. 社内メモ -->
          <div>
            <label class="block font-semibold text-slate-700 mb-1">社内メモ (他社選考状況・辞退理由等)</label>
            <textarea id="detail-internal-memo" rows="2" class="w-full bg-slate-50 border border-slate-300 rounded p-2.5 focus:bg-white focus:outline-none leading-relaxed">${selection.internalMemo || ''}</textarea>
          </div>
        </form>

        <!-- 7. 変更履歴タイムライン -->
        <div class="border-t border-slate-200 pt-4 space-y-3">
          <h4 class="font-bold text-slate-800 text-xs flex items-center gap-1.5">
            <svg class="w-4 h-4 text-indigo-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>
            選考変更履歴タイムライン (${histories.length}件)
          </h4>

          <div class="bg-slate-50 rounded-xl border border-slate-200 p-3 max-h-40 overflow-y-auto space-y-2 font-mono text-[11px]">
            ${histories.length === 0 ? `
              <div class="text-slate-400 text-center py-2">変更履歴はありません。</div>
            ` : histories.map(h => `
              <div class="bg-white p-2 rounded border border-slate-200 shadow-2xs space-y-0.5">
                <div class="flex items-center justify-between text-slate-500 text-[10px]">
                  <span>${new Date(h.changedAt).toLocaleString('ja-JP')}</span>
                  <span class="font-bold text-slate-700">${h.changedBy}</span>
                </div>
                <div class="font-bold text-slate-800">
                  <span class="text-indigo-600">${h.fieldName}</span>: ${h.previousValue} → <span class="text-emerald-600">${h.newValue}</span>
                </div>
                ${h.comment ? `<div class="text-slate-600 text-[10px] italic">💬 ${h.comment}</div>` : ''}
              </div>
            `).join('')}
          </div>
        </div>
      </div>

      <!-- モーダルフッター -->
      <div class="px-6 py-4 bg-slate-50 border-t border-slate-200 flex items-center justify-between">
        <button type="button" id="btn-detail-archive" class="px-3.5 py-2 bg-rose-50 text-rose-700 hover:bg-rose-600 hover:text-white rounded-lg text-xs font-bold transition">
          アーカイブ化 (非表示化)
        </button>

        <div class="flex items-center space-x-3">
          <button type="button" id="btn-detail-cancel" class="px-4 py-2 bg-white border border-slate-300 text-slate-700 rounded-lg text-xs font-semibold hover:bg-slate-100 transition">
            キャンセル
          </button>
          <button type="button" id="btn-detail-save" class="px-5 py-2 bg-indigo-600 hover:bg-indigo-500 text-white font-bold rounded-lg text-xs shadow transition">
            変更を保存する
          </button>
        </div>
      </div>
    </div>
  `;

  document.body.appendChild(modalEl);

  const phaseSelect = modalEl.querySelector('#detail-phase');
  const yomiSelect = modalEl.querySelector('#detail-yomi');
  const endReasonContainer = modalEl.querySelector('#detail-container-end-reason');
  const endReasonSelect = modalEl.querySelector('#detail-end-reason');

  const entrySourceSelect = modalEl.querySelector('#detail-entry-source');
  const entryDetailContainer = modalEl.querySelector('#detail-container-entry-detail');
  const entryDetailLabel = modalEl.querySelector('#detail-label-entry-detail');
  const entryDetailInput = modalEl.querySelector('#detail-entry-detail');
  const monthInput = modalEl.querySelector('#detail-expected-month');
  const qBadge = modalEl.querySelector('#detail-badge-q-forecast');

  // フェーズ変更時の終了理由表示制御 ＆ ヨミ自動0リセット (指示書 17, 19, 20項)
  phaseSelect?.addEventListener('change', (e) => {
    const val = e.target.value;
    if (val === '選考終了' || val === '内定辞退') {
      endReasonContainer.classList.remove('hidden');
      yomiSelect.value = '0';
      if (val === '内定辞退' && !endReasonSelect.value) {
        endReasonSelect.value = '内定辞退';
      }
    } else {
      endReasonContainer.classList.add('hidden');
    }
  });

  entrySourceSelect?.addEventListener('change', (e) => {
    const val = e.target.value;
    if (val === 'PASS_UP') {
      entryDetailLabel.innerHTML = 'パスアップ詳細 <span class="text-rose-500">*</span>';
      entryDetailInput.placeholder = '例: 若山さんスカウト、自動スカウト';
      entryDetailContainer.classList.remove('hidden');
    } else if (val === 'OTHER') {
      entryDetailLabel.innerHTML = '経路詳細 <span class="text-rose-500">*</span>';
      entryDetailInput.placeholder = 'エントリー経路の詳細を入力してください';
      entryDetailContainer.classList.remove('hidden');
    } else {
      entryDetailContainer.classList.add('hidden');
      entryDetailInput.value = '';
    }
  });

  monthInput?.addEventListener('change', (e) => {
    const val = e.target.value;
    const qInfo = getQuarterFromYearMonth(val);
    if (qInfo) {
      qBadge.textContent = `着地見込みQ：${qInfo.label}`;
      qBadge.className = 'text-[10px] font-extrabold bg-indigo-100 text-indigo-800 px-2 py-0.5 rounded border border-indigo-200';
    } else {
      qBadge.textContent = '着地見込みQ：未設定';
      qBadge.className = 'text-[10px] font-bold bg-amber-100 text-amber-800 px-2 py-0.5 rounded border border-amber-200';
    }
  });

  let actionSourceState = selection.companyActionSource || 'auto';

  // 「自動設定へ戻す」ボタンイベント (指示書 24項)
  modalEl.querySelector('#btn-reset-auto-action')?.addEventListener('click', () => {
    if (confirm('現在の手動設定を解除し、選考フェーズ・進行状態に基づく自動設定へ戻しますか？')) {
      const p = phaseSelect.value;
      const st = modalEl.querySelector('#detail-status').value;
      const derived = store.getItem('selection_app_selections') ? import('../utils/kanbanCalculations.js').then(m => {
        const d = m.deriveCompanyActionFromSelection({ phase: p, progressStatus: st });
        modalEl.querySelector('#detail-company-action-type').value = d.companyActionType;
        modalEl.querySelector('#detail-company-action-status').value = d.companyActionStatus;
        modalEl.querySelector('#detail-company-check-item').value = d.companyConfirmationItem;
        actionSourceState = 'auto';

        const badge = modalEl.querySelector('#detail-badge-action-source');
        if (badge) {
          badge.textContent = '選考状況から自動判定中';
          badge.className = 'text-[10px] font-bold px-2 py-0.5 rounded bg-indigo-100 text-indigo-900 border border-indigo-200';
        }
      }) : null;
    }
  });

  // RA手動変更の検出 (指示書 8項)
  ['#detail-company-action-type', '#detail-company-action-status', '#detail-company-check-item'].forEach(selector => {
    modalEl.querySelector(selector)?.addEventListener('change', () => {
      actionSourceState = 'manual';
      const badge = modalEl.querySelector('#detail-badge-action-source');
      if (badge) {
        badge.textContent = '手動設定済み';
        badge.className = 'text-[10px] font-bold px-2 py-0.5 rounded bg-amber-100 text-amber-900 border border-amber-300';
      }
    });
  });

  // 保存処理 (指示書 10, 12, 16, 22項)
  modalEl.querySelector('#btn-detail-save')?.addEventListener('click', () => {
    const newPhase = phaseSelect.value;
    const newStatus = modalEl.querySelector('#detail-status').value;
    const newYomi = Number(yomiSelect.value);
    const entrySource = entrySourceSelect.value;
    const entryDetail = entryDetailInput.value.trim();
    const endReason = endReasonSelect.value;
    const endReasonDetail = modalEl.querySelector('#detail-end-reason-detail').value.trim();

    if (entrySource === 'PASS_UP' && !entryDetail) {
      alert('パスアップの詳細を入力してください。');
      entryDetailInput.focus();
      return;
    }
    if (entrySource === 'OTHER' && !entryDetail) {
      alert('経路詳細を入力してください。');
      entryDetailInput.focus();
      return;
    }

    if ((newPhase === '選考終了' || newPhase === '内定辞退') && !endReason) {
      alert('選考終了理由または辞退理由を選択してください。');
      endReasonSelect.focus();
      return;
    }

    // 内定辞退変更時のダイアログ確認 ＆ 直前フェーズ保存 (指示書 15, 20項)
    let previousPhaseBeforeDecline = selection.previousPhaseBeforeDecline || null;
    let declinedAfterAcceptance = selection.declinedAfterAcceptance || false;

    if (newPhase === '内定辞退') {
      if (selection.phase !== '内定辞退') {
        if (!confirm(`この選考案件を「内定辞退」に変更しますか？\n\n・選考一覧・CA・RA・企業対応リストから非表示になります。\n・ホワイトボードにはグレーアウトして残ります。`)) {
          return;
        }
        previousPhaseBeforeDecline = selection.phase;
        if (selection.phase === '内定承諾') {
          declinedAfterAcceptance = true;
        }
      }
    } else if (newPhase === '選考終了') {
      if (selection.phase !== '選考終了') {
        if (!confirm(`この選考案件を選考終了にしますか？\n\n・選考一覧・CA・RA・企業対応リスト・ホワイトボードから非表示になります。\n・データと履歴は保存されます。`)) {
          return;
        }
      }
    }

    if (newPhase === '内定承諾' || newPhase === '入社予定') {
      const candSelections = store.getSelections().filter(s => s.candidateId === selection.candidateId && s.selectionId !== selection.selectionId && s.phase !== '選考終了' && s.phase !== '内定辞退');
      if (candSelections.length > 0) {
        const choice = confirm(`候補者「${cand ? cand.name : selection.candidateName}」が「${comp ? comp.name : selection.companyName}」で内定承諾となりました。\n現在併願進行中の他社選考案件（全${candSelections.length}件）を「選考終了（他社内定辞退）」に連動変更しますか？\n\n【OK】: 他社案件を一括辞退にする\n【キャンセル】: この案件のみ変更する`);
        if (choice) {
          store.declineOtherSelectionsForCandidate(selection.candidateId, selection.selectionId, `「${comp ? comp.name : selection.companyName}」での内定承諾に伴う自動辞退`);
        }
      }
    }

    const caId = modalEl.querySelector('#detail-ca-id').value;
    const raId = modalEl.querySelector('#detail-ra-id').value;
    const caConsObj = consultants.find(c => c.consultantId === caId);
    const raConsObj = consultants.find(c => c.consultantId === raId);

    // 手動設定保護オプションの判定 (指示書 10, 12, 16項)
    let saveOptions = { forceAuto: false, appendItem: false };
    const isPhaseOrStatusChanged = (newPhase !== selection.phase || newStatus !== selection.progressStatus);

    if (isPhaseOrStatusChanged && actionSourceState === 'manual') {
      const optChoice = prompt(
        `【手動設定の企業対応項目があります】\n選考フェーズ・進行状態の変更に伴い、企業対応項目をどのように保存しますか？\n\n1: 現在の手動設定を維持する (推奨)\n2: 新しいフェーズの自動候補へ更新する\n3: 現在の確認事項に自動候補を追記する\n\n(1〜3 の番号を入力してください):`,
        '1'
      );

      if (optChoice === '2') {
        saveOptions.forceAuto = true;
        actionSourceState = 'auto';
      } else if (optChoice === '3') {
        saveOptions.forceAuto = true;
        saveOptions.appendItem = true;
        actionSourceState = 'auto';
      }
    }

    store.updateSelection(selectionId, {
      phase: newPhase,
      progressStatus: newStatus,
      yomi: (newPhase === '選考終了' || newPhase === '内定辞退') ? 0 : newYomi,
      endReason: endReason || null,
      endReasonDetail: endReasonDetail || null,
      declineReason: newPhase === '内定辞退' ? endReasonDetail : selection.declineReason,
      previousPhaseBeforeDecline,
      declinedAfterAcceptance,
      yomiReason: modalEl.querySelector('#detail-yomi-reason').value,
      entrySource,
      entrySourceDetail: entryDetail,
      recommendationDate: modalEl.querySelector('#detail-recommendation-date').value,
      nextScheduleDate: modalEl.querySelector('#detail-next-date').value || null,
      expectedCompletionMonth: monthInput.value || null,
      caId: caId,
      caConsultantId: caId,
      caName: caConsObj ? caConsObj.name : selection.caName,
      raId: raId,
      raConsultantId: raId,
      raName: raConsObj ? raConsObj.name : selection.raName,
      companyActionType: modalEl.querySelector('#detail-company-action-type').value,
      companyActionStatus: modalEl.querySelector('#detail-company-action-status').value,
      companyConfirmationItem: modalEl.querySelector('#detail-company-check-item').value,
      companySharedComment: modalEl.querySelector('#detail-company-shared-comment').value,
      internalMemo: modalEl.querySelector('#detail-internal-memo').value,
      companyActionSource: actionSourceState
    }, '詳細モーダルからの保存', saveOptions);

    modalEl.remove();
    if (onClose) onClose();
  });

  modalEl.querySelector('#btn-detail-archive')?.addEventListener('click', () => {
    if (confirm('この選考案件をアーカイブ（非表示化）にしますか？')) {
      store.archiveSelection(selectionId);
      modalEl.remove();
      if (onClose) onClose();
    }
  });

  modalEl.querySelector('#btn-detail-close')?.addEventListener('click', () => modalEl.remove());
  modalEl.querySelector('#btn-detail-cancel')?.addEventListener('click', () => modalEl.remove());
}
