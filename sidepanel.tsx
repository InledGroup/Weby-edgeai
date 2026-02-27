console.log('🏁 [Sidepanel] Script evaluation started');

import { render } from 'preact';
import { SidebarApp } from './src/SidebarApp';
import './sidebar.css';
import '@/styles/global.css';

console.log('📦 [Sidepanel] Imports finished');

const root = document.getElementById('app-root');
if (root) {
  console.log('🏗️ [Sidepanel] Rendering SidebarApp...');
  try {
    render(<SidebarApp />, root);
    console.log('✅ [Sidepanel] Render called successfully');
  } catch (e) {
    console.error('❌ [Sidepanel] Render failed:', e);
  }
} else {
  console.error('❌ [Sidepanel] No app-root found');
}
