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

class App {
  constructor() {
    this.currentView = VIEWS.DASHBOARD;
    this.viewFilters = {};
    this.init();
  }

  init() {
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

    switch (this.currentView) {
      case VIEWS.DASHBOARD:
        renderDashboard(contentContainer, {
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
}

document.addEventListener('DOMContentLoaded', () => {
  window.app = new App();
});
