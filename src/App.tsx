import { useCallback, useEffect, useState } from 'react';
import { ApiReference } from './components/ApiReference';
import { BatchProcessor } from './components/BatchProcessor';
import { MasterManager } from './components/MasterManager';
import { SingleClassifier } from './components/SingleClassifier';
import { type AppTab, TopNav } from './components/TopNav';
import type { CacheStats, MasterData } from './types/classifier';

export default function App() {
  const [activeTab, setActiveTab] = useState<AppTab>('single');
  const [master, setMaster] = useState<MasterData | null>(null);
  const [cacheStats, setCacheStats] = useState<CacheStats | null>(null);

  const loadMetadata = useCallback(async () => {
    try {
      const [masterResp, cacheResp] = await Promise.all([
        fetch('/api/v1/master'),
        fetch('/api/v1/cache/stats'),
      ]);
      if (masterResp.ok) {
        setMaster((await masterResp.json()) as MasterData);
      }
      if (cacheResp.ok) {
        setCacheStats((await cacheResp.json()) as CacheStats);
      }
    } catch (err) {
      console.error('Failed to load initial metadata:', err);
    }
  }, []);

  useEffect(() => {
    void loadMetadata();
  }, [loadMetadata]);

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <TopNav activeTab={activeTab} onTabChange={setActiveTab} />

      <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6">
        {activeTab === 'single' && (
          <SingleClassifier master={master} onCacheUpdated={loadMetadata} />
        )}
        {activeTab === 'batch' && (
          <BatchProcessor onCacheUpdated={loadMetadata} />
        )}
        {activeTab === 'master' && (
          <MasterManager
            master={master}
            cacheStats={cacheStats}
            onMasterUpdated={setMaster}
            onCacheCleared={setCacheStats}
          />
        )}
        {activeTab === 'api' && <ApiReference />}
      </main>
    </div>
  );
}
