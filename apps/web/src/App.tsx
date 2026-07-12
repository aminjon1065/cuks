import { RouterProvider } from 'react-router-dom';
import { Providers } from './app/providers';
import { router } from './app/router';

/** Application root (docs/03): global providers wrap the router. */
export function App(): React.JSX.Element {
  return (
    <Providers>
      <RouterProvider router={router} />
    </Providers>
  );
}
