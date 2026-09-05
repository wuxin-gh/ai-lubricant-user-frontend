import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@fontsource-variable/jetbrains-mono/wght.css'
import '@fontsource-variable/noto-sans-sc/wght.css'
import './index.css'
// Admin theme variables are just CSS custom properties (:root scoped) — harmless
// globally. Admin's global reset (antd reset + global.css) is NOT imported here
// because it overrides Tailwind's preflight and breaks the user-facing pages.
// Those are loaded scoped to the admin console via admin-console-shell.tsx.
import '@/@admin-port/styles/variables.css'
import App from './App.tsx'
import { initI18n } from './i18n'
import { AppRuntimeProvider } from './components/app-runtime-provider'


import dayjs from 'dayjs';
import 'dayjs/locale/zh-cn';
import duration from 'dayjs/plugin/duration';
import relativeTime from 'dayjs/plugin/relativeTime';

dayjs.extend(duration);
dayjs.extend(relativeTime);

function renderApp() {
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <AppRuntimeProvider>
        <App />
      </AppRuntimeProvider>
    </StrictMode>,
  )
}

void initI18n().then(renderApp)
