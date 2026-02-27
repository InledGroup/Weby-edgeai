import { useState, useEffect } from 'preact/hooks';
import { RefreshCw, AlertTriangle, ShieldAlert, Globe, Check, X, Shield, Bell } from 'lucide-preact';
import { i18nStore } from '@/lib/stores/i18n';
import { getSetting, setSetting } from '@/lib/db/settings';

// Versión actual (debería coincidir con manifest.json)
const CURRENT_VERSION = '1.0.0'; 
const UPDATE_API_URL = 'https://extupdater.inled.es/api/updates.json';
const CHECK_INTERVAL = 24 * 60 * 60 * 1000; // 24 horas en ms

export function UpdateNotifier() {
  const [showUpdate, setShowUpdate] = useState(false);
  const [showConsent, setShowConsent] = useState(false);
  const [newVersion, setNewVersion] = useState('');
  const [updateUrl, setUpdateUrl] = useState('');

  useEffect(() => {
    async function init() {
      const enabled = await getSetting('enableUpdates');
      const lastCheck = await getSetting('lastUpdateCheck') || 0;
      const now = Date.now();

      if (enabled === null) {
        // Primera vez, pedir consentimiento
        setShowConsent(true);
      } else if (enabled === true) {
        // Comprobar si ha pasado suficiente tiempo desde la última vez (24h)
        if (now - lastCheck > CHECK_INTERVAL) {
          checkUpdates();
        }
      }
    }

    async function checkUpdates() {
      try {
        console.log('[UpdateNotifier] Checking for updates...');
        const response = await fetch(UPDATE_API_URL, { 
          cache: 'no-store',
          mode: 'cors'
        });
        
        if (response.ok) {
          const updates = await response.json();
          processUpdates(updates);
          // Actualizar el timestamp de la última comprobación
          await setSetting('lastUpdateCheck', Date.now());
        }
      } catch (error) {
        console.warn('[UpdateNotifier] Update check failed (Direct connection only)');
      }
    }

    function isNewer(latest: string, current: string): boolean {
      const v1 = latest.split('.').map(Number);
      const v2 = current.split('.').map(Number);
      for (let i = 0; i < Math.max(v1.length, v2.length); i++) {
        const n1 = v1[i] || 0;
        const n2 = v2[i] || 0;
        if (n1 > n2) return true;
        if (n1 < n2) return false;
      }
      return false;
    }

    function processUpdates(updates: any[]) {
      if (!Array.isArray(updates)) return;

      // Buscamos cualquier actualización de edgeai-v
      const edgeUpdate = updates.find(u => u.id && u.id.startsWith('weby-v'));
      
      if (edgeUpdate) {
        const versionMatch = edgeUpdate.id.match(/v(\d+\.\d+\.\d+)/);
        const detectedVersion = versionMatch ? versionMatch[1] : '';
        
        if (detectedVersion && isNewer(detectedVersion, CURRENT_VERSION)) {
          setNewVersion(detectedVersion);
          setUpdateUrl(edgeUpdate.url || 'https://github.com/InledGroup/Weby-edgeai');
          setShowUpdate(true);
        }
      }
    }

    init();
  }, []);

  const handleConsent = async (consent: boolean) => {
    await setSetting('enableUpdates', consent);
    setShowConsent(false);
    if (consent) {
      // Forzar comprobación inmediata tras aceptar
      window.location.reload();
    }
  };

  const handleUpdateClick = () => {
    window.open(updateUrl, '_blank');
    setShowUpdate(false);
  };

  if (showConsent) {
    return (
      <div className="fixed bottom-6 right-6 z-[200] max-w-sm bg-[var(--color-bg-secondary)] border border-[var(--color-border)] rounded-2xl shadow-2xl p-5 animate-in slide-in-from-bottom-10 duration-500">
        <div className="flex gap-4">
          <div className="w-10 h-10 rounded-full bg-[var(--color-primary)]/10 flex items-center justify-center shrink-0">
            <Shield size={20} className="text-[var(--color-primary)]" />
          </div>
          <div className="space-y-3">
            <div>
              <h4 className="font-bold text-sm text-[var(--color-text-primary)]">
                {i18nStore.t('updates.title')}
              </h4>
              <p className="text-xs text-[var(--color-text-secondary)] leading-relaxed mt-1">
                {i18nStore.t('privacy.enableUpdatesDesc')}
              </p>
            </div>
            <div className="flex gap-2">
              <button 
                onClick={() => handleConsent(true)}
                className="px-3 py-1.5 bg-[var(--color-primary)] text-black text-xs font-bold rounded-lg hover:opacity-90 transition-all"
              >
                {i18nStore.t('common.ready')}
              </button>
              <button 
                onClick={() => handleConsent(false)}
                className="px-3 py-1.5 bg-[var(--color-bg-tertiary)] text-[var(--color-text-secondary)] text-xs font-medium rounded-lg hover:bg-[var(--color-bg-hover)] transition-all"
              >
                {i18nStore.t('common.close')}
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (!showUpdate) return null;

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/80 backdrop-blur-md p-6">
      <div className="w-full max-w-md bg-[var(--color-bg)] border border-[var(--color-warning)]/50 rounded-3xl shadow-2xl overflow-hidden animate-in fade-in zoom-in duration-300 max-h-[90vh] flex flex-col">
        <div className="bg-[var(--color-warning)]/10 p-8 flex flex-col items-center justify-center space-y-4 border-b border-[var(--color-border)] shrink-0">
          <div className="w-16 h-16 bg-amber-500/20 rounded-2xl flex items-center justify-center border border-amber-500/30">
            <RefreshCw size={32} className="text-amber-500 animate-spin-slow" />
          </div>
          <h2 className="text-xl font-bold text-[var(--color-text-primary)] text-center">
            {i18nStore.t('updates.title')}
          </h2>
          <div className="px-3 py-1 bg-amber-500 text-black text-[10px] font-bold rounded-full uppercase tracking-widest">
            v{newVersion} disponible
          </div>
        </div>
        
        <div className="p-6 space-y-6 overflow-y-auto custom-scrollbar">
          <p className="text-[var(--color-text-secondary)] text-sm leading-relaxed text-center">
            {i18nStore.t('updates.message')}
          </p>
          
          <div className="bg-[var(--color-bg-secondary)] p-4 rounded-2xl border border-[var(--color-border)] space-y-3">
            <div className="flex items-start gap-3 text-sm text-[var(--color-text-primary)]">
              <div className="mt-0.5"><ShieldAlert size={16} className="text-blue-500" /></div>
              <p>{i18nStore.t('updates.step1')}</p>
            </div>
            <div className="flex items-start gap-3 text-sm text-[var(--color-text-primary)] font-semibold">
              <div className="mt-0.5"><AlertTriangle size={16} className="text-amber-500" /></div>
              <p>{i18nStore.t('updates.step2')}</p>
            </div>
            <div className="flex items-start gap-3 text-sm text-[var(--color-text-primary)]">
              <div className="mt-0.5"><RefreshCw size={16} className="text-green-500" /></div>
              <p>{i18nStore.t('updates.step3')}</p>
            </div>
          </div>

          <p className="text-xs text-[var(--color-text-tertiary)] italic text-center">
            {i18nStore.t('updates.backupNotice')}
          </p>
          
          <div className="flex flex-col space-y-2">
            <button
              onClick={handleUpdateClick}
              className="w-full py-4 bg-[var(--color-primary)] text-black font-bold rounded-2xl transition-all active:scale-95 shadow-lg shadow-[var(--color-primary)]/20"
            >
              Descargar Actualización
            </button>
            <button
              onClick={() => setShowUpdate(false)}
              className="w-full py-2 text-[var(--color-text-tertiary)] hover:text-[var(--color-text-secondary)] transition-colors text-sm font-medium"
            >
              Recordar más tarde
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
