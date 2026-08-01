/**
 * 選考進捗・ヨミ管理システム - 企業対応リスト画面コンポーネント (指示書 3, 12〜27項 - タイトル簡略化 ＆ 3ブロック表示最適化)
 */

import { store } from '../store.js';
import { COMPANY_ACTION_TYPES, COMPANY_ACTION_STATUSES } from '../constants.js';
import { getDateInfoForSelection, normalizeCandidateName } from '../utils/mailTemplate.js';
import { calculateUniqueCandidatesCount } from '../utils/yomiCalculations.js';

const ACTION_LIST_STORAGE_KEY = 'company_action_list_active_state';

function getSavedActionState() {
  try {
    const raw = sessionStorage.getItem(ACTION_LIST_STORAGE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch (e) {
    return {};
  }
}

function saveActionState(state) {
  try {
    const current = getSavedActionState();
    sessionStorage.setItem(ACTION_LIST_STORAGE_KEY, JSON.stringify({ ...current, ...state }));
  } catch (e) {}
}

/**
 * 候補者選考案件が「対応対象」かどうかを判定 (指示書 11, 27項)
 */
function isActionNeededSelection(s, today) {
  if (s.phase === '選考終了' || s.phase === '内定辞退') return false;
  if (s.companyActionStatus === '完了' || s.companyActionStatus === '対応完了') return false;

  if (s.progressStatus === '実施済み・結果待ち') return true;
  if (s.companyActionStatus === '未対応' || s.companyActionStatus === '回答待ち' || s.companyActionStatus === '催促中' || s.companyActionStatus === 'CA確認待ち') return true;
  if (s.actionDeadline && new Date(s.actionDeadline) <= today) return true;
  if (s.nextCompanyContactDate && new Date(s.nextCompanyContactDate) <= today) return true;
  if (s.phase === '書類選考' && s.progressStatus === '未対応') return true;
  if (s.phase.includes('面接') && (s.progressStatus === '日程調整中' || s.progressStatus === '未対応')) return true;
  if (s.phase === 'オファー面談・条件提示' || s.phase === '内定') return true;

  return false;
}

export function renderCompanyActionListView(container, { onOpenDetail, onOpenEmailComposer }) {
  const currentCons = store.getCurrentConsultant();
  const savedState = getSavedActionState();

  let filterPriority = savedState.filterPriority || '';
  let filterRaId = savedState.filterRaId !== undefined ? savedState.filterRaId : (currentCons.roleType === 'RA' ? currentCons.consultantId : '');
  let filterOnlyMine = savedState.filterOnlyMine !== undefined ? savedState.filterOnlyMine : (currentCons.roleType === 'RA');
  let searchKw = savedState.searchKw || '';
  let sortBy = savedState.sortBy || 'priority_default';
  let openCompanyIds = new Set(savedState.openCompanyIds || []);
  let showModeMap = savedState.showModeMap || {};

  function updateView(options = {}) {
    const savedScrollY = options.preserveScroll !== false ? (window.scrollY || document.documentElement.scrollTop) : 0;

    const companies = store.getCompanies();
    const selections = store.getSelections();
    const consultants = store.getConsultants();
    const jobs = store.getJobs();
    const candidates = store.getCandidates();
    const histories = store.getHistories();

    const consultantsMap = new Map(consultants.map(c => [c.consultantId, c]));
    const candidatesMap = new Map(candidates.map(c => [c.candidateId, c]));
    const jobsMap = new Map(jobs.map(j => [j.jobId, j]));
    const raConsultants = consultants.filter(c => c.roleType === 'RA' || c.roleType === 'ADMIN');

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // 企業ごとの優先度判定・最優先代表アクション算出 (指示書 13, 14, 15項)
    const companyActionCards = companies.map(comp => {
      const compSelections = selections.filter(s => !s.isArchived && s.companyId === comp.companyId);
      const activeSelections = compSelections.filter(s => s.phase !== '選考終了' && s.phase !== '内定辞退');
      const actionNeededSelections = compSelections.filter(s => isActionNeededSelection(s, today));

      let expiredCount = 0;
      let todayCount = 0;
      let waitingCount = 0;
      let caCheckCount = 0;
      let topActionText = '';

      actionNeededSelections.forEach(s => {
        const u = s.urgencyInfo || {};
        if (u.code === 'expired') expiredCount++;
        else if (u.code === 'today') todayCount++;
        else if (u.code === 'waiting') waitingCount++;
        else if (u.code === 'ca_check') caCheckCount++;

        if (!topActionText) {
          const cand = candidatesMap.get(s.candidateId);
          const cName = cand ? cand.name : (s.candidateName || '');
          topActionText = s.nextAction ? `${cName}様: ${s.nextAction}` : `${cName}様: 選考結果・進捗の確認`;
        }
      });

      // 優先順位スコア計算 (指示書 15項)
      let priorityScore = 0;
      if (expiredCount > 0) priorityScore = 5;
      else if (todayCount > 0) priorityScore = 4;
      else if (actionNeededSelections.length > 0) priorityScore = 3;
      else if (waitingCount > 0) priorityScore = 2;
      else if (caCheckCount > 0) priorityScore = 1;

      const primaryRa = consultantsMap.get(comp.primaryRaId || comp.raConsultantId);
      const uniquePeople = calculateUniqueCandidatesCount(activeSelections, false);

      return {
        company: comp,
        primaryRa,
        allSelections: compSelections,
        activeSelections,
        actionNeededSelections,
        inProgressCount: activeSelections.length,
        actionNeededCount: actionNeededSelections.length,
        expiredCount,
        todayCount,
        waitingCount,
        caCheckCount,
        topActionText: topActionText || '特になし',
        uniquePeople,
        priorityScore
      };
    });

    let filtered = companyActionCards.filter(card => {
      if (card.company.isArchived) return false;
      if (filterOnlyMine && card.company.primaryRaId !== currentCons.consultantId) return false;
      if (filterRaId && card.company.primaryRaId !== filterRaId) return false;

      if (searchKw) {
        const kw = searchKw.toLowerCase();
        if (!card.company.name.toLowerCase().includes(kw)) return false;
      }

      if (filterPriority === 'expired' && card.expiredCount === 0) return false;
      if (filterPriority === 'today' && card.todayCount === 0) return false;

      return true;
    });

    // 指示書 15項のデフォルト並び順：期限超過 ➔ 本日対応 ➔ 要確認 ➔ 企業回答待ち ➔ CA確認 ➔ 企業名
    filtered.sort((a, b) => {
      if (sortBy === 'priority_default') {
        const diff = b.priorityScore - a.priorityScore;
        if (diff !== 0) return diff;
        return a.company.name.localeCompare(b.company.name, 'ja');
      }
      if (sortBy === 'action_count_desc') return b.actionNeededCount - a.actionNeededCount;
      return a.company.name.localeCompare(b.company.name, 'ja');
    });

    saveActionState({
      filterPriority,
      filterRaId,
      filterOnlyMine,
      searchKw,
      sortBy,
      openCompanyIds: Array.from(openCompanyIds),
      showModeMap,
      scrollTop: savedScrollY
    });

    container.innerHTML = `
      <div class="space-y-5">
        <!-- 画面ヘッダー (指示書 3, 4項) -->
        <div class="bg-white p-4 rounded-xl border border-slate-200 shadow-sm flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h2 class="text-lg font-bold text-slate-900 flex items-center gap-2">
              <svg class="w-5 h-5 text-indigo-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4"></path></svg>
              企業対応
            </h2>
            <p class="text-xs text-slate-500 mt-0.5">企業ごとの緊急度と本日のRA対応・優先アクションを確認できます</p>
          </div>

          <div class="flex items-center space-x-3 text-xs">
            <label class="inline-flex items-center space-x-1.5 font-bold text-slate-700 cursor-pointer">
              <input type="checkbox" id="chk-action-only-mine" ${filterOnlyMine ? 'checked' : ''} class="rounded text-indigo-600">
              <span>自分の担当企業のみ表示</span>
            </label>

            <select id="select-action-ra-filter" class="bg-slate-50 border border-slate-300 font-bold rounded px-3 py-1.5 text-slate-800 focus:outline-none">
              <option value="">すべてのRA担当</option>
              ${raConsultants.map(c => `<option value="${c.consultantId}" ${filterRaId === c.consultantId ? 'selected' : ''}>${c.name} (RA)</option>`).join('')}
            </select>
          </div>
        </div>

        <!-- 検索 ＆ フィルター (指示書 15項) -->
        <div class="bg-white p-3.5 rounded-xl border border-slate-200 shadow-sm flex flex-wrap items-center justify-between gap-3 text-xs">
          <div class="flex flex-wrap items-center gap-3">
            <input type="text" id="input-action-search-kw" value="${searchKw}" placeholder="企業名で検索..." class="bg-slate-50 border border-slate-300 rounded px-3 py-1.5 focus:outline-none focus:bg-white focus:border-indigo-600 min-w-[200px]">

            <select id="select-action-priority" class="bg-slate-50 border border-slate-300 rounded px-2.5 py-1.5 focus:outline-none font-bold text-indigo-900">
              <option value="">すべての絞り込み</option>
              <option value="expired" ${filterPriority === 'expired' ? 'selected' : ''}>🚨 期限超過あり</option>
              <option value="today" ${filterPriority === 'today' ? 'selected' : ''}>⏰ 本日対応あり</option>
            </select>
          </div>

          <div class="flex items-center space-x-2">
            <span class="text-slate-500 font-semibold">並び順:</span>
            <select id="select-action-sort" class="bg-slate-100 border border-slate-300 rounded px-2.5 py-1.5 font-bold text-slate-800 focus:outline-none">
              <option value="priority_default" ${sortBy === 'priority_default' ? 'selected' : ''}>優先度が高い順 (初期表示)</option>
              <option value="action_count_desc" ${sortBy === 'action_count_desc' ? 'selected' : ''}>対応対象件数が多い順</option>
              <option value="name_asc" ${sortBy === 'name_asc' ? 'selected' : ''}>企業名順</option>
            </select>
          </div>
        </div>

        <!-- 企業対応リスト アコーディオンテーブル (指示書 12, 13, 14項) -->
        <div class="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden space-y-2">
          <div class="px-4 py-3 bg-slate-900 text-white flex items-center justify-between">
            <h3 class="font-bold text-xs">企業一覧 (${filtered.length}社) <span class="text-[11px] font-normal text-slate-400">（行をクリックすると対応案件を展開します）</span></h3>
          </div>

          <div class="divide-y divide-slate-200 text-xs">
            ${filtered.length === 0 ? `
              <div class="text-center py-8 text-slate-400">該当する対応企業がありません。</div>
            ` : filtered.map(card => {
              const comp = card.company;
              const ra = card.primaryRa;
              const isOpen = openCompanyIds.has(comp.companyId);
              const showMode = showModeMap[comp.companyId] || 'action_needed';

              let displaySelections = card.actionNeededSelections;
              if (showMode === 'in_progress') displaySelections = card.activeSelections;
              if (showMode === 'all') displaySelections = card.allSelections;

              return `
                <!-- 企業ヘッダー行 (指示書 13, 14項) -->
                <div class="action-company-row hover:bg-indigo-50/50 transition cursor-pointer p-3 flex flex-col md:flex-row md:items-center justify-between gap-3 ${isOpen ? 'bg-indigo-50/70 border-l-4 border-indigo-600' : ''}" data-company-id="${comp.companyId}">
                  <!-- 左側: 企業名 ＆ ランク ＆ RA -->
                  <div class="flex items-center space-x-3 min-w-[220px]">
                    <span class="font-bold text-indigo-600 text-xs">${isOpen ? '▼' : '▶'}</span>
                    <div>
                      <div class="font-extrabold text-slate-900 text-xs flex items-center gap-2">
                        <span>${comp.name}</span>
                        ${comp.rank ? `<span class="text-[9px] px-1.5 py-0.2 rounded font-black bg-slate-100 text-slate-800 border border-slate-300">${comp.rank}</span>` : ''}
                      </div>
                      <div class="text-[10px] text-slate-500 font-medium">担当RA: ${ra ? ra.name : '未設定'}</div>
                    </div>
                  </div>

                  <!-- 中央: 対応対象件数 ＆ 内訳バッジ (指示書 13項) -->
                  <div class="flex items-center space-x-2 text-[11px]">
                    <span class="font-extrabold px-2.5 py-1 rounded border ${card.actionNeededCount > 0 ? 'bg-rose-100 text-rose-900 border-rose-300 font-black' : 'bg-slate-100 text-slate-600 border-slate-200'}">
                      対応 ${card.actionNeededCount}件
                    </span>
                    ${card.expiredCount > 0 ? `<span class="px-2 py-0.5 rounded text-[10px] font-black bg-rose-600 text-white animate-pulse">期限超過 ${card.expiredCount}件</span>` : ''}
                    ${card.todayCount > 0 ? `<span class="px-2 py-0.5 rounded text-[10px] font-bold bg-amber-100 text-amber-900 border border-amber-300">本日対応 ${card.todayCount}件</span>` : ''}
                    ${card.waitingCount > 0 ? `<span class="px-2 py-0.5 rounded text-[10px] font-bold bg-blue-100 text-blue-900 border border-blue-200">回答待ち ${card.waitingCount}件</span>` : ''}
                  </div>

                  <!-- 右側: 最優先の次アクション (代表1件表示) ＆ 操作 (指示書 14, 26項) -->
                  <div class="flex items-center justify-between md:justify-end space-x-3 flex-1">
                    <div class="text-right max-w-xs truncate hidden sm:block">
                      <span class="text-[10px] font-bold text-slate-500 block">最優先アクション</span>
                      <span class="text-[11px] font-bold text-indigo-900 truncate block" title="${card.topActionText}">⚡ ${card.topActionText}</span>
                    </div>

                    <div class="flex items-center space-x-2">
                      <button class="btn-create-email-comp stop-propagation px-3 py-1 bg-indigo-600 hover:bg-indigo-500 text-white font-bold rounded text-xs shadow-2xs transition" data-company-id="${comp.companyId}">
                        メール作成
                      </button>
                    </div>
                  </div>
                </div>

                <!-- アコーディオン展開エリア: 候補者行 (指示書 16, 17, 18, 19, 20, 21, 23, 24, 25項) -->
                ${isOpen ? `
                  <div class="bg-slate-50 p-3 border-t border-slate-200 space-y-3">
                    <!-- アコーディオン上部コントロール -->
                    <div class="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 pb-2.5">
                      <div class="flex items-center space-x-3 text-xs">
                        <span class="font-bold text-slate-800">表示切替:</span>
                        <div class="flex items-center space-x-1 bg-white p-0.5 rounded border border-slate-300 font-bold text-[11px]">
                          <label class="px-2 py-0.5 rounded cursor-pointer ${showMode === 'action_needed' ? 'bg-indigo-600 text-white' : 'text-slate-600'}">
                            <input type="radio" name="show_mode_${comp.companyId}" value="action_needed" ${showMode === 'action_needed' ? 'checked' : ''} class="hidden radio-show-mode" data-company-id="${comp.companyId}">
                            対応対象のみ (${card.actionNeededCount})
                          </label>
                          <label class="px-2 py-0.5 rounded cursor-pointer ${showMode === 'in_progress' ? 'bg-indigo-600 text-white' : 'text-slate-600'}">
                            <input type="radio" name="show_mode_${comp.companyId}" value="in_progress" ${showMode === 'in_progress' ? 'checked' : ''} class="hidden radio-show-mode" data-company-id="${comp.companyId}">
                            進行中すべて (${card.inProgressCount})
                          </label>
                          <label class="px-2 py-0.5 rounded cursor-pointer ${showMode === 'all' ? 'bg-indigo-600 text-white' : 'text-slate-600'}">
                            <input type="radio" name="show_mode_${comp.companyId}" value="all" ${showMode === 'all' ? 'checked' : ''} class="hidden radio-show-mode" data-company-id="${comp.companyId}">
                            過去含む (${card.allSelections.length})
                          </label>
                        </div>
                      </div>

                      <div class="flex items-center space-x-2">
                        <button class="btn-mark-contacted-selected-action px-3 py-1 bg-slate-800 hover:bg-slate-700 text-white font-bold rounded text-xs transition" data-company-id="${comp.companyId}">
                          選択案件を連絡済みにする
                        </button>
                        <button class="btn-create-email-selected-action px-3 py-1 bg-emerald-600 hover:bg-emerald-500 text-white font-bold rounded text-xs transition" data-company-id="${comp.companyId}">
                          選択した案件でメール作成
                        </button>
                      </div>
                    </div>

                    <!-- 候補者行リスト (3ブロック整理: 左:案件 / 中央:対応情報 / 右:操作) (指示書 17項) -->
                    <div class="space-y-2">
                      ${displaySelections.length === 0 ? `
                        <div class="text-center py-4 text-slate-400 bg-white rounded border border-slate-200">対象案件はありません。</div>
                      ` : displaySelections.map(s => {
                        const isEnded = s.phase === '選考終了' || s.phase === '内定辞退';
                        const cand = candidatesMap.get(s.candidateId);
                        const job = jobsMap.get(s.jobId);
                        const ca = consultantsMap.get(s.caId || s.caConsultantId);
                        const isNeeded = isActionNeededSelection(s, today);

                        const nextTarget = s.nextActionTarget || (s.companyActionStatus === 'CA確認待ち' ? 'CA' : '企業');
                        const isTargetCa = nextTarget === 'CA';
                        const targetBadgeClass = isTargetCa ? 'bg-amber-100 text-amber-900 border-amber-300' : 'bg-indigo-100 text-indigo-900 border-indigo-200';
                        const targetLabel = isTargetCa ? '【CA確認】' : '【企業対応】';

                        const uObj = s.urgencyInfo || {};

                        return `
                          <div class="bg-white p-3 rounded-lg border border-slate-200 shadow-2xs flex flex-col md:flex-row md:items-center justify-between gap-3 hover:border-indigo-300 transition ${isEnded ? 'bg-slate-100/80 text-slate-400' : ''}">
                            <!-- チェックボックス & 左ブロック: 案件情報 (指示书 17項) -->
                            <div class="flex items-start space-x-2.5 min-w-[240px]">
                              <input type="checkbox" class="chk-action-cand-item mt-1" data-company-id="${comp.companyId}" data-selection-id="${s.selectionId}" ${isNeeded ? 'checked' : ''}>
                              <div>
                                <div class="font-extrabold text-slate-900 text-xs flex items-center gap-1.5">
                                  <span>${normalizeCandidateName(cand ? cand.name : s.candidateName)} 様</span>
                                  <span class="text-[10px] text-slate-500 font-normal">(CA: ${ca ? ca.name.split(' ')[0] : s.caName || '-'})</span>
                                </div>
                                <div class="text-[10px] text-slate-500 truncate max-w-[200px]" title="${job ? (job.title || job.jobName) : s.jobName}">
                                  ${job ? (job.title || job.jobName) : s.jobName}
                                </div>
                                <div class="text-[10px] font-bold text-indigo-900 mt-0.5">
                                  ${s.phase} <span class="text-slate-400 font-normal">｜ ${s.progressStatus}</span>
                                </div>
                              </div>
                            </div>

                            <!-- 中央ブロック: 対応情報 (次の対応・対応先・期限・ステータス) (指示書 17, 18, 19, 20, 21項) -->
                            <div class="flex-1 space-y-1">
                              <div class="flex flex-wrap items-center gap-1.5">
                                <span class="text-[10px] font-bold px-1.5 py-0.2 rounded border ${targetBadgeClass}">${targetLabel}</span>
                                <span class="font-extrabold text-xs text-indigo-950">
                                  ${s.nextAction || '要確認'}
                                </span>
                                ${uObj.badgeClass ? `<span class="px-1.5 py-0.2 rounded text-[9px] font-extrabold ${uObj.badgeClass}">${uObj.label}</span>` : ''}
                              </div>

                              <div class="flex flex-wrap items-center gap-3 text-[10px] text-slate-600">
                                ${s.companyConfirmationItem ? `<span class="text-slate-700 truncate max-w-sm" title="${s.companyConfirmationItem}">確認事項: ${s.companyConfirmationItem}</span>` : ''}
                                <span class="font-mono text-slate-500">期限: ${s.actionDeadline || s.nextCompanyContactDate || '未設定'}</span>
                                <span class="font-bold text-slate-700 bg-slate-100 px-1.5 py-0.2 rounded border border-slate-200">ステータス: ${s.companyActionStatus || '未対応'}</span>
                              </div>
                            </div>

                            <!-- 右ブロック: 操作 (指示書 17, 26項) -->
                            <div class="flex items-center space-x-1.5 shrink-0 justify-end">
                              <button class="btn-action-single-email px-2.5 py-1 bg-indigo-50 hover:bg-indigo-600 hover:text-white text-indigo-700 rounded font-bold text-xs transition border border-indigo-200" data-company-id="${comp.companyId}" data-selection-id="${s.selectionId}">
                                メール
                              </button>
                              <button class="btn-action-single-contacted px-2 py-1 bg-slate-100 hover:bg-slate-800 hover:text-white text-slate-700 rounded font-bold text-xs transition border border-slate-200" data-company-id="${comp.companyId}" data-selection-id="${s.selectionId}">
                                完了
                              </button>
                              <button class="btn-action-cand-detail px-2 py-1 bg-slate-100 hover:bg-indigo-600 hover:text-white text-slate-700 rounded font-bold text-xs transition border border-slate-200" data-id="${s.selectionId}">
                                詳細
                              </button>
                            </div>
                          </div>
                        `;
                      }).join('')}
                    </div>
                  </div>
                ` : ''}
              `;
            }).join('')}
          </div>
        </div>
      </div>
    `;

    if (options.preserveScroll !== false && savedScrollY > 0) {
      setTimeout(() => {
        window.scrollTo({ top: savedScrollY, behavior: 'instant' });
      }, 0);
    }

    container.querySelectorAll('.action-company-row').forEach(row => {
      row.addEventListener('click', (e) => {
        if (e.target.closest('.stop-propagation')) return;

        const cId = row.getAttribute('data-company-id');
        if (openCompanyIds.has(cId)) {
          openCompanyIds.delete(cId);
        } else {
          openCompanyIds.add(cId);
        }

        saveActionState({
          openCompanyIds: Array.from(openCompanyIds),
          scrollTop: window.scrollY || document.documentElement.scrollTop
        });
        updateView({ preserveScroll: true });
      });
    });

    container.querySelectorAll('.stop-propagation').forEach(btn => {
      btn.addEventListener('click', (e) => e.stopPropagation());
    });

    container.querySelector('#chk-action-only-mine')?.addEventListener('change', (e) => { filterOnlyMine = e.target.checked; updateView({ preserveScroll: true }); });
    container.querySelector('#select-action-ra-filter')?.addEventListener('change', (e) => { filterRaId = e.target.value; updateView({ preserveScroll: true }); });
    container.querySelector('#input-action-search-kw')?.addEventListener('input', (e) => { searchKw = e.target.value; updateView({ preserveScroll: true }); });
    container.querySelector('#select-action-priority')?.addEventListener('change', (e) => { filterPriority = e.target.value; updateView({ preserveScroll: true }); });
    container.querySelector('#select-action-sort')?.addEventListener('change', (e) => { sortBy = e.target.value; updateView({ preserveScroll: true }); });

    container.querySelectorAll('.radio-show-mode').forEach(radio => {
      radio.addEventListener('change', (e) => {
        const cId = radio.getAttribute('data-company-id');
        showModeMap[cId] = radio.value;
        updateView({ preserveScroll: true });
      });
    });

    container.querySelectorAll('.btn-create-email-selected-action').forEach(btn => {
      btn.addEventListener('click', () => {
        const cId = btn.getAttribute('data-company-id');
        const checkedItems = container.querySelectorAll(`.chk-action-cand-item[data-company-id="${cId}"]:checked`);
        const selIds = Array.from(checkedItems).map(item => item.getAttribute('data-selection-id'));

        if (selIds.length === 0) {
          alert('メールに含める選考案件にチェックを入れてください。');
          return;
        }

        saveActionState({ scrollTop: window.scrollY || document.documentElement.scrollTop });
        onOpenEmailComposer(cId, selIds);
      });
    });

    container.querySelectorAll('.btn-create-email-comp').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const cId = btn.getAttribute('data-company-id');
        const card = companyActionCards.find(c => c.company.companyId === cId);
        const selIds = card ? card.actionNeededSelections.map(s => s.selectionId) : [];

        saveActionState({ scrollTop: window.scrollY || document.documentElement.scrollTop });
        onOpenEmailComposer(cId, selIds.length > 0 ? selIds : null);
      });
    });

    container.querySelectorAll('.btn-action-single-email').forEach(btn => {
      btn.addEventListener('click', () => {
        const cId = btn.getAttribute('data-company-id');
        const selId = btn.getAttribute('data-selection-id');
        saveActionState({ scrollTop: window.scrollY || document.documentElement.scrollTop });
        onOpenEmailComposer(cId, [selId]);
      });
    });

    container.querySelectorAll('.btn-mark-contacted-selected-action').forEach(btn => {
      btn.addEventListener('click', () => {
        const cId = btn.getAttribute('data-company-id');
        const checkedItems = container.querySelectorAll(`.chk-action-cand-item[data-company-id="${cId}"]:checked`);
        const selIds = Array.from(checkedItems).map(item => item.getAttribute('data-selection-id'));

        if (selIds.length === 0) {
          alert('連絡済みにする選考案件にチェックを入れてください。');
          return;
        }

        if (confirm(`選択した ${selIds.length} 件の選考案件を連絡済みに更新しますか？`)) {
          selIds.forEach(id => {
            store.updateSelection(id, { companyActionStatus: '完了' }, '企業対応リストからの完了更新');
          });
          alert('選択した選考案件を連絡済みに更新しました。');
          updateView({ preserveScroll: true });
        }
      });
    });

    container.querySelectorAll('.btn-action-single-contacted').forEach(btn => {
      btn.addEventListener('click', () => {
        const selId = btn.getAttribute('data-selection-id');
        store.updateSelection(selId, { companyActionStatus: '完了' }, '個別の企業対応完了');
        updateView({ preserveScroll: true });
      });
    });

    container.querySelectorAll('.btn-action-cand-detail').forEach(btn => {
      btn.addEventListener('click', () => {
        saveActionState({ scrollTop: window.scrollY || document.documentElement.scrollTop });
        onOpenDetail(btn.getAttribute('data-id'));
      });
    });
  }

  updateView({ preserveScroll: true });
}
