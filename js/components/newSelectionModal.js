/**
 * 選考進捗・ヨミ管理システム - 新規選考案件登録モーダル (エントリー経路 ＆ パスアップ詳細必須バリデーション対応)
 */

import { store } from '../store.js';
import { PHASES, PROGRESS_STATUSES, YOMI_OPTIONS, INITIAL_YOMI_MAP, ENTRY_SOURCES } from '../constants.js';
import { getQuarterFromYearMonth } from '../utils/yomiCalculations.js';

export function openNewSelectionModal(onClose) {
  let modalEl = document.getElementById('new-selection-modal');
  if (modalEl) modalEl.remove();

  const candidates = store.getCandidates();
  const companies = store.getCompanies();
  const consultants = store.getConsultants();
  const caConsultants = store.getCaConsultants();
  const raConsultants = store.getRaConsultants();

  const consultantsMap = new Map(consultants.map(c => [c.consultantId, c]));

  modalEl = document.createElement('div');
  modalEl.id = 'new-selection-modal';
  modalEl.className = 'fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4 overflow-y-auto';

  const defaultMonth = new Date().toISOString().slice(0, 7);
  const defaultQInfo = getQuarterFromYearMonth(defaultMonth);

  modalEl.innerHTML = `
    <div class="bg-white rounded-2xl shadow-2xl border border-slate-200 w-full max-w-2xl max-h-[90vh] flex flex-col overflow-hidden animate-fadeIn text-xs">
      <!-- モーダルヘッダー -->
      <div class="px-6 py-4 bg-slate-900 text-white flex items-center justify-between border-b border-slate-800">
        <h3 class="text-base font-bold flex items-center gap-2">
          <svg class="w-5 h-5 text-indigo-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4"></path></svg>
          新規選考案件の登録 (管理単位: 候補者 × 企業 × 求人)
        </h3>
        <button id="btn-new-modal-close" class="text-slate-400 hover:text-white p-1">
          <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path></svg>
        </button>
      </div>

      <!-- フォームボディ -->
      <div class="p-6 overflow-y-auto space-y-4 flex-1">
        <form id="form-new-selection" class="space-y-4" onsubmit="return false;">
          <!-- 1. 候補者入力 (オートコンプリートサジェスト付き) -->
          <div class="relative">
            <label class="block font-bold text-slate-800 mb-1">候補者 <span class="text-rose-500">*</span></label>
            <input
              type="text"
              id="new-candidate-name"
              maxlength="100"
              placeholder="候補者名を入力してください"
              autocomplete="off"
              required
              class="w-full bg-slate-50 border border-slate-300 rounded px-3 py-2 font-bold text-slate-800 focus:outline-none focus:border-indigo-600 focus:bg-white"
            >
            <input type="hidden" id="selected-candidate-id" value="">

            <!-- 候補サジェストドロップダウン -->
            <div id="candidate-suggest-dropdown" class="hidden absolute left-0 right-0 top-full mt-1 bg-white border border-slate-200 rounded-lg shadow-xl z-30 max-h-52 overflow-y-auto divide-y divide-slate-100 text-xs"></div>
          </div>

          <!-- 2. 企業 & 求人 連動選択 -->
          <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label class="block font-bold text-slate-800 mb-1">企業 <span class="text-rose-500">*</span></label>
              <select id="new-company-id" required class="w-full bg-slate-50 border border-slate-300 rounded px-3 py-2 font-bold text-slate-800 focus:outline-none focus:border-indigo-600">
                <option value="">-- 企業を選択してください --</option>
                ${companies.map(c => `<option value="${c.companyId}">${c.name} (${c.rank})</option>`).join('')}
              </select>
            </div>

            <div>
              <label class="block font-bold text-slate-800 mb-1">求人・ポジション <span class="text-rose-500">*</span></label>
              <select id="new-job-id" required disabled class="w-full bg-slate-100 border border-slate-300 rounded px-3 py-2 font-medium text-slate-800 focus:outline-none focus:border-indigo-600">
                <option value="">-- 企業を選択すると求人が表示されます --</option>
              </select>
            </div>
          </div>

          <!-- 3. エントリー経路 ＆ パスアップ詳細 (指示書 8, 9, 11, 14項) -->
          <div class="grid grid-cols-1 sm:grid-cols-2 gap-4 bg-indigo-50/60 p-3.5 rounded-xl border border-indigo-100">
            <div>
              <label class="block font-bold text-slate-800 mb-1">エントリー経路 <span class="text-rose-500">*</span></label>
              <select id="new-entry-source" class="w-full bg-white border border-slate-300 font-bold text-indigo-900 rounded px-3 py-2 focus:outline-none focus:border-indigo-600">
                <option value="UNSET">-- 選択してください --</option>
                ${ENTRY_SOURCES.map(s => `<option value="${s.code}">${s.label}</option>`).join('')}
              </select>
            </div>

            <div id="container-entry-detail" class="hidden">
              <label id="label-entry-detail" class="block font-bold text-slate-800 mb-1">パスアップ詳細 <span class="text-rose-500">*</span></label>
              <input type="text" id="new-entry-detail" placeholder="例: 若山さんスカウト" class="w-full bg-white border border-slate-300 rounded px-3 py-2 font-bold text-slate-800 focus:outline-none focus:border-indigo-600">
            </div>
          </div>

          <!-- 4. CA / RA 担当コンサル設定 -->
          <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label class="block font-bold text-slate-800 mb-1">CA担当 (キャリアアドバイザー)</label>
              <select id="new-ca-id" class="w-full bg-slate-50 border border-slate-300 rounded px-3 py-1.5 focus:outline-none font-semibold text-slate-800">
                ${caConsultants.map(c => `<option value="${c.consultantId}">${c.name} (CA)</option>`).join('')}
              </select>
            </div>

            <div>
              <label class="block font-bold text-slate-800 mb-1">RA担当 (リクルーティングアドバイザー)</label>
              <select id="new-ra-id" class="w-full bg-slate-50 border border-slate-300 rounded px-3 py-1.5 focus:outline-none font-semibold text-slate-800">
                ${raConsultants.map(c => `<option value="${c.consultantId}">${c.name} (RA)</option>`).join('')}
              </select>
            </div>
          </div>

          <!-- 5. フェーズ・進行状態・ヨミ -->
          <div class="grid grid-cols-1 sm:grid-cols-3 gap-4 border-t border-slate-200 pt-4">
            <div>
              <label class="block font-bold text-slate-800 mb-1">選考フェーズ</label>
              <select id="new-phase" class="w-full bg-indigo-50 border border-indigo-200 text-indigo-900 rounded px-2.5 py-1.5 font-bold focus:outline-none">
                ${PHASES.map(p => `<option value="${p}">${p}</option>`).join('')}
              </select>
            </div>

            <div>
              <label class="block font-bold text-slate-800 mb-1">進行状態</label>
              <select id="new-status" class="w-full bg-slate-50 border border-slate-300 rounded px-2.5 py-1.5 focus:outline-none">
                ${PROGRESS_STATUSES.map(s => `<option value="${s}">${s}</option>`).join('')}
              </select>
            </div>

            <div>
              <label class="block font-bold text-slate-800 mb-1">ヨミ (内定承諾見込み)</label>
              <select id="new-yomi" class="w-full bg-indigo-50 border border-indigo-200 text-indigo-900 rounded px-2.5 py-1.5 font-bold focus:outline-none">
                ${YOMI_OPTIONS.map(y => `<option value="${y.value}" ${y.value === 0.25 ? 'selected' : ''}>${y.label} (${y.value * 100}%)</option>`).join('')}
              </select>
            </div>
          </div>

          <!-- 6. 推薦日・予定日 ＆ 完了見込み月 -->
          <div class="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div>
              <label class="block font-semibold text-slate-700 mb-1">推薦日</label>
              <input type="date" id="new-recommendation-date" value="${new Date().toISOString().split('T')[0]}" class="w-full bg-slate-50 border border-slate-300 rounded px-2.5 py-1.5 focus:outline-none">
            </div>

            <div>
              <label class="block font-semibold text-slate-700 mb-1">次回予定日</label>
              <input type="date" id="new-next-date" class="w-full bg-slate-50 border border-slate-300 rounded px-2.5 py-1.5 focus:outline-none">
            </div>

            <div>
              <div class="flex items-center justify-between mb-1">
                <label class="font-bold text-slate-800">完了見込み月</label>
                <span id="badge-q-forecast" class="text-[10px] font-extrabold bg-indigo-100 text-indigo-800 px-2 py-0.5 rounded border border-indigo-200">
                  ${defaultQInfo ? `着地見込みQ：${defaultQInfo.label}` : '着地見込みQ：未設定'}
                </span>
              </div>
              <input type="month" id="new-expected-completion-month" value="${defaultMonth}" class="w-full bg-slate-50 border border-slate-300 rounded px-2.5 py-1.5 font-bold text-slate-900 focus:outline-none">
            </div>
          </div>

          <div>
            <label class="block font-semibold text-slate-700 mb-1">社内メモ (他社状況・評価)</label>
            <textarea id="new-internal-memo" rows="2" placeholder="推薦時の所感・注意点など" class="w-full bg-slate-50 border border-slate-300 rounded p-2 focus:outline-none"></textarea>
          </div>
        </form>
      </div>

      <!-- モーダルフッター -->
      <div class="px-6 py-4 bg-slate-50 border-t border-slate-200 flex items-center justify-end space-x-3">
        <button type="button" id="btn-new-cancel" class="px-4 py-2 bg-white border border-slate-300 text-slate-700 rounded-lg text-xs font-semibold hover:bg-slate-100 transition">
          キャンセル
        </button>
        <button type="button" id="btn-new-submit" class="px-5 py-2 bg-indigo-600 hover:bg-indigo-500 text-white font-bold rounded-lg text-xs shadow transition">
          登録する
        </button>
      </div>
    </div>
  `;

  document.body.appendChild(modalEl);

  const candNameInput = modalEl.querySelector('#new-candidate-name');
  const candIdHidden = modalEl.querySelector('#selected-candidate-id');
  const suggestDropdown = modalEl.querySelector('#candidate-suggest-dropdown');
  const companySelect = modalEl.querySelector('#new-company-id');
  const jobSelect = modalEl.querySelector('#new-job-id');
  const entrySourceSelect = modalEl.querySelector('#new-entry-source');
  const entryDetailContainer = modalEl.querySelector('#container-entry-detail');
  const entryDetailLabel = modalEl.querySelector('#label-entry-detail');
  const entryDetailInput = modalEl.querySelector('#new-entry-detail');
  const caSelect = modalEl.querySelector('#new-ca-id');
  const raSelect = modalEl.querySelector('#new-ra-id');
  const phaseSelect = modalEl.querySelector('#new-phase');
  const yomiSelect = modalEl.querySelector('#new-yomi');
  const completionMonthInput = modalEl.querySelector('#new-expected-completion-month');
  const qBadge = modalEl.querySelector('#badge-q-forecast');

  // エントリー経路の動的制御 (指示書 9項)
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

  completionMonthInput?.addEventListener('change', (e) => {
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

  function hideSuggest() {
    suggestDropdown.classList.add('hidden');
    suggestDropdown.innerHTML = '';
  }

  function renderSuggestList(kw) {
    const trimmed = kw.trim().toLowerCase();
    if (!trimmed) {
      hideSuggest();
      return;
    }

    const allCands = store.getCandidates();
    const matched = allCands.filter(c => {
      if (c.isArchived) return false;
      const name = (c.name || '').toLowerCase();
      const kana = (c.kana || '').toLowerCase();
      return name.includes(trimmed) || kana.includes(trimmed);
    });

    let html = '';

    if (matched.length > 0) {
      html += matched.map(c => {
        const ca = consultantsMap.get(c.caId || c.caConsultantId);
        return `
          <div class="suggest-item p-2.5 hover:bg-indigo-50 cursor-pointer flex items-center justify-between transition" data-id="${c.candidateId}" data-name="${c.name}" data-ca-id="${c.caId || c.caConsultantId}">
            <div>
              <span class="font-bold text-slate-900">${c.name} 様</span>
              <span class="text-[10px] text-slate-400 block">${c.kana || ''}</span>
            </div>
            <span class="text-[10px] text-indigo-700 bg-indigo-50 px-2 py-0.5 rounded border border-indigo-200 font-medium">担当CA: ${ca ? ca.name : '未設定'}</span>
          </div>
        `;
      }).join('');
    }

    html += `
      <div class="suggest-item-new p-2.5 hover:bg-slate-100 cursor-pointer font-bold text-indigo-600 flex items-center justify-between bg-slate-50 transition" data-name="${kw.trim()}">
        <span>＋「${kw.trim()}」を新しい候補者として登録</span>
        <span class="text-[10px] text-slate-400">（新規マスタ自動作成）</span>
      </div>
    `;

    suggestDropdown.innerHTML = html;
    suggestDropdown.classList.remove('hidden');

    suggestDropdown.querySelectorAll('.suggest-item').forEach(item => {
      item.addEventListener('click', () => {
        const cId = item.getAttribute('data-id');
        const cName = item.getAttribute('data-name');
        const caId = item.getAttribute('data-ca-id');

        candNameInput.value = cName;
        candIdHidden.value = cId;
        if (caId && caSelect.querySelector(`option[value="${caId}"]`)) {
          caSelect.value = caId;
        }
        hideSuggest();
      });
    });

    suggestDropdown.querySelectorAll('.suggest-item-new').forEach(item => {
      item.addEventListener('click', () => {
        const newName = item.getAttribute('data-name');
        candNameInput.value = newName;
        candIdHidden.value = '';
        hideSuggest();
      });
    });
  }

  candNameInput.addEventListener('input', (e) => {
    candIdHidden.value = '';
    renderSuggestList(e.target.value);
  });

  candNameInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      hideSuggest();
    }
  });

  document.addEventListener('click', (e) => {
    if (!modalEl.contains(e.target)) return;
    if (!candNameInput.contains(e.target) && !suggestDropdown.contains(e.target)) {
      hideSuggest();
    }
  });

  companySelect?.addEventListener('change', (e) => {
    const compId = e.target.value;
    if (!compId) {
      jobSelect.disabled = true;
      jobSelect.innerHTML = '<option value="">-- 企業を選択してください --</option>';
      return;
    }

    const companyJobs = store.getJobs(false, compId);
    jobSelect.disabled = false;
    jobSelect.innerHTML = companyJobs.length === 0
      ? '<option value="">-- 登録求人がありません --</option>'
      : companyJobs.map(j => `<option value="${j.jobId}">${j.title || j.jobName} (${j.status || '募集中'})</option>`).join('');

    const comp = store.getCompanies().find(c => c.companyId === compId);
    if (comp && (comp.primaryRaId || comp.raConsultantId)) {
      const raId = comp.primaryRaId || comp.raConsultantId;
      if (raSelect.querySelector(`option[value="${raId}"]`)) {
        raSelect.value = raId;
      }
    }
  });

  phaseSelect?.addEventListener('change', (e) => {
    const suggested = INITIAL_YOMI_MAP[e.target.value];
    if (suggested !== undefined) {
      yomiSelect.value = String(suggested);
    }
  });

  function proceedRegistration(finalCandId, finalCandName) {
    const companyId = companySelect.value;
    const jobId = jobSelect.value;
    const entrySource = entrySourceSelect.value;
    const entryDetail = entryDetailInput.value.trim();

    const existingSel = store.getSelections().find(s => 
      s.candidateId === finalCandId && s.companyId === companyId && s.jobId === jobId
    );

    if (existingSel) {
      if (!confirm('同じ【候補者×企業×求人】の選考案件が既に登録されています。重複して登録しますか？')) {
        return;
      }
    }

    store.addSelection({
      candidateId: finalCandId,
      candidateName: finalCandName,
      companyId,
      jobId,
      caConsultantId: caSelect.value,
      caId: caSelect.value,
      raConsultantId: raSelect.value,
      raId: raSelect.value,
      entrySource,
      entrySourceDetail: entryDetail,
      phase: phaseSelect.value,
      progressStatus: modalEl.querySelector('#new-status').value,
      yomi: Number(yomiSelect.value),
      recommendationDate: modalEl.querySelector('#new-recommendation-date').value,
      nextScheduleDate: modalEl.querySelector('#new-next-date').value || null,
      expectedCompletionMonth: completionMonthInput.value || null,
      internalMemo: modalEl.querySelector('#new-internal-memo').value
    });

    modalEl.remove();
    if (onClose) onClose();
  }

  modalEl.querySelector('#btn-new-submit')?.addEventListener('click', () => {
    const rawCandName = candNameInput.value.trim();
    const selectedCandId = candIdHidden.value;
    const companyId = companySelect.value;
    const jobId = jobSelect.value;
    const entrySource = entrySourceSelect.value;
    const entryDetail = entryDetailInput.value.trim();

    if (!rawCandName) {
      alert('候補者名を入力してください。');
      candNameInput.focus();
      return;
    }

    if (!companyId || !jobId) {
      alert('企業および求人は必須選択項目です。');
      return;
    }

    // エントリー経路の必須・手入力バリデーション (指示書 9-2, 9-3項)
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

    const selectedCaId = caSelect.value;

    if (selectedCandId) {
      const existingCand = store.getCandidates().find(c => c.candidateId === selectedCandId);
      proceedRegistration(selectedCandId, existingCand ? existingCand.name : rawCandName);
      return;
    }

    const normalizedNew = rawCandName.replace(/\s+/g, '').toLowerCase();
    const similarCands = store.getCandidates().filter(c => {
      if (c.isArchived) return false;
      const normalizedExisting = (c.name || '').replace(/\s+/g, '').toLowerCase();
      return normalizedExisting === normalizedNew || normalizedExisting.includes(normalizedNew) || normalizedNew.includes(normalizedExisting);
    });

    if (similarCands.length > 0) {
      showSimilarWarningModal(rawCandName, similarCands, (actionChoice, chosenCand) => {
        if (actionChoice === 'use_existing') {
          proceedRegistration(chosenCand.candidateId, chosenCand.name);
        } else if (actionChoice === 'create_new') {
          const newCand = createNewCandidateMaster(rawCandName, selectedCaId);
          proceedRegistration(newCand.candidateId, newCand.name);
        }
      });
      return;
    }

    const newCand = createNewCandidateMaster(rawCandName, selectedCaId);
    proceedRegistration(newCand.candidateId, newCand.name);
  });

  function createNewCandidateMaster(name, caId) {
    const caCons = consultantsMap.get(caId);
    const newCand = {
      name: name,
      kana: name,
      caId: caId,
      caName: caCons ? caCons.name : '未設定',
      caConsultantId: caId,
      activityStatus: '選考中',
      internalManagementNumber: 'CD-' + new Date().getFullYear() + '-' + Math.floor(100 + Math.random() * 900),
      remarks: '選考案件登録時に自動作成された候補者'
    };
    store.saveCandidate(newCand);
    return store.getCandidates().find(c => c.name === name) || newCand;
  }

  modalEl.querySelector('#btn-new-modal-close')?.addEventListener('click', () => modalEl.remove());
  modalEl.querySelector('#btn-new-cancel')?.addEventListener('click', () => modalEl.remove());
}

function showSimilarWarningModal(inputName, similarCands, callback) {
  let warnEl = document.getElementById('similar-warning-modal');
  if (warnEl) warnEl.remove();

  warnEl = document.createElement('div');
  warnEl.id = 'similar-warning-modal';
  warnEl.className = 'fixed inset-0 z-50 bg-slate-900/70 backdrop-blur-sm flex items-center justify-center p-4';

  warnEl.innerHTML = `
    <div class="bg-white rounded-2xl shadow-2xl border border-amber-200 w-full max-w-md p-6 space-y-4 animate-fadeIn text-xs">
      <div class="flex items-center space-x-3 text-amber-600 border-b border-amber-100 pb-3">
        <svg class="w-6 h-6 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"></path></svg>
        <h4 class="font-bold text-sm text-slate-800">同名または類似する候補者の検出</h4>
      </div>

      <p class="text-slate-600 font-medium">
        入力した候補者名 <strong>「${inputName}」</strong> と同名、または非常に類似する候補者が既に登録されています。
      </p>

      <div class="bg-amber-50 p-3 rounded-lg border border-amber-200 space-y-2 max-h-36 overflow-y-auto">
        <span class="font-bold text-amber-900 block text-[11px]">検出された既存候補者:</span>
        ${similarCands.map(c => `
          <label class="flex items-center justify-between bg-white p-2 rounded border border-amber-200 cursor-pointer hover:bg-amber-100/50">
            <div class="flex items-center space-x-2">
              <input type="radio" name="chosen-similar-cand" value="${c.candidateId}" checked class="text-indigo-600">
              <span class="font-bold text-slate-800">${c.name} 様</span>
            </div>
            <span class="text-[10px] text-slate-500">担当CA: ${c.caName || '-'}</span>
          </label>
        `).join('')}
      </div>

      <div class="space-y-2 pt-2 border-t border-slate-200">
        <button id="btn-warn-use-existing" class="w-full py-2 bg-indigo-600 hover:bg-indigo-500 text-white font-bold rounded-lg shadow transition">
          選択した既存候補者を使用する
        </button>
        <button id="btn-warn-create-new" class="w-full py-2 bg-slate-800 hover:bg-slate-700 text-white font-bold rounded-lg transition">
          「${inputName}」を別の候補者として新規登録する
        </button>
        <button id="btn-warn-cancel" class="w-full py-1.5 bg-white border border-slate-300 text-slate-700 hover:bg-slate-100 rounded-lg font-semibold">
          入力へ戻る
        </button>
      </div>
    </div>
  `;

  document.body.appendChild(warnEl);

  warnEl.querySelector('#btn-warn-use-existing')?.addEventListener('click', () => {
    const selectedId = warnEl.querySelector('input[name="chosen-similar-cand"]:checked')?.value;
    const chosen = similarCands.find(c => c.candidateId === selectedId) || similarCands[0];
    warnEl.remove();
    callback('use_existing', chosen);
  });

  warnEl.querySelector('#btn-warn-create-new')?.addEventListener('click', () => {
    warnEl.remove();
    callback('create_new', null);
  });

  warnEl.querySelector('#btn-warn-cancel')?.addEventListener('click', () => {
    warnEl.remove();
    callback('cancel', null);
  });
}
