

export interface DashboardTab {
  id: string;
  label: string;
}

export function DashboardTabs({ tabs, activeTab, onTabChange }: { tabs: DashboardTab[], activeTab: string, onTabChange: (tabId: string) => void }) {
  return (
    <div className="mb-3">
      <ul className="nav nav-pills gap-2">
        {tabs.map(tab => (
          <li className="nav-item" key={tab.id}>
            <button 
              className={`nav-link px-4 py-2 fw-bold ${activeTab === tab.id ? 'active shadow-sm' : 'bg-white border text-dark'}`} 
              onClick={() => onTabChange(tab.id)} 
              style={{ borderRadius: '50rem' }}
            >
              {tab.label}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
