/** Layout route: the header/footer frame around every public page (dev review pages sit outside it). */
import { Outlet } from 'react-router';
import { PageViewCounter } from '@/lib/analytics';
import { Shell } from '../components/shell';

export default function ShellLayout() {
  return (
    <Shell>
      <Outlet />
      <PageViewCounter />
    </Shell>
  );
}
