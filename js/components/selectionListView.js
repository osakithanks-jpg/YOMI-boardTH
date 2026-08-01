/**
 * 選考進捗・ヨミ管理システム - 選考案件一覧画面コンポーネント (デフォルト並び順: フェーズが進んでいる順 & 状態永続保持対応)
 */

import { store } from '../store.js';
import { PHASES, PROGRESS_STATUSES, COMPANY_RANKS, ENTRY_SOURCES, END_REASONS, normalizeSelectionPhaseAndReason } from '../constants.js';
import { getSelectionAlerts, calculateCandidateYomiTotals, calculateUniqueCandidatesCount } from '../utils/yomiCalculations.js';
import { sortSelections } from '../utils/sortUtils.js';

const SELECTION_LIST_STORAGE_KEY = 'selection_list_active_state';

function getSavedListState() {
  try {
    const raw = sessionStorage.getItem(SELECTION_LIST_STORAGE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch (e) {
    return {};
  }
}

function saveListState(state) {
  try {
    const current = getSavedListState();
    sessionStorage.setItem(SELECTION_LIST_STORAGE_KEY, JSON.stringify({ ...current, ...state }));
  } catch (e) {}
}

export function renderSelectionList(container, options = {}, callbacks = {}) {
  let initialFilter = {};
  let onOpenDetail = null;
  let onOpenNewModal = null;

  if (typeof options === 'object' && (options.onOpenDetail || options.onOpenNewModal)) {
    onOpenDetail = options.onOpenDetail;
    onOpenNewModal = options.onOpenNewModal;
    initialFilter = options.initialFilter || {};
  } else {
    initialFilter = options || {};
    if (typeof callbacks === 'object') {
      onOpenDetail = callbacks.onOpenDetail;
      onOpenNewModal = callbacks.onOpenNewModal;
    }
  }

  const savedState = getSavedListState();

  let viewMode = savedState.viewMode || initialFilter.viewMode || 'activeOnly'; // activeOnly (既定) | includeEnded | endedOnly
  let selectedEndReason = savedState.selectedEndReason !== undefined ? savedState.selectedEndReason : (initialFilter.endReason || '');
  let sortBy = savedState.sortBy || 'phase_desc'; // フェーズが進んでいる順 (デフォルト既定) (指示書 1, 4項)

  let searchKeyword = savedState.searchKeyword !== undefined ? savedState.searchKeyword : (initialFilter.keyword || '');
  let selectedPhase = savedState.selectedPhase !== undefined ? savedState.selectedPhase : (initialFilter.phase || '');
  let selectedStatus = savedState.selectedStatus !== undefined ? savedState.selectedStatus : (initialFilter.status || '');
  let selectedCaId = savedState.selectedCaId !== undefined ? savedState.selectedCaId : (initialFilter.caId || '');
  let selectedRaId = savedState.selectedRaId !== undefined ? savedState.selectedRaId : (initialFilter.raId || '');
  let selectedCompanyRank = savedState.selectedCompanyRank !== undefined ? savedState.selectedCompanyRank : (initialFilter.rank || '');
  let selectedEntrySource = savedState.selectedEntrySource !== undefined ? savedState.selectedEntrySource : (initialFilter.entrySource || '');

  function updateView(preserveScroll = true) {
    const savedScrollY = preserveScroll ? (window.scrollY || document.documentElement.scrollTop) : 0;

    const rawSelections = store.getSelections();
    const candidates = store.getCandidates();
    const companies = store.getCompanies();
    const jobs = store.getJobs();
    const consultants = store.getConsultants();

    const companiesMap = new Map(companies.map(c => [c.companyId, c]));
    const candidatesMap = new Map(candidates.map(c => [c.candidateId, c]));
    const jobsMap = new Map(jobs.map(j => [j.jobId, j]));
    const consultantsMap = new Map(consultants.map(c => [c.consultantId, c]));

    // 互換読み替えを行った選考データ
    const selections = rawSelections.map(s => {
      const norm = normalizeSelectionPhaseAndReason(s);
      return { ...s, phase: norm.phase, progressStatus: norm.progressStatus, endReason: norm.endReason || s.endReason };
    });

    // 1. フィルタリング処理 (指示書 2, 4, 8項)
    const filteredSelections = selections.filter(s => {
      if (s.isArchived) return false;

      const isEnded = s.phase === '選考終了' || s.phase === '内定辞退';

      if (viewMode === 'activeOnly' && isEnded) return false;
      if (viewMode === 'endedOnly' && !isEnded) return false;

      if ((viewMode === 'includeEnded' || viewMode === 'endedOnly') && selectedEndReason) {
        if (selectedEndReason === '内定辞退') {
          if (s.phase !== '内定辞退' && s.endReason !== '内定辞退') return false;
        } else {
          if (s.endReason !== selectedEndReason) return false;
        }
      }

      const cand = candidatesMap.get(s.candidateId);
      const comp = companiesMap.get(s.companyId);
      const job = jobsMap.get(s.jobId);

      const candName = cand ? cand.name : s.candidateName || '';
      const compName = comp ? comp.name : s.companyName || '';
      const jobTitle = job ? (job.title || job.jobName) : s.jobName || '';

      if (searchKeyword) {
        const kw = searchKeyword.toLowerCase();
        const matchName = candName.toLowerCase().includes(kw);
        const matchComp = compName.toLowerCase().includes(kw);
        const matchJob = jobTitle.toLowerCase().includes(kw);
        const matchMemo = (s.internalMemo || '').toLowerCase().includes(kw);
        const matchDetail = (s.entrySourceDetail || '').toLowerCase().includes(kw);

        if (!matchName && !matchComp && !matchJob && !matchMemo && !matchDetail) return false;
      }

      if (selectedPhase && s.phase !== selectedPhase) return false;
      if (selectedStatus && s.progressStatus !== selectedStatus) return false;
      if (selectedCaId && (s.caId !== selectedCaId && s.caConsultantId !== selectedCaId)) return false;
      if (selectedRaId && (s.raId !== selectedRaId && s.raConsultantId !== selectedRaId)) return false;
      if (selectedCompanyRank && comp && comp.rank !== selectedCompanyRank) return false;

      if (selectedEntrySource) {
        if (selectedEntrySource === 'UNSET') {
          if (s.entrySource && s.entrySource !== 'UNSET') return false;
        } else {
          if (s.entrySource !== selectedEntrySource) return false;
        }
      }

      return true;
    });

    // 2. ソート処理 (指定どおりのデフォルト並び順: フェーズが進んでいる順) (指示書 1, 3, 4, 5項)
    const sortedSelections = sortSelections(filteredSelections, sortBy);

    const activeCount = sortedSelections.length;
    const uniquePeopleCount = calculateUniqueCandidatesCount(sortedSelections, viewMode !== 'activeOnly');

    // 状態の永続保存 (指示書 7項)
    saveListState({
      viewMode,
      selectedEndReason,
      sortBy,
      searchKeyword,
      selectedPhase,
      selectedStatus,
      selectedCaId,
      selectedRaId,
      selectedCompanyRank,
      selectedEntrySource,
      scrollTop: savedScrollY
    });

    container.innerHTML = `
      <div class="space-y-6">
        <!-- ヘッダー見出し -->
        <div class="bg-white p-5 rounded-xl border border-slate-200 shadow-sm flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <div class="flex items-center space-x-3">
              <h2 class="text-xl font-bold text-slate-800">選考案件一覧</h2>
              <span class="px-2.5 py-0.5 bg-indigo-100 text-indigo-800 font-extrabold rounded-full text-xs border border-indigo-200">
                ${activeCount} 案件 ／ ${uniquePeopleCount} 名
              </span>
            </div>
            <p class="text-xs text-slate-500 mt-1">※初期表示順：選考フェーズが進んでいる順 (内定 ➔ 条件提示 ➔ 最終 ➔ 二次 ➔ 一次 ➔ 書類)</p>
          </div>

          <!-- 表示対象モード切り替え (指示書 8項) -->
          <div class="flex items-center space-x-1 bg-slate-100 p-1 rounded-lg text-xs font-bold">
            <button id="btn-view-active" class="px-3 py-1.5 rounded-md transition ${viewMode === 'activeOnly' ? 'bg-indigo-600 text-white shadow' : 'text-slate-600 hover:text-slate-900'}">
              進行中のみ (既定)
            </button>
            <button id="btn-view-all" class="px-3 py-1.5 rounded-md transition ${viewMode === 'includeEnded' ? 'bg-indigo-600 text-white shadow' : 'text-slate-600 hover:text-slate-900'}">
              終了案件を含む
            </button>
            <button id="btn-view-ended" class="px-3 py-1.5 rounded-md transition ${viewMode === 'endedOnly' ? 'bg-indigo-600 text-white shadow' : 'text-slate-600 hover:text-slate-900'}">
              終了案件のみ
            </button>
          </div>
        </div>

        <!-- 検索・絞り込み ＆ 並び替えコントロールパネル (指示書 4項) -->
        <div class="bg-white p-4 rounded-xl border border-slate-200 shadow-sm space-y-3 text-xs">
          <div class="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 lg:grid-cols-8 gap-3">
            <!-- キーワード -->
            <div class="lg:col-span-2">
              <label class="block text-slate-600 font-bold mb-1">キーワード検索</label>
              <input type="text" id="filter-keyword" value="${searchKeyword}" placeholder="候補者名、企業名、求人名..." class="w-full bg-slate-50 border border-slate-300 rounded px-3 py-1.5 focus:bg-white focus:outline-none">
            </div>

            <!-- 並び替え (既定: フェーズが進んでいる順) (指示書 4項) -->
            <div class="lg:col-span-2">
              <label class="block text-indigo-900 font-bold mb-1 flex items-center gap-1">
                <svg class="w-3.5 h-3.5 text-indigo-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 4h13M3 8h9m-9 4h6m4 0l4-4m0 0l4 4m-4-4v12"></path></svg>
                並び替え
              </label>
              <select id="select-sort-by" class="w-full bg-indigo-50 border border-indigo-200 font-bold text-indigo-900 rounded px-2.5 py-1.5 focus:outline-none">
                <option value="phase_desc" ${sortBy === 'phase_desc' ? 'selected' : ''}>フェーズが進んでいる順 (既定)</option>
                <option value="nextDate_asc" ${sortBy === 'nextDate_asc' ? 'selected' : ''}>次回予定日が近い順</option>
                <option value="updated_desc" ${sortBy === 'updated_desc' ? 'selected' : ''}>最終更新日が新しい順</option>
                <option value="yomi_desc" ${sortBy === 'yomi_desc' ? 'selected' : ''}>ヨミが高い順</option>
                <option value="candName_asc" ${sortBy === 'candName_asc' ? 'selected' : ''}>候補者名五十音順</option>
              </select>
            </div>

            <!-- 選考フェーズ -->
            <div>
              <label class="block text-slate-600 font-bold mb-1">選考フェーズ</label>
              <select id="filter-phase" class="w-full bg-slate-50 border border-slate-300 rounded px-2.5 py-1.5 font-bold text-slate-800 focus:outline-none">
                <option value="">すべてのフェーズ</option>
                ${PHASES.map(p => `<option value="${p}" ${selectedPhase === p ? 'selected' : ''}>${p}</option>`).join('')}
              </select>
            </div>

            <!-- 終了理由フィルター -->
            ${viewMode !== 'activeOnly' ? `
              <div>
                <label class="block text-rose-800 font-bold mb-1">終了理由</label>
                <select id="filter-end-reason" class="w-full bg-rose-50 border border-rose-200 text-rose-900 font-bold rounded px-2.5 py-1.5 focus:outline-none">
                  <option value="">すべての理由</option>
                  ${END_REASONS.map(r => `<option value="${r}" ${selectedEndReason === r ? 'selected' : ''}>${r}</option>`).join('')}
                </select>
              </div>
            ` : ''}

            <!-- エントリー経路 -->
            <div>
              <label class="block text-indigo-700 font-bold mb-1">エントリー経路</label>
              <select id="filter-entry-source" class="w-full bg-indigo-50 border border-indigo-200 text-indigo-900 font-bold rounded px-2.5 py-1.5 focus:outline-none">
                <option value="">すべての経路</option>
                ${ENTRY_SOURCES.map(s => `<option value="${s.code}" ${selectedEntrySource === s.code ? 'selected' : ''}>${s.label}</option>`).join('')}
                <option value="UNSET" ${selectedEntrySource === 'UNSET' ? 'selected' : ''}>未設定</option>
              </select>
            </div>

            <!-- 担当CA -->
            <div>
              <label class="block text-slate-600 font-bold mb-1">担当CA</label>
              <select id="filter-ca" class="w-full bg-slate-50 border border-slate-300 rounded px-2.5 py-1.5 focus:outline-none">
                <option value="">すべてのCA</option>
                ${consultants.map(c => `<option value="${c.consultantId}" ${selectedCaId === c.consultantId ? 'selected' : ''}>${c.name} (${c.roleType || 'CA'})</option>`).join('')}
              </select>
            </div>
          </div>
        </div>

        <!-- 案件一覧テーブル -->
        <div class="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden space-y-3">
          <div class="overflow-x-auto">
            <table class="w-full text-left text-xs">
              <thead class="bg-slate-900 text-slate-200 font-semibold border-b border-slate-800">
                <tr>
                  <th class="px-4 py-3">候補者名 (担当CA)</th>
                  <th class="px-4 py-3">企業名 (ランク/担当RA)</th>
                  <th class="px-4 py-3">求人・ポジション</th>
                  <th class="px-3 py-3">経路</th>
                  <th class="px-3 py-3">選考フェーズ</th>
                  <th class="px-3 py-3">進行状態 / 理由</th>
                  <th class="px-3 py-3 text-right">ヨミ</th>
                  <th class="px-3 py-3">次回予定日</th>
                  <th class="px-3 py-3 text-center">操作</th>
                </tr>
              </thead>
              <tbody class="divide-y divide-slate-200">
                ${sortedSelections.length === 0 ? `
                  <tr><td colspan="9" class="text-center py-12 text-slate-400">条件に該当する選考案件がありません。</td></tr>
                ` : sortedSelections.map(s => {
                  const isEnded = s.phase === '選考終了' || s.phase === '内定辞退';
                  const cand = candidatesMap.get(s.candidateId);
                  const comp = companiesMap.get(s.companyId);
                  const job = jobsMap.get(s.jobId);
                  const caCons = consultantsMap.get(s.caId || s.caConsultantId);
                  const raCons = consultantsMap.get(s.raId || s.raConsultantId);

                  const entryObj = ENTRY_SOURCES.find(es => es.code === s.entrySource);
                  const entryLabel = entryObj ? entryObj.label : '未設定';

                  return `
                    <tr class="${isEnded ? 'bg-slate-100/70 text-slate-500' : 'hover:bg-slate-50'} transition">
                      <td class="px-4 py-3 font-bold text-slate-900">
                        <div class="${isEnded ? 'line-through text-slate-500' : ''}">${cand ? cand.name : s.candidateName} 様</div>
                        <div class="text-[10px] text-indigo-700 font-semibold">CA: ${caCons ? caCons.name : '-'}</div>
                      </td>
                      <td class="px-4 py-3 font-medium text-slate-800">
                        <div class="flex items-center gap-1">
                          <span>${comp ? comp.name : s.companyName}</span>
                          ${comp ? `<span class="px-1.5 py-0.2 text-[9px] font-extrabold rounded bg-amber-100 text-amber-800">${comp.rank}</span>` : ''}
                        </div>
                        <div class="text-[10px] text-slate-500">RA: ${raCons ? raCons.name : '-'}</div>
                      </td>
                      <td class="px-4 py-3 text-slate-700 font-medium">${job ? (job.title || job.jobName) : s.jobName}</td>

                      <td class="px-3 py-3">
                        <span class="px-2 py-0.5 rounded text-[10px] font-bold ${s.entrySource === 'PASS_UP' ? 'bg-purple-100 text-purple-800 border border-purple-200' : 'bg-slate-100 text-slate-700'}">
                          ${entryLabel}
                        </span>
                      </td>

                      <td class="px-3 py-3 font-bold">
                        ${s.phase === '内定辞退' ? `
                          <span class="px-2 py-0.5 bg-slate-500 text-white rounded text-[10px] font-extrabold">内定辞退</span>
                        ` : (s.phase === '選考終了' ? `
                          <span class="px-2 py-0.5 bg-slate-300 text-slate-800 rounded text-[10px] font-bold">選考終了</span>
                        ` : `
                          <span class="text-indigo-700">${s.phase}</span>
                        `)}
                      </td>

                      <td class="px-3 py-3 font-semibold">
                        <div>${s.progressStatus}</div>
                        ${s.endReason ? `<div class="text-[10px] text-rose-700 font-bold">${s.endReason}</div>` : ''}
                      </td>

                      <td class="px-3 py-3 text-right font-black ${isEnded ? 'text-slate-400' : 'text-indigo-600'}">
                        ${isEnded ? '0%' : (s.yomi * 100 + '%')}
                      </td>
                      <td class="px-3 py-3 text-slate-600 font-mono">${s.nextScheduleDate || '-'}</td>

                      <td class="px-3 py-3 text-center">
                        <button type="button" class="btn-detail px-2.5 py-1 bg-slate-100 hover:bg-indigo-600 hover:text-white text-slate-800 rounded text-xs font-bold transition cursor-pointer" data-id="${s.selectionId}">
                          詳細
                        </button>
                      </td>
                    </tr>
                  `;
                }).join('')}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    `;

    // 描画後のスクロール位置復元 (指示書 7項)
    if (preserveScroll && savedScrollY > 0) {
      setTimeout(() => {
        window.scrollTo({ top: savedScrollY, behavior: 'instant' });
      }, 0);
    }

    // イベントバインド
    container.querySelector('#btn-view-active')?.addEventListener('click', () => {
      viewMode = 'activeOnly';
      updateView(true);
    });
    container.querySelector('#btn-view-all')?.addEventListener('click', () => {
      viewMode = 'includeEnded';
      updateView(true);
    });
    container.querySelector('#btn-view-ended')?.addEventListener('click', () => {
      viewMode = 'endedOnly';
      updateView(true);
    });

    container.querySelector('#select-sort-by')?.addEventListener('change', (e) => {
      sortBy = e.target.value;
      updateView(true);
    });

    container.querySelector('#filter-end-reason')?.addEventListener('change', (e) => {
      selectedEndReason = e.target.value;
      updateView(true);
    });

    container.querySelector('#filter-keyword')?.addEventListener('input', (e) => {
      searchKeyword = e.target.value;
      updateView(true);
    });
    container.querySelector('#filter-phase')?.addEventListener('change', (e) => {
      selectedPhase = e.target.value;
      updateView(true);
    });
    container.querySelector('#filter-entry-source')?.addEventListener('change', (e) => {
      selectedEntrySource = e.target.value;
      updateView(true);
    });
    container.querySelector('#filter-ca')?.addEventListener('change', (e) => {
      selectedCaId = e.target.value;
      updateView(true);
    });

    container.querySelectorAll('.btn-detail').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        saveListState({ scrollTop: window.scrollY || document.documentElement.scrollTop });
        const selectionId = btn.getAttribute('data-id');
        if (selectionId && typeof onOpenDetail === 'function') {
          onOpenDetail(selectionId);
        }
      });
    });
  }

  updateView(true);
}
