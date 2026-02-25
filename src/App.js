import { useState } from 'react';
import Auth from './components/Auth';
import Chat from './components/Chat';
import YouTubeDownload from './components/YouTubeDownload';
import './App.css';

function App() {
  const [user, setUser] = useState(() => {
    const stored = localStorage.getItem('chatapp_user');
    if (!stored) return null;
    try {
      const parsed = JSON.parse(stored);
      if (typeof parsed === 'string') return { username: parsed, firstName: '', lastName: '' };
      return parsed;
    } catch {
      return { username: stored, firstName: '', lastName: '' };
    }
  });

  const [activeTab, setActiveTab] = useState('chat');

  const handleLogin = (userObj) => {
    localStorage.setItem('chatapp_user', JSON.stringify(userObj));
    setUser(userObj);
    setActiveTab('chat');
  };

  const handleLogout = () => {
    localStorage.removeItem('chatapp_user');
    setUser(null);
    setActiveTab('chat');
  };

  if (!user) {
    return <Auth onLogin={handleLogin} />;
  }

  return (
    <>
      <div className="app-tab-bar">
        <button
          className={`tab-btn${activeTab === 'chat' ? ' active' : ''}`}
          onClick={() => setActiveTab('chat')}
        >
          Chat
        </button>
        <button
          className={`tab-btn${activeTab === 'youtube' ? ' active' : ''}`}
          onClick={() => setActiveTab('youtube')}
        >
          YouTube Channel Download
        </button>
        <div className="tab-bar-spacer" />
        <button className="tab-logout-btn" onClick={handleLogout}>
          Log out
        </button>
      </div>
      <div className="app-tab-content">
        {activeTab === 'chat' && (
          <Chat
            username={user.username}
            firstName={user.firstName || ''}
            lastName={user.lastName || ''}
            onLogout={handleLogout}
          />
        )}
        {activeTab === 'youtube' && <YouTubeDownload />}
      </div>
    </>
  );
}

export default App;
