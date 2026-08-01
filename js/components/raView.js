/**
 * 選考進捗・ヨミ管理システム - RA用画面コンポーネント (担当企業管理 & 選考終了・内定辞退集計除外対応)
 */

import { store } from '../store.js';
import { PHASES, PROGRESS_STATUSES, YOMI_OPTIONS, COMPANY_RANKS, COMPANY_RANK_BADGES } from '../constants.js';
import { calculateUniqueCandidatesCount, getSelectionAlerts } from '../utils/yomiCalculations.js';

const RA_STORAGE_KEY = 'ra_view_active_state';

function getSavedRaState() {
  try {
    const raw = sessionStorage.getItem(RA_STORAGE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch (e) {
    return {};
  }
}

function saveRaState(state) {
  try {
    const current = getSavedRaState();
    sessionStorage.setItem(RA_STORAGE_KEY, JSON.stringify({ ...current, ...state }));
  } catch (e) {}
}

export function renderRaView(container, { onOpenDetail, onOpenEmailComposer }) {
  const currentCons = store.getCurrentConsultant();
  const savedState = getSavedRaState();

  let filterRaId = savedState.filterRaId !== undefined ? savedState.filterRaId : (currentCons.roleType === 'RA' ? currentCons.consultantId : '');
  let filterOnlyMine = savedState.filterOnlyMine !== undefined ? savedState.filterOnlyMine : (currentCons.roleType === 'RA');
  let searchCompName = savedState.searchCompName || '';
  let filterRank = savedState.filterRank || '';
  let filterHasWaiting = savedState.filterHasWaiting || false;
  let filterHasRemind = savedState.filterHasRemind || false;
  let sortBy = savedState.sortBy || 'rank_desc';
  let openCompanyIds = new Set(savedState.openCompanyIds || []);
  let showEndedSelections = savedState.showEndedSelections || {}; // { companyId: boolean }

  function updateView(options = {}) {
    const savedScrollY = options.preserveScroll !== false ? (window.scrollY || document.documentElement.scrollTop) : 0;

    const companies = store.getCompanies();
    const selections = store.getSelections();
    const consultants = store.getConsultants();
    const jobs = store.getJobs();
    const candidates = store.getCandidates();

    const raConsultants = consultants.filter(c => c.roleType === 'RA' || c.roleType === 'ADMIN');
    const consultantsMap = new Map(consultants.map(c => [c.consultantId, c]));
    const candidatesMap = new Map(candidates.map(c => [c.candidateId, c]));
    const jobsMap = new Map(jobs.map(j => [j.jobId, j]));

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // 企業ごとの集計・案件作成 (選考終了および内定辞退は進行中集計から除外) (指示書 10項)
    const companyCards = companies.map(comp => {
      const compSelections = selections.filter(s => !s.isArchived && s.companyId === comp.companyId);
      const activeSelections = compSelections.filter(s => s.phase !== '選考終了' && s.phase !== '内定辞退');
      const waitingCount = activeSelections.filter(s => s.progressStatus === '実施済み・結果待ち').length;
      const remindCount = activeSelections.filter(s => s.companyActionStatus === '未対応' || s.companyActionStatus === '催促中' || (s.actionDeadline && new Date(s.actionDeadline) < today)).length;
      const reportCount = activeSelections.filter(s => s.companyActionType && s.companyActionStatus !== '完了').length;
      const yomiTotal = activeSelections.reduce((sum, s) => sum + Number(s.yomi || 0), 0);
      const uniquePeople = calculateUniqueCandidatesCount(activeSelections, false);
      const primaryRa = consultantsMap.get(comp.primaryRaId || comp.raConsultantId);

      return {
        company: comp,
        primaryRa,
        allSelections: compSelections,
        activeSelections,
        inProgressCount: activeSelections.length,
        uniquePeople,
        waitingCount,
        remindCount,
        reportCount,
        yomiTotal: Math.round(yomiTotal * 100) / 100
      };
    });

    // 絞り込み処理
    let filtered = companyCards.filter(card => {
      if (card.company.isArchived) return false;
      if (filterOnlyMine && card.company.primaryRaId !== currentCons.consultantId) return false;
      if (filterRaId && card.company.primaryRaId !== filterRaId) return false;

      if (searchCompName) {
        const kw = searchCompName.toLowerCase();
        if (!card.company.name.toLowerCase().includes(kw)) return false;
      }

      if (filterRank && card.company.rank !== filterRank) return false;
      if (filterHasWaiting && card.waitingCount === 0) return false;
      if (filterHasRemind && card.remindCount === 0) return false;

      return true;
    });

    // ソート処理
    filtered.sort((a, b) => {
      if (sortBy === 'rank_desc') {
        const order = { 'SS': 4, 'S': 3, 'A': 2, 'B': 1 };
        const diff = (order[b.company.rank] || 0) - (order[a.company.rank] || 0);
        if (diff !== 0) return diff;
        return a.company.name.localeCompare(b.company.name, 'ja');
      }
      if (sortBy === 'waiting_desc') return b.waitingCount - a.waitingCount;
      if (sortBy === 'remind_desc') return b.remindCount - a.remindCount;
      if (sortBy === 'yomi_desc') return b.yomiTotal - a.yomiTotal;
      if (sortBy === 'count_desc') return b.inProgressCount - a.inProgressCount;
      return (a.company.lastContactDate || '9999').localeCompare(b.company.lastContactDate || '9999');
    });

    // 状態の永続保存
    saveRaState({
      filterRaId,
      filterOnlyMine,
      searchCompName,
      filterRank,
      filterHasWaiting,
      filterHasRemind,
      sortBy,
      openCompanyIds: Array.from(openCompanyIds),
      showEndedSelections,
      scrollTop: savedScrollY
    });

    container.innerHTML = `
      <div class="space-y-6">
        <!-- ヘッダー -->
        <div class="bg-white p-5 rounded-xl border border-slate-200 shadow-sm flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h2 class="text-lg font-bold text-slate-900 flex items-center gap-2">
              <svg class="w-5 h-5 text-indigo-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4"></path></svg>
              RA管理画面
            </h2>
            <p class="text-xs text-slate-500 mt-1">※書類・面接見送りおよび内定辞退案件は企業件数・対話確認対象から除外されています。</p>
          </div>

          <div class="flex items-center space-x-3 text-xs">
            <label class="inline-flex items-center space-x-1.5 font-bold text-slate-700 cursor-pointer">
              <input type="checkbox" id="chk-ra-only-mine" ${filterOnlyMine ? 'checked' : ''} class="rounded text-indigo-600">
              <span>自分の担当企業のみ表示</span>
            </label>

            <select id="select-ra-filter" class="bg-slate-50 border border-slate-300 font-bold rounded px-3 py-2 text-slate-800 focus:outline-none">
              <option value="">すべてのRA担当</option>
              ${raConsultants.map(c => `<option value="${c.consultantId}" ${filterRaId === c.consultantId ? 'selected' : ''}>${c.name} (RA)</option>`).join('')}
            </select>
          </div>
        </div>

        <!-- フィルター & ソート -->
        <div class="bg-white p-4 rounded-xl border border-slate-200 shadow-sm flex flex-wrap items-center justify-between gap-3 text-xs">
          <div class="flex flex-wrap items-center gap-3">
            <input type="text" id="input-ra-search-kw" value="${searchCompName}" placeholder="企業名で検索..." class="bg-slate-50 border border-slate-300 rounded px-3 py-1.5 focus:outline-none focus:bg-white focus:border-indigo-600 min-w-[200px]">

            <select id="select-ra-rank" class="bg-slate-50 border border-slate-300 rounded px-2.5 py-1.5 focus:outline-none font-bold text-indigo-900">
              <option value="">すべての企業ランク</option>
              ${COMPANY_RANKS.map(r => `<option value="${r}" ${filterRank === r ? 'selected' : ''}>ランク: ${r}</option>`).join('')}
            </select>

            <label class="inline-flex items-center space-x-1.5 cursor-pointer">
              <input type="checkbox" id="chk-ra-has-waiting" ${filterHasWaiting ? 'checked' : ''} class="rounded text-amber-600">
              <span class="font-semibold text-amber-800">結果待ちあり企業のみ</span>
            </label>

            <label class="inline-flex items-center space-x-1.5 cursor-pointer">
              <input type="checkbox" id="chk-ra-has-remind" ${filterHasRemind ? 'checked' : ''} class="rounded text-rose-600">
              <span class="font-semibold text-rose-800">催促要確認企業のみ</span>
            </label>
          </div>

          <div class="flex items-center space-x-2">
            <span class="text-slate-500 font-semibold">並び替え:</span>
            <select id="select-ra-sort" class="bg-slate-100 border border-slate-300 rounded px-2.5 py-1.5 font-bold text-slate-800 focus:outline-none">
              <option value="rank_desc" ${sortBy === 'rank_desc' ? 'selected' : ''}>企業ランク順 (SS → S → A → B)</option>
              <option value="waiting_desc" ${sortBy === 'waiting_desc' ? 'selected' : ''}>結果待ち件数が多い順</option>
              <option value="remind_desc" ${sortBy === 'remind_desc' ? 'selected' : ''}>催促要確認が多い順</option>
              <option value="yomi_desc" ${sortBy === 'yomi_desc' ? 'selected' : ''}>企業ヨミが高い順</option>
              <option value="count_desc" ${sortBy === 'count_desc' ? 'selected' : ''}>選考中案件数が多い順</option>
              <option value="lastContact_asc" ${sortBy === 'lastContact_asc' ? 'selected' : ''}>最終連絡日が古い順</option>
            </select>
          </div>
        </div>

        <!-- 担当企業一覧テーブル -->
        <div class="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden space-y-3">
          <div class="px-5 py-4 border-b border-slate-200 flex items-center justify-between">
            <h3 class="font-bold text-slate-800 text-sm">担当企業一覧 (${filtered.length}社) <span class="text-xs font-normal text-slate-500">（企業行をクリックすると候補者一覧が展開します）</span></h3>
          </div>

          <div class="overflow-x-auto">
            <table class="w-full text-left text-xs">
              <thead class="bg-slate-900 text-slate-200 font-semibold border-b border-slate-800">
                <tr>
                  <th class="px-3 py-3 w-8 text-center">開閉</th>
                  <th class="px-4 py-3">企業名</th>
                  <th class="px-3 py-3">ランク</th>
                  <th class="px-3 py-3">担当RA</th>
                  <th class="px-3 py-3 text-right">選考中/実人数</th>
                  <th class="px-3 py-3 text-right">結果待ち</th>
                  <th class="px-3 py-3 text-right">催促・報告対象</th>
                  <th class="px-3 py-3 text-right">企業ヨミ</th>
                  <th class="px-3 py-3">最終連絡日</th>
                  <th class="px-3 py-3">次回連絡予定日</th>
                  <th class="px-3 py-3 text-center">操作</th>
                </tr>
              </thead>
              <tbody class="divide-y divide-slate-200">
                ${filtered.length === 0 ? `
                  <tr><td colspan="11" class="text-center py-8 text-slate-400">該当する担当企業がありません。</td></tr>
                ` : filtered.map(card => {
                  const comp = card.company;
                  const ra = card.primaryRa;
                  const isOpen = openCompanyIds.has(comp.companyId);
                  const isIncludeEnded = showEndedSelections[comp.companyId] || false;
                  const rankBadge = COMPANY_RANK_BADGES[comp.rank] || COMPANY_RANK_BADGES['B'];

                  const targetSelections = isIncludeEnded ? card.allSelections : card.activeSelections;

                  return `
                    <tr class="company-toggle-row hover:bg-indigo-50/50 transition cursor-pointer select-none ${isOpen ? 'bg-indigo-50/70 border-l-4 border-indigo-600' : ''}" data-company-id="${comp.companyId}">
                      <td class="px-3 py-3 text-center font-bold text-indigo-600">
                        ${isOpen ? '▼' : '▶'}
                      </td>
                      <td class="px-4 py-3 font-bold text-slate-900 flex items-center gap-2">
                        <span>${comp.name}</span>
                        ${card.inProgressCount > 0 ? `<span class="text-[10px] bg-indigo-100 text-indigo-800 px-1.5 py-0.5 rounded-full font-bold">${card.inProgressCount}</span>` : ''}
                      </td>
                      <td class="px-3 py-3">
                        <span class="px-2 py-0.5 rounded border text-[11px] ${rankBadge.badgeClass}">
                          ${comp.rank}
                        </span>
                      </td>
                      <td class="px-3 py-3 text-slate-700 font-medium">${ra ? ra.name : '未設定'}</td>
                      <td class="px-3 py-3 text-right font-bold text-slate-800">
                        ${card.inProgressCount}件 <span class="text-slate-500 text-[10px]">(${card.uniquePeople}名)</span>
                      </td>
                      <td class="px-3 py-3 text-right">
                        ${card.waitingCount > 0 ? `<span class="px-2 py-0.5 bg-amber-100 text-amber-800 font-bold rounded">${card.waitingCount}件</span>` : '<span class="text-slate-400">0</span>'}
                      </td>
                      <td class="px-3 py-3 text-right">
                        ${card.remindCount > 0 ? `<span class="px-2 py-0.5 bg-rose-100 text-rose-800 font-bold rounded">${card.remindCount}件</span>` : '<span class="text-slate-400">0</span>'}
                      </td>
                      <td class="px-3 py-3 text-right font-black text-indigo-600">${card.yomiTotal}件</td>
                      <td class="px-3 py-3 text-slate-600">${comp.lastContactDate || '-'}</td>
                      <td class="px-3 py-3 font-semibold text-indigo-700">${comp.nextContactDate || '-'}</td>
                      <td class="px-3 py-3 text-center">
                        <button class="btn-create-email stop-propagation px-3 py-1 bg-indigo-600 hover:bg-indigo-500 text-white font-bold rounded text-[11px] transition shadow-sm" data-company-id="${comp.companyId}">
                          メール作成
                        </button>
                      </td>
                    </tr>

                    ${isOpen ? `
                      <tr class="bg-slate-100/70 border-b-2 border-indigo-200">
                        <td colspan="11" class="p-4">
                          <div class="bg-white rounded-xl border border-slate-200 shadow-inner p-4 space-y-3">
                            <div class="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 pb-3 text-xs">
                              <div class="flex items-center space-x-3">
                                <h4 class="font-bold text-slate-800 flex items-center gap-1.5">
                                  <svg class="w-4 h-4 text-indigo-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z"></path></svg>
                                  ${comp.name} - 選考候補者一覧 (${targetSelections.length}件)
                                </h4>

                                <label class="inline-flex items-center space-x-1.5 cursor-pointer bg-slate-100 px-2 py-1 rounded border border-slate-200">
                                  <input type="checkbox" class="chk-toggle-ended" data-company-id="${comp.companyId}" ${isIncludeEnded ? 'checked' : ''} class="rounded text-indigo-600">
                                  <span class="font-semibold text-slate-700">過去の終了案件を含めて表示</span>
                                </label>
                              </div>

                              <button class="btn-create-email-selected px-3.5 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white font-bold rounded-lg text-xs shadow transition flex items-center gap-1.5" data-company-id="${comp.companyId}">
                                <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"></path></svg>
                                選択した候補者でメール作成
                              </button>
                            </div>

                            <div class="overflow-x-auto">
                              <table class="w-full text-left text-xs bg-white rounded-lg border border-slate-200">
                                <thead class="bg-slate-50 text-slate-700 font-semibold border-b border-slate-200">
                                  <tr>
                                    <th class="px-3 py-2 w-8 text-center">
                                      <input type="checkbox" class="chk-select-all-candidates" data-company-id="${comp.companyId}">
                                    </th>
                                    <th class="px-3 py-2">候補者名</th>
                                    <th class="px-3 py-2">応募求人・ポジション</th>
                                    <th class="px-2.5 py-2">担当CA</th>
                                    <th class="px-3 py-2">選考フェーズ</th>
                                    <th class="px-3 py-2">進行状態</th>
                                    <th class="px-2.5 py-2">ヨミ</th>
                                    <th class="px-2.5 py-2">次回予定日</th>
                                    <th class="px-3 py-2">企業確認事項</th>
                                    <th class="px-2.5 py-2 text-center">詳細</th>
                                  </tr>
                                </thead>
                                <tbody class="divide-y divide-slate-100">
                                  ${targetSelections.length === 0 ? `
                                    <tr><td colspan="10" class="text-center py-6 text-slate-400">現在表示できる選考案件はありません。</td></tr>
                                  ` : targetSelections.map(s => {
                                    const isEnded = s.phase === '選考終了' || s.phase === '内定辞退';
                                    const cand = candidatesMap.get(s.candidateId);
                                    const job = jobsMap.get(s.jobId);
                                    const ca = consultantsMap.get(s.caId || s.caConsultantId);

                                    return `
                                      <tr class="${isEnded ? 'bg-slate-100/70 text-slate-400' : 'hover:bg-indigo-50/30'} transition">
                                        <td class="px-3 py-2 text-center">
                                          <input type="checkbox" class="chk-cand-item" data-company-id="${comp.companyId}" data-selection-id="${s.selectionId}">
                                        </td>
                                        <td class="px-3 py-2 font-bold text-slate-900">${cand ? cand.name : s.candidateName}</td>
                                        <td class="px-3 py-2 text-slate-700">${job ? (job.title || job.jobName) : s.jobName}</td>
                                        <td class="px-2.5 py-2 text-slate-600 font-medium">${ca ? ca.name.split(' ')[0] : s.caName || '-'}</td>
                                        
                                        <td class="px-2.5 py-1.5">
                                          <select class="inline-ra-phase border border-slate-300 rounded px-1.5 py-1 text-xs font-semibold text-indigo-700 bg-white" data-selection-id="${s.selectionId}">
                                            ${PHASES.map(p => `<option value="${p}" ${s.phase === p ? 'selected' : ''}>${p}</option>`).join('')}
                                          </select>
                                        </td>

                                        <td class="px-2.5 py-1.5">
                                          <select class="inline-ra-status border border-slate-300 rounded px-1.5 py-1 text-xs font-medium text-slate-800 bg-white" data-selection-id="${s.selectionId}">
                                            ${PROGRESS_STATUSES.map(st => `<option value="${st}" ${s.progressStatus === st ? 'selected' : ''}>${st}</option>`).join('')}
                                          </select>
                                        </td>

                                        <td class="px-2 py-1.5">
                                          <select class="inline-ra-yomi border border-slate-300 rounded px-1.5 py-1 text-xs font-bold bg-white text-indigo-700" data-selection-id="${s.selectionId}">
                                            ${YOMI_OPTIONS.map(y => `<option value="${y.value}" ${Number(s.yomi) === y.value ? 'selected' : ''}>${y.label}</option>`).join('')}
                                          </select>
                                        </td>

                                        <td class="px-2.5 py-2 text-slate-600">${s.nextScheduleDate || '-'}</td>
                                        <td class="px-3 py-2 text-slate-700 text-[11px]">${s.companyConfirmationItem || s.companyCheckItems || '-'}</td>
                                        <td class="px-2.5 py-2 text-center">
                                          <button class="btn-ra-cand-detail px-2 py-1 bg-slate-100 hover:bg-indigo-600 hover:text-white rounded text-[11px] font-medium transition" data-id="${s.selectionId}">
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
                        </td>
                      </tr>
                    ` : ''}
                  `;
                }).join('')}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    `;

    if (options.preserveScroll !== false && savedScrollY > 0) {
      setTimeout(() => {
        window.scrollTo({ top: savedScrollY, behavior: 'instant' });
      }, 0);
    }

    // イベントバインド
    container.querySelectorAll('.company-toggle-row').forEach(row => {
      row.addEventListener('click', (e) => {
        if (e.target.closest('.stop-propagation')) return;

        const cId = row.getAttribute('data-company-id');
        if (openCompanyIds.has(cId)) {
          openCompanyIds.delete(cId);
        } else {
          openCompanyIds.add(cId);
        }

        saveRaState({
          openCompanyIds: Array.from(openCompanyIds),
          scrollTop: window.scrollY || document.documentElement.scrollTop
        });
        updateView({ preserveScroll: true });
      });
    });

    container.querySelectorAll('.stop-propagation').forEach(btn => {
      btn.addEventListener('click', (e) => e.stopPropagation());
    });

    container.querySelector('#chk-ra-only-mine')?.addEventListener('change', (e) => { filterOnlyMine = e.target.checked; updateView({ preserveScroll: true }); });
    container.querySelector('#select-ra-filter')?.addEventListener('change', (e) => { filterRaId = e.target.value; updateView({ preserveScroll: true }); });
    container.querySelector('#input-ra-search-kw')?.addEventListener('input', (e) => { searchCompName = e.target.value; updateView({ preserveScroll: true }); });
    container.querySelector('#select-ra-rank')?.addEventListener('change', (e) => { filterRank = e.target.value; updateView({ preserveScroll: true }); });
    container.querySelector('#chk-ra-has-waiting')?.addEventListener('change', (e) => { filterHasWaiting = e.target.checked; updateView({ preserveScroll: true }); });
    container.querySelector('#chk-ra-has-remind')?.addEventListener('change', (e) => { filterHasRemind = e.target.checked; updateView(); });
    container.querySelector('#select-ra-sort')?.addEventListener('change', (e) => { sortBy = e.target.value; updateView({ preserveScroll: true }); });

    container.querySelectorAll('.chk-toggle-ended').forEach(chk => {
      chk.addEventListener('change', (e) => {
        const cId = chk.getAttribute('data-company-id');
        showEndedSelections[cId] = chk.checked;
        updateView({ preserveScroll: true });
      });
    });

    container.querySelectorAll('.chk-select-all-candidates').forEach(chk => {
      chk.addEventListener('change', (e) => {
        const cId = chk.getAttribute('data-company-id');
        const items = container.querySelectorAll(`.chk-cand-item[data-company-id="${cId}"]`);
        items.forEach(item => item.checked = chk.checked);
      });
    });

    container.querySelectorAll('.btn-create-email-selected').forEach(btn => {
      btn.addEventListener('click', () => {
        const cId = btn.getAttribute('data-company-id');
        const checkedItems = container.querySelectorAll(`.chk-cand-item[data-company-id="${cId}"]:checked`);
        const selIds = Array.from(checkedItems).map(item => item.getAttribute('data-selection-id'));

        if (selIds.length === 0) {
          alert('メール本文に反映する候補者をチェックボックスで選択してください。');
          return;
        }

        onOpenEmailComposer(cId, selIds);
      });
    });

    container.querySelectorAll('.btn-create-email').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const cId = btn.getAttribute('data-company-id');
        onOpenEmailComposer(cId);
      });
    });

    container.querySelectorAll('.inline-ra-phase').forEach(sel => {
      sel.addEventListener('change', (e) => {
        const selId = sel.getAttribute('data-selection-id');
        store.updateSelection(selId, { phase: e.target.value }, 'RA画面からのフェーズ更新');
        updateView({ preserveScroll: true });
      });
    });

    container.querySelectorAll('.inline-ra-status').forEach(sel => {
      sel.addEventListener('change', (e) => {
        const selId = sel.getAttribute('data-selection-id');
        store.updateSelection(selId, { progressStatus: e.target.value }, 'RA画面からの状態更新');
        updateView({ preserveScroll: true });
      });
    });

    container.querySelectorAll('.inline-ra-yomi').forEach(sel => {
      sel.addEventListener('change', (e) => {
        const selId = sel.getAttribute('data-selection-id');
        store.updateSelection(selId, { yomi: Number(e.target.value) }, 'RA画面からのヨミ更新');
        updateView({ preserveScroll: true });
      });
    });

    container.querySelectorAll('.btn-ra-cand-detail').forEach(btn => {
      btn.addEventListener('click', () => {
        saveRaState({ scrollTop: window.scrollY || document.documentElement.scrollTop });
        onOpenDetail(btn.getAttribute('data-id'));
      });
    });
  }

  updateView({ preserveScroll: true });
}
