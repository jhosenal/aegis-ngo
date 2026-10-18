import {ChatWorkspaceProvider} from './chat/ChatWorkspace.js';
import './chat/chat-workspace.css';
import React from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.js';
import { AssistRoute } from './AssistRoute.js';
import { DomainsRoute } from './DomainsRoute.js';
import { LegalNoticeRoute } from './LegalNoticeRoute.js';
import { HistoryRoute } from './HistoryRoute.js';
import { AdminRoute } from './AdminRoute.js';
import { OverviewRoute } from './overview/OverviewRoute.js';
import { HazardMapRoute } from './prototype/HazardMapRoute.js';
import './styles.css';
import './design/global.css';
import { Dashboard } from './dashboard/Dashboard.js';
import { WorkspaceShell } from './shell/WorkspaceShell.js';
import { PageCard } from './components/ModuleCard.js';

const root = document.getElementById('root');
if (!root) throw new Error('The application root element is missing');

// /assist is the public landing / monitoring home. Verified source guidance remains available at /assist/guidance.
const isAssist = window.location.pathname === '/assist' || window.location.pathname === '/assist/';
const isAssistGuidance = window.location.pathname === '/assist/guidance' || window.location.pathname === '/assist/guidance/';
// /domains is the public catalogue of the seven hazard domains (specified and audited, not running).
const isDomains = window.location.pathname === '/domains' || window.location.pathname === '/domains/';
// /overview is the NGO incident overview (design references D0001 to D0004), built against a synthetic stub until real data is slotted in.
const isOverview = window.location.pathname === '/overview' || window.location.pathname === '/overview/';
// /prototype/map is the hazard-map prototype (areas of disaster, pulsing, with an icon per hazard kind); synthetic data, not linked from any menu.
const isHazardMap = window.location.pathname === '/prototype/map' || window.location.pathname === '/prototype/map/';
// /history is the public ten-year incident history with a month range, search and map (AEG-HIST-002).
const isHistory = window.location.pathname === '/history' || window.location.pathname === '/history/';
// /admin is the administrators' desk (AEG-ADMIN-001): spend and cost gate, feeds, broadcast desk. Read-only.
const isAdminDesk = window.location.pathname === '/admin' || window.location.pathname === '/admin/';
const isLegalNotice = /^\/legal\/(?:data-sources|terms)\/?$/.test(window.location.pathname);
const isDashboard = ['/', '/dashboard', '/dashboard/'].includes(window.location.pathname);

createRoot(root).render(
  <React.StrictMode><ChatWorkspaceProvider>
    <PageCard pageId={isAdminDesk ? 'admin' : isLegalNotice ? 'data-sources' : isDashboard || isAssist ? 'dashboard' : isHistory ? 'history' : isAssistGuidance ? 'assist' : isDomains ? 'domains' : isOverview ? 'overview' : isHazardMap ? 'map-prototype' : 'workspace'}>
    {isAdminDesk ? <AdminRoute /> : isLegalNotice ? <WorkspaceShell page="legal"><LegalNoticeRoute /></WorkspaceShell> : isDashboard || isAssist ? <Dashboard /> : isHistory ? <WorkspaceShell page="history"><HistoryRoute /></WorkspaceShell> : isAssistGuidance ? <WorkspaceShell page="assist"><AssistRoute /></WorkspaceShell> : isDomains ? <WorkspaceShell page="domains"><DomainsRoute /></WorkspaceShell> : isOverview ? <WorkspaceShell page="overview" assistant={false}><OverviewRoute /></WorkspaceShell> : isHazardMap ? <WorkspaceShell page="prototype"><HazardMapRoute /></WorkspaceShell> : <WorkspaceShell page="workspace" assistant={false}><App/></WorkspaceShell>}
    </PageCard>
  </ChatWorkspaceProvider></React.StrictMode>,
);
