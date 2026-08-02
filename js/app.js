/**
 * 選考進捗・ヨミ管理システム - メインアプリケーションエントリーポイント (CA/RA・企業対応拡張版)
 */

import { store } from './store.js';
import { renderHeader } from './components/header.js';
import { renderSidebar, VIEWS } from './components/sidebar.js';
import { renderDashboard } from './components/dashboardView.js';
import { renderSelectionList } from './components/selectionListView.js';
import { openSelectionDetailModal } from './components/selectionDetailModal.js';
import { renderKanbanView } from './components/kanbanView.js';
import { renderCaView } from './components/caView.js';
import { renderRaView } from './components/raView.js';
import { renderCompanyActionListView } from './components/companyActionListView.js';
import { renderConsultantView } from './components/consultantView.js';
import { renderCompanyView } from './components/companyView.js';
import { renderJobView } from './components/jobView.js';
import { renderMasterManagement } from './components/masterManagementView.js';
import { openNewSelectionModal } from './components/newSelectionModal.js';
import { openCsvImportModal } from './components/csvImportModal.js';
import { openEmailComposerModal } from './components/emailComposerModal.js';
import { renderSyncDiagnosticView } from './components/syncDiagnosticView.js';
import { fetchSelectionsFromServerDirect, migrateLocalDataToFirestore, seedAllInitialDataToFirestore } from './firebase.js';

class App {
  constructor() {
    this.currentView = (window.location.hash === '#sync-diagnostic') ? 'syncDiagnostic' : VIEWS.DASHBOARD;
    this.viewFilters = {};
    this.directFetchResult = null;
    this.init();
  }

  init() {
    window.addEventListener('hashchange', () => {
      if (window.location.hash === '#sync-diagnostic') {
        this.currentView = 'syncDiagnostic';
        this.render();
      }
    });

    store.subscribe(() => {
      this.render();
    });

    this.render();
  }

  render() {
    const headerContainer = document.getElementById('app-header');
    const sidebarContainer = document.getElementById('app-sidebar');
    const contentContainer = document.getElementById('app-content');

    if (!headerContainer || !sidebarContainer || !contentContainer) return;

    // 指示書 9項: Firestore 共通データ読み込み中のローディング表示
    if (store.isLoading) {
      contentContainer.innerHTML = `
        <div class="flex flex-col items-center justify-center min-h-[50vh] space-y-4">
          <div class="w-12 h-12 border-4 border-indigo-600 border-t-transparent rounded-full animate-spin"></div>
          <p class="text-slate-800 font-extrabold text-base">共通データを読み込んでいます</p>
          <p class="text-xs text-slate-500">Firestore から最新のデータを同期中です...</p>
        </div>
      `;
      return;
    }

    // 端末B リアルタイム診断パネルの描画 (指示書 1, 6項)
    this.renderTerminalBDebugPanel();

    // ヘッダー描画
    renderHeader(headerContainer, {
      activeViewTitle: this.getViewTitle(this.currentView),
      onOpenNewSelection: () => openNewSelectionModal(() => this.render()),
      onOpenCsvImport: () => openCsvImportModal(() => this.render())
    });

    // サイドバー描画
    renderSidebar(sidebarContainer, this.currentView, (viewId) => {
      this.currentView = viewId;
      this.viewFilters = {};
      this.render();
    });

    // メインコンテンツ描画
    contentContainer.innerHTML = '';
    const viewContainer = document.createElement('div');
    contentContainer.appendChild(viewContainer);

    switch (this.currentView) {
      case 'syncDiagnostic':
        renderSyncDiagnosticView(viewContainer);
        break;

      case VIEWS.DASHBOARD:
        renderDashboard(viewContainer, {
          onNavigateToSelections: (filters = {}) => {
            this.currentView = VIEWS.SELECTIONS;
            this.viewFilters = filters;
            this.render();
          },
          onNavigateToConsultant: (consultantId) => {
            this.currentView = VIEWS.CONSULTANTS;
            this.viewFilters = { consultantId };
            this.render();
          },
          onNavigateToCompany: (companyId) => {
            this.currentView = VIEWS.COMPANIES;
            this.viewFilters = { companyId };
            this.render();
          }
        });
        break;

      case VIEWS.SELECTIONS:
        renderSelectionList(contentContainer, {
          initialFilter: this.viewFilters,
          onOpenDetail: (selectionId) => {
            openSelectionDetailModal(selectionId, () => this.render());
          },
          onOpenNewModal: () => {
            openNewSelectionModal(() => this.render());
          }
        });
        break;

      case VIEWS.KANBAN:
        renderKanbanView(contentContainer, {
          onOpenDetail: (selectionId) => {
            openSelectionDetailModal(selectionId, () => this.render());
          }
        });
        break;

      case VIEWS.CA:
        renderCaView(contentContainer, {
          onOpenDetail: (selectionId) => {
            openSelectionDetailModal(selectionId, () => this.render());
          }
        });
        break;

      case VIEWS.RA:
        renderRaView(contentContainer, {
          onOpenDetail: (selectionId) => {
            openSelectionDetailModal(selectionId, () => this.render());
          },
          onOpenEmailComposer: (companyId, selectionIds = null) => {
            openEmailComposerModal(companyId, () => this.render(), selectionIds);
          }
        });
        break;

      case VIEWS.COMPANY_ACTIONS:
        renderCompanyActionListView(contentContainer, {
          onOpenDetail: (selectionId) => {
            openSelectionDetailModal(selectionId, () => this.render());
          },
          onOpenEmailComposer: (companyId, selectionIds = null) => {
            openEmailComposerModal(companyId, () => this.render(), selectionIds);
          }
        });
        break;

      case VIEWS.CONSULTANTS:
        renderConsultantView(contentContainer, this.viewFilters.consultantId || '', {
          onOpenDetail: (selectionId) => {
            openSelectionDetailModal(selectionId, () => this.render());
          }
        });
        break;

      case VIEWS.COMPANIES:
        renderCompanyView(contentContainer, this.viewFilters.companyId || '', {
          onOpenDetail: (selectionId) => {
            openSelectionDetailModal(selectionId, () => this.render());
          }
        });
        break;

      case VIEWS.JOBS:
        renderJobView(contentContainer, {
          onOpenDetail: (selectionId) => {
            openSelectionDetailModal(selectionId, () => this.render());
          }
        });
        break;

      case VIEWS.MASTERS:
        renderMasterManagement(contentContainer);
        break;

      default:
        renderDashboard(contentContainer, {});
        break;
    }
  }

  getViewTitle(viewId) {
    switch (viewId) {
      case VIEWS.DASHBOARD: return '全体ダッシュボード';
      case VIEWS.SELECTIONS: return '選考一覧';
      case VIEWS.KANBAN: return 'ホワイトボード';
      case VIEWS.CA: return 'CA管理画面';
      case VIEWS.RA: return 'RA管理画面';
      case VIEWS.COMPANY_ACTIONS: return '企業対応';
      case VIEWS.CONSULTANTS: return 'コンサル別実績';
      case VIEWS.COMPANIES: return '企業別・提出エクスポート';
      case VIEWS.JOBS: return '求人・ポジション別';
      case VIEWS.MASTERS: return 'マスタ管理';
      default: return '選考進捗・ヨミ管理システム';
    }
  }

  renderTerminalBDebugPanel() {
    const panel = document.getElementById('terminal-b-debug-panel');
    if (!panel) return;

    const info = window.TERMINAL_B_DEBUG || {};

    panel.innerHTML = `
      <div style="background: rgba(15, 23, 42, 0.95); color: #f8fafc; font-family: monospace; font-size: 10px; padding: 10px 14px; border-radius: 8px; border: 1px solid #3b82f6; box-shadow: 0 10px 25px rgba(0,0,0,0.5); max-width: 320px; backdrop-filter: blur(4px);">
        <div style="font-weight: 900; color: #60a5fa; border-bottom: 1px solid #334155; padding-bottom: 4px; margin-bottom: 6px; display: flex; justify-content: space-between; align-items: center;">
          <span>TERMINAL B DIAGNOSIS PANEL</span>
          <span style="font-size: 9px; background: #1e293b; padding: 1px 5px; border-radius: 4px; color: #4ade80;">LIVE</span>
        </div>
        <div style="line-height: 1.45;">
          <div><strong style="color:#94a3b8;">Project ID:</strong> ${info.projectId || '-'}</div>
          <div><strong style="color:#94a3b8;">Database ID:</strong> ${info.databaseId || '(default)'}</div>
          <div><strong style="color:#94a3b8;">対象コレクション:</strong> ${info.targetCollection || 'selections'}</div>
          <div><strong style="color:#94a3b8;">getDocsFromServer 取得件数:</strong> <span style="color:#60a5fa; font-weight:bold;">${info.serverReadCount || 0}</span></div>
          <div><strong style="color:#94a3b8;">onSnapshot 取得件数:</strong> <span style="color:#4ade80; font-weight:bold;">${info.snapshotCount || 0}</span></div>
          <div><strong style="color:#94a3b8;">onSnapshot開始:</strong> ${info.snapshotStarted ? 'true' : 'false'}</div>
          <div><strong style="color:#94a3b8;">onSnapshot受信回数:</strong> ${info.snapshotReceiveCount || 0}</div>
          <div><strong style="color:#94a3b8;">fromCache:</strong> <span style="color:${info.fromCache ? '#facc15' : '#4ade80'};">${info.fromCache ? 'true' : 'false'}</span></div>
          <div><strong style="color:#94a3b8;">hasPendingWrites:</strong> ${info.hasPendingWrites ? 'true' : 'false'}</div>
          <div><strong style="color:#94a3b8;">最終受信時刻:</strong> ${info.lastReceivedAt || '-'}</div>
          <div><strong style="color:#94a3b8;">エラーコード:</strong> <span style="color:${info.errorCode === 'none' ? '#94a3b8' : '#f87171'}; font-weight:bold;">${info.errorCode}</span></div>
          <div><strong style="color:#94a3b8;">エラーメッセージ:</strong> <span style="color:${info.errorMessage === 'none' ? '#94a3b8' : '#f87171'}; font-weight:bold;">${info.errorMessage}</span></div>
        </div>
      </div>
    `;
  }

  renderDebugPanel(rawCount = 0) {
    const panelContainer = document.getElementById('data-source-debug-panel');
    if (!panelContainer) return;

    const info = window.DATA_SOURCE_DEBUG_INFO || {};
    info.rawCount = rawCount;
    info.filteredCount = rawCount;

    panelContainer.innerHTML = `
      <div style="background: rgba(15, 23, 42, 0.95); color: #f8fafc; font-family: monospace; font-size: 10px; padding: 10px 14px; border-radius: 8px; border: 1px solid #3b82f6; box-shadow: 0 10px 25px rgba(0,0,0,0.5); max-width: 320px; backdrop-filter: blur(4px);">
        <div style="font-weight: 900; color: #60a5fa; border-bottom: 1px solid #334155; padding-bottom: 4px; margin-bottom: 6px; display: flex; justify-content: space-between; align-items: center;">
          <span>DATA SOURCE DEBUG</span>
          <span style="font-size: 9px; background: #1e293b; padding: 1px 5px; border-radius: 4px; color: #94a3b8;">LIVE</span>
        </div>
        <div style="line-height: 1.45;">
          <div><strong style="color:#94a3b8;">Project ID:</strong> ${info.projectId || '-'}</div>
          <div><strong style="color:#94a3b8;">Database ID:</strong> ${info.databaseId || '(default)'}</div>
          <div><strong style="color:#94a3b8;">Collection:</strong> ${info.collection || 'selections'}</div>
          <div><strong style="color:#94a3b8;">Document path:</strong> ${info.documentPath || 'selections/{docId}'}</div>
          <div><strong style="color:#94a3b8;">Auth UID:</strong> ${info.authUid || 'unauthenticated'}</div>
          <div><strong style="color:#94a3b8;">Data source:</strong> <span style="color:${(info.dataSource || '').includes('server') ? '#4ade80' : '#facc15'}; font-weight:bold;">${info.dataSource || 'unknown'}</span></div>
          <div><strong style="color:#94a3b8;">Loaded count:</strong> ${info.loadedCount || 0}</div>
          <div><strong style="color:#94a3b8;">First doc ID:</strong> ${info.firstDocId || '-'}</div>
          <div><strong style="color:#94a3b8;">Last loaded at:</strong> ${info.lastLoadedAt || '-'}</div>
          <div><strong style="color:#94a3b8;">localStorage count:</strong> ${info.localStorageCount || 0}</div>
          <div><strong style="color:#94a3b8;">IndexedDB persistence:</strong> ${info.indexedDbPersistence ? 'enabled' : 'disabled'}</div>
          <div style="border-t: 1px dashed #334155; margin-top: 4px; padding-top: 4px;">
            <strong style="color:#94a3b8;">Raw / Filtered count:</strong> ${info.rawCount} / ${info.filteredCount}
          </div>
          <div><strong style="color:#94a3b8;">Test doc ID:</strong> ${info.testDocId || 'TEST_SHARED_RECORD_20260802'}</div>
          <div><strong style="color:#94a3b8;">Test doc exists:</strong> <span style="color:${info.testDocExists ? '#4ade80' : '#f87171'}; font-weight:bold;">${info.testDocExists ? 'true' : 'false'}</span></div>
          <div><strong style="color:#94a3b8;">Test doc val:</strong> ${info.testDocValue || '-'}</div>
        </div>
      </div>
    `;
  }
}

document.addEventListener('DOMContentLoaded', () => {
  window.app = new App();
});
