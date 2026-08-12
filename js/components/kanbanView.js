/**
 * 選考進捗・ヨミ管理システム - ホワイトボード画面コンポーネント (クリーン再構築版)
 * 指示書 (全36項) に準拠し、データ層・詳細モーダルは保持のままUI表示のみを堅牢に一新
 */

import { store } from '../store.js';
import { WHITEBOARD_5PHASES } from '../constants.js';
import { getWhiteboardPhaseGroup, calculateUrgency } from '../utils/kanbanCalculations.js';
import { calculateUniqueCandidatesCount } from '../utils/yomiCalculations.js';

const KANBAN_STORAGE_KEY = 'kanban_view_active_state_v3';

function getSavedKanbanState() {
  try {
    const raw = sessionStorage.getItem(KANBAN_STORAGE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch (e) {
    return {};
  }
}

function saveKanbanState(state) {
  try {
    const current = getSavedKanbanState();
    sessionStorage.setItem(KANBAN_STORAGE_KEY, JSON.stringify({ ...current, ...state }));
  } catch (e) {}
}

export function renderKanbanView(container, { onOpenDetail, onNavigateToCompanyActions }) {
  const savedState = getSavedKanbanState();

  let selectedAxisMode = savedState.axisMode || 'ca';
  let isRaAreaOpen = savedState.isRaAreaOpen !== undefined ? savedState.isRaAreaOpen : true;
  let searchKeyword = savedState.searchKeyword || '';
  let filterCaId = savedState.filterCaId || '';
  let filterCompanySearch = savedState.filterCompanySearch || '';
  let lastUpdatedSelectionId = savedState.lastUpdatedSelectionId || null;

  function updateBoardOnly() {
    const scrollContainer = container.querySelector('#kanban-horizontal-scroll-container');
    const savedScrollLeft = scrollContainer ? scrollContainer.scrollLeft : (savedState.scrollLeft || 0);

    const selections = store.getSelections() || [];
    const companies = store.getCompanies() || [];
    const jobs = store.getJobs() || [];
    const candidates = store.getCandidates() || [];
    const consultants = store.getConsultants() || [];

    const companiesMap = new Map(companies.map(c => [c.companyId, c]));
    const candidatesMap = new Map(candidates.map(c => [c.candidateId, c]));
    const jobsMap = new Map(jobs.map(j => [j.jobId, j]));
    const consultantsMap = new Map(consultants.map(c => [c.consultantId, c]));

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const activeSelections = selections.filter(s => {
      if (!s || s.isArchived) return false;
      const p = s.phase || '';
      return p !== '選考終了' && p !== '書類見送り' && p !== '面接見送り' && p !== '候補者辞退' && p !== '他社決定';
    });

    const enrichedSelections = activeSelections.map(s => {
      const comp = companiesMap.get(s.companyId);
      const cand = candidatesMap.get(s.candidateId);
      const job = jobsMap.get(s.jobId);
      const ca = consultantsMap.get(s.caId || s.caConsultantId);
      const ra = consultantsMap.get(s.raId || s.raConsultantId);

      const wbGroup = getWhiteboardPhaseGroup(s.phase);
      const urgencyInfo = calculateUrgency(s, today);

      return {
        ...s,
        wbGroup,
        companyObj: comp,
        candidateObj: cand,
        jobObj: job,
        caObj: ca,
        raObj: ra,
        urgencyInfo
      };
    });

    // カラム算出
    let columns = [];
    if (selectedAxisMode === 'ca') {
      let targetCas = consultants.filter(c => {
        if (!c || c.isArchived || c.status === 'inactive') return false;
        if (c.roles && Array.isArray(c.roles)) return c.roles.includes('CA') || c.roles.includes('ADMIN');
        return c.roleType === 'CA' || c.roleType === 'ADMIN' || !c.roleType;
      });

      if (targetCas.length === 0) targetCas = consultants;

      if (filterCaId) targetCas = targetCas.filter(c => c.consultantId === filterCaId);
      if (searchKeyword) {
        const kw = searchKeyword.toLowerCase().trim();
        targetCas = targetCas.filter(c => (c.name || '').toLowerCase().includes(kw));
      }

      const registeredCaIds = new Set(targetCas.map(c => c.consultantId));

      columns = targetCas.map(c => ({
        id: c.consultantId,
        title: `${c.name} (CA)`,
        filterFn: (s) => (s.caId && s.caId === c.consultantId) || (s.caConsultantId && s.caConsultantId === c.consultantId) || (s.caName && s.caName.includes((c.name || '').split(' ')[0]))
      }));

      const hasUnassignedCa = enrichedSelections.some(s => !s.caId && !s.caConsultantId && (!s.caName || !registeredCaIds.has(s.caId)));
      if (hasUnassignedCa && !searchKeyword) {
        columns.push({
          id: 'UNASSIGNED_CA',
          title: '担当CA未設定',
          filterFn: (s) => !s.caId && !s.caConsultantId
        });
      }
    } else {
      const activeCompanyIds = new Set(enrichedSelections.filter(s => s.phase !== '内定辞退').map(s => s.companyId));
      let targetCompanies = companies.filter(c => c && activeCompanyIds.has(c.companyId));

      if (filterCompanySearch) {
        const kw = filterCompanySearch.toLowerCase().trim();
        targetCompanies = targetCompanies.filter(c => (c.name || '').toLowerCase().includes(kw));
      }

      columns = targetCompanies.map(c => ({
        id: c.companyId,
        title: c.name,
        filterFn: (s) => s.companyId === c.companyId
      }));
    }

    const sorted5Phases = [...WHITEBOARD_5PHASES].sort((a, b) => b.order - a.order);

    const gridTarget = container.querySelector('#kanban-board-grid-container');
    if (!gridTarget) return;

    gridTarget.innerHTML = `
      <div id="kanban-horizontal-scroll-container" class="overflow-x-auto w-full">
        <div class="space-y-4" style="min-width: max-content; width: 100%;">
          ${columns.length === 0 ? `
            <div class="p-8 text-center bg-slate-50 border border-dashed border-slate-300 rounded-xl text-slate-500 font-bold text-sm">
              ${selectedAxisMode === 'ca' ? '該当するCAがありません' : '該当する企業がありません'}
            </div>
          ` : sorted5Phases.map((pObj) => {
            const groupSels = enrichedSelections.filter(s => {
              if (s.phase === '内定辞退') {
                const prevPhase = s.previousPhaseBeforeDecline || '内定';
                return getWhiteboardPhaseGroup(prevPhase) === pObj.label;
              }
              return s.wbGroup === pObj.label;
            });

            const groupCases = groupSels.length;
            const groupPeople = calculateUniqueCandidatesCount(groupSels, false);
            const groupYomi = groupSels.reduce((sum, s) => sum + (s.phase === '内定辞退' ? 0 : Number(s.yomi || 0)), 0);

            return `
              <div class="border border-slate-200 rounded-xl overflow-hidden shadow-sm bg-slate-50/50">
                <div class="px-4 py-2 bg-slate-900 text-white flex items-center justify-between">
                  <div class="flex items-center space-x-3">
                    <span class="font-black text-sm text-indigo-200">${pObj.label}</span>
                    <span class="text-[11px] text-slate-400">（優先度: ${pObj.order}）</span>
                  </div>

                  <div class="flex items-center space-x-4 text-xs font-semibold">
                    <span>選考案件: <strong class="text-white">${groupCases}</strong>件</span>
                    <span class="text-slate-400">|</span>
                    <span>候補者実人数: <strong class="text-indigo-300">${groupPeople}</strong>名</span>
                    <span class="text-slate-400">|</span>
                    <span>ヨミ合計: <strong class="text-emerald-400">${Math.round(groupYomi * 100) / 100}</strong></span>
                  </div>
                </div>

                <div class="p-2 bg-slate-100/50 min-h-[130px]" style="display: grid; grid-template-columns: repeat(${Math.max(columns.length, 1)}, minmax(240px, 1fr)); gap: 0.75rem;">
                  ${columns.map(col => {
                    const colGroupSels = groupSels.filter(s => col.filterFn(s));
                    const colYomi = colGroupSels.reduce((sum, s) => sum + (s.phase === '内定辞退' ? 0 : Number(s.yomi || 0)), 0);
                    const colPeople = calculateUniqueCandidatesCount(colGroupSels, false);

                    return `
                      <div class="bg-slate-50 p-2.5 rounded-xl border border-slate-200 flex flex-col justify-between" data-column-id="${col.id}">
                        <div class="flex items-center justify-between border-b border-slate-200 pb-1.5 mb-2">
                          <span class="font-extrabold text-xs text-slate-800 line-clamp-1">${col.title}</span>
                          <span class="text-[10px] text-slate-500 font-medium shrink-0 ml-1">
                            案件:${colGroupSels.length} / 実人数:${colPeople} / ヨミ:${Math.round(colYomi * 100) / 100}
                          </span>
                        </div>

                        <div
                          class="kanban-drop-zone space-y-2 flex-1 min-h-[90px] p-1 rounded transition"
                          data-drop-group="${pObj.label}"
                          data-column-id="${col.id}"
                        >
                          ${colGroupSels.length === 0 ? `
                            <div class="h-full border border-dashed border-slate-200 rounded-lg flex items-center justify-center text-[10px] text-slate-400 py-6">
                              案件なし
                            </div>
                          ` : colGroupSels.map(s => renderCaCardHTML(s, lastUpdatedSelectionId === s.selectionId, selectedAxisMode === 'company')).join('')}
                        </div>
                      </div>
                    `;
                  }).join('')}
                </div>
              </div>
            `;
          }).join('')}
        </div>
      </div>
    `;

    const newScrollContainer = container.querySelector('#kanban-horizontal-scroll-container');
    if (newScrollContainer) newScrollContainer.scrollLeft = savedScrollLeft;

    bindBoardEvents();
  }

  function bindBoardEvents() {
    container.querySelectorAll('.kanban-card').forEach(card => {
      card.addEventListener('click', () => {
        const selId = card.getAttribute('data-selection-id');
        saveKanbanState({ scrollTop: window.scrollY || document.documentElement.scrollTop });
        if (onOpenDetail) onOpenDetail(selId);
      });
    });

    let draggedSelectionId = null;
    let originColumnId = null;

    container.querySelectorAll('.kanban-card[draggable="true"]').forEach(card => {
      card.addEventListener('dragstart', (e) => {
        draggedSelectionId = card.getAttribute('data-selection-id');
        const parentZone = card.closest('.kanban-drop-zone');
        originColumnId = parentZone ? parentZone.getAttribute('data-column-id') : null;
        e.dataTransfer.setData('text/plain', draggedSelectionId);
        card.classList.add('opacity-40');
      });

      card.addEventListener('dragend', () => {
        card.classList.remove('opacity-40');
      });
    });

    container.querySelectorAll('.kanban-drop-zone').forEach(zone => {
      zone.addEventListener('dragover', (e) => {
        const targetColId = zone.getAttribute('data-column-id');
        if (originColumnId && targetColId !== originColumnId) return;
        e.preventDefault();
        zone.classList.add('bg-indigo-50/80', 'border-2', 'border-dashed', 'border-indigo-400');
      });

      zone.addEventListener('dragleave', () => {
        zone.classList.remove('bg-indigo-50/80', 'border-2', 'border-dashed', 'border-indigo-400');
      });

      zone.addEventListener('drop', (e) => {
        const targetColId = zone.getAttribute('data-column-id');
        if (originColumnId && targetColId !== originColumnId) return;

        e.preventDefault();
        zone.classList.remove('bg-indigo-50/80', 'border-2', 'border-dashed', 'border-indigo-400');

        const targetGroup = zone.getAttribute('data-drop-group');
        if (draggedSelectionId && targetGroup) {
          const selection = store.getSelections().find(s => s.selectionId === draggedSelectionId);
          if (selection) {
            handlePhaseDropWithDialog(selection, targetGroup, (newPhase) => {
              try {
                lastUpdatedSelectionId = draggedSelectionId;
                store.updateSelection(draggedSelectionId, { phase: newPhase }, 'ホワイトボードでのドラッグ＆ドロップ更新');
                updateBoardOnly();
              } catch (err) {
                alert('保存に失敗しました。');
              }
            });
          }
        }
      });
    });
  }

    saveKanbanState({
      axisMode: selectedAxisMode,
      isRaAreaOpen,
      searchKeyword,
      filterCaId,
      filterCompanySearch,
      scrollTop: savedScrollY
    });

    const selections = store.getSelections() || [];
    const enrichedSelections = selections.filter(s => !s.isArchived && s.phase !== '選考終了');

    const raActionSelections = enrichedSelections.filter(s => {
      if (s.phase === '内定辞退') return false;
      const today = new Date(); today.setHours(0, 0, 0, 0);
      const uInfo = calculateUrgency(s, today);
      const uCode = uInfo ? uInfo.code : '';
      return (uCode === 'expired' || uCode === 'today' || uCode === 'waiting_reply' || uCode === 'ca_check' || uCode === 'within_3days');
    });

    const raSummary = {
      total: raActionSelections.length,
      expired: raActionSelections.filter(s => calculateUrgency(s, new Date()).code === 'expired').length,
      today: raActionSelections.filter(s => calculateUrgency(s, new Date()).code === 'today').length,
      companyWaiting: raActionSelections.filter(s => s.currentBall === 'COMPANY' || s.companyActionStatus === '企業回答待ち').length,
      caCheck: raActionSelections.filter(s => s.companyActionStatus === 'CA確認待ち').length
    };

    container.innerHTML = `
      <div class="space-y-4">
        <!-- ヘッダー ＆ トグル ＆ 検索欄 -->
        <div class="bg-white p-4 rounded-xl border border-slate-200 shadow-sm flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <div class="flex items-center space-x-3">
              <h2 class="text-xl font-extrabold text-slate-900 flex items-center gap-2">
                <svg class="w-5 h-5 text-indigo-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 17V7m0 10a2 2 0 01-2 2H5a2 2 0 01-2-2V7a2 2 0 012-2h2a2 2 0 012 2m0 10a2 2 0 002 2h2a2 0 002-2V7a2 0 00-2-2h-2a2 2 0 01-2 2m0 10V7m6 10a2 2 0 002 2h2a2 0 002-2V7a2 0 00-2-2h-2a2 2 0 01-2 2"></path></svg>
                ホワイトボード
              </h2>
              <span id="kanban-save-toast" class="text-xs font-bold text-emerald-600 bg-emerald-50 border border-emerald-200 px-2.5 py-0.5 rounded opacity-0 transition-opacity">
                更新しました
              </span>
            </div>
            <p class="text-xs text-slate-500 mt-1">全候補者の現在の選考進捗をCA別・企業別に俯瞰する画面です。</p>
          </div>

          <div class="flex items-center space-x-3 text-xs">
            <div class="bg-slate-100 p-1 rounded-lg flex items-center border border-slate-200 font-bold">
              <button id="btn-wb-toggle-ca" class="px-4 py-1.5 rounded transition ${selectedAxisMode === 'ca' ? 'bg-indigo-600 text-white shadow-sm' : 'text-slate-600 hover:text-slate-900'}">CA別</button>
              <button id="btn-wb-toggle-company" class="px-4 py-1.5 rounded transition ${selectedAxisMode === 'company' ? 'bg-indigo-600 text-white shadow-sm' : 'text-slate-600 hover:text-slate-900'}">企業別</button>
            </div>
            ${selectedAxisMode === 'ca' ? `
              <input type="text" id="input-wb-ca-search" value="${searchKeyword}" placeholder="CA名で検索..." class="bg-slate-50 border border-slate-300 rounded px-3 py-1.5 text-xs text-slate-800 focus:outline-none focus:bg-white focus:border-indigo-600 w-44">
            ` : `
              <input type="text" id="input-wb-comp-search" value="${filterCompanySearch}" placeholder="企業名で検索..." class="bg-slate-50 border border-slate-300 rounded px-3 py-1.5 text-xs text-slate-800 focus:outline-none focus:bg-white focus:border-indigo-600 w-44">
            `}
          </div>
        </div>

        <!-- RAサマリーバー -->
        <div class="bg-slate-900 text-white rounded-xl shadow-md border border-slate-800 p-3 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs">
          <div class="flex items-center space-x-3">
            <button id="btn-toggle-ra-summary" class="font-bold text-indigo-300 hover:text-white flex items-center gap-1.5 text-xs">
              <span>${isRaAreaOpen ? '▼' : '▶'}</span>
              <span class="text-sm font-black">本日のRA対応</span>
              <span class="bg-rose-500/30 text-rose-300 border border-rose-400/30 text-[11px] px-2 py-0.5 rounded font-extrabold ml-1">
                ${raSummary.total} 件
              </span>
            </button>
          </div>

          ${isRaAreaOpen ? `
            <div class="flex flex-wrap items-center gap-3">
              <div id="ra-sum-click-expired" class="cursor-pointer hover:bg-slate-800 px-2 py-1 rounded transition border border-transparent hover:border-slate-700">
                <span class="text-slate-400 font-semibold">期限超過:</span>
                <strong class="text-rose-400 font-black ml-1 text-sm">${raSummary.expired}</strong>
              </div>
              <div id="ra-sum-click-today" class="cursor-pointer hover:bg-slate-800 px-2 py-1 rounded transition border border-transparent hover:border-slate-700">
                <span class="text-slate-400 font-semibold">本日対応:</span>
                <strong class="text-amber-400 font-black ml-1 text-sm">${raSummary.today}</strong>
              </div>
              <div id="ra-sum-click-waiting" class="cursor-pointer hover:bg-slate-800 px-2 py-1 rounded transition border border-transparent hover:border-slate-700">
                <span class="text-slate-400 font-semibold">企業回答待ち:</span>
                <strong class="text-sky-400 font-black ml-1 text-sm">${raSummary.companyWaiting}</strong>
              </div>
              <div id="ra-sum-click-check" class="cursor-pointer hover:bg-slate-800 px-2 py-1 rounded transition border border-transparent hover:border-slate-700">
                <span class="text-slate-400 font-semibold">要確認:</span>
                <strong class="text-purple-400 font-black ml-1 text-sm">${raSummary.caCheck}</strong>
              </div>

              <button id="btn-open-company-actions-page" class="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white font-extrabold rounded-lg text-xs transition shadow-sm border border-indigo-400 flex items-center gap-1.5 ml-2">
                <span>企業対応を開く</span>
                <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M14 5l7 7m0 0l-7 7m7-7H3"></path></svg>
              </button>
            </div>
          ` : ''}
        </div>

        <!-- 5区分進捗ボード領域 (検索・トグル時にここだけ更新) -->
        <div id="kanban-board-grid-container" class="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden p-4"></div>
      </div>
    `;

    // イベントリスナーの登録
    container.querySelector('#btn-wb-toggle-ca')?.addEventListener('click', () => {
      selectedAxisMode = 'ca';
      searchKeyword = '';
      saveKanbanState({ axisMode: 'ca', searchKeyword: '' });
      updateView();
    });

    container.querySelector('#btn-wb-toggle-company')?.addEventListener('click', () => {
      selectedAxisMode = 'company';
      filterCompanySearch = '';
      saveKanbanState({ axisMode: 'company', filterCompanySearch: '' });
      updateView();
    });

    container.querySelector('#input-wb-ca-search')?.addEventListener('input', (e) => {
      searchKeyword = e.target.value;
      saveKanbanState({ searchKeyword });
      updateBoardOnly();
    });

    container.querySelector('#input-wb-comp-search')?.addEventListener('input', (e) => {
      filterCompanySearch = e.target.value;
      saveKanbanState({ filterCompanySearch });
      updateBoardOnly();
    });

    container.querySelector('#btn-toggle-ra-summary')?.addEventListener('click', () => {
      isRaAreaOpen = !isRaAreaOpen;
      saveKanbanState({ isRaAreaOpen });
      updateView({ preserveScroll: true });
    });

    container.querySelector('#btn-open-company-actions-page')?.addEventListener('click', () => {
      if (onNavigateToCompanyActions) onNavigateToCompanyActions();
    });

    container.querySelector('#ra-sum-click-expired')?.addEventListener('click', () => {
      if (onNavigateToCompanyActions) onNavigateToCompanyActions('expired');
    });

    container.querySelector('#ra-sum-click-today')?.addEventListener('click', () => {
      if (onNavigateToCompanyActions) onNavigateToCompanyActions('today');
    });

    container.querySelector('#ra-sum-click-waiting')?.addEventListener('click', () => {
      if (onNavigateToCompanyActions) onNavigateToCompanyActions('waiting');
    });

    container.querySelector('#ra-sum-click-check')?.addEventListener('click', () => {
      if (onNavigateToCompanyActions) onNavigateToCompanyActions('ca_check');
    });

    updateBoardOnly();
  }
                ${raSummary.total} 件
              </span>
            </button>
          </div>
          ${isRaAreaOpen ? `
            <div class="flex flex-wrap items-center gap-3">
              <div id="ra-sum-click-expired" class="cursor-pointer hover:bg-slate-800 px-2 py-1 rounded transition border border-transparent hover:border-slate-700">
                <span class="text-slate-400 font-semibold">期限超過:</span>
                <strong class="text-rose-400 font-black ml-1 text-sm">${raSummary.expired}</strong>
              </div>
              <div id="ra-sum-click-today" class="cursor-pointer hover:bg-slate-800 px-2 py-1 rounded transition border border-transparent hover:border-slate-700">
                <span class="text-slate-400 font-semibold">本日対応:</span>
                <strong class="text-amber-400 font-black ml-1 text-sm">${raSummary.today}</strong>
              </div>
              <div id="ra-sum-click-waiting" class="cursor-pointer hover:bg-slate-800 px-2 py-1 rounded transition border border-transparent hover:border-slate-700">
                <span class="text-slate-400 font-semibold">企業回答待ち:</span>
                <strong class="text-sky-400 font-black ml-1 text-sm">${raSummary.companyWaiting}</strong>
              </div>
              <div id="ra-sum-click-check" class="cursor-pointer hover:bg-slate-800 px-2 py-1 rounded transition border border-transparent hover:border-slate-700">
                <span class="text-slate-400 font-semibold">要確認:</span>
                <strong class="text-purple-400 font-black ml-1 text-sm">${raSummary.caCheck}</strong>
              </div>
              <button id="btn-open-company-actions-page" class="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white font-extrabold rounded-lg text-xs transition shadow-sm border border-indigo-400 flex items-center gap-1.5 ml-2">
                <span>企業対応を開く</span>
                <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M14 5l7 7m0 0l-7 7m7-7H3"></path></svg>
              </button>
            </div>
          ` : ''}
        </div>

        <div class="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden p-4 space-y-4">
          <div id="kanban-horizontal-scroll-container" class="overflow-x-auto w-full">
            <div class="space-y-4" style="min-width: max-content; width: 100%;">
              ${sorted5Phases.map((pObj) => {
                const groupSels = enrichedSelections.filter(s => {
                  if (s.phase === '内定辞退') {
                    const prevPhase = s.previousPhaseBeforeDecline || '内定';
                    return getWhiteboardPhaseGroup(prevPhase) === pObj.label;
                  }
                  return s.wbGroup === pObj.label;
                });
                const groupCases = groupSels.length;
                const groupPeople = calculateUniqueCandidatesCount(groupSels, false);
                const groupYomi = groupSels.reduce((sum, s) => sum + (s.phase === '内定辞退' ? 0 : Number(s.yomi || 0)), 0);
                return `
                  <div class="border border-slate-200 rounded-xl overflow-hidden shadow-sm bg-slate-50/50">
                    <div class="px-4 py-2 bg-slate-900 text-white flex items-center justify-between">
                      <div class="flex items-center space-x-3">
                        <span class="font-black text-sm text-indigo-200">${pObj.label}</span>
                        <span class="text-[11px] text-slate-400">（優先度: ${pObj.order}）</span>
                      </div>
                      <div class="flex items-center space-x-4 text-xs font-semibold">
                        <span>選考案件: <strong class="text-white">${groupCases}</strong>件</span>
                        <span class="text-slate-400">|</span>
                        <span>候補者実人数: <strong class="text-indigo-300">${groupPeople}</strong>名</span>
                        <span class="text-slate-400">|</span>
                        <span>ヨミ合計: <strong class="text-emerald-400">${Math.round(groupYomi * 100) / 100}</strong></span>
                      </div>
                    </div>
                    <div class="p-2 bg-slate-100/50 min-h-[130px]" style="display: grid; grid-template-columns: repeat(${Math.max(columns.length, 1)}, minmax(240px, 1fr)); gap: 0.75rem;">
                      ${columns.length === 0 ? `
                        <div class="p-6 text-center text-xs text-slate-400 bg-slate-50 rounded-lg border border-dashed border-slate-200">対象となる列データがありません</div>
                      ` : columns.map(col => {
                        const colGroupSels = groupSels.filter(s => col.filterFn(s));
                        const colYomi = colGroupSels.reduce((sum, s) => sum + (s.phase === '内定辞退' ? 0 : Number(s.yomi || 0)), 0);
                        const colPeople = calculateUniqueCandidatesCount(colGroupSels, false);
                        return `
                          <div class="bg-slate-50 p-2.5 rounded-xl border border-slate-200 flex flex-col justify-between" data-column-id="${col.id}">
                            <div class="flex items-center justify-between border-b border-slate-200 pb-1.5 mb-2">
                              <span class="font-extrabold text-xs text-slate-800 line-clamp-1">${col.title}</span>
                              <span class="text-[10px] text-slate-500 font-medium shrink-0 ml-1">
                                案件:${colGroupSels.length} / 実人数:${colPeople} / ヨミ:${Math.round(colYomi * 100) / 100}
                              </span>
                            </div>
                            <div
                              class="kanban-drop-zone space-y-2 flex-1 min-h-[90px] p-1 rounded transition"
                              data-drop-group="${pObj.label}"
                              data-column-id="${col.id}"
                            >
                              ${colGroupSels.length === 0 ? `
                                <div class="h-full border border-dashed border-slate-200 rounded-lg flex items-center justify-center text-[10px] text-slate-400 py-6">
                                  案件なし
                                </div>
                              ` : colGroupSels.map(s => renderCaCardHTML(s, lastUpdatedSelectionId === s.selectionId, selectedAxisMode === 'company')).join('')}
                            </div>
                          </div>
                        `;
                      }).join('')}
                    </div>
                  </div>
                `;
              }).join('')}
            </div>
          </div>
        </div>
      </div>
    `;

    const scrollContainer = container.querySelector('#kanban-horizontal-scroll-container');
    if (options.preserveScroll !== false) {
      setTimeout(() => {
        if (savedScrollY > 0) window.scrollTo({ top: savedScrollY, behavior: 'instant' });
        if (scrollContainer && savedScrollLeft > 0) scrollContainer.scrollLeft = savedScrollLeft;
      }, 0);
    }

    container.querySelector('#btn-wb-toggle-ca')?.addEventListener('click', () => {
      selectedAxisMode = 'ca';
      saveKanbanState({ axisMode: 'ca' });
      updateView();
    });
    container.querySelector('#btn-wb-toggle-company')?.addEventListener('click', () => {
      selectedAxisMode = 'company';
      saveKanbanState({ axisMode: 'company' });
      updateView();
    });
    container.querySelector('#input-wb-ca-search')?.addEventListener('input', (e) => {
      searchKeyword = e.target.value;
      saveKanbanState({ searchKeyword });
      updateView();
    });
    container.querySelector('#input-wb-comp-search')?.addEventListener('input', (e) => {
      filterCompanySearch = e.target.value;
      saveKanbanState({ filterCompanySearch });
      updateView();
    });
    container.querySelector('#btn-toggle-ra-summary')?.addEventListener('click', () => {
      isRaAreaOpen = !isRaAreaOpen;
      saveKanbanState({ isRaAreaOpen });
      updateView({ preserveScroll: true });
    });
    container.querySelector('#btn-open-company-actions-page')?.addEventListener('click', () => {
      if (onNavigateToCompanyActions) onNavigateToCompanyActions();
    });
    container.querySelector('#ra-sum-click-expired')?.addEventListener('click', () => {
      if (onNavigateToCompanyActions) onNavigateToCompanyActions('expired');
    });
    container.querySelector('#ra-sum-click-today')?.addEventListener('click', () => {
      if (onNavigateToCompanyActions) onNavigateToCompanyActions('today');
    });
    container.querySelector('#ra-sum-click-waiting')?.addEventListener('click', () => {
      if (onNavigateToCompanyActions) onNavigateToCompanyActions('waiting');
    });
    container.querySelector('#ra-sum-click-check')?.addEventListener('click', () => {
      if (onNavigateToCompanyActions) onNavigateToCompanyActions('ca_check');
    });

    container.querySelectorAll('.kanban-card').forEach(card => {
      card.addEventListener('click', () => {
        const selId = card.getAttribute('data-selection-id');
        saveKanbanState({ scrollTop: window.scrollY || document.documentElement.scrollTop });
        if (onOpenDetail) onOpenDetail(selId);
      });
    });

    let draggedSelectionId = null;
    let originColumnId = null;

    container.querySelectorAll('.kanban-card[draggable="true"]').forEach(card => {
      card.addEventListener('dragstart', (e) => {
        draggedSelectionId = card.getAttribute('data-selection-id');
        const parentZone = card.closest('.kanban-drop-zone');
        originColumnId = parentZone ? parentZone.getAttribute('data-column-id') : null;
        e.dataTransfer.setData('text/plain', draggedSelectionId);
        card.classList.add('opacity-40');
      });
      card.addEventListener('dragend', () => {
        card.classList.remove('opacity-40');
      });
    });

    container.querySelectorAll('.kanban-drop-zone').forEach(zone => {
      zone.addEventListener('dragover', (e) => {
        const targetColId = zone.getAttribute('data-column-id');
        if (originColumnId && targetColId !== originColumnId) return;
        e.preventDefault();
        zone.classList.add('bg-indigo-50/80', 'border-2', 'border-dashed', 'border-indigo-400');
      });
      zone.addEventListener('dragleave', () => {
        zone.classList.remove('bg-indigo-50/80', 'border-2', 'border-dashed', 'border-indigo-400');
      });
      zone.addEventListener('drop', (e) => {
        const targetColId = zone.getAttribute('data-column-id');
        if (originColumnId && targetColId !== originColumnId) return;
        e.preventDefault();
        zone.classList.remove('bg-indigo-50/80', 'border-2', 'border-dashed', 'border-indigo-400');
        const targetGroup = zone.getAttribute('data-drop-group');
        if (draggedSelectionId && targetGroup) {
          const selection = store.getSelections().find(s => s.selectionId === draggedSelectionId);
          if (selection) {
            handlePhaseDropWithDialog(selection, targetGroup, (newPhase) => {
              try {
                lastUpdatedSelectionId = draggedSelectionId;
                store.updateSelection(draggedSelectionId, { phase: newPhase }, 'ホワイトボードでのドラッグ＆ドロップ更新');
                updateView({ preserveScroll: true });
              } catch (err) {
                alert('保存に失敗しました。');
              }
            });
          }
        }
      });
    });
  }

  updateView({ preserveScroll: true });
}

function renderCaCardHTML(s, isHighlighted, isCompanyAxis) {
  const isDeclined = s.phase === '内定辞退';
  const uObj = s.urgencyInfo || {};
  const percentStr = Math.round((Number(s.yomi) || 0) * 100) + '%';
  return `
    <div
      draggable="${isDeclined ? 'false' : 'true'}"
      data-selection-id="${s.selectionId}"
      class="kanban-card rounded-lg p-2.5 shadow-2xs transition space-y-1.5 border text-xs ${
        isDeclined
          ? 'bg-slate-200/80 border-slate-300 text-slate-500 cursor-default opacity-75'
          : 'bg-white border-slate-200 hover:shadow-md hover:border-indigo-400 cursor-grab active:cursor-grabbing group'
      } ${isHighlighted ? 'ring-4 ring-indigo-500 border-indigo-500 font-semibold shadow-md' : ''}"
    >
      <div class="flex items-center justify-between gap-1 border-b border-slate-100 pb-1">
        <div class="font-extrabold text-xs text-slate-900 truncate group-hover:text-indigo-600 transition" title="${s.candidateObj ? s.candidateObj.name : s.candidateName}">
          ${s.candidateObj ? s.candidateObj.name : s.candidateName} 様
        </div>
        ${isDeclined ? `
          <span class="px-1.5 py-0.2 rounded text-[9px] font-extrabold bg-slate-500 text-white shrink-0">内定辞退</span>
        ` : (uObj.code === 'expired' || uObj.code === 'today') ? `
          <span class="px-1.5 py-0.2 rounded text-[8px] font-extrabold ${uObj.badgeClass} shrink-0">${uObj.label}</span>
        ` : ''}
      </div>
      <div class="text-[10px] text-slate-700 truncate">
        ${isCompanyAxis ? `CA: <strong class="text-indigo-900 font-bold">${s.caObj ? (s.caObj.name || '').split(' ')[0] : s.caName || '-'}</strong>` : `<strong class="text-slate-900 font-bold">${s.companyObj ? s.companyObj.name : s.companyName}</strong>`}
      </div>
      <div class="text-[10px] text-slate-500 truncate" title="${s.jobObj ? (s.jobObj.title || s.jobObj.jobName) : s.jobName}">
        ${s.jobObj ? (s.jobObj.title || s.jobObj.jobName) : s.jobName}
      </div>
      <div class="flex items-center justify-between pt-1 border-t border-slate-100 text-[10px]">
        <div class="font-bold text-indigo-800 truncate">${s.phase} <span class="text-slate-400 font-normal">｜ ${s.progressStatus}</span></div>
        <div class="font-black text-slate-900 shrink-0 ml-1">ヨミ ${percentStr}</div>
      </div>
    </div>
  `;
}

function handlePhaseDropWithDialog(selection, targetGroupLabel, onConfirm) {
  if (targetGroupLabel === '最終・二次') {
    const dialog = createOptionsDialog('「最終・二次」フェーズへ移動', '移動先の実フェーズを選択してください:', [
      { label: '二次面接', phase: '二次面接' },
      { label: '三次面接', phase: '三次面接' },
      { label: '最終面接', phase: '最終面接' }
    ], onConfirm);
    document.body.appendChild(dialog);
  } else if (targetGroupLabel === '内定') {
    const dialog = createOptionsDialog('「内定」フェーズへ移動', '移動先の実フェーズを選択してください:', [
      { label: '内定', phase: '内定' },
      { label: 'オファー面談・条件提示', phase: 'オファー面談・条件提示' }
    ], onConfirm);
    document.body.appendChild(dialog);
  } else if (targetGroupLabel === '一次') {
    onConfirm('一次面接');
  } else if (targetGroupLabel === '内定承諾') {
    onConfirm('内定承諾');
  } else if (targetGroupLabel === '書類選考') {
    onConfirm('書類選考');
  } else {
    onConfirm('書類選考');
  }
}

function createOptionsDialog(title, message, optionsList, onConfirm) {
  const modal = document.createElement('div');
  modal.className = 'fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4 text-xs';
  modal.innerHTML = `
    <div class="bg-white rounded-2xl p-5 shadow-2xl border border-slate-200 w-full max-w-sm space-y-4 animate-fadeIn">
      <div class="flex items-center justify-between border-b border-slate-200 pb-2">
        <h3 class="font-bold text-slate-900 text-sm">${title}</h3>
        <button id="btn-cancel-phase-dialog" class="text-slate-400 hover:text-slate-700 font-bold text-base">✕</button>
      </div>

      <p class="text-slate-700 font-medium">${message}</p>

      <div class="space-y-2">
        ${optionsList.map(opt => `
          <button class="btn-select-phase-option w-full py-2 px-3 bg-indigo-50 hover:bg-indigo-600 hover:text-white text-indigo-900 font-bold rounded-lg border border-indigo-200 transition text-left flex items-center justify-between" data-phase="${opt.phase}">
            <span>${opt.label}</span>
            <span class="text-xs">➔</span>
          </button>
        `).join('')}
      </div>

      <div class="pt-2 text-right">
        <button id="btn-cancel-phase-dialog-bottom" class="px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold rounded">キャンセル</button>
      </div>
    </div>
  `;

  const closeDialog = () => modal.remove();

  modal.querySelector('#btn-cancel-phase-dialog')?.addEventListener('click', closeDialog);
  modal.querySelector('#btn-cancel-phase-dialog-bottom')?.addEventListener('click', closeDialog);

  modal.querySelectorAll('.btn-select-phase-option').forEach(btn => {
    btn.addEventListener('click', () => {
      const selectedPhase = btn.getAttribute('data-phase');
      closeDialog();
      onConfirm(selectedPhase);
    });
  });

  return modal;
}

/**
 * 「連絡済みにする」ポップアップダイアログ (指示書 20項)
 */
function openContactedModal(selectionId, onComplete) {
  let modal = document.getElementById('contacted-modal');
  if (modal) modal.remove();

  const selections = store.getSelections();
  const selection = selections.find(s => s.selectionId === selectionId);
  if (!selection) return;

  const todayStr = new Date().toISOString().slice(0, 10);
  const defaultNextDate = new Date();
  defaultNextDate.setDate(defaultNextDate.getDate() + 2);
  const defaultNextStr = defaultNextDate.toISOString().slice(0, 10);

  modal = document.createElement('div');
  modal.id = 'contacted-modal';
  modal.className = 'fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4 text-xs';

  modal.innerHTML = `
    <div class="bg-white rounded-2xl p-5 shadow-2xl border border-slate-200 w-full max-w-md space-y-4 animate-fadeIn">
      <div class="flex items-center justify-between border-b border-slate-200 pb-3">
        <h3 class="font-bold text-slate-900 text-sm">連絡済み登録 - ${selection.candidateName} 様 (${selection.companyName})</h3>
        <button id="btn-close-contacted" class="text-slate-400 hover:text-slate-700 font-bold text-base">✕</button>
      </div>

      <div class="space-y-3">
        <div class="grid grid-cols-2 gap-2">
          <div>
            <label class="block font-bold text-slate-700 mb-1">連絡日</label>
            <input type="date" id="contact-date" value="${todayStr}" class="w-full bg-slate-50 border border-slate-300 rounded px-2 py-1 font-mono">
          </div>
          <div>
            <label class="block font-bold text-slate-700 mb-1">連絡方法</label>
            <select id="contact-method" class="w-full bg-slate-50 border border-slate-300 rounded px-2 py-1 font-bold">
              <option value="メール">メール</option>
              <option value="電話">電話</option>
              <option value="Teams">Teams</option>
              <option value="Zoom">Zoom</option>
              <option value="その他">その他</option>
            </select>
          </div>
        </div>

        <div>
          <label class="block font-bold text-slate-700 mb-1">企業対応ステータス</label>
          <select id="contact-status" class="w-full bg-slate-50 border border-slate-300 rounded px-2 py-1 font-bold text-indigo-900">
            <option value="企業へ連絡済み">企業へ連絡済み</option>
            <option value="企業回答待ち">企業回答待ち</option>
            <option value="CA確認待ち">CA確認待ち</option>
            <option value="完了">完了</option>
          </select>
        </div>

        <div>
          <label class="block font-bold text-slate-700 mb-1">次回確認予定日</label>
          <input type="date" id="next-contact-date" value="${defaultNextStr}" class="w-full bg-white border border-indigo-300 rounded px-2 py-1 font-mono font-bold text-indigo-900">
        </div>

        <div>
          <label class="block font-semibold text-slate-700 mb-1">連絡内容メモ</label>
          <input type="text" id="contact-memo" placeholder="連絡内容を入力..." class="w-full bg-slate-50 border border-slate-300 rounded px-2 py-1">
        </div>
      </div>

      <div class="flex items-center justify-end space-x-2 pt-2 border-t border-slate-200">
        <button id="btn-cancel-contacted" class="px-3 py-1.5 bg-slate-100 hover:bg-slate-200 rounded font-semibold text-slate-700">キャンセル</button>
        <button id="btn-save-contacted" class="px-4 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white font-bold rounded shadow">連絡済みに登録</button>
      </div>
    </div>
  `;

  document.body.appendChild(modal);

  modal.querySelector('#btn-close-contacted')?.addEventListener('click', () => modal.remove());
  modal.querySelector('#btn-cancel-contacted')?.addEventListener('click', () => modal.remove());

  modal.querySelector('#btn-save-contacted')?.addEventListener('click', () => {
    const cStatus = modal.querySelector('#contact-status').value;
    const nextDate = modal.querySelector('#next-contact-date').value;
    const memo = modal.querySelector('#contact-memo').value;

    store.updateSelection(selectionId, {
      companyActionStatus: cStatus,
      nextCompanyContactDate: nextDate || null,
      actionDeadline: nextDate || null
    }, 'ホワイトボードからの連絡済み登録');

    store.addCompanyCommunication({
      companyId: selection.companyId,
      selectionIds: [selectionId],
      communicationType: '連絡済み登録',
      method: modal.querySelector('#contact-method').value,
      notes: memo,
      status: cStatus
    });

    modal.remove();
    if (onComplete) onComplete();
  });
}
