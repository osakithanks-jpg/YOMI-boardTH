/**
 * 選考進捗・ヨミ管理システム - コンサル別画面コンポーネント (四半期(Q)目標管理 & 2025年度4Q連動)
 */

import { store } from '../store.js';
import {
  getFiscalYear,
  getFiscalQuarter,
  getQuarterDateRange,
  getQuarterFromYearMonth,
  getQuarterDateRange as getRange,
  getFiscalQuarterFromDate,
  normalizeYomi,
  isSelectionInQuarter
} from '../utils/yomiCalculations.js';
import { PHASES } from '../constants.js';

export function renderConsultantView(container, initialConsultantId = '', { onOpenDetail }) {
  const consultants = store.getConsultants();
  let activeConsultantId = initialConsultantId || store.getCurrentConsultant().consultantId;
  let activeRoleType = 'CA'; // 'CA' | 'RA'

  // ブラウザの当日日付から正しい年度・Qを自動初期判定 (指示書 1, 3, 4, 5項)
  const currentInitialFQ = getFiscalQuarterFromDate(new Date());
  let selectedFiscalYear = currentInitialFQ.fiscalYear;
  let selectedQuarter = currentInitialFQ.quarter;

  function updateView() {
    const activeCons = consultants.find(c => c.consultantId === activeConsultantId) || consultants[0] || {};
    const selections = store.getSelections();
    const companies = store.getCompanies();
    const jobs = store.getJobs();
    const candidates = store.getCandidates();

    const companiesMap = new Map(companies.map(c => [c.companyId, c]));
    const candidatesMap = new Map(candidates.map(c => [c.candidateId, c]));
    const jobsMap = new Map(jobs.map(j => [j.jobId, j]));

    const qRange = getQuarterDateRange(selectedFiscalYear, selectedQuarter);
    const startDate = new Date(qRange.startDate);
    const endDate = new Date(qRange.endDate);
    endDate.setHours(23, 59, 59, 999);

    // Q目標データの取得 (指示書 19項)
    const qTargets = store.getQTargets(selectedFiscalYear, selectedQuarter);
    const targetObj = qTargets.find(t => t.consultantId === activeCons.consultantId);
    
    // RA担当時は目標対象外、CA担当時は個人目標をセット
    const isRaView = activeRoleType === 'RA';
    const myQTarget = isRaView 
      ? null 
      : (targetObj ? Number(targetObj.targetCount || 0) : (activeCons.roleType === 'ADMIN' ? 5 : (activeCons.roleType === 'CA' ? 4 : 3)));

    // CA / RA による担当案件抽出 (ID最優先照合 ＆ 旧データ補完: 指示書 15項)
    const myAllSelections = selections.filter(s => {
      if (s.isArchived) return false;
      const targetConsId = activeCons.consultantId;
      const targetName = activeCons.name;

      if (activeRoleType === 'CA') {
        if (s.caId || s.caConsultantId) {
          return s.caId === targetConsId || s.caConsultantId === targetConsId;
        }
        return s.caName === targetName;
      } else {
        if (s.raId || s.raConsultantId) {
          return s.raId === targetConsId || s.raConsultantId === targetConsId;
        }
        return s.raName === targetName;
      }
    });

    // 1. Q承諾実績 (対象Q内に内定承諾日・入社日がある案件: 指示書 17項)
    const myAcceptedSelections = myAllSelections.filter(s => {
      if (s.phase !== '内定承諾' && s.phase !== '入社予定') return false;
      const acceptDateStr = s.selectionEndDate || s.phaseUpdatedAt || s.updatedAt;
      if (!acceptDateStr) return false;
      const aDate = new Date(acceptDateStr);
      return aDate >= startDate && aDate <= endDate;
    });
    const myAcceptedCount = myAcceptedSelections.length;

    // 2. Q進行中ヨミ (完了見込み月・判定優先度で対象Qに含まれる進行中案件: 指示書 8, 14, 15, 16項)
    const myInProgSelectionsInQ = myAllSelections.filter(s => {
      // 進行中以外・除外対象（内定承諾・辞退・終了等）を除外 (指示書 16項)
      if (['選考終了', '内定辞退', '内定承諾', '入社予定', '書類見送り', '面接見送り', '候補者辞退', '他社決定'].includes(s.phase)) {
        return false;
      }
      return isSelectionInQuarter(s, selectedFiscalYear, selectedQuarter);
    });

    // ヨミの正規化合計計算 (指示書 9, 10項)
    const rawYomiSum = myInProgSelectionsInQ.reduce((sum, s) => sum + normalizeYomi(s.yomi), 0);
    const myInProgYomi = Math.round(rawYomiSum * 100) / 100;

    // 3. Q着地見込み, 4. 不足, 5. 達成率 (指示書 11, 12, 13項)
    const myForecast = Math.round((myAcceptedCount + myInProgYomi) * 100) / 100;
    
    let myShortage = 0;
    let myRate = 0;

    if (!isRaView && myQTarget !== null) {
      myShortage = Math.max(0, Math.round((myQTarget - myForecast) * 100) / 100);
      myRate = myQTarget > 0 ? Math.round((myForecast / myQTarget) * 1000) / 10 : 0;
    }

    // フェーズ別件数集計 (完璧な一致保証: 指示書 23項)
    const phaseCounts = PHASES.map(p => ({
      phase: p,
      count: myInProgSelectionsInQ.filter(s => s.phase === p).length
    }));

    // 役割ラベル表示の成形 (undefined 防護: 指示書 20項)
    const roleDisplay = activeCons.roles && Array.isArray(activeCons.roles) && activeCons.roles.length > 0
      ? activeCons.roles.join('・')
      : (activeCons.roleType || 'CA');

    // 動的年度選択肢の計算 (現在年の前後)
    const baseFY = currentInitialFQ.fiscalYear;
    const fyOptions = [baseFY - 1, baseFY, baseFY + 1, baseFY + 2];

    container.innerHTML = `
      <div class="space-y-6">
        <!-- ヘッダー & コンサル切り替え -->
        <div class="bg-white p-5 rounded-xl border border-slate-200 shadow-sm flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div class="flex items-center space-x-3">
            <div class="w-12 h-12 bg-indigo-600 text-white rounded-full font-black text-lg flex items-center justify-center shadow shrink-0">
              ${(activeCons.name || '相').charAt(0)}
            </div>
            <div>
              <div class="flex items-center space-x-2">
                <h2 class="text-lg font-bold text-slate-800">${activeCons.name || '担当者未選択'} の選考進捗・実績管理</h2>
                <span class="px-2 py-0.5 bg-indigo-100 text-indigo-800 font-extrabold rounded-lg text-xs border border-indigo-200">集計対象: ${activeCons.name || ''}／${activeRoleType}担当</span>
              </div>
              <p class="text-xs text-slate-500 font-medium mt-0.5">
                <span class="px-2 py-0.5 bg-slate-100 text-slate-700 font-bold rounded border border-slate-200 mr-2">${roleDisplay}</span>
                ${activeCons.email || ''}
              </p>
            </div>
          </div>

          <div class="flex flex-wrap items-center gap-2.5 text-xs">
            <!-- 年度 ＆ Q選択ドロップダウン (指示書 4, 6, 7項) -->
            <select id="select-cons-fy" class="bg-slate-50 border border-slate-300 font-bold rounded px-2.5 py-1.5 text-slate-800 focus:outline-none focus:border-indigo-600">
              ${fyOptions.map(fy => `<option value="${fy}" ${selectedFiscalYear === fy ? 'selected' : ''}>${fy}年度</option>`).join('')}
            </select>

            <select id="select-cons-q" class="bg-slate-50 border border-slate-300 font-bold rounded px-2.5 py-1.5 text-indigo-900 focus:outline-none focus:border-indigo-600">
              <option value="Q1" ${selectedQuarter === 'Q1' ? 'selected' : ''}>1Q (10-12月)</option>
              <option value="Q2" ${selectedQuarter === 'Q2' ? 'selected' : ''}>2Q (1-3月)</option>
              <option value="Q3" ${selectedQuarter === 'Q3' ? 'selected' : ''}>3Q (4-6月)</option>
              <option value="Q4" ${selectedQuarter === 'Q4' ? 'selected' : ''}>4Q (7-9月)</option>
              <option value="ALL" ${selectedQuarter === 'ALL' ? 'selected' : ''}>年度通期</option>
            </select>

            <!-- CA / RA 切替 -->
            <div class="bg-slate-100 p-1 rounded-lg flex items-center border border-slate-200 font-bold">
              <button id="btn-role-ca" class="px-3 py-1 rounded transition ${activeRoleType === 'CA' ? 'bg-indigo-600 text-white shadow-sm' : 'text-slate-600 hover:text-slate-900'}">
                CA担当
              </button>
              <button id="btn-role-ra" class="px-3 py-1 rounded transition ${activeRoleType === 'RA' ? 'bg-purple-600 text-white shadow-sm' : 'text-slate-600 hover:text-slate-900'}">
                RA担当
              </button>
            </div>

            <!-- コンサルタント選択 (undefined完全修正: 指示書 20項) -->
            <select id="select-consultant-change" class="bg-slate-50 border border-slate-300 font-bold rounded px-3 py-1.5 text-slate-800 focus:outline-none focus:border-indigo-600">
              ${consultants.map(c => {
                const cRoleLabel = c.roles && Array.isArray(c.roles) && c.roles.length > 0 ? c.roles.join('・') : (c.roleType || 'CA');
                return `<option value="${c.consultantId}" ${c.consultantId === activeCons.consultantId ? 'selected' : ''}>${c.name} (${cRoleLabel})</option>`;
              }).join('')}
            </select>
          </div>
        </div>

        <!-- Q KPIカード (指示書 10, 11, 12, 13, 19項) -->
        <div class="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
          <div class="bg-slate-900 text-white p-4 rounded-xl border border-slate-800 shadow-xs">
            <div class="text-xs text-slate-400 font-semibold">個人Q目標</div>
            <div class="text-2xl font-black mt-1">
              ${isRaView ? '<span class="text-sm text-slate-400 font-bold">対象外</span>' : `${myQTarget}<span class="text-xs font-normal text-slate-400 ml-1">件</span>`}
            </div>
          </div>

          <div class="bg-emerald-50 border border-emerald-200 p-4 rounded-xl shadow-xs">
            <div class="text-xs font-bold text-emerald-800">Q承諾実績</div>
            <div class="text-2xl font-black text-emerald-600 mt-1">${myAcceptedCount}<span class="text-xs font-normal text-emerald-700 ml-1">件</span></div>
          </div>

          <div class="bg-indigo-50 border border-indigo-200 p-4 rounded-xl shadow-xs">
            <div class="text-xs font-bold text-indigo-800">Q進行中ヨミ合計</div>
            <div class="text-2xl font-black text-indigo-600 mt-1">${myInProgYomi}<span class="text-xs font-normal text-indigo-700 ml-1">件</span></div>
          </div>

          <div class="bg-purple-50 border border-purple-200 p-4 rounded-xl shadow-xs">
            <div class="text-xs font-bold text-purple-800">Q着地見込み</div>
            <div class="text-2xl font-black text-purple-600 mt-1">${myForecast}<span class="text-xs font-normal text-purple-700 ml-1">件</span></div>
          </div>

          <div class="bg-rose-50 border border-rose-200 p-4 rounded-xl shadow-xs">
            <div class="text-xs font-bold text-rose-800">Q不足ヨミ</div>
            <div class="text-2xl font-black text-rose-600 mt-1">
              ${isRaView ? '<span class="text-sm text-rose-400 font-bold">-</span>' : `${myShortage}<span class="text-xs font-normal text-rose-700 ml-1">件</span>`}
            </div>
          </div>

          <div class="bg-amber-50 border border-amber-200 p-4 rounded-xl shadow-xs">
            <div class="text-xs font-bold text-amber-800">Q見込み達成率</div>
            <div class="text-2xl font-black text-amber-600 mt-1">
              ${isRaView ? '<span class="text-sm text-amber-400 font-bold">-</span>' : `${myRate}%`}
            </div>
          </div>
        </div>

        <!-- フェーズ別件数プログレス (一致性保証: 指示書 7, 23項) -->
        <div class="bg-white rounded-xl border border-slate-200 shadow-sm p-5 space-y-3">
          <h3 class="font-bold text-slate-800 text-xs flex items-center justify-between">
            <span>対象Q フェーズ別案件内訳 (${qRange.label})</span>
            <span class="text-[11px] text-slate-500 font-normal">※進行中案件 ${myInProgSelectionsInQ.length} 件</span>
          </h3>
          <div class="grid grid-cols-2 sm:grid-cols-5 md:grid-cols-10 gap-2 text-center text-xs">
            ${phaseCounts.map(item => `
              <div class="bg-slate-50 border border-slate-200 p-2 rounded-lg hover:border-indigo-300 transition">
                <div class="text-[10px] text-slate-500 font-semibold line-clamp-1" title="${item.phase}">${item.phase}</div>
                <div class="text-base font-black ${item.count > 0 ? 'text-indigo-600' : 'text-slate-400'} mt-1">${item.count}</div>
              </div>
            `).join('')}
          </div>
        </div>

        <!-- 担当案件一覧テーブル (ヨミ正規化表示 & 完全一致保証: 指示書 21, 22, 23項) -->
        <div class="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden space-y-3">
          <div class="px-5 py-4 border-b border-slate-200 flex items-center justify-between">
            <h3 class="font-bold text-slate-800 text-sm">
              対象Q 担当案件一覧 (${myInProgSelectionsInQ.length}件)
            </h3>
            <span class="text-xs text-slate-500 font-semibold">ヨミ合計: <strong class="text-indigo-600 text-sm font-black">${myInProgYomi}</strong> 件</span>
          </div>
          <div class="overflow-x-auto">
            <table class="w-full text-left text-xs">
              <thead class="bg-slate-900 text-slate-200 font-semibold border-b border-slate-800">
                <tr>
                  <th class="px-4 py-3">候補者名</th>
                  <th class="px-4 py-3">企業名</th>
                  <th class="px-4 py-3">求人・ポジション</th>
                  <th class="px-3 py-3">選考フェーズ</th>
                  <th class="px-3 py-3">進行状態</th>
                  <th class="px-3 py-3 text-right">ヨミ</th>
                  <th class="px-3 py-3">完了見込み月</th>
                  <th class="px-3 py-3 text-center">操作</th>
                </tr>
              </thead>
              <tbody class="divide-y divide-slate-200">
                ${myInProgSelectionsInQ.length === 0 ? `
                  <tr><td colspan="8" class="text-center py-8 text-slate-400 font-bold">対象Qに着地見込みの選考案件がありません。</td></tr>
                ` : myInProgSelectionsInQ.map(s => {
                  const cand = candidatesMap.get(s.candidateId);
                  const comp = companiesMap.get(s.companyId);
                  const job = jobsMap.get(s.jobId);
                  const normalizedYomiVal = normalizeYomi(s.yomi);
                  const percentStr = Math.round(normalizedYomiVal * 100) + '%';

                  return `
                    <tr class="hover:bg-indigo-50/40 transition">
                      <td class="px-4 py-2.5 font-bold text-slate-900">${cand ? cand.name : s.candidateName}</td>
                      <td class="px-4 py-2.5 font-medium text-slate-800">${comp ? comp.name : s.companyName}</td>
                      <td class="px-4 py-2.5 text-slate-600">${job ? (job.title || job.jobName) : s.jobName}</td>
                      <td class="px-3 py-2.5 font-semibold text-indigo-700">${s.phase}</td>
                      <td class="px-3 py-2.5 text-slate-700">${s.progressStatus}</td>
                      <td class="px-3 py-2.5 text-right font-black ${normalizedYomiVal > 0 ? 'text-indigo-600' : 'text-slate-400'}">${percentStr}</td>
                      <td class="px-3 py-2.5 font-mono text-slate-700 font-bold">${s.expectedCompletionMonth || s.actionDeadline || '-'}</td>
                      <td class="px-3 py-2.5 text-center">
                        <button class="btn-detail px-2.5 py-1 bg-slate-100 hover:bg-indigo-600 hover:text-white rounded text-xs transition" data-id="${s.selectionId}">詳細</button>
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

    // イベントリスナー設定（手動切り替え時に自動で当日Qに戻さない構造: 指示書 6, 25項）
    container.querySelector('#select-cons-fy')?.addEventListener('change', (e) => {
      selectedFiscalYear = parseInt(e.target.value, 10);
      updateView();
    });

    container.querySelector('#select-cons-q')?.addEventListener('change', (e) => {
      selectedQuarter = e.target.value;
      updateView();
    });

    container.querySelector('#btn-role-ca')?.addEventListener('click', () => {
      activeRoleType = 'CA';
      updateView();
    });

    container.querySelector('#btn-role-ra')?.addEventListener('click', () => {
      activeRoleType = 'RA';
      updateView();
    });

    container.querySelector('#select-consultant-change')?.addEventListener('change', (e) => {
      activeConsultantId = e.target.value;
      updateView();
    });

    container.querySelectorAll('.btn-detail').forEach(btn => {
      btn.addEventListener('click', () => onOpenDetail(btn.getAttribute('data-id')));
    });
  }

  updateView();
}
