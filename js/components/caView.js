/**
 * 選考進捗・ヨミ管理システム - CA用画面コンポーネント (担当候補者 & 進行中案件絞り込み対応)
 */

import { store } from '../store.js';
import { getSelectionAlerts } from '../utils/yomiCalculations.js';

export function renderCaView(container, { onOpenDetail }) {
  const currentCons = store.getCurrentConsultant();
  let filterCaId = currentCons.roleType === 'CA' ? currentCons.consultantId : '';
  let searchCandName = '';
  let filterPhase = '';
  let filterOnlyMine = currentCons.roleType === 'CA';
  let filterHasOffer = false;
  let filterMultiApply = false;
  let showEndedSelections = false;

  function updateView() {
    const candidates = store.getCandidates();
    const selections = store.getSelections();
    const companies = store.getCompanies();
    const jobs = store.getJobs();
    const consultants = store.getConsultants();

    const caConsultants = consultants.filter(c => c.roleType === 'CA' || c.roleType === 'ADMIN');

    const companiesMap = new Map(companies.map(c => [c.companyId, c]));
    const jobsMap = new Map(jobs.map(j => [j.jobId, j]));
    const consultantsMap = new Map(consultants.map(c => [c.consultantId, c]));

    const candidateCards = candidates.map(cand => {
      const candSelections = selections.filter(s => !s.isArchived && s.candidateId === cand.candidateId);
      const activeSelections = candSelections.filter(s => s.phase !== '選考終了' && s.phase !== '内定辞退');
      const hasOffer = activeSelections.some(s => s.phase === '内定' || s.phase === 'オファー面談・条件提示' || s.phase === '内定承諾' || s.phase === '入社予定');
      const caCons = consultantsMap.get(cand.caId || cand.caConsultantId);

      const displaySelections = showEndedSelections ? candSelections : activeSelections;

      return {
        candidate: cand,
        caConsultant: caCons,
        allSelections: candSelections,
        activeSelections,
        displaySelections,
        entryCount: candSelections.length,
        inProgressCount: activeSelections.length,
        hasOffer,
        isMultiApply: activeSelections.length > 1
      };
    });

    let filtered = candidateCards.filter(card => {
      if (card.candidate.isArchived) return false;

      if (filterOnlyMine && card.candidate.caId !== currentCons.consultantId) return false;
      if (filterCaId && card.candidate.caId !== filterCaId) return false;

      if (searchCandName) {
        const kw = searchCandName.toLowerCase();
        const name = (card.candidate.name || '').toLowerCase();
        const kana = (card.candidate.kana || '').toLowerCase();
        if (!name.includes(kw) && !kana.includes(kw)) return false;
      }

      if (filterPhase && !card.displaySelections.some(s => s.phase === filterPhase)) return false;
      if (filterHasOffer && !card.hasOffer) return false;
      if (filterMultiApply && !card.isMultiApply) return false;

      return true;
    });

    container.innerHTML = `
      <div class="space-y-6">
        <!-- 画面ヘッダー -->
        <div class="bg-white p-5 rounded-xl border border-slate-200 shadow-sm flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h2 class="text-lg font-bold text-slate-900 flex items-center gap-2">
              <svg class="w-5 h-5 text-indigo-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"></path></svg>
              CA管理画面
            </h2>
            <p class="text-xs text-slate-500 mt-1">※書類・面接見送りおよび内定辞退案件は通常の対話確認対象から除外されています。</p>
          </div>

          <div class="flex items-center space-x-3 text-xs">
            <label class="inline-flex items-center space-x-1.5 font-bold text-slate-700 cursor-pointer">
              <input type="checkbox" id="chk-ca-only-mine" ${filterOnlyMine ? 'checked' : ''} class="rounded text-indigo-600">
              <span>自分の担当候補者のみ表示</span>
            </label>

            <select id="select-ca-filter" class="bg-slate-50 border border-slate-300 font-bold rounded px-3 py-2 text-slate-800 focus:outline-none">
              <option value="">すべてのCA担当</option>
              ${caConsultants.map(c => `<option value="${c.consultantId}" ${filterCaId === c.consultantId ? 'selected' : ''}>${c.name} (CA)</option>`).join('')}
            </select>
          </div>
        </div>

        <!-- 本日のCA対応 サマリー (指示書 11項) -->
        <div class="grid grid-cols-2 sm:grid-cols-5 gap-3">
          <div class="bg-rose-50/70 p-3 rounded-lg border border-rose-200 cursor-pointer hover:bg-rose-100 transition" id="ca-sum-overdue">
            <div class="text-[11px] font-extrabold text-rose-800">期限超過</div>
            <div class="text-xl font-black text-rose-600 mt-1">${filtered.filter(c => c.activeSelections.some(s => getSelectionAlerts(s).isOverdue)).length}<span class="text-xs font-normal text-rose-700 ml-1">件</span></div>
          </div>
          <div class="bg-amber-50/70 p-3 rounded-lg border border-amber-200 cursor-pointer hover:bg-amber-100 transition" id="ca-sum-contact">
            <div class="text-[11px] font-extrabold text-amber-800">候補者連絡</div>
            <div class="text-xl font-black text-amber-600 mt-1">${filtered.filter(c => c.activeSelections.some(s => s.currentBall === 'CA')).length}<span class="text-xs font-normal text-amber-700 ml-1">件</span></div>
          </div>
          <div class="bg-indigo-50/70 p-3 rounded-lg border border-indigo-200 cursor-pointer hover:bg-indigo-100 transition" id="ca-sum-dates">
            <div class="text-[11px] font-extrabold text-indigo-800">候補日確認</div>
            <div class="text-xl font-black text-indigo-600 mt-1">${filtered.filter(c => c.activeSelections.some(s => (s.nextAction || '').includes('候補日'))).length}<span class="text-xs font-normal text-indigo-700 ml-1">件</span></div>
          </div>
          <div class="bg-purple-50/70 p-3 rounded-lg border border-purple-200 cursor-pointer hover:bg-purple-100 transition" id="ca-sum-intent">
            <div class="text-[11px] font-extrabold text-purple-800">意向確認</div>
            <div class="text-xl font-black text-purple-600 mt-1">${filtered.filter(c => c.activeSelections.some(s => (s.nextAction || '').includes('意向'))).length}<span class="text-xs font-normal text-purple-700 ml-1">件</span></div>
          </div>
          <div class="bg-emerald-50/70 p-3 rounded-lg border border-emerald-200 cursor-pointer hover:bg-emerald-100 transition" id="ca-sum-ra-reply">
            <div class="text-[11px] font-extrabold text-emerald-800">RAから回答あり</div>
            <div class="text-xl font-black text-emerald-600 mt-1">${filtered.filter(c => c.activeSelections.some(s => s.companyActionStatus === 'CA確認待ち')).length}<span class="text-xs font-normal text-emerald-700 ml-1">件</span></div>
          </div>
        </div>

        <!-- 検索 & フィルター (指示書 9項) -->
        <div class="bg-white p-4 rounded-xl border border-slate-200 shadow-sm flex flex-wrap items-center gap-3 text-xs">
          <input type="text" id="input-ca-search-kw" value="${searchCandName}" placeholder="候補者名 / フリガナで検索..." class="bg-slate-50 border border-slate-300 rounded px-3 py-1.5 focus:outline-none focus:bg-white focus:border-indigo-600 min-w-[200px]">

          <label class="inline-flex items-center space-x-1.5 cursor-pointer">
            <input type="checkbox" id="chk-ca-has-offer" ${filterHasOffer ? 'checked' : ''} class="rounded text-emerald-600">
            <span class="font-semibold text-emerald-800">内定ありのみ</span>
          </label>

          <label class="inline-flex items-center space-x-1.5 cursor-pointer">
            <input type="checkbox" id="chk-ca-multi-apply" ${filterMultiApply ? 'checked' : ''} class="rounded text-purple-600">
            <span class="font-semibold text-purple-800">複数社選考中のみ</span>
          </label>

          <label class="inline-flex items-center space-x-1.5 cursor-pointer ml-auto bg-slate-100 px-2.5 py-1 rounded border border-slate-200">
            <input type="checkbox" id="chk-ca-show-ended" ${showEndedSelections ? 'checked' : ''} class="rounded text-indigo-600">
            <span class="font-bold text-slate-700">過去の終了案件を含む</span>
          </label>
        </div>

        <!-- 候補者グループカードリスト -->
        <div class="space-y-4">
          ${filtered.length === 0 ? `
            <div class="bg-white p-12 text-center text-slate-400 rounded-xl border border-slate-200">
              条件に該当する担当候補者が存在しません。
            </div>
          ` : filtered.map(card => {
            const cand = card.candidate;
            const ca = card.caConsultant;

            return `
              <div class="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
                <!-- 候補者基本情報バー -->
                <div class="bg-slate-900 text-white px-5 py-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-800">
                  <div class="flex items-center space-x-3">
                    <h3 class="text-base font-bold text-white">${cand.name}</h3>
                    <span class="text-xs text-slate-400 font-normal">(${cand.kana || ''})</span>
                    <span class="text-[11px] bg-slate-800 border border-slate-700 text-slate-300 px-2 py-0.5 rounded font-mono">${cand.internalManagementNumber || ''}</span>
                    ${card.isMultiApply ? `<span class="text-[10px] bg-purple-500/30 text-purple-300 border border-purple-400/30 px-2 py-0.5 rounded font-bold">複数社選考中 (${card.inProgressCount}社)</span>` : ''}
                    ${card.hasOffer ? `<span class="text-[10px] bg-emerald-500/30 text-emerald-300 border border-emerald-400/30 px-2 py-0.5 rounded font-bold">内定あり</span>` : ''}
                  </div>

                  <div class="flex items-center space-x-4 text-xs text-slate-300">
                    <span>担当CA: <strong class="text-white">${ca ? ca.name : '未設定'}</strong></span>
                    <span>活動状況: <strong class="text-indigo-300">${cand.activityStatus || '選考中'}</strong></span>
                    <span>進行中案件: <strong class="text-emerald-400">${card.inProgressCount}</strong>社</span>
                  </div>
                </div>

                <!-- 候補者の応募先選考一覧 -->
                <div class="overflow-x-auto">
                  <table class="w-full text-left text-xs">
                    <thead class="bg-slate-50 text-slate-700 font-semibold border-b border-slate-200">
                      <tr>
                        <th class="px-4 py-2.5">応募先企業</th>
                        <th class="px-4 py-2.5">求人・ポジション</th>
                        <th class="px-3 py-2.5">担当RA</th>
                        <th class="px-3 py-2.5">選考フェーズ</th>
                        <th class="px-3 py-2.5">進行状態</th>
                        <th class="px-3 py-2.5 text-right">ヨミ</th>
                        <th class="px-3 py-2.5">次回予定日</th>
                        <th class="px-3 py-2.5">警告</th>
                        <th class="px-3 py-2.5 text-center">詳細</th>
                      </tr>
                    </thead>
                    <tbody class="divide-y divide-slate-100">
                      ${card.displaySelections.length === 0 ? `
                        <tr><td colspan="9" class="text-center py-4 text-slate-400">現在確認対象の進行中選考案件はありません。</td></tr>
                      ` : card.displaySelections.map(s => {
                        const isEnded = s.phase === '選考終了' || s.phase === '内定辞退';
                        const comp = companiesMap.get(s.companyId);
                        const job = jobsMap.get(s.jobId);
                        const ra = consultantsMap.get(s.raId || s.raConsultantId);
                        const alerts = getSelectionAlerts(s, comp);

                        return `
                          <tr class="${isEnded ? 'bg-slate-100/70 text-slate-400' : 'hover:bg-indigo-50/30'} transition">
                            <td class="px-4 py-2.5 font-bold text-slate-900">
                              <div>${comp ? comp.name : s.companyName}</div>
                              <div class="text-[10px] text-indigo-700 font-semibold mt-0.5">次行動: ${s.nextAction || '候補者連絡'}</div>
                            </td>
                            <td class="px-4 py-2.5 text-slate-700">${job ? (job.title || job.jobName) : s.jobName}</td>
                            <td class="px-3 py-2.5 text-slate-600">${ra ? ra.name.split(' ')[0] : s.raName || '-'}</td>
                            <td class="px-3 py-2.5 font-bold">
                              ${s.phase === '内定辞退' ? '<span class="px-2 py-0.5 bg-slate-500 text-white rounded text-[10px]">内定辞退</span>' : (s.phase === '選考終了' ? '<span class="px-2 py-0.5 bg-slate-200 text-slate-700 rounded text-[10px]">選考終了</span>' : `<span class="text-indigo-700">${s.phase}</span>`)}
                            </td>
                            <td class="px-3 py-2.5 text-slate-700">${s.progressStatus}</td>
                            <td class="px-3 py-2.5 text-right font-black ${isEnded ? 'text-slate-400' : 'text-indigo-600'}">${isEnded ? '0%' : (s.yomi * 100 + '%')}</td>
                            <td class="px-3 py-2.5 text-slate-600">${s.nextScheduleDate || '-'}</td>
                            <td class="px-3 py-2.5">
                              <div class="flex flex-wrap gap-1">
                                ${alerts.map(a => `<span class="px-1.5 py-0.5 rounded text-[9px] font-bold ${a.level === 'red' ? 'bg-rose-100 text-rose-800' : 'bg-orange-100 text-orange-800'}">${a.message}</span>`).join('')}
                              </div>
                            </td>
                            <td class="px-3 py-2.5 text-center">
                              <div class="flex items-center justify-end space-x-1">
                                <button data-ca-action="CONTACTED" data-id="${s.selectionId}" class="px-2 py-0.5 bg-slate-800 hover:bg-slate-700 text-white rounded text-[10px] font-bold">連絡済</button>
                                <button data-ca-action="GOT_DATES" data-id="${s.selectionId}" class="px-2 py-0.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded text-[10px] font-bold">候補日取得</button>
                                <button data-ca-action="ACCEPT_INTENT" data-id="${s.selectionId}" class="px-2 py-0.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded text-[10px] font-bold">承諾意向</button>
                                <button data-ca-action="DECLINE_INTENT" data-id="${s.selectionId}" class="px-2 py-0.5 bg-rose-600 hover:bg-rose-500 text-white rounded text-[10px] font-bold">辞退意向</button>
                                <button class="btn-ca-detail px-2 py-0.5 bg-slate-100 hover:bg-indigo-600 hover:text-white rounded text-[10px] font-bold transition" data-id="${s.selectionId}">詳細</button>
                              </div>
                            </td>
                          </tr>
                        `;
                      }).join('')}
                    </tbody>
                  </table>
                </div>
              </div>
            `;
          }).join('')}
        </div>
      </div>
    `;

    // イベントバインド
    container.querySelector('#chk-ca-only-mine')?.addEventListener('change', (e) => { filterOnlyMine = e.target.checked; updateView(); });
    container.querySelector('#select-ca-filter')?.addEventListener('change', (e) => { filterCaId = e.target.value; updateView(); });
    container.querySelector('#input-ca-search-kw')?.addEventListener('input', (e) => { searchCandName = e.target.value; updateView(); });
    container.querySelector('#chk-ca-has-offer')?.addEventListener('change', (e) => { filterHasOffer = e.target.checked; updateView(); });
    container.querySelector('#chk-ca-multi-apply')?.addEventListener('change', (e) => { filterMultiApply = e.target.checked; updateView(); });
    container.querySelector('#chk-ca-show-ended')?.addEventListener('change', (e) => { showEndedSelections = e.target.checked; updateView(); });

    container.querySelectorAll('button[data-ca-action]').forEach(btn => {
      btn.addEventListener('click', () => {
        const selId = btn.getAttribute('data-id');
        const act = btn.getAttribute('data-ca-action');
        store.handleCaAction(selId, act);
        updateView();
      });
    });

    container.querySelectorAll('.btn-ca-detail').forEach(btn => {
      btn.addEventListener('click', () => onOpenDetail(btn.getAttribute('data-id')));
    });
  }

  updateView();
}
