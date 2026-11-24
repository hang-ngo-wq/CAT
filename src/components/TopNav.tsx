export type AppTab = 'single' | 'batch' | 'master' | 'api';

interface TopNavProps {
  activeTab: AppTab;
  onTabChange: (tab: AppTab) => void;
}

const NAV_ITEMS: Array<{ id: AppTab; label: string }> = [
  { id: 'single', label: 'Phân loại đơn lẻ' },
  { id: 'batch', label: 'Xử lý Excel & CSV' },
  { id: 'master', label: 'Danh mục & Cache' },
  { id: 'api', label: 'REST API' },
];

export function TopNav({ activeTab, onTabChange }: TopNavProps) {
  return (
    <header className="sticky top-0 z-30 border-b border-slate-200 bg-white">
      <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-4 py-3 sm:gap-8 sm:px-6 sm:py-3.5">
        <a
          href="#top"
          onClick={(e) => {
            e.preventDefault();
            onTabChange('single');
          }}
          className="font-display text-lg font-bold tracking-tight text-slate-900 whitespace-nowrap shrink-0"
        >
          JobCat JP
        </a>

        <nav
          aria-label="Điều hướng chính"
          className="hidden md:flex items-center gap-6"
        >
          {NAV_ITEMS.map((item) => {
            const isActive = activeTab === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => onTabChange(item.id)}
                className={`relative py-1.5 text-sm font-medium transition-colors whitespace-nowrap shrink-0 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-blue-700 ${
                  isActive
                    ? 'text-blue-700'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                {item.label}
                {isActive && (
                  <span
                    aria-hidden="true"
                    className="absolute inset-x-0 -bottom-3.5 h-0.5 bg-blue-700"
                  />
                )}
              </button>
            );
          })}
        </nav>
      </div>

      {/* Mobile secondary tab strip */}
      <nav
        aria-label="Điều hướng di động"
        className="flex md:hidden items-center gap-1 overflow-x-auto border-t border-slate-100 px-4 py-1.5"
      >
        {NAV_ITEMS.map((item) => {
          const isActive = activeTab === item.id;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => onTabChange(item.id)}
              className={`rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
                isActive
                  ? 'bg-blue-50 text-blue-700'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              {item.label}
            </button>
          );
        })}
      </nav>
    </header>
  );
}
