/**
 * 選考進捗・ヨミ管理システム - ホワイトボード画面コンポーネント (「レベル」表記廃止・5区分フェーズ表示・上部本日のRA対応表示 & ドロップ時フェーズ選択ダイアログ対応)
 */

import { store } from '../store.js';
import { WHITEBOARD_5PHASES, NEXT_ACTION_TARGETS, URGENCY_LEVELS } from '../constants.js';
import { getWhiteboardPhaseGroup, autoDetectNextAction, calculateElapsedTime, calculateUrgency } from '../utils/kanbanCalculations.js';
import { calculateUniqueCandidatesCount, getSelectionAlerts } from '../utils/yomiCalculations.js';

const KANBAN_STORAGE_KEY = 'kanban_view_active_state';

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

export function renderKanbanView(container, { onOpenDetail, onOpenEmailComposer }) {
  const currentCons = store.getCurrentConsultant();
  const savedState = getSavedKanbanState();

  // 横軸モード (既存レイアウト保持) (指示書 2項)
  let selectedAxisMode = savedState.axisMode || 'all'; // 'all' | 'ca' | 'ra' | 'company' | 'job'

  // 上部RA対応欄の折りたたみ状態 (指示書 10, 11項)
  let isRaAreaOpen = savedState.isRaAreaOpen !== undefined ? savedState.isRaAreaOpen : true;
  let showAllRaItems = savedState.showAllRaItems || false; // 初期は上位3-5件 ＋ 期限超過全件

  // フィルター (指示書 23項)
  let filterRaId = savedState.filterRaId !== undefined ? savedState.filterRaId : (currentCons.roleType === 'RA' ? currentCons.consultantId : '');
  let filterOnlyMine = savedState.filterOnlyMine !== undefined ? savedState.filterOnlyMine : (currentCons.roleType === 'RA'); // RAログイン時は既定オン
  let filterUrgencyCode = savedState.filterUrgencyCode || '';
  let filterTargetCode = savedState.filterTargetCode || '';
  let searchKeyword = savedState.searchKeyword || '';
  let openCompanyIds = new Set(savedState.openCompanyIds || []);
  let expandedCardIds = new Set(savedState.expandedCardIds || []);
  let lastUpdatedSelectionId = savedState.lastUpdatedSelectionId || null;

  function updateView(options = {}) {
    const savedScrollY = options.preserveScroll !== false ? (window.scrollY || document.documentElement.scrollTop) : 0;
    const savedScrollLeft = options.preserveScroll !== false ? (savedState.scrollLeft || 0) : 0;

    const selections = store.getSelections();
    const companies = store.getCompanies();
    const jobs = store.getJobs();
    const candidates = store.getCandidates();
    const consultants = store.getConsultants();

    const companiesMap = new Map(companies.map(c => [c.companyId, c]));
    const candidatesMap = new Map(candidates.map(c => [c.candidateId, c]));
    const jobsMap = new Map(jobs.map(j => [j.jobId, j]));
    const consultantsMap = new Map(consultants.map(c => [c.consultantId, c]));

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // 書類・面接見送りなどの「選考終了」案件はホワイトボードから完全に非表示 (指示書 13, 27項)
    // 「内定辞退」案件は下部ホワイトボードに残す
    const activeSelections = selections.filter(s => !s.isArchived && s.phase !== '選考終了');

    // データ補完
    const enrichedSelections = activeSelections.map(s => {
      const comp = companiesMap.get(s.companyId);
      const cand = candidatesMap.get(s.candidateId);
      const job = jobsMap.get(s.jobId);
      const ca = consultantsMap.get(s.caId || s.caConsultantId);
      const ra = consultantsMap.get(s.raId || s.raConsultantId);

      const wbGroup = getWhiteboardPhaseGroup(s.phase); // ホワイトボード専用5区分グループ
      const actionInfo = autoDetectNextAction(s);
      const elapsedInfo = calculateElapsedTime(s, today);
      const urgencyInfo = calculateUrgency(s, today);

      return {
        ...s,
        wbGroup,
        companyObj: comp,
        candidateObj: cand,
        jobObj: job,
        caObj: ca,
        raObj: ra,
        nextActionText: s.nextAction || actionInfo.action,
        nextActionTargetCode: s.nextActionTarget || actionInfo.target,
        elapsedInfo,
        urgencyInfo
      };
    });

    // 1. 上部「本日のRA対応」対象案件の抽出 (指示書 12, 13項)
    const raActionSelections = enrichedSelections.filter(s => {
      if (s.phase === '内定辞退') return false; // 内定辞退はRA対応非表示
      if (filterOnlyMine && s.raId !== currentCons.consultantId && s.raConsultantId !== currentCons.consultantId) return false;
      if (filterRaId && s.raId !== filterRaId && s.raConsultantId !== filterRaId) return false;

      if (searchKeyword) {
        const kw = searchKeyword.toLowerCase();
        const candName = (s.candidateObj ? s.candidateObj.name : s.candidateName || '').toLowerCase();
        const compName = (s.companyObj ? s.companyObj.name : s.companyName || '').toLowerCase();
        const jobTitle = (s.jobObj ? (s.jobObj.title || s.jobObj.jobName) : s.jobName || '').toLowerCase();
        if (!candName.includes(kw) && !compName.includes(kw) && !jobTitle.includes(kw)) return false;
      }

      if (filterUrgencyCode && s.urgencyInfo.code !== filterUrgencyCode) return false;
      if (filterTargetCode && s.nextActionTargetCode !== filterTargetCode) return false;

      // 本日行動すべき案件か判定 (期限超過、本日対応、確認事項あり、回答待ち再確認など)
      const uCode = s.urgencyInfo.code;
      return (uCode === 'expired' || uCode === 'today' || uCode === 'waiting_reply' || uCode === 'ca_check' || uCode === 'within_3days');
    }).sort((a, b) => {
      const uOrder = { expired: 1, today: 2, ca_check: 3, waiting_reply: 4, within_3days: 5 };
      const diffUrgency = (uOrder[a.urgencyInfo.code] || 9) - (uOrder[b.urgencyInfo.code] || 9);
      if (diffUrgency !== 0) return diffUrgency;
      return (a.actionDeadline || '9999').localeCompare(b.actionDeadline || '9999');
    });

    // 表示件数制限 (指示書 11項) (期限超過案件は全件 ＋ 本日対応以下上位5件)
    const expiredSels = raActionSelections.filter(s => s.urgencyInfo.code === 'expired');
    const normalSels = raActionSelections.filter(s => s.urgencyInfo.code !== 'expired');
    const displayedNormalSels = showAllRaItems ? normalSels : normalSels.slice(0, 5);
    const displayedRaSelections = [...expiredSels, ...displayedNormalSels];

    // サマリー件数 (指示書 10項)
    const raSummary = {
      expired: raActionSelections.filter(s => s.urgencyInfo.code === 'expired').length,
      today: raActionSelections.filter(s => s.urgencyInfo.code === 'today').length,
      companyCheck: raActionSelections.filter(s => s.nextActionTargetCode === 'company').length,
      caCheck: raActionSelections.filter(s => s.nextActionTargetCode === 'ca').length,
      companyWaiting: raActionSelections.filter(s => s.urgencyInfo.code === 'waiting_reply').length
    };

    // 2. 下部「CA別ホワイトボード」用カラム構成 (既存レイアウト維持) (指示書 2, 3項)
    let columns = [];
    if (selectedAxisMode === 'all') {
      columns = [{ id: 'ALL', title: 'チーム全体', filterFn: () => true }];
    } else if (selectedAxisMode === 'ca') {
      columns = consultants.filter(c => c.roleType === 'CA' || c.roleType === 'ADMIN').map(c => ({
        id: c.consultantId,
        title: `${c.name} (CA)`,
        filterFn: (s) => s.caId === c.consultantId || s.caConsultantId === c.consultantId
      }));
    } else if (selectedAxisMode === 'ra') {
      columns = consultants.filter(c => c.roleType === 'RA' || c.roleType === 'ADMIN').map(c => ({
        id: c.consultantId,
        title: `${c.name} (RA)`,
        filterFn: (s) => s.raId === c.consultantId || s.raConsultantId === c.consultantId
      }));
    } else if (selectedAxisMode === 'company') {
      columns = companies.map(c => ({
        id: c.companyId,
        title: c.name,
        filterFn: (s) => s.companyId === c.companyId
      }));
    } else if (selectedAxisMode === 'job') {
      columns = jobs.map(j => ({
        id: j.jobId,
        title: `${j.title} (${companiesMap.get(j.companyId)?.name || ''})`,
        filterFn: (s) => s.jobId === j.jobId
      }));
    }

    // ホワイトボード専用 5区分フェーズ順（order: 50 (最上段: 内定承諾) ➔ 10 (最下段: 書類選考)）(指示書 5項)
    const sorted5Phases = [...WHITEBOARD_5PHASES].sort((a, b) => b.order - a.order);

    // 状態保存 (指示書 29項)
    saveKanbanState({
      axisMode: selectedAxisMode,
      isRaAreaOpen,
      showAllRaItems,
      filterRaId,
      filterOnlyMine,
      filterUrgencyCode,
      filterTargetCode,
      searchKeyword,
      openCompanyIds: Array.from(openCompanyIds),
      expandedCardIds: Array.from(expandedCardIds),
      scrollTop: savedScrollY,
      scrollLeft: savedScrollLeft
    });

    container.innerHTML = `
      <div class="space-y-5">
        <!-- 画面ヘッダー (指示書 3, 4項) -->
        <div class="bg-white p-4 rounded-xl border border-slate-200 shadow-sm flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <div class="flex items-center space-x-3">
              <h2 class="text-lg font-bold text-slate-900 flex items-center gap-2">
                <svg class="w-5 h-5 text-indigo-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 17V7m0 10a2 2 0 01-2 2H5a2 2 0 01-2-2V7a2 2 0 012-2h2a2 2 0 012 2m0 10a2 2 0 002 2h2a2 2 0 002-2V7a2 2 0 00-2-2h-2a2 2 0 01-2 2m0 10V7m6 10a2 2 0 002 2h2a2 2 0 002-2V7a2 2 0 00-2-2h-2a2 2 0 01-2 2"></path></svg>
                ホワイトボード
              </h2>
              <span id="kanban-save-toast" class="text-xs font-bold text-emerald-600 bg-emerald-50 border border-emerald-200 px-2.5 py-0.5 rounded opacity-0 transition-opacity flex items-center gap-1">
                <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"></path></svg>
                更新しました
              </span>
            </div>
            <p class="text-xs text-slate-500 mt-0.5">CA別の選考進捗と本日のRA対応を確認できます</p>
          </div>

          <div class="flex items-center space-x-2 text-xs">
            <span class="text-slate-500 font-semibold">下部ボード横軸切替:</span>
            <select id="kanban-axis-mode" class="bg-slate-100 border border-slate-300 rounded px-3 py-1.5 font-bold text-indigo-900 focus:outline-none">
              <option value="all" ${selectedAxisMode === 'all' ? 'selected' : ''}>チーム全体</option>
              <option value="ca" ${selectedAxisMode === 'ca' ? 'selected' : ''}>CA別</option>
              <option value="ra" ${selectedAxisMode === 'ra' ? 'selected' : ''}>RA別</option>
              <option value="company" ${selectedAxisMode === 'company' ? 'selected' : ''}>企業別</option>
              <option value="job" ${selectedAxisMode === 'job' ? 'selected' : ''}>求人別</option>
            </select>
          </div>
        </div>

        <!-- 【上部】本日のRA対応エリア (指示书 3, 10, 11, 14, 20, 23項) -->
        <div class="bg-slate-900 text-white rounded-xl shadow-md border border-slate-800 p-4 space-y-3">
          <div class="flex items-center justify-between text-xs">
            <div class="flex items-center space-x-3">
              <button id="btn-toggle-ra-area" class="font-bold text-indigo-300 hover:text-white flex items-center gap-1.5">
                <span class="text-base">${isRaAreaOpen ? '▼' : '▶'}</span>
                <span class="text-sm">【上部】本日のRA対応</span>
              </button>
              <span class="bg-rose-500/30 text-rose-300 border border-rose-400/30 text-[10px] px-2 py-0.5 rounded font-extrabold">
                全 ${raActionSelections.length} 件
              </span>
            </div>

            <div class="flex items-center space-x-3">
              <label class="inline-flex items-center space-x-1 font-semibold text-slate-300 cursor-pointer text-[11px]">
                <input type="checkbox" id="chk-wb-only-mine" ${filterOnlyMine ? 'checked' : ''} class="rounded text-indigo-500">
                <span>自分の担当企業のみ表示</span>
              </label>

              <select id="select-wb-ra-filter" class="bg-slate-800 border border-slate-700 font-bold rounded px-2 py-1 text-slate-200 focus:outline-none text-[11px]">
                <option value="">すべてのRA担当</option>
                ${consultants.filter(c => c.roleType === 'RA' || c.roleType === 'ADMIN').map(c => `<option value="${c.consultantId}" ${filterRaId === c.consultantId ? 'selected' : ''}>${c.name} (RA)</option>`).join('')}
              </select>
            </div>
          </div>

          <!-- サマリー件数カウンター (指示書 10項) -->
          <div class="grid grid-cols-2 sm:grid-cols-5 gap-2 text-xs">
            <div class="p-2 rounded-lg bg-slate-800/80 border border-slate-700 text-left">
              <div class="text-[10px] text-slate-400">期限超過</div>
              <div class="text-base font-black text-rose-400">${raSummary.expired} <span class="text-[10px] font-normal text-slate-400">件</span></div>
            </div>

            <div class="p-2 rounded-lg bg-slate-800/80 border border-slate-700 text-left">
              <div class="text-[10px] text-slate-400">本日対応</div>
              <div class="text-base font-black text-orange-400">${raSummary.today} <span class="text-[10px] font-normal text-slate-400">件</span></div>
            </div>

            <div class="p-2 rounded-lg bg-slate-800/80 border border-slate-700 text-left">
              <div class="text-[10px] text-slate-400">企業への確認</div>
              <div class="text-base font-bold text-indigo-300">${raSummary.companyCheck} <span class="text-[10px] font-normal text-slate-400">件</span></div>
            </div>

            <div class="p-2 rounded-lg bg-slate-800/80 border border-slate-700 text-left">
              <div class="text-[10px] text-slate-400">CAへの確認</div>
              <div class="text-base font-bold text-purple-300">${raSummary.caCheck} <span class="text-[10px] font-normal text-slate-400">件</span></div>
            </div>

            <div class="p-2 rounded-lg bg-slate-800/80 border border-slate-700 text-left">
              <div class="text-[10px] text-slate-400">企業回答待ち</div>
              <div class="text-base font-bold text-sky-300">${raSummary.companyWaiting} <span class="text-[10px] font-normal text-slate-400">件</span></div>
            </div>
          </div>

          <!-- 折りたたみ可能な案件リスト (指示書 11, 14, 20, 22項) -->
          ${isRaAreaOpen ? `
            <div class="pt-2 border-t border-slate-800 space-y-3">
              <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2.5">
                ${displayedRaSelections.length === 0 ? `
                  <div class="col-span-full py-6 text-center text-slate-400 text-xs">本日対応すべきRA案件はありません。</div>
                ` : displayedRaSelections.map(s => renderRaCardHTML(s, lastUpdatedSelectionId === s.selectionId)).join('')}
              </div>

              ${normalSels.length > 5 ? `
                <div class="text-center pt-1">
                  <button id="btn-toggle-ra-limit" class="px-4 py-1 bg-slate-800 hover:bg-slate-700 text-indigo-300 font-bold rounded text-[11px] border border-slate-700 transition">
                    ${showAllRaItems ? '折りたたむ (通常表示に戻す)' : `すべて表示する (全 ${raActionSelections.length} 件)`}
                  </button>
                </div>
              ` : ''}
            </div>
          ` : ''}
        </div>

        <!-- 【下部】現在のCA別ホワイトボード (5区分フェーズ行 ＆ 既存レイアウト保持) (指示書 3, 5, 8, 9, 24, 25, 26項) -->
        <div class="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden p-4 space-y-4">
          <div id="kanban-horizontal-scroll-container" class="overflow-x-auto">
            <div class="min-w-[800px] space-y-4">
              ${sorted5Phases.map((pObj) => {
                // ホワイトボード5区分グループに属する案件のフィルタリング
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
                    <!-- 5区分フェーズヘッダーバー (指示書 4, 5項) (レベル表記は排除) -->
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

                    <!-- カラム（CA別・チーム全体等）グリッド (指示書 2, 8, 9項) -->
                    <div class="grid grid-cols-${Math.min(columns.length, 4)} divide-x divide-slate-200 p-2 gap-2 bg-slate-100/50 min-h-[140px]">
                      ${columns.map(col => {
                        const colGroupSels = groupSels.filter(s => col.filterFn(s));
                        const colYomi = colGroupSels.reduce((sum, s) => sum + (s.phase === '内定辞退' ? 0 : Number(s.yomi || 0)), 0);
                        const colPeople = calculateUniqueCandidatesCount(colGroupSels, false);

                        return `
                          <div class="bg-slate-50 p-2 rounded-lg border border-slate-200 flex flex-col justify-between" data-column-id="${col.id}">
                            <div class="flex items-center justify-between border-b border-slate-200 pb-1.5 mb-2">
                              <span class="font-bold text-xs text-slate-800 line-clamp-1">${col.title}</span>
                              <span class="text-[10px] text-slate-500 font-medium">
                                案件:${colGroupSels.length} / 実人数:${colPeople} / ヨミ:${Math.round(colYomi * 100) / 100}
                              </span>
                            </div>

                            <!-- ドロップゾーン -->
                            <div
                              class="kanban-drop-zone space-y-2 flex-1 min-h-[100px] p-1 rounded transition"
                              data-drop-group="${pObj.label}"
                            >
                              ${colGroupSels.length === 0 ? `
                                <div class="h-full border border-dashed border-slate-200 rounded flex items-center justify-center text-[10px] text-slate-400 py-6">
                                  案件なし
                                </div>
                              ` : colGroupSels.map(s => renderCaCardHTML(s, lastUpdatedSelectionId === s.selectionId)).join('')}
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

    // -------------------------------------------------------------
    // イベントバインド
    // -------------------------------------------------------------

    container.querySelector('#btn-toggle-ra-area')?.addEventListener('click', () => { isRaAreaOpen = !isRaAreaOpen; updateView({ preserveScroll: true }); });
    container.querySelector('#btn-toggle-ra-limit')?.addEventListener('click', () => { showAllRaItems = !showAllRaItems; updateView({ preserveScroll: true }); });

    container.querySelector('#chk-wb-only-mine')?.addEventListener('change', (e) => { filterOnlyMine = e.target.checked; updateView({ preserveScroll: true }); });
    container.querySelector('#select-wb-ra-filter')?.addEventListener('change', (e) => { filterRaId = e.target.value; updateView({ preserveScroll: true }); });

    container.querySelector('#kanban-axis-mode')?.addEventListener('change', (e) => {
      selectedAxisMode = e.target.value;
      saveKanbanState({ axisMode: selectedAxisMode, scrollTop: 0, scrollLeft: 0 });
      updateView({ preserveScroll: false });
    });

    // 上部RA対応カードの操作イベント (指示書 20, 21項)
    container.querySelectorAll('.btn-wb-email').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        onOpenEmailComposer(btn.getAttribute('data-company-id'), [btn.getAttribute('data-selection-id')]);
      });
    });

    container.querySelectorAll('.btn-wb-mark-contacted').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        openContactedModal(btn.getAttribute('data-selection-id'), () => updateView({ preserveScroll: true }));
      });
    });

    container.querySelectorAll('.btn-card-detail').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        saveKanbanState({
          scrollTop: window.scrollY || document.documentElement.scrollTop,
          scrollLeft: scrollContainer ? scrollContainer.scrollLeft : 0,
          axisMode: selectedAxisMode
        });
        onOpenDetail(btn.getAttribute('data-id'));
      });
    });

    // ドラッグ＆ドロップ ＆ フェーズ選択ダイアログ (指示書 9項)
    let draggedSelectionId = null;

    container.querySelectorAll('[draggable="true"]').forEach(card => {
      card.addEventListener('dragstart', (e) => {
        draggedSelectionId = card.getAttribute('data-selection-id');
        e.dataTransfer.setData('text/plain', draggedSelectionId);
        card.classList.add('opacity-40');
      });

      card.addEventListener('dragend', () => {
        card.classList.remove('opacity-40');
      });
    });

    container.querySelectorAll('.kanban-drop-zone').forEach(zone => {
      zone.addEventListener('dragover', (e) => {
        e.preventDefault();
        zone.classList.add('bg-indigo-50/80', 'border-2', 'border-dashed', 'border-indigo-400');
      });

      zone.addEventListener('dragleave', () => {
        zone.classList.remove('bg-indigo-50/80', 'border-2', 'border-dashed', 'border-indigo-400');
      });

      zone.addEventListener('drop', (e) => {
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
                updateView({ preserveScroll: true }); // 即時上下連動更新 (指示書 25項)
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

/**
 * 上部「本日のRA対応」カードHTML (指示書 14, 17項)
 */
function renderRaCardHTML(s, isHighlighted) {
  const uObj = s.urgencyInfo;
  const targetObj = NEXT_ACTION_TARGETS.find(t => t.code === s.nextActionTargetCode) || NEXT_ACTION_TARGETS[0];

  return `
    <div
      data-selection-id="${s.selectionId}"
      class="bg-slate-800 rounded-lg p-2.5 shadow-sm border border-slate-700 space-y-1.5 text-slate-200 ${isHighlighted ? 'ring-2 ring-indigo-400' : ''}"
    >
      <div class="flex items-start justify-between gap-1 border-b border-slate-700/60 pb-1.5">
        <div>
          <div class="font-bold text-xs text-white">
            ${s.candidateObj ? s.candidateObj.name : s.candidateName} 様
          </div>
          <div class="text-[10px] text-slate-400 line-clamp-1">
            ${s.companyObj ? s.companyObj.name : s.companyName}
          </div>
        </div>

        <div class="flex flex-col items-end space-y-0.5">
          <span class="px-1.5 py-0.2 rounded text-[8px] ${uObj.badgeClass}">${uObj.label}</span>
          <span class="px-1 py-0.2 rounded text-[8px] font-bold ${targetObj.badgeClass}">対応先: ${targetObj.label}</span>
        </div>
      </div>

      <div class="text-[10px] text-indigo-300 font-bold flex items-center justify-between">
        <span>${s.phase} (${s.progressStatus})</span>
        <span class="text-slate-400">CA: ${s.caObj ? s.caObj.name.split(' ')[0] : s.caName || '-'}</span>
      </div>

      <div class="text-[10px] text-slate-300 bg-slate-900/60 px-2 py-1 rounded border border-slate-700 line-clamp-1">
        <strong class="text-indigo-400 font-bold">次:</strong> ${s.nextActionText}
      </div>

      <div class="pt-1 flex items-center justify-end space-x-1 text-[10px]">
        <button class="btn-wb-email px-2 py-0.5 bg-indigo-600 hover:bg-indigo-500 text-white font-bold rounded transition" data-company-id="${s.companyId}" data-selection-id="${s.selectionId}">
          メール
        </button>
        <button class="btn-wb-mark-contacted px-2 py-0.5 bg-slate-700 hover:bg-slate-600 text-white font-bold rounded transition" data-selection-id="${s.selectionId}">
          連絡済み
        </button>
        <button class="btn-card-detail px-2 py-0.5 bg-slate-700 hover:bg-slate-600 text-slate-200 rounded transition font-bold" data-id="${s.selectionId}">
          詳細
        </button>
      </div>
    </div>
  `;
}

/**
 * 下部「CA別ホワイトボード」カードHTML (指示書 5, 6, 7, 8, 9, 11項 - コンパクト最適化)
 */
function renderCaCardHTML(s, isHighlighted) {
  const isDeclined = s.phase === '内定辞退';
  const uObj = s.urgencyInfo;

  return `
    <div
      draggable="${isDeclined ? 'false' : 'true'}"
      data-selection-id="${s.selectionId}"
      class="rounded-lg p-2.5 shadow-xs transition space-y-1.5 border text-xs ${
        isDeclined
          ? 'bg-slate-200/80 border-slate-300 text-slate-500 cursor-default opacity-75'
          : 'bg-white border-slate-200 hover:shadow-md hover:border-indigo-400 cursor-grab active:cursor-grabbing group'
      } ${isHighlighted ? 'ring-4 ring-indigo-500 scale-[1.02] border-indigo-500 font-semibold shadow-md' : ''}"
    >
      <!-- 1行目: 候補者名 (最強調) ＆ バッジ (指示書 7, 8項) -->
      <div class="flex items-start justify-between gap-1 border-b border-slate-100 pb-1">
        <div class="font-extrabold text-xs text-slate-900 line-clamp-1 group-hover:text-indigo-600 transition" title="${s.candidateObj ? s.candidateObj.name : s.candidateName}">
          ${s.candidateObj ? s.candidateObj.name : s.candidateName} 様
        </div>

        ${isDeclined ? `
          <span class="px-1.5 py-0.2 rounded text-[9px] font-extrabold bg-slate-500 text-white shrink-0">内定辞退</span>
        ` : (uObj.code === 'expired' || uObj.code === 'today') ? `
          <span class="px-1.5 py-0.2 rounded text-[8px] font-extrabold ${uObj.badgeClass} shrink-0">${uObj.label}</span>
        ` : ''}
      </div>

      <!-- 2行目: 企業名 ｜ 求人名 (指示書 7項) -->
      <div class="text-[10px] text-slate-600 font-medium line-clamp-1" title="${s.companyObj ? s.companyObj.name : s.companyName} ｜ ${s.jobObj ? (s.jobObj.title || s.jobObj.jobName) : s.jobName}">
        <span class="font-bold text-slate-800">${s.companyObj ? s.companyObj.name : s.companyName}</span>
        <span class="text-slate-400 mx-0.5">｜</span>
        <span>${s.jobObj ? (s.jobObj.title || s.jobObj.jobName) : s.jobName}</span>
      </div>

      <!-- 3行目: 実際の選考フェーズ ｜ 進行状態 (指示書 7項) -->
      <div class="text-[10px] ${isDeclined ? 'text-slate-600 bg-slate-300/40' : 'text-indigo-900 bg-indigo-50/70'} px-2 py-0.5 rounded border border-indigo-100/80 font-bold flex items-center justify-between">
        <span>${s.phase}</span>
        <span class="font-medium text-slate-600 text-[9px]">｜ ${s.progressStatus}</span>
      </div>

      <!-- 4行目: 日付 ＆ ヨミ ＆ 担当RA (指示書 7項) -->
      <div class="text-[9px] text-slate-500 flex items-center justify-between pt-0.5">
        <div class="flex items-center space-x-1.5">
          ${s.nextScheduleDate ? `<span class="font-mono text-slate-700">次回 ${s.nextScheduleDate.slice(5)}</span>` : ''}
          ${!isDeclined ? `<span class="font-bold ${s.yomi >= 0.75 ? 'text-indigo-700' : 'text-slate-600'}">ヨミ${s.yomi * 100}%</span>` : ''}
        </div>
        <span class="text-slate-400">RA:${s.raObj ? s.raObj.name.split(' ')[0] : s.raName || '-'}</span>
      </div>

      <!-- ワンポイントRA対応 (必要な場合のみ1行) (指示書 9項) -->
      ${!isDeclined && s.nextActionText && s.nextActionText !== '対応完了' && s.nextActionText !== '要確認' ? `
        <div class="text-[9px] text-indigo-700 bg-slate-50 px-1.5 py-0.5 rounded border border-slate-200/80 line-clamp-1 font-semibold">
          ⚡ ${s.nextActionText}
        </div>
      ` : ''}

      <button class="btn-card-detail w-full mt-1 py-0.5 bg-slate-50 hover:bg-indigo-600 hover:text-white text-slate-700 text-[10px] font-bold rounded transition border border-slate-200 shadow-2xs" data-id="${s.selectionId}">
        詳細画面を開く
      </button>
    </div>
  `;
}

/**
 * ドロップ時の実フェーズ選択ダイアログ (指示書 9項)
 */
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
