/**
 * 選考進捗・ヨミ管理システム - サイドバーナビゲーションコンポーネント (タイトル簡略化統一版)
 */

export const VIEWS = {
  DASHBOARD: 'dashboard',
  SELECTIONS: 'selections',
  KANBAN: 'kanban',
  CA: 'ca',
  RA: 'ra',
  COMPANY_ACTIONS: 'company_actions',
  CONSULTANTS: 'consultants',
  COMPANIES: 'companies',
  JOBS: 'jobs',
  MASTERS: 'masters'
};

export function renderSidebar(container, activeView, onSelectView) {
  const menuItems = [
    {
      id: VIEWS.COMPANY_ACTIONS,
      title: 'ヨミ表',
      icon: `<svg class="w-5 h-5 text-amber-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4"></path></svg>`
    },
    {
      id: VIEWS.KANBAN,
      title: 'ホワイトボード',
      icon: `<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 17V7m0 10a2 2 0 01-2 2H5a2 2 0 01-2-2V7a2 2 0 012-2h2a2 2 0 012 2m0 10a2 2 0 002 2h2a2 2 0 002-2V7a2 2 0 00-2-2h-2a2 2 0 01-2 2m0 10V7m6 10a2 2 0 002 2h2a2 2 0 002-2V7a2 2 0 00-2-2h-2a2 2 0 01-2 2"></path></svg>`
    },
    {
      id: VIEWS.COMPANIES,
      title: '企業別提出',
      icon: `<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"></path></svg>`
    },

    {
      id: VIEWS.JOBS,
      title: '求人・ポジション別',
      icon: `<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 13.255A23.931 23.931 0 0112 15c-3.183 0-6.22-.62-9-1.745M16 6V4a2 2 0 00-2-2h-4a2 2 0 00-2 2v2m4 6h.01M5 20h14a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"></path></svg>`
    },
    {
      id: VIEWS.MASTERS,
      title: 'マスタ管理',
      icon: `<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"></path><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"></path></svg>`
    }
  ];

  container.innerHTML = `
    <aside class="w-64 bg-slate-900 text-slate-300 border-r border-slate-800 flex-shrink-0 min-h-screen py-4 hidden md:block">
      <div class="px-4 mb-3">
        <p class="text-xs font-semibold uppercase tracking-wider text-slate-500">メインメニュー</p>
      </div>
      <nav class="space-y-1 px-2">
        ${menuItems.map(item => `
          <button
            data-view-id="${item.id}"
            class="w-full flex items-center space-x-3 px-3 py-2.5 rounded-lg text-sm font-medium transition ${
              activeView === item.id
                ? 'bg-indigo-600/90 text-white font-semibold shadow-sm'
                : 'hover:bg-slate-800 hover:text-white text-slate-400'
            }"
          >
            <span class="${activeView === item.id ? 'text-white' : 'text-slate-400'}">${item.icon}</span>
            <span>${item.title}</span>
          </button>
        `).join('')}
      </nav>
    </aside>
  `;

  container.querySelectorAll('button[data-view-id]').forEach(btn => {
    btn.addEventListener('click', () => {
      const viewId = btn.getAttribute('data-view-id');
      onSelectView(viewId);
    });
  });
}
