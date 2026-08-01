/**
 * 選考進捗・ヨミ管理システム - マスタ管理画面コンポーネント (各マスタ専用編集・2段階削除/復元・関連データ保護・引き継ぎ・状態維持対応)
 */

import { store } from '../store.js';
import { CONSULTANT_ROLES, COMPANY_RANKS, COMPANY_RANK_BADGES, JOB_STATUSES, ENTRY_SOURCES } from '../constants.js';

const MASTER_STORAGE_KEY = 'master_management_active_state';

function getSavedMasterState() {
  try {
    const raw = sessionStorage.getItem(MASTER_STORAGE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch (e) {
    return {};
  }
}

function saveMasterState(state) {
  try {
    const current = getSavedMasterState();
    sessionStorage.setItem(MASTER_STORAGE_KEY, JSON.stringify({ ...current, ...state }));
  } catch (e) {}
}

export function renderMasterManagement(container) {
  const savedState = getSavedMasterState();

  let activeTab = savedState.activeTab || 'candidates';
  let targetFiscalYear = savedState.targetFiscalYear || 2025;
  let viewFilterMode = savedState.viewFilterMode || 'activeOnly'; // activeOnly | includeInactive | includeArchived | all (指示書 18項)
  const isAdmin = store.isAdmin();

  function updateView() {
    const consultants = store.getConsultants(true);
    const companies = store.getCompanies(true);
    const jobs = store.getJobs(true);
    const candidates = store.getCandidates(true);
    const qTargets = store.getQTargets(targetFiscalYear, 'ALL');

    const consultantsMap = new Map(consultants.map(c => [c.consultantId, c]));
    const companiesMap = new Map(companies.map(c => [c.companyId, c]));
    const caConsultants = store.getCaConsultants();
    const raConsultants = store.getRaConsultants();

    saveMasterState({
      activeTab,
      targetFiscalYear,
      viewFilterMode,
      scrollTop: window.scrollY || document.documentElement.scrollTop
    });

    // フィルタリング処理 (指示書 18項)
    const filterItems = (list) => {
      if (viewFilterMode === 'activeOnly') {
        return list.filter(item => !item.isArchived && item.status !== 'inactive');
      }
      if (viewFilterMode === 'includeInactive') {
        return list.filter(item => !item.isArchived);
      }
      if (viewFilterMode === 'includeArchived') {
        return list;
      }
      return list;
    };

    container.innerHTML = `
      <div class="space-y-6 text-xs">
        <!-- ヘッダー & タブ & フィルター切り替え (指示書 18項) -->
        <div class="bg-white p-5 rounded-xl border border-slate-200 shadow-sm flex flex-col md:flex-row md:items-center md:justify-between gap-4">
          <div>
            <h2 class="text-xl font-bold text-slate-800 flex items-center gap-2">
              <svg class="w-5 h-5 text-indigo-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"></path></svg>
              マスタ管理
            </h2>
            <p class="text-xs text-slate-500 mt-1">候補者、企業、求人、コンサルタント(CA/RA)、四半期(Q)個人目標の一括編集・安全アーカイブ</p>
          </div>

          <div class="flex flex-wrap items-center gap-3">
            <!-- 一覧表示フィルター (指示書 18項) -->
            <div class="flex items-center space-x-1">
              <span class="font-bold text-slate-700">表示対象:</span>
              <select id="select-view-filter-mode" class="bg-slate-50 border border-slate-300 font-bold rounded px-2.5 py-1.5 text-slate-800 focus:outline-none">
                <option value="activeOnly" ${viewFilterMode === 'activeOnly' ? 'selected' : ''}>有効のみ (標準)</option>
                <option value="includeInactive" ${viewFilterMode === 'includeInactive' ? 'selected' : ''}>無効を含む</option>
                <option value="includeArchived" ${viewFilterMode === 'includeArchived' ? 'selected' : ''}>アーカイブを含む</option>
              </select>
            </div>

            <!-- マスタ切り替えタブ -->
            <div class="flex items-center space-x-1 bg-slate-100 p-1 rounded-lg text-xs font-bold">
              <button data-tab="candidates" class="px-3 py-2 rounded-md transition ${activeTab === 'candidates' ? 'bg-indigo-600 text-white shadow' : 'text-slate-600 hover:text-slate-900'}">
                候補者 (${candidates.filter(c => !c.isArchived).length})
              </button>
              <button data-tab="companies" class="px-3 py-2 rounded-md transition ${activeTab === 'companies' ? 'bg-indigo-600 text-white shadow' : 'text-slate-600 hover:text-slate-900'}">
                企業 (${companies.filter(c => !c.isArchived).length})
              </button>
              <button data-tab="jobs" class="px-3 py-2 rounded-md transition ${activeTab === 'jobs' ? 'bg-indigo-600 text-white shadow' : 'text-slate-600 hover:text-slate-900'}">
                求人 (${jobs.filter(j => !j.isArchived).length})
              </button>
              ${isAdmin ? `
                <button data-tab="consultants" class="px-3 py-2 rounded-md transition ${activeTab === 'consultants' ? 'bg-indigo-600 text-white shadow' : 'text-slate-600 hover:text-slate-900'}">
                  コンサル (CA/RA)
                </button>
                <button data-tab="targets" class="px-3 py-2 rounded-md transition ${activeTab === 'targets' ? 'bg-indigo-600 text-white shadow' : 'text-slate-600 hover:text-slate-900'}">
                  個人Q目標管理
                </button>
                <button data-tab="data_management" class="px-3 py-2 rounded-md transition ${activeTab === 'data_management' ? 'bg-rose-600 text-white shadow font-black' : 'text-rose-700 bg-rose-50 hover:bg-rose-100'}">
                  ⚙️ データ管理・初期化
                </button>
              ` : ''}
            </div>
          </div>
        </div>

        <div class="bg-white rounded-xl border border-slate-200 shadow-sm p-6">
          ${activeTab === 'candidates' ? renderCandidateMaster(filterItems(candidates), consultantsMap, caConsultants, isAdmin) : ''}
          ${activeTab === 'companies' ? renderCompanyMaster(filterItems(companies), consultantsMap, raConsultants, isAdmin) : ''}
          ${activeTab === 'jobs' ? renderJobMaster(filterItems(jobs), companiesMap, consultantsMap, raConsultants, isAdmin) : ''}
          ${activeTab === 'consultants' && isAdmin ? renderConsultantMaster(filterItems(consultants)) : ''}
          ${activeTab === 'targets' && isAdmin ? renderQTargetMaster(consultants, qTargets, targetFiscalYear, (fy) => { targetFiscalYear = fy; saveMasterState({ targetFiscalYear: fy }); updateView(); }) : ''}
          ${activeTab === 'data_management' && isAdmin ? renderDataManagementSection(updateView) : ''}
        </div>
      </div>
    `;

    container.querySelector('#select-view-filter-mode')?.addEventListener('change', (e) => {
      viewFilterMode = e.target.value;
      saveMasterState({ viewFilterMode });
      updateView();
    });

    container.querySelectorAll('button[data-tab]').forEach(btn => {
      btn.addEventListener('click', () => {
        activeTab = btn.getAttribute('data-tab');
        saveMasterState({ activeTab });
        updateView();
      });
    });

    bindMasterEvents(container, updateView, targetFiscalYear);
  }

  updateView();
}

/**
 * 候補者マスタ一覧 (編集・アーカイブ・復元・完全削除対応) (指示書 4, 5, 7, 12, 18項)
 */
function renderCandidateMaster(candidates, consultantsMap, caConsultants, isAdmin) {
  return `
    <div class="space-y-4">
      <div class="flex items-center justify-between">
        <h3 class="font-bold text-slate-800 text-sm">候補者マスタ一覧</h3>
        <button id="btn-add-candidate-modal" class="px-3.5 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-xs rounded-lg shadow transition">
          + 新規候補者登録
        </button>
      </div>

      <div class="overflow-x-auto">
        <table class="w-full text-left text-xs">
          <thead class="bg-slate-50 text-slate-700 font-semibold border-b border-slate-200">
            <tr>
              <th class="px-3 py-2.5">管理番号</th>
              <th class="px-3 py-2.5">候補者名 (フリガナ)</th>
              <th class="px-3 py-2.5">担当CA</th>
              <th class="px-3 py-2.5">活動状態</th>
              <th class="px-3 py-2.5">状態</th>
              <th class="px-3 py-2.5 text-center">操作</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-slate-200">
            ${candidates.map(c => {
              const ca = consultantsMap.get(c.caId || c.caConsultantId);
              return `
                <tr class="${c.isArchived ? 'bg-slate-100/80 text-slate-400' : 'hover:bg-slate-50'} transition">
                  <td class="px-3 py-2.5 font-mono text-slate-600">${c.internalManagementNumber || '-'}</td>
                  <td class="px-3 py-2.5 font-bold text-slate-900">
                    ${c.name} <span class="text-slate-400 font-normal">(${c.kana || ''})</span>
                  </td>
                  <td class="px-3 py-2.5 font-semibold text-indigo-700">${ca ? ca.name : '未設定'}</td>
                  <td class="px-3 py-2.5"><span class="px-2 py-0.5 bg-slate-100 rounded text-slate-700 font-medium">${c.activityStatus || '選考中'}</span></td>
                  <td class="px-3 py-2.5">
                    ${c.isArchived 
                      ? '<span class="px-2 py-0.5 bg-rose-100 text-rose-800 font-bold rounded">アーカイブ済み</span>' 
                      : '<span class="px-2 py-0.5 bg-emerald-100 text-emerald-800 font-bold rounded">有効</span>'}
                  </td>
                  <td class="px-3 py-2.5 text-center space-x-1 font-bold">
                    <button class="btn-edit-candidate px-2.5 py-1 bg-slate-100 hover:bg-indigo-600 hover:text-white rounded text-[11px] transition" data-id="${c.candidateId}">編集</button>
                    ${!c.isArchived ? `
                      <button class="btn-archive-item px-2.5 py-1 bg-amber-50 text-amber-800 hover:bg-amber-600 hover:text-white rounded text-[11px] transition" data-type="candidate" data-id="${c.candidateId}" data-name="${c.name}">アーカイブ</button>
                    ` : `
                      <button class="btn-restore-item px-2.5 py-1 bg-emerald-50 text-emerald-800 hover:bg-emerald-600 hover:text-white rounded text-[11px] transition" data-type="candidate" data-id="${c.candidateId}">復元</button>
                      ${isAdmin ? `<button class="btn-delete-perm-item px-2.5 py-1 bg-rose-50 text-rose-700 hover:bg-rose-600 hover:text-white rounded text-[11px] transition" data-type="candidate" data-id="${c.candidateId}" data-name="${c.name}">完全削除</button>` : ''}
                    `}
                  </td>
                </tr>
              `;
            }).join('')}
          </tbody>
        </table>
      </div>
    </div>
  `;
}

/**
 * 企業マスタ一覧 (編集・アーカイブ・復元・完全削除対応) (指示書 4, 5, 8, 12, 18項)
 */
function renderCompanyMaster(companies, consultantsMap, raConsultants, isAdmin) {
  return `
    <div class="space-y-4">
      <div class="flex items-center justify-between">
        <h3 class="font-bold text-slate-800 text-sm">企業マスタ一覧</h3>
        <button id="btn-add-company-modal" class="px-3.5 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-xs rounded-lg shadow transition">
          + 新規企業登録
        </button>
      </div>

      <div class="overflow-x-auto">
        <table class="w-full text-left text-xs">
          <thead class="bg-slate-50 text-slate-700 font-semibold border-b border-slate-200">
            <tr>
              <th class="px-3 py-2.5">企業名</th>
              <th class="px-3 py-2.5">ランク</th>
              <th class="px-3 py-2.5">主担当RA</th>
              <th class="px-3 py-2.5">人事担当者</th>
              <th class="px-3 py-2.5">状態</th>
              <th class="px-3 py-2.5 text-center">操作</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-slate-200">
            ${companies.map(c => {
              const rankBadge = COMPANY_RANK_BADGES[c.rank] || COMPANY_RANK_BADGES['B'];
              const ra = consultantsMap.get(c.primaryRaId || c.raConsultantId);
              return `
                <tr class="${c.isArchived ? 'bg-slate-100/80 text-slate-400' : 'hover:bg-slate-50'} transition">
                  <td class="px-3 py-2.5 font-bold text-slate-900">${c.name}</td>
                  <td class="px-3 py-2.5"><span class="px-2 py-0.5 rounded text-[10px] font-extrabold border ${rankBadge.badgeClass}">${rankBadge.label}</span></td>
                  <td class="px-3 py-2.5 font-semibold text-indigo-700">${ra ? ra.name : '未設定'}</td>
                  <td class="px-3 py-2.5 text-slate-800">${c.contactPerson || c.contactName || '-'} (${c.contactEmail || '-'})</td>
                  <td class="px-3 py-2.5">
                    ${c.isArchived 
                      ? '<span class="px-2 py-0.5 bg-rose-100 text-rose-800 font-bold rounded">アーカイブ済み</span>' 
                      : '<span class="px-2 py-0.5 bg-emerald-100 text-emerald-800 font-bold rounded">有効</span>'}
                  </td>
                  <td class="px-3 py-2.5 text-center space-x-1 font-bold">
                    <button class="btn-edit-company px-2.5 py-1 bg-slate-100 hover:bg-indigo-600 hover:text-white rounded text-[11px] transition" data-id="${c.companyId}">編集</button>
                    ${!c.isArchived ? `
                      <button class="btn-archive-item px-2.5 py-1 bg-amber-50 text-amber-800 hover:bg-amber-600 hover:text-white rounded text-[11px] transition" data-type="company" data-id="${c.companyId}" data-name="${c.name}">アーカイブ</button>
                    ` : `
                      <button class="btn-restore-item px-2.5 py-1 bg-emerald-50 text-emerald-800 hover:bg-emerald-600 hover:text-white rounded text-[11px] transition" data-type="company" data-id="${c.companyId}">復元</button>
                      ${isAdmin ? `<button class="btn-delete-perm-item px-2.5 py-1 bg-rose-50 text-rose-700 hover:bg-rose-600 hover:text-white rounded text-[11px] transition" data-type="company" data-id="${c.companyId}" data-name="${c.name}">完全削除</button>` : ''}
                    `}
                  </td>
                </tr>
              `;
            }).join('')}
          </tbody>
        </table>
      </div>
    </div>
  `;
}

/**
 * 求人マスタ一覧 (編集・アーカイブ・復元・完全削除対応) (指示書 4, 5, 9, 12, 18項)
 */
function renderJobMaster(jobs, companiesMap, consultantsMap, raConsultants, isAdmin) {
  return `
    <div class="space-y-4">
      <div class="flex items-center justify-between">
        <h3 class="font-bold text-slate-800 text-sm">求人・ポジションマスタ一覧</h3>
        <button id="btn-add-job-modal" class="px-3.5 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-xs rounded-lg shadow transition">
          + 新規求人登録
        </button>
      </div>

      <div class="overflow-x-auto">
        <table class="w-full text-left text-xs">
          <thead class="bg-slate-50 text-slate-700 font-semibold border-b border-slate-200">
            <tr>
              <th class="px-3 py-2.5">求人名</th>
              <th class="px-3 py-2.5">対象企業</th>
              <th class="px-3 py-2.5">勤務地</th>
              <th class="px-3 py-2.5">募集状態</th>
              <th class="px-3 py-2.5">状態</th>
              <th class="px-3 py-2.5 text-center">操作</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-slate-200">
            ${jobs.map(j => {
              const comp = companiesMap.get(j.companyId);
              return `
                <tr class="${j.isArchived ? 'bg-slate-100/80 text-slate-400' : 'hover:bg-slate-50'} transition">
                  <td class="px-3 py-2.5 font-bold text-slate-900">${j.title || j.jobName}</td>
                  <td class="px-3 py-2.5 font-semibold text-indigo-700">${comp ? comp.name : (j.companyName || '未設定')}</td>
                  <td class="px-3 py-2.5 text-slate-600">${j.location || '-'}</td>
                  <td class="px-3 py-2.5"><span class="px-2 py-0.5 bg-slate-100 rounded font-bold text-slate-800">${j.status || '募集中'}</span></td>
                  <td class="px-3 py-2.5">
                    ${j.isArchived 
                      ? '<span class="px-2 py-0.5 bg-rose-100 text-rose-800 font-bold rounded">アーカイブ済み</span>' 
                      : '<span class="px-2 py-0.5 bg-emerald-100 text-emerald-800 font-bold rounded">有効</span>'}
                  </td>
                  <td class="px-3 py-2.5 text-center space-x-1 font-bold">
                    <button class="btn-edit-job px-2.5 py-1 bg-slate-100 hover:bg-indigo-600 hover:text-white rounded text-[11px] transition" data-id="${j.jobId}">編集</button>
                    ${!j.isArchived ? `
                      <button class="btn-archive-item px-2.5 py-1 bg-amber-50 text-amber-800 hover:bg-amber-600 hover:text-white rounded text-[11px] transition" data-type="job" data-id="${j.jobId}" data-name="${j.title || j.jobName}">アーカイブ</button>
                    ` : `
                      <button class="btn-restore-item px-2.5 py-1 bg-emerald-50 text-emerald-800 hover:bg-emerald-600 hover:text-white rounded text-[11px] transition" data-type="job" data-id="${j.jobId}">復元</button>
                      ${isAdmin ? `<button class="btn-delete-perm-item px-2.5 py-1 bg-rose-50 text-rose-700 hover:bg-rose-600 hover:text-white rounded text-[11px] transition" data-type="job" data-id="${j.jobId}" data-name="${j.title || j.jobName}">完全削除</button>` : ''}
                    `}
                  </td>
                </tr>
              `;
            }).join('')}
          </tbody>
        </table>
      </div>
    </div>
  `;
}

/**
 * コンサルタントマスタ一覧 (編集・アーカイブ・復元・完全削除・引き継ぎ対応) (指示書 4, 5, 10, 11, 12, 18項)
 */
function renderConsultantMaster(consultants) {
  return `
    <div class="space-y-4">
      <div class="flex items-center justify-between">
        <h3 class="font-bold text-slate-800 text-sm">コンサルタントマスタ一覧</h3>
        <button id="btn-add-consultant-modal" class="px-3.5 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-xs rounded-lg shadow transition">
          ＋ 新規コンサルを追加
        </button>
      </div>

      <div class="overflow-x-auto">
        <table class="w-full text-left text-xs">
          <thead class="bg-slate-50 text-slate-700 font-semibold border-b border-slate-200">
            <tr>
              <th class="px-3 py-2.5">氏名</th>
              <th class="px-3 py-2.5">メールアドレス</th>
              <th class="px-3 py-2.5">役割区分</th>
              <th class="px-3 py-2.5">状態</th>
              <th class="px-3 py-2.5 text-center">操作</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-slate-200">
            ${consultants.map(c => {
              const isEff = c.status !== 'inactive' && !c.isArchived;
              const rolesList = (c.roles && Array.isArray(c.roles) && c.roles.length > 0)
                ? c.roles
                : [c.roleType || 'CA'];

              const roleBadgesHTML = rolesList.map(r => {
                if (r === 'CA') return '<span class="px-2 py-0.5 bg-blue-100 text-blue-800 border border-blue-200 font-extrabold rounded text-[11px] mr-1">CA</span>';
                if (r === 'RA') return '<span class="px-2 py-0.5 bg-purple-100 text-purple-800 border border-purple-200 font-extrabold rounded text-[11px] mr-1">RA</span>';
                if (r === 'ADMIN') return '<span class="px-2 py-0.5 bg-rose-100 text-rose-800 border border-rose-200 font-extrabold rounded text-[11px] mr-1">管理者</span>';
                return `<span class="px-2 py-0.5 bg-slate-100 text-slate-800 font-bold rounded text-[11px] mr-1">${r}</span>`;
              }).join('');

              return `
                <tr class="${c.isArchived ? 'bg-slate-100/80 text-slate-400' : 'hover:bg-slate-50'} transition">
                  <td class="px-3 py-2.5 font-bold text-slate-900">${c.name}</td>
                  <td class="px-3 py-2.5 font-mono text-slate-600">${c.email}</td>
                  <td class="px-3 py-2.5 font-bold">${roleBadgesHTML}</td>
                  <td class="px-3 py-2.5">
                    ${c.isArchived 
                      ? '<span class="px-2 py-0.5 bg-rose-100 text-rose-800 font-bold rounded">アーカイブ済み</span>' 
                      : (isEff ? '<span class="px-2 py-0.5 bg-emerald-100 text-emerald-800 font-bold rounded">有効</span>' : '<span class="px-2 py-0.5 bg-slate-200 text-slate-700 font-bold rounded">無効</span>')}
                  </td>
                  <td class="px-3 py-2.5 text-center space-x-1 font-bold">
                    <button class="btn-edit-consultant px-2.5 py-1 bg-slate-100 hover:bg-indigo-600 hover:text-white rounded text-[11px] transition" data-id="${c.consultantId}">編集</button>
                    ${!c.isArchived ? `
                      <button class="btn-archive-item px-2.5 py-1 bg-amber-50 text-amber-800 hover:bg-amber-600 hover:text-white rounded text-[11px] transition" data-type="consultant" data-id="${c.consultantId}" data-name="${c.name}">アーカイブ</button>
                    ` : `
                      <button class="btn-restore-item px-2.5 py-1 bg-emerald-50 text-emerald-800 hover:bg-emerald-600 hover:text-white rounded text-[11px] transition" data-type="consultant" data-id="${c.consultantId}">復元</button>
                      <button class="btn-delete-perm-item px-2.5 py-1 bg-rose-50 text-rose-700 hover:bg-rose-600 hover:text-white rounded text-[11px] transition" data-type="consultant" data-id="${c.consultantId}" data-name="${c.name}">完全削除</button>
                    `}
                  </td>
                </tr>
              `;
            }).join('')}
          </tbody>
        </table>
      </div>
    </div>
  `;
}

function renderQTargetMaster(consultants, qTargets, targetFiscalYear, onYearChange) {
  const caConsultants = consultants.filter(c => !c.isArchived && (c.roleType === 'CA' || c.role === 'member' && !c.roleType));
  const qTargetMap = new Map();

  qTargets.forEach(t => {
    const key = `${t.consultantId}_${t.quarter}`;
    qTargetMap.set(key, Number(t.targetCount || 0));
  });

  return `
    <div class="space-y-4">
      <div class="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 border-b border-slate-200 pb-3">
        <div>
          <h3 class="font-bold text-slate-800 text-sm">個人四半期（Q）目標の一括設定 (CAのみ対象)</h3>
          <p class="text-xs text-slate-500">10月開始の年度のCA個人目標件数を設定します。※RAおよび管理者は個人目標対象外です。</p>
        </div>

        <div class="flex items-center space-x-2 text-xs">
          <span class="font-bold text-slate-700">対象年度:</span>
          <select id="select-target-fiscal-year" class="bg-slate-50 border border-slate-300 font-bold rounded px-3 py-1.5 text-slate-800 focus:outline-none">
            <option value="2025" ${targetFiscalYear === 2025 ? 'selected' : ''}>2025年度 (2025/10〜2026/09)</option>
            <option value="2026" ${targetFiscalYear === 2026 ? 'selected' : ''}>2026年度 (2026/10〜2027/09)</option>
          </select>
        </div>
      </div>

      <div id="q-target-toast" class="hidden p-3 rounded-lg text-xs font-bold transition"></div>

      <div class="overflow-x-auto">
        <table class="w-full text-left text-xs bg-white border border-slate-200 rounded-lg">
          <thead class="bg-slate-900 text-slate-200 font-semibold border-b border-slate-800">
            <tr>
              <th class="px-4 py-3">コンサルタント名 (CA)</th>
              <th class="px-3 py-3">役割</th>
              <th class="px-3 py-3 text-center">1Q目標 (10-12月)</th>
              <th class="px-3 py-3 text-center">2Q目標 (1-3月)</th>
              <th class="px-3 py-3 text-center">3Q目標 (4-6月)</th>
              <th class="px-3 py-3 text-center">4Q目標 (7-9月)</th>
              <th class="px-3 py-3 text-right">年度通期合計</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-slate-200">
            ${caConsultants.length === 0 ? `
              <tr><td colspan="7" class="text-center py-8 text-slate-400">目標設定対象のCAコンサルタントが登録されていません。</td></tr>
            ` : caConsultants.map(c => {
              const q1 = qTargetMap.get(`${c.consultantId}_Q1`) || 0;
              const q2 = qTargetMap.get(`${c.consultantId}_Q2`) || 0;
              const q3 = qTargetMap.get(`${c.consultantId}_Q3`) || 0;
              const q4 = qTargetMap.get(`${c.consultantId}_Q4`) || 0;
              const yearTotal = q1 + q2 + q3 + q4;

              return `
                <tr class="hover:bg-slate-50 transition">
                  <td class="px-4 py-3 font-bold text-slate-900">${c.name}</td>
                  <td class="px-3 py-3 text-indigo-700 font-semibold">CA</td>

                  <td class="px-3 py-2 text-center">
                    <input type="number" min="0" value="${q1}" class="input-q-target w-20 bg-slate-50 border border-slate-300 rounded px-2 py-1 text-center font-bold text-slate-900 focus:bg-white focus:border-indigo-600" data-consultant-id="${c.consultantId}" data-quarter="Q1" data-consultant-name="${c.name}">
                  </td>

                  <td class="px-3 py-2 text-center">
                    <input type="number" min="0" value="${q2}" class="input-q-target w-20 bg-slate-50 border border-slate-300 rounded px-2 py-1 text-center font-bold text-slate-900 focus:bg-white focus:border-indigo-600" data-consultant-id="${c.consultantId}" data-quarter="Q2" data-consultant-name="${c.name}">
                  </td>

                  <td class="px-3 py-2 text-center">
                    <input type="number" min="0" value="${q3}" class="input-q-target w-20 bg-slate-50 border border-slate-300 rounded px-2 py-1 text-center font-bold text-slate-900 focus:bg-white focus:border-indigo-600" data-consultant-id="${c.consultantId}" data-quarter="Q3" data-consultant-name="${c.name}">
                  </td>

                  <td class="px-3 py-2 text-center">
                    <input type="number" min="0" value="${q4}" class="input-q-target w-20 bg-slate-50 border border-slate-300 rounded px-2 py-1 text-center font-bold text-slate-900 focus:bg-white focus:border-indigo-600" data-consultant-id="${c.consultantId}" data-quarter="Q4" data-consultant-name="${c.name}">
                  </td>

                  <td class="px-3 py-3 text-right font-black text-indigo-700 text-sm">
                    ${yearTotal}件
                  </td>
                </tr>
              `;
            }).join('')}
          </tbody>
        </table>
      </div>
    </div>
  `;
}

function bindMasterEvents(container, updateView, targetFiscalYear) {
  container.querySelector('#select-target-fiscal-year')?.addEventListener('change', (e) => {
    const fy = parseInt(e.target.value, 10);
    saveMasterState({ targetFiscalYear: fy });
    updateView();
  });

  container.querySelectorAll('.input-q-target').forEach(input => {
    input.addEventListener('change', (e) => {
      const cId = input.getAttribute('data-consultant-id');
      const q = input.getAttribute('data-quarter');
      const cName = input.getAttribute('data-consultant-name');
      const val = Number(e.target.value);

      const toastEl = container.querySelector('#q-target-toast');
      if (toastEl) {
        toastEl.className = 'p-3 bg-indigo-50 border border-indigo-200 text-indigo-900 rounded-lg text-xs font-bold';
        toastEl.textContent = '個人Q目標を保存しました。';
        toastEl.classList.remove('hidden');
        setTimeout(() => toastEl.classList.add('hidden'), 3000);
      }

      store.saveQTarget({
        consultantId: cId,
        consultantName: cName,
        fiscalYear: targetFiscalYear,
        quarter: q,
        targetCount: val
      });
    });
  });

  // 1. アーカイブ操作 (指示書 3, 6項)
  container.querySelectorAll('.btn-archive-item').forEach(btn => {
    btn.addEventListener('click', () => {
      const type = btn.getAttribute('data-type');
      const id = btn.getAttribute('data-id');
      const name = btn.getAttribute('data-name');

      // コンサル無効化/アーカイブ時の担当引き継ぎチェック (指示書 11項)
      if (type === 'consultant') {
        const counts = store.getRelatedDataCounts('consultant', id);
        if (counts.hasRelatedData) {
          openReassignModal(id, name, counts, () => {
            store.archiveMasterItem('consultant', id, 'マスタ管理画面からのアーカイブ');
            updateView();
          });
          return;
        }
      }

      if (confirm(`【アーカイブ確認】\n「${name}」をアーカイブしますか？\n\n・通常の一覧や選択候補から非表示になります。\n・関連する選考案件や履歴は削除されません。`)) {
        store.archiveMasterItem(type, id, 'マスタ管理画面からのアーカイブ');
        updateView();
      }
    });
  });

  // 2. 復元操作 (指示书 12項)
  container.querySelectorAll('.btn-restore-item').forEach(btn => {
    btn.addEventListener('click', () => {
      const type = btn.getAttribute('data-type');
      const id = btn.getAttribute('data-id');
      if (confirm('【復元確認】\nこのデータを復元しますか？\n通常の一覧や選択候補に再表示されます。')) {
        store.restoreMasterItem(type, id);
        updateView();
      }
    });
  });

  // 3. 管理者限定 完全物理削除 (指示書 3, 6, 7, 8, 9, 10項)
  container.querySelectorAll('.btn-delete-perm-item').forEach(btn => {
    btn.addEventListener('click', () => {
      const type = btn.getAttribute('data-type');
      const id = btn.getAttribute('data-id');
      const name = btn.getAttribute('data-name');

      // 関連データ件数チェック (指示書 7, 8, 9, 10項)
      const counts = store.getRelatedDataCounts(type, id);
      if (counts.hasRelatedData) {
        let warningText = `【完全削除不可の警告】\n「${name}」には以下の関連データが存在するため、完全に削除することはできません。\n\n`;
        if (type === 'candidate') warningText += `・選考案件: ${counts.totalSelectionCount}件\n`;
        if (type === 'company') warningText += `・求人: ${counts.totalJobCount}件\n・選考案件: ${counts.totalSelectionCount}件\n・連絡履歴: ${counts.commCount}件\n・提出履歴: ${counts.subCount}件\n`;
        if (type === 'job') warningText += `・選考案件: ${counts.totalSelectionCount}件\n`;
        if (type === 'consultant') warningText += `・担当候補者: ${counts.caCandidateCount}件\n・担当企業: ${counts.raCompanyCount}件\n・選考案件: ${counts.selectionCount}件\n`;

        warningText += `\n過去の選考記録や履歴を保全するため、アーカイブ機能をご利用ください。`;
        alert(warningText);
        return;
      }

      if (confirm(`【管理者用 完全削除確認】\n「${name}」を完全に削除しますか？\n\n※この操作は取り消せません。`)) {
        store.deleteMasterItemPermanently(type, id);
        updateView();
      }
    });
  });

  // 4. 新規モーダルの呼び出し
  container.querySelector('#btn-add-company-modal')?.addEventListener('click', () => {
    openCompanyFormModal(null, () => updateView());
  });

  container.querySelector('#btn-add-job-modal')?.addEventListener('click', () => {
    openJobFormModal(null, () => updateView());
  });

  container.querySelector('#btn-add-consultant-modal')?.addEventListener('click', () => {
    openConsultantFormModal(null, () => updateView());
  });

  container.querySelector('#btn-add-candidate-modal')?.addEventListener('click', () => {
    openCandidateFormModal(null, () => updateView());
  });

  // 5. 編集モーダルの呼び出し (指示書 5項)
  container.querySelectorAll('.btn-edit-candidate').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = btn.getAttribute('data-id');
      const cand = store.getCandidates(true).find(c => c.candidateId === id);
      if (cand) openCandidateFormModal(cand, () => updateView());
    });
  });

  container.querySelectorAll('.btn-edit-company').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = btn.getAttribute('data-id');
      const comp = store.getCompanies(true).find(c => c.companyId === id);
      if (comp) openCompanyFormModal(comp, () => updateView());
    });
  });

  container.querySelectorAll('.btn-edit-job').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = btn.getAttribute('data-id');
      const job = store.getJobs(true).find(j => j.jobId === id);
      if (job) openJobFormModal(job, () => updateView());
    });
  });

  container.querySelectorAll('.btn-edit-consultant').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = btn.getAttribute('data-id');
      const cons = store.getConsultants(true).find(c => c.consultantId === id);
      if (cons) openConsultantFormModal(cons, () => updateView());
    });
  });
}

/**
 * 候補者 登録・編集モーダル (指示書 5項)
 */
function openCandidateFormModal(candidate = null, onClose) {
  let modalEl = document.getElementById('candidate-form-modal');
  if (modalEl) modalEl.remove();

  const isEdit = !!candidate;
  const caConsultants = store.getCaConsultants();

  modalEl = document.createElement('div');
  modalEl.id = 'candidate-form-modal';
  modalEl.className = 'fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4 overflow-y-auto text-xs';

  const currentEntrySource = candidate ? (candidate.entrySource || 'UNSET') : 'UNSET';

  modalEl.innerHTML = `
    <div class="bg-white rounded-2xl shadow-2xl border border-slate-200 w-full max-w-lg p-6 space-y-4 animate-fadeIn">
      <div class="flex items-center justify-between border-b border-slate-200 pb-3">
        <h3 class="text-base font-bold text-slate-800">${isEdit ? '候補者情報の編集' : '新規候補者の登録'}</h3>
        <button id="btn-cand-modal-close" class="text-slate-400 hover:text-slate-600 p-1">
          <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path></svg>
        </button>
      </div>

      <form id="form-cand" class="space-y-4" onsubmit="return false;">
        <div class="grid grid-cols-2 gap-3">
          <div>
            <label class="block font-bold text-slate-800 mb-1">候補者名 <span class="text-rose-500">*</span></label>
            <input type="text" id="cand-name" value="${candidate ? candidate.name : ''}" required placeholder="山田 太郎" class="w-full bg-slate-50 border border-slate-300 rounded px-3 py-2 font-bold text-slate-900 focus:bg-white focus:border-indigo-600 focus:outline-none">
          </div>
          <div>
            <label class="block font-bold text-slate-800 mb-1">フリガナ</label>
            <input type="text" id="cand-kana" value="${candidate ? (candidate.kana || '') : ''}" placeholder="ヤマダ タロウ" class="w-full bg-slate-50 border border-slate-300 rounded px-3 py-2 font-bold text-slate-900 focus:bg-white focus:border-indigo-600 focus:outline-none">
          </div>
        </div>

        <div class="grid grid-cols-2 gap-3">
          <div>
            <label class="block font-bold text-slate-800 mb-1">担当CA <span class="text-rose-500">*</span></label>
            <select id="cand-ca-id" required class="w-full bg-slate-50 border border-slate-300 font-bold rounded px-2.5 py-1.5 text-indigo-700 focus:outline-none">
              ${caConsultants.map(c => `<option value="${c.consultantId}" ${candidate && (candidate.caId || candidate.caConsultantId) === c.consultantId ? 'selected' : ''}>${c.name} (CA)</option>`).join('')}
            </select>
          </div>
          <div>
            <label class="block font-bold text-slate-800 mb-1">活動状態</label>
            <input type="text" id="cand-status" value="${candidate ? (candidate.activityStatus || '選考中') : '選考中'}" class="w-full bg-slate-50 border border-slate-300 rounded px-2.5 py-1.5 focus:outline-none font-semibold">
          </div>
        </div>

        <!-- エントリー経路 -->
        <div class="grid grid-cols-2 gap-3 bg-indigo-50/50 p-3 rounded-lg border border-indigo-100">
          <div>
            <label class="block font-bold text-slate-800 mb-1">代表エントリー経路</label>
            <select id="cand-entry-source" class="w-full bg-white border border-slate-300 rounded px-2.5 py-1.5 font-bold focus:outline-none">
              <option value="UNSET">未設定</option>
              ${ENTRY_SOURCES.map(s => `<option value="${s.code}" ${currentEntrySource === s.code ? 'selected' : ''}>${s.label}</option>`).join('')}
            </select>
          </div>
          <div>
            <label class="block font-bold text-slate-800 mb-1">パスアップ/経路詳細</label>
            <input type="text" id="cand-entry-detail" value="${candidate ? (candidate.entrySourceDetail || '') : ''}" placeholder="例: 若山さんスカウト" class="w-full bg-white border border-slate-300 rounded px-2.5 py-1.5 font-bold focus:outline-none">
          </div>
        </div>

        <div>
          <label class="block font-semibold text-slate-700 mb-1">備考</label>
          <textarea id="cand-remarks" rows="2" class="w-full bg-slate-50 border border-slate-300 rounded p-2 focus:outline-none">${candidate ? (candidate.remarks || '') : ''}</textarea>
        </div>
      </form>

      <div class="flex items-center justify-end space-x-3 border-t border-slate-200 pt-3">
        <button id="btn-cand-cancel" class="px-4 py-2 bg-white border border-slate-300 text-slate-700 rounded-lg font-bold hover:bg-slate-100 transition">キャンセル</button>
        <button id="btn-cand-submit" class="px-5 py-2 bg-indigo-600 hover:bg-indigo-500 text-white font-bold rounded-lg shadow transition">${isEdit ? '更新保存' : '登録する'}</button>
      </div>
    </div>
  `;

  document.body.appendChild(modalEl);

  modalEl.querySelector('#btn-cand-submit')?.addEventListener('click', () => {
    const name = modalEl.querySelector('#cand-name').value.trim();
    const kana = modalEl.querySelector('#cand-kana').value.trim();
    const caId = modalEl.querySelector('#cand-ca-id').value;
    const activityStatus = modalEl.querySelector('#cand-status').value;
    const entrySource = modalEl.querySelector('#cand-entry-source').value;
    const entrySourceDetail = modalEl.querySelector('#cand-entry-detail').value.trim();
    const remarks = modalEl.querySelector('#cand-remarks').value;

    if (!name) {
      alert('候補者名を入力してください。');
      return;
    }

    store.saveCandidate({
      candidateId: candidate ? candidate.candidateId : undefined,
      name,
      kana: kana || name,
      caId,
      caConsultantId: caId,
      activityStatus,
      entrySource,
      entrySourceDetail,
      remarks
    }, true);

    modalEl.remove();
    onClose();
  });

  modalEl.querySelector('#btn-cand-modal-close')?.addEventListener('click', () => modalEl.remove());
  modalEl.querySelector('#btn-cand-cancel')?.addEventListener('click', () => modalEl.remove());
}

/**
 * 企業 登録・編集モーダル (指示書 5項)
 */
function openCompanyFormModal(company = null, onClose) {
  let modalEl = document.getElementById('company-form-modal');
  if (modalEl) modalEl.remove();

  const isEdit = !!company;
  const raConsultants = store.getRaConsultants();

  modalEl = document.createElement('div');
  modalEl.id = 'company-form-modal';
  modalEl.className = 'fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4 overflow-y-auto text-xs';

  modalEl.innerHTML = `
    <div class="bg-white rounded-2xl shadow-2xl border border-slate-200 w-full max-w-lg p-6 space-y-4 animate-fadeIn">
      <div class="flex items-center justify-between border-b border-slate-200 pb-3">
        <h3 class="text-base font-bold text-slate-800">${isEdit ? '企業情報の編集' : '新規企業の登録'}</h3>
        <button id="btn-comp-modal-close" class="text-slate-400 hover:text-slate-600 p-1">
          <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path></svg>
        </button>
      </div>

      <form id="form-comp" class="space-y-4" onsubmit="return false;">
        <div>
          <label class="block font-bold text-slate-800 mb-1">企業名 <span class="text-rose-500">*</span></label>
          <input type="text" id="comp-name" value="${company ? company.name : ''}" required class="w-full bg-slate-50 border border-slate-300 rounded px-3 py-2 font-bold text-slate-900 focus:bg-white focus:border-indigo-600 focus:outline-none">
        </div>

        <div class="grid grid-cols-2 gap-3">
          <div>
            <label class="block font-bold text-slate-800 mb-1">企業ランク</label>
            <select id="comp-rank" class="w-full bg-slate-50 border border-slate-300 font-bold rounded px-2.5 py-1.5 text-slate-800 focus:outline-none">
              ${COMPANY_RANKS.map(r => `<option value="${r}" ${company && company.rank === r ? 'selected' : ''}>ランク: ${r}</option>`).join('')}
            </select>
          </div>

          <div>
            <label class="block font-bold text-slate-800 mb-1">主担当RA</label>
            <select id="comp-ra-id" class="w-full bg-slate-50 border border-slate-300 font-bold rounded px-2.5 py-1.5 text-slate-800 focus:outline-none">
              ${raConsultants.map(c => `<option value="${c.consultantId}" ${company && (company.primaryRaId || company.raConsultantId) === c.consultantId ? 'selected' : ''}>${c.name} (RA)</option>`).join('')}
            </select>
          </div>
        </div>

        <div class="grid grid-cols-2 gap-3 bg-slate-50 p-3 rounded-lg border border-slate-200">
          <div>
            <label class="block font-bold text-slate-700 mb-1">人事担当者名</label>
            <input type="text" id="comp-contact-name" value="${company ? (company.contactPerson || company.contactName || '') : ''}" class="w-full bg-white border border-slate-300 rounded px-2.5 py-1.5 focus:outline-none">
          </div>

          <div>
            <label class="block font-bold text-slate-700 mb-1">人事担当者メール</label>
            <input type="email" id="comp-contact-email" value="${company ? (company.contactEmail || '') : ''}" class="w-full bg-white border border-slate-300 rounded px-2.5 py-1.5 focus:outline-none">
          </div>
        </div>

        <div>
          <label class="block font-semibold text-slate-700 mb-1">備考</label>
          <textarea id="comp-remarks" rows="2" class="w-full bg-slate-50 border border-slate-300 rounded p-2 focus:outline-none">${company ? (company.remarks || '') : ''}</textarea>
        </div>
      </form>

      <div class="flex items-center justify-end space-x-3 border-t border-slate-200 pt-3">
        <button id="btn-comp-cancel" class="px-4 py-2 bg-white border border-slate-300 text-slate-700 rounded-lg font-bold hover:bg-slate-100 transition">キャンセル</button>
        <button id="btn-comp-submit" class="px-5 py-2 bg-indigo-600 hover:bg-indigo-500 text-white font-bold rounded-lg shadow transition">${isEdit ? '更新保存' : '登録する'}</button>
      </div>
    </div>
  `;

  document.body.appendChild(modalEl);

  modalEl.querySelector('#btn-comp-submit')?.addEventListener('click', () => {
    const name = modalEl.querySelector('#comp-name').value.trim();
    const rank = modalEl.querySelector('#comp-rank').value;
    const raId = modalEl.querySelector('#comp-ra-id').value;
    const contactName = modalEl.querySelector('#comp-contact-name').value.trim();
    const contactEmail = modalEl.querySelector('#comp-contact-email').value.trim();
    const remarks = modalEl.querySelector('#comp-remarks').value;

    if (!name) {
      alert('企業名を入力してください。');
      return;
    }

    if (contactEmail) {
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(contactEmail)) {
        alert('メールアドレスの形式を確認してください。');
        return;
      }
    }

    store.saveCompany({
      companyId: company ? company.companyId : undefined,
      name,
      rank,
      primaryRaId: raId,
      contactName,
      contactPerson: contactName,
      contactEmail,
      remarks,
      checkIntervalDays: 3
    }, true);

    modalEl.remove();
    onClose();
  });

  modalEl.querySelector('#btn-comp-modal-close')?.addEventListener('click', () => modalEl.remove());
  modalEl.querySelector('#btn-comp-cancel')?.addEventListener('click', () => modalEl.remove());
}

/**
 * 求人 登録・編集モーダル (指示書 5項)
 */
function openJobFormModal(job = null, onClose) {
  let modalEl = document.getElementById('job-form-modal');
  if (modalEl) modalEl.remove();

  const isEdit = !!job;
  const companies = store.getCompanies();
  const raConsultants = store.getRaConsultants();

  modalEl = document.createElement('div');
  modalEl.id = 'job-form-modal';
  modalEl.className = 'fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4 overflow-y-auto text-xs';

  modalEl.innerHTML = `
    <div class="bg-white rounded-2xl shadow-2xl border border-slate-200 w-full max-w-lg p-6 space-y-4 animate-fadeIn">
      <div class="flex items-center justify-between border-b border-slate-200 pb-3">
        <h3 class="text-base font-bold text-slate-800">${isEdit ? '求人情報の編集' : '新規求人の登録'}</h3>
        <button id="btn-job-modal-close" class="text-slate-400 hover:text-slate-600 p-1">
          <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path></svg>
        </button>
      </div>

      <form id="form-job" class="space-y-4" onsubmit="return false;">
        <div>
          <label class="block font-bold text-slate-800 mb-1">求人名 (ポジション名) <span class="text-rose-500">*</span></label>
          <input type="text" id="job-title" value="${job ? (job.title || job.jobName) : ''}" required class="w-full bg-slate-50 border border-slate-300 rounded px-3 py-2 font-bold text-slate-900 focus:bg-white focus:border-indigo-600 focus:outline-none">
        </div>

        <div>
          <label class="block font-bold text-slate-800 mb-1">対象企業 <span class="text-rose-500">*</span></label>
          <select id="job-company-id" required class="w-full bg-slate-50 border border-slate-300 font-bold rounded px-3 py-2 text-slate-800 focus:outline-none">
            <option value="">-- 対象企業を選択してください --</option>
            ${companies.map(c => `<option value="${c.companyId}" ${job && job.companyId === c.companyId ? 'selected' : ''}>${c.name}</option>`).join('')}
          </select>
        </div>

        <div class="grid grid-cols-3 gap-3">
          <div>
            <label class="block font-bold text-slate-800 mb-1">勤務地</label>
            <input type="text" id="job-location" value="${job ? (job.location || '') : ''}" class="w-full bg-slate-50 border border-slate-300 rounded px-2.5 py-1.5 focus:outline-none">
          </div>

          <div>
            <label class="block font-bold text-slate-800 mb-1">募集状態</label>
            <select id="job-status" class="w-full bg-slate-50 border border-slate-300 font-bold rounded px-2.5 py-1.5 text-slate-800 focus:outline-none">
              ${JOB_STATUSES.map(st => `<option value="${st}" ${job && job.status === st ? 'selected' : ''}>${st}</option>`).join('')}
            </select>
          </div>

          <div>
            <label class="block font-bold text-slate-800 mb-1">求人担当RA</label>
            <select id="job-ra-id" class="w-full bg-slate-50 border border-slate-300 font-bold rounded px-2.5 py-1.5 text-slate-800 focus:outline-none">
              ${raConsultants.map(c => `<option value="${c.consultantId}" ${job && (job.raId || job.raConsultantId) === c.consultantId ? 'selected' : ''}>${c.name} (RA)</option>`).join('')}
            </select>
          </div>
        </div>
      </form>

      <div class="flex items-center justify-end space-x-3 border-t border-slate-200 pt-3">
        <button id="btn-job-cancel" class="px-4 py-2 bg-white border border-slate-300 text-slate-700 rounded-lg font-bold hover:bg-slate-100 transition">キャンセル</button>
        <button id="btn-job-submit" class="px-5 py-2 bg-indigo-600 hover:bg-indigo-500 text-white font-bold rounded-lg shadow transition">${isEdit ? '更新保存' : '登録する'}</button>
      </div>
    </div>
  `;

  document.body.appendChild(modalEl);

  modalEl.querySelector('#btn-job-submit')?.addEventListener('click', () => {
    const title = modalEl.querySelector('#job-title').value.trim();
    const companyId = modalEl.querySelector('#job-company-id').value;
    const location = modalEl.querySelector('#job-location').value.trim();
    const status = modalEl.querySelector('#job-status').value;
    const raId = modalEl.querySelector('#job-ra-id').value;

    if (!title) {
      alert('求人名を入力してください。');
      return;
    }
    if (!companyId) {
      alert('対象企業を選択してください。');
      return;
    }

    store.saveJob({
      jobId: job ? job.jobId : undefined,
      title,
      jobName: title,
      companyId,
      location,
      status,
      raId
    });

    modalEl.remove();
    onClose();
  });

  modalEl.querySelector('#btn-job-modal-close')?.addEventListener('click', () => modalEl.remove());
  modalEl.querySelector('#btn-job-cancel')?.addEventListener('click', () => modalEl.remove());
}

/**
 * コンサル 登録・編集モーダル (指示書 2, 4, 5, 13, 15項)
 */
function openConsultantFormModal(consultant = null, onClose) {
  let modalEl = document.getElementById('consultant-form-modal');
  if (modalEl) modalEl.remove();

  const isEdit = !!consultant;
  const currentRoles = (consultant && consultant.roles && Array.isArray(consultant.roles))
    ? consultant.roles
    : (consultant ? [consultant.roleType || 'CA'] : ['CA']);

  const hasCA = currentRoles.includes('CA');
  const hasRA = currentRoles.includes('RA');
  const hasAdmin = currentRoles.includes('ADMIN');

  modalEl = document.createElement('div');
  modalEl.id = 'consultant-form-modal';
  modalEl.className = 'fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4 overflow-y-auto text-xs';

  modalEl.innerHTML = `
    <div class="bg-white rounded-2xl shadow-2xl border border-slate-200 w-full max-w-md p-6 space-y-4 animate-fadeIn">
      <div class="flex items-center justify-between border-b border-slate-200 pb-3">
        <h3 class="text-base font-bold text-slate-800">${isEdit ? 'コンサルタント情報の編集' : '＋ 新規コンサルタントの追加'}</h3>
        <button id="btn-cons-modal-close" class="text-slate-400 hover:text-slate-600 p-1">
          <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path></svg>
        </button>
      </div>

      <form id="form-cons" class="space-y-4" onsubmit="return false;">
        <div>
          <label class="block font-bold text-slate-800 mb-1">氏名 <span class="text-rose-500">*</span></label>
          <input type="text" id="cons-name" value="${consultant ? consultant.name : ''}" required class="w-full bg-slate-50 border border-slate-300 rounded px-3 py-2 font-bold text-slate-900 focus:bg-white focus:border-indigo-600 focus:outline-none">
        </div>

        <div>
          <label class="block font-bold text-slate-800 mb-1">メールアドレス <span class="text-rose-500">*</span></label>
          <input type="email" id="cons-email" value="${consultant ? consultant.email : ''}" required class="w-full bg-slate-50 border border-slate-300 rounded px-3 py-2 font-bold text-slate-900 focus:bg-white focus:border-indigo-600 focus:outline-none">
        </div>

        <!-- 役割 複数選択チェックボックス (指示書 2, 13項) -->
        <div class="space-y-2 bg-slate-50 p-3 rounded-lg border border-slate-200">
          <label class="block font-bold text-slate-800">担当役割 (複数選択可) <span class="text-rose-500">*</span></label>
          <div class="flex flex-wrap items-center gap-4 pt-1 font-bold text-slate-700">
            <label class="inline-flex items-center space-x-1.5 cursor-pointer">
              <input type="checkbox" class="chk-cons-role rounded text-indigo-600 focus:ring-indigo-500" value="CA" ${hasCA ? 'checked' : ''}>
              <span>CA (キャリアアドバイザー)</span>
            </label>
            <label class="inline-flex items-center space-x-1.5 cursor-pointer">
              <input type="checkbox" class="chk-cons-role rounded text-indigo-600 focus:ring-indigo-500" value="RA" ${hasRA ? 'checked' : ''}>
              <span>RA (リクルーティングアドバイザー)</span>
            </label>
            <label class="inline-flex items-center space-x-1.5 cursor-pointer">
              <input type="checkbox" class="chk-cons-role rounded text-indigo-600 focus:ring-indigo-500" value="ADMIN" ${hasAdmin ? 'checked' : ''}>
              <span>管理者 (ADMIN)</span>
            </label>
          </div>
          <p class="text-[11px] text-slate-500 mt-1">※CAとRAの両方にチェックを入れると両面担当者として登録されます。</p>
        </div>

        <div>
          <label class="block font-bold text-slate-800 mb-1">有効・無効 <span class="text-rose-500">*</span></label>
          <select id="cons-status" required class="w-full bg-slate-50 border border-slate-300 font-bold rounded px-2.5 py-1.5 text-slate-800 focus:outline-none">
            <option value="active" ${!consultant || consultant.status !== 'inactive' ? 'selected' : ''}>有効</option>
            <option value="inactive" ${consultant && consultant.status === 'inactive' ? 'selected' : ''}>無効</option>
          </select>
        </div>
      </form>

      <div class="flex items-center justify-end space-x-3 border-t border-slate-200 pt-3">
        <button id="btn-cons-cancel" class="px-4 py-2 bg-white border border-slate-300 text-slate-700 rounded-lg font-bold hover:bg-slate-100 transition">キャンセル</button>
        <button id="btn-cons-submit" class="px-5 py-2 bg-indigo-600 hover:bg-indigo-500 text-white font-bold rounded-lg shadow transition">${isEdit ? '更新保存' : '追加する'}</button>
      </div>
    </div>
  `;

  document.body.appendChild(modalEl);

  modalEl.querySelector('#btn-cons-submit')?.addEventListener('click', () => {
    const name = modalEl.querySelector('#cons-name').value.trim();
    const email = modalEl.querySelector('#cons-email').value.trim();
    const status = modalEl.querySelector('#cons-status').value;

    if (!name || !email) {
      alert('氏名およびメールアドレスは必須入力です。');
      return;
    }

    // チェックされた役割の収集
    const checkedRoles = Array.from(modalEl.querySelectorAll('.chk-cons-role:checked')).map(cb => cb.value);
    if (checkedRoles.length === 0) {
      alert('役割を少なくとも1つ選択してください。（CA、RA、管理者のいずれか）');
      return;
    }

    const currentConsId = consultant ? consultant.consultantId : null;

    // 役割解除時の既存案件参照チェック (指示書 15項)
    if (isEdit && consultant) {
      if (hasRA && !checkedRoles.includes('RA')) {
        const raInUseCount = store.checkConsultantRoleInUse(consultant.consultantId, 'RA');
        if (raInUseCount > 0) {
          alert(`この担当者は ${raInUseCount} 件の選考案件で RA に設定されています。\nRA 役割を外す前に、該当選考案件の担当 RA を変更してください。`);
          return;
        }
      }
      if (hasCA && !checkedRoles.includes('CA')) {
        const caInUseCount = store.checkConsultantRoleInUse(consultant.consultantId, 'CA');
        if (caInUseCount > 0) {
          alert(`この担当者は ${caInUseCount} 件の選考案件で CA に設定されています。\nCA 役割を外す前に、該当選考案件の担当 CA を変更してください。`);
          return;
        }
      }
    }

    // メールアドレス重複判定 (指示書 4, 5項)
    const dupInfo = store.checkConsultantEmailDuplicateInfo(email, currentConsId, name);

    if (dupInfo.isDuplicate) {
      const existing = dupInfo.existingConsultant;

      if (!dupInfo.isSameName) {
        // 氏名が異なる場合 (指示書 5項)
        alert(`【警告: メールアドレス重複】\n\nこのメールアドレスは別の担当者に登録されています。\n\n登録済み: ${existing.name}\n入力中: ${name}\n\n登録内容を確認してください。`);
        return;
      }

      // 同一氏名の場合、既存データへ役割を追加 (指示書 4項)
      const existingRoles = (existing.roles && Array.isArray(existing.roles)) ? existing.roles : [existing.roleType || 'CA'];
      const mergedRoles = Array.from(new Set([...existingRoles, ...checkedRoles]));
      const addedRoles = checkedRoles.filter(r => !existingRoles.includes(r));

      const msg = `このメールアドレスは、すでに「${existing.name}」として登録されています。\n\n現在の役割: ${existingRoles.join('・')}\n追加する役割: ${addedRoles.length > 0 ? addedRoles.join('・') : '追加なし'}\n\n既存の担当者レコードへ役割を追加統合しますか？`;

      if (confirm(msg)) {
        store.saveConsultant({
          consultantId: existing.consultantId,
          name: existing.name,
          email: existing.email,
          roles: mergedRoles,
          roleType: mergedRoles.includes('ADMIN') ? 'ADMIN' : (mergedRoles.includes('CA') ? 'CA' : 'RA'),
          role: mergedRoles.includes('ADMIN') ? 'admin' : 'member',
          status: status
        });
        modalEl.remove();
        onClose();
      }
      return;
    }

    // 正常保存
    const primaryRoleType = checkedRoles.includes('ADMIN') ? 'ADMIN' : (checkedRoles.includes('CA') ? 'CA' : 'RA');
    store.saveConsultant({
      consultantId: currentConsId || undefined,
      name,
      email,
      roles: checkedRoles,
      roleType: primaryRoleType,
      role: primaryRoleType === 'ADMIN' ? 'admin' : 'member',
      status
    });

    modalEl.remove();
    onClose();
  });

  modalEl.querySelector('#btn-cons-modal-close')?.addEventListener('click', () => modalEl.remove());
  modalEl.querySelector('#btn-cons-cancel')?.addEventListener('click', () => modalEl.remove());
}

/**
 * コンサル無効化/アーカイブ時の担当引き継ぎ支援モーダル (指示書 11項)
 */
function openReassignModal(fromConsultantId, fromConsultantName, counts, onProceed) {
  let modalEl = document.getElementById('reassign-modal');
  if (modalEl) modalEl.remove();

  const consultants = store.getConsultants().filter(c => c.consultantId !== fromConsultantId && !c.isArchived);

  modalEl = document.createElement('div');
  modalEl.id = 'reassign-modal';
  modalEl.className = 'fixed inset-0 z-50 bg-slate-900/70 backdrop-blur-sm flex items-center justify-center p-4 overflow-y-auto text-xs';

  modalEl.innerHTML = `
    <div class="bg-white rounded-2xl shadow-2xl border border-amber-200 w-full max-w-md p-6 space-y-4 animate-fadeIn">
      <div class="flex items-center space-x-3 text-amber-600 border-b border-amber-100 pb-3">
        <svg class="w-6 h-6 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"></path></svg>
        <h4 class="font-bold text-sm text-slate-800">担当コンサルの引き継ぎ案内</h4>
      </div>

      <p class="text-slate-600 font-medium">
        コンサルタント <strong>「${fromConsultantName}」</strong> は、現在以下のデータに紐づいています。
      </p>

      <div class="bg-amber-50 p-3 rounded-lg border border-amber-200 space-y-1 font-bold text-amber-900 text-[11px]">
        <div>・担当候補者: ${counts.caCandidateCount}件</div>
        <div>・担当企業: ${counts.raCompanyCount}件</div>
        <div>・担当求人: ${counts.raJobCount}件</div>
        <div>・進行中選考案件: ${counts.selectionCount}件</div>
      </div>

      <div class="space-y-2 pt-2">
        <label class="block font-bold text-slate-800">引き継ぎ先のコンサルタントを選択:</label>
        <select id="select-reassign-target" class="w-full bg-slate-50 border border-slate-300 font-bold rounded px-3 py-2 text-indigo-900 focus:outline-none">
          ${consultants.map(c => `<option value="${c.consultantId}">${c.name} (${c.roleType})</option>`).join('')}
        </select>
      </div>

      <div class="space-y-2 pt-3 border-t border-slate-200">
        <button id="btn-reassign-submit" class="w-full py-2 bg-indigo-600 hover:bg-indigo-500 text-white font-bold rounded-lg shadow transition">
          担当を一括引き継ぎして処理を続ける
        </button>
        <button id="btn-reassign-skip" class="w-full py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold rounded-lg transition">
          引き継ぎせずに進む
        </button>
      </div>
    </div>
  `;

  document.body.appendChild(modalEl);

  modalEl.querySelector('#btn-reassign-submit')?.addEventListener('click', () => {
    const toId = modalEl.querySelector('#select-reassign-target').value;
    if (toId) {
      store.reassignConsultantResponsibilities(fromConsultantId, toId);
    }
    modalEl.remove();
    onProceed();
  });

  modalEl.querySelector('#btn-reassign-skip')?.addEventListener('click', () => {
    modalEl.remove();
    onProceed();
  });
}

/**
 * 管理者専用 データ管理 ＆ 初期化 ＆ 監査履歴セクション (指示書 4, 5, 8, 9, 10, 16, 17, 18, 19, 21項)
 */
function renderDataManagementSection(onUpdate) {
  const previews = store.getDeletionPreviewCounts();
  const demoPreview = previews.demo;
  const allPreview = previews.all;
  const auditLogs = store.getAuditLogs();

  setTimeout(() => {
    const section = document.getElementById('data-management-container');
    if (!section) return;

    // 1. デモデータ削除ボタン
    section.querySelector('#btn-delete-demo-data')?.addEventListener('click', () => {
      if (demoPreview.total === 0) {
        alert('削除対象となるデモデータは現在存在しません。');
        return;
      }

      const msg = `【デモデータ削除の確認】\n\nデモとして登録されたデータを削除しますか？\n\n■ 削除対象データ (計 ${demoPreview.total} 件):\n・デモ選考案件: ${demoPreview.selections} 件\n・デモ候補者: ${demoPreview.candidates} 件\n・デモ求人: ${demoPreview.jobs} 件\n・デモ企業: ${demoPreview.companies} 件\n・デモ関連履歴: ${demoPreview.histories + demoPreview.companyCommunications} 件\n\n※実データおよびログインコンサルタントは削除されません。`;
      if (confirm(msg)) {
        try {
          const deleted = store.deleteDemoData();
          alert(`初期化が完了しました。\n\n・選考案件: ${deleted.selections} 件削除\n・候補者: ${deleted.candidates} 件削除\n・求人: ${deleted.jobs} 件削除\n・企業: ${deleted.companies} 件削除\n・関連履歴: ${deleted.histories + deleted.companyCommunications} 件削除`);
          onUpdate();
        } catch (err) {
          alert('エラーが発生しました: ' + err.message);
        }
      }
    });

    // 2. 種別選択削除
    section.querySelector('#btn-delete-selected-data')?.addEventListener('click', () => {
      const checkedInputs = Array.from(section.querySelectorAll('.chk-data-type:checked'));
      if (checkedInputs.length === 0) {
        alert('削除するデータ種別を1つ以上選択してください。');
        return;
      }

      const selectedTypes = checkedInputs.map(i => i.value);
      const typeNames = checkedInputs.map(i => i.getAttribute('data-name')).join('・');

      if (confirm(`選択したデータ種別（${typeNames}）を削除します。\nよろしいですか？`)) {
        try {
          store.deleteSelectedDataTypes(selectedTypes);
          alert('選択したデータ種別の削除が完了しました。');
          onUpdate();
        } catch (err) {
          alert('削除エラー: ' + err.message);
        }
      }
    });

    // 3. 全業務データ初期化 (強い確認操作: 指示書 9項)
    section.querySelector('#btn-open-reset-all-modal')?.addEventListener('click', () => {
      if (allPreview.total === 0) {
        alert('削除対象となる業務データは現在ありません。');
        return;
      }

      let modalEl = document.getElementById('modal-reset-all-confirm');
      if (modalEl) modalEl.remove();

      modalEl = document.createElement('div');
      modalEl.id = 'modal-reset-all-confirm';
      modalEl.className = 'fixed inset-0 z-50 bg-slate-900/70 backdrop-blur-xs flex items-center justify-center p-4';
      modalEl.innerHTML = `
        <div class="bg-white rounded-2xl shadow-2xl border border-rose-200 max-w-md w-full p-6 space-y-4 text-xs animate-fadeIn">
          <div class="flex items-center space-x-2 text-rose-600 font-extrabold text-base border-b border-rose-100 pb-3">
            <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"></path></svg>
            <span>全業務データの初期化 (危険操作)</span>
          </div>

          <div class="space-y-2 text-slate-700 font-medium leading-relaxed">
            <p class="text-rose-700 font-bold">この操作により、候補者・企業・求人・選考案件・関連履歴などの全業務データ (${allPreview.total} 件) が完全に削除されます。</p>
            <p class="text-slate-500 text-[11px]">※この操作は元に戻せません。管理者ログインアカウントおよびシステム設定は保護されます。</p>
          </div>

          <div class="bg-slate-50 p-3 rounded-lg border border-slate-200 space-y-2">
            <label class="block font-bold text-slate-800">
              実行するには <span class="text-rose-600 font-mono font-black select-all">全データを初期化</span> と入力してください：
            </label>
            <input type="text" id="input-confirm-text-reset" placeholder="全データを初期化" class="w-full bg-white border border-slate-300 rounded px-3 py-2 text-slate-900 font-bold focus:outline-none focus:border-rose-600">
          </div>

          <div class="flex items-center justify-end space-x-3 pt-2">
            <button id="btn-modal-cancel-reset" class="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded font-bold transition">
              キャンセル
            </button>
            <button id="btn-modal-exec-reset" disabled class="px-4 py-2 bg-rose-600 hover:bg-rose-700 disabled:opacity-40 text-white rounded font-extrabold transition shadow-md">
              初期化を実行
            </button>
          </div>
        </div>
      `;

      document.body.appendChild(modalEl);

      const confirmInput = modalEl.querySelector('#input-confirm-text-reset');
      const execBtn = modalEl.querySelector('#btn-modal-exec-reset');
      const cancelBtn = modalEl.querySelector('#btn-modal-cancel-reset');

      confirmInput.addEventListener('input', () => {
        if (confirmInput.value.trim() === '全データを初期化') {
          execBtn.removeAttribute('disabled');
        } else {
          execBtn.setAttribute('disabled', 'true');
        }
      });

      cancelBtn.addEventListener('click', () => modalEl.remove());

      execBtn.addEventListener('click', () => {
        try {
          execBtn.innerText = 'データを初期化中...';
          execBtn.setAttribute('disabled', 'true');

          const resultCounts = store.resetAllBusinessData();
          modalEl.remove();
          alert(`初期化が完了しました。\n\n・選考案件: ${resultCounts.selections} 件削除\n・候補者: ${resultCounts.candidates} 件削除\n・求人: ${resultCounts.jobs} 件削除\n・企業: ${resultCounts.companies} 件削除\n・関連履歴: ${resultCounts.histories + resultCounts.companyCommunications} 件削除\n\nログインアカウントとシステム設定は保持されています。`);
          onUpdate();
        } catch (err) {
          alert('初期化エラー: ' + err.message);
          modalEl.remove();
        }
      });
    });

    // 4. 手動デモデータ再作成
    section.querySelector('#btn-seed-demo-data')?.addEventListener('click', () => {
      if (confirm('初期デモデータ（サンプル候補者・企業・求人・選考案件）を再生成しますか？')) {
        try {
          const counts = store.seedDemoData();
          alert(`デモデータの作成が完了しました。 (選考案件:${counts.selections}件, 候補者:${counts.candidates}件, 企業:${counts.companies}件)`);
          onUpdate();
        } catch (err) {
          alert('エラー: ' + err.message);
        }
      }
    });
  }, 0);

  return `
    <div id="data-management-container" class="space-y-6">
      <div class="border-b border-slate-200 pb-3">
        <h3 class="text-base font-extrabold text-slate-900 flex items-center gap-2">
          <span>⚙️ データ管理 ＆ 初期化設定</span>
          <span class="text-[10px] bg-rose-100 text-rose-800 border border-rose-300 font-bold px-2 py-0.5 rounded">管理者専用</span>
        </h3>
        <p class="text-xs text-slate-500 mt-1">デモデータの削除、特定テーブルの削除、全業務データの初期化、および過去の操作履歴を確認できます。</p>
      </div>

      <!-- 1. デモデータのみ削除 (指示書 5-1項) -->
      <div class="bg-amber-50/70 p-5 rounded-xl border border-amber-200 space-y-3">
        <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h4 class="font-bold text-amber-950 text-sm flex items-center gap-2">
              <span>🧹 デモデータのみ一括削除</span>
              <span class="text-xs bg-amber-200/80 text-amber-900 px-2 py-0.5 rounded-full font-bold">デモ件数: 計 ${demoPreview.total} 件</span>
            </h4>
            <p class="text-xs text-slate-600 mt-1">
              初期デモとして登録された候補者・企業・求人・選考案件・履歴を一括削除します。※手動登録された実データおよびログインコンサルタントは削除されません。
            </p>
          </div>

          <button id="btn-delete-demo-data" ${demoPreview.total === 0 ? 'disabled' : ''} class="shrink-0 px-4 py-2 bg-amber-600 hover:bg-amber-700 disabled:opacity-40 text-white rounded-lg font-bold shadow-sm transition">
            デモデータを削除 (${demoPreview.total}件)
          </button>
        </div>

        <div class="grid grid-cols-2 sm:grid-cols-4 gap-2 text-[11px] pt-1 font-semibold text-amber-900">
          <div class="bg-white/80 p-2 rounded border border-amber-200">選考案件: ${demoPreview.selections} 件</div>
          <div class="bg-white/80 p-2 rounded border border-amber-200">候補者: ${demoPreview.candidates} 件</div>
          <div class="bg-white/80 p-2 rounded border border-amber-200">企業: ${demoPreview.companies} 件</div>
          <div class="bg-white/80 p-2 rounded border border-amber-200">求人: ${demoPreview.jobs} 件</div>
        </div>
      </div>

      <!-- 2. データ種別を選択して削除 (指示書 5-2項) -->
      <div class="bg-slate-50 p-5 rounded-xl border border-slate-200 space-y-4">
        <div>
          <h4 class="font-bold text-slate-900 text-sm">📋 データ種別を指定して削除</h4>
          <p class="text-xs text-slate-500 mt-0.5">特定のデータ種別を選択して個別クリアできます。（削除時のデータ依存関係は自動で考慮されます）</p>
        </div>

        <div class="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
          <label class="inline-flex items-center space-x-2 bg-white p-2.5 rounded-lg border border-slate-200 cursor-pointer font-bold hover:border-indigo-300">
            <input type="checkbox" class="chk-data-type rounded text-indigo-600" value="selections" data-name="選考案件">
            <span>選考案件 (${allPreview.selections}件)</span>
          </label>
          <label class="inline-flex items-center space-x-2 bg-white p-2.5 rounded-lg border border-slate-200 cursor-pointer font-bold hover:border-indigo-300">
            <input type="checkbox" class="chk-data-type rounded text-indigo-600" value="candidates" data-name="候補者">
            <span>候補者 (${allPreview.candidates}件)</span>
          </label>
          <label class="inline-flex items-center space-x-2 bg-white p-2.5 rounded-lg border border-slate-200 cursor-pointer font-bold hover:border-indigo-300">
            <input type="checkbox" class="chk-data-type rounded text-indigo-600" value="companies" data-name="企業">
            <span>企業 (${allPreview.companies}件)</span>
          </label>
          <label class="inline-flex items-center space-x-2 bg-white p-2.5 rounded-lg border border-slate-200 cursor-pointer font-bold hover:border-indigo-300">
            <input type="checkbox" class="chk-data-type rounded text-indigo-600" value="jobs" data-name="求人">
            <span>求人 (${allPreview.jobs}件)</span>
          </label>
          <label class="inline-flex items-center space-x-2 bg-white p-2.5 rounded-lg border border-slate-200 cursor-pointer font-bold hover:border-indigo-300">
            <input type="checkbox" class="chk-data-type rounded text-indigo-600" value="histories" data-name="選考変更履歴">
            <span>選考変更履歴 (${allPreview.histories}件)</span>
          </label>
          <label class="inline-flex items-center space-x-2 bg-white p-2.5 rounded-lg border border-slate-200 cursor-pointer font-bold hover:border-indigo-300">
            <input type="checkbox" class="chk-data-type rounded text-indigo-600" value="communications" data-name="企業対応履歴">
            <span>企業対応履歴 (${allPreview.companyCommunications}件)</span>
          </label>
          <label class="inline-flex items-center space-x-2 bg-white p-2.5 rounded-lg border border-slate-200 cursor-pointer font-bold hover:border-indigo-300">
            <input type="checkbox" class="chk-data-type rounded text-indigo-600" value="qTargets" data-name="Q目標">
            <span>個人Q目標 (${allPreview.qTargets}件)</span>
          </label>
        </div>

        <div class="flex justify-end pt-2">
          <button id="btn-delete-selected-data" class="px-4 py-2 bg-slate-800 hover:bg-slate-900 text-white rounded-lg font-bold transition">
            選択した種別のデータを削除
          </button>
        </div>
      </div>

      <!-- 3. 全業務データを初期化 (指示書 5-3, 9項) -->
      <div class="bg-rose-50/70 p-5 rounded-xl border border-rose-200 space-y-3">
        <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h4 class="font-extrabold text-rose-950 text-sm flex items-center gap-2">
              <svg class="w-5 h-5 text-rose-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"></path></svg>
              <span>全業務データを初期化 (本番データクリア)</span>
            </h4>
            <p class="text-xs text-slate-700 mt-1">
              候補者・企業・求人・選考案件・履歴などの全業務データ (${allPreview.total} 件) を削除して初期状態へ戻します。<br>
              <strong class="text-rose-900">※管理者・コンサルタントアカウントおよびログイン設定は削除されません。</strong>
            </p>
          </div>

          <div class="flex items-center space-x-2 shrink-0">
            <button id="btn-seed-demo-data" class="px-3 py-2 bg-white hover:bg-slate-100 text-slate-700 border border-slate-300 rounded-lg font-bold text-xs transition">
              デモデータを再作成
            </button>
            <button id="btn-open-reset-all-modal" ${allPreview.total === 0 ? 'disabled' : ''} class="px-4 py-2 bg-rose-600 hover:bg-rose-700 disabled:opacity-40 text-white rounded-lg font-extrabold shadow-sm transition">
              全業務データを初期化
            </button>
          </div>
        </div>
      </div>

      <!-- 4. 初期化履歴 (監査ログ: 指示書 17項) -->
      <div class="bg-white rounded-xl border border-slate-200 overflow-hidden">
        <div class="px-4 py-3 bg-slate-900 text-white flex items-center justify-between">
          <h4 class="font-bold text-xs">📜 初期化・データ操作監査履歴 (過去100件)</h4>
        </div>

        <div class="overflow-x-auto">
          <table class="w-full text-left text-xs">
            <thead class="bg-slate-50 text-slate-700 font-bold border-b border-slate-200">
              <tr>
                <th class="px-4 py-2.5">実行日時</th>
                <th class="px-4 py-2.5">操作種別</th>
                <th class="px-4 py-2.5">実行者</th>
                <th class="px-4 py-2.5">対象件数・詳細</th>
                <th class="px-3 py-2.5 text-center">結果</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-slate-100">
              ${auditLogs.length === 0 ? `
                <tr><td colspan="5" class="text-center py-6 text-slate-400">操作履歴はありません。</td></tr>
              ` : auditLogs.map(log => {
                const opLabelMap = {
                  'DELETE_DEMO_DATA': 'デモデータ削除',
                  'DELETE_SELECTED_DATA': '選択データ削除',
                  'RESET_ALL_BUSINESS_DATA': '全業務データ初期化',
                  'CREATE_DEMO_DATA': 'デモデータ再作成'
                };
                const countsText = typeof log.targetCounts === 'object' ? JSON.stringify(log.targetCounts) : String(log.targetCounts);
                return `
                  <tr class="hover:bg-slate-50 transition">
                    <td class="px-4 py-2 font-mono text-slate-600">${new Date(log.executedAt).toLocaleString('ja-JP')}</td>
                    <td class="px-4 py-2 font-bold text-indigo-900">${opLabelMap[log.operationType] || log.operationType}</td>
                    <td class="px-4 py-2 font-semibold text-slate-800">${log.executedByName}</td>
                    <td class="px-4 py-2 font-mono text-slate-600 truncate max-w-xs" title="${countsText}">${countsText}</td>
                    <td class="px-3 py-2 text-center">
                      <span class="px-2 py-0.5 rounded text-[10px] font-bold ${log.result === 'SUCCESS' ? 'bg-emerald-100 text-emerald-800 border border-emerald-300' : 'bg-rose-100 text-rose-800 border border-rose-300'}">
                        ${log.result}
                      </span>
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
}
