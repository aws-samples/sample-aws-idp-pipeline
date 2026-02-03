import { createRootRouteWithContext } from '@tanstack/react-router';
import AppLayout from '../components/AppLayout';
import { RouterProviderContext } from '../main';
import { Outlet } from '@tanstack/react-router';
import { SidebarSessionProvider } from '../contexts/SidebarSessionContext';

export const Route = createRootRouteWithContext<RouterProviderContext>()({
  component: () => (
    <SidebarSessionProvider>
      <AppLayout>
        <Outlet />
      </AppLayout>
    </SidebarSessionProvider>
  ),
});
